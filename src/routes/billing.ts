import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../middleware/auth.js'
import { createXenditInvoice, PLAN_PRICES } from '../lib/xendit.js'
import { sendSubscriptionExpiryEmail } from '../lib/email.js'

export const billingRoutes = new Hono()

// ─── PUBLIC ──────────────────────────────────────────────────────────────────

// GET /billing/plans — daftar paket dan harga
billingRoutes.get('/plans', (c) => {
  return c.json(PLAN_PRICES)
})

// POST /billing/checkout — buat invoice Xendit (requires auth)
billingRoutes.post(
  '/checkout',
  authMiddleware,
  zValidator('json', z.object({
    plan: z.enum(['basic', 'pro', 'enterprise']),
  })),
  async (c) => {
    const { tenantId } = c.get('auth')
    const { plan } = c.req.valid('json')

    const planInfo = PLAN_PRICES[plan]
    if (!planInfo) return c.json({ error: 'Paket tidak valid' }, 400)

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { users: { where: { role: 'OWNER' }, select: { email: true, name: true }, take: 1 } },
    })
    if (!tenant) return c.json({ error: 'Tenant tidak ditemukan' }, 404)

    const ownerEmail = tenant.users[0]?.email ?? 'user@rotipos.com'
    const externalId = `SUB-${tenantId.slice(0, 8)}-${Date.now()}`

    // Buat subscription record
    const subscription = await prisma.subscription.create({
      data: {
        tenantId,
        plan,
        amount: planInfo.amount,
        status: 'PENDING',
      },
    })

    const appUrl = process.env.APP_URL ?? 'https://pos-bakery-fe.vercel.app'

    // Dev mode — bypass Xendit if secret key not set
    if (!process.env.XENDIT_SECRET_KEY || !process.env.XENDIT_SECRET_KEY.startsWith('xnd_')) {
      const devUrl = `${appUrl}/app/billing/success?sub=${subscription.id}`
      console.log(`[DEV MODE] Xendit bypassed. Subscription: ${subscription.id}`)
      return c.json({ invoiceUrl: devUrl, invoiceId: 'dev-' + subscription.id, subscriptionId: subscription.id, amount: planInfo.amount, plan })
    }

    try {
      const invoice = await createXenditInvoice({
        externalId,
        amount: planInfo.amount,
        payerEmail: ownerEmail,
        description: `${planInfo.label} - ${tenant.name} (30 hari)`,
        successRedirectUrl: `${appUrl}/app/billing/success?sub=${subscription.id}`,
        failureRedirectUrl: `${appUrl}/app/billing/failed?sub=${subscription.id}`,
      })

      await prisma.subscription.update({
        where: { id: subscription.id },
        data: { xenditInvoiceId: invoice.id },
      })

      return c.json({
        invoiceUrl: invoice.invoiceUrl,
        invoiceId: invoice.id,
        subscriptionId: subscription.id,
        amount: planInfo.amount,
        plan,
      })
    } catch (err) {
      console.error('Xendit error:', err)
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: { status: 'FAILED' },
      })
      return c.json({ error: 'Gagal membuat invoice pembayaran. Coba lagi.' }, 500)
    }
  }
)

// POST /billing/checkout/guest — checkout tanpa auth (dari landing page)
billingRoutes.post(
  '/checkout/guest',
  zValidator('json', z.object({
    plan:      z.enum(['basic', 'pro', 'enterprise']),
    name:      z.string().min(2),
    email:     z.string().email(),
    storeName: z.string().min(2),
    phone:     z.string().optional(),
  })),
  async (c) => {
    const { plan, name, email, storeName, phone } = c.req.valid('json')

    const planInfo = PLAN_PRICES[plan]
    const externalId = `GUEST-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

    const appUrl = process.env.APP_URL ?? 'https://pos-bakery-fe.vercel.app'

    // Dev mode — bypass Xendit if secret key not set
    if (!process.env.XENDIT_SECRET_KEY || !process.env.XENDIT_SECRET_KEY.startsWith('xnd_')) {
      const devUrl = `${appUrl}/payment/success?ref=${externalId}&plan=${plan}&email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}&store=${encodeURIComponent(storeName)}`
      console.log(`[DEV MODE] Xendit bypassed. Redirect to: ${devUrl}`)
      return c.json({ invoiceUrl: devUrl, invoiceId: externalId, amount: planInfo.amount, plan })
    }

    try {
      const invoice = await createXenditInvoice({
        externalId,
        amount: planInfo.amount,
        payerEmail: email,
        description: `${planInfo.label} - ${storeName} (30 hari)`,
        successRedirectUrl: `${appUrl}/payment/success?ref=${externalId}&plan=${plan}&email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}&store=${encodeURIComponent(storeName)}`,
        failureRedirectUrl: `${appUrl}/payment/failed`,
      })

      console.log(`[GUEST CHECKOUT] ${storeName} | ${email} | ${plan} | ${invoice.id}`)

      return c.json({
        invoiceUrl: invoice.invoiceUrl,
        invoiceId: invoice.id,
        amount: planInfo.amount,
        plan,
      })
    } catch (err) {
      console.error('Xendit guest checkout error:', err)
      return c.json({ error: 'Gagal membuat invoice. Coba lagi atau hubungi kami.' }, 500)
    }
  }
)

// POST /billing/webhook — Xendit webhook (no auth)
billingRoutes.post('/webhook', async (c) => {
  // Verify webhook token
  const webhookToken = c.req.header('x-callback-token')
  if (webhookToken !== process.env.XENDIT_WEBHOOK_TOKEN) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const body = await c.req.json()
  console.log('[XENDIT WEBHOOK]', JSON.stringify(body))

  // Only handle PAID status
  if (body.status !== 'PAID') return c.json({ received: true })

  const invoiceId = body.id

  // Find subscription by xendit invoice ID
  const subscription = await prisma.subscription.findUnique({
    where: { xenditInvoiceId: invoiceId },
    include: { tenant: true },
  })

  if (!subscription) {
    // Guest checkout — auto-register tenant
    console.log('[XENDIT] Guest payment received, manual activation needed:', invoiceId)
    return c.json({ received: true })
  }

  if (subscription.status === 'PAID') return c.json({ received: true }) // idempotent

  const now = new Date()
  const periodEnd = new Date(now)
  const planDuration = PLAN_PRICES[subscription.plan]?.duration ?? 30
  periodEnd.setDate(periodEnd.getDate() + planDuration)

  // Activate subscription
  await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      status: 'PAID',
      xenditPaymentId: body.payment_id ?? null,
      periodStart: now,
      periodEnd,
      paidAt: now,
    },
  })

  // Update tenant plan
  await prisma.tenant.update({
    where: { id: subscription.tenantId },
    data: {
      plan: subscription.plan,
      trialEndsAt: null, // clear trial
    },
  })

  console.log(`[XENDIT] Subscription activated: ${subscription.tenantId} → ${subscription.plan}`)

  return c.json({ received: true })
})

// GET /billing/status — cek status subscription (requires auth)
billingRoutes.get('/status', authMiddleware, async (c) => {
  const { tenantId } = c.get('auth')

  const [tenant, latestSub] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { plan: true, trialEndsAt: true },
    }),
    prisma.subscription.findFirst({
      where: { tenantId, status: 'PAID' },
      orderBy: { paidAt: 'desc' },
    }),
  ])

  return c.json({
    plan: tenant?.plan ?? 'basic',
    trialEndsAt: tenant?.trialEndsAt,
    subscription: latestSub ? {
      plan: latestSub.plan,
      status: latestSub.status,
      periodEnd: latestSub.periodEnd,
      paidAt: latestSub.paidAt,
    } : null,
  })
})

// GET /billing/history — riwayat pembayaran (requires auth)
billingRoutes.get('/history', authMiddleware, async (c) => {
  const { tenantId } = c.get('auth')

  const subs = await prisma.subscription.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })

  return c.json(subs)
})

// GET /billing/check-expiry — cek subscription yang mau habis (dipanggil oleh cron)
billingRoutes.get('/check-expiry', async (c) => {
  const superKey = c.req.header('x-admin-key')
  if (superKey !== process.env.SUPER_ADMIN_KEY) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const now = new Date()
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  const in3Days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)

  // Cari subscription yang habis dalam 7 hari
  const expiring = await prisma.subscription.findMany({
    where: {
      status: 'PAID',
      periodEnd: { gte: now, lte: in7Days },
    },
    include: {
      tenant: {
        include: {
          users: { where: { role: 'OWNER', isActive: true }, take: 1 },
        },
      },
    },
  })

  let sent = 0
  for (const sub of expiring) {
    const owner = sub.tenant.users[0]
    if (!owner) continue

    const daysLeft = Math.ceil((new Date(sub.periodEnd!).getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

    try {
      await sendSubscriptionExpiryEmail({
        to:         owner.email,
        name:       owner.name,
        tenantName: sub.tenant.name,
        plan:       sub.plan,
        daysLeft,
        renewUrl:   `${process.env.APP_URL}/app/upgrade`,
      })
      sent++
    } catch (e) {
      console.error(`[Billing] Gagal kirim reminder ke ${owner.email}:`, e)
    }
  }

  return c.json({ checked: expiring.length, sent })
})

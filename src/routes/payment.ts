import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../middleware/auth.js'

export const paymentRoutes = new Hono()
paymentRoutes.use('*', authMiddleware)

const MIDTRANS_SERVER_KEY = process.env.MIDTRANS_SERVER_KEY ?? ''
const MIDTRANS_BASE_URL = process.env.MIDTRANS_IS_PRODUCTION === 'true'
  ? 'https://app.midtrans.com/snap/v1'
  : 'https://app.sandbox.midtrans.com/snap/v1'

const IS_SIMULATION = !MIDTRANS_SERVER_KEY

// ─── Create payment token ───────────────────────────────────────────────────

const createTokenSchema = z.object({
  transactionId: z.string().optional(),   // for existing tx
  amount: z.number().int().positive(),
  customerName: z.string().min(1),
  customerEmail: z.string().email().optional(),
  items: z.array(z.object({
    id: z.string(),
    name: z.string(),
    price: z.number().int(),
    quantity: z.number().int(),
  })),
  paymentMethod: z.enum(['QRIS', 'TRANSFER', 'CARD', 'ALL']).default('ALL'),
})

paymentRoutes.post('/token', zValidator('json', createTokenSchema), async (c) => {
  const { tenantId } = c.get('auth')
  const body = c.req.valid('json')

  // Simulation mode — return mock token
  if (IS_SIMULATION) {
    const orderId = `SIM-${tenantId.slice(0, 8)}-${Date.now()}`
    return c.json({
      simulation: true,
      orderId,
      token: `sim_token_${Date.now()}`,
      redirectUrl: null,
      amount: body.amount,
      paymentMethod: body.paymentMethod,
    })
  }

  // Real Midtrans integration
  const orderId = `${tenantId.slice(0, 8)}-${Date.now()}`

  const enabledPayments = {
    QRIS: ['gopay', 'qris'],
    TRANSFER: ['bca_va', 'bni_va', 'bri_va', 'permata_va', 'other_va'],
    CARD: ['credit_card'],
    ALL: ['gopay', 'qris', 'bca_va', 'bni_va', 'bri_va', 'permata_va', 'other_va', 'credit_card'],
  }

  const payload = {
    transaction_details: {
      order_id: orderId,
      gross_amount: body.amount,
    },
    item_details: body.items.map((item) => ({
      id: item.id,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
    })),
    customer_details: {
      first_name: body.customerName,
      email: body.customerEmail ?? 'customer@bakery.com',
    },
    enabled_payments: enabledPayments[body.paymentMethod],
    expiry: {
      unit: 'minutes',
      duration: 30,
    },
  }

  const auth = Buffer.from(`${MIDTRANS_SERVER_KEY}:`).toString('base64')

  try {
    const res = await fetch(`${MIDTRANS_BASE_URL}/transactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify(payload),
    })

    const data = await res.json() as { token: string; redirect_url: string }

    return c.json({
      simulation: false,
      orderId,
      token: data.token,
      redirectUrl: data.redirect_url,
      amount: body.amount,
      paymentMethod: body.paymentMethod,
    })
  } catch (err) {
    return c.json({ error: 'Gagal menghubungi payment gateway' }, 502)
  }
})

// ─── Check payment status ───────────────────────────────────────────────────

paymentRoutes.get('/status/:orderId', async (c) => {
  const orderId = c.req.param('orderId')

  if (orderId.startsWith('SIM-')) {
    // Simulation: auto success after 5 seconds
    return c.json({
      orderId,
      status: 'settlement',
      paymentType: 'qris',
      amount: 0,
      simulation: true,
    })
  }

  if (!MIDTRANS_SERVER_KEY) {
    return c.json({ error: 'Payment gateway tidak dikonfigurasi' }, 503)
  }

  const auth = Buffer.from(`${MIDTRANS_SERVER_KEY}:`).toString('base64')
  const baseUrl = process.env.MIDTRANS_IS_PRODUCTION === 'true'
    ? 'https://api.midtrans.com/v2'
    : 'https://api.sandbox.midtrans.com/v2'

  try {
    const res = await fetch(`${baseUrl}/${orderId}/status`, {
      headers: { Authorization: `Basic ${auth}` },
    })
    const data = await res.json() as {
      transaction_status: string
      payment_type: string
      gross_amount: string
    }

    return c.json({
      orderId,
      status: data.transaction_status,
      paymentType: data.payment_type,
      amount: parseInt(data.gross_amount),
      simulation: false,
    })
  } catch {
    return c.json({ error: 'Gagal cek status pembayaran' }, 502)
  }
})

// ─── Midtrans webhook ───────────────────────────────────────────────────────

paymentRoutes.post('/webhook', async (c) => {
  // Midtrans will POST here when payment status changes
  // In production: verify signature_key before processing
  const body = await c.req.json() as {
    order_id: string
    transaction_status: string
    payment_type: string
    gross_amount: string
  }

  const { order_id, transaction_status } = body

  if (['settlement', 'capture'].includes(transaction_status)) {
    // Payment confirmed — update transaction if needed
    console.log(`Payment confirmed: ${order_id}`)
  } else if (transaction_status === 'expire') {
    console.log(`Payment expired: ${order_id}`)
  } else if (transaction_status === 'cancel') {
    console.log(`Payment cancelled: ${order_id}`)
  }

  return c.json({ status: 'ok' })
})

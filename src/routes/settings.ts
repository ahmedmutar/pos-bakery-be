import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma.js'
import { getPlanLimits, checkLimit, trialDaysLeft, isTrialExpired } from '../lib/planLimits.js'
import { authMiddleware, requireRole } from '../middleware/auth.js'

export const settingsRoutes = new Hono()
settingsRoutes.use('*', authMiddleware)

// ─── TENANT PROFILE ────────────────────────────────────────────────────────

settingsRoutes.get('/profile', async (c) => {
  const { tenantId } = c.get('auth')
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true, slug: true, plan: true, createdAt: true, logoUrl: true },
  })
  if (!tenant) return c.json({ error: 'Tenant tidak ditemukan' }, 404)
  return c.json(tenant)
})

settingsRoutes.patch(
  '/profile',
  requireRole('OWNER'),
  zValidator('json', z.object({ name: z.string().min(2), logoUrl: z.string().url().nullable().optional() })),
  async (c) => {
    const { tenantId } = c.get('auth')
    const { name, logoUrl } = c.req.valid('json')
    const tenant = await prisma.tenant.update({
      where: { id: tenantId },
      data: { name, ...(logoUrl !== undefined && { logoUrl }) },
      select: { id: true, name: true, slug: true, plan: true, logoUrl: true },
    })
    return c.json(tenant)
  }
)


// POST /settings/logo — upload logo as base64, store as data URL or external
// Accepts multipart/form-data with 'logo' file field (max 2MB, image only)
settingsRoutes.post('/logo', requireRole('OWNER'), async (c) => {
  const { tenantId } = c.get('auth')

  const body = await c.req.parseBody()
  const file = body['logo']

  if (!file || typeof file === 'string') {
    return c.json({ error: 'File logo tidak ditemukan' }, 400)
  }

  // Validate file type
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
  if (!allowedTypes.includes(file.type)) {
    return c.json({ error: 'Format file tidak didukung. Gunakan JPG, PNG, WEBP, atau SVG.' }, 400)
  }

  // Validate file size (max 2MB)
  const maxSize = 2 * 1024 * 1024
  if (file.size > maxSize) {
    return c.json({ error: 'Ukuran file maksimal 2MB' }, 400)
  }

  // Convert to base64 data URL — no external storage needed
  const buffer = await file.arrayBuffer()
  const base64 = Buffer.from(buffer).toString('base64')
  const dataUrl = `data:${file.type};base64,${base64}`

  const tenant = await prisma.tenant.update({
    where: { id: tenantId },
    data: { logoUrl: dataUrl },
    select: { id: true, name: true, logoUrl: true },
  })

  return c.json({ logoUrl: tenant.logoUrl })
})

// DELETE /settings/logo — remove logo
settingsRoutes.delete('/logo', requireRole('OWNER'), async (c) => {
  const { tenantId } = c.get('auth')
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { logoUrl: null },
  })
  return c.json({ success: true })
})


// ─── USER AVATAR ───────────────────────────────────────────────────────────

settingsRoutes.post('/avatar', async (c) => {
  const { userId } = c.get('auth')

  const body = await c.req.parseBody()
  const file = body['avatar']

  if (!file || typeof file === 'string') {
    return c.json({ error: 'File avatar tidak ditemukan' }, 400)
  }

  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp']
  if (!allowedTypes.includes(file.type)) {
    return c.json({ error: 'Format tidak didukung. Gunakan JPG, PNG, atau WEBP.' }, 400)
  }

  if (file.size > 2 * 1024 * 1024) {
    return c.json({ error: 'Ukuran file maksimal 2MB' }, 400)
  }

  const buffer = await file.arrayBuffer()
  const base64 = Buffer.from(buffer).toString('base64')
  const avatarUrl = `data:${file.type};base64,${base64}`

  const user = await prisma.user.update({
    where: { id: userId },
    data: { avatarUrl },
    select: { id: true, avatarUrl: true },
  })

  return c.json({ avatarUrl: user.avatarUrl })
})

settingsRoutes.delete('/avatar', async (c) => {
  const { userId } = c.get('auth')
  await prisma.user.update({
    where: { id: userId },
    data: { avatarUrl: null },
  })
  return c.json({ success: true })
})

// ─── USERS ─────────────────────────────────────────────────────────────────

settingsRoutes.get('/users', requireRole('OWNER'), async (c) => {
  const { tenantId } = c.get('auth')
  const users = await prisma.user.findMany({
    where: { tenantId },
    select: {
      id: true, name: true, email: true,
      role: true, isActive: true, createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  })
  return c.json(users)
})

settingsRoutes.post(
  '/users',
  requireRole('OWNER'),
  zValidator('json', z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(6),
    role: z.enum(['OWNER', 'CASHIER', 'PRODUCTION']),
  })),
  async (c) => {
    const { tenantId } = c.get('auth')
    const body = c.req.valid('json')

    const existing = await prisma.user.findFirst({
      where: { tenantId, email: body.email },
    })
    if (existing) return c.json({ error: 'Email sudah digunakan' }, 409)

    const passwordHash = await bcrypt.hash(body.password, 12)
    const user = await prisma.user.create({
      data: {
        tenantId,
        name: body.name,
        email: body.email,
        passwordHash,
        role: body.role,
      },
      select: {
        id: true, name: true, email: true,
        role: true, isActive: true, createdAt: true,
      },
    })
    return c.json(user, 201)
  }
)

settingsRoutes.patch(
  '/users/:id',
  requireRole('OWNER'),
  zValidator('json', z.object({
    name: z.string().min(2).optional(),
    role: z.enum(['OWNER', 'CASHIER', 'PRODUCTION']).optional(),
    isActive: z.boolean().optional(),
  })),
  async (c) => {
    const { tenantId } = c.get('auth')
    const id = c.req.param('id')
    const existing = await prisma.user.findFirst({ where: { id, tenantId } })
    if (!existing) return c.json({ error: 'User tidak ditemukan' }, 404)

    const user = await prisma.user.update({
      where: { id },
      data: c.req.valid('json'),
      select: {
        id: true, name: true, email: true,
        role: true, isActive: true, createdAt: true,
      },
    })
    return c.json(user)
  }
)


// POST /settings/users/:id/reset-password — Owner reset password staff
settingsRoutes.post(
  '/users/:id/reset-password',
  requireRole('OWNER'),
  zValidator('json', z.object({ newPassword: z.string().min(8) })),
  async (c) => {
    const { tenantId } = c.get('auth')
    const id = c.req.param('id')
    const { newPassword } = c.req.valid('json')

    const existing = await prisma.user.findFirst({ where: { id, tenantId } })
    if (!existing) return c.json({ error: 'User tidak ditemukan' }, 404)

    const passwordHash = await bcrypt.hash(newPassword, 12)
    await prisma.user.update({ where: { id }, data: { passwordHash } })

    return c.json({ success: true, message: 'Password berhasil direset.' })
  }
)

// ─── CHANGE PASSWORD ────────────────────────────────────────────────────────

settingsRoutes.patch(
  '/change-password',
  zValidator('json', z.object({
    currentPassword: z.string(),
    newPassword: z.string().min(6),
    otp: z.string().length(6).optional(),
  })),
  async (c) => {
    const { userId, tenantId } = c.get('auth')
    const { currentPassword, newPassword, otp } = c.req.valid('json')

    const user = await prisma.user.findFirst({ where: { id: userId, tenantId } })
    if (!user) return c.json({ error: 'User tidak ditemukan' }, 404)

    // Verify current password
    const valid = await bcrypt.compare(currentPassword, user.passwordHash)
    if (!valid) return c.json({ error: 'Kata sandi saat ini salah' }, 400)

    // Verify OTP if SMTP is configured (optional in dev mode)
    if (process.env.SMTP_HOST && otp) {
      const otpRecord = await prisma.emailOTP.findFirst({
        where: { email: user.email, otp, usedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
      })
      if (!otpRecord) return c.json({ error: 'Kode OTP tidak valid atau sudah kadaluarsa.' }, 400)
      await prisma.emailOTP.update({ where: { id: otpRecord.id }, data: { usedAt: new Date() } })
    }

    const passwordHash = await bcrypt.hash(newPassword, 12)
    await prisma.user.update({ where: { id: userId }, data: { passwordHash } })

    return c.json({ message: 'Kata sandi berhasil diubah' })
  }
)

// ─── OUTLETS ───────────────────────────────────────────────────────────────

settingsRoutes.get('/outlets', async (c) => {
  const { tenantId } = c.get('auth')
  const outlets = await prisma.outlet.findMany({
    where: { tenantId },
    orderBy: { name: 'asc' },
  })
  return c.json(outlets)
})

settingsRoutes.post(
  '/outlets',
  requireRole('OWNER'),
  zValidator('json', z.object({
    name: z.string().min(2),
    address: z.string().optional(),
  })),
  async (c) => {
    const { tenantId } = c.get('auth')
    const outlet = await prisma.outlet.create({
      data: { tenantId, ...c.req.valid('json') },
    })
    return c.json(outlet, 201)
  }
)

settingsRoutes.patch(
  '/outlets/:id',
  requireRole('OWNER'),
  zValidator('json', z.object({
    name: z.string().min(2).optional(),
    address: z.string().optional(),
    isActive: z.boolean().optional(),
  })),
  async (c) => {
    const { tenantId } = c.get('auth')
    const id = c.req.param('id')
    const existing = await prisma.outlet.findFirst({ where: { id, tenantId } })
    if (!existing) return c.json({ error: 'Outlet tidak ditemukan' }, 404)
    const outlet = await prisma.outlet.update({
      where: { id },
      data: c.req.valid('json'),
    })
    return c.json(outlet)
  }
)


// ─── PLAN & TRIAL ────────────────────────────────────────────────────────────
settingsRoutes.get('/plan', requireRole('OWNER'), async (c) => {
  const { tenantId } = c.get('auth')
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { plan: true, trialEndsAt: true },
  })
  if (!tenant) return c.json({ error: 'Tenant tidak ditemukan' }, 404)

  const limits = getPlanLimits(tenant.plan)
  const daysLeft = trialDaysLeft(tenant.trialEndsAt ?? null)
  const expired = isTrialExpired(tenant.trialEndsAt ?? null)

  return c.json({
    plan: tenant.plan,
    limits,
    trial: {
      isOnTrial: !!tenant.trialEndsAt && !expired,
      trialEndsAt: tenant.trialEndsAt,
      daysLeft,
      expired,
    },
  })
})

// ─── BANK INFO ───────────────────────────────────────────────────────────────
settingsRoutes.get('/bank', async (c) => {
  const { tenantId } = c.get('auth')
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { bankName: true, bankAccount: true, bankHolder: true },
  })
  return c.json(tenant ?? {})
})

settingsRoutes.patch(
  '/bank',
  requireRole('OWNER'),
  zValidator('json', z.object({
    bankName:    z.string().max(50).optional(),
    bankAccount: z.string().max(30).optional(),
    bankHolder:  z.string().max(100).optional(),
  })),
  async (c) => {
    const { tenantId } = c.get('auth')
    const data = c.req.valid('json')
    const tenant = await prisma.tenant.update({
      where: { id: tenantId },
      data,
      select: { bankName: true, bankAccount: true, bankHolder: true },
    })
    return c.json(tenant)
  }
)

// ─── QRIS ────────────────────────────────────────────────────────────────────
settingsRoutes.get('/qris', async (c) => {
  const { tenantId } = c.get('auth')
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { qrisImageUrl: true },
  })
  return c.json({ qrisImageUrl: tenant?.qrisImageUrl ?? null })
})

settingsRoutes.post('/qris', requireRole('OWNER'), async (c) => {
  const { tenantId } = c.get('auth')
  const { imageBase64 } = await c.req.json()
  if (!imageBase64) return c.json({ error: 'imageBase64 wajib diisi' }, 400)
  if (imageBase64.length > 500_000) return c.json({ error: 'Gambar terlalu besar (maks 500KB)' }, 400)
  const tenant = await prisma.tenant.update({
    where: { id: tenantId },
    data: { qrisImageUrl: imageBase64 },
    select: { qrisImageUrl: true },
  })
  return c.json(tenant)
})

settingsRoutes.delete('/qris', requireRole('OWNER'), async (c) => {
  const { tenantId } = c.get('auth')
  await prisma.tenant.update({ where: { id: tenantId }, data: { qrisImageUrl: null } })
  return c.json({ success: true })
})

// ─── SUPER ADMIN — platform-wide stats ─────────────────────────────────────
// Protected by SUPER_ADMIN_KEY env var

settingsRoutes.get('/admin/tenants', async (c) => {
  const key = c.req.header('X-Admin-Key')
  if (key !== process.env.SUPER_ADMIN_KEY || !process.env.SUPER_ADMIN_KEY) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const tenants = await prisma.tenant.findMany({
    include: {
      _count: {
        select: { users: true, products: true, transactions: true },
      },
      outlets: { select: { id: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  const enriched = await Promise.all(tenants.map(async (t) => {
    const today = new Date()
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)

    const monthlyRevenue = await prisma.transaction.aggregate({
      where: { tenantId: t.id, createdAt: { gte: monthStart } },
      _sum: { total: true },
    })

    const lastActivity = await prisma.transaction.findFirst({
      where: { tenantId: t.id },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    })

    return {
      id: t.id,
      name: t.name,
      slug: t.slug,
      plan: t.plan,
      isActive: t.isActive,
      createdAt: t.createdAt,
      userCount: t._count.users,
      productCount: t._count.products,
      transactionCount: t._count.transactions,
      outletCount: t.outlets.length,
      monthlyRevenue: monthlyRevenue._sum.total ?? 0,
      lastActivityAt: lastActivity?.createdAt ?? null,
    }
  }))

  return c.json(enriched)
})

settingsRoutes.patch('/admin/tenants/:id', async (c) => {
  const key = c.req.header('X-Admin-Key')
  if (key !== process.env.SUPER_ADMIN_KEY || !process.env.SUPER_ADMIN_KEY) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const id = c.req.param('id')
  const body = await c.req.json() as { isActive?: boolean; plan?: string }

  const tenant = await prisma.tenant.update({
    where: { id },
    data: {
      ...(body.isActive !== undefined && { isActive: body.isActive }),
      ...(body.plan && { plan: body.plan }),
    },
  })

  return c.json(tenant)
})

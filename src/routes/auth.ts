import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma.js'
import { signToken } from '../lib/jwt.js'
import { authMiddleware } from '../middleware/auth.js'
import { blacklistToken } from '../lib/tokenBlacklist.js'
import { sendWelcomeEmail } from '../lib/email.js'
import { audit } from '../lib/auditLog.js'
import { loginRateLimit } from '../middleware/security.js'

export const authRoutes = new Hono()

// ─── Register tenant + owner ────────────────────────────────────────────────
const registerSchema = z.object({
  tenantName: z.string().min(2),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/, 'Slug hanya boleh huruf kecil, angka, dan tanda -'),
  ownerName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
})

authRoutes.post('/register', loginRateLimit, zValidator('json', registerSchema), async (c) => {
  const { tenantName, slug, ownerName, email, password } = c.req.valid('json')

  const existingSlug = await prisma.tenant.findUnique({ where: { slug } })
  if (existingSlug) {
    return c.json({ error: 'Slug sudah digunakan' }, 409)
  }

  const passwordHash = await bcrypt.hash(password, 12)

  const tenant = await prisma.tenant.create({
    data: {
      name: tenantName,
      slug,
      users: {
        create: {
          name: ownerName,
          email,
          passwordHash,
          role: 'OWNER',
        },
      },
      outlets: {
        create: {
          name: `${tenantName} - Pusat`,
        },
      },
    },
    include: {
      users: true,
    },
  })

  const owner = tenant.users[0]
  const token = signToken({ userId: owner.id, tenantId: tenant.id, role: owner.role })

  // Send welcome email (non-blocking)
  sendWelcomeEmail({
    to: owner.email,
    ownerName: owner.name,
    tenantName: tenant.name,
    plan: tenant.plan,
  }).catch(() => {}) // ignore email errors

  return c.json({
    token,
    user: {
      id: owner.id,
      name: owner.name,
      email: owner.email,
      role: owner.role,
      tenantId: tenant.id,
      tenantName: tenant.name,
    },
  }, 201)
})

// ─── Login ─────────────────────────────────────────────────────────────────
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
})

authRoutes.post('/login', loginRateLimit, zValidator('json', loginSchema), async (c) => {
  const { email, password } = c.req.valid('json')

  // Find user — email is unique per tenant so we search globally then validate
  const user = await prisma.user.findFirst({
    where: { email, isActive: true },
    include: { tenant: true },
  })

  if (!user) {
    return c.json({ error: 'Email atau kata sandi salah' }, 401)
  }

  const valid = await bcrypt.compare(password, user.passwordHash)
  if (!valid) {
    return c.json({ error: 'Email atau kata sandi salah' }, 401)
  }

  if (!user.tenant.isActive) {
    return c.json({ error: 'Akun toko tidak aktif' }, 403)
  }

  const token = signToken({ userId: user.id, tenantId: user.tenantId, role: user.role })
  await audit({ tenantId: user.tenantId, userId: user.id, action: 'USER_LOGIN' })

  return c.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      tenantName: user.tenant.name,
    },
  })
})

// ─── Me ────────────────────────────────────────────────────────────────────
authRoutes.get('/me', authMiddleware, async (c) => {
  const { userId, tenantId } = c.get('auth')

  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId },
    include: { tenant: { select: { name: true, plan: true, logoUrl: true } } },
    // avatarUrl is on user directly
  })

  if (!user) return c.json({ error: 'User tidak ditemukan' }, 404)

  return c.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId,
    tenantName: user.tenant.name,
    plan: user.tenant.plan,
    logoUrl: user.tenant.logoUrl ?? null,
    avatarUrl: user.avatarUrl ?? null,
  })
})

// ─── Logout — revoke token ──────────────────────────────────────────────────
authRoutes.post('/logout', authMiddleware, async (c) => {
  const authHeader = c.req.header('Authorization') ?? ''
  const token = authHeader.slice(7)
  blacklistToken(token)
  const { userId, tenantId } = c.get('auth')
  await audit({ tenantId, userId, action: 'USER_LOGOUT' })
  return c.json({ message: 'Berhasil logout' })
})

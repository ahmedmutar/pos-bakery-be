import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma.js'
import { signToken } from '../lib/jwt.js'
import { authMiddleware } from '../middleware/auth.js'
import { blacklistToken } from '../lib/tokenBlacklist.js'
import { sendWelcomeEmail, sendAdminNewRegistrationEmail, sendOTPEmail, sendPasswordResetEmail } from '../lib/email.js'
import { audit } from '../lib/auditLog.js'
import { loginRateLimit, otpRateLimit } from '../middleware/security.js'

export const authRoutes = new Hono()


// ─── OTP helpers ────────────────────────────────────────────────────────────
function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

// POST /auth/send-otp
authRoutes.post('/send-otp',
  otpRateLimit,
  zValidator('json', z.object({ email: z.string().email(), name: z.string().min(1) })),
  async (c) => {
    const { email, name } = c.req.valid('json')

    // Cek email sudah terdaftar
    const existing = await prisma.user.findFirst({ where: { email } })
    if (existing) {
      return c.json({ error: 'Email sudah terdaftar. Silakan login.' }, 409)
    }

    // Invalidate OTP lama
    await prisma.emailOTP.updateMany({
      where: { email, usedAt: null },
      data: { usedAt: new Date() },
    })

    const otp = generateOTP()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 menit

    await prisma.emailOTP.create({ data: { email, otp, expiresAt } })

    // Kirim email
    if (process.env.SMTP_HOST) {
      try {
        await sendOTPEmail({ to: email, otp, name })
      } catch (e) {
        console.error('Failed to send OTP email:', e)
        return c.json({ error: 'Gagal mengirim OTP. Periksa email Anda dan coba lagi.' }, 500)
      }
    } else {
      // Dev mode — log ke console
      console.log(`[OTP DEV] ${email}: ${otp}`)
    }

    return c.json({ message: 'OTP berhasil dikirim.' })
  }
)

// POST /auth/verify-otp (cek saja, tanpa register)
authRoutes.post('/verify-otp',
  otpRateLimit,
  zValidator('json', z.object({ email: z.string().email(), otp: z.string().length(6) })),
  async (c) => {
    const { email, otp } = c.req.valid('json')
    const record = await prisma.emailOTP.findFirst({
      where: { email, otp, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    })
    if (!record) {
      return c.json({ error: 'Kode OTP tidak valid atau sudah kadaluarsa.' }, 400)
    }
    return c.json({ valid: true })
  }
)

// ─── Register tenant + owner ────────────────────────────────────────────────
const registerSchema = z.object({
  tenantName: z.string().min(2).max(100),
  slug: z.string().min(2).max(60).regex(/^[a-z0-9-]+$/, 'Slug hanya boleh huruf kecil, angka, dan tanda -'),
  ownerName: z.string().min(2).max(100),
  email: z.string().email().max(255),
  password: z.string()
  .min(8, 'Password minimal 8 karakter')
  .regex(/[A-Z]/, 'Password harus mengandung minimal 1 huruf besar')
  .regex(/[0-9]/, 'Password harus mengandung minimal 1 angka')
  .regex(/[^A-Za-z0-9]/, 'Password harus mengandung minimal 1 simbol'),
  otp: z.string().length(6).optional(),
})

authRoutes.post('/register', loginRateLimit, zValidator('json', registerSchema), async (c) => {
  const { tenantName, slug, ownerName, email, password, otp } = c.req.valid('json')

  // Verifikasi OTP jika dikirim
  if (otp) {
    const otpRecord = await prisma.emailOTP.findFirst({
      where: { email, otp, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    })
    if (!otpRecord) {
      return c.json({ error: 'Kode OTP tidak valid atau sudah kadaluarsa.' }, 400)
    }
    await prisma.emailOTP.update({ where: { id: otpRecord.id }, data: { usedAt: new Date() } })
  }

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
  // Notify admin of new registration
  sendAdminNewRegistrationEmail({
    ownerName,
    tenantName,
    email,
    plan: 'basic (trial)',
    registeredAt: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
  }).catch(() => {}) // fire and forget

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
  email: z.string().email().max(255),
  password: z.string().min(1).max(128),
})

const loginVerifySchema = z.object({
  email: z.string().email().max(255),
  otp:   z.string().length(6),
})

// ─── Step 1: Verifikasi email+password → kirim OTP ──────────────────────────
authRoutes.post('/login', loginRateLimit, zValidator('json', loginSchema), async (c) => {
  const { email, password } = c.req.valid('json')

  const user = await prisma.user.findFirst({
    where: { email, isActive: true },
    include: { tenant: true },
  })

  // Generic error — jangan beri tahu apakah email terdaftar atau tidak
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

  // Invalidate OTP lama
  await prisma.emailOTP.updateMany({
    where: { email, usedAt: null },
    data:  { usedAt: new Date() },
  })

  const otp       = generateOTP()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 menit
  await prisma.emailOTP.create({ data: { email, otp, expiresAt } })

  // Kirim OTP email (non-blocking di dev, blocking di production agar error ketahuan)
  try {
    await sendOTPEmail({ to: email, otp, name: user.name })
  } catch (e) {
    console.error('[Login OTP] Gagal kirim email:', e)
    // Tetap lanjut agar dev bisa lihat OTP di log
  }

  return c.json({
    step:    'otp',
    message: 'Kode OTP telah dikirim ke email Anda.',
    email,   // kembalikan email agar FE bisa pakai untuk step 2
  })
})

// ─── Step 2: Verifikasi OTP → return token ──────────────────────────────────
authRoutes.post('/login/verify', loginRateLimit, otpRateLimit, zValidator('json', loginVerifySchema), async (c) => {
  const { email, otp } = c.req.valid('json')

  const otpRecord = await prisma.emailOTP.findFirst({
    where: { email, otp, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  })

  if (!otpRecord) {
    return c.json({ error: 'Kode OTP tidak valid atau sudah kadaluarsa.' }, 400)
  }

  // Mark OTP as used
  await prisma.emailOTP.update({ where: { id: otpRecord.id }, data: { usedAt: new Date() } })

  const user = await prisma.user.findFirst({
    where: { email, isActive: true },
    include: { tenant: true },
  })

  if (!user || !user.tenant.isActive) {
    return c.json({ error: 'Akun tidak ditemukan atau tidak aktif.' }, 401)
  }

  const token = signToken({ userId: user.id, tenantId: user.tenantId, role: user.role })
  await audit({ tenantId: user.tenantId, userId: user.id, action: 'USER_LOGIN' })

  return c.json({
    token,
    user: {
      id:         user.id,
      name:       user.name,
      email:      user.email,
      role:       user.role,
      tenantId:   user.tenantId,
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


// POST /auth/send-otp-auth — kirim OTP untuk user yang sudah login (ganti password)
authRoutes.post('/send-otp-auth', authMiddleware, async (c) => {
  const { userId } = c.get('auth')
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } })
  if (!user) return c.json({ error: 'User tidak ditemukan' }, 404)

  // Invalidate OTP lama
  await prisma.emailOTP.updateMany({
    where: { email: user.email, usedAt: null },
    data: { usedAt: new Date() },
  })

  const otp = generateOTP()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
  await prisma.emailOTP.create({ data: { email: user.email, otp, expiresAt } })

  if (process.env.SMTP_HOST) {
    try {
      await sendOTPEmail({ to: user.email, otp, name: user.name })
    } catch {
      console.log(`[OTP DEV] ${user.email}: ${otp}`)
    }
  } else {
    console.log(`[OTP DEV] ${user.email}: ${otp}`)
  }

  return c.json({ message: 'OTP berhasil dikirim.' })
})

// POST /auth/forgot-password — request reset token
authRoutes.post('/forgot-password',
  otpRateLimit,
  zValidator('json', z.object({ email: z.string().email() })),
  async (c) => {
    const { email } = c.req.valid('json')

    const user = await prisma.user.findFirst({
      where: { email, isActive: true },
      include: { tenant: { select: { name: true } } },
    })

    const GENERIC_MSG = { message: 'Jika email terdaftar, instruksi reset akan dikirim.' }
    if (!user) return c.json(GENERIC_MSG)

    // Invalidate old tokens
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    })

    // Create new token (expires in 1 hour)
    const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000)

    await prisma.passwordResetToken.create({
      data: { userId: user.id, token, expiresAt },
    })

    // Try send email if SMTP configured
    const resetUrl = `${process.env.APP_URL ?? 'http://localhost:5173'}/reset-password?token=${token}`

    if (process.env.SMTP_HOST) {
      try {
        await sendPasswordResetEmail({ to: email, name: user.name, resetUrl })
      } catch (e) {
        console.error('Failed to send reset email:', e)
      }
    } else {
      // Development: log token to console
      console.log(`[RESET TOKEN] ${email}: ${resetUrl}`)
    }

    return c.json(GENERIC_MSG)
  }
)

// POST /auth/reset-password — use token to set new password
authRoutes.post('/reset-password',
  zValidator('json', z.object({
    token:       z.string().min(10),
    newPassword: z.string().min(8),
  })),
  async (c) => {
    const { token, newPassword } = c.req.valid('json')

    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token },
      include: { user: true },
    })

    if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
      return c.json({ error: 'Token tidak valid atau sudah kadaluarsa.' }, 400)
    }

    const passwordHash = await bcrypt.hash(newPassword, 12)

    await prisma.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash },
    })

    await prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    })

    return c.json({ message: 'Password berhasil direset. Silakan login.' })
  }
)

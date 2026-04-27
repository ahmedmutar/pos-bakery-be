import type { Context, Next } from 'hono'
import { prisma } from '../lib/prisma.js'
import { isTrialExpired } from '../lib/planLimits.js'

// Endpoints that are always accessible even if trial expired
const ALWAYS_ALLOWED = [
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/me',
  '/api/auth/forgot-password',
  '/api/auth/send-otp',
  '/api/auth/verify-otp',
  '/api/auth/reset-password',
  '/api/billing/webhook',
  '/api/billing/plans',
  '/api/billing/checkout/guest',
]

export async function trialGuard(c: Context, next: Next) {
  // Skip for non-API or always-allowed routes
  const path = c.req.path
  if (ALWAYS_ALLOWED.some((p) => path.startsWith(p))) {
    return next()
  }

  const auth = c.get('auth')
  if (!auth?.tenantId) return next()

  const tenant = await prisma.tenant.findUnique({
    where: { id: auth.tenantId },
    select: { plan: true, trialEndsAt: true, isActive: true },
  })

  if (!tenant) return next()

  // Block inactive tenants
  if (!tenant.isActive) {
    return c.json({ error: 'Akun Anda telah dinonaktifkan. Hubungi support.', code: 'ACCOUNT_INACTIVE' }, 403)
  }

  // Check trial expiry — only for tenants still on trial (trialEndsAt is set)
  if (tenant.trialEndsAt && isTrialExpired(tenant.trialEndsAt)) {
    return c.json({
      error: 'Trial 14 hari Anda telah berakhir. Upgrade paket untuk melanjutkan.',
      code: 'TRIAL_EXPIRED',
      upgradeUrl: `${process.env.APP_URL ?? 'https://rotipos.com'}/pricing`,
    }, 403)
  }

  return next()
}

import { createMiddleware } from 'hono/factory'

// Simple in-memory rate limiter
// For production, use Redis-backed store
const loginAttempts = new Map<string, { count: number; resetAt: number }>()

export const loginRateLimit = createMiddleware(async (c, next) => {
  const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? 'unknown'
  const now = Date.now()
  const windowMs = 15 * 60 * 1000 // 15 minutes
  const maxAttempts = 10

  const entry = loginAttempts.get(ip)

  if (entry) {
    if (now > entry.resetAt) {
      loginAttempts.delete(ip)
    } else if (entry.count >= maxAttempts) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
      return c.json(
        { error: `Terlalu banyak percobaan login. Coba lagi dalam ${Math.ceil(retryAfter / 60)} menit.` },
        429
      )
    }
  }

  await next()

  // Only count failed logins (401 responses)
  if (c.res.status === 401) {
    const current = loginAttempts.get(ip)
    if (!current || now > current.resetAt) {
      loginAttempts.set(ip, { count: 1, resetAt: now + windowMs })
    } else {
      current.count++
    }
  } else if (c.res.status === 200) {
    // Reset on successful login
    loginAttempts.delete(ip)
  }
})

// Global rate limit per IP (all endpoints)
const requestCounts = new Map<string, { count: number; resetAt: number }>()

export const globalRateLimit = createMiddleware(async (c, next) => {
  const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? 'unknown'
  const now = Date.now()
  const windowMs = 60 * 1000 // 1 minute
  const maxRequests = 300

  const entry = requestCounts.get(ip)

  if (entry) {
    if (now > entry.resetAt) {
      requestCounts.delete(ip)
    } else if (entry.count >= maxRequests) {
      return c.json({ error: 'Terlalu banyak permintaan. Coba lagi nanti.' }, 429)
    } else {
      entry.count++
    }
  } else {
    requestCounts.set(ip, { count: 1, resetAt: now + windowMs })
  }

  await next()
})

// Security headers
export const securityHeaders = createMiddleware(async (c, next) => {
  await next()
  c.res.headers.set('X-Content-Type-Options', 'nosniff')
  c.res.headers.set('X-Frame-Options', 'DENY')
  c.res.headers.set('X-XSS-Protection', '1; mode=block')
  c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  c.res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
})

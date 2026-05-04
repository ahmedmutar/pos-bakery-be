import { createMiddleware } from 'hono/factory'

// ─── In-memory rate store ─────────────────────────────────────────────────────
const store = new Map<string, { count: number; resetAt: number }>()

function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  const entry = store.get(key)
  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (entry.count >= max) return false
  entry.count++
  return true
}

// Cleanup stale entries every 10 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, val] of store.entries()) {
    if (now > val.resetAt) store.delete(key)
  }
}, 10 * 60 * 1000)

// ─── Login rate limit — 10 attempts / 15 min per IP ──────────────────────────
const loginAttempts = new Map<string, { count: number; resetAt: number }>()

export const loginRateLimit = createMiddleware(async (c, next) => {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0].trim()
           ?? c.req.header('x-real-ip')
           ?? 'unknown'
  const now = Date.now()
  const windowMs = 15 * 60 * 1000
  const maxAttempts = 10

  const entry = loginAttempts.get(ip)
  if (entry && now <= entry.resetAt && entry.count >= maxAttempts) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 60000)
    return c.json({ error: `Terlalu banyak percobaan. Coba lagi dalam ${retryAfter} menit.` }, 429)
  }

  await next()

  if (c.res.status === 401) {
    const cur = loginAttempts.get(ip)
    if (!cur || now > cur.resetAt) {
      loginAttempts.set(ip, { count: 1, resetAt: now + windowMs })
    } else {
      cur.count++
    }
  } else if (c.res.status === 200) {
    loginAttempts.delete(ip)
  }
})

// ─── OTP rate limit — 5 requests / 10 min per IP ─────────────────────────────
export const otpRateLimit = createMiddleware(async (c, next) => {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0].trim()
           ?? c.req.header('x-real-ip')
           ?? 'unknown'

  if (!rateLimit(`otp:${ip}`, 5, 10 * 60 * 1000)) {
    return c.json({ error: 'Terlalu banyak permintaan OTP. Tunggu 10 menit.' }, 429)
  }
  await next()
})

// ─── Global rate limit — 300 req / min per IP ────────────────────────────────
export const globalRateLimit = createMiddleware(async (c, next) => {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0].trim()
           ?? c.req.header('x-real-ip')
           ?? 'unknown'

  if (!rateLimit(`global:${ip}`, 300, 60 * 1000)) {
    return c.json({ error: 'Terlalu banyak permintaan. Coba lagi nanti.' }, 429)
  }
  await next()
})

// ─── Security headers ─────────────────────────────────────────────────────────
export const securityHeaders = createMiddleware(async (c, next) => {
  await next()
  const h = c.res.headers
  h.set('X-Content-Type-Options',   'nosniff')
  h.set('X-Frame-Options',           'DENY')
  h.set('X-XSS-Protection',          '1; mode=block')
  h.set('Referrer-Policy',            'strict-origin-when-cross-origin')
  h.set('Permissions-Policy',         'camera=(), microphone=(), geolocation=()')
  h.set('Strict-Transport-Security',  'max-age=31536000; includeSubDomains')
  h.set('Content-Security-Policy',    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'")
  h.set('X-Permitted-Cross-Domain-Policies', 'none')
  h.set('Cross-Origin-Opener-Policy', 'same-origin')

  // Remove server fingerprint headers
  h.delete('X-Powered-By')
  h.delete('Server')
})

// ─── Input sanitizer — strip XSS dari string fields ──────────────────────────
export const sanitizeInput = createMiddleware(async (c, next) => {
  if (c.req.header('content-type')?.includes('application/json')) {
    try {
      const body = await c.req.json()
      const sanitized = deepSanitize(body)
      // Re-inject sanitized body
      Object.defineProperty(c.req.raw, '_sanitizedBody', { value: sanitized })
    } catch {
      // Not JSON or already consumed
    }
  }
  await next()
})

function deepSanitize(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return obj
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, '')
      .trim()
  }
  if (Array.isArray(obj)) return obj.map(deepSanitize)
  if (obj && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, deepSanitize(v)])
    )
  }
  return obj
}

import { createMiddleware } from 'hono/factory'
import { verifyToken, type TokenPayload } from '../lib/jwt.js'
import { isBlacklisted } from '../lib/tokenBlacklist.js'

// Extend Hono context with auth variables
declare module 'hono' {
  interface ContextVariableMap {
    auth: TokenPayload
  }
}

export const authMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header('Authorization')

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const token = authHeader.slice(7)

  if (isBlacklisted(token)) {
    return c.json({ error: 'Token sudah tidak valid. Silakan login ulang.' }, 401)
  }

  try {
    const payload = verifyToken(token)
    c.set('auth', payload)
    await next()
  } catch {
    return c.json({ error: 'Token tidak valid atau sudah kadaluarsa' }, 401)
  }
})

// Role guard — use after authMiddleware
export function requireRole(...roles: string[]) {
  return createMiddleware(async (c, next) => {
    const auth = c.get('auth')
    if (!roles.includes(auth.role)) {
      return c.json({ error: 'Akses ditolak' }, 403)
    }
    await next()
  })
}

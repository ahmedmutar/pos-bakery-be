import jwt from 'jsonwebtoken'

const SECRET     = process.env.JWT_SECRET
const EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '7d'
const ALGORITHM  = 'HS256' as const

if (!SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set.')
  if (process.env.NODE_ENV === 'production') process.exit(1)
}

export interface TokenPayload {
  userId:   string
  tenantId: string
  role:     string
  iat?:     number
  exp?:     number
}

export function signToken(payload: Omit<TokenPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, SECRET!, {
    expiresIn: EXPIRES_IN,
    algorithm: ALGORITHM,
  } as jwt.SignOptions)
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, SECRET!, {
    algorithms: [ALGORITHM],
  }) as TokenPayload
}

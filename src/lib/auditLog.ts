import { prisma } from './prisma.js'

type AuditAction =
  | 'TRANSACTION_VOID'
  | 'SHIFT_FORCE_CLOSE'
  | 'USER_LOGIN'
  | 'USER_LOGOUT'
  | 'USER_CREATED'
  | 'USER_DEACTIVATED'
  | 'PRICE_OVERRIDE_SET'

export async function audit(params: {
  tenantId: string
  userId: string
  action: AuditAction
  targetId?: string
  meta?: Record<string, unknown>
}) {
  // Log to console in dev — in production, persist to DB or external service
  console.log(`[AUDIT] ${new Date().toISOString()} | tenant:${params.tenantId} | user:${params.userId} | ${params.action}${params.targetId ? ` | target:${params.targetId}` : ''} | ${JSON.stringify(params.meta ?? {})}`)
}

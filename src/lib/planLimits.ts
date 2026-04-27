export interface PlanLimits {
  maxOutlets: number     // -1 = unlimited
  maxUsers: number
  maxProducts: number
  hasReports: boolean
  hasForecast: boolean
  hasExcelImport: boolean
  hasApiAccess: boolean
  hasWhiteLabel: boolean
}

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  basic: {
    maxOutlets: 1,
    maxUsers: 3,
    maxProducts: 50,
    hasReports: true,
    hasForecast: false,
    hasExcelImport: false,
    hasApiAccess: false,
    hasWhiteLabel: false,
  },
  pro: {
    maxOutlets: 5,
    maxUsers: 10,
    maxProducts: -1,
    hasReports: true,
    hasForecast: true,
    hasExcelImport: true,
    hasApiAccess: false,
    hasWhiteLabel: false,
  },
  enterprise: {
    maxOutlets: -1,
    maxUsers: -1,
    maxProducts: -1,
    hasReports: true,
    hasForecast: true,
    hasExcelImport: true,
    hasApiAccess: true,
    hasWhiteLabel: true,
  },
}

export function getPlanLimits(plan: string): PlanLimits {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.basic
}

export function checkLimit(current: number, max: number): boolean {
  if (max === -1) return true
  return current < max
}

export function isTrialExpired(trialEndsAt: Date | null): boolean {
  if (!trialEndsAt) return false
  return new Date() > new Date(trialEndsAt)
}

export function trialDaysLeft(trialEndsAt: Date | null): number {
  if (!trialEndsAt) return 0
  const diff = new Date(trialEndsAt).getTime() - Date.now()
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
}

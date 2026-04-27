import type { Context, Next } from 'hono'
import { prisma } from '../lib/prisma.js'
import { getPlanLimits } from '../lib/planLimits.js'
import type { PlanLimits } from '../lib/planLimits.js'

type FeatureKey = keyof Pick<PlanLimits, 'hasForecast' | 'hasExcelImport' | 'hasApiAccess' | 'hasWhiteLabel' | 'hasReports'>

const FEATURE_NAMES: Record<FeatureKey, string> = {
  hasForecast: 'Forecast Produksi',
  hasExcelImport: 'Import Excel',
  hasApiAccess: 'API Access',
  hasWhiteLabel: 'White Label',
  hasReports: 'Laporan',
}

export function requireFeature(feature: FeatureKey) {
  return async (c: Context, next: Next) => {
    const auth = c.get('auth')
    if (!auth?.tenantId) return next()

    const tenant = await prisma.tenant.findUnique({
      where: { id: auth.tenantId },
      select: { plan: true },
    })

    const limits = getPlanLimits(tenant?.plan ?? 'basic')

    if (!limits[feature]) {
      const featureName = FEATURE_NAMES[feature]
      const plan = tenant?.plan ?? 'basic'
      return c.json({
        error: `Fitur ${featureName} tidak tersedia di paket ${plan}. Upgrade ke Pro atau Enterprise untuk mengakses fitur ini.`,
        code: 'FEATURE_NOT_AVAILABLE',
        feature,
        currentPlan: plan,
        upgradeUrl: `${process.env.APP_URL ?? 'https://rotipos.com'}/pricing`,
      }, 403)
    }

    return next()
  }
}

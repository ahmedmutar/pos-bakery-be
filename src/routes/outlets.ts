import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { getPlanLimits, checkLimit, isTrialExpired } from '../lib/planLimits.js'
import { authMiddleware } from '../middleware/auth.js'

export const outletRoutes = new Hono()
outletRoutes.use('*', authMiddleware)

outletRoutes.get('/', async (c) => {
  const { tenantId } = c.get('auth')
  const outlets = await prisma.outlet.findMany({
    where: { tenantId, isActive: true },
    orderBy: { name: 'asc' },
  })
  return c.json(outlets)
})

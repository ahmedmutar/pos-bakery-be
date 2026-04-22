import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../middleware/auth.js'

export const productionRoutes = new Hono()
productionRoutes.use('*', authMiddleware)

const planItemSchema = z.object({
  productId: z.string().uuid(),
  targetQty: z.number().int().positive(),
})

const planSchema = z.object({
  date: z.string(),
  notes: z.string().optional(),
  items: z.array(planItemSchema).min(1),
})

const updateItemSchema = z.object({
  actualQty: z.number().int().min(0).optional(),
  wasteQty: z.number().int().min(0).optional(),
  wasteCategory: z.string().optional(),
  unsoldQty: z.number().int().min(0).optional(),
})

// GET /production — list plans with optional date filter
productionRoutes.get('/', async (c) => {
  const { tenantId } = c.get('auth')
  const { from, to } = c.req.query()

  const plans = await prisma.productionPlan.findMany({
    where: {
      tenantId,
      ...(from || to
        ? {
            date: {
              ...(from && { gte: new Date(from) }),
              ...(to && { lte: new Date(to) }),
            },
          }
        : {}),
    },
    include: {
      items: {
        include: {
          product: {
            select: { id: true, name: true, price: true, imageUrl: true },
          },
        },
      },
    },
    orderBy: { date: 'desc' },
  })

  return c.json(plans)
})

// GET /production/today — get or check today's plan
productionRoutes.get('/today', async (c) => {
  const { tenantId } = c.get('auth')
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)

  const plan = await prisma.productionPlan.findFirst({
    where: { tenantId, date: { gte: start, lte: end } },
    include: {
      items: {
        include: {
          product: {
            include: {
              recipe: {
                include: { items: { include: { ingredient: true } } },
              },
            },
          },
        },
      },
    },
  })

  return c.json(plan)
})

// POST /production — create a new production plan
productionRoutes.post('/', zValidator('json', planSchema), async (c) => {
  const { tenantId } = c.get('auth')
  const body = c.req.valid('json')

  const plan = await prisma.productionPlan.create({
    data: {
      tenantId,
      date: new Date(body.date),
      notes: body.notes,
      items: {
        create: body.items.map((item) => ({
          productId: item.productId,
          targetQty: item.targetQty,
        })),
      },
    },
    include: {
      items: {
        include: {
          product: { select: { id: true, name: true, price: true, imageUrl: true } },
        },
      },
    },
  })

  return c.json(plan, 201)
})

// GET /production/:id — get single plan
productionRoutes.get('/:id', async (c) => {
  const { tenantId } = c.get('auth')
  const plan = await prisma.productionPlan.findFirst({
    where: { id: c.req.param('id'), tenantId },
    include: {
      items: {
        include: {
          product: {
            include: {
              recipe: {
                include: { items: { include: { ingredient: true } } },
              },
            },
          },
        },
      },
    },
  })

  if (!plan) return c.json({ error: 'Rencana produksi tidak ditemukan' }, 404)
  return c.json(plan)
})

// PATCH /production/:planId/items/:itemId — update actual result + deduct ingredients
productionRoutes.patch(
  '/:planId/items/:itemId',
  zValidator('json', updateItemSchema),
  async (c) => {
    const { tenantId } = c.get('auth')
    const { planId, itemId } = c.req.param()
    const body = c.req.valid('json')

    const plan = await prisma.productionPlan.findFirst({ where: { id: planId, tenantId } })
    if (!plan) return c.json({ error: 'Rencana tidak ditemukan' }, 404)

    // Get current item state before update
    const currentItem = await prisma.productionPlanItem.findFirst({
      where: { id: itemId },
      include: {
        product: {
          include: {
            recipe: {
              include: { items: { include: { ingredient: true } } },
            },
          },
        },
      },
    })
    if (!currentItem) return c.json({ error: 'Item tidak ditemukan' }, 404)

    // Calculate how many new units are being produced in this update
    // Only deduct for the DELTA (new actualQty - previous actualQty)
    const previousActual = currentItem.actualQty ?? 0
    const newActual = body.actualQty ?? previousActual
    const delta = newActual - previousActual

    // Run update + ingredient deduction in a transaction
    const [item] = await prisma.$transaction(async (tx) => {
      // 1. Update the plan item
      const updated = await tx.productionPlanItem.update({
        where: { id: itemId },
        data: body,
        include: {
          product: { select: { id: true, name: true, price: true } },
        },
      })

      // 2. Deduct ingredients if actualQty increased and recipe exists
      if (delta > 0 && currentItem.product.recipe) {
        const recipe = currentItem.product.recipe
        const deductions: { ingredientId: string; amount: number }[] = []

        for (const recipeItem of recipe.items) {
          // Amount per unit = (recipeItem.amount × unitFactor) / batchSize
          const amountPerUnit = (recipeItem.amount * recipeItem.unitFactor) / recipe.batchSize
          const totalDeduct = amountPerUnit * delta
          deductions.push({ ingredientId: recipeItem.ingredientId, amount: totalDeduct })
        }

        // Apply deductions
        for (const d of deductions) {
          await tx.ingredient.update({
            where: { id: d.ingredientId },
            data: {
              currentStock: { decrement: d.amount },
            },
          })
        }
      }

      // 3. If actualQty was REDUCED, add ingredients back
      if (delta < 0 && currentItem.product.recipe) {
        const recipe = currentItem.product.recipe
        for (const recipeItem of recipe.items) {
          const amountPerUnit = (recipeItem.amount * recipeItem.unitFactor) / recipe.batchSize
          const totalReturn = amountPerUnit * Math.abs(delta)
          await tx.ingredient.update({
            where: { id: recipeItem.ingredientId },
            data: {
              currentStock: { increment: totalReturn },
            },
          })
        }
      }

      return [updated]
    })

    // Return item with ingredient deduction summary
    const deductionSummary = delta !== 0 && currentItem.product.recipe
      ? currentItem.product.recipe.items.map((ri) => ({
          ingredientName: ri.ingredient.name,
          unit: ri.ingredient.baseUnit,
          deducted: ((ri.amount * ri.unitFactor) / currentItem.product.recipe!.batchSize) * delta,
        }))
      : []

    return c.json({
      ...item,
      stockDeducted: delta > 0,
      stockReturned: delta < 0,
      delta,
      deductionSummary,
    })
  }
)

// GET /production/:id/material-check — check ingredient availability for this plan
productionRoutes.get('/:id/material-check', async (c) => {
  const { tenantId } = c.get('auth')
  const plan = await prisma.productionPlan.findFirst({
    where: { id: c.req.param('id'), tenantId },
    include: {
      items: {
        include: {
          product: {
            include: {
              recipe: {
                include: { items: { include: { ingredient: true } } },
              },
            },
          },
        },
      },
    },
  })

  if (!plan) return c.json({ error: 'Rencana tidak ditemukan' }, 404)

  // Calculate total ingredient needs
  const needs: Record<string, {
    ingredient: { id: string; name: string; baseUnit: string; currentStock: number }
    needed: number
    available: number
    sufficient: boolean
  }> = {}

  for (const planItem of plan.items) {
    if (!planItem.product.recipe) continue
    for (const recipeItem of planItem.product.recipe.items) {
      const totalNeeded = recipeItem.amount * recipeItem.unitFactor * planItem.targetQty / planItem.product.recipe.batchSize
      if (!needs[recipeItem.ingredientId]) {
        needs[recipeItem.ingredientId] = {
          ingredient: recipeItem.ingredient,
          needed: 0,
          available: recipeItem.ingredient.currentStock,
          sufficient: true,
        }
      }
      needs[recipeItem.ingredientId].needed += totalNeeded
    }
  }

  // Check sufficiency
  for (const key of Object.keys(needs)) {
    needs[key].sufficient = needs[key].available >= needs[key].needed
  }

  return c.json({
    planId: plan.id,
    allSufficient: Object.values(needs).every((n) => n.sufficient),
    materials: Object.values(needs),
  })
})

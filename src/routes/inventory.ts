import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../middleware/auth.js'

export const inventoryRoutes = new Hono()
inventoryRoutes.use('*', authMiddleware)

const ingredientSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['INGREDIENT', 'EQUIPMENT', 'PACKAGING']).optional(),
  baseUnit: z.string().min(1),
  currentStock: z.number().min(0).optional(),
  minimumStock: z.number().min(0).optional(),
  currentPrice: z.number().int().min(0).optional(),
  notes: z.string().optional(),
})

// ─── INGREDIENTS ───────────────────────────────────────────────────────────

// GET /inventory/ingredients
inventoryRoutes.get('/ingredients', async (c) => {
  const { tenantId } = c.get('auth')
  const { lowStock, type } = c.req.query()

  const validTypes = ['INGREDIENT', 'EQUIPMENT', 'PACKAGING']

  let ingredients: Awaited<ReturnType<typeof prisma.ingredient.findMany>> = []

  try {
    const typeFilter = type && validTypes.includes(type) ? { type: type as 'INGREDIENT' | 'EQUIPMENT' | 'PACKAGING' } : {}
    ingredients = await prisma.ingredient.findMany({
      where: { tenantId, ...typeFilter },
      orderBy: [{ name: 'asc' }],
    })
  } catch {
    // Fallback: query without type filter (migration may not have run yet)
    ingredients = await prisma.ingredient.findMany({
      where: { tenantId },
      orderBy: [{ name: 'asc' }],
    })
  }

  // Manual low stock filter
  if (lowStock === 'true') {
    return c.json(ingredients.filter((i: typeof ingredients[number]) => i.currentStock <= i.minimumStock))
  }

  return c.json(ingredients)
})

// POST /inventory/ingredients
inventoryRoutes.post('/ingredients', zValidator('json', ingredientSchema), async (c) => {
  const { tenantId } = c.get('auth')
  const data = c.req.valid('json')
  const ingredient = await prisma.ingredient.create({ data: { ...data, tenantId } })
  return c.json(ingredient, 201)
})

// PATCH /inventory/ingredients/:id
inventoryRoutes.patch('/ingredients/:id', zValidator('json', ingredientSchema.partial()), async (c) => {
  const { tenantId } = c.get('auth')
  const id = c.req.param('id')

  const existing = await prisma.ingredient.findFirst({ where: { id, tenantId } })
  if (!existing) return c.json({ error: 'Bahan tidak ditemukan' }, 404)

  const ingredient = await prisma.ingredient.update({ where: { id }, data: c.req.valid('json') })
  return c.json(ingredient)
})

// POST /inventory/ingredients/:id/adjust — stok opname
inventoryRoutes.post(
  '/ingredients/:id/adjust',
  zValidator('json', z.object({ actualStock: z.number().min(0), notes: z.string().optional() })),
  async (c) => {
    const { tenantId } = c.get('auth')
    const id = c.req.param('id')
    const { actualStock } = c.req.valid('json')

    const existing = await prisma.ingredient.findFirst({ where: { id, tenantId } })
    if (!existing) return c.json({ error: 'Bahan tidak ditemukan' }, 404)

    const diff = actualStock - existing.currentStock
    const ingredient = await prisma.ingredient.update({
      where: { id },
      data: { currentStock: actualStock },
    })

    // Log ke StockAdjustment
    const { notes } = c.req.valid('json')
    const { userId } = c.get('auth')
    await prisma.stockAdjustment.create({
      data: {
        tenantId,
        ingredientId: id,
        userId,
        previousQty: existing.currentStock,
        newQty: actualStock,
        difference: diff,
        reason: notes ?? 'Penyesuaian manual',
      },
    }).catch(() => {}) // non-critical, don't fail if this errors

    return c.json({ ...ingredient, adjustment: diff })
  }
)

// ─── PURCHASES ─────────────────────────────────────────────────────────────

const purchaseItemSchema = z.object({
  ingredientId: z.string().uuid(),
  quantity: z.number().positive(),
  unit: z.string(),
  unitFactor: z.number().positive(), // berapa baseUnit dalam 1 unit ini
  pricePerUnit: z.number().int().positive(),
})

const purchaseSchema = z.object({
  supplierId: z.string().uuid().optional(),
  date: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(purchaseItemSchema).min(1),
})

// POST /inventory/purchases
inventoryRoutes.post('/purchases', zValidator('json', purchaseSchema), async (c) => {
  const { tenantId } = c.get('auth')
  const body = c.req.valid('json')

  // Create purchase and update stock + price in a transaction
  const purchase = await prisma.$transaction(async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => {
    const created = await tx.purchase.create({
      data: {
        tenantId,
        supplierId: body.supplierId,
        date: body.date ? new Date(body.date) : new Date(),
        notes: body.notes,
        items: {
          create: body.items.map((item) => ({
            ingredientId: item.ingredientId,
            quantity: item.quantity,
            unit: item.unit,
            unitFactor: item.unitFactor,
            pricePerUnit: item.pricePerUnit,
          })),
        },
      },
      include: { items: { include: { ingredient: true } } },
    })

    // Update stock and current price for each ingredient
    for (const item of body.items) {
      const addedStock = item.quantity * item.unitFactor
      const pricePerBaseUnit = Math.round(item.pricePerUnit / item.unitFactor)

      await tx.ingredient.update({
        where: { id: item.ingredientId },
        data: {
          currentStock: { increment: addedStock },
          currentPrice: pricePerBaseUnit,
        },
      })
    }

    return created
  })

  return c.json(purchase, 201)
})

// GET /inventory/purchases
inventoryRoutes.get('/purchases', async (c) => {
  const { tenantId } = c.get('auth')
  const purchases = await prisma.purchase.findMany({
    where: { tenantId },
    include: {
      supplier: { select: { name: true } },
      items: { include: { ingredient: { select: { name: true, baseUnit: true } } } },
    },
    orderBy: { date: 'desc' },
  })
  return c.json(purchases)
})

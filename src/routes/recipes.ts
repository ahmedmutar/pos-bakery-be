import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../middleware/auth.js'

export const recipeRoutes = new Hono()
recipeRoutes.use('*', authMiddleware)

const recipeItemSchema = z.object({
  ingredientId: z.string().uuid(),
  amount: z.number().positive(),
  unit: z.string().min(1),
  unitFactor: z.number().positive().default(1),
})

const recipeSchema = z.object({
  batchSize: z.number().int().positive().default(1),
  notes: z.string().optional(),
  instructions: z.string().optional(),
  items: z.array(recipeItemSchema).min(1),
})

// GET /recipes — list all products with their recipe status
recipeRoutes.get('/', async (c) => {
  const { tenantId } = c.get('auth')

  const products = await prisma.product.findMany({
    where: { tenantId, isActive: true },
    include: {
      recipe: {
        include: {
          items: {
            include: { ingredient: true },
          },
        },
      },
      category: true,
    },
    orderBy: { name: 'asc' },
  })

  return c.json(products)
})

// GET /recipes/:productId — get recipe for a product
recipeRoutes.get('/:productId', async (c) => {
  const { tenantId } = c.get('auth')
  const productId = c.req.param('productId')

  const product = await prisma.product.findFirst({
    where: { id: productId, tenantId },
    include: {
      recipe: {
        include: {
          items: { include: { ingredient: true } },
        },
      },
    },
  })

  if (!product) return c.json({ error: 'Produk tidak ditemukan' }, 404)
  return c.json(product)
})

// PUT /recipes/:productId — create or fully replace recipe
recipeRoutes.put('/:productId', zValidator('json', recipeSchema), async (c) => {
  const { tenantId } = c.get('auth')
  const productId = c.req.param('productId')
  const body = c.req.valid('json')

  const product = await prisma.product.findFirst({ where: { id: productId, tenantId } })
  if (!product) return c.json({ error: 'Produk tidak ditemukan' }, 404)

  // Upsert recipe — delete existing items and recreate
  const recipe = await prisma.$transaction(async (tx) => {
    const existing = await tx.recipe.findUnique({ where: { productId } })

    if (existing) {
      await tx.recipeItem.deleteMany({ where: { recipeId: existing.id } })
      return tx.recipe.update({
        where: { productId },
        data: {
          batchSize: body.batchSize,
          notes: body.notes,
          instructions: body.instructions,
          items: {
            create: body.items.map((item) => ({
              ingredientId: item.ingredientId,
              amount: item.amount,
              unit: item.unit,
              unitFactor: item.unitFactor,
            })),
          },
        },
        include: { items: { include: { ingredient: true } } },
      })
    }

    return tx.recipe.create({
      data: {
        tenantId,
        productId,
        batchSize: body.batchSize,
        notes: body.notes,
        instructions: body.instructions,
        items: {
          create: body.items.map((item) => ({
            ingredientId: item.ingredientId,
            amount: item.amount,
            unit: item.unit,
            unitFactor: item.unitFactor,
          })),
        },
      },
      include: { items: { include: { ingredient: true } } },
    })
  })

  return c.json(recipe)
})

// DELETE /recipes/:productId — remove recipe from product
recipeRoutes.delete('/:productId', async (c) => {
  const { tenantId } = c.get('auth')
  const productId = c.req.param('productId')

  const product = await prisma.product.findFirst({ where: { id: productId, tenantId } })
  if (!product) return c.json({ error: 'Produk tidak ditemukan' }, 404)

  const recipe = await prisma.recipe.findUnique({ where: { productId } })
  if (!recipe) return c.json({ error: 'Resep tidak ditemukan' }, 404)

  await prisma.recipe.delete({ where: { productId } })
  return c.json({ message: 'Resep dihapus' })
})

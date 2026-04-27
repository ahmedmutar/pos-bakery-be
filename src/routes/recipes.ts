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

// POST /recipes/:productId/duplicate — duplikat resep ke produk lain
recipeRoutes.post('/:productId/duplicate', async (c) => {
  const { tenantId } = c.get('auth')
  const { productId } = c.req.param()
  const body = await c.req.json().catch(() => ({}))
  const targetProductId: string | undefined = body.targetProductId

  // Get source recipe
  const source = await prisma.recipe.findFirst({
    where: { productId, tenantId },
    include: { items: true },
  })
  if (!source) return c.json({ error: 'Resep tidak ditemukan' }, 404)

  // If targetProductId provided, duplicate to that product
  // Otherwise, find the next available product without a recipe
  let destProductId = targetProductId

  if (!destProductId) {
    // Find products without recipe
    const allProducts = await prisma.product.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, name: true },
    })
    const withRecipe = await prisma.recipe.findMany({
      where: { tenantId },
      select: { productId: true },
    })
    const withRecipeIds = new Set(withRecipe.map(r => r.productId))
    const without = allProducts.filter(p => !withRecipeIds.has(p.id) && p.id !== productId)
    if (without.length === 0) {
      return c.json({ error: 'Tidak ada produk lain yang belum memiliki resep.', code: 'NO_TARGET' }, 400)
    }
    destProductId = without[0].id
  }

  // Check target doesn't already have a recipe
  const existing = await prisma.recipe.findFirst({ where: { productId: destProductId, tenantId } })
  if (existing) return c.json({ error: 'Produk tujuan sudah memiliki resep.', code: 'ALREADY_HAS_RECIPE' }, 409)

  // Verify target product belongs to tenant
  const targetProduct = await prisma.product.findFirst({
    where: { id: destProductId, tenantId },
    select: { id: true, name: true },
  })
  if (!targetProduct) return c.json({ error: 'Produk tujuan tidak ditemukan' }, 404)

  // Create duplicate recipe
  const duplicate = await prisma.recipe.create({
    data: {
      tenantId,
      productId: destProductId,
      batchSize: source.batchSize,
      notes: source.notes ? `${source.notes} (duplikat)` : undefined,
      instructions: source.instructions,
      items: {
        create: source.items.map(item => ({
          ingredientId: item.ingredientId,
          amount: item.amount,
          unit: item.unit,
          unitFactor: item.unitFactor,
        })),
      },
    },
    include: {
      items: { include: { ingredient: true } },
    },
  })

  return c.json({ recipe: duplicate, targetProduct }, 201)
})

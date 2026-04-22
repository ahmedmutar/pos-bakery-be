import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { getPlanLimits, checkLimit } from '../lib/planLimits.js'
import { authMiddleware } from '../middleware/auth.js'

export const productRoutes = new Hono()
productRoutes.use('*', authMiddleware)

const productSchema = z.object({
  name: z.string().min(1),
  price: z.number().int().positive(),
  categoryId: z.string().uuid().optional(),
  imageUrl: z.string().url().optional(),
  isActive: z.boolean().optional(),
})

// GET /products
productRoutes.get('/', async (c) => {
  const { tenantId } = c.get('auth')
  const { categoryId, isActive, search } = c.req.query()

  const products = await prisma.product.findMany({
    where: {
      tenantId,
      ...(categoryId && { categoryId }),
      ...(isActive !== undefined && { isActive: isActive === 'true' }),
      ...(search && { name: { contains: search, mode: 'insensitive' } }),
    },
    include: { category: true, recipe: { include: { items: { include: { ingredient: true } } } } },
    orderBy: { name: 'asc' },
  })

  return c.json(products)
})

// GET /products/:id
productRoutes.get('/:id', async (c) => {
  const { tenantId } = c.get('auth')
  const product = await prisma.product.findFirst({
    where: { id: c.req.param('id'), tenantId },
    include: {
      category: true,
      recipe: { include: { items: { include: { ingredient: true } } } },
    },
  })

  if (!product) return c.json({ error: 'Produk tidak ditemukan' }, 404)
  return c.json(product)
})

// POST /products
productRoutes.post('/', zValidator('json', productSchema), async (c) => {
  const { tenantId } = c.get('auth')

  // Plan limit check
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { plan: true } })
  const limits = getPlanLimits(tenant?.plan ?? 'basic')
  if (limits.maxProducts !== -1) {
    const count = await prisma.product.count({ where: { tenantId, isActive: true } })
    if (!checkLimit(count, limits.maxProducts)) {
      return c.json({ error: `Batas produk paket ${tenant?.plan} adalah ${limits.maxProducts}. Upgrade paket untuk menambah lebih banyak produk.`, code: 'PLAN_LIMIT' }, 403)
    }
  }
  const data = c.req.valid('json')

  const product = await prisma.product.create({
    data: { ...data, tenantId },
    include: { category: true },
  })

  return c.json(product, 201)
})

// PATCH /products/:id
productRoutes.patch('/:id', zValidator('json', productSchema.partial()), async (c) => {
  const { tenantId } = c.get('auth')
  const id = c.req.param('id')

  const existing = await prisma.product.findFirst({ where: { id, tenantId } })
  if (!existing) return c.json({ error: 'Produk tidak ditemukan' }, 404)

  const product = await prisma.product.update({
    where: { id },
    data: c.req.valid('json'),
    include: { category: true },
  })

  return c.json(product)
})

// DELETE /products/:id
productRoutes.delete('/:id', async (c) => {
  const { tenantId } = c.get('auth')
  const id = c.req.param('id')

  const existing = await prisma.product.findFirst({ where: { id, tenantId } })
  if (!existing) return c.json({ error: 'Produk tidak ditemukan' }, 404)

  // Soft delete
  await prisma.product.update({ where: { id }, data: { isActive: false } })
  return c.json({ message: 'Produk dinonaktifkan' })
})

// GET /products/:id/food-cost
productRoutes.get('/:id/food-cost', async (c) => {
  const { tenantId } = c.get('auth')
  const product = await prisma.product.findFirst({
    where: { id: c.req.param('id'), tenantId },
    include: {
      recipe: {
        include: {
          items: { include: { ingredient: true } },
        },
      },
    },
  })

  if (!product) return c.json({ error: 'Produk tidak ditemukan' }, 404)
  if (!product.recipe) return c.json({ error: 'Produk belum punya resep' }, 404)

  const { recipe } = product
  const totalCost = recipe.items.reduce((sum: number, item: typeof recipe.items[number]) => {
    const costPerBaseUnit = item.ingredient.currentPrice
    const amountInBaseUnit = item.amount * item.unitFactor
    return sum + costPerBaseUnit * amountInBaseUnit
  }, 0)

  const costPerPcs = totalCost / recipe.batchSize
  const margin = product.price - costPerPcs
  const marginPercent = (margin / product.price) * 100

  return c.json({
    productId: product.id,
    productName: product.name,
    sellingPrice: product.price,
    batchSize: recipe.batchSize,
    totalBatchCost: Math.round(totalCost),
    costPerPcs: Math.round(costPerPcs),
    margin: Math.round(margin),
    marginPercent: Math.round(marginPercent * 10) / 10,
    items: recipe.items.map((item: typeof recipe.items[number]) => ({
      ingredient: item.ingredient.name,
      amount: item.amount,
      unit: item.unit,
      costContribution: Math.round(item.ingredient.currentPrice * item.amount * item.unitFactor),
    })),
  })
})

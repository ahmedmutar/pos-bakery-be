import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../middleware/auth.js'

export const outletProductRoutes = new Hono()
outletProductRoutes.use('*', authMiddleware)

// GET /outlet-products/:outletId — all products with outlet config
outletProductRoutes.get('/:outletId', async (c) => {
  const { tenantId } = c.get('auth')
  const { outletId } = c.req.param()

  const outlet = await prisma.outlet.findFirst({ where: { id: outletId, tenantId } })
  if (!outlet) return c.json({ error: 'Outlet tidak ditemukan' }, 404)

  const products = await prisma.product.findMany({
    where: { tenantId, isActive: true },
    include: {
      category: { select: { id: true, name: true } },
      outletProducts: { where: { outletId } },
    },
    orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }],
  })

  return c.json(products.map((p) => {
    const op = p.outletProducts[0]
    return {
      productId: p.id,
      name: p.name,
      defaultPrice: p.price,
      imageUrl: p.imageUrl,
      category: p.category,
      isAvailable: op?.isAvailable ?? true,
      priceOverride: op?.priceOverride ?? null,
      stock: op?.stock ?? null,
      effectivePrice: op?.priceOverride ?? p.price,
    }
  }))
})

// GET /outlet-products/:outletId/cashier — only available products for cashier
outletProductRoutes.get('/:outletId/cashier', async (c) => {
  const { tenantId } = c.get('auth')
  const { outletId } = c.req.param()

  const outlet = await prisma.outlet.findFirst({ where: { id: outletId, tenantId } })
  if (!outlet) return c.json({ error: 'Outlet tidak ditemukan' }, 404)

  const products = await prisma.product.findMany({
    where: { tenantId, isActive: true },
    include: {
      category: { select: { id: true, name: true } },
      outletProducts: { where: { outletId } },
    },
    orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }],
  })

  const hasConfig = await prisma.outletProduct.count({ where: { outletId } })

  return c.json(
    products
      .filter((p) => {
        const op = p.outletProducts[0]
        if (!hasConfig) return true
        return op ? op.isAvailable : false
      })
      .map((p) => {
        const op = p.outletProducts[0]
        return {
          id: p.id,
          name: p.name,
          price: op?.priceOverride ?? p.price,
          imageUrl: p.imageUrl,
          category: p.category,
          stock: op?.stock ?? null,
        }
      })
  )
})

// PUT /outlet-products/:outletId — bulk upsert
outletProductRoutes.put(
  '/:outletId',
  zValidator('json', z.object({
    products: z.array(z.object({
      productId: z.string().uuid(),
      isAvailable: z.boolean(),
      priceOverride: z.number().int().positive().nullable(),
      stock: z.number().int().min(0).nullable(),
    })),
  })),
  async (c) => {
    const { tenantId } = c.get('auth')
    const { outletId } = c.req.param()
    const { products } = c.req.valid('json')

    const outlet = await prisma.outlet.findFirst({ where: { id: outletId, tenantId } })
    if (!outlet) return c.json({ error: 'Outlet tidak ditemukan' }, 404)

    await prisma.$transaction(
      products.map((p) =>
        prisma.outletProduct.upsert({
          where: { outletId_productId: { outletId, productId: p.productId } },
          create: { outletId, productId: p.productId, isAvailable: p.isAvailable, priceOverride: p.priceOverride, stock: p.stock },
          update: { isAvailable: p.isAvailable, priceOverride: p.priceOverride, stock: p.stock },
        })
      )
    )

    return c.json({ success: true, updated: products.length })
  }
)

// PATCH /outlet-products/:outletId/:productId — update single
outletProductRoutes.patch(
  '/:outletId/:productId',
  zValidator('json', z.object({
    isAvailable: z.boolean().optional(),
    priceOverride: z.number().int().positive().nullable().optional(),
    stock: z.number().int().min(0).nullable().optional(),
  })),
  async (c) => {
    const { tenantId } = c.get('auth')
    const { outletId, productId } = c.req.param()
    const body = c.req.valid('json')

    const outlet = await prisma.outlet.findFirst({ where: { id: outletId, tenantId } })
    if (!outlet) return c.json({ error: 'Outlet tidak ditemukan' }, 404)

    const result = await prisma.outletProduct.upsert({
      where: { outletId_productId: { outletId, productId } },
      create: { outletId, productId, ...body },
      update: body,
    })

    return c.json(result)
  }
)

import { Hono } from 'hono'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../middleware/auth.js'

export const reportRoutes = new Hono()
reportRoutes.use('*', authMiddleware)

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0)
}
function endOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59)
}

// GET /reports/dashboard — summary for today
reportRoutes.get('/dashboard', async (c) => {
  const { tenantId } = c.get('auth')
  const today = new Date()
  const start = startOfDay(today)
  const end = endOfDay(today)

  const [salesAgg, txCount, lowStockItems, productionToday] = await Promise.all([
    prisma.transaction.aggregate({
      where: { tenantId, createdAt: { gte: start, lte: end } },
      _sum: { total: true },
      _count: true,
    }),
    prisma.transaction.count({
      where: { tenantId, createdAt: { gte: start, lte: end } },
    }),
    prisma.ingredient.findMany({
      where: { tenantId },
      select: { id: true, name: true, currentStock: true, minimumStock: true, baseUnit: true },
    }),
    prisma.productionPlan.findFirst({
      where: {
        tenantId,
        date: { gte: start, lte: end },
      },
      include: { items: { include: { product: { select: { name: true } } } } },
    }),
  ])

  const lowStock = lowStockItems.filter((i: typeof lowStockItems[number]) => i.currentStock <= i.minimumStock)

  const totalProduced = productionToday?.items.reduce((s: number, i: typeof productionToday.items[number]) => s + i.actualQty, 0) ?? 0
  const totalWaste = productionToday?.items.reduce((s: number, i: typeof productionToday.items[number]) => s + i.wasteQty + i.unsoldQty, 0) ?? 0

  return c.json({
    todaySales: salesAgg._sum.total ?? 0,
    transactionCount: txCount,
    totalProduced,
    totalWaste,
    lowStockCount: lowStock.length,
    lowStockItems: lowStock,
  })
})

// GET /reports/top-products?from=&to=&limit=
reportRoutes.get('/top-products', async (c) => {
  const { tenantId } = c.get('auth')
  const { from, to, limit } = c.req.query()
  const take = parseInt(limit ?? '10')

  const items = await prisma.transactionItem.groupBy({
    by: ['productId'],
    where: {
      transaction: {
        tenantId,
        ...(from || to
          ? { createdAt: { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(to) }) } }
          : {}),
      },
    },
    _sum: { quantity: true, subtotal: true },
    orderBy: { _sum: { subtotal: 'desc' } },
    take,
  })

  // Enrich with product names
  const productIds = items.map((i: typeof items[number]) => i.productId)
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true, price: true },
  })

  const productMap = Object.fromEntries(products.map((p: typeof products[number]) => [p.id, p]))

  return c.json(
    items.map((item: typeof items[number]) => ({
      product: productMap[item.productId],
      totalSold: item._sum.quantity ?? 0,
      totalRevenue: item._sum.subtotal ?? 0,
    }))
  )
})

// GET /reports/sales-summary?from=&to=
reportRoutes.get('/sales-summary', async (c) => {
  const { tenantId } = c.get('auth')
  const { from, to } = c.req.query()

  const where = {
    tenantId,
    ...(from || to
      ? { createdAt: { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(to) }) } }
      : {}),
  }

  const [agg, byPayment] = await Promise.all([
    prisma.transaction.aggregate({
      where,
      _sum: { total: true, discount: true },
      _count: true,
    }),
    prisma.transaction.groupBy({
      by: ['paymentMethod'],
      where,
      _sum: { total: true },
      _count: true,
    }),
  ])

  return c.json({
    totalRevenue: agg._sum.total ?? 0,
    totalDiscount: agg._sum.discount ?? 0,
    transactionCount: agg._count,
    byPaymentMethod: byPayment.map((b: typeof byPayment[number]) => ({
      method: b.paymentMethod,
      total: b._sum.total ?? 0,
      count: b._count,
    })),
  })
})

// GET /reports/waste?from=&to=
reportRoutes.get('/waste', async (c) => {
  const { tenantId } = c.get('auth')
  const { from, to } = c.req.query()

  const plans = await prisma.productionPlan.findMany({
    where: {
      tenantId,
      ...(from || to
        ? { date: { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(to) }) } }
        : {}),
    },
    include: {
      items: {
        include: { product: { select: { name: true, price: true } } },
        where: { OR: [{ wasteQty: { gt: 0 } }, { unsoldQty: { gt: 0 } }] },
      },
    },
  })

  const allItems = plans.flatMap((p: typeof plans[number]) => p.items)
  const totalWasteValue = allItems.reduce((sum: number, item: typeof allItems[number]) => {
    return sum + (item.wasteQty + item.unsoldQty) * item.product.price
  }, 0)

  return c.json({
    totalWasteValue,
    items: allItems.map((item: typeof allItems[number]) => ({
      productName: item.product.name,
      wasteQty: item.wasteQty,
      unsoldQty: item.unsoldQty,
      wasteCategory: item.wasteCategory,
      estimatedLoss: (item.wasteQty + item.unsoldQty) * item.product.price,
    })),
  })
})

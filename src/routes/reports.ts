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

// GET /reports/orders?from=&to=
reportRoutes.get('/orders', async (c) => {
  const { tenantId } = c.get('auth')
  const { from, to } = c.req.query()

  const dateFilter = from || to ? {
    createdAt: {
      ...(from && { gte: new Date(from) }),
      ...(to   && { lte: new Date(to)  }),
    },
  } : {}

  const [orders, byStatus] = await Promise.all([
    prisma.preOrder.findMany({
      where: { tenantId, ...dateFilter },
      include: {
        items: {
          include: { product: { select: { name: true, price: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.preOrder.groupBy({
      by: ['status'],
      where: { tenantId, ...dateFilter },
      _count: true,
      _sum: { total: true, dpAmount: true },
    }),
  ])

  const totalOrders    = orders.length
  const totalValue     = orders.reduce((s, o) => s + o.total, 0)
  const totalDP        = orders.reduce((s, o) => s + o.dpAmount, 0)
  const totalRemaining = orders.reduce((s, o) => s + o.remainingAmount, 0)
  const totalCompleted = orders.filter(o => o.status === 'COMPLETED').length
  const totalCancelled = orders.filter(o => o.status === 'CANCELLED').length

  // Top products from pre-orders
  const productMap: Record<string, { name: string; qty: number; revenue: number }> = {}
  for (const order of orders) {
    if (order.status === 'CANCELLED') continue
    for (const item of order.items) {
      if (!productMap[item.productId]) {
        productMap[item.productId] = { name: item.product.name, qty: 0, revenue: 0 }
      }
      productMap[item.productId].qty     += item.quantity
      productMap[item.productId].revenue += item.subtotal
    }
  }

  const topProducts = Object.values(productMap)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10)

  return c.json({
    totalOrders,
    totalValue,
    totalDP,
    totalRemaining,
    totalCompleted,
    totalCancelled,
    completionRate: totalOrders > 0 ? Math.round((totalCompleted / totalOrders) * 100) : 0,
    byStatus: byStatus.map(b => ({
      status: b.status,
      count:  b._count,
      total:  b._sum.total ?? 0,
    })),
    topProducts,
    orders: orders.map(o => ({
      id:             o.id,
      customerName:   o.customerName,
      customerPhone:  o.customerPhone,
      status:         o.status,
      total:          o.total,
      dpAmount:       o.dpAmount,
      remainingAmount: o.remainingAmount,
      pickupDate:     o.pickupDate,
      createdAt:      o.createdAt,
      itemCount:      o.items.reduce((s, i) => s + i.quantity, 0),
    })),
  })
})

// GET /reports/profit-loss?from=&to=
reportRoutes.get('/profit-loss', async (c) => {
  const { tenantId } = c.get('auth')
  const { from, to } = c.req.query()

  const dateFilter = {
    ...(from && { gte: new Date(from) }),
    ...(to   && { lte: new Date(to)  }),
  }
  const hasDates = from || to

  const [transactions, purchases, productionItems, preOrders] = await Promise.all([
    // Revenue from kasir
    prisma.transaction.findMany({
      where: {
        tenantId,
        isVoided: false,
        ...(hasDates ? { createdAt: dateFilter } : {}),
      },
      select: {
        total: true,
        discount: true,
        paymentMethod: true,
        createdAt: true,
      },
    }),

    // Cost of goods — purchases
    prisma.purchase.findMany({
      where: {
        tenantId,
        ...(hasDates ? { date: dateFilter } : {}),
      },
      include: {
        items: { select: { quantity: true, pricePerUnit: true } },
      },
    }),

    // Waste cost from production
    prisma.productionPlanItem.findMany({
      where: {
        plan: {
          tenantId,
          ...(hasDates ? { date: dateFilter } : {}),
        },
        wasteQty: { gt: 0 },
      },
      include: {
        product: { select: { name: true, price: true } },
        plan: { select: { date: true } },
      },
    }),

    // Revenue from pre-orders (completed)
    prisma.preOrder.findMany({
      where: {
        tenantId,
        status: 'COMPLETED',
        ...(hasDates ? { createdAt: dateFilter } : {}),
      },
      select: { total: true, dpAmount: true, createdAt: true },
    }),
  ])

  // ── Revenue ──────────────────────────────────────────────────────────────
  const kasirRevenue  = transactions.reduce((s, t) => s + t.total, 0)
  const kasirDiscount = transactions.reduce((s, t) => s + t.discount, 0)
  const orderRevenue  = preOrders.reduce((s, o) => s + o.total, 0)
  const totalRevenue  = kasirRevenue + orderRevenue

  // Revenue by payment method
  const byPayment: Record<string, number> = {}
  for (const tx of transactions) {
    byPayment[tx.paymentMethod] = (byPayment[tx.paymentMethod] ?? 0) + tx.total
  }

  // ── Cost of Goods Sold (COGS) ──────────────────────────────────────────
  const purchaseCost = purchases.reduce((s, p) =>
    s + p.items.reduce((si, i) => si + i.quantity * i.pricePerUnit, 0), 0
  )

  // Waste cost (at selling price — approximation)
  const wasteCost = productionItems.reduce((s, i) =>
    s + (i.wasteQty ?? 0) * (i.product.price ?? 0), 0
  )

  const totalCOGS = purchaseCost

  // ── Gross Profit ──────────────────────────────────────────────────────
  const grossProfit     = totalRevenue - totalCOGS
  const grossMargin     = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0

  // ── Daily breakdown ────────────────────────────────────────────────────
  const dailyMap: Record<string, { date: string; revenue: number; cost: number }> = {}

  for (const tx of transactions) {
    const d = tx.createdAt.toISOString().split('T')[0]
    if (!dailyMap[d]) dailyMap[d] = { date: d, revenue: 0, cost: 0 }
    dailyMap[d].revenue += tx.total
  }
  for (const p of purchases) {
    const d = p.date.toISOString().split('T')[0]
    if (!dailyMap[d]) dailyMap[d] = { date: d, revenue: 0, cost: 0 }
    dailyMap[d].cost += p.items.reduce((s, i) => s + i.quantity * i.pricePerUnit, 0)
  }

  const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date))

  return c.json({
    period: { from: from ?? null, to: to ?? null },
    revenue: {
      kasir: kasirRevenue,
      orders: orderRevenue,
      total: totalRevenue,
      discount: kasirDiscount,
      byPayment,
    },
    cost: {
      purchases: purchaseCost,
      waste: wasteCost,
      total: totalCOGS,
    },
    profit: {
      gross: grossProfit,
      grossMargin: Math.round(grossMargin * 10) / 10,
      net: grossProfit, // same as gross until expense tracking is added
    },
    transactions: transactions.length,
    daily,
  })
})

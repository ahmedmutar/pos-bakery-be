import { Hono } from 'hono'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../middleware/auth.js'

export const forecastRoutes = new Hono()
forecastRoutes.use('*', authMiddleware)

// GET /forecast — returns suggested production for today/tomorrow
forecastRoutes.get('/', async (c) => {
  const { tenantId } = c.get('auth')
  const { days = '14' } = c.req.query()
  const lookbackDays = Math.min(parseInt(days), 90)

  const now = new Date()
  const todayDow = now.getDay() // 0=Sun, 1=Mon, ...

  // Get sales data for the lookback period
  const since = new Date()
  since.setDate(since.getDate() - lookbackDays)

  const salesData = await prisma.transactionItem.findMany({
    where: {
      transaction: {
        tenantId,
        createdAt: { gte: since },
        // Exclude voided transactions
        NOT: { notes: { startsWith: '[VOID]' } },
      },
    },
    include: {
      product: { select: { id: true, name: true, price: true, imageUrl: true } },
      transaction: { select: { createdAt: true } },
    },
  })

  // Group by product
  const productMap = new Map<string, {
    product: { id: string; name: string; price: number; imageUrl: string | null }
    dailySales: number[] // sales per day-of-week [Sun, Mon, Tue, Wed, Thu, Fri, Sat]
    totalSold: number
    daysWithSales: number
    salesByDate: Map<string, number>
  }>()

  for (const item of salesData) {
    const pid = item.product.id
    if (!productMap.has(pid)) {
      productMap.set(pid, {
        product: item.product,
        dailySales: [0, 0, 0, 0, 0, 0, 0],
        totalSold: 0,
        daysWithSales: 0,
        salesByDate: new Map(),
      })
    }
    const entry = productMap.get(pid)!
    const txDate = new Date(item.transaction.createdAt)
    const dow = txDate.getDay()
    const dateKey = txDate.toISOString().split('T')[0]

    entry.dailySales[dow] += item.quantity
    entry.totalSold += item.quantity

    const existing = entry.salesByDate.get(dateKey) ?? 0
    entry.salesByDate.set(dateKey, existing + item.quantity)
  }

  // Count days per DOW in lookback period
  const dowCounts = [0, 0, 0, 0, 0, 0, 0]
  for (let d = 0; d < lookbackDays; d++) {
    const date = new Date()
    date.setDate(date.getDate() - d)
    dowCounts[date.getDay()]++
  }

  // Build forecast for next 7 days
  const forecasts = []

  for (const [, entry] of productMap) {
    const { product, dailySales, totalSold, salesByDate } = entry

    if (totalSold === 0) continue

    // Average per day-of-week
    const avgByDow = dailySales.map((total, dow) => {
      const count = dowCounts[dow]
      return count > 0 ? total / count : 0
    })

    // Overall daily average
    const daysWithData = salesByDate.size
    const avgPerDay = daysWithData > 0 ? totalSold / daysWithData : 0

    // Trend: compare last 7 days vs previous 7 days
    const last7 = new Date(); last7.setDate(last7.getDate() - 7)
    const prev7 = new Date(); prev7.setDate(prev7.getDate() - 14)

    let recent7 = 0, previous7 = 0
    for (const [dateStr, qty] of salesByDate) {
      const d = new Date(dateStr)
      if (d >= last7) recent7 += qty
      else if (d >= prev7) previous7 += qty
    }

    const trendFactor = previous7 > 0 ? Math.min(recent7 / previous7, 2) : 1
    const trendLabel = trendFactor > 1.1 ? 'naik' : trendFactor < 0.9 ? 'turun' : 'stabil'

    // Generate 7-day forecast
    const nextDays = []
    for (let d = 0; d < 7; d++) {
      const date = new Date()
      date.setDate(date.getDate() + d)
      const dow = date.getDay()

      // Weighted: 70% DOW average + 30% overall average, adjusted by trend
      const base = (avgByDow[dow] * 0.7 + avgPerDay * 0.3) * trendFactor

      // Add 10% buffer for safety stock
      const suggested = Math.ceil(base * 1.1)

      nextDays.push({
        date: date.toISOString().split('T')[0],
        dayName: date.toLocaleDateString('id-ID', { weekday: 'long' }),
        isToday: d === 0,
        isTomorrow: d === 1,
        suggested: Math.max(suggested, 0),
        base: Math.round(base),
        confidence: dowCounts[dow] >= 2 ? 'high' : dowCounts[dow] >= 1 ? 'medium' : 'low',
      })
    }

    forecasts.push({
      product,
      totalSold,
      avgPerDay: Math.round(avgPerDay * 10) / 10,
      trendFactor: Math.round(trendFactor * 100) / 100,
      trendLabel,
      bestDay: ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'][avgByDow.indexOf(Math.max(...avgByDow))],
      worstDay: ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'][avgByDow.indexOf(Math.min(...avgByDow.filter(v => v > 0)) || 0)],
      next7Days: nextDays,
      todaySuggested: nextDays[0]?.suggested ?? 0,
      tomorrowSuggested: nextDays[1]?.suggested ?? 0,
    })
  }

  // Sort by total sold descending
  forecasts.sort((a, b) => b.totalSold - a.totalSold)

  return c.json({
    generatedAt: now.toISOString(),
    lookbackDays,
    dayOfWeek: ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'][todayDow],
    forecasts,
  })
})

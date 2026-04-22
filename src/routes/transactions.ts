import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { broadcastToTenant, WS_EVENTS } from '../lib/websocket.js'
import { audit } from '../lib/auditLog.js'
import { authMiddleware } from '../middleware/auth.js'

export const transactionRoutes = new Hono()
transactionRoutes.use('*', authMiddleware)

// ─── SHIFT ─────────────────────────────────────────────────────────────────

// POST /transactions/shifts/open
transactionRoutes.post(
  '/shifts/open',
  zValidator('json', z.object({
    outletId: z.string().uuid(),
    openingCash: z.number().int().min(0),
    forceClose: z.boolean().optional(),
  })),
  async (c) => {
    const { tenantId, userId } = c.get('auth')
    const { outletId, openingCash, forceClose } = c.req.valid('json')

    const openShift = await prisma.shift.findFirst({
      where: { tenantId, userId, closedAt: null },
      include: { outlet: { select: { name: true } } },
    })

    if (openShift) {
      const shiftAgeMs = Date.now() - new Date(openShift.openedAt).getTime()
      const isStale = shiftAgeMs > 24 * 60 * 60 * 1000

      if (isStale || forceClose) {
        const txSummary = await prisma.transaction.aggregate({
          where: { shiftId: openShift.id },
          _sum: { total: true },
        })
        const totalSales = txSummary._sum.total ?? 0
        await prisma.shift.update({
          where: { id: openShift.id },
          data: {
            closedAt: new Date(),
            closingCash: openShift.openingCash + totalSales,
            cashDiff: 0,
            notes: isStale
              ? 'Ditutup otomatis — shift melebihi 24 jam'
              : 'Ditutup paksa oleh kasir',
          },
        })
      } else {
        return c.json({
          error: 'Shift sebelumnya belum ditutup',
          code: 'SHIFT_CONFLICT',
          existingShift: {
            id: openShift.id,
            openedAt: openShift.openedAt,
            outletName: openShift.outlet.name,
          },
        }, 409)
      }
    }

    const shift = await prisma.shift.create({
      data: { tenantId, outletId, userId, openingCash },
    })

    return c.json(shift, 201)
  }
)

// POST /transactions/shifts/:id/force-close
transactionRoutes.post('/shifts/:id/force-close', async (c) => {
  const { tenantId } = c.get('auth')
  const shiftId = c.req.param('id')

  const shift = await prisma.shift.findFirst({
    where: { id: shiftId, tenantId, closedAt: null },
  })
  if (!shift) return c.json({ error: 'Shift tidak ditemukan' }, 404)

  const txSummary = await prisma.transaction.aggregate({
    where: { shiftId },
    _sum: { total: true },
  })
  const totalSales = txSummary._sum.total ?? 0

  const closed = await prisma.shift.update({
    where: { id: shiftId },
    data: {
      closedAt: new Date(),
      closingCash: shift.openingCash + totalSales,
      cashDiff: 0,
      notes: 'Ditutup paksa — resolusi konflik shift',
    },
  })

  return c.json({ ...closed, totalSales })
})

// POST /transactions/shifts/:id/close
transactionRoutes.post(
  '/shifts/:id/close',
  zValidator('json', z.object({ closingCash: z.number().int().min(0), notes: z.string().optional() })),
  async (c) => {
    const { tenantId } = c.get('auth')
    const shiftId = c.req.param('id')
    const { closingCash, notes } = c.req.valid('json')

    const shift = await prisma.shift.findFirst({ where: { id: shiftId, tenantId, closedAt: null } })
    if (!shift) return c.json({ error: 'Shift tidak ditemukan atau sudah ditutup' }, 404)

    const txSummary = await prisma.transaction.aggregate({
      where: { shiftId },
      _sum: { total: true },
    })

    const totalSales = txSummary._sum.total ?? 0
    const expectedCash = shift.openingCash + totalSales
    const cashDiff = closingCash - expectedCash

    const closed = await prisma.shift.update({
      where: { id: shiftId },
      data: { closedAt: new Date(), closingCash, cashDiff, notes },
    })

    return c.json({ ...closed, totalSales, expectedCash })
  }
)

// GET /transactions/shifts/active
transactionRoutes.get('/shifts/active', async (c) => {
  const { tenantId, userId } = c.get('auth')
  const shift = await prisma.shift.findFirst({
    where: { tenantId, userId, closedAt: null },
    include: { outlet: true },
  })
  return c.json(shift)
})

// ─── TRANSACTION ───────────────────────────────────────────────────────────

const txItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
  unitPrice: z.number().int().positive(),
  notes: z.string().optional(),
})

const txSchema = z.object({
  shiftId: z.string().uuid(),
  outletId: z.string().uuid(),
  items: z.array(txItemSchema).min(1),
  paymentMethod: z.enum(['CASH', 'QRIS', 'TRANSFER', 'SPLIT']),
  paidAmount: z.number().int().positive(),
  discount: z.number().int().min(0).optional(),
  notes: z.string().optional(),
})

// POST /transactions
transactionRoutes.post('/', zValidator('json', txSchema), async (c) => {
  const { tenantId, userId } = c.get('auth')
  const body = c.req.valid('json')

  // ── Security: verify shift belongs to this tenant and is still open ──
  const shift = await prisma.shift.findFirst({
    where: { id: body.shiftId, tenantId, closedAt: null },
  })
  if (!shift) {
    return c.json({ error: 'Shift tidak valid atau sudah ditutup' }, 400)
  }

  // ── Security: verify outlet belongs to this tenant ──
  const outlet = await prisma.outlet.findFirst({
    where: { id: body.outletId, tenantId, isActive: true },
  })
  if (!outlet) {
    return c.json({ error: 'Outlet tidak valid' }, 400)
  }

  // ── Security: verify all products belong to this tenant and get canonical prices ──
  const productIds = body.items.map((i) => i.productId)
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, tenantId, isActive: true },
    include: { outletProducts: { where: { outletId: body.outletId } } },
  })

  if (products.length !== productIds.length) {
    return c.json({ error: 'Satu atau lebih produk tidak valid' }, 400)
  }

  // Build price map — outlet override takes precedence over default price
  const priceMap = new Map(products.map((p) => {
    const op = p.outletProducts[0]
    return [p.id, op?.priceOverride ?? p.price]
  }))

  // ── Security: use server-side prices, ignore client unitPrice ──
  const verifiedItems = body.items.map((item) => {
    const price = priceMap.get(item.productId)!
    return {
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: price,
      subtotal: item.quantity * price,
      notes: item.notes,
    }
  })

  const subtotal = verifiedItems.reduce((sum, item) => sum + item.subtotal, 0)
  const discount = body.discount ?? 0

  // ── Security: cap discount to subtotal ──
  if (discount > subtotal) {
    return c.json({ error: 'Diskon tidak boleh melebihi total belanja' }, 400)
  }

  const total = subtotal - discount
  const changeAmount = body.paidAmount - total

  if (changeAmount < 0) {
    return c.json({ error: 'Jumlah bayar kurang dari total transaksi' }, 400)
  }

  const transaction = await prisma.transaction.create({
    data: {
      tenantId,
      outletId: body.outletId,
      shiftId: body.shiftId,
      userId,
      total,
      paymentMethod: body.paymentMethod,
      paidAmount: body.paidAmount,
      changeAmount,
      discount,
      notes: body.notes,
      items: {
        create: verifiedItems,
      },
    },
    include: {
      items: { include: { product: true } },
      shift: true,
    },
  })

  // Broadcast real-time event to all clients in this tenant
  broadcastToTenant(tenantId, {
    type: WS_EVENTS.TRANSACTION_CREATED,
    payload: {
      total: transaction.total,
      itemCount: transaction.items.length,
      paymentMethod: transaction.paymentMethod,
      createdAt: transaction.createdAt,
    },
  })

  return c.json(transaction, 201)
})

// GET /transactions — with date filter
transactionRoutes.get('/', async (c) => {
  const { tenantId } = c.get('auth')
  const { from, to, outletId, shiftId } = c.req.query()

  const transactions = await prisma.transaction.findMany({
    where: {
      tenantId,
      ...(outletId && { outletId }),
      ...(shiftId && { shiftId }),
      ...(from || to
        ? {
            createdAt: {
              ...(from && { gte: new Date(from) }),
              ...(to && { lte: new Date(to) }),
            },
          }
        : {}),
    },
    include: {
      items: { include: { product: { select: { name: true } } } },
      user: { select: { name: true } },
      outlet: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return c.json(transactions)
})

// GET /transactions/:id
transactionRoutes.get('/:id', async (c) => {
  const { tenantId } = c.get('auth')
  const tx = await prisma.transaction.findFirst({
    where: { id: c.req.param('id'), tenantId },
    include: {
      items: { include: { product: true } },
      user: { select: { name: true } },
      outlet: { select: { name: true } },
      shift: true,
    },
  })
  if (!tx) return c.json({ error: 'Transaksi tidak ditemukan' }, 404)
  return c.json(tx)
})

// POST /transactions/:id/void — soft delete transaction
transactionRoutes.post('/:id/void', async (c) => {
  const { tenantId, role } = c.get('auth')

  if (role !== 'OWNER') {
    return c.json({ error: 'Hanya owner yang bisa void transaksi' }, 403)
  }

  const id = c.req.param('id')
  const tx = await prisma.transaction.findFirst({
    where: { id, tenantId },
  })

  if (!tx) return c.json({ error: 'Transaksi tidak ditemukan' }, 404)

  // Check if already voided
  if (tx.notes?.startsWith('[VOID]')) {
    return c.json({ error: 'Transaksi sudah divoid' }, 409)
  }

  // Only allow void for today's transactions
  const txDate = new Date(tx.createdAt)
  const today = new Date()
  const isSameDay = txDate.toDateString() === today.toDateString()

  if (!isSameDay) {
    return c.json({ error: 'Hanya transaksi hari ini yang bisa divoid' }, 400)
  }

  const voided = await prisma.transaction.update({
    where: { id },
    data: {
      notes: `[VOID] ${tx.notes ?? ''}`.trim(),
      total: 0,
    },
  })

  await audit({ tenantId, userId, action: 'TRANSACTION_VOID', targetId: id, meta: { originalTotal: tx.total } })

  return c.json(voided)
})

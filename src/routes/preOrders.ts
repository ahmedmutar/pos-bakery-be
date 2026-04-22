import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../middleware/auth.js'

export const preOrderRoutes = new Hono()
preOrderRoutes.use('*', authMiddleware)

const preOrderItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
  unitPrice: z.number().int().positive(),
  customNotes: z.string().optional(),
})

const preOrderSchema = z.object({
  customerName: z.string().min(1),
  customerPhone: z.string().min(6),
  pickupDate: z.string(),
  dpAmount: z.number().int().min(0).optional(),
  notes: z.string().optional(),
  items: z.array(preOrderItemSchema).min(1),
})

// POST /pre-orders
preOrderRoutes.post('/', zValidator('json', preOrderSchema), async (c) => {
  const { tenantId } = c.get('auth')
  const body = c.req.valid('json')

  const total = body.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
  const dpAmount = body.dpAmount ?? 0
  const remainingAmount = total - dpAmount

  const preOrder = await prisma.preOrder.create({
    data: {
      tenantId,
      customerName: body.customerName,
      customerPhone: body.customerPhone,
      pickupDate: new Date(body.pickupDate),
      total,
      dpAmount,
      remainingAmount,
      notes: body.notes,
      items: {
        create: body.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          subtotal: item.quantity * item.unitPrice,
          customNotes: item.customNotes,
        })),
      },
    },
    include: { items: { include: { product: { select: { name: true } } } } },
  })

  return c.json(preOrder, 201)
})

// GET /pre-orders
preOrderRoutes.get('/', async (c) => {
  const { tenantId } = c.get('auth')
  const { status, from, to } = c.req.query()

  const preOrders = await prisma.preOrder.findMany({
    where: {
      tenantId,
      ...(status && { status: status as any }),
      ...(from || to
        ? {
            pickupDate: {
              ...(from && { gte: new Date(from) }),
              ...(to && { lte: new Date(to) }),
            },
          }
        : {}),
    },
    include: {
      items: { include: { product: { select: { name: true, imageUrl: true } } } },
    },
    orderBy: { pickupDate: 'asc' },
  })

  return c.json(preOrders)
})

// GET /pre-orders/:id
preOrderRoutes.get('/:id', async (c) => {
  const { tenantId } = c.get('auth')
  const preOrder = await prisma.preOrder.findFirst({
    where: { id: c.req.param('id'), tenantId },
    include: { items: { include: { product: true } } },
  })
  if (!preOrder) return c.json({ error: 'Pesanan tidak ditemukan' }, 404)
  return c.json(preOrder)
})

// PATCH /pre-orders/:id/status
preOrderRoutes.patch(
  '/:id/status',
  zValidator('json', z.object({ status: z.enum(['PENDING', 'CONFIRMED', 'IN_PRODUCTION', 'READY', 'COMPLETED', 'CANCELLED']) })),
  async (c) => {
    const { tenantId } = c.get('auth')
    const id = c.req.param('id')

    const existing = await prisma.preOrder.findFirst({ where: { id, tenantId } })
    if (!existing) return c.json({ error: 'Pesanan tidak ditemukan' }, 404)

    const updated = await prisma.preOrder.update({
      where: { id },
      data: { status: c.req.valid('json').status },
    })

    return c.json(updated)
  }
)

// POST /pre-orders/:id/pay-remaining — pelunasan
preOrderRoutes.post(
  '/:id/pay-remaining',
  zValidator('json', z.object({ amount: z.number().int().positive() })),
  async (c) => {
    const { tenantId } = c.get('auth')
    const id = c.req.param('id')
    const { amount } = c.req.valid('json')

    const existing = await prisma.preOrder.findFirst({ where: { id, tenantId } })
    if (!existing) return c.json({ error: 'Pesanan tidak ditemukan' }, 404)
    if (amount < existing.remainingAmount) {
      return c.json({ error: 'Jumlah pembayaran kurang dari sisa tagihan' }, 400)
    }

    const updated = await prisma.preOrder.update({
      where: { id },
      data: {
        dpAmount: { increment: amount },
        remainingAmount: { decrement: amount },
        status: 'COMPLETED',
      },
    })

    return c.json(updated)
  }
)

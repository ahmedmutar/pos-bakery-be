import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, requireRole } from '../middleware/auth.js'
import { requireFeature } from '../middleware/featureGate.js'

export const stockRoutes = new Hono()
stockRoutes.use('*', authMiddleware)

// ─── STOCK ADJUSTMENT (Basic+) ───────────────────────────────────────────────

// POST /stock/adjust — sesuaikan stok satu bahan
stockRoutes.post(
  '/adjust',
  requireRole('OWNER', 'PRODUCTION'),
  zValidator('json', z.object({
    ingredientId: z.string().uuid(),
    newQty:       z.number().min(0),
    reason:       z.string().min(1).max(200),
  })),
  async (c) => {
    const { tenantId, userId } = c.get('auth')
    const { ingredientId, newQty, reason } = c.req.valid('json')

    const ingredient = await prisma.ingredient.findFirst({
      where: { id: ingredientId, tenantId },
    })
    if (!ingredient) return c.json({ error: 'Bahan tidak ditemukan' }, 404)

    const previousQty = ingredient.currentStock
    const difference  = newQty - previousQty

    // Update stok
    await prisma.ingredient.update({
      where: { id: ingredientId },
      data: { currentStock: newQty },
    })

    // Log adjustment
    const adjustment = await prisma.stockAdjustment.create({
      data: { tenantId, ingredientId, userId, previousQty, newQty, difference, reason },
    })

    return c.json({ adjustment, ingredient: { ...ingredient, currentStock: newQty } })
  }
)

// GET /stock/adjustments — riwayat penyesuaian
stockRoutes.get('/adjustments', async (c) => {
  const { tenantId } = c.get('auth')
  const { ingredientId, limit = '20' } = c.req.query()

  const adjustments = await prisma.stockAdjustment.findMany({
    where: {
      tenantId,
      ...(ingredientId ? { ingredientId } : {}),
    },
    include: {
      ingredient: { select: { name: true, baseUnit: true } },
      user:       { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: parseInt(limit),
  })

  return c.json(adjustments)
})

// ─── STOCK OPNAME (Pro+) ─────────────────────────────────────────────────────

// GET /stock/opname — list opname
stockRoutes.get('/opname', requireFeature('hasExcelImport'), async (c) => {
  const { tenantId } = c.get('auth')

  const opnames = await prisma.stockOpname.findMany({
    where: { tenantId },
    include: {
      user:  { select: { name: true } },
      items: { include: { ingredient: { select: { name: true, baseUnit: true } } } },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })

  return c.json(opnames)
})

// POST /stock/opname — buat opname baru (snapshot stok saat ini)
stockRoutes.post(
  '/opname',
  requireFeature('hasExcelImport'),
  requireRole('OWNER', 'PRODUCTION'),
  zValidator('json', z.object({ notes: z.string().optional() })),
  async (c) => {
    const { tenantId, userId } = c.get('auth')
    const { notes } = c.req.valid('json')

    // Ambil semua bahan milik tenant
    const ingredients = await prisma.ingredient.findMany({
      where: { tenantId },
      select: { id: true, currentStock: true },
    })

    // Buat opname + items snapshot
    const opname = await prisma.stockOpname.create({
      data: {
        tenantId,
        conductedBy: userId,
        notes,
        items: {
          create: ingredients.map((ing) => ({
            ingredientId: ing.id,
            systemQty:   ing.currentStock,
          })),
        },
      },
      include: {
        items: { include: { ingredient: { select: { name: true, baseUnit: true } } } },
        user:  { select: { name: true } },
      },
    })

    return c.json(opname, 201)
  }
)

// GET /stock/opname/:id — detail opname
stockRoutes.get('/opname/:id', requireFeature('hasExcelImport'), async (c) => {
  const { tenantId } = c.get('auth')
  const opname = await prisma.stockOpname.findFirst({
    where: { id: c.req.param('id'), tenantId },
    include: {
      items: { include: { ingredient: { select: { name: true, baseUnit: true, type: true } } } },
      user:  { select: { name: true } },
    },
  })
  if (!opname) return c.json({ error: 'Opname tidak ditemukan' }, 404)
  return c.json(opname)
})

// PATCH /stock/opname/:id/items — input qty fisik per item
stockRoutes.patch(
  '/opname/:id/items',
  requireFeature('hasExcelImport'),
  requireRole('OWNER', 'PRODUCTION'),
  zValidator('json', z.object({
    items: z.array(z.object({
      id:          z.string().uuid(),
      physicalQty: z.number().min(0),
      notes:       z.string().optional(),
    })),
  })),
  async (c) => {
    const { tenantId } = c.get('auth')
    const { items } = c.req.valid('json')

    // Verify opname belongs to tenant
    const opname = await prisma.stockOpname.findFirst({
      where: { id: c.req.param('id'), tenantId, status: 'DRAFT' },
    })
    if (!opname) return c.json({ error: 'Opname tidak ditemukan atau sudah selesai' }, 404)

    // Update items
    await Promise.all(
      items.map((item) =>
        prisma.stockOpnameItem.update({
          where: { id: item.id },
          data: {
            physicalQty: item.physicalQty,
            difference:  item.physicalQty - 0, // will recalculate with systemQty below
            notes:       item.notes,
          },
        }).then(async (updated) => {
          // Recalculate difference
          return prisma.stockOpnameItem.update({
            where: { id: item.id },
            data: { difference: item.physicalQty - updated.systemQty },
          })
        })
      )
    )

    return c.json({ success: true })
  }
)

// POST /stock/opname/:id/finish — selesaikan opname & update stok
stockRoutes.post(
  '/opname/:id/finish',
  requireFeature('hasExcelImport'),
  requireRole('OWNER'),
  async (c) => {
    const { tenantId, userId } = c.get('auth')

    const opname = await prisma.stockOpname.findFirst({
      where: { id: c.req.param('id'), tenantId, status: 'DRAFT' },
      include: { items: true },
    })
    if (!opname) return c.json({ error: 'Opname tidak ditemukan atau sudah selesai' }, 404)

    // Update stok semua bahan berdasarkan qty fisik
    const itemsWithQty = opname.items.filter((i) => i.physicalQty !== null)

    await Promise.all(
      itemsWithQty.map((item) =>
        prisma.ingredient.update({
          where: { id: item.ingredientId },
          data: { currentStock: item.physicalQty! },
        })
      )
    )

    // Log adjustments untuk audit trail
    if (itemsWithQty.length > 0) {
      await prisma.stockAdjustment.createMany({
        data: itemsWithQty.map((item) => ({
          tenantId,
          ingredientId: item.ingredientId,
          userId,
          previousQty: item.systemQty,
          newQty:      item.physicalQty!,
          difference:  item.physicalQty! - item.systemQty,
          reason:      `Stock Opname #${opname.id.slice(0, 8)}`,
        })),
      })
    }

    // Mark as finished
    const finished = await prisma.stockOpname.update({
      where: { id: opname.id },
      data: { status: 'FINISHED', finishedAt: new Date() },
    })

    return c.json(finished)
  }
)

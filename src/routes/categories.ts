import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../middleware/auth.js'

export const categoryRoutes = new Hono()
categoryRoutes.use('*', authMiddleware)

const categorySchema = z.object({ name: z.string().min(1) })

categoryRoutes.get('/', async (c) => {
  const { tenantId } = c.get('auth')
  const categories = await prisma.category.findMany({
    where: { tenantId },
    orderBy: { name: 'asc' },
  })
  return c.json(categories)
})

categoryRoutes.post('/', zValidator('json', categorySchema), async (c) => {
  const { tenantId } = c.get('auth')
  const { name } = c.req.valid('json')
  const category = await prisma.category.create({ data: { tenantId, name } })
  return c.json(category, 201)
})

categoryRoutes.patch('/:id', zValidator('json', categorySchema), async (c) => {
  const { tenantId } = c.get('auth')
  const id = c.req.param('id')
  const existing = await prisma.category.findFirst({ where: { id, tenantId } })
  if (!existing) return c.json({ error: 'Kategori tidak ditemukan' }, 404)
  const category = await prisma.category.update({ where: { id }, data: c.req.valid('json') })
  return c.json(category)
})

categoryRoutes.delete('/:id', async (c) => {
  const { tenantId } = c.get('auth')
  const id = c.req.param('id')
  const existing = await prisma.category.findFirst({ where: { id, tenantId } })
  if (!existing) return c.json({ error: 'Kategori tidak ditemukan' }, 404)
  await prisma.category.delete({ where: { id } })
  return c.json({ message: 'Kategori dihapus' })
})

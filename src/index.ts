import 'dotenv/config'
import { createServer } from 'http'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { createWSServer } from './lib/websocket.js'
import { globalRateLimit, securityHeaders } from './middleware/security.js'
import { authRoutes } from './routes/auth.js'
import { outletRoutes } from './routes/outlets.js'
import { outletProductRoutes } from './routes/outletProducts.js'
import { settingsRoutes } from './routes/settings.js'
import { paymentRoutes } from './routes/payment.js'
import { categoryRoutes } from './routes/categories.js'
import { recipeRoutes } from './routes/recipes.js'
import { productionRoutes } from './routes/production.js'
import { productRoutes } from './routes/products.js'
import { transactionRoutes } from './routes/transactions.js'
import { inventoryRoutes } from './routes/inventory.js'
import { preOrderRoutes } from './routes/preOrders.js'
import { reportRoutes } from './routes/reports.js'
import { forecastRoutes } from './routes/forecast.js'
import { outletProductRoutes } from './routes/outletProducts.js'

const app = new Hono()

// ─── Global middleware ──────────────────────────────────────────────────────
app.use('*', logger())
app.use(
  '*',
  cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') ?? ['http://localhost:5173'],
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  })
)

// ─── Security ───────────────────────────────────────────────────────────────
app.use('*', securityHeaders)
app.use('*', globalRateLimit)

// ─── Health check ───────────────────────────────────────────────────────────
app.get('/', (c) => c.json({ status: 'ok', app: 'POS Bakery API', version: '1.0.0' }))

// ─── Routes ─────────────────────────────────────────────────────────────────
app.route('/api/auth', authRoutes)
app.route('/api/outlets', outletRoutes)
app.route('/api/outlet-products', outletProductRoutes)
app.route('/api/settings', settingsRoutes)
app.route('/api/payment', paymentRoutes)
app.route('/api/categories', categoryRoutes)
app.route('/api/recipes', recipeRoutes)
app.route('/api/production', productionRoutes)
app.route('/api/products', productRoutes)
app.route('/api/transactions', transactionRoutes)
app.route('/api/inventory', inventoryRoutes)
app.route('/api/pre-orders', preOrderRoutes)
app.route('/api/reports', reportRoutes)
app.route('/api/forecast', forecastRoutes)
app.route('/api/outlet-products', outletProductRoutes)

// ─── 404 & error ────────────────────────────────────────────────────────────
app.notFound((c) => c.json({ error: 'Route tidak ditemukan' }, 404))
app.onError((err, c) => { console.error(err); return c.json({ error: 'Internal server error' }, 500) })

// ─── Start HTTP + WebSocket server ──────────────────────────────────────────
const port = parseInt(process.env.PORT ?? '3000')

const server = serve({ fetch: app.fetch, port }, () => {
  console.log(`🥐 POS Bakery API berjalan di http://localhost:${port}`)
  createWSServer(server as unknown as import('http').Server)
})

import 'dotenv/config'
import { createServer } from 'http'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { createWSServer } from './lib/websocket.js'
import { globalRateLimit, securityHeaders } from './middleware/security.js'
import { trialGuard } from './middleware/trialGuard.js'
import { authRoutes } from './routes/auth.js'
import { outletRoutes } from './routes/outlets.js'
import { outletProductRoutes } from './routes/outletProducts.js'
import { settingsRoutes } from './routes/settings.js'
import { stockRoutes } from './routes/stock.js'
import { billingRoutes } from './routes/billing.js'
import { categoryRoutes } from './routes/categories.js'
import { recipeRoutes } from './routes/recipes.js'
import { productionRoutes } from './routes/production.js'
import { productRoutes } from './routes/products.js'
import { transactionRoutes } from './routes/transactions.js'
import { inventoryRoutes } from './routes/inventory.js'
import { preOrderRoutes } from './routes/preOrders.js'
import { reportRoutes } from './routes/reports.js'
import { forecastRoutes } from './routes/forecast.js'

// ─── Auto-migrate on startup ────────────────────────────────────────────────
async function runMigrations() {
  try {
    const { default: pg } = await import('pg')
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
    
    const migrations = [
      `CREATE TABLE IF NOT EXISTS "EmailOTP" (
        "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "email" TEXT NOT NULL,
        "otp" TEXT NOT NULL,
        "expiresAt" TIMESTAMP NOT NULL,
        "usedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS "PasswordResetToken" (
        "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "userId" TEXT NOT NULL REFERENCES "User"("id"),
        "token" TEXT NOT NULL UNIQUE,
        "expiresAt" TIMESTAMP NOT NULL,
        "usedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
      )`,
      `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SubscriptionStatus') THEN
          CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING', 'PAID', 'EXPIRED', 'FAILED');
        END IF;
      END $$`,
      `CREATE TABLE IF NOT EXISTS "Subscription" (
        "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id"),
        "plan" TEXT NOT NULL,
        "status" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING',
        "xenditInvoiceId" TEXT UNIQUE,
        "xenditPaymentId" TEXT,
        "amount" INTEGER NOT NULL,
        "periodStart" TIMESTAMP,
        "periodEnd" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "paidAt" TIMESTAMP
      )`,
      `ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "isVoided" BOOLEAN NOT NULL DEFAULT false`,
      `ALTER TABLE "OutletProduct" ADD COLUMN IF NOT EXISTS "isAvailable" BOOLEAN NOT NULL DEFAULT true`,
      `ALTER TABLE "OutletProduct" ADD COLUMN IF NOT EXISTS "stock" INTEGER`,
      `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "trialEndsAt" TIMESTAMP`,
      `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "bankName" TEXT`,
      `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "bankAccount" TEXT`,
      `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "bankHolder" TEXT`,
      `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "qrisImageUrl" TEXT`,
      `ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "paymentProof" TEXT`,
    ]

    for (const sql of migrations) {
      await pool.query(sql).catch((e: Error) => {
        if (!e.message.includes('already exists')) {
          console.error('[Migration] Error:', e.message)
        }
      })
    }

    await pool.end()
    console.log('[Migration] ✓ Database up to date')
  } catch (e) {
    console.error('[Migration] Failed:', e)
  }
}

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

// Trial guard — runs after auth middleware on all protected routes
app.use('/api/*', trialGuard)

// ─── Routes ─────────────────────────────────────────────────────────────────
app.route('/api/auth', authRoutes)
app.route('/api/outlets', outletRoutes)
app.route('/api/outlet-products', outletProductRoutes)
app.route('/api/settings', settingsRoutes)
app.route('/api/stock', stockRoutes)
app.route('/api/billing', billingRoutes)
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

// Run migrations then start server
await runMigrations()

const server = serve({ fetch: app.fetch, port }, () => {
  console.log(`🥐 Sajiin API berjalan di http://localhost:${port}`)
  createWSServer(server as unknown as import('http').Server)
})

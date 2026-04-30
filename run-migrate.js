// Jalankan: node run-migrate.js
import 'dotenv/config'
import pg from 'pg'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

const migrations = [
  `CREATE TABLE IF NOT EXISTS "EmailOTP" (
    "id"        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "email"     TEXT NOT NULL,
    "otp"       TEXT NOT NULL,
    "expiresAt" TIMESTAMP NOT NULL,
    "usedAt"    TIMESTAMP,
    "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS "PasswordResetToken" (
    "id"        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "userId"    TEXT NOT NULL REFERENCES "User"("id"),
    "token"     TEXT NOT NULL UNIQUE,
    "expiresAt" TIMESTAMP NOT NULL,
    "usedAt"    TIMESTAMP,
    "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SubscriptionStatus') THEN
      CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING','PAID','EXPIRED','FAILED');
    END IF;
  END $$`,
  `CREATE TABLE IF NOT EXISTS "Subscription" (
    "id"              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "tenantId"        TEXT NOT NULL REFERENCES "Tenant"("id"),
    "plan"            TEXT NOT NULL,
    "status"          "SubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "xenditInvoiceId" TEXT UNIQUE,
    "xenditPaymentId" TEXT,
    "amount"          INTEGER NOT NULL,
    "periodStart"     TIMESTAMP,
    "periodEnd"       TIMESTAMP,
    "createdAt"       TIMESTAMP NOT NULL DEFAULT NOW(),
    "paidAt"          TIMESTAMP
  )`,
  `ALTER TABLE "Transaction"   ADD COLUMN IF NOT EXISTS "isVoided"     BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "Transaction"   ADD COLUMN IF NOT EXISTS "paymentProof" TEXT`,
  `ALTER TABLE "OutletProduct" ADD COLUMN IF NOT EXISTS "isAvailable"  BOOLEAN NOT NULL DEFAULT true`,
  `ALTER TABLE "OutletProduct" ADD COLUMN IF NOT EXISTS "stock"        INTEGER`,
  `ALTER TABLE "Tenant"        ADD COLUMN IF NOT EXISTS "trialEndsAt"  TIMESTAMP`,
  `ALTER TABLE "Tenant"        ADD COLUMN IF NOT EXISTS "bankName"     TEXT`,
  `ALTER TABLE "Tenant"        ADD COLUMN IF NOT EXISTS "bankAccount"  TEXT`,
  `ALTER TABLE "Tenant"        ADD COLUMN IF NOT EXISTS "bankHolder"   TEXT`,
  `ALTER TABLE "Tenant"        ADD COLUMN IF NOT EXISTS "qrisImageUrl" TEXT`,
]

let ok = 0, skip = 0, fail = 0
for (const sql of migrations) {
  try {
    await pool.query(sql)
    ok++
  } catch (e) {
    if (e.message.includes('already exists') || e.message.includes('duplicate')) {
      skip++
    } else {
      console.error('✗', e.message.split('\n')[0])
      fail++
    }
  }
}

console.log(`\n✅ Migration selesai: ${ok} berhasil, ${skip} dilewati, ${fail} gagal`)
await pool.end()

import 'dotenv/config'
import pg from 'pg'

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
})
console.log('🔄 Menjalankan migration...')

await pool.query(`
  -- Enums
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Role') THEN
      CREATE TYPE "Role" AS ENUM ('OWNER', 'CASHIER', 'PRODUCTION');
    END IF;
  END $$;

  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'IngredientType') THEN
      CREATE TYPE "IngredientType" AS ENUM ('INGREDIENT', 'EQUIPMENT', 'PACKAGING');
    END IF;
  END $$;

  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrderStatus') THEN
      CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'IN_PRODUCTION', 'READY', 'COMPLETED', 'CANCELLED');
    END IF;
  END $$;

  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentMethod') THEN
      CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'QRIS', 'TRANSFER', 'SPLIT');
    END IF;
  END $$;

  -- Tenant
  CREATE TABLE IF NOT EXISTS "Tenant" (
    "id"        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "name"      TEXT NOT NULL,
    "slug"      TEXT NOT NULL UNIQUE,
    "plan"      TEXT NOT NULL DEFAULT 'basic',
    "isActive"  BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
    "logoUrl"      TEXT,
    "trialEndsAt"  TIMESTAMP
  );

  -- User
  CREATE TABLE IF NOT EXISTS "User" (
    "id"           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "tenantId"     TEXT NOT NULL REFERENCES "Tenant"("id"),
    "name"         TEXT NOT NULL,
    "email"        TEXT NOT NULL UNIQUE,
    "passwordHash" TEXT NOT NULL,
    "role"         "Role" NOT NULL DEFAULT 'CASHIER',
    "isActive"     BOOLEAN NOT NULL DEFAULT true,
    "avatarUrl"    TEXT,
    "createdAt"    TIMESTAMP NOT NULL DEFAULT NOW()
  );

  -- Outlet
  CREATE TABLE IF NOT EXISTS "Outlet" (
    "id"        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "tenantId"  TEXT NOT NULL REFERENCES "Tenant"("id"),
    "name"      TEXT NOT NULL,
    "address"   TEXT,
    "isActive"  BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
  );

  -- Category
  CREATE TABLE IF NOT EXISTS "Category" (
    "id"        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "tenantId"  TEXT NOT NULL REFERENCES "Tenant"("id"),
    "name"      TEXT NOT NULL,
    "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
  );

  -- Product
  CREATE TABLE IF NOT EXISTS "Product" (
    "id"         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "tenantId"   TEXT NOT NULL REFERENCES "Tenant"("id"),
    "categoryId" TEXT REFERENCES "Category"("id"),
    "name"       TEXT NOT NULL,
    "price"      INTEGER NOT NULL DEFAULT 0,
    "imageUrl"   TEXT,
    "isActive"   BOOLEAN NOT NULL DEFAULT true,
    "createdAt"  TIMESTAMP NOT NULL DEFAULT NOW()
  );

  -- OutletProduct
  CREATE TABLE IF NOT EXISTS "OutletProduct" (
    "id"        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "outletId"  TEXT NOT NULL REFERENCES "Outlet"("id"),
    "productId" TEXT NOT NULL REFERENCES "Product"("id"),
    "priceOverride" INTEGER,
    "isActive"      BOOLEAN NOT NULL DEFAULT true,
    UNIQUE("outletId", "productId")
  );

  -- Shift
  CREATE TABLE IF NOT EXISTS "Shift" (
    "id"          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "tenantId"    TEXT NOT NULL REFERENCES "Tenant"("id"),
    "outletId"    TEXT NOT NULL REFERENCES "Outlet"("id"),
    "userId"      TEXT NOT NULL REFERENCES "User"("id"),
    "openedAt"    TIMESTAMP NOT NULL DEFAULT NOW(),
    "closedAt"    TIMESTAMP,
    "openingCash" INTEGER NOT NULL DEFAULT 0,
    "closingCash" INTEGER,
    "cashDiff"    INTEGER,
    "notes"       TEXT
  );

  -- Transaction
  CREATE TABLE IF NOT EXISTS "Transaction" (
    "id"            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "tenantId"      TEXT NOT NULL REFERENCES "Tenant"("id"),
    "outletId"      TEXT NOT NULL REFERENCES "Outlet"("id"),
    "shiftId"       TEXT NOT NULL REFERENCES "Shift"("id"),
    "userId"        TEXT NOT NULL REFERENCES "User"("id"),
    "total"         INTEGER NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "paidAmount"    INTEGER NOT NULL DEFAULT 0,
    "changeAmount"  INTEGER NOT NULL DEFAULT 0,
    "discount"      INTEGER NOT NULL DEFAULT 0,
    "notes"         TEXT,
    "createdAt"     TIMESTAMP NOT NULL DEFAULT NOW()
  );

  -- TransactionItem
  CREATE TABLE IF NOT EXISTS "TransactionItem" (
    "id"            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "transactionId" TEXT NOT NULL REFERENCES "Transaction"("id"),
    "productId"     TEXT NOT NULL REFERENCES "Product"("id"),
    "quantity"      INTEGER NOT NULL,
    "unitPrice"     INTEGER NOT NULL,
    "subtotal"      INTEGER NOT NULL,
    "notes"         TEXT
  );

  -- Supplier
  CREATE TABLE IF NOT EXISTS "Supplier" (
    "id"        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "tenantId"  TEXT NOT NULL REFERENCES "Tenant"("id"),
    "name"      TEXT NOT NULL,
    "phone"     TEXT,
    "address"   TEXT
  );

  -- Ingredient
  CREATE TABLE IF NOT EXISTS "Ingredient" (
    "id"           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "tenantId"     TEXT NOT NULL REFERENCES "Tenant"("id"),
    "name"         TEXT NOT NULL,
    "type"         "IngredientType" NOT NULL DEFAULT 'INGREDIENT',
    "baseUnit"     TEXT NOT NULL,
    "currentStock" FLOAT NOT NULL DEFAULT 0,
    "minimumStock" FLOAT NOT NULL DEFAULT 0,
    "currentPrice" INTEGER NOT NULL DEFAULT 0,
    "notes"        TEXT
  );

  -- Purchase
  CREATE TABLE IF NOT EXISTS "Purchase" (
    "id"         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "tenantId"   TEXT NOT NULL REFERENCES "Tenant"("id"),
    "supplierId" TEXT REFERENCES "Supplier"("id"),
    "date"       TIMESTAMP NOT NULL DEFAULT NOW(),
    "notes"      TEXT,
    "total"      INTEGER NOT NULL DEFAULT 0
  );

  -- PurchaseItem
  CREATE TABLE IF NOT EXISTS "PurchaseItem" (
    "id"           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "purchaseId"   TEXT NOT NULL REFERENCES "Purchase"("id"),
    "ingredientId" TEXT NOT NULL REFERENCES "Ingredient"("id"),
    "quantity"     FLOAT NOT NULL,
    "unit"         TEXT NOT NULL,
    "unitFactor"   FLOAT NOT NULL DEFAULT 1,
    "pricePerUnit" INTEGER NOT NULL
  );

  -- Recipe
  CREATE TABLE IF NOT EXISTS "Recipe" (
    "id"           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "tenantId"     TEXT NOT NULL REFERENCES "Tenant"("id"),
    "productId"    TEXT NOT NULL UNIQUE REFERENCES "Product"("id"),
    "batchSize"    INTEGER NOT NULL DEFAULT 1,
    "notes"        TEXT,
    "instructions" TEXT
  );

  -- RecipeItem
  CREATE TABLE IF NOT EXISTS "RecipeItem" (
    "id"           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "recipeId"     TEXT NOT NULL REFERENCES "Recipe"("id"),
    "ingredientId" TEXT NOT NULL REFERENCES "Ingredient"("id"),
    "amount"       FLOAT NOT NULL,
    "unit"         TEXT NOT NULL,
    "unitFactor"   FLOAT NOT NULL DEFAULT 1
  );

  -- ProductionPlan
  CREATE TABLE IF NOT EXISTS "ProductionPlan" (
    "id"        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "tenantId"  TEXT NOT NULL REFERENCES "Tenant"("id"),
    "date"      TIMESTAMP NOT NULL DEFAULT NOW(),
    "notes"     TEXT,
    "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
  );

  -- ProductionPlanItem
  CREATE TABLE IF NOT EXISTS "ProductionPlanItem" (
    "id"            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "planId"        TEXT NOT NULL REFERENCES "ProductionPlan"("id"),
    "productId"     TEXT NOT NULL REFERENCES "Product"("id"),
    "targetQty"     INTEGER NOT NULL DEFAULT 0,
    "actualQty"     INTEGER,
    "wasteQty"      INTEGER,
    "unsoldQty"     INTEGER,
    "wasteCategory" TEXT
  );

  -- PreOrder
  CREATE TABLE IF NOT EXISTS "PreOrder" (
    "id"              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "tenantId"        TEXT NOT NULL REFERENCES "Tenant"("id"),
    "customerName"    TEXT NOT NULL,
    "customerPhone"   TEXT,
    "pickupDate"      TIMESTAMP NOT NULL,
    "total"           INTEGER NOT NULL DEFAULT 0,
    "dpAmount"        INTEGER NOT NULL DEFAULT 0,
    "remainingAmount" INTEGER NOT NULL DEFAULT 0,
    "status"          "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "notes"           TEXT,
    "createdAt"       TIMESTAMP NOT NULL DEFAULT NOW()
  );

  -- PreOrderItem
  CREATE TABLE IF NOT EXISTS "PreOrderItem" (
    "id"          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "preOrderId"  TEXT NOT NULL REFERENCES "PreOrder"("id"),
    "productId"   TEXT NOT NULL REFERENCES "Product"("id"),
    "quantity"    INTEGER NOT NULL,
    "unitPrice"   INTEGER NOT NULL,
    "subtotal"    INTEGER NOT NULL,
    "customNotes" TEXT
  );

  -- AuditLog
  CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id"        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "tenantId"  TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "action"    TEXT NOT NULL,
    "entity"    TEXT NOT NULL,
    "entityId"  TEXT,
    "detail"    TEXT,
    "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
  );

  -- Add columns for existing DBs

  -- StockOpname
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StockOpnameStatus') THEN
      CREATE TYPE "StockOpnameStatus" AS ENUM ('DRAFT', 'FINISHED');
    END IF;
  END $$;

  CREATE TABLE IF NOT EXISTS "StockOpname" (
    "id"          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "tenantId"    TEXT NOT NULL REFERENCES "Tenant"("id"),
    "conductedBy" TEXT NOT NULL REFERENCES "User"("id"),
    "notes"       TEXT,
    "status"      "StockOpnameStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt"   TIMESTAMP NOT NULL DEFAULT NOW(),
    "finishedAt"  TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS "StockOpnameItem" (
    "id"           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "opnameId"     TEXT NOT NULL REFERENCES "StockOpname"("id"),
    "ingredientId" TEXT NOT NULL REFERENCES "Ingredient"("id"),
    "systemQty"    FLOAT NOT NULL,
    "physicalQty"  FLOAT,
    "difference"   FLOAT,
    "notes"        TEXT
  );

  CREATE TABLE IF NOT EXISTS "StockAdjustment" (
    "id"           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "tenantId"     TEXT NOT NULL REFERENCES "Tenant"("id"),
    "ingredientId" TEXT NOT NULL REFERENCES "Ingredient"("id"),
    "userId"       TEXT NOT NULL REFERENCES "User"("id"),
    "previousQty"  FLOAT NOT NULL,
    "newQty"       FLOAT NOT NULL,
    "difference"   FLOAT NOT NULL,
    "reason"       TEXT NOT NULL,
    "createdAt"    TIMESTAMP NOT NULL DEFAULT NOW()
  );
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SubscriptionStatus') THEN
      CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING', 'PAID', 'EXPIRED', 'FAILED');
    END IF;
  END $$;

  CREATE TABLE IF NOT EXISTS "Subscription" (
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
  );

  CREATE TABLE IF NOT EXISTS "EmailOTP" (
    "id"        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "email"     TEXT NOT NULL,
    "otp"       TEXT NOT NULL,
    "expiresAt" TIMESTAMP NOT NULL,
    "usedAt"    TIMESTAMP,
    "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS "PasswordResetToken" (
    "id"        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "userId"    TEXT NOT NULL REFERENCES "User"("id"),
    "token"     TEXT NOT NULL UNIQUE,
    "expiresAt" TIMESTAMP NOT NULL,
    "usedAt"    TIMESTAMP,
    "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
  );

  ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "trialEndsAt"  TIMESTAMP;
  ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "isVoided" BOOLEAN NOT NULL DEFAULT false;
  ALTER TABLE "OutletProduct" ADD COLUMN IF NOT EXISTS "isAvailable" BOOLEAN NOT NULL DEFAULT true;
  ALTER TABLE "OutletProduct" ADD COLUMN IF NOT EXISTS "stock" INTEGER;
  -- Rename price -> priceOverride in OutletProduct if old column exists
  DO $$ BEGIN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'OutletProduct' AND column_name = 'price'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'OutletProduct' AND column_name = 'priceOverride'
    ) THEN
      ALTER TABLE "OutletProduct" RENAME COLUMN "price" TO "priceOverride";
    END IF;
  END $$;
  ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "bankName"     TEXT;
  ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "bankAccount"  TEXT;
  ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "bankHolder"   TEXT;
  ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "qrisImageUrl" TEXT;
  ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "paymentProof" TEXT;
`)

console.log('✅ Migration berhasil')
await pool.end()

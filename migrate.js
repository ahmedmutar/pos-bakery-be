import 'dotenv/config'
import pg from 'pg'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

await pool.query(`
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'IngredientType') THEN
      CREATE TYPE "IngredientType" AS ENUM ('INGREDIENT', 'EQUIPMENT', 'PACKAGING');
    END IF;
  END $$;
  ALTER TABLE "Ingredient"  ADD COLUMN IF NOT EXISTS "type"         "IngredientType" NOT NULL DEFAULT 'INGREDIENT';
  ALTER TABLE "Ingredient"  ADD COLUMN IF NOT EXISTS "notes"        TEXT;
  ALTER TABLE "Tenant"      ADD COLUMN IF NOT EXISTS "logoUrl"      TEXT;
  ALTER TABLE "User"        ADD COLUMN IF NOT EXISTS "avatarUrl"    TEXT;
  ALTER TABLE "Recipe"      ADD COLUMN IF NOT EXISTS "instructions" TEXT;
`)

console.log('Migration berhasil')
await pool.end()

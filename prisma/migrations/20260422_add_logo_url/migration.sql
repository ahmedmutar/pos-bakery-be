-- AlterTable: add logoUrl to Tenant
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "logoUrl" TEXT;

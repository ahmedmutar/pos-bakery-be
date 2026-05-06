# Setup Supabase + Render

## 1. Buat Project Supabase

1. Buka [supabase.com](https://supabase.com) → Sign up → New Project
2. Isi:
   - **Name**: sajiin
   - **Database Password**: buat password kuat, simpan baik-baik
   - **Region**: Southeast Asia (Singapore)
3. Tunggu ~2 menit sampai project siap

## 2. Ambil Connection Strings

Buka **Project Settings** → **Database** → scroll ke **Connection string**

Salin dua URL berikut:

### DATABASE_URL (Transaction Pooler — port 6543)
```
postgresql://postgres.xxxx:[PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
```
Pastikan tambahkan `?pgbouncer=true` di akhir URL:
```
postgresql://postgres.xxxx:[PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true
```

### DIRECT_URL (Direct Connection — port 5432)
```
postgresql://postgres.xxxx:[PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
```

## 3. Setup di Render

Di Render → Service → Environment, tambahkan:

```
DATABASE_URL  = postgresql://postgres.xxxx:[PASS]@...pooler.supabase.com:6543/postgres?pgbouncer=true
DIRECT_URL    = postgresql://postgres.xxxx:[PASS]@...pooler.supabase.com:5432/postgres
```

## 4. Jalankan Migrasi

Setelah deploy pertama, buka **Render Shell** (atau jalankan di lokal dengan URL Supabase):

```bash
# Set environment variable
export DATABASE_URL="postgresql://postgres.xxxx:[PASS]@...6543/postgres?pgbouncer=true"
export DIRECT_URL="postgresql://postgres.xxxx:[PASS]@...5432/postgres"
export NODE_ENV=production

# Jalankan migrasi
node migrate.js
```

Atau lewat Supabase SQL Editor:
- Dashboard Supabase → **SQL Editor**
- Copy-paste isi file `migrate.js` bagian SQL CREATE TABLE

## 5. Verifikasi

Buka Supabase → **Table Editor** — semua tabel harus sudah ada:
- Tenant, User, Outlet, Product, Transaction, dll.

## Keuntungan Supabase vs Render PostgreSQL

| | Render DB Free | Supabase Free |
|---|---|---|
| Storage | 1GB | 500MB |
| Expire | 90 hari | **Tidak expire** |
| Connection pooling | Tidak | **Ya (PgBouncer)** |
| Dashboard | Tidak | **Ya (Table Editor, SQL)** |
| Backup | Tidak | Harian |
| Harga setelah free | $7/bulan | $25/bulan (Pro) |

## Tips

- Jangan simpan password di kode — selalu dari environment variable
- Supabase free tier cukup untuk ratusan tenant
- Jika storage mendekati 500MB, archive data lama atau upgrade ke Pro

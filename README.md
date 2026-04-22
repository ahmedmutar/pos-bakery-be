# POS Bakery — Backend API

Backend untuk aplikasi POS Bakery. Dibangun dengan Node.js, Hono, Prisma, dan PostgreSQL.

---

## Prasyarat

- Node.js 18+
- PostgreSQL 14+ (lokal atau cloud)
- npm

---

## Setup lokal

### 1. Clone dan install dependency

```bash
cd pos-bakery-api
npm install
```

### 2. Buat file .env

```bash
cp .env.example .env
```

Edit `.env` dengan credential database lokal:

```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/pos_bakery"
JWT_SECRET="isi-dengan-string-random-minimal-32-karakter"
JWT_EXPIRES_IN="7d"
PORT=3000
NODE_ENV=development
```

### 3. Buat database

Di PostgreSQL, buat database baru:

```sql
CREATE DATABASE pos_bakery;
```

### 4. Generate Prisma client dan jalankan migrasi

```bash
npm run db:generate
npm run db:migrate
```

Saat diminta nama migrasi, isi misalnya: `init`

### 5. Jalankan server

```bash
npm run dev
```

Server berjalan di `http://localhost:3000`

---

## Struktur folder

```
src/
├── index.ts              # Entry point, semua route dimount di sini
├── lib/
│   ├── prisma.ts         # Prisma client singleton
│   └── jwt.ts            # Sign dan verify JWT
├── middleware/
│   └── auth.ts           # JWT middleware + role guard
└── routes/
    ├── auth.ts           # Register, login, me
    ├── products.ts       # CRUD produk + food cost
    ├── transactions.ts   # Kasir, shift buka/tutup
    ├── inventory.ts      # Bahan baku, pembelian, stok opname
    ├── preOrders.ts      # Pesanan kustom + pre-order
    └── reports.ts        # Dashboard, top produk, laporan penjualan, waste
```

---

## Endpoint API

### Auth
| Method | Endpoint | Keterangan |
|--------|----------|------------|
| POST | `/api/auth/register` | Daftar tenant baru + owner |
| POST | `/api/auth/login` | Login |
| GET | `/api/auth/me` | Data user yang sedang login |

### Produk
| Method | Endpoint | Keterangan |
|--------|----------|------------|
| GET | `/api/products` | Daftar produk (bisa filter) |
| POST | `/api/products` | Tambah produk |
| PATCH | `/api/products/:id` | Edit produk |
| DELETE | `/api/products/:id` | Nonaktifkan produk |
| GET | `/api/products/:id/food-cost` | Kalkulasi food cost |

### Transaksi & Shift
| Method | Endpoint | Keterangan |
|--------|----------|------------|
| POST | `/api/transactions/shifts/open` | Buka shift kasir |
| POST | `/api/transactions/shifts/:id/close` | Tutup shift + rekap kas |
| GET | `/api/transactions/shifts/active` | Cek shift aktif |
| POST | `/api/transactions` | Buat transaksi |
| GET | `/api/transactions` | Riwayat transaksi |

### Inventory
| Method | Endpoint | Keterangan |
|--------|----------|------------|
| GET | `/api/inventory/ingredients` | Daftar bahan baku |
| POST | `/api/inventory/ingredients` | Tambah bahan |
| PATCH | `/api/inventory/ingredients/:id` | Edit bahan |
| POST | `/api/inventory/ingredients/:id/adjust` | Stok opname |
| POST | `/api/inventory/purchases` | Input pembelian (stok otomatis naik) |
| GET | `/api/inventory/purchases` | Riwayat pembelian |

### Pre-order
| Method | Endpoint | Keterangan |
|--------|----------|------------|
| POST | `/api/pre-orders` | Buat pesanan kustom |
| GET | `/api/pre-orders` | Daftar pesanan |
| GET | `/api/pre-orders/:id` | Detail pesanan |
| PATCH | `/api/pre-orders/:id/status` | Update status pesanan |
| POST | `/api/pre-orders/:id/pay-remaining` | Catat pelunasan |

### Laporan
| Method | Endpoint | Keterangan |
|--------|----------|------------|
| GET | `/api/reports/dashboard` | Ringkasan hari ini |
| GET | `/api/reports/top-products` | Produk terlaris |
| GET | `/api/reports/sales-summary` | Rekap penjualan |
| GET | `/api/reports/waste` | Laporan waste |

---

## Deploy ke Railway

1. Push ke GitHub repository
2. Buat project baru di [railway.app](https://railway.app)
3. Tambah PostgreSQL plugin dari Railway dashboard
4. Set environment variables:
   - `DATABASE_URL` — otomatis diisi Railway dari plugin PostgreSQL
   - `JWT_SECRET` — isi manual dengan string random
   - `NODE_ENV` — `production`
5. Set start command: `npm run build && npm start`
6. Deploy

---

## Catatan penting

- Setiap request ke endpoint selain `/api/auth/login` dan `/api/auth/register` wajib menyertakan header:
  ```
  Authorization: Bearer <token>
  ```
- Semua data otomatis terisolasi per tenant — tidak ada data bocor antar toko
- Harga disimpan dalam **rupiah integer** (bukan desimal) untuk menghindari floating point error

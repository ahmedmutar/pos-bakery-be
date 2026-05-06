# Deploy ke Render

## Langkah-langkah

### 1. Buat akun Render
Daftar di [render.com](https://render.com) → gratis

### 2. Deploy Database dulu
1. Dashboard → **New** → **PostgreSQL**
2. Name: `sajiin-db`
3. Region: **Singapore**
4. Plan: **Free**
5. Klik **Create Database**
6. Salin **Internal Database URL** — akan dipakai otomatis oleh `render.yaml`

### 3. Deploy Backend
**Opsi A — via render.yaml (otomatis):**
1. Push kode ke GitHub
2. Dashboard → **New** → **Blueprint**
3. Connect repo → Render baca `render.yaml` otomatis
4. Klik **Apply**

**Opsi B — manual:**
1. Dashboard → **New** → **Web Service**
2. Connect repo atau upload zip
3. Isi settings:
   - Runtime: `Node`
   - Build: `npm install && npx prisma generate`
   - Start: `npm start`
   - Region: Singapore
4. Tambah environment variables

### 4. Isi variabel yang perlu diisi manual
Setelah service dibuat, buka **Environment** tab dan tambahkan:
```
BREVO_API_KEY        = xkeysib-xxx
XENDIT_SECRET_KEY    = xnd_development_xxx
XENDIT_WEBHOOK_TOKEN = xxx
ALLOWED_ORIGINS      = https://nama-app.vercel.app
APP_URL              = https://nama-app.vercel.app
```

### 5. Update URL di Vercel
Setelah Render kasih URL (misal `https://sajiin-api.onrender.com`):
- Perbarui `VITE_API_URL` di Vercel environment variables
- Perbarui webhook Xendit di dashboard Xendit

### 6. Setup UptimeRobot (agar tidak sleep)
1. Daftar di [uptimerobot.com](https://uptimerobot.com) — gratis
2. Add Monitor → HTTP(s)
3. URL: `https://sajiin-api.onrender.com`
4. Interval: **5 minutes**
5. Save

---

## Perbedaan vs Railway

| | Railway | Render Free |
|---|---|---|
| Sleep | Tidak | Ya (15 menit idle) |
| Solusi sleep | - | UptimeRobot ping |
| Database | PostgreSQL plugin | PostgreSQL terpisah |
| Region | Auto | Singapore (pilih manual) |
| Credit gratis | $5/bulan | 750 jam/bulan |
| Harga setelah free | ~$5–10/bulan | ~$7/bulan |

## Catatan
- Free tier Render = **750 jam/bulan** ≈ ~31 hari (cukup untuk 1 service)
- Database free = **1GB storage**, expire setelah **90 hari** → perlu upgrade atau migrate
- Setelah 90 hari database free expire, upgrade ke Starter $7/bulan atau pindah ke Supabase (gratis permanen)

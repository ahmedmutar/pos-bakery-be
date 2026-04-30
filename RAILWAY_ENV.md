# Railway Environment Variables

## Wajib (Required)

| Variable | Contoh | Keterangan |
|---|---|---|
| `DATABASE_URL` | `postgresql://user:pass@host:port/db` | Otomatis diisi Railway jika pakai PostgreSQL plugin |
| `JWT_SECRET` | string random 64 karakter | Generate: `openssl rand -hex 32` |
| `ALLOWED_ORIGINS` | `https://pos-bakery-fe.vercel.app` | URL frontend Vercel, pisahkan dengan koma jika lebih dari satu |
| `APP_URL` | `https://pos-bakery-fe.vercel.app` | URL frontend, dipakai untuk redirect setelah payment |

## Xendit (Payment Gateway)

| Variable | UAT | Production |
|---|---|---|
| `XENDIT_SECRET_KEY` | `xnd_development_xxx` | `xnd_production_xxx` |
| `XENDIT_WEBHOOK_TOKEN` | dari Xendit dashboard (Test) | dari Xendit dashboard (Live) |

> Ambil di: dashboard.xendit.co → Settings → API Keys
> Toggle Test/Live di pojok kanan atas dashboard

## Email / SMTP (Opsional tapi direkomendasikan)

| Variable | Nilai |
|---|---|
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `SMTP_SECURE` | `false` |
| `SMTP_USER` | `email@gmail.com` |
| `SMTP_PASS` | Gmail App Password (bukan password biasa) |
| `SMTP_FROM` | `Roti POS <noreply@gmail.com>` |

> Tanpa SMTP: OTP tetap berfungsi (di-log ke console), notifikasi email tidak terkirim

## Notifikasi Admin

| Variable | Nilai |
|---|---|
| `ADMIN_NOTIFICATION_EMAIL` | email Anda yang menerima notifikasi registrasi baru |
| `ADMIN_WHATSAPP` | `6285947566558` |

## Opsional

| Variable | Default | Keterangan |
|---|---|---|
| `PORT` | `3000` | Railway otomatis set ini |
| `NODE_ENV` | `production` | Set ke `uat` untuk environment UAT |
| `JWT_EXPIRES_IN` | `7d` | Durasi token login |
| `SUPER_ADMIN_KEY` | — | Key untuk akses endpoint super admin |

---

## Cara set di Railway

1. Buka project Railway
2. Klik service backend
3. Tab **Variables**
4. Klik **New Variable** atau **Raw Editor** untuk paste semua sekaligus

## Webhook Xendit

Setelah deploy, tambahkan webhook URL di Xendit dashboard:

```
https://your-railway-url.up.railway.app/api/billing/webhook
```

Dashboard Xendit → Settings → Webhooks → Add webhook URL
Event yang perlu diaktifkan: `invoice.paid`

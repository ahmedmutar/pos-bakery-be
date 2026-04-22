import nodemailer from 'nodemailer'

// Configure via environment variables
// SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
// Supports any SMTP: Gmail, Mailgun, SendGrid, Resend, etc.

function createTransport() {
  const host = process.env.SMTP_HOST
  if (!host) return null // Email disabled if not configured

  return nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT ?? '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  })
}

const FROM = process.env.SMTP_FROM ?? 'Roti POS <noreply@rotipOS.com>'
const APP_URL = process.env.APP_URL ?? 'https://app.rotipOS.com'

export async function sendWelcomeEmail(params: {
  to: string
  ownerName: string
  tenantName: string
  plan: string
}) {
  const transport = createTransport()
  if (!transport) {
    console.log('[Email] SMTP not configured, skipping welcome email')
    return
  }

  const planLabel: Record<string, string> = {
    basic: 'Basic',
    pro: 'Pro',
    enterprise: 'Enterprise',
  }

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; color: #2c1e15; background: #fdf8f0; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 40px auto; background: white; border-radius: 16px; overflow: hidden; }
    .header { background: #b5722a; padding: 32px; text-align: center; }
    .header h1 { color: #fdf5e8; font-size: 24px; margin: 0; }
    .header p { color: #f7edda; margin: 8px 0 0; font-size: 14px; }
    .body { padding: 32px; }
    .body h2 { font-size: 20px; color: #2c1e15; }
    .body p { font-size: 15px; line-height: 1.6; color: #5c381a; }
    .plan-badge { display: inline-block; background: #fdf5e8; border: 1px solid #e0c08a;
                  color: #b5722a; padding: 4px 12px; border-radius: 100px; font-size: 13px; font-weight: bold; }
    .cta { display: block; margin: 24px auto; width: fit-content; background: #b5722a;
           color: white; padding: 14px 32px; border-radius: 12px; text-decoration: none;
           font-size: 15px; font-weight: bold; }
    .features { background: #fdf5e8; border-radius: 12px; padding: 20px; margin: 24px 0; }
    .features ul { margin: 8px 0; padding-left: 20px; }
    .features li { font-size: 14px; color: #5c381a; margin-bottom: 6px; line-height: 1.5; }
    .footer { background: #f7edda; padding: 20px; text-align: center; font-size: 12px; color: #955b22; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🥐 Roti POS</h1>
      <p>Sistem Kasir untuk Bakery Modern</p>
    </div>
    <div class="body">
      <h2>Selamat datang, ${params.ownerName}!</h2>
      <p>
        Toko <strong>${params.tenantName}</strong> sudah berhasil terdaftar di Roti POS.
        Anda sekarang menggunakan paket <span class="plan-badge">${planLabel[params.plan] ?? params.plan}</span>.
      </p>

      <div class="features">
        <strong>Yang bisa Anda lakukan sekarang:</strong>
        <ul>
          <li>Buka shift dan mulai mencatat transaksi di halaman Kasir</li>
          <li>Tambahkan produk, bahan baku, dan resep</li>
          <li>Lihat laporan penjualan harian dan mingguan</li>
          <li>Undang staff dengan role Kasir atau Produksi</li>
        </ul>
      </div>

      <a href="${APP_URL}" class="cta">Mulai Gunakan Roti POS →</a>

      <p style="font-size: 13px; color: #955b22;">
        Butuh bantuan? Balas email ini atau hubungi support kami.
      </p>
    </div>
    <div class="footer">
      © ${new Date().getFullYear()} Roti POS · Sistem Kasir Bakery Modern<br>
      <a href="${APP_URL}" style="color: #b5722a;">app.rotipos.com</a>
    </div>
  </div>
</body>
</html>`

  try {
    await transport.sendMail({
      from: FROM,
      to: params.to,
      subject: `Selamat datang di Roti POS, ${params.tenantName}! 🥐`,
      html,
    })
    console.log(`[Email] Welcome email sent to ${params.to}`)
  } catch (err) {
    console.error('[Email] Failed to send welcome email:', err)
    // Don't throw — email failure should not break registration
  }
}

export async function sendPlanUpgradeEmail(params: {
  to: string
  ownerName: string
  tenantName: string
  oldPlan: string
  newPlan: string
}) {
  const transport = createTransport()
  if (!transport) return

  try {
    await transport.sendMail({
      from: FROM,
      to: params.to,
      subject: `Paket ${params.tenantName} berhasil diupgrade ke ${params.newPlan} 🎉`,
      html: `
        <div style="font-family: Arial; max-width: 600px; margin: 0 auto; padding: 32px;">
          <h2>Halo ${params.ownerName},</h2>
          <p>Paket toko <strong>${params.tenantName}</strong> berhasil diupgrade dari 
             <strong>${params.oldPlan}</strong> ke <strong>${params.newPlan}</strong>.</p>
          <p>Fitur-fitur baru sudah langsung aktif. Selamat menggunakan!</p>
          <a href="${APP_URL}" style="background: #b5722a; color: white; padding: 12px 24px; 
             border-radius: 8px; text-decoration: none; display: inline-block; margin-top: 16px;">
            Buka Roti POS →
          </a>
        </div>
      `,
    })
  } catch (err) {
    console.error('[Email] Failed to send upgrade email:', err)
  }
}

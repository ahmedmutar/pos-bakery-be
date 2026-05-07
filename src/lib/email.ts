/**
 * Email Service — Sajiin
 * Priority: Resend (HTTPS API) → Nodemailer SMTP → Console fallback
 */

import nodemailer from 'nodemailer'

// ─── Provider detection ───────────────────────────────────────────────────────
type EmailProvider = 'resend' | 'brevo' | 'smtp' | 'console'

function getProvider(): EmailProvider {
  console.log('[Email] RESEND_API_KEY:', process.env.RESEND_API_KEY ? 'SET' : 'NOT SET')
  console.log('[Email] BREVO_API_KEY:', process.env.BREVO_API_KEY ? 'SET' : 'NOT SET')
  console.log('[Email] SMTP_HOST:', process.env.SMTP_HOST ? 'SET' : 'NOT SET')
  if (process.env.RESEND_API_KEY) return 'resend'
  if (process.env.BREVO_API_KEY)  return 'brevo'
  if (process.env.SMTP_HOST)      return 'smtp'
  return 'console'
}

const FROM_NAME    = 'Sajiin'
const FROM_EMAIL   = process.env.FROM_EMAIL ?? 'noreply@sajiin.id'
const FROM_ADDRESS = `${FROM_NAME} <${FROM_EMAIL}>`
const APP_URL      = process.env.APP_URL ?? 'https://sajiin.id'

// ─── Send via Resend ──────────────────────────────────────────────────────────
async function sendViaResend(to: string, subject: string, html: string): Promise<void> {
  const { Resend } = await import('resend')
  const resend = new Resend(process.env.RESEND_API_KEY)

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to,
    subject,
    html,
  })

  if (error) throw new Error(`Resend error: ${error.message}`)
}

// ─── Send via Brevo API (HTTP — tidak diblokir Railway) ──────────────────────
async function sendViaBrevo(to: string, subject: string, html: string): Promise<void> {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'accept':       'application/json',
      'api-key':      process.env.BREVO_API_KEY!,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender:   { name: FROM_NAME, email: FROM_EMAIL },
      to:       [{ email: to }],
      subject,
      htmlContent: html,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }))
    throw new Error(`Brevo error ${res.status}: ${JSON.stringify(err)}`)
  }
}

// ─── Send via SMTP ────────────────────────────────────────────────────────────
async function sendViaSMTP(to: string, subject: string, html: string): Promise<void> {
  const port   = parseInt(process.env.SMTP_PORT ?? '587')
  const secure = port === 465  // 465=SSL, 587=STARTTLS

  const transport = nodemailer.createTransport({
    host:   process.env.SMTP_HOST!,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    tls: {
      rejectUnauthorized: false,  // toleran untuk Railway
      ciphers: 'SSLv3',
    },
    connectionTimeout: 15000,
    greetingTimeout:   15000,
    socketTimeout:     30000,
  })

  await transport.verify()  // test koneksi sebelum kirim
  await transport.sendMail({ from: FROM_ADDRESS, to, subject, html })
}

// ─── Main send function ───────────────────────────────────────────────────────
async function send(to: string, subject: string, html: string): Promise<void> {
  const provider = getProvider()

  if (provider === 'resend') {
    await sendViaResend(to, subject, html)
    console.log(`[Email/Resend] ✓ Terkirim ke ${to}`)
    return
  }

  if (provider === 'brevo') {
    await sendViaBrevo(to, subject, html)
    console.log(`[Email/Brevo] ✓ Terkirim ke ${to}`)
    return
  }

  if (provider === 'smtp') {
    try {
      await sendViaSMTP(to, subject, html)
      console.log(`[Email/SMTP] ✓ Terkirim ke ${to}`)
    } catch (smtpErr: unknown) {
      const msg = smtpErr instanceof Error ? smtpErr.message : String(smtpErr)
      console.error(`[Email/SMTP] Gagal: ${msg}`)
      // Fallback ke Resend jika tersedia
      if (process.env.RESEND_API_KEY) {
        console.log(`[Email] Mencoba fallback ke Resend...`)
        await sendViaResend(to, subject, html)
        console.log(`[Email/Resend] ✓ Terkirim ke ${to} (via fallback)`)
      } else {
        throw smtpErr
      }
    }
    return
  }

  // Console fallback for development
  console.log(`[Email/DEV] To: ${to} | Subject: ${subject}`)
}

// ─── Email templates ──────────────────────────────────────────────────────────

const baseStyle = `
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #f7f5f0; }
    .wrap { max-width: 560px; margin: 32px auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(30,77,59,.1); }
    .header { background: #1E4D3B; padding: 28px 32px; text-align: center; }
    .header h1 { color: white; font-size: 20px; font-weight: 700; }
    .header .logo { font-size: 28px; font-weight: 800; color: white; letter-spacing: -0.5px; margin-bottom: 4px; }
    .header .logo span { color: #FF8A00; }
    .body { padding: 32px; }
    .otp-box { background: #f7f5f0; border: 2px dashed #d4c9b8; border-radius: 16px; padding: 24px; margin: 24px 0; text-align: center; }
    .otp-code { font-size: 44px; font-weight: 800; letter-spacing: 14px; color: #1E4D3B; font-family: 'Courier New', monospace; }
    .otp-exp { font-size: 13px; color: #888; margin-top: 8px; }
    .footer { background: #f7f5f0; padding: 16px 32px; text-align: center; font-size: 12px; color: #aaa; }
    p { font-size: 15px; color: #333; line-height: 1.6; margin-bottom: 12px; }
    .btn { display: inline-block; background: #1E4D3B; color: white !important; text-decoration: none; padding: 14px 32px; border-radius: 12px; font-weight: 600; font-size: 15px; margin: 8px 0; }
    .info-row { display: flex; justify-content: space-between; border-bottom: 1px solid #eee; padding: 10px 0; font-size: 14px; }
    .info-label { color: #888; }
    .info-value { font-weight: 600; color: #333; }
    .badge { display: inline-block; background: #fff3e0; color: #e67e00; border-radius: 100px; padding: 2px 12px; font-size: 12px; font-weight: 600; }
  </style>`

function layout(content: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">${baseStyle}</head>
<body><div class="wrap">
${content}
<div class="footer">© ${new Date().getFullYear()} Sajiin · Jangan bagikan email ini kepada siapapun</div>
</div></body></html>`
}

// ─── OTP Email ────────────────────────────────────────────────────────────────
export async function sendOTPEmail(params: { to: string; otp: string; name: string }): Promise<void> {
  console.log('[DEBUG] sendOTPEmail called:', params.to)
  console.log('[DEBUG] BREVO_API_KEY:', process.env.BREVO_API_KEY ? 'SET (' + process.env.BREVO_API_KEY.substring(0,10) + '...)' : 'NOT SET')
  console.log('[DEBUG] RESEND_API_KEY:', process.env.RESEND_API_KEY ? 'SET' : 'NOT SET')

  const provider = getProvider()
  console.log('[DEBUG] provider selected:', provider)

  if (provider === 'console') {
    console.log(`[OTP DEV] Kode untuk ${params.to}: ${params.otp}`)
    console.log('[OTP DEV] Set BREVO_API_KEY untuk kirim email sungguhan')
    return
  }

  console.log(`[OTP] Mengirim ke ${params.to} via ${provider}`)

  const html = layout(`
    <div class="header">
      <div class="logo">Saji<span>in</span></div>
      <h1>Kode Verifikasi Email</h1>
    </div>
    <div class="body">
      <p>Halo <strong>${params.name}</strong>,</p>
      <p>Masukkan kode OTP berikut untuk melanjutkan proses Anda:</p>
      <div class="otp-box">
        <div class="otp-code">${params.otp}</div>
        <div class="otp-exp">Berlaku selama <strong>10 menit</strong></div>
      </div>
      <p style="font-size:13px;color:#999;">Jika Anda tidak meminta kode ini, abaikan email ini. Jangan bagikan kode ini kepada siapapun.</p>
    </div>`)

  try {
    await send(params.to, `${params.otp} — Kode Verifikasi Sajiin`, html)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[OTP] Gagal kirim ke ${params.to}: ${msg}`)
    throw err
  }
}

// ─── Welcome Email ────────────────────────────────────────────────────────────
export async function sendWelcomeEmail(params: {
  to: string; name: string; tenantName: string; trialDays: number
}): Promise<void> {
  if (getProvider() === 'console') return

  const html = layout(`
    <div class="header">
      <div class="logo">Saji<span>in</span></div>
      <h1>Selamat Datang! 🎉</h1>
    </div>
    <div class="body">
      <p>Halo <strong>${params.name}</strong>,</p>
      <p>Akun Sajiin untuk <strong>${params.tenantName}</strong> sudah aktif. Anda mendapat trial gratis selama <strong>${params.trialDays} hari</strong>.</p>
      <p style="text-align:center;margin:24px 0;">
        <a href="${APP_URL}/app/dashboard" class="btn">Mulai Sekarang →</a>
      </p>
      <p style="font-size:13px;color:#999;">Butuh bantuan? Hubungi kami via <a href="https://wa.me/6208970120687" style="color:#1E4D3B;">WhatsApp</a>.</p>
    </div>`)

  await send(params.to, `Selamat datang di Sajiin, ${params.name}!`, html).catch(console.error)
}

// ─── Password Reset Email ─────────────────────────────────────────────────────
export async function sendPasswordResetEmail(params: {
  to: string; name: string; resetUrl: string
}): Promise<void> {
  if (getProvider() === 'console') {
    console.log(`[RESET DEV] ${params.to}: ${params.resetUrl}`)
    return
  }

  const html = layout(`
    <div class="header">
      <div class="logo">Saji<span>in</span></div>
      <h1>Reset Kata Sandi</h1>
    </div>
    <div class="body">
      <p>Halo <strong>${params.name}</strong>,</p>
      <p>Kami menerima permintaan reset kata sandi untuk akun Anda. Klik tombol di bawah untuk melanjutkan:</p>
      <p style="text-align:center;margin:24px 0;">
        <a href="${params.resetUrl}" class="btn">Reset Kata Sandi</a>
      </p>
      <p style="font-size:13px;color:#999;">Link ini berlaku selama <strong>1 jam</strong>. Jika Anda tidak meminta reset, abaikan email ini.</p>
    </div>`)

  await send(params.to, 'Reset Kata Sandi Sajiin', html).catch(console.error)
}

// ─── Admin notification ───────────────────────────────────────────────────────
export async function sendAdminNewRegistrationEmail(params: {
  ownerName: string; tenantName: string; email: string; plan: string; registeredAt: string
}): Promise<void> {
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL
  if (!adminEmail || getProvider() === 'console') {
    console.log(`[Admin] Registrasi baru: ${params.tenantName} (${params.email})`)
    return
  }

  const waLink = `https://wa.me/${process.env.ADMIN_WHATSAPP ?? '62'}?text=Halo+${encodeURIComponent(params.ownerName)}`

  const html = layout(`
    <div class="header">
      <div class="logo">Saji<span>in</span></div>
      <h1>🆕 Registrasi Baru</h1>
    </div>
    <div class="body">
      <div class="info-row"><span class="info-label">Nama Owner</span><span class="info-value">${params.ownerName}</span></div>
      <div class="info-row"><span class="info-label">Nama Toko</span><span class="info-value">${params.tenantName}</span></div>
      <div class="info-row"><span class="info-label">Email</span><span class="info-value">${params.email}</span></div>
      <div class="info-row"><span class="info-label">Paket</span><span class="info-value"><span class="badge">${params.plan}</span></span></div>
      <div class="info-row"><span class="info-label">Waktu</span><span class="info-value">${params.registeredAt}</span></div>
      <p style="text-align:center;margin-top:24px;">
        <a href="${waLink}" class="btn">Sapa via WhatsApp</a>
      </p>
    </div>`)

  await send(adminEmail, `🆕 Registrasi Baru: ${params.tenantName}`, html).catch(console.error)
}

// ─── OTP Email (alias untuk sendOTPEmail) ─────────────────────────────────────
export { sendOTPEmail as sendOtp }

// ─── Subscription Expiry Reminder ────────────────────────────────────────────
export async function sendSubscriptionExpiryEmail(params: {
  to: string; name: string; tenantName: string
  plan: string; daysLeft: number; renewUrl: string
}): Promise<void> {
  if (getProvider() === 'console') {
    console.log(`[EXPIRY DEV] ${params.to}: paket habis ${params.daysLeft} hari lagi`)
    return
  }

  const urgent = params.daysLeft <= 3
  const planLabel = params.plan.charAt(0).toUpperCase() + params.plan.slice(1)

  const html = layout(`
    <div class="header">
      <div class="logo">Saji<span>in</span></div>
      <h1>${urgent ? '⚠️ Paket Hampir Berakhir!' : '📅 Pengingat Perpanjangan'}</h1>
    </div>
    <div class="body">
      <p>Halo <strong>${params.name}</strong>,</p>
      <p>
        Paket <strong>${planLabel}</strong> untuk toko <strong>${params.tenantName}</strong>
        akan berakhir dalam <strong style="color:${urgent ? '#ef4444' : '#e67e00'}">${params.daysLeft} hari</strong>.
      </p>
      ${urgent ? '<p style="color:#ef4444;font-weight:600;">Segera perpanjang agar operasional toko tidak terganggu.</p>' : ''}
      <p style="text-align:center;margin:24px 0;">
        <a href="${params.renewUrl}" class="btn">Perpanjang Sekarang →</a>
      </p>
      <p style="font-size:13px;color:#999;">
        Butuh bantuan? Hubungi kami via <a href="https://wa.me/6208970120687" style="color:#1E4D3B;">WhatsApp</a>.
      </p>
    </div>`)

  await send(
    params.to,
    `${urgent ? '[PENTING] ' : ''}Paket ${planLabel} Anda berakhir dalam ${params.daysLeft} hari — Sajiin`,
    html
  ).catch(console.error)
}

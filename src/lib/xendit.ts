import { Xendit } from 'xendit-node'

export const PLAN_PRICES: Record<string, { amount: number; label: string; duration: number }> = {
  // Bulanan
  basic:        { amount:  149_000, label: 'Paket Basic (Bulanan)',  duration:  30 },
  pro:          { amount:  349_000, label: 'Paket Pro (Bulanan)',    duration:  30 },
  enterprise:   { amount:  999_000, label: 'Paket Enterprise',       duration:  30 },
  // Tahunan (diskon 20%)
  basic_yearly: { amount: 1_430_400, label: 'Paket Basic (Tahunan)',  duration: 365 },
  pro_yearly:   { amount: 3_350_400, label: 'Paket Pro (Tahunan)',    duration: 365 },
}

export async function createXenditInvoice({
  externalId,
  amount,
  payerEmail,
  description,
  successRedirectUrl,
  failureRedirectUrl,
}: {
  externalId: string
  amount: number
  payerEmail: string
  description: string
  successRedirectUrl: string
  failureRedirectUrl: string
}) {
  const key = process.env.XENDIT_SECRET_KEY ?? ''
  const env = key.startsWith('xnd_development_') ? 'TEST'
            : key.startsWith('xnd_production_')  ? 'LIVE'
            : 'NO_KEY'

  console.log(`[Xendit] Creating invoice — env: ${env}`)

  // Xendit v7 — Invoice ada di instance, bukan class terpisah
  const xendit = new Xendit({ secretKey: key })

  const invoice = await xendit.Invoice.createInvoice({
    data: {
      externalId,
      amount,
      payerEmail,
      description,
      successRedirectUrl,
      failureRedirectUrl,
      currency: 'IDR',
      invoiceDuration: 86400,
      paymentMethods: ['QRIS', 'BCA', 'BNI', 'BRI', 'MANDIRI', 'PERMATA', 'OVO', 'GOPAY', 'DANA'],
      locale: 'id',
    },
  })

  return invoice
}

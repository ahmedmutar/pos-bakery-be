import { Xendit, Invoice as XenditInvoice } from 'xendit-node'

export const PLAN_PRICES: Record<string, { amount: number; label: string; duration: number }> = {
  basic:      { amount: 149_000, label: 'Paket Basic',      duration: 30 },
  pro:        { amount: 349_000, label: 'Paket Pro',        duration: 30 },
  enterprise: { amount: 999_000, label: 'Paket Enterprise', duration: 30 },
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
  const isUAT = key.startsWith('xnd_development_')
  const isProd = key.startsWith('xnd_production_')
  const env = isUAT ? 'UAT' : isProd ? 'PRODUCTION' : 'DEV_BYPASS'
  console.log(`[Xendit] Creating invoice — env: ${env}`)

  const client = new Xendit({ secretKey: key })
  const invoiceClient = new XenditInvoice({ client })

  const invoice = await invoiceClient.createInvoice({
    data: {
      externalId,
      amount,
      payerEmail,
      description,
      successRedirectUrl,
      failureRedirectUrl,
      currency: 'IDR',
      invoiceDuration: 86400,
      paymentMethods: ['QRIS', 'BCA', 'BNI', 'BRI', 'MANDIRI', 'PERMATA', 'OVO', 'GOPAY', 'DANA', 'LINKAJA'],
      locale: 'id',
    },
  })
  return invoice
}

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import bcrypt from 'bcryptjs'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0])

function daysAgo(n: number, hour = 10) {
  const d = new Date(); d.setDate(d.getDate() - n); d.setHours(hour, 0, 0, 0); return d
}
function daysFromNow(n: number, hour = 10) {
  const d = new Date(); d.setDate(d.getDate() + n); d.setHours(hour, 0, 0, 0); return d
}
function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

async function main() {
  console.log('🌱 Memulai seed database...\n')

  const tenant = await prisma.tenant.upsert({
    where: { slug: 'bakery-sejahtera' },
    update: {},
    create: {
      name: 'Bakery Sejahtera', slug: 'bakery-sejahtera', plan: 'pro',
      bankName: 'BCA', bankAccount: '1234567890', bankHolder: 'Pemilik Toko',
    },
  })
  console.log(`✅ Tenant: ${tenant.name}`)

  const outletDefs = [
    { name: 'Bakery Sejahtera - Pusat',          address: 'Jl. Raya Bakery No. 1, Jakarta' },
    { name: 'Bakery Sejahtera - Cabang Selatan', address: 'Jl. Kemang Raya No. 12, Jakarta Selatan' },
  ]
  const outlets: Record<string, string> = {}
  for (const o of outletDefs) {
    const ex = await prisma.outlet.findFirst({ where: { tenantId: tenant.id, name: o.name } })
    const outlet = ex ?? await prisma.outlet.create({ data: { tenantId: tenant.id, ...o } })
    outlets[o.name] = outlet.id
  }
  const mainOutletId = Object.values(outlets)[0]
  console.log(`✅ Outlet: ${outletDefs.length} outlet`)

  const userDefs = [
    { name: 'Pemilik Toko', email: 'owner@bakery.com',    role: 'OWNER'      as const, password: 'password123' },
    { name: 'Kasir Utama',    email: 'kasir@bakery.com',    role: 'CASHIER'    as const, password: 'password123' },
    { name: 'Kasir Cabang',   email: 'kasir2@bakery.com',   role: 'CASHIER'    as const, password: 'password123' },
    { name: 'Tim Produksi',   email: 'produksi@bakery.com', role: 'PRODUCTION' as const, password: 'password123' },
  ]
  const users: Record<string, string> = {}
  for (const u of userDefs) {
    const hash = await bcrypt.hash(u.password, 12)
    const user = await prisma.user.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email: u.email } },
      update: {},
      create: { tenantId: tenant.id, name: u.name, email: u.email, passwordHash: hash, role: u.role },
    })
    users[u.email] = user.id
    console.log(`✅ User: ${u.name}`)
  }

  const catNames = ['Roti', 'Kue', 'Pastry', 'Minuman', 'Snack']
  const categories: Record<string, string> = {}
  for (const name of catNames) {
    const ex = await prisma.category.findFirst({ where: { tenantId: tenant.id, name } })
    const cat = ex ?? await prisma.category.create({ data: { tenantId: tenant.id, name } })
    categories[name] = cat.id
  }
  console.log(`✅ Kategori: ${catNames.join(', ')}`)

  const ingredientDefs = [
    { name: 'Tepung Protein Tinggi', baseUnit: 'gram',  currentStock: 15000, minimumStock: 3000,  currentPrice: 14 },
    { name: 'Tepung Protein Rendah', baseUnit: 'gram',  currentStock: 8000,  minimumStock: 2000,  currentPrice: 12 },
    { name: 'Mentega Elle & Vire',   baseUnit: 'gram',  currentStock: 3000,  minimumStock: 500,   currentPrice: 85 },
    { name: 'Gula Pasir',            baseUnit: 'gram',  currentStock: 8000,  minimumStock: 1000,  currentPrice: 14 },
    { name: 'Gula Halus',            baseUnit: 'gram',  currentStock: 3000,  minimumStock: 500,   currentPrice: 18 },
    { name: 'Garam',                 baseUnit: 'gram',  currentStock: 2000,  minimumStock: 200,   currentPrice: 5 },
    { name: 'Ragi Instant',          baseUnit: 'gram',  currentStock: 500,   minimumStock: 100,   currentPrice: 120 },
    { name: 'Baking Powder',         baseUnit: 'gram',  currentStock: 300,   minimumStock: 50,    currentPrice: 60 },
    { name: 'Telur Ayam',            baseUnit: 'butir', currentStock: 120,   minimumStock: 24,    currentPrice: 2500 },
    { name: 'Susu UHT',              baseUnit: 'ml',    currentStock: 8000,  minimumStock: 1000,  currentPrice: 16 },
    { name: 'Dark Chocolate',        baseUnit: 'gram',  currentStock: 2000,  minimumStock: 300,   currentPrice: 120 },
    { name: 'Coklat Bubuk',          baseUnit: 'gram',  currentStock: 1000,  minimumStock: 200,   currentPrice: 70 },
    { name: 'Keju Cream Cheese',     baseUnit: 'gram',  currentStock: 800,   minimumStock: 200,   currentPrice: 95 },
    { name: 'Kayu Manis Bubuk',      baseUnit: 'gram',  currentStock: 300,   minimumStock: 50,    currentPrice: 80 },
    { name: 'Vanilla Essence',       baseUnit: 'ml',    currentStock: 200,   minimumStock: 50,    currentPrice: 150 },
    { name: 'Kopi Espresso',         baseUnit: 'gram',  currentStock: 500,   minimumStock: 100,   currentPrice: 200 },
    { name: 'Susu Kental Manis',     baseUnit: 'gram',  currentStock: 1000,  minimumStock: 200,   currentPrice: 20 },
    { name: 'Kismis',                baseUnit: 'gram',  currentStock: 300,   minimumStock: 100,   currentPrice: 50 },
    { name: 'Almond Slice',          baseUnit: 'gram',  currentStock: 200,   minimumStock: 50,    currentPrice: 180 },
    { name: 'Teh Bubuk',             baseUnit: 'gram',  currentStock: 300,   minimumStock: 50,    currentPrice: 80 },
  ]
  const ingredients: Record<string, string> = {}
  for (const ing of ingredientDefs) {
    const ex = await prisma.ingredient.findFirst({ where: { tenantId: tenant.id, name: ing.name } })
    const ingredient = ex ?? await prisma.ingredient.create({ data: { tenantId: tenant.id, ...ing } })
    ingredients[ing.name] = ingredient.id
  }
  console.log(`✅ Bahan baku: ${ingredientDefs.length} bahan`)

  const productDefs = [
    { name: 'Croissant Butter',  price: 18000, category: 'Pastry' },
    { name: 'Pain au Chocolat',  price: 20000, category: 'Pastry' },
    { name: 'Cinnamon Roll',     price: 22000, category: 'Pastry' },
    { name: 'Eclair Vanilla',    price: 18000, category: 'Pastry' },
    { name: 'Danish Pastry',     price: 20000, category: 'Pastry' },
    { name: 'Sourdough Loaf',    price: 65000, category: 'Roti' },
    { name: 'Roti Gandum',       price: 35000, category: 'Roti' },
    { name: 'Roti Kismis',       price: 28000, category: 'Roti' },
    { name: 'Brownies Coklat',   price: 25000, category: 'Kue' },
    { name: 'Tart Keju',         price: 28000, category: 'Kue' },
    { name: 'Lapis Legit',       price: 45000, category: 'Kue' },
    { name: 'Bolu Pandan',       price: 30000, category: 'Kue' },
    { name: 'Cheese Cake',       price: 55000, category: 'Kue' },
    { name: 'Kopi Susu',         price: 18000, category: 'Minuman' },
    { name: 'Teh Tarik',         price: 12000, category: 'Minuman' },
    { name: 'Coklat Panas',      price: 15000, category: 'Minuman' },
    { name: 'Kopi Americano',    price: 22000, category: 'Minuman' },
    { name: 'Cookies Almond',    price: 15000, category: 'Snack' },
    { name: 'Canele',            price: 12000, category: 'Snack' },
  ]
  const products: Record<string, string> = {}
  for (const p of productDefs) {
    const ex = await prisma.product.findFirst({ where: { tenantId: tenant.id, name: p.name } })
    const product = ex ?? await prisma.product.create({
      data: { tenantId: tenant.id, name: p.name, price: p.price, categoryId: categories[p.category] },
    })
    products[p.name] = product.id
  }
  console.log(`✅ Produk: ${productDefs.length} produk`)

  const recipeDefs = [
    { product: 'Croissant Butter', batch: 12, items: [
      { ing: 'Tepung Protein Tinggi', amount: 500, unit: 'gram' },
      { ing: 'Mentega Elle & Vire',   amount: 250, unit: 'gram' },
      { ing: 'Gula Pasir',            amount: 60,  unit: 'gram' },
      { ing: 'Garam',                 amount: 10,  unit: 'gram' },
      { ing: 'Ragi Instant',          amount: 7,   unit: 'gram' },
      { ing: 'Susu UHT',              amount: 200, unit: 'ml' },
    ]},
    { product: 'Pain au Chocolat', batch: 10, items: [
      { ing: 'Tepung Protein Tinggi', amount: 500, unit: 'gram' },
      { ing: 'Mentega Elle & Vire',   amount: 250, unit: 'gram' },
      { ing: 'Dark Chocolate',        amount: 200, unit: 'gram' },
      { ing: 'Gula Pasir',            amount: 50,  unit: 'gram' },
      { ing: 'Ragi Instant',          amount: 7,   unit: 'gram' },
      { ing: 'Susu UHT',              amount: 200, unit: 'ml' },
    ]},
    { product: 'Cinnamon Roll', batch: 10, items: [
      { ing: 'Tepung Protein Tinggi', amount: 400, unit: 'gram' },
      { ing: 'Susu UHT',              amount: 200, unit: 'ml' },
      { ing: 'Mentega Elle & Vire',   amount: 80,  unit: 'gram' },
      { ing: 'Gula Pasir',            amount: 100, unit: 'gram' },
      { ing: 'Ragi Instant',          amount: 7,   unit: 'gram' },
      { ing: 'Kayu Manis Bubuk',      amount: 15,  unit: 'gram' },
      { ing: 'Telur Ayam',            amount: 2,   unit: 'butir' },
    ]},
    { product: 'Brownies Coklat', batch: 16, items: [
      { ing: 'Dark Chocolate',        amount: 200, unit: 'gram' },
      { ing: 'Mentega Elle & Vire',   amount: 150, unit: 'gram' },
      { ing: 'Gula Pasir',            amount: 200, unit: 'gram' },
      { ing: 'Telur Ayam',            amount: 4,   unit: 'butir' },
      { ing: 'Tepung Protein Rendah', amount: 100, unit: 'gram' },
      { ing: 'Coklat Bubuk',          amount: 30,  unit: 'gram' },
    ]},
    { product: 'Tart Keju', batch: 8, items: [
      { ing: 'Tepung Protein Rendah', amount: 200, unit: 'gram' },
      { ing: 'Mentega Elle & Vire',   amount: 100, unit: 'gram' },
      { ing: 'Keju Cream Cheese',     amount: 250, unit: 'gram' },
      { ing: 'Gula Pasir',            amount: 80,  unit: 'gram' },
      { ing: 'Telur Ayam',            amount: 2,   unit: 'butir' },
    ]},
    { product: 'Roti Kismis', batch: 8, items: [
      { ing: 'Tepung Protein Tinggi', amount: 400, unit: 'gram' },
      { ing: 'Kismis',                amount: 100, unit: 'gram' },
      { ing: 'Gula Pasir',            amount: 60,  unit: 'gram' },
      { ing: 'Ragi Instant',          amount: 6,   unit: 'gram' },
      { ing: 'Mentega Elle & Vire',   amount: 50,  unit: 'gram' },
      { ing: 'Susu UHT',              amount: 150, unit: 'ml' },
    ]},
    { product: 'Kopi Susu', batch: 1, items: [
      { ing: 'Kopi Espresso',     amount: 18,  unit: 'gram' },
      { ing: 'Susu UHT',          amount: 150, unit: 'ml' },
      { ing: 'Susu Kental Manis', amount: 30,  unit: 'gram' },
    ]},
    { product: 'Cookies Almond', batch: 20, items: [
      { ing: 'Tepung Protein Rendah', amount: 200, unit: 'gram' },
      { ing: 'Mentega Elle & Vire',   amount: 100, unit: 'gram' },
      { ing: 'Gula Halus',            amount: 80,  unit: 'gram' },
      { ing: 'Almond Slice',          amount: 60,  unit: 'gram' },
      { ing: 'Telur Ayam',            amount: 1,   unit: 'butir' },
      { ing: 'Vanilla Essence',       amount: 5,   unit: 'ml' },
    ]},
  ]
  for (const r of recipeDefs) {
    const pid = products[r.product]
    if (!pid) continue
    const ex = await prisma.recipe.findUnique({ where: { productId: pid } })
    if (!ex) {
      await prisma.recipe.create({
        data: {
          tenantId: tenant.id, productId: pid, batchSize: r.batch,
          items: { create: r.items.map(i => ({ ingredientId: ingredients[i.ing], amount: i.amount, unit: i.unit, unitFactor: 1 })) },
        },
      })
    }
  }
  console.log(`✅ Resep: ${recipeDefs.length} resep`)

  const supplierDefs = [
    { name: 'CV Bahan Bakery Jaya',  phone: '02112345678', address: 'Jl. Supplier No. 5, Jakarta' },
    { name: 'PT Mentega Premium',    phone: '02198765432', address: 'Jl. Industri No. 10, Bekasi' },
    { name: 'Toko Coklat Nusantara', phone: '02155544433', address: 'Jl. Mangga No. 3, Jakarta' },
  ]
  const suppliers: Record<string, string> = {}
  for (const s of supplierDefs) {
    const ex = await prisma.supplier.findFirst({ where: { tenantId: tenant.id, name: s.name } })
    const sup = ex ?? await prisma.supplier.create({ data: { tenantId: tenant.id, ...s } })
    suppliers[s.name] = sup.id
  }
  console.log(`✅ Supplier: ${supplierDefs.length} supplier`)

  const existingPurchases = await prisma.purchase.count({ where: { tenantId: tenant.id } })
  if (existingPurchases === 0) {
    const purchaseDefs = [
      { supplier: 'CV Bahan Bakery Jaya',  day: 28, items: [
        { ing: 'Tepung Protein Tinggi', qty: 10000, price: 14 },
        { ing: 'Tepung Protein Rendah', qty: 5000,  price: 12 },
        { ing: 'Gula Pasir',            qty: 5000,  price: 14 },
        { ing: 'Ragi Instant',          qty: 300,   price: 120 },
      ]},
      { supplier: 'PT Mentega Premium',    day: 21, items: [
        { ing: 'Mentega Elle & Vire',   qty: 3000, price: 85 },
        { ing: 'Keju Cream Cheese',     qty: 1000, price: 95 },
        { ing: 'Susu UHT',              qty: 6000, price: 16 },
      ]},
      { supplier: 'Toko Coklat Nusantara', day: 14, items: [
        { ing: 'Dark Chocolate',        qty: 2000, price: 120 },
        { ing: 'Coklat Bubuk',          qty: 1000, price: 70 },
        { ing: 'Vanilla Essence',       qty: 200,  price: 150 },
      ]},
      { supplier: 'CV Bahan Bakery Jaya',  day: 7, items: [
        { ing: 'Tepung Protein Tinggi', qty: 8000, price: 14 },
        { ing: 'Telur Ayam',            qty: 60,   price: 2500 },
        { ing: 'Almond Slice',          qty: 300,  price: 180 },
        { ing: 'Kismis',                qty: 300,  price: 50 },
      ]},
    ]
    for (const p of purchaseDefs) {
      const total = p.items.reduce((s, i) => s + i.qty * i.price, 0)
      await prisma.purchase.create({
        data: {
          tenantId: tenant.id, supplierId: suppliers[p.supplier],
          date: daysAgo(p.day), notes: 'Pembelian rutin',
          items: { create: p.items.map(i => ({
            ingredientId: ingredients[i.ing], quantity: i.qty,
            unit: ingredientDefs.find(d => d.name === i.ing)?.baseUnit ?? 'gram',
            unitFactor: 1,
            pricePerUnit: i.price,
          }))},
        },
      })
      console.log(`✅ Pembelian: ${p.supplier} — Rp ${total.toLocaleString('id-ID')}`)
    }
  } else {
    console.log('⏭  Pembelian: sudah ada, dilewati')
  }

  const existingShifts = await prisma.shift.count({ where: { tenantId: tenant.id } })
  if (existingShifts === 0) {
    const txProds = [
      { name: 'Croissant Butter', price: 18000 },
      { name: 'Pain au Chocolat', price: 20000 },
      { name: 'Cinnamon Roll',    price: 22000 },
      { name: 'Brownies Coklat',  price: 25000 },
      { name: 'Tart Keju',        price: 28000 },
      { name: 'Kopi Susu',        price: 18000 },
      { name: 'Teh Tarik',        price: 12000 },
      { name: 'Coklat Panas',     price: 15000 },
      { name: 'Kopi Americano',   price: 22000 },
      { name: 'Cookies Almond',   price: 15000 },
    ]
    const methods = ['CASH', 'QRIS', 'TRANSFER'] as const
    const kasirId = users['kasir@bakery.com']
    let totalTx = 0

    for (let day = 14; day >= 1; day--) {
      const openAt  = daysAgo(day, 7)
      const closeAt = daysAgo(day, 17)
      const txCount = rand(8, 20)

      const shift = await prisma.shift.create({
        data: {
          tenantId: tenant.id, outletId: mainOutletId, userId: kasirId,
          openingCash: 500000, closedAt: closeAt,
          closingCash: 500000 + rand(500000, 2000000),
          cashDiff: 0, openedAt: openAt,
        },
      })

      for (let t = 0; t < txCount; t++) {
        const method = methods[rand(0, 2)]
        const itemCount = rand(1, 4)
        const selected = [...txProds].sort(() => Math.random() - 0.5).slice(0, itemCount)
        const items = selected.map(p => {
          const qty = rand(1, 3)
          return { productId: products[p.name], quantity: qty, unitPrice: p.price, subtotal: qty * p.price }
        })
        const subtotal = items.reduce((s, i) => s + i.subtotal, 0)
        const discount = rand(0, 4) === 0 ? Math.floor(subtotal * 0.1 / 1000) * 1000 : 0
        const total = subtotal - discount
        const txTime = new Date(openAt.getTime() + rand(30, 540) * 60000)

        await prisma.transaction.create({
          data: {
            tenantId: tenant.id, outletId: mainOutletId, shiftId: shift.id,
            userId: kasirId, total, discount, paymentMethod: method,
            paidAmount: method === 'CASH' ? total + rand(0, 1) * 5000 : total,
            changeAmount: method === 'CASH' ? rand(0, 1) * 5000 : 0,
            isVoided: false, createdAt: txTime,
            items: { create: items },
          },
        })
        totalTx++
      }
    }
    console.log(`✅ Transaksi: ${totalTx} transaksi dalam 14 hari`)
  } else {
    console.log('⏭  Transaksi: sudah ada, dilewati')
  }

  const existingPlans = await prisma.productionPlan.count({ where: { tenantId: tenant.id } })
  if (existingPlans === 0) {
    const planProds = [
      { name: 'Croissant Butter', target: 24, actual: 22, waste: 2, unsold: 0 },
      { name: 'Pain au Chocolat', target: 20, actual: 20, waste: 1, unsold: 1 },
      { name: 'Cinnamon Roll',    target: 20, actual: 18, waste: 2, unsold: 0 },
      { name: 'Brownies Coklat',  target: 32, actual: 32, waste: 0, unsold: 2 },
      { name: 'Tart Keju',        target: 16, actual: 16, waste: 1, unsold: 0 },
    ]
    for (let day = 7; day >= 1; day--) {
      await prisma.productionPlan.create({
        data: {
          tenantId: tenant.id,
          date: daysAgo(day, 6),
          notes: `Produksi harian ${daysAgo(day).toLocaleDateString('id-ID')}`,
          items: { create: planProds.map(p => ({
            product: { connect: { id: products[p.name] } },
            targetQty: p.target + rand(-2, 2),
            actualQty: p.actual + rand(-2, 2),
            wasteQty: p.waste,
            unsoldQty: p.unsold,
          }))},
        },
      })
    }
    console.log(`✅ Rencana Produksi: 7 hari terakhir`)
  } else {
    console.log('⏭  Rencana Produksi: sudah ada, dilewati')
  }

  const existingOrders = await prisma.preOrder.count({ where: { tenantId: tenant.id } })
  if (existingOrders === 0) {
    const orderDefs = [
      { name: 'Budi Santoso',  phone: '08123456789', status: 'COMPLETED'    as const, day: -2, dp: 90000,  notes: 'Kue ulang tahun 20 orang',
        items: [{ p: 'Tart Keju', q: 3, price: 28000 }, { p: 'Brownies Coklat', q: 3, price: 25000 }, { p: 'Lapis Legit', q: 1, price: 45000 }] },
      { name: 'Siti Rahayu',   phone: '08987654321', status: 'CONFIRMED'    as const, day: 2,  dp: 150000, notes: 'Hampers lebaran',
        items: [{ p: 'Croissant Butter', q: 10, price: 18000 }, { p: 'Cinnamon Roll', q: 5, price: 22000 }, { p: 'Cookies Almond', q: 10, price: 15000 }] },
      { name: 'Ahmad Fauzi',   phone: '08567891234', status: 'IN_PRODUCTION' as const, day: 1, dp: 300000, notes: 'Snack meeting kantor',
        items: [{ p: 'Croissant Butter', q: 20, price: 18000 }, { p: 'Pain au Chocolat', q: 10, price: 20000 }, { p: 'Kopi Susu', q: 20, price: 18000 }] },
      { name: 'Dewi Lestari',  phone: '08234567891', status: 'READY'        as const, day: 0,  dp: 50000,  notes: 'Tolong bungkus rapi',
        items: [{ p: 'Cheese Cake', q: 1, price: 55000 }, { p: 'Cookies Almond', q: 5, price: 15000 }] },
      { name: 'Rizky Pratama', phone: '08345678912', status: 'PENDING'      as const, day: 5,  dp: 200000, notes: 'Untuk acara pernikahan',
        items: [{ p: 'Lapis Legit', q: 2, price: 45000 }, { p: 'Tart Keju', q: 5, price: 28000 }, { p: 'Brownies Coklat', q: 4, price: 25000 }, { p: 'Cheese Cake', q: 2, price: 55000 }] },
      { name: 'Maya Indah',    phone: '08456789123', status: 'CANCELLED'    as const, day: -1, dp: 50000,  notes: 'Acara berubah',
        items: [{ p: 'Bolu Pandan', q: 2, price: 30000 }, { p: 'Cinnamon Roll', q: 5, price: 22000 }] },
      { name: 'Hendro Wijaya', phone: '08567812345', status: 'CONFIRMED'    as const, day: 3,  dp: 75000,  notes: 'Ulang tahun anak',
        items: [{ p: 'Cheese Cake', q: 1, price: 55000 }, { p: 'Brownies Coklat', q: 2, price: 25000 }, { p: 'Kopi Susu', q: 5, price: 18000 }] },
    ]
    for (const o of orderDefs) {
      const total = o.items.reduce((s, i) => s + i.q * i.price, 0)
      await prisma.preOrder.create({
        data: {
          tenantId: tenant.id, customerName: o.name, customerPhone: o.phone,
          pickupDate: daysFromNow(o.day, 10), total, dpAmount: o.dp,
          remainingAmount: Math.max(0, total - o.dp), status: o.status, notes: o.notes,
          items: { create: o.items.map(i => ({ productId: products[i.p], quantity: i.q, unitPrice: i.price, subtotal: i.q * i.price })) },
        },
      })
    }
    console.log(`✅ Pre-order: ${orderDefs.length} pesanan (semua status)`)
  } else {
    console.log('⏭  Pre-order: sudah ada, dilewati')
  }

  console.log('\n🎉 Seed selesai!\n')
  console.log('─────────────────────────────────────────────────')
  console.log('Akun login:')
  console.log('  Owner    : owner@bakery.com     / password123')
  console.log('  Kasir    : kasir@bakery.com     / password123')
  console.log('  Kasir 2  : kasir2@bakery.com    / password123')
  console.log('  Produksi : produksi@bakery.com  / password123')
  console.log('─────────────────────────────────────────────────')
  console.log('Data yang dibuat:')
  console.log('  2 outlet · 5 kategori · 19 produk · 20 bahan baku')
  console.log('  8 resep · 3 supplier · 4 pembelian bahan baku')
  console.log('  Transaksi kasir 14 hari · Produksi 7 hari')
  console.log('  7 pre-order (Pending/Confirmed/In Production/Ready/Completed/Cancelled)')
  console.log('─────────────────────────────────────────────────\n')
}

main()
  .catch((e) => { console.error('❌ Seed gagal:', e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect(); await pool.end() })

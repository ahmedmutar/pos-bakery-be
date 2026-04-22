import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import bcrypt from 'bcryptjs'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0])

async function main() {
  console.log('🌱 Memulai seed database...\n')

  // ─── Tenant ─────────────────────────────────────────────────────────────
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'bakery-sejahtera' },
    update: {},
    create: {
      name: 'Bakery Sejahtera',
      slug: 'bakery-sejahtera',
      plan: 'pro',
    },
  })
  console.log(`✅ Tenant: ${tenant.name}`)

  // ─── Outlet ──────────────────────────────────────────────────────────────
  const existingOutlet = await prisma.outlet.findFirst({ where: { tenantId: tenant.id } })
  const outlet = existingOutlet ?? await prisma.outlet.create({
    data: {
      tenantId: tenant.id,
      name: 'Bakery Sejahtera - Pusat',
      address: 'Jl. Raya Bakery No. 1',
    },
  })
  console.log(`✅ Outlet: ${outlet.name}`)

  // ─── Users ───────────────────────────────────────────────────────────────
  const users = [
    { name: 'Pemilik Bakery', email: 'owner@bakery.com', role: 'OWNER' as const, password: 'password123' },
    { name: 'Kasir Utama', email: 'kasir@bakery.com', role: 'CASHIER' as const, password: 'password123' },
    { name: 'Tim Produksi', email: 'produksi@bakery.com', role: 'PRODUCTION' as const, password: 'password123' },
  ]

  for (const u of users) {
    const passwordHash = await bcrypt.hash(u.password, 12)
    await prisma.user.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email: u.email } },
      update: {},
      create: { tenantId: tenant.id, name: u.name, email: u.email, passwordHash, role: u.role },
    })
    console.log(`✅ User: ${u.name} (${u.email}) — ${u.role}`)
  }

  // ─── Categories ──────────────────────────────────────────────────────────
  const categoryNames = ['Roti', 'Kue', 'Pastry', 'Minuman']
  const categories: Record<string, string> = {}

  for (const name of categoryNames) {
    const existing = await prisma.category.findFirst({ where: { tenantId: tenant.id, name } })
    const cat = existing ?? await prisma.category.create({ data: { tenantId: tenant.id, name } })
    categories[name] = cat.id
  }
  console.log(`✅ Kategori: ${categoryNames.join(', ')}`)

  // ─── Products ────────────────────────────────────────────────────────────
  const productDefs = [
    { name: 'Croissant Butter', price: 18000, category: 'Pastry' },
    { name: 'Pain au Chocolat', price: 20000, category: 'Pastry' },
    { name: 'Sourdough Loaf', price: 65000, category: 'Roti' },
    { name: 'Roti Gandum', price: 35000, category: 'Roti' },
    { name: 'Cinnamon Roll', price: 22000, category: 'Pastry' },
    { name: 'Tart Keju', price: 28000, category: 'Kue' },
    { name: 'Brownies Coklat', price: 25000, category: 'Kue' },
    { name: 'Lapis Legit', price: 45000, category: 'Kue' },
    { name: 'Eclair Vanilla', price: 18000, category: 'Pastry' },
    { name: 'Kopi Susu', price: 18000, category: 'Minuman' },
    { name: 'Teh Tarik', price: 12000, category: 'Minuman' },
    { name: 'Coklat Panas', price: 15000, category: 'Minuman' },
  ]

  const products: Record<string, string> = {}
  for (const p of productDefs) {
    const existing = await prisma.product.findFirst({
      where: { tenantId: tenant.id, name: p.name },
    })
    const product = existing ?? await prisma.product.create({
      data: {
        tenantId: tenant.id,
        name: p.name,
        price: p.price,
        categoryId: categories[p.category],
      },
    })
    products[p.name] = product.id
  }
  console.log(`✅ Produk: ${productDefs.length} produk`)

  // ─── Ingredients ─────────────────────────────────────────────────────────
  const ingredientDefs = [
    { name: 'Tepung Protein Tinggi', baseUnit: 'gram', currentStock: 10000, minimumStock: 3000, currentPrice: 14 },
    { name: 'Tepung Protein Rendah', baseUnit: 'gram', currentStock: 5000, minimumStock: 2000, currentPrice: 12 },
    { name: 'Mentega Elle & Vire', baseUnit: 'gram', currentStock: 2000, minimumStock: 500, currentPrice: 85 },
    { name: 'Gula Pasir', baseUnit: 'gram', currentStock: 5000, minimumStock: 1000, currentPrice: 14 },
    { name: 'Garam', baseUnit: 'gram', currentStock: 1000, minimumStock: 200, currentPrice: 5 },
    { name: 'Ragi Instant', baseUnit: 'gram', currentStock: 500, minimumStock: 100, currentPrice: 120 },
    { name: 'Telur Ayam', baseUnit: 'butir', currentStock: 60, minimumStock: 24, currentPrice: 2500 },
    { name: 'Susu UHT', baseUnit: 'ml', currentStock: 5000, minimumStock: 1000, currentPrice: 16 },
    { name: 'Dark Chocolate', baseUnit: 'gram', currentStock: 1000, minimumStock: 300, currentPrice: 120 },
    { name: 'Keju Cream Cheese', baseUnit: 'gram', currentStock: 500, minimumStock: 200, currentPrice: 95 },
    { name: 'Kayu Manis Bubuk', baseUnit: 'gram', currentStock: 200, minimumStock: 50, currentPrice: 80 },
    { name: 'Coklat Bubuk', baseUnit: 'gram', currentStock: 800, minimumStock: 200, currentPrice: 70 },
  ]

  const ingredients: Record<string, string> = {}
  for (const ing of ingredientDefs) {
    const existing = await prisma.ingredient.findFirst({
      where: { tenantId: tenant.id, name: ing.name },
    })
    const ingredient = existing ?? await prisma.ingredient.create({
      data: { tenantId: tenant.id, ...ing },
    })
    ingredients[ing.name] = ingredient.id
  }
  console.log(`✅ Bahan baku: ${ingredientDefs.length} bahan`)

  // ─── Recipes ─────────────────────────────────────────────────────────────
  const recipeDefs = [
    {
      productName: 'Croissant Butter',
      batchSize: 12,
      items: [
        { ingredient: 'Tepung Protein Tinggi', amount: 500, unit: 'gram', unitFactor: 1 },
        { ingredient: 'Mentega Elle & Vire', amount: 250, unit: 'gram', unitFactor: 1 },
        { ingredient: 'Gula Pasir', amount: 60, unit: 'gram', unitFactor: 1 },
        { ingredient: 'Garam', amount: 10, unit: 'gram', unitFactor: 1 },
        { ingredient: 'Ragi Instant', amount: 7, unit: 'gram', unitFactor: 1 },
        { ingredient: 'Susu UHT', amount: 200, unit: 'ml', unitFactor: 1 },
      ],
    },
    {
      productName: 'Pain au Chocolat',
      batchSize: 10,
      items: [
        { ingredient: 'Tepung Protein Tinggi', amount: 500, unit: 'gram', unitFactor: 1 },
        { ingredient: 'Mentega Elle & Vire', amount: 250, unit: 'gram', unitFactor: 1 },
        { ingredient: 'Dark Chocolate', amount: 200, unit: 'gram', unitFactor: 1 },
        { ingredient: 'Gula Pasir', amount: 50, unit: 'gram', unitFactor: 1 },
        { ingredient: 'Ragi Instant', amount: 7, unit: 'gram', unitFactor: 1 },
        { ingredient: 'Susu UHT', amount: 200, unit: 'ml', unitFactor: 1 },
      ],
    },
    {
      productName: 'Brownies Coklat',
      batchSize: 16,
      items: [
        { ingredient: 'Dark Chocolate', amount: 200, unit: 'gram', unitFactor: 1 },
        { ingredient: 'Mentega Elle & Vire', amount: 150, unit: 'gram', unitFactor: 1 },
        { ingredient: 'Gula Pasir', amount: 200, unit: 'gram', unitFactor: 1 },
        { ingredient: 'Telur Ayam', amount: 4, unit: 'butir', unitFactor: 1 },
        { ingredient: 'Tepung Protein Rendah', amount: 100, unit: 'gram', unitFactor: 1 },
        { ingredient: 'Coklat Bubuk', amount: 30, unit: 'gram', unitFactor: 1 },
      ],
    },
    {
      productName: 'Tart Keju',
      batchSize: 8,
      items: [
        { ingredient: 'Tepung Protein Rendah', amount: 200, unit: 'gram', unitFactor: 1 },
        { ingredient: 'Mentega Elle & Vire', amount: 100, unit: 'gram', unitFactor: 1 },
        { ingredient: 'Keju Cream Cheese', amount: 250, unit: 'gram', unitFactor: 1 },
        { ingredient: 'Gula Pasir', amount: 80, unit: 'gram', unitFactor: 1 },
        { ingredient: 'Telur Ayam', amount: 2, unit: 'butir', unitFactor: 1 },
      ],
    },
    {
      productName: 'Cinnamon Roll',
      batchSize: 10,
      items: [
        { ingredient: 'Tepung Protein Tinggi', amount: 400, unit: 'gram', unitFactor: 1 },
        { ingredient: 'Susu UHT', amount: 200, unit: 'ml', unitFactor: 1 },
        { ingredient: 'Mentega Elle & Vire', amount: 80, unit: 'gram', unitFactor: 1 },
        { ingredient: 'Gula Pasir', amount: 100, unit: 'gram', unitFactor: 1 },
        { ingredient: 'Ragi Instant', amount: 7, unit: 'gram', unitFactor: 1 },
        { ingredient: 'Kayu Manis Bubuk', amount: 15, unit: 'gram', unitFactor: 1 },
        { ingredient: 'Telur Ayam', amount: 2, unit: 'butir', unitFactor: 1 },
      ],
    },
  ]

  for (const r of recipeDefs) {
    const productId = products[r.productName]
    if (!productId) continue

    const existing = await prisma.recipe.findUnique({ where: { productId } })
    if (!existing) {
      await prisma.recipe.create({
        data: {
          tenantId: tenant.id,
          productId,
          batchSize: r.batchSize,
          items: {
            create: r.items.map((item) => ({
              ingredientId: ingredients[item.ingredient],
              amount: item.amount,
              unit: item.unit,
              unitFactor: item.unitFactor,
            })),
          },
        },
      })
    }
  }
  console.log(`✅ Resep: ${recipeDefs.length} resep`)

  // ─── Sample pre-orders ───────────────────────────────────────────────────
  const existingOrders = await prisma.preOrder.count({ where: { tenantId: tenant.id } })
  if (existingOrders === 0) {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(10, 0, 0, 0)

    const nextWeek = new Date()
    nextWeek.setDate(nextWeek.getDate() + 7)
    nextWeek.setHours(14, 0, 0, 0)

    await prisma.preOrder.createMany({
      data: [
        {
          tenantId: tenant.id,
          customerName: 'Budi Santoso',
          customerPhone: '08123456789',
          pickupDate: tomorrow,
          total: 180000,
          dpAmount: 90000,
          remainingAmount: 90000,
          status: 'CONFIRMED',
          notes: 'Kue ulang tahun untuk 20 orang',
        },
        {
          tenantId: tenant.id,
          customerName: 'Siti Rahayu',
          customerPhone: '08987654321',
          pickupDate: nextWeek,
          total: 325000,
          dpAmount: 100000,
          remainingAmount: 225000,
          status: 'PENDING',
          notes: 'Hampers lebaran',
        },
      ],
    })

    const orders = await prisma.preOrder.findMany({ where: { tenantId: tenant.id }, take: 2 })

    if (orders[0] && products['Tart Keju'] && products['Brownies Coklat']) {
      await prisma.preOrderItem.createMany({
        data: [
          { preOrderId: orders[0].id, productId: products['Tart Keju'], quantity: 3, unitPrice: 28000, subtotal: 84000, customNotes: 'Tulis "Happy Birthday Rina"' },
          { preOrderId: orders[0].id, productId: products['Brownies Coklat'], quantity: 3, unitPrice: 25000, subtotal: 75000 },
          { preOrderId: orders[0].id, productId: products['Lapis Legit'], quantity: 1, unitPrice: 45000, subtotal: 45000 },
        ],
      })
    }

    if (orders[1] && products['Croissant Butter'] && products['Cinnamon Roll']) {
      await prisma.preOrderItem.createMany({
        data: [
          { preOrderId: orders[1].id, productId: products['Croissant Butter'], quantity: 10, unitPrice: 18000, subtotal: 180000 },
          { preOrderId: orders[1].id, productId: products['Cinnamon Roll'], quantity: 5, unitPrice: 22000, subtotal: 110000 },
          { preOrderId: orders[1].id, productId: products['Pain au Chocolat'], quantity: 35000 / 20000, unitPrice: 20000, subtotal: 35000 },
        ],
      })
    }

    console.log('✅ Pre-order: 2 pesanan contoh')
  } else {
    console.log('⏭  Pre-order: sudah ada, dilewati')
  }

  // ─── Supplier ────────────────────────────────────────────────────────────
  const existingSupplier = await prisma.supplier.findFirst({ where: { tenantId: tenant.id } })
  if (!existingSupplier) {
    await prisma.supplier.create({
      data: {
        tenantId: tenant.id,
        name: 'CV Bahan Bakery Jaya',
        phone: '02112345678',
        address: 'Jl. Supplier No. 5, Jakarta',
      },
    })
    console.log('✅ Supplier: CV Bahan Bakery Jaya')
  }

  console.log('\n🎉 Seed selesai!\n')
  console.log('─────────────────────────────────────')
  console.log('Akun login:')
  console.log('  Owner    : owner@bakery.com     / password123')
  console.log('  Kasir    : kasir@bakery.com     / password123')
  console.log('  Produksi : produksi@bakery.com  / password123')
  console.log('─────────────────────────────────────\n')
}

main()
  .catch((e) => { console.error('❌ Seed gagal:', e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect(); await pool.end() })

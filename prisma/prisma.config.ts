import { defineConfig } from 'prisma/config'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

export default defineConfig({
  earlyAccess: true,
  schema: 'prisma/schema.prisma',
  migrate: {
    async adapter() {
      const pool = new pg.Pool({
        connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      })
      return new PrismaPg(pool)
    },
  },
})

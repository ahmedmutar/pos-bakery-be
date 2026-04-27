import pg from 'pg'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

await pool.query(`
  DROP SCHEMA public CASCADE;
  CREATE SCHEMA public;
`)

console.log('✅ Database berhasil direset')
await pool.end()

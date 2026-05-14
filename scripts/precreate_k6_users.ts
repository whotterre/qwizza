import 'dotenv/config'
import db from '../src/index'
import { sql } from 'drizzle-orm'

async function main() {
  const count = parseInt(process.env.K6_USERS || '100', 10)
  if (!Number.isFinite(count) || count <= 0) {
    console.error('K6_USERS must be a positive integer')
    process.exit(1)
  }

  console.log(`Pre-creating ${count} users`)
  const t0 = Date.now()

  await db.execute(sql`
    INSERT INTO users (email, password_hash, role)
    SELECT
      'vu' || gs::text || '@load.test' AS email,
      'precreated' AS password_hash,
      'player'::roles AS role
    FROM generate_series(1, ${count}) AS gs
    ON CONFLICT (email) DO NOTHING
  `)

  const ms = Date.now() - t0
  console.log(`Done in ${ms}ms`)

  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

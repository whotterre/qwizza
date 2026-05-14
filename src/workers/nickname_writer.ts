import 'dotenv/config'
import db from '../index'
import Redis from 'ioredis'
import { nicknames } from '../db/schema'
import { getErrorMessage } from '../utils/helpers'

const workerRedis = new Redis(process.env.REDIS_URL!)

async function processQueue() {
  console.log('Nickname writer worker started')

  const BATCH_SIZE = 50
  const BATCH_TIMEOUT_MS = 1000

  while (true) {
    try {
      const batch: Array<any> = []

      const first = await workerRedis.brpop('nicknames:queue', 0)
      if (!first) continue
      batch.push(JSON.parse(first[1]))

      const start = Date.now()
      while (batch.length < BATCH_SIZE && Date.now() - start < BATCH_TIMEOUT_MS) {
        const res = await workerRedis.brpop('nicknames:queue', 0.2)
        if (!res) break
        batch.push(JSON.parse(res[1]))
      }

      const rows = batch.map((p) => ({
        g_id: p.g_id,
        name: p.name,
        email: p.email || null,
        user_id: p.user_id || null,
      }))

      try {
        await db.transaction(async (tx) => {
          for (const r of rows) {
            await tx.insert(nicknames).values(r)
          }
        })
        console.log(`Persisted batch of ${rows.length} nicknames to DB`)
      } catch (err) {
        console.error('Batch insert failed, falling back to individual retries:', getErrorMessage(err))
        for (const p of rows) {
          let attempt = 0
          let success = false
          while (attempt < 5 && !success) {
            attempt++
            try {
              await db.insert(nicknames).values({
                g_id: p.g_id,
                name: p.name,
                email: p.email,
                user_id: p.user_id,
              })
              success = true
            } catch (e) {
              console.error(`Nickname writer attempt ${attempt} failed for ${p.name}:`, getErrorMessage(e))
              await new Promise((r) => setTimeout(r, 200 * attempt))
            }
          }
          if (!success) {
            console.error('Failed to persist nickname after retries, re-queueing for later:', p.name)
            await workerRedis.lpush('nicknames:queue', JSON.stringify(p))
            await new Promise((r) => setTimeout(r, 2000))
          }
        }
      }
    } catch (err) {
      console.error('Nickname writer loop error:', getErrorMessage(err))
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
}

processQueue().catch((err) => {
  console.error('Nickname writer crashed:', err)
  process.exit(1)
})

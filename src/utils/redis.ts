import Redis from 'ioredis'

const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379'

const redis = new Redis(redisUrl, {
  connectTimeout: 5000,
  maxRetriesPerRequest: null,
  retryStrategy: (times) => Math.min(times * 50, 2000),
})

redis.on('connect', () => {
  console.info(`Connected to Redis at ${redisUrl}`)
})
redis.on('ready', () => {
  console.info('Redis ready')
})
redis.on('error', (err) => {
  console.error('Redis error', err)
})
redis.on('close', () => {
  console.warn('Redis connection closed')
})
redis.on('reconnecting', () => {
  console.info('Redis reconnecting...')
})

export default redis;
import http from 'http'
import app from './app'
import { WebSocketServer } from 'ws'
import redis from './utils/redis'
import GameSocketHandler from './sockets/gameSocketLogic'
import db from './index'
import GameRepository from './repositories/game'
import express from 'express'

const PORT = process.env.PORT || 3000
const server = http.createServer(app)

const wss = new WebSocketServer({server})
const gameRepo = new GameRepository(db, redis)
const io = new GameSocketHandler(wss, redis, gameRepo)

// Temporary debug endpoint to inspect DB pool and Redis status
const debugRouter = express.Router();
debugRouter.get('/pool', (req, res) => {
    try {
        // require pool from index to avoid circular import at top
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { pool } = require('./index');
        const poolInfo = {
            totalCount: pool.totalCount,
            idleCount: pool.idleCount,
            waitingCount: pool.waitingCount,
        };
        // Use non-blocking Redis status instead of awaiting ping
        const redisInfo = { status: redis.status };
        return res.status(200).json({ pool: poolInfo, redis: redisInfo });
    } catch (err) {
        return res.status(500).json({ error: String(err) });
    }
});

// lightweight immediate health check
debugRouter.get('/ping', (req, res) => {
    return res.status(200).json({ ok: true, time: Date.now() });
});

// Return nicknames queue length, with a safe timeout
debugRouter.get('/queue', async (req, res) => {
    const timeoutMs = 2000;
    const llenPromise = redis.llen('nicknames:queue');
    const timer = new Promise<number>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs));
    try {
        const len = await Promise.race([llenPromise, timer]) as number;
        return res.status(200).json({ queueLength: len });
    } catch (err) {
        return res.status(500).json({ error: String(err) });
    }
});

app.use('/debug', debugRouter);

// quick DB connectivity and activity endpoints
debugRouter.get('/db-test', async (req, res) => {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { pool } = require('./index');
        const result = await pool.query('SELECT 1 AS ok, NOW() AS now');
        return res.status(200).json({ rows: result.rows });
    } catch (err) {
        return res.status(500).json({ error: String(err) });
    }
});

debugRouter.get('/pg-activity', async (req, res) => {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { pool } = require('./index');
        const sql = `SELECT pid, state, query, wait_event_type, wait_event, state_change, now() - state_change AS running_for
                     FROM pg_stat_activity
                     WHERE pid <> pg_backend_pid()
                     ORDER BY state_change DESC
                     LIMIT 50`;
        const result = await pool.query(sql);
        return res.status(200).json({ rows: result.rows });
    } catch (err) {
        return res.status(500).json({ error: String(err) });
    }
});

server.listen(PORT, () => {
    console.log(`Service live on port ${PORT}`)
})

// Start background worker to persist nicknames from Redis queue
try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('./workers/nickname_writer');
} catch (err) {
    console.error('Failed to start nickname writer worker', err);
}


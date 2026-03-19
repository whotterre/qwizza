import http from 'http'
import app from './app'
import { WebSocketServer } from 'ws'
import redis from './utils/redis'
import GameSocketHandler from './sockets/gameSocketLogic'
import db from './index'
import GameRepository from './repositories/game'

const PORT = process.env.PORT || 3000
const server = http.createServer(app)

const wss = new WebSocketServer({server})
const gameRepo = new GameRepository(db)
const io = new GameSocketHandler(wss, redis, gameRepo)

server.listen(PORT, () => {
    console.log(`Service live on port ${PORT}`)
})


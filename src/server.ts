import http from 'http'
import app from './app'
import { WebSocketServer } from 'ws'
import redis from './utils/redis'
import GameSocketHandler from './sockets/GameSocketHandler'

const PORT = process.env.PORT || 3000
const server = http.createServer(app)


const wss = new WebSocketServer({server})

const io = new GameSocketHandler(wss, redis)

server.listen(PORT, () => {
    console.log(`Service live on port ${PORT}`)
})


import http from 'http'
import app from './app'
import { WebSocketServer } from 'ws'

const PORT = process.env.PORT || 3000
const server = http.createServer(app)

const wss = new WebSocketServer({server})

server.listen(PORT, () => {
    console.log(`Service live on port ${PORT}`)
})
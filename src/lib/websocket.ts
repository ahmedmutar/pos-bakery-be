import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage } from 'http'
import type { Server } from 'http'
import { verifyToken } from './jwt.js'

interface AuthedSocket extends WebSocket {
  tenantId?: string
  userId?: string
  isAlive?: boolean
}

interface WSMessage {
  type: string
  payload?: unknown
}

let wss: WebSocketServer | null = null

export function createWSServer(server: Server) {
  wss = new WebSocketServer({ server, path: '/ws' })

  wss.on('connection', (socket: AuthedSocket, req: IncomingMessage) => {
    socket.isAlive = true

    // Auth via query param: /ws?token=xxx
    const url = new URL(req.url ?? '', 'http://localhost')
    const token = url.searchParams.get('token')

    if (!token) {
      socket.close(4001, 'Unauthorized')
      return
    }

    try {
      const payload = verifyToken(token)
      socket.tenantId = payload.tenantId
      socket.userId = payload.userId
    } catch {
      socket.close(4001, 'Invalid token')
      return
    }

    socket.on('pong', () => { socket.isAlive = true })

    socket.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as WSMessage
        // Client can send ping to keep alive
        if (msg.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong' }))
        }
      } catch {
        // ignore malformed messages
      }
    })

    socket.on('error', () => socket.terminate())

    // Send welcome
    socket.send(JSON.stringify({ type: 'connected', payload: { tenantId: socket.tenantId } }))
  })

  // Heartbeat — close dead connections every 30s
  const heartbeat = setInterval(() => {
    wss?.clients.forEach((client) => {
      const s = client as AuthedSocket
      if (!s.isAlive) {
        s.terminate()
        return
      }
      s.isAlive = false
      s.ping()
    })
  }, 30_000)

  wss.on('close', () => clearInterval(heartbeat))

  console.log('🔌 WebSocket server aktif di /ws')
  return wss
}

// Broadcast event to all clients in same tenant
export function broadcastToTenant(tenantId: string, event: WSMessage) {
  if (!wss) return
  const msg = JSON.stringify(event)
  wss.clients.forEach((client) => {
    const s = client as AuthedSocket
    if (s.tenantId === tenantId && s.readyState === WebSocket.OPEN) {
      s.send(msg)
    }
  })
}

// Event types
export const WS_EVENTS = {
  TRANSACTION_CREATED: 'TRANSACTION_CREATED',
  SHIFT_OPENED: 'SHIFT_OPENED',
  SHIFT_CLOSED: 'SHIFT_CLOSED',
  LOW_STOCK_ALERT: 'LOW_STOCK_ALERT',
  PREORDER_UPDATED: 'PREORDER_UPDATED',
} as const

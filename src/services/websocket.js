const WebSocket = require('ws');

let wss = null;
const rooms = new Map(); // room -> Set<ws>

function initWebSocket(server) {
  wss = new WebSocket.Server({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.rooms = new Set();

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        // Client subscribes to rooms: { type: 'subscribe', room: 'kitchen:home-kitchen' }
        if (msg.type === 'subscribe' && msg.room) {
          ws.rooms.add(msg.room);
          if (!rooms.has(msg.room)) rooms.set(msg.room, new Set());
          rooms.get(msg.room).add(ws);
        }
        if (msg.type === 'unsubscribe' && msg.room) {
          ws.rooms.delete(msg.room);
          rooms.get(msg.room)?.delete(ws);
        }
      } catch {}
    });

    ws.on('close', () => {
      // Clean up room memberships
      for (const room of ws.rooms) {
        rooms.get(room)?.delete(ws);
        if (rooms.get(room)?.size === 0) rooms.delete(room);
      }
    });

    ws.on('error', () => {
      for (const room of ws.rooms) {
        rooms.get(room)?.delete(ws);
      }
    });

    ws.send(JSON.stringify({ type: 'connected', message: 'Connected to Thali Plan real-time updates' }));
  });

  // Heartbeat every 30s
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => clearInterval(interval));
  console.log('WebSocket server initialized with room support');
  return wss;
}

function broadcastToRoom(room, event, data) {
  const clients = rooms.get(room);
  if (!clients) return;
  const message = JSON.stringify({ type: event, ...data, timestamp: new Date().toISOString() });
  clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(message);
  });
}

function broadcastAll(event, data) {
  if (!wss) return;
  const message = JSON.stringify({ type: event, ...data, timestamp: new Date().toISOString() });
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(message);
  });
}

function broadcastNewOrder(order, kitchenId) {
  broadcastToRoom(`kitchen:${kitchenId}`, 'order:new', { order });
}

function broadcastOrderUpdate(orderId, status, kitchenId, customerId) {
  broadcastToRoom(`kitchen:${kitchenId}`, 'order:updated', { orderId, status });
  if (customerId) broadcastToRoom(`customer:${customerId}`, 'order:updated', { orderId, status });
}

function broadcastPayment(orderId, paid) {
  broadcastAll('order:paid', { orderId, paid });
}

function broadcastDeliveryLocation(orderId, lat, lng, customerId) {
  if (customerId) broadcastToRoom(`customer:${customerId}`, 'delivery:location', { orderId, lat, lng });
}

module.exports = {
  initWebSocket,
  broadcastToRoom,
  broadcastAll,
  broadcastNewOrder,
  broadcastOrderUpdate,
  broadcastPayment,
  broadcastDeliveryLocation,
};
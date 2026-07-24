const WebSocket = require('ws');

let wss = null;
let clients = new Set();

function initWebSocket(server) {
  wss = new WebSocket.Server({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    clients.add(ws);
    console.log('WebSocket client connected (' + clients.size + ' total)');

    ws.on('close', () => {
      clients.delete(ws);
      console.log('WebSocket client disconnected (' + clients.size + ' remaining)');
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err.message);
      clients.delete(ws);
    });

    ws.send(JSON.stringify({ type: 'connected', message: 'Connected to Thali Plan real-time updates' }));
  });

  console.log('WebSocket server initialized');
  return wss;
}

function broadcast(event, data) {
  if (!wss) return;
  const message = JSON.stringify({ type: event, ...data, timestamp: new Date().toISOString() });
  let sent = 0;
  clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
      sent++;
    }
  });
  if (sent > 0) console.log('Broadcast "' + event + '" to ' + sent + ' client(s)');
}

function broadcastNewOrder(order) {
  broadcast('order:new', { order });
}

function broadcastOrderUpdate(orderId, status) {
  broadcast('order:updated', { orderId, status });
}

function broadcastPayment(orderId, paid) {
  broadcast('order:paid', { orderId, paid });
}

function broadcastDeliveryLocation(orderId, lat, lng) {
  broadcast('delivery:location', { orderId, lat, lng });
}

module.exports = {
  initWebSocket,
  broadcast,
  broadcastNewOrder,
  broadcastOrderUpdate,
  broadcastPayment,
  broadcastDeliveryLocation,
};

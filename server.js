/**
 * Thali Plan — Main Server
 * Express 5 + WebSocket + PostgreSQL
 */
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const http = require('http');
const path = require('path');

const { pool } = require('./src/db/pool');
const { errorHandler } = require('./src/middleware/errorHandler');
const { initWebSocket } = require('./src/services/websocket');

// Route imports
const ordersRouter = require('./src/routes/orders');
const kitchensRouter = require('./src/routes/kitchens');

const app = express();
const server = http.createServer(app);

// ─── Middleware ──────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CORS_ORIGIN || '*', credentials: true }));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Static Files ──────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─── API Routes ─────────────────────────────────────────
app.use('/api/orders', ordersRouter);
app.use('/api/kitchens', kitchensRouter);

// OTP endpoint (stub - integrates with your chosen SMS provider)
app.post('/api/send-otp', (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone number required' });
  // In production: integrate with Twilio Verify, MSG91, etc.
  console.log(`📱 OTP requested for ${phone} — demo mode: OTP is 0000`);
  res.json({ success: true, message: 'OTP sent (demo: use 0000)' });
});

// Health check — this one handles its own errors, no asyncHandler needed
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', uptime: process.uptime() });
  } catch (_err) {
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

// Calendar events endpoint (for kitchen dashboard calendar view)
app.get('/api/calendar/events', async (req, res) => {
  const { getUpcomingPrepSlots } = require('./src/services/calendar');
  const fromDate = req.query.from ? new Date(req.query.from) : new Date();
  const toDate = req.query.to ? new Date(req.query.to) : new Date(Date.now() + 7 * 86400000);
  const events = await getUpcomingPrepSlots(fromDate, toDate);

  const formatted = events.map(e => ({
    id: e.id,
    summary: e.summary,
    description: e.description,
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
    colorId: e.colorId,
  }));

  res.json(formatted);
});

// Payment webhook endpoint
app.post('/api/payments/webhook', async (req, res) => {
  const { handleWebhook } = require('./src/services/payment');
  const signature = req.headers['x-webhook-signature'] || req.headers['x-signature'];
  const result = await handleWebhook(req.body, signature);
  res.json(result);
});

// ─── SPA fallback ───────────────────────────────────────
// Express 5 middleware-based catch-all (no wildcard route needed)
// The static middleware above already serves kitchen.html, admin.html, etc.
// This catches any remaining GET requests and serves the SPA
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/') && !req.path.includes('.')) {
    return res.sendFile(path.join(__dirname, 'public', 'customer.html'));
  }
  next();
});

// ─── Error Handler ─────────────────────────────────────
app.use(errorHandler);

// ─── Start Server ──────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000');
const HOST = process.env.HOST || '0.0.0.0';

// Initialize WebSocket on the same HTTP server
initWebSocket(server);

server.listen(PORT, HOST, () => {
  console.log(`
╔══════════════════════════════════════════╗
║           Thali Plan Server              ║
║──────────────────────────────────────────║
║  API:      http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/api  ║
║  Customer: http://localhost:${PORT}                  ║
║  Kitchen:  http://localhost:${PORT}/kitchen.html     ║
║  Admin:    http://localhost:${PORT}/admin            ║
║  WebSocket: ws://localhost:${PORT}/ws                ║
║──────────────────────────────────────────║
║  DB:       ${process.env.DB_NAME || 'thaliplan'}                    ║
║  Node:     ${process.version}                         ║
╚══════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

async function gracefulShutdown() {
  console.log('\n🛑 Shutting down gracefully...');
  await pool.end();
  server.close(() => {
    console.log('✓ Server closed');
    process.exit(0);
  });
}

module.exports = { app, server };

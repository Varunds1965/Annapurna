/**
 * Thali Plan — Main Server (Production Ready)
 * Express 5 + WebSocket + PostgreSQL + JWT Auth + UPI Payments
 */
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const http = require('http');
const path = require('path');
const fs = require('fs');

const { pool } = require('./src/db/pool');
const { errorHandler } = require('./src/middleware/errorHandler');
const { initWebSocket } = require('./src/services/websocket');

// Route imports
const authRouter = require('./src/routes/auth');
const ordersRouter = require('./src/routes/orders');
const kitchensRouter = require('./src/routes/kitchens');
const analyticsRouter = require('./src/routes/analytics');
const subscriptionsRouter = require('./src/routes/subscriptions');
const reviewsRouter = require('./src/routes/reviews');
const deliveryRouter = require('./src/routes/delivery');
const couponsRouter = require('./src/routes/coupons');

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

// Serve uploaded files
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

// ─── API Routes ─────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/kitchens', kitchensRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/subscriptions', subscriptionsRouter);
app.use('/api/reviews', reviewsRouter);
app.use('/api/delivery', deliveryRouter);
app.use('/api/coupons', couponsRouter);

// Payment routes
app.post('/api/payments/create', async (req, res) => {
  try {
    const { createPhonePePayment } = require('./src/services/payment');
    const { amount, orderId, customerName, customerMobile } = req.body;
    const result = await createPhonePePayment(amount, orderId, customerName, customerMobile);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/payments/verify', async (req, res) => {
  try {
    const { verifyPayment } = require('./src/services/payment');
    const { orderId, transactionId } = req.body;
    const result = await verifyPayment(orderId, transactionId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Payment webhook endpoint
app.post('/api/payments/webhook', async (req, res) => {
  const { handleWebhook } = require('./src/services/payment');
  const signature = req.headers['x-webhook-signature'] || req.headers['x-signature'];
  const result = await handleWebhook(req.body, signature);
  res.json(result);
});

// PhonePe callback
app.post('/api/payments/phonepe-callback', (req, res) => {
  console.log('PhonePe callback received:', req.body);
  res.redirect('/customer.html?payment=success');
});

// PhonePe webhook
app.post('/api/payments/phonepe-webhook', async (req, res) => {
  console.log('PhonePe webhook received:', req.body);
  const { verifyPayment } = require('./src/services/payment');
  if (req.body && req.body.transactionId && req.body.orderId) {
    await verifyPayment(req.body.orderId, req.body.transactionId);
  }
  res.json({ success: true });
});

// Health check
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', uptime: process.uptime() });
  } catch (_err) {
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

// Calendar events endpoint
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

// ─── SPA fallback ───────────────────────────────────────
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
║  Admin:    http://localhost:${PORT}/admin.html       ║
║  Register: http://localhost:${PORT}/kitchen-register.html ║
║  WebSocket: ws://localhost:${PORT}/ws                ║
║──────────────────────────────────────────║
║  DB:       ${process.env.DB_NAME || 'thaliplan'}                    ║
║  Node:     ${process.version}                         ║
║  UPI:      ${process.env.UPI_VPA || '917676531524@ibl'}          ║
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
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

// Razorpay webhook
app.post('/api/payments/razorpay-webhook', async (req, res) => {
  const { verifyRazorpayPayment } = require('./src/services/razorpay');
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  
  if (razorpay_order_id && razorpay_payment_id && razorpay_signature) {
    const result = await verifyRazorpayPayment(razorpay_order_id, razorpay_payment_id, razorpay_signature);
    if (result.success) {
      // Find order by razorpay order ID
      const { pool } = require('./src/db/pool');
      const orderRes = await pool.query(`SELECT id FROM orders WHERE id = $1`, [razorpay_order_id]);
      if (orderRes.rows.length > 0) {
        await require('./src/services/payment').verifyPayment(orderRes.rows[0].id, razorpay_payment_id);
      }
    }
  }
  res.json({ success: true });
});

// Razorpay payment verification (frontend callback)
app.post('/api/payments/razorpay/verify', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderId } = req.body;
    const { verifyRazorpayPayment } = require('./src/services/razorpay');
    const { verifyPayment } = require('./src/services/payment');
    
    const result = await verifyRazorpayPayment(razorpay_order_id, razorpay_payment_id, razorpay_signature);
    
    if (result.success) {
      // Mark order as paid
      await verifyPayment(orderId, razorpay_payment_id);
      res.json({ success: true, message: 'Payment verified successfully', ...result });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Paytm callback
app.post('/api/payments/paytm-callback', async (req, res) => {
  const { verifyPaytmPayment } = require('./src/services/paytm');
  const merchantKey = process.env.PAYTM_MERCHANT_KEY;
  
  const result = await verifyPaytmPayment(req.body, merchantKey);
  if (result.success) {
    const { orderId } = req.body;
    const { verifyPayment } = require('./src/services/payment');
    await verifyPayment(orderId, result.txnId);
  }
  
  res.json(result);
});

// Paytm webhook
app.post('/api/payments/paytm-webhook', async (req, res) => {
  const { verifyPaytmPayment } = require('./src/services/paytm');
  const merchantKey = process.env.PAYTM_MERCHANT_KEY;
  
  const result = await verifyPaytmPayment(req.body, merchantKey);
  if (result.success) {
    const { orderId } = req.body;
    const { verifyPayment } = require('./src/services/payment');
    await verifyPayment(orderId, result.txnId);
  }
  
  res.json(result);
});

// Stripe webhook — FIXED: signature verification
app.post('/api/payments/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!endpointSecret) {
    console.warn('STRIPE_WEBHOOK_SECRET not set — skipping signature verification');
    return res.status(400).json({ error: 'Webhook not configured' });
  }

  // Verify signature
  const crypto = require('crypto');
  const payload = req.body;
  const elements = sig.split(',');
  const timestamp = elements.find(e => e.startsWith('t='))?.split('=')[1];
  const signature = elements.find(e => e.startsWith('v1='))?.split('=')[1];

  const signedPayload = `${timestamp}.${payload}`;
  const expectedSignature = crypto
    .createHmac('sha256', endpointSecret)
    .update(signedPayload)
    .digest('hex');

  if (signature !== expectedSignature) {
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const event = JSON.parse(payload);
  const { verifyPayment } = require('./src/services/payment');

  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object;
    const orderId = paymentIntent.metadata?.thali_order_id;
    if (orderId) await verifyPayment(orderId, paymentIntent.id);
  }

  res.json({ received: true });
});
// Create payment order (unified endpoint)
app.post('/api/payments/create-order', async (req, res) => {
  try {
    const { amount, orderId, customerName, customerEmail, customerMobile, method } = req.body;
    const { createPaymentOrder } = require('./src/services/payment');
    
    const result = await createPaymentOrder(amount, orderId, customerName, customerEmail, customerMobile, method);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Verify payment (unified endpoint)
app.post('/api/payments/verify', async (req, res) => {
  try {
    const { method, ...paymentDetails } = req.body;
    const { verifyPaymentByMethod } = require('./src/services/payment');
    
    const result = await verifyPaymentByMethod(method, paymentDetails);
    if (result.success) {
      res.json({ success: true, ...result });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get available payment methods
app.get('/api/payments/methods', async (req, res) => {
  try {
    const { getAvailablePaymentMethods } = require('./src/services/payment');
    const methods = getAvailablePaymentMethods();
    res.json({ methods });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Discount engine — get best available discount
app.post('/api/discount/calculate', async (req, res) => {
  try {
    const { customerId, orderTotal, couponCode } = req.body;
    const { calculateBestDiscount } = require('./src/services/discountEngine');
    const result = await calculateBestDiscount(customerId, orderTotal, couponCode);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Discount engine — get active offers for banners
app.get('/api/discount/offers', async (req, res) => {
  try {
    const customerId = req.query.customerId ? parseInt(req.query.customerId) : null;
    const { getActiveOffers } = require('./src/services/discountEngine');
    const offers = await getActiveOffers(customerId);
    res.json({ offers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Kitchen distance & ETA
app.get('/api/kitchens/nearby', async (req, res) => {
  try {
    const { lat, lng } = req.query;
    const { pool } = require('./src/db/pool');
    
    let query = `SELECT id, name, type, active, rating_text, lat, lng, address, photo_url, opening_time, closing_time FROM kitchens WHERE active = true`;
    const params = [];
    
    if (lat && lng) {
      query = `SELECT id, name, type, active, rating_text, lat, lng, address, photo_url, opening_time, closing_time,
        (6371 * acos(cos(radians($1)) * cos(radians(lat)) * cos(radians(lng) - radians($2)) + sin(radians($1)) * sin(radians(lat)))) AS distance_km
        FROM kitchens WHERE active = true ORDER BY distance_km ASC`;
      params.push(parseFloat(lat), parseFloat(lng));
    } else {
      query += ` ORDER BY name ASC`;
    }
    
    const result = await pool.query(query, params);
    const kitchens = result.rows.map(k => ({
      ...k,
      distance_km: k.distance_km ? parseFloat(k.distance_km.toFixed(1)) : null,
      eta_min: k.distance_km ? Math.max(15, Math.round(k.distance_km * 3 + 10)) : null,
    }));
    
    res.json(kitchens);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reorder — repeat a previous order
app.post('/api/orders/reorder/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { pool } = require('./src/db/pool');
    
    const orderRes = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
    if (orderRes.rows.length === 0) return res.status(404).json({ error: 'Order not found' });
    
    const order = orderRes.rows[0];
    const { v4: uuidv4 } = require('uuid');
    const newOrderId = `ord_${Date.now()}_${uuidv4().slice(0, 6)}`;
    
    await pool.query(
      `INSERT INTO orders (id, customer_name, customer_email, customer_mobile, customer_id, kitchen_id, items_by_meal, total, payment_method, status, placed_at, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, 'placed', NOW(), $10)`,
      [newOrderId, order.customer_name, order.customer_email, order.customer_mobile, order.customer_id,
       order.kitchen_id, JSON.stringify(order.items_by_meal), order.total, order.payment_method, 'Reordered from #' + orderId.slice(-8)]
    );
    
    res.json({ success: true, orderId: newOrderId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
║  UPI:      ${process.env.UPI_VPA || 'not configured'}          ║
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
// Loyalty points
app.get('/api/loyalty/balance', authenticate, authorize('customer'), async (req, res) => {
  const { getBalance, getHistory } = require('./src/services/loyalty');
  const balance = await getBalance(req.user.id);
  const history = await getHistory(req.user.id);
  res.json({ balance, history });
});

app.post('/api/loyalty/redeem', authenticate, authorize('customer'), async (req, res) => {
  const { redeemPoints } = require('./src/services/loyalty');
  const { points } = req.body;
  if (!points || points <= 0) return res.status(400).json({ error: 'points must be positive' });
  const result = await redeemPoints(req.user.id, points);
  if (!result.success) return res.status(400).json(result);
  res.json(result);
});
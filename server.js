/**
 * Thali Plan — Main Server (Production Ready)
 * Express 4 + WebSocket + PostgreSQL + JWT Auth + UPI Payments
 */
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { pool } = require('./src/db/pool');
const { errorHandler } = require('./src/middleware/errorHandler');
const { initWebSocket } = require('./src/services/websocket');
const { authenticate, authorize } = require('./src/middleware/auth');

// Route imports
const authRouter = require('./src/routes/auth');
const ordersRouter = require('./src/routes/orders');
const kitchensRouter = require('./src/routes/kitchens');
const analyticsRouter = require('./src/routes/analytics');
const subscriptionsRouter = require('./src/routes/subscriptions');
const reviewsRouter = require('./src/routes/reviews');
const deliveryRouter = require('./src/routes/delivery');
const couponsRouter = require('./src/routes/coupons');

// Service imports (resolved once at boot instead of per-request)
const {
  createPhonePePayment,
  handleWebhook,
  verifyPayment,
  createPaymentOrder,
  verifyPaymentByMethod,
  getAvailablePaymentMethods,
} = require('./src/services/payment');
const { verifyRazorpayPayment } = require('./src/services/razorpay');
const { verifyPaytmPayment } = require('./src/services/paytm');
const { calculateBestDiscount, getActiveOffers } = require('./src/services/discountEngine');
const { getUpcomingPrepSlots } = require('./src/services/calendar');
const { getBalance, getHistory, redeemPoints, earnPoints } = require('./src/services/loyalty');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);

// Wrap async handlers so rejected promises reach the error handler
// instead of becoming unhandled rejections that kill the process.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ─── Middleware ──────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://checkout.razorpay.com", "https://js.stripe.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'", "wss:", "ws:", "https://api.razorpay.com", "https://api.stripe.com"],
      frameSrc: ["https://api.razorpay.com", "https://js.stripe.com"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
}));

// `origin: '*'` is invalid alongside `credentials: true` — browsers reject it.
// `true` reflects the requesting origin, which is a valid credentialed config.
app.use(cors({ origin: process.env.CORS_ORIGIN || true, credentials: true }));
app.use(morgan('dev'));

// ─── Stripe webhook (MUST be registered before express.json) ─────────────
// Stripe signature verification needs the raw, unparsed body.
app.post('/api/payments/stripe-webhook', express.raw({ type: 'application/json' }), asyncHandler(async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!endpointSecret) {
    console.warn('STRIPE_WEBHOOK_SECRET not set — rejecting webhook');
    return res.status(400).json({ error: 'Webhook not configured' });
  }
  if (!sig) return res.status(400).json({ error: 'Missing stripe-signature header' });

  const elements = sig.split(',');
  const timestamp = elements.find((e) => e.startsWith('t='))?.split('=')[1];
  const signature = elements.find((e) => e.startsWith('v1='))?.split('=')[1];
  if (!timestamp || !signature) return res.status(400).json({ error: 'Malformed signature header' });

  // Reject replays older than 5 minutes
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) {
    return res.status(400).json({ error: 'Signature timestamp outside tolerance' });
  }

  const payload = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body);
  const expectedSignature = crypto
    .createHmac('sha256', endpointSecret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');

  const provided = Buffer.from(signature, 'utf8');
  const expected = Buffer.from(expectedSignature, 'utf8');
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return res.status(400).json({ error: 'Invalid signature' });
  }

  let event;
  try {
    event = JSON.parse(payload);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object;
    const orderId = paymentIntent.metadata?.thali_order_id;
    if (orderId) await verifyPayment(orderId, paymentIntent.id);
  }

  res.json({ received: true });
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Additional security headers
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
  next();
});

// ─── Static Files ──────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// Serve uploaded files
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

// ─── Specific routes that must win over router wildcards ───────────────
// These were previously registered AFTER their routers, so `/:id`-style
// patterns inside the routers swallowed them.

// Kitchen distance & ETA
app.get('/api/kitchens/nearby', asyncHandler(async (req, res) => {
  const { lat, lng } = req.query;

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
  const kitchens = result.rows.map((k) => {
    // `pg` can return numerics as strings, and a distance of exactly 0 is falsy.
    const distance = k.distance_km == null ? null : Number(k.distance_km);
    return {
      ...k,
      distance_km: distance == null || Number.isNaN(distance) ? null : parseFloat(distance.toFixed(1)),
      eta_min: distance == null || Number.isNaN(distance) ? null : Math.max(15, Math.round(distance * 3 + 10)),
    };
  });

  res.json(kitchens);
}));

// Reorder — repeat a previous order
app.post('/api/orders/reorder/:orderId', asyncHandler(async (req, res) => {
  const { orderId } = req.params;

  const orderRes = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
  if (orderRes.rows.length === 0) return res.status(404).json({ error: 'Order not found' });

  const order = orderRes.rows[0];
  const newOrderId = `ord_${Date.now()}_${uuidv4().slice(0, 6)}`;

  await pool.query(
    `INSERT INTO orders (id, customer_name, customer_email, customer_mobile, customer_id, kitchen_id, items_by_meal, total, payment_method, status, placed_at, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, 'placed', NOW(), $10)`,
    [newOrderId, order.customer_name, order.customer_email, order.customer_mobile, order.customer_id,
      order.kitchen_id, JSON.stringify(order.items_by_meal), order.total, order.payment_method, 'Reordered from #' + orderId.slice(-8)]
  );

  res.json({ success: true, orderId: newOrderId });
}));

// ─── API Routes ─────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/kitchens', kitchensRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/subscriptions', subscriptionsRouter);
app.use('/api/reviews', reviewsRouter);
app.use('/api/delivery', deliveryRouter);
app.use('/api/coupons', couponsRouter);

// ─── Payments ───────────────────────────────────────────
app.post('/api/payments/create', asyncHandler(async (req, res) => {
  const { amount, orderId, customerName, customerMobile } = req.body;
  const result = await createPhonePePayment(amount, orderId, customerName, customerMobile);
  res.json(result);
}));

// Generic payment webhook endpoint
app.post('/api/payments/webhook', asyncHandler(async (req, res) => {
  const signature = req.headers['x-webhook-signature'] || req.headers['x-signature'];
  const result = await handleWebhook(req.body, signature);
  res.json(result);
}));

// PhonePe callback
// NOTE: this only redirects the browser; it does not mark the order paid.
// Payment state is confirmed by the webhook below.
app.post('/api/payments/phonepe-callback', (req, res) => {
  res.redirect('/customer.html?payment=pending');
});

// PhonePe webhook
app.post('/api/payments/phonepe-webhook', asyncHandler(async (req, res) => {
  if (req.body && req.body.transactionId && req.body.orderId) {
    await verifyPayment(req.body.orderId, req.body.transactionId);
  }
  res.json({ success: true });
}));

// Razorpay webhook
// TODO: `razorpay_order_id` is Razorpay's id, not the local order id. The lookup
// below only works if the two happen to match. Persist the Razorpay order id on
// the orders table (or read `notes.thali_order_id`) and match on that instead.
app.post('/api/payments/razorpay-webhook', asyncHandler(async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  if (razorpay_order_id && razorpay_payment_id && razorpay_signature) {
    const result = await verifyRazorpayPayment(razorpay_order_id, razorpay_payment_id, razorpay_signature);
    if (result.success) {
      const orderRes = await pool.query(`SELECT id FROM orders WHERE id = $1`, [razorpay_order_id]);
      if (orderRes.rows.length > 0) {
        await verifyPayment(orderRes.rows[0].id, razorpay_payment_id);
      }
    }
  }
  res.json({ success: true });
}));

// Razorpay payment verification (frontend callback)
app.post('/api/payments/razorpay/verify', asyncHandler(async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderId } = req.body;

  const result = await verifyRazorpayPayment(razorpay_order_id, razorpay_payment_id, razorpay_signature);

  if (result.success) {
    await verifyPayment(orderId, razorpay_payment_id);
    res.json({ success: true, message: 'Payment verified successfully', ...result });
  } else {
    res.status(400).json({ success: false, error: result.error });
  }
}));

// Paytm callback + webhook (identical handling)
const paytmHandler = asyncHandler(async (req, res) => {
  const merchantKey = process.env.PAYTM_MERCHANT_KEY;
  const result = await verifyPaytmPayment(req.body, merchantKey);

  if (result.success) {
    const { orderId } = req.body;
    await verifyPayment(orderId, result.txnId);
  }

  res.json(result);
});
app.post('/api/payments/paytm-callback', paytmHandler);
app.post('/api/payments/paytm-webhook', paytmHandler);

// Create payment order (unified endpoint)
app.post('/api/payments/create-order', asyncHandler(async (req, res) => {
  const { amount, orderId, customerName, customerEmail, customerMobile, method } = req.body;
  const result = await createPaymentOrder(amount, orderId, customerName, customerEmail, customerMobile, method);
  res.json(result);
}));

// Verify payment (unified endpoint)
app.post('/api/payments/verify', asyncHandler(async (req, res) => {
  const { method, ...paymentDetails } = req.body;
  const result = await verifyPaymentByMethod(method, paymentDetails);
  if (result.success) {
    res.json({ success: true, ...result });
  } else {
    res.status(400).json({ success: false, error: result.error });
  }
}));

// Get available payment methods
app.get('/api/payments/methods', (req, res) => {
  res.json({ methods: getAvailablePaymentMethods() });
});

// ─── Discounts ──────────────────────────────────────────
app.post('/api/discount/calculate', asyncHandler(async (req, res) => {
  const { customerId, orderTotal, couponCode } = req.body;
  const result = await calculateBestDiscount(customerId, orderTotal, couponCode);
  res.json(result);
}));

app.get('/api/discount/offers', asyncHandler(async (req, res) => {
  const customerId = req.query.customerId ? parseInt(req.query.customerId, 10) : null;
  const offers = await getActiveOffers(customerId);
  res.json({ offers });
}));

// ─── Health check ───────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', uptime: process.uptime() });
  } catch (_err) {
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

// ─── Calendar ───────────────────────────────────────────
app.get('/api/calendar/events', asyncHandler(async (req, res) => {
  const fromDate = req.query.from ? new Date(req.query.from) : new Date();
  const toDate = req.query.to ? new Date(req.query.to) : new Date(Date.now() + 7 * 86400000);
  const events = await getUpcomingPrepSlots(fromDate, toDate);

  const formatted = (events || []).map((e) => ({
    id: e.id,
    summary: e.summary,
    description: e.description,
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
    colorId: e.colorId,
  }));

  res.json(formatted);
}));

// ─── Loyalty ────────────────────────────────────────────
app.get('/api/loyalty/balance', authenticate, authorize('customer'), asyncHandler(async (req, res) => {
  const [balance, history] = await Promise.all([getBalance(req.user.id), getHistory(req.user.id)]);
  res.json({ balance, history });
}));

app.post('/api/loyalty/redeem', authenticate, authorize('customer'), asyncHandler(async (req, res) => {
  const { points } = req.body;
  if (!points || points <= 0) return res.status(400).json({ error: 'points must be positive' });
  const result = await redeemPoints(req.user.id, points);
  if (!result.success) return res.status(400).json(result);
  res.json(result);
}));

// ─── Referral System ────────────────────────────────────
const REFERRAL_BONUS_POINTS = 50;

app.post('/api/referral/apply', authenticate, authorize('customer'), asyncHandler(async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Referral code required' });

  const customer = await pool.query('SELECT id, referred_by FROM customers WHERE id = $1', [req.user.id]);
  if (customer.rows[0]?.referred_by) {
    return res.status(400).json({ error: 'You have already used a referral code' });
  }

  const referrer = await pool.query('SELECT id, name FROM customers WHERE referral_code = $1', [code.toUpperCase()]);
  if (referrer.rows.length === 0) {
    return res.status(404).json({ error: 'Invalid referral code' });
  }
  if (referrer.rows[0].id === req.user.id) {
    return res.status(400).json({ error: 'You cannot refer yourself' });
  }

  await pool.query('UPDATE customers SET referred_by = $1 WHERE id = $2', [code.toUpperCase(), req.user.id]);

  // Reward both sides. Value and copy were out of sync (500 awarded, "50" advertised).
  await earnPoints(req.user.id, null, REFERRAL_BONUS_POINTS);
  await earnPoints(referrer.rows[0].id, null, REFERRAL_BONUS_POINTS);

  res.json({
    success: true,
    message: `Referral applied! You and ${referrer.rows[0].name} both earned ${REFERRAL_BONUS_POINTS} bonus points.`,
  });
}));

app.get('/api/referral/info', authenticate, authorize('customer'), asyncHandler(async (req, res) => {
  const result = await pool.query('SELECT referral_code, referred_by FROM customers WHERE id = $1', [req.user.id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Customer not found' });

  const referralCount = await pool.query(
    'SELECT COUNT(*)::int as count FROM customers WHERE referred_by = $1',
    [result.rows[0].referral_code]
  );

  res.json({
    referralCode: result.rows[0].referral_code,
    referredBy: result.rows[0].referred_by,
    totalReferred: referralCount.rows[0].count,
  });
}));

// ─── SPA fallback ───────────────────────────────────────
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/') && !req.path.includes('.')) {
    return res.sendFile(path.join(__dirname, 'public', 'customer.html'));
  }
  next();
});

// ─── Error Handler (must stay last) ────────────────────
app.use(errorHandler);

// ─── Start Server ──────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

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

// Graceful shutdown — stop accepting connections first, then close the pool.
let shuttingDown = false;
async function gracefulShutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n🛑 Shutting down gracefully...');

  const forceExit = setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
  forceExit.unref();

  server.close(async () => {
    try {
      await pool.end();
    } catch (err) {
      console.error('Error closing DB pool:', err.message);
    }
    console.log('✓ Server closed');
    process.exit(0);
  });
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

module.exports = { app, server };

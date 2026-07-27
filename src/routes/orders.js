/**
 * Orders API — SECURED: auth on all mutating endpoints
 */
const { Router } = require('express');
const { pool } = require('../db/pool');
const { asyncHandler } = require('../middleware/errorHandler');
const { blockMealPrepSlot, updateEventStatus } = require('../services/calendar');
const { sendOrderConfirmationEmail, sendOrderConfirmationWhatsApp, sendStatusUpdate } = require('../services/notifications');
const { broadcastNewOrder, broadcastOrderUpdate, broadcastPayment } = require('../services/websocket');
const { authenticate, authorize, optionalAuth } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');

const router = Router();

// Rate limit order creation to prevent spam
const orderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many orders. Please slow down.' },
});

// CREATE ORDER — requires customer auth
router.post('/', authenticate, authorize('customer'), orderLimiter, asyncHandler(async (req, res) => {
  const { kitchenId, itemsByMeal, total, paymentMethod, notes } = req.body;

  if (!kitchenId || !itemsByMeal || !total) {
    return res.status(400).json({ error: 'kitchenId, itemsByMeal, and total are required' });
  }

  // Verify kitchen exists and is active
  const kitchenRes = await pool.query('SELECT id, active FROM kitchens WHERE id = $1', [kitchenId]);
  if (kitchenRes.rows.length === 0) return res.status(404).json({ error: 'Kitchen not found' });
  if (!kitchenRes.rows[0].active) return res.status(400).json({ error: 'Kitchen is not currently accepting orders' });

  // Get customer details from token
  const customerRes = await pool.query('SELECT id, name, email, mobile FROM customers WHERE id = $1', [req.user.id]);
  if (customerRes.rows.length === 0) return res.status(404).json({ error: 'Customer not found' });
  const customer = customerRes.rows[0];

  const orderId = `ord_${Date.now()}_${uuidv4().slice(0, 6)}`;
  const now = new Date().toISOString();

  // Validate payment method against allowed values
  const allowedMethods = ['upi', 'cod', 'phonepe', 'razorpay', 'stripe', 'paytm'];
  const method = allowedMethods.includes(paymentMethod) ? paymentMethod : 'cod';

  await pool.query(
    `INSERT INTO orders (id, customer_name, customer_email, customer_mobile, customer_id, kitchen_id, items_by_meal, total, payment_method, paid, status, placed_at, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, 'placed', $11, $12)`,
    [orderId, customer.name, customer.email, customer.mobile, customer.id,
     kitchenId, JSON.stringify(itemsByMeal), total, method, false, now, notes || null]
  );

  await pool.query(
    `INSERT INTO order_timeline (order_id, status, note) VALUES ($1, 'placed', 'Order placed by customer')`,
    [orderId]
  );

  const order = { id: orderId, customerName: customer.name, customerEmail: customer.email, customerMobile: customer.mobile, kitchenId, itemsByMeal, total, paymentMethod: method, paid: false, status: 'placed', placedAt: now };

  // Calendar integration
  if (itemsByMeal) {
    const mealStartTimes = {
      Breakfast: new Date(new Date(now).getTime() + 30 * 60000),
      Lunch: new Date(new Date(now).getTime() + 90 * 60000),
      Dinner: new Date(new Date(now).getTime() + 150 * 60000),
    };
    for (const [meal] of Object.entries(itemsByMeal)) {
      const startTime = mealStartTimes[meal] || new Date(new Date(now).getTime() + 120 * 60000);
      const eventId = await blockMealPrepSlot(order, meal, startTime);
      if (eventId) {
        await pool.query(`UPDATE orders SET calendar_event_id = $1 WHERE id = $2`, [eventId, orderId]);
      }
    }
  }

  // Notifications (fire and forget)
  if (customer.email) sendOrderConfirmationEmail(order).catch(() => {});
  if (customer.mobile) sendOrderConfirmationWhatsApp(order).catch(() => {});

  // Real-time broadcast to kitchen only
  broadcastNewOrder(order, kitchenId);

  res.status(201).json({ success: true, orderId });
}));

// CUSTOMER ORDER HISTORY (NEW)
router.get('/my-orders', authenticate, authorize('customer'), asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const result = await pool.query(
    `SELECT id, kitchen_id, items_by_meal, total, payment_method, paid, status, placed_at, delivered_at, notes
     FROM orders WHERE customer_id = $1 ORDER BY placed_at DESC LIMIT $2 OFFSET $3`,
    [req.user.id, parseInt(limit), offset]
  );

  const countRes = await pool.query('SELECT COUNT(*)::int as total FROM orders WHERE customer_id = $1', [req.user.id]);

  res.json({
    orders: result.rows,
    pagination: { page: parseInt(page), limit: parseInt(limit), total: countRes.rows[0].total },
  });
}));

// GET ALL ORDERS (admin only)
router.get('/admin/all', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { status, kitchenId, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let query = `SELECT * FROM orders WHERE 1=1`;
  const params = [];

  if (status) {
    params.push(status);
    query += ` AND status = $${params.length}`;
  }
  if (kitchenId) {
    params.push(kitchenId);
    query += ` AND kitchen_id = $${params.length}`;
  }
  params.push(parseInt(limit));
  query += ` ORDER BY placed_at DESC LIMIT $${params.length}`;
  params.push(offset);
  query += ` OFFSET $${params.length}`;

  const result = await pool.query(query, params);

  const formattedOrders = result.rows.map(row => ({
    id: row.id,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    customerMobile: row.customer_mobile,
    kitchenId: row.kitchen_id,
    itemsByMeal: row.items_by_meal,
    total: parseFloat(row.total),
    paymentMethod: row.payment_method,
    paid: row.paid,
    status: row.status,
    placedAt: row.placed_at,
    notes: row.notes,
  }));

  res.json(formattedOrders);
}));

// GET ORDERS BY KITCHEN — requires kitchen auth
router.get('/kitchen/:kitchenId', authenticate, authorize('kitchen', 'admin'), asyncHandler(async (req, res) => {
  const { kitchenId } = req.params;

  // Kitchen can only see their own orders
  if (req.user.role === 'kitchen' && req.user.kitchenId !== kitchenId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const { status, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let query = `SELECT * FROM orders WHERE kitchen_id = $1`;
  const params = [kitchenId];

  if (status) {
    query += ` AND status = $2`;
    params.push(status);
  }
  query += ` ORDER BY placed_at DESC LIMIT ${parseInt(limit)} OFFSET ${offset}`;

  const result = await pool.query(query, params);

  const formattedOrders = result.rows.map(row => ({
    id: row.id,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    customerMobile: row.customer_mobile,
    kitchenId: row.kitchen_id,
    itemsByMeal: row.items_by_meal,
    total: parseFloat(row.total),
    paymentMethod: row.payment_method,
    paid: row.paid,
    paymentId: row.payment_id,
    status: row.status,
    placedAt: row.placed_at,
    confirmedAt: row.confirmed_at,
    preparingAt: row.preparing_at,
    outForDeliveryAt: row.out_for_delivery_at,
    deliveredAt: row.delivered_at,
    cancelledAt: row.cancelled_at,
    notes: row.notes,
    calendarEventId: row.calendar_event_id,
  }));

  res.json(formattedOrders);
}));

// UPDATE ORDER STATUS — requires kitchen or admin auth
router.patch('/:orderId/status', authenticate, authorize('kitchen', 'admin'), asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const { status } = req.body;

  const validStatuses = ['confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
  }

  // Verify kitchen owns this order
  if (req.user.role === 'kitchen') {
    const ownerCheck = await pool.query('SELECT kitchen_id FROM orders WHERE id = $1', [orderId]);
    if (ownerCheck.rows.length === 0) return res.status(404).json({ error: 'Order not found' });
    if (ownerCheck.rows[0].kitchen_id !== req.user.kitchenId) {
      return res.status(403).json({ error: 'This order does not belong to your kitchen' });
    }
  }

  const statusColumnMap = {
    confirmed: 'confirmed_at',
    preparing: 'preparing_at',
    out_for_delivery: 'out_for_delivery_at',
    delivered: 'delivered_at',
    cancelled: 'cancelled_at',
  };

  const column = statusColumnMap[status];
  const now = new Date().toISOString();

  await pool.query(
    `UPDATE orders SET status = $1, ${column} = $2 WHERE id = $3`,
    [status, now, orderId]
  );

  await pool.query(
    `INSERT INTO order_timeline (order_id, status, note) VALUES ($1, $2, $3)`,
    [orderId, status, `Status updated to ${status}`]
  );

  const orderRes = await pool.query(`SELECT * FROM orders WHERE id = $1`, [orderId]);
  const order = orderRes.rows[0];

  if (order) {
    try {
      await sendStatusUpdate({
        customer_name: order.customer_name,
        customer_email: order.customer_email,
        customer_mobile: order.customer_mobile,
        id: order.id,
      }, status);
    } catch {}

    if (order.calendar_event_id && (status === 'delivered' || status === 'cancelled')) {
      try { await updateEventStatus(order.calendar_event_id, status); } catch {}
    }

    broadcastOrderUpdate(orderId, status, order.kitchen_id, order.customer_id);
  }

  res.json({ success: true, status });
}));

// MARK AS PAID — requires kitchen or admin
router.post('/:orderId/pay', authenticate, authorize('kitchen', 'admin'), asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const { transactionId } = req.body;

  await pool.query(
    `UPDATE orders SET paid = true, payment_id = $1 WHERE id = $2`,
    [transactionId || `manual_${Date.now()}`, orderId]
  );

  await pool.query(
    `INSERT INTO order_timeline (order_id, status, note) VALUES ($1, 'paid', 'Payment received')`,
    [orderId]
  );

  broadcastPayment(orderId, true);
  res.json({ success: true });
}));

// REORDER — requires customer auth
router.post('/reorder/:orderId', authenticate, authorize('customer'), asyncHandler(async (req, res) => {
  const { orderId } = req.params;

  const orderRes = await pool.query('SELECT * FROM orders WHERE id = $1 AND customer_id = $2', [orderId, req.user.id]);
  if (orderRes.rows.length === 0) return res.status(404).json({ error: 'Order not found or not yours' });

  const order = orderRes.rows[0];
  const newOrderId = `ord_${Date.now()}_${uuidv4().slice(0, 6)}`;

  await pool.query(
    `INSERT INTO orders (id, customer_name, customer_email, customer_mobile, customer_id, kitchen_id, items_by_meal, total, payment_method, status, placed_at, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, 'placed', NOW(), $10)`,
    [newOrderId, order.customer_name, order.customer_email, order.customer_mobile, order.customer_id,
     order.kitchen_id, JSON.stringify(order.items_by_meal), order.total, order.payment_method, 'Reordered from #' + orderId.slice(-8)]
  );

  await pool.query(
    `INSERT INTO order_timeline (order_id, status, note) VALUES ($1, 'placed', 'Reorder from previous order')`,
    [newOrderId]
  );

  broadcastNewOrder({ id: newOrderId, kitchenId: order.kitchen_id }, order.kitchen_id);

  res.json({ success: true, orderId: newOrderId });
}));

// GET ORDER TIMELINE — customer can see their own, kitchen their own
router.get('/:orderId/timeline', authenticate, asyncHandler(async (req, res) => {
  const { orderId } = req.params;

  // Verify access
  const orderRes = await pool.query('SELECT customer_id, kitchen_id FROM orders WHERE id = $1', [orderId]);
  if (orderRes.rows.length === 0) return res.status(404).json({ error: 'Order not found' });
  const order = orderRes.rows[0];

  if (req.user.role === 'customer' && order.customer_id !== req.user.id) {
    return res.status(403).json({ error: 'Access denied' });
  }
  if (req.user.role === 'kitchen' && order.kitchen_id !== req.user.kitchenId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const result = await pool.query(
    `SELECT * FROM order_timeline WHERE order_id = $1 ORDER BY timestamp ASC`,
    [orderId]
  );
  res.json(result.rows);
}));

// DELETE ORDER — admin only
router.delete('/:orderId', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { orderId } = req.params;

  await pool.query(`DELETE FROM order_timeline WHERE order_id = $1`, [orderId]);
  await pool.query(`DELETE FROM kitchen_schedule WHERE order_id = $1`, [orderId]);
  await pool.query(`DELETE FROM payment_transactions WHERE order_id = $1`, [orderId]);
  await pool.query(`DELETE FROM orders WHERE id = $1`, [orderId]);

  res.json({ success: true });
}));

module.exports = router;
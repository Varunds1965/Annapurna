/**
 * Orders API — create, list, update, deliver, pay
 */
const { Router } = require('express');
const { pool } = require('../db/pool');
const { asyncHandler } = require('../middleware/errorHandler');
const { blockMealPrepSlot, updateEventStatus } = require('../services/calendar');
const { sendOrderConfirmationEmail, sendOrderConfirmationWhatsApp, sendStatusUpdate } = require('../services/notifications');
const { broadcastNewOrder, broadcastOrderUpdate, broadcastPayment } = require('../services/websocket');
const { v4: uuidv4 } = require('uuid');

const router = Router();

// CREATE ORDER
router.post('/', asyncHandler(async (req, res) => {
  const { id, customerName, customerEmail, customerMobile, kitchenId, itemsByMeal, total, paymentMethod, paid, status, placedAt, notes } = req.body;

  const orderId = id || `ord_${Date.now()}_${uuidv4().slice(0, 6)}`;
  const now = placedAt || new Date().toISOString();

  await pool.query(
    `INSERT INTO orders (id, customer_name, customer_email, customer_mobile, kitchen_id, items_by_meal, total, payment_method, paid, status, placed_at, notes)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12)`,
    [orderId, customerName, customerEmail || null, customerMobile || null, kitchenId,
     JSON.stringify(itemsByMeal), total, paymentMethod || 'cod', paid || false, status || 'placed', now, notes || null]
  );

  // Log to timeline
  await pool.query(
    `INSERT INTO order_timeline (order_id, status, note) VALUES ($1, 'placed', 'Order placed by customer')`,
    [orderId]
  );

  const order = { id: orderId, customerName, customerEmail, customerMobile, kitchenId, itemsByMeal, total, paymentMethod, paid: paid || false, status: status || 'placed', placedAt: now };

  // Calendar integration — create prep events for each meal
  if (itemsByMeal) {
    const mealStartTimes = {
      Breakfast: new Date(new Date(now).getTime() + 30 * 60000),  // Prep starts 30min after order
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

  // Notifications
  if (customerEmail) {
    sendOrderConfirmationEmail(order).catch(() => {});
  }
  sendOrderConfirmationWhatsApp(order).catch(() => {});

  // Real-time broadcast
  broadcastNewOrder(order);

  res.status(201).json({ success: true, orderId });
}));

// GET ORDERS BY KITCHEN
router.get('/:kitchenId', asyncHandler(async (req, res) => {
  const { kitchenId } = req.params;
  const { status } = req.query; // optional filter

  let query = `SELECT * FROM orders WHERE kitchen_id = $1`;
  const params = [kitchenId];

  if (status) {
    query += ` AND status = $2`;
    params.push(status);
  }
  query += ` ORDER BY placed_at DESC`;

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

// UPDATE ORDER STATUS
router.patch('/:orderId/status', asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const { status } = req.body;

  const validStatuses = ['confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
  }

  // Map status to column
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

  // Timeline
  await pool.query(
    `INSERT INTO order_timeline (order_id, status, note) VALUES ($1, $2, $3)`,
    [orderId, status, `Status updated to ${status}`]
  );

  // Get order for notifications + calendar
  const orderRes = await pool.query(`SELECT * FROM orders WHERE id = $1`, [orderId]);
  const order = orderRes.rows[0];

  if (order) {
    // Send notification
    try {
      await sendStatusUpdate({
        customer_name: order.customer_name,
        customer_email: order.customer_email,
        customer_mobile: order.customer_mobile,
        id: order.id,
      }, status);
    } catch {}

    // Update calendar event
    if (order.calendar_event_id && (status === 'delivered' || status === 'cancelled')) {
      try {
        await updateEventStatus(order.calendar_event_id, status);
      } catch {}
    }

    // Broadcast
    broadcastOrderUpdate(orderId, status);
  }

  res.json({ success: true, status });
}));

// MARK AS DELIVERED
router.post('/:orderId/deliver', asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const now = new Date().toISOString();

  await pool.query(
    `UPDATE orders SET status = 'delivered', delivered_at = $1 WHERE id = $2`,
    [now, orderId]
  );

  await pool.query(
    `INSERT INTO order_timeline (order_id, status) VALUES ($1, 'delivered')`,
    [orderId]
  );

  // Get order for calendar update
  const orderRes = await pool.query(`SELECT * FROM orders WHERE id = $1`, [orderId]);
  const order = orderRes.rows[0];
  if (order?.calendar_event_id) {
    try { await updateEventStatus(order.calendar_event_id, 'delivered'); } catch {}
  }

  broadcastOrderUpdate(orderId, 'delivered');

  res.json({ success: true });
}));

// MARK AS PAID
router.post('/:orderId/pay', asyncHandler(async (req, res) => {
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

// GET ORDER TIMELINE
router.get('/:orderId/timeline', asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const result = await pool.query(
    `SELECT * FROM order_timeline WHERE order_id = $1 ORDER BY timestamp ASC`,
    [orderId]
  );
  res.json(result.rows);
}));

// DELETE ORDER (admin only)
router.delete('/:orderId', asyncHandler(async (req, res) => {
  const { orderId } = req.params;

  // Clean up related records
  await pool.query(`DELETE FROM order_timeline WHERE order_id = $1`, [orderId]);
  await pool.query(`DELETE FROM kitchen_schedule WHERE order_id = $1`, [orderId]);
  await pool.query(`DELETE FROM payment_transactions WHERE order_id = $1`, [orderId]);
  await pool.query(`DELETE FROM orders WHERE id = $1`, [orderId]);

  res.json({ success: true });
}));

module.exports = router;

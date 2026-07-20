/**
 * Subscriptions API — Weekly meal plan subscriptions
 * Customers subscribe to auto-generated daily orders
 */
const { Router } = require('express');
const { pool } = require('../db/pool');
const { asyncHandler } = require('../middleware/errorHandler');
const { v4: uuidv4 } = require('uuid');

const router = Router();

// CREATE SUBSCRIPTION
router.post('/', asyncHandler(async (req, res) => {
  const { customerName, customerEmail, customerMobile, kitchenId, meals, days, tier, weeklyPrice, startDate } = req.body;

  if (!customerName || !kitchenId || !meals || !days) {
    return res.status(400).json({ error: 'customerName, kitchenId, meals, and days are required' });
  }

  const id = `sub_${Date.now()}_${uuidv4().slice(0, 6)}`;
  const start = startDate ? new Date(startDate) : new Date();

  await pool.query(
    `INSERT INTO subscriptions (id, customer_name, customer_email, customer_mobile, kitchen_id, meals, days, tier, weekly_price, start_date, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)`,
    [id, customerName, customerEmail || null, customerMobile || null, kitchenId, meals, days, tier || 'basic', weeklyPrice || 0, start.toISOString()]
  );

  res.status(201).json({ success: true, subscriptionId: id });
}));

// LIST SUBSCRIPTIONS FOR A CUSTOMER
router.get('/customer/:customerName', asyncHandler(async (req, res) => {
  const { customerName } = req.params;
  const result = await pool.query(
    `SELECT * FROM subscriptions WHERE customer_name = $1 ORDER BY created_at DESC`,
    [customerName]
  );
  res.json(result.rows);
}));

// LIST ACTIVE SUBSCRIPTIONS FOR A KITCHEN
router.get('/kitchen/:kitchenId', asyncHandler(async (req, res) => {
  const { kitchenId } = req.params;
  const result = await pool.query(
    `SELECT * FROM subscriptions WHERE kitchen_id = $1 AND active = true ORDER BY created_at DESC`,
    [kitchenId]
  );
  res.json(result.rows);
}));

// PAUSE / RESUME SUBSCRIPTION
router.patch('/:id/toggle', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const sub = await pool.query(`SELECT active FROM subscriptions WHERE id = $1`, [id]);
  if (sub.rows.length === 0) return res.status(404).json({ error: 'Subscription not found' });
  const newActive = !sub.rows[0].active;
  await pool.query(`UPDATE subscriptions SET active = $1 WHERE id = $2`, [newActive, id]);
  res.json({ success: true, active: newActive });
}));

// GET UPCOMING ORDERS FOR A SUBSCRIPTION
router.get('/:id/schedule', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const sub = await pool.query(`SELECT * FROM subscriptions WHERE id = $1`, [id]);
  if (sub.rows.length === 0) return res.status(404).json({ error: 'Subscription not found' });
  const s = sub.rows[0];

  // Generate next week's schedule
  const today = new Date();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const schedule = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() + i);
    const dayName = dayNames[date.getDay()];
    if (s.days.includes(dayName)) {
      schedule.push({
        date: date.toISOString().split('T')[0],
        day: dayName,
        meals: s.meals,
      });
    }
  }

  // Get existing auto-generated orders for this sub
  const existingOrders = await pool.query(
    `SELECT * FROM subscription_orders WHERE subscription_id = $1 AND scheduled_date >= CURRENT_DATE ORDER BY scheduled_date ASC`,
    [id]
  );

  res.json({ subscription: s, schedule, existingOrders: existingOrders.rows });
}));

module.exports = router;

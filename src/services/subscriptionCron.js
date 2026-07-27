/**
 * Subscription Cron — generates daily orders for active subscriptions.
 * Run via: node src/services/subscriptionCron.js
 * Or call scheduleDailySubscriptionOrders() from a cron/scheduler.
 */
const { pool } = require('../db/pool');
const { v4: uuidv4 } = require('uuid');

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

async function scheduleDailySubscriptionOrders() {
  const today = new Date();
  const dayName = DAY_NAMES[today.getDay()];
  const dateStr = today.toISOString().split('T')[0];

  console.log(`[SubscriptionCron] Running for ${dayName} ${dateStr}`);

  // Get active subscriptions that include today's day
  const subs = await pool.query(
    `SELECT * FROM subscriptions WHERE active = true AND $1 = ANY(days)`,
    [dayName]
  );

  let created = 0;
  for (const sub of subs.rows) {
    // Check if order already generated today
    const existing = await pool.query(
      `SELECT id FROM subscription_orders WHERE subscription_id = $1 AND scheduled_date = $2`,
      [sub.id, dateStr]
    );
    if (existing.rows.length > 0) continue;

    // Get menu items for this kitchen and tier
    const menuRes = await pool.query(
      `SELECT * FROM menu_items WHERE kitchen_id = $1 AND active = true AND tier = $2`,
      [sub.kitchen_id, sub.tier || 'basic']
    );

    if (menuRes.rows.length === 0) continue;

    // Build items_by_meal for each subscribed meal
    const itemsByMeal = {};
    for (const meal of (sub.meals || [])) {
      const mealItems = menuRes.rows.filter(item => item.slots && item.slots.includes(meal));
      if (mealItems.length > 0) {
        // Pick first available item for each meal (could be smarter with rotation)
        itemsByMeal[meal] = [{ name: mealItems[0].name, price: parseFloat(mealItems[0].price), qty: 1 }];
      }
    }

    if (Object.keys(itemsByMeal).length === 0) continue;

    const total = Object.values(itemsByMeal).flat().reduce((sum, i) => sum + i.price * i.qty, 0);
    const orderId = `sub_ord_${Date.now()}_${uuidv4().slice(0, 6)}`;

    await pool.query(
      `INSERT INTO orders (id, customer_name, customer_email, customer_mobile, customer_id, kitchen_id, items_by_meal, total, payment_method, status, placed_at, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, 'cod', 'placed', NOW(), $9)`,
      [orderId, sub.customer_name, sub.customer_email, sub.customer_mobile, sub.customer_id,
       sub.kitchen_id, JSON.stringify(itemsByMeal), total, `Auto-generated from subscription ${sub.id}`]
    );

    await pool.query(
      `INSERT INTO subscription_orders (subscription_id, order_id, scheduled_date, meal, generated)
       VALUES ($1, $2, $3, $4, true)`,
      [sub.id, orderId, dateStr, (sub.meals || [])[0]]
    );

    created++;
  }

  console.log(`[SubscriptionCron] Created ${created} orders from ${subs.rows.length} active subscriptions`);
  return created;
}

// Run if called directly
if (require.main === module) {
  scheduleDailySubscriptionOrders()
    .then((count) => { console.log(`Done. ${count} orders created.`); process.exit(0); })
    .catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { scheduleDailySubscriptionOrders };
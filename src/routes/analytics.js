/**
 * Analytics API — Kitchen performance statistics
 */
const { Router } = require('express');
const { pool } = require('../db/pool');
const { asyncHandler } = require('../middleware/errorHandler');

const router = Router();

// GET ANALYTICS for a kitchen
router.get('/:kitchenId', asyncHandler(async (req, res) => {
  const { kitchenId } = req.params;
  const days = parseInt(req.query.days || '30');

  // Total orders, revenue, avg order value
  const summary = await pool.query(`
    SELECT 
      COUNT(*)::int AS total_orders,
      COALESCE(SUM(total), 0)::numeric(10,2) AS total_revenue,
      COALESCE(AVG(total), 0)::numeric(10,2) AS avg_order_value,
      COUNT(*) FILTER (WHERE paid = true)::int AS paid_orders,
      COUNT(*) FILTER (WHERE status = 'delivered')::int AS delivered_orders
    FROM orders
    WHERE kitchen_id = $1 AND placed_at >= NOW() - ($2 || ' days')::interval
  `, [kitchenId, String(days)]);

  // Orders by day (last 14 days)
  const byDay = await pool.query(`
    SELECT DATE(placed_at) AS day, COUNT(*)::int AS orders, COALESCE(SUM(total), 0)::numeric(10,2) AS revenue
    FROM orders
    WHERE kitchen_id = $1 AND placed_at >= NOW() - INTERVAL '14 days'
    GROUP BY DATE(placed_at) ORDER BY day
  `, [kitchenId]);

  // Most popular items
  const popularItems = await pool.query(`
    SELECT item->>'name' AS name, SUM((item->>'qty')::int) AS total_qty, COUNT(*) AS order_count
    FROM orders, jsonb_array_elements(items_by_meal->'Breakfast') AS item
    WHERE kitchen_id = $1 AND placed_at >= NOW() - ($2 || ' days')::interval
    GROUP BY item->>'name'
    ORDER BY total_qty DESC LIMIT 10
  `, [kitchenId, String(days)]);

  // Status distribution
  const byStatus = await pool.query(`
    SELECT status, COUNT(*)::int AS count
    FROM orders WHERE kitchen_id = $1
    GROUP BY status ORDER BY count DESC
  `, [kitchenId]);

  // Average prep time (from placed to preparing)
  const prepTime = await pool.query(`
    SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (preparing_at - placed_at))/60), 0)::int AS avg_minutes
    FROM orders
    WHERE kitchen_id = $1 AND preparing_at IS NOT NULL AND placed_at IS NOT NULL
  `, [kitchenId]);

  // Repeat customers
  const repeatCustomers = await pool.query(`
    SELECT COUNT(*) FILTER (WHERE order_count > 1)::int AS repeat_count,
           COUNT(*)::int AS total_customers
    FROM (SELECT customer_name, COUNT(*)::int AS order_count
          FROM orders WHERE kitchen_id = $1
          GROUP BY customer_name) sub
  `, [kitchenId]);

  res.json({
    summary: summary.rows[0],
    byDay: byDay.rows,
    popularItems: popularItems.rows,
    byStatus: byStatus.rows,
    avgPrepMinutes: prepTime.rows[0]?.avg_minutes || 0,
    repeatCustomers: repeatCustomers.rows[0],
  });
}));

module.exports = router;

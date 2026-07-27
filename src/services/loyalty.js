/**
 * Loyalty Service — Earning + Redemption
 * 10 points per ₹100 spent. 100 points = ₹10 discount.
 */
const { pool } = require('../db/pool');

const POINTS_PER_100_RUPEES = 10;
const RUPEES_PER_100_POINTS = 10;

async function earnPoints(customerId, orderId, orderTotal) {
  const points = Math.floor(orderTotal / 10); // 1 point per ₹10
  if (points <= 0) return { earned: 0 };

  await pool.query(
    `UPDATE customers SET loyalty_points = COALESCE(loyalty_points, 0) + $1 WHERE id = $2`,
    [points, customerId]
  );
  await pool.query(
    `INSERT INTO loyalty_log (customer_id, points, reason, order_id) VALUES ($1, $2, 'Order payment', $3)`,
    [customerId, points, orderId]
  );

  return { earned: points };
}

async function redeemPoints(customerId, pointsToRedeem) {
  // Get current balance
  const res = await pool.query('SELECT loyalty_points FROM customers WHERE id = $1', [customerId]);
  if (res.rows.length === 0) return { success: false, error: 'Customer not found' };

  const balance = res.rows[0].loyalty_points || 0;
  if (pointsToRedeem > balance) {
    return { success: false, error: `Insufficient points. You have ${balance} points.` };
  }

  // Minimum 50 points to redeem
  if (pointsToRedeem < 50) {
    return { success: false, error: 'Minimum 50 points required for redemption' };
  }

  const discount = (pointsToRedeem / 100) * RUPEES_PER_100_POINTS;

  // Deduct points atomically
  const updated = await pool.query(
    `UPDATE customers SET loyalty_points = loyalty_points - $1 WHERE id = $2 AND loyalty_points >= $1 RETURNING loyalty_points`,
    [pointsToRedeem, customerId]
  );

  if (updated.rows.length === 0) {
    return { success: false, error: 'Redemption failed (race condition)' };
  }

  await pool.query(
    `INSERT INTO loyalty_log (customer_id, points, reason) VALUES ($1, $2, 'Points redeemed for discount')`,
    [customerId, -pointsToRedeem]
  );

  return { success: true, discount, remainingPoints: updated.rows[0].loyalty_points };
}

async function getBalance(customerId) {
  const res = await pool.query('SELECT loyalty_points FROM customers WHERE id = $1', [customerId]);
  return res.rows[0]?.loyalty_points || 0;
}

async function getHistory(customerId, limit = 20) {
  const res = await pool.query(
    'SELECT * FROM loyalty_log WHERE customer_id = $1 ORDER BY created_at DESC LIMIT $2',
    [customerId, limit]
  );
  return res.rows;
}

module.exports = { earnPoints, redeemPoints, getBalance, getHistory };
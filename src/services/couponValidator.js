/**
 * Coupon Validator — Validates a coupon code against the database
 * Separated from discountEngine to avoid circular dependencies
 */
const { pool } = require('../db/pool');

async function validateCoupon(code, orderTotal) {
  if (!code) return { valid: false, error: 'No code provided' };

  const result = await pool.query(
    `SELECT * FROM coupons WHERE code = $1 AND active = true
     AND (expires_at IS NULL OR expires_at > NOW())
     AND used_count < usage_limit`,
    [code.toUpperCase()]
  );

  if (result.rows.length === 0) {
    return { valid: false, error: 'Invalid, expired, or exhausted coupon code' };
  }

  const coupon = result.rows[0];
  const total = parseFloat(orderTotal || 0);

  if (total < parseFloat(coupon.min_order)) {
    return { valid: false, error: `Minimum order of ₹${coupon.min_order} required` };
  }

  let discount = coupon.discount_type === 'percentage'
    ? total * (parseFloat(coupon.discount_value) / 100)
    : parseFloat(coupon.discount_value);

  if (coupon.max_discount) discount = Math.min(discount, parseFloat(coupon.max_discount));
  discount = Math.min(discount, total);

  return {
    valid: true,
    code: coupon.code,
    discount: parseFloat(discount.toFixed(2)),
    description: coupon.description,
    discountType: coupon.discount_type,
    discountValue: parseFloat(coupon.discount_value),
  };
}

module.exports = { validateCoupon };
const { Router } = require("express");
const router = Router();
const { asyncHandler } = require("../middleware/errorHandler");
const { pool } = require("../db/pool");

router.post('/validate', asyncHandler(async (req, res) => {
  const { code, orderTotal } = req.body;
  if (!code) return res.status(400).json({ error: 'code is required' });

  // FIXED: Atomic increment to prevent race condition
  const result = await pool.query(
    `UPDATE coupons SET used_count = used_count + 1
     WHERE code = $1 AND active = true
     AND (expires_at IS NULL OR expires_at > NOW())
     AND used_count < usage_limit
     RETURNING *`,
    [code.toUpperCase()]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Invalid, expired, or exhausted coupon code' });
  }

  const coupon = result.rows[0];
  const total = parseFloat(orderTotal || 0);

  if (total < parseFloat(coupon.min_order)) {
    // Roll back the increment since we can't use the coupon
    await pool.query('UPDATE coupons SET used_count = used_count - 1 WHERE id = $1', [coupon.id]);
    return res.status(400).json({ error: `Minimum order of ₹${coupon.min_order} required for this coupon` });
  }

  let discount = coupon.discount_type === 'percentage'
    ? total * (parseFloat(coupon.discount_value) / 100)
    : parseFloat(coupon.discount_value);

  if (coupon.max_discount) discount = Math.min(discount, parseFloat(coupon.max_discount));
  discount = Math.min(discount, total);

  res.json({
    success: true,
    code: coupon.code,
    discount: parseFloat(discount.toFixed(2)),
    description: coupon.description,
  });
}));
module.exports = router;
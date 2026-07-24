/**
 * Coupons API — Admin CRUD + customer-facing validation
 * The `coupons` table already existed in the schema (src/db/setup.js) but had
 * no API in front of it — the admin dashboard was faking this tab entirely.
 */
const { Router } = require('express');
const { pool } = require('../db/pool');
const { asyncHandler } = require('../middleware/errorHandler');
const { authenticate, authorize } = require('../middleware/auth');

const router = Router();

/**
 * GET /api/coupons
 * Admin: list all coupons
 */
router.get('/', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const result = await pool.query('SELECT * FROM coupons ORDER BY created_at DESC');
  res.json(result.rows);
}));

/**
 * POST /api/coupons
 * Admin: create a coupon
 */
router.post('/', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { code, description, discountType, discountValue, minOrder, maxDiscount, usageLimit, expiresAt } = req.body;

  if (!code || !discountType || discountValue === undefined) {
    return res.status(400).json({ error: 'code, discountType, and discountValue are required' });
  }
  if (!['percentage', 'fixed'].includes(discountType)) {
    return res.status(400).json({ error: 'discountType must be "percentage" or "fixed"' });
  }

  const existing = await pool.query('SELECT id FROM coupons WHERE code = $1', [code.toUpperCase()]);
  if (existing.rows.length > 0) {
    return res.status(409).json({ error: 'A coupon with this code already exists' });
  }

  const result = await pool.query(
    `INSERT INTO coupons (code, description, discount_type, discount_value, min_order, max_discount, usage_limit, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [code.toUpperCase(), description || null, discountType, discountValue, minOrder || 0, maxDiscount || null, usageLimit || 100, expiresAt || null]
  );

  res.status(201).json({ success: true, coupon: result.rows[0] });
}));

/**
 * PATCH /api/coupons/:id/toggle
 * Admin: activate/deactivate a coupon
 */
router.patch('/:id/toggle', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await pool.query('SELECT active FROM coupons WHERE id = $1', [id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Coupon not found' });

  const newActive = !result.rows[0].active;
  await pool.query('UPDATE coupons SET active = $1 WHERE id = $2', [newActive, id]);
  res.json({ success: true, id, active: newActive });
}));

/**
 * DELETE /api/coupons/:id
 * Admin: remove a coupon
 */
router.delete('/:id', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  await pool.query('DELETE FROM coupons WHERE id = $1', [id]);
  res.json({ success: true });
}));

/**
 * POST /api/coupons/validate
 * Customer-facing: check a code against an order total, return the discount
 */
router.post('/validate', asyncHandler(async (req, res) => {
  const { code, orderTotal } = req.body;
  if (!code) return res.status(400).json({ error: 'code is required' });

  const result = await pool.query(
    `SELECT * FROM coupons WHERE code = $1 AND active = true
     AND (expires_at IS NULL OR expires_at > NOW())
     AND used_count < usage_limit`,
    [code.toUpperCase()]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Invalid, expired, or exhausted coupon code' });
  }

  const coupon = result.rows[0];
  const total = parseFloat(orderTotal || 0);

  if (total < parseFloat(coupon.min_order)) {
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

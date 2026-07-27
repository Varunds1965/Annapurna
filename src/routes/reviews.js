/**
 * Reviews API — FIXED: removed misplaced delivery endpoints, added auth
 */
const { Router } = require('express');
const { pool } = require('../db/pool');
const { asyncHandler } = require('../middleware/errorHandler');
const { authenticate, authorize, optionalAuth } = require('../middleware/auth');

const router = Router();

// SUBMIT A REVIEW — requires customer auth
router.post('/', authenticate, authorize('customer'), asyncHandler(async (req, res) => {
  const { orderId, itemName, rating, comment, photoUrl, kitchenId } = req.body;

  if (!orderId || !itemName || !rating) {
    return res.status(400).json({ error: 'orderId, itemName, and rating are required' });
  }
  if (rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Rating must be between 1 and 5' });
  }

  // Verify customer placed this order
  const orderCheck = await pool.query('SELECT customer_id FROM orders WHERE id = $1', [orderId]);
  if (orderCheck.rows.length === 0) return res.status(404).json({ error: 'Order not found' });
  if (orderCheck.rows[0].customer_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only review your own orders' });
  }

  const result = await pool.query(
    `INSERT INTO item_reviews (order_id, customer_id, customer_name, item_name, rating, comment, photo_url, kitchen_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [orderId, req.user.id, req.user.name || 'Customer', itemName, rating, comment || null, photoUrl || null, kitchenId || null]
  );

  res.status(201).json({ success: true, review: result.rows[0] });
}));

// GET REVIEWS FOR AN ITEM (aggregated)
router.get('/item/:itemName', asyncHandler(async (req, res) => {
  const { itemName } = req.params;
  const { kitchenId } = req.query;

  let query = `SELECT * FROM item_reviews WHERE item_name = $1`;
  const params = [itemName];
  if (kitchenId) {
    query += ` AND kitchen_id = $2`;
    params.push(kitchenId);
  }
  query += ` ORDER BY created_at DESC`;

  const reviews = await pool.query(query, params);
  const avgRating = await pool.query(
    `SELECT COALESCE(AVG(rating), 0)::numeric(3,1) AS avg_rating, COUNT(*)::int AS total FROM item_reviews WHERE item_name = $1${kitchenId ? ' AND kitchen_id = $2' : ''}`,
    params
  );

  res.json({ reviews: reviews.rows, ...avgRating.rows[0] });
}));

// GET ALL REVIEWS FOR A KITCHEN
router.get('/kitchen/:kitchenId', asyncHandler(async (req, res) => {
  const { kitchenId } = req.params;
  const result = await pool.query(
    `SELECT ir.*, o.customer_name 
     FROM item_reviews ir 
     LEFT JOIN orders o ON ir.order_id = o.id 
     WHERE ir.kitchen_id = $1 
     ORDER BY ir.created_at DESC`,
    [kitchenId]
  );
  res.json(result.rows);
}));

module.exports = router;

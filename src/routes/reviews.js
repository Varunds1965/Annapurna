/**
 * Reviews API — Item ratings, photo reviews, and feedback
 */
const { Router } = require('express');
const { pool } = require('../db/pool');
const { asyncHandler } = require('../middleware/errorHandler');

const router = Router();

// SUBMIT A REVIEW
router.post('/', asyncHandler(async (req, res) => {
  const { orderId, customerName, itemName, rating, comment, photoUrl, kitchenId } = req.body;

  if (!orderId || !itemName || !rating) {
    return res.status(400).json({ error: 'orderId, itemName, and rating are required' });
  }
  if (rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Rating must be between 1 and 5' });
  }

  const result = await pool.query(
    `INSERT INTO item_reviews (order_id, customer_name, item_name, rating, comment, photo_url, kitchen_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [orderId, customerName || 'Anonymous', itemName, rating, comment || null, photoUrl || null, kitchenId || null]
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

// GET DELIVERY LOCATION (for GPS tracking)
router.get('/delivery/:orderId', asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const result = await pool.query(
    `SELECT id, customer_name, delivery_lat, delivery_lng, delivery_eta 
     FROM orders WHERE id = $1`,
    [orderId]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Order not found' });
  res.json(result.rows[0]);
}));

// UPDATE DELIVERY LOCATION (called by delivery person)
router.patch('/delivery/:orderId/location', asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const { lat, lng, eta } = req.body;
  await pool.query(
    `UPDATE orders SET delivery_lat = $1, delivery_lng = $2, delivery_eta = $3 WHERE id = $4`,
    [lat || null, lng || null, eta || null, orderId]
  );
  res.json({ success: true });
}));

module.exports = router;

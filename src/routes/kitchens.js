/**
 * Kitchens API — list, get, create kitchens and their menu items
 */
const { Router } = require('express');
const { pool } = require('../db/pool');
const { asyncHandler } = require('../middleware/errorHandler');

const router = Router();

// LIST KITCHENS
router.get('/', asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT id, name, type, active, rating_text, lat, lng, created_at FROM kitchens ORDER BY active DESC, name ASC`
  );

  const kitchens = result.rows.map(k => ({
    id: k.id,
    name: k.name,
    type: k.type,
    active: k.active,
    ratingText: k.rating_text,
    lat: k.lat,
    lng: k.lng,
  }));

  res.json(kitchens);
}));

// GET KITCHEN DETAILS
router.get('/:kitchenId', asyncHandler(async (req, res) => {
  const { kitchenId } = req.params;
  const result = await pool.query(
    `SELECT id, name, type, active, rating_text, lat, lng, created_at FROM kitchens WHERE id = $1`,
    [kitchenId]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Kitchen not found' });
  }

  const k = result.rows[0];
  res.json({
    id: k.id,
    name: k.name,
    type: k.type,
    active: k.active,
    ratingText: k.rating_text,
    lat: k.lat,
    lng: k.lng,
  });
}));

// GET MENU ITEMS FOR A KITCHEN
router.get('/:kitchenId/menu', asyncHandler(async (req, res) => {
  const { kitchenId } = req.params;
  const { tier, slot } = req.query;

  let query = `SELECT * FROM menu_items WHERE kitchen_id = $1 AND active = true`;
  const params = [kitchenId];

  if (tier) {
    query += ` AND tier = $${params.length + 1}`;
    params.push(tier);
  }
  if (slot) {
    query += ` AND $${params.length + 1} = ANY(slots)`;
    params.push(slot);
  }

  query += ` ORDER BY tier ASC, price ASC`;

  const result = await pool.query(query, params);

  const items = result.rows.map(item => ({
    id: item.id,
    name: item.name,
    ingredients: item.ingredients,
    slots: item.slots,
    price: parseFloat(item.price),
    cal: parseFloat(item.cal),
    protein: parseFloat(item.protein),
    fat: parseFloat(item.fat),
    calcium: parseFloat(item.calcium),
    vd: parseFloat(item.vd),
    b12: parseFloat(item.b12),
    iron: parseFloat(item.iron),
    tags: item.tags,
    season: item.season,
    prepExtra: item.prep_extra_min,
    tier: item.tier,
  }));

  res.json(items);
}));

// ADD KITCHEN (admin)
router.post('/', asyncHandler(async (req, res) => {
  const { id, name, type, active, ratingText, lat, lng } = req.body;

  if (!id || !name || !type) {
    return res.status(400).json({ error: 'id, name, and type are required' });
  }

  await pool.query(
    `INSERT INTO kitchens (id, name, type, active, rating_text, lat, lng)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET name = $2, type = $3, active = $4, rating_text = $5, lat = $6, lng = $7`,
    [id, name, type, active || false, ratingText || 'New partner', lat || null, lng || null]
  );

  res.status(201).json({ success: true, kitchenId: id });
}));

module.exports = router;

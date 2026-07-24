/**
 * Kitchens API — Registration, Menu Management, Profile
 * Restaurant self-service portal for adding/managing their own foods
 */
const { Router } = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db/pool');
const { asyncHandler } = require('../middleware/errorHandler');
const { authenticate, authorize, generateToken, optionalAuth } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { classifyFood } = require('../services/foodClassifier');
const { generateFoodImage } = require('../services/imageGeneration');
const { computeTargets, scoreItem } = require('../services/nutritionEngine');

const router = Router();

// Multer setup for food photo uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = process.env.UPLOAD_DIR || 'uploads';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `food_${Date.now()}_${uuidv4().slice(0, 8)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG, PNG, WebP, and GIF images are allowed'), false);
    }
  },
});

/**
 * POST /api/kitchens/register
 * Register a new kitchen/restaurant
 */
router.post('/register', asyncHandler(async (req, res) => {
  const { name, email, password, phone, type, lat, lng, address, openingTime, closingTime } = req.body;

  if (!name || !email || !password || !type) {
    return res.status(400).json({ error: 'Name, email, password, and type (veg/nonveg) are required' });
  }

  const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
  if (!strongPasswordRegex.test(password)) {
    return res.status(400).json({ error: 'Password must be at least 8 characters and include uppercase, lowercase, a number, and a special character' });
  }

  if (!['veg', 'nonveg'].includes(type)) {
    return res.status(400).json({ error: 'Type must be "veg" or "nonveg"' });
  }

  // Check if email already exists
  const existing = await pool.query('SELECT id FROM kitchens WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    return res.status(409).json({ error: 'A kitchen with this email already exists' });
  }

  // Generate kitchen ID from name
  const kitchenId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '_' + uuidv4().slice(0, 6);

  const hashedPassword = await bcrypt.hash(password, 10);

  await pool.query(
    `INSERT INTO kitchens (id, name, email, password, phone, type, active, lat, lng, address, opening_time, closing_time, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())`,
    [kitchenId, name, email, hashedPassword, phone || null, type, false, lat || null, lng || null, address || null, openingTime || '07:00', closingTime || '22:00']
  );

  // Generate JWT
  const token = generateToken({
    id: kitchenId,
    name,
    email,
    role: 'kitchen',
    kitchenId,
  });

  res.status(201).json({
    success: true,
    message: 'Kitchen registered successfully. Awaiting admin approval.',
    token,
    kitchen: { id: kitchenId, name, email, type, active: false },
  });
}));

/**
 * GET /api/kitchens
 * List all active kitchens (for customer app)
 */
router.get('/', asyncHandler(async (req, res) => {
  const { type, lat, lng } = req.query;

  let query = 'SELECT id, name, type, active, rating_text, lat, lng, address, photo_url, opening_time, closing_time FROM kitchens WHERE active = true';
  const params = [];

  if (type && ['veg', 'nonveg'].includes(type)) {
    query += ' AND type = $' + (params.length + 1);
    params.push(type);
  }

  query += ' ORDER BY name ASC';

  const result = await pool.query(query, params);
  res.json(result.rows);
}));

/**
 * GET /api/kitchens/admin/all
 * Admin: list every kitchen regardless of active/approval status
 * Registered before /:id so "admin" isn't swallowed as a kitchen ID
 */
router.get('/admin/all', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const result = await pool.query(
    'SELECT id, name, email, type, active, rating_text, lat, lng, address, photo_url, opening_time, closing_time, created_at FROM kitchens ORDER BY created_at DESC'
  );
  res.json(result.rows);
}));

/**
 * GET /api/kitchens/:id
 * Get kitchen details with menu
 */
router.get('/:id', optionalAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const kitchenResult = await pool.query(
    'SELECT id, name, type, active, rating_text, lat, lng, address, photo_url, opening_time, closing_time FROM kitchens WHERE id = $1',
    [id]
  );

  if (kitchenResult.rows.length === 0) {
    return res.status(404).json({ error: 'Kitchen not found' });
  }

  const menuResult = await pool.query(
    'SELECT * FROM menu_items WHERE kitchen_id = $1 AND active = true ORDER BY tier, name',
    [id]
  );

  let menu = menuResult.rows;
  if (req.user && req.user.role === 'customer') {
    const customerResult = await pool.query(
      'SELECT age, weight, height, gender, goal, disliked_foods, deficiencies FROM customers WHERE id = $1',
      [req.user.id]
    );
    const profile = customerResult.rows[0];
    if (profile && profile.age) {
      const targets = computeTargets(profile);
      const dislikedFoods = (profile.disliked_foods || '').split(',').map(s => s.trim()).filter(Boolean);
      menu = menu
        .map(item => {
          const { score, disliked } = scoreItem(item, targets, dislikedFoods);
          return { ...item, matchScore: score, disliked };
        })
        .sort((a, b) => b.matchScore - a.matchScore)
        .map((item, i) => ({ ...item, recommended: i < 3 && !item.disliked }));
    }
  }

  res.json({
    ...kitchenResult.rows[0],
    menu,
  });
}));

/**
 * GET /api/kitchens/:id/menu
 * Get kitchen's menu items
 */
router.get('/:id/menu', optionalAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tier, slot } = req.query;

  let query = 'SELECT * FROM menu_items WHERE kitchen_id = $1 AND active = true';
  const params = [id];

  if (tier) {
    query += ' AND tier = $' + (params.length + 1);
    params.push(tier);
  }

  const result = await pool.query(query, params);

  // Filter by meal slot if specified
  let items = result.rows;
  if (slot) {
    items = items.filter(item => item.slots && item.slots.includes(slot));
  }

  // Personalize + sort by nutrition fit, but only for a logged-in customer
  // who has completed their nutrition profile (age is the completeness signal).
  if (req.user && req.user.role === 'customer') {
    const customerResult = await pool.query(
      'SELECT age, weight, height, gender, goal, disliked_foods, deficiencies FROM customers WHERE id = $1',
      [req.user.id]
    );
    const profile = customerResult.rows[0];
    if (profile && profile.age) {
      const targets = computeTargets(profile);
      const dislikedFoods = (profile.disliked_foods || '').split(',').map(s => s.trim()).filter(Boolean);
      items = items
        .map(item => {
          const { score, disliked } = scoreItem(item, targets, dislikedFoods);
          return { ...item, matchScore: score, disliked };
        })
        .sort((a, b) => b.matchScore - a.matchScore)
        .map((item, i) => ({ ...item, recommended: i < 3 && !item.disliked }));
    }
  }

  res.json(items);
}));

/**
 * POST /api/kitchens/:id/menu
 * Add a menu item (kitchen owner only)
 */
router.post('/:id/menu', authenticate, authorize('kitchen', 'admin'), asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Kitchen can only edit their own menu
  if (req.user.role === 'kitchen' && req.user.kitchenId !== id) {
    return res.status(403).json({ error: 'You can only add items to your own kitchen' });
  }

  const { name, description, ingredients, slots, price, cal, protein, fat, calcium, vd, b12, iron, tags, season, prepExtraMin, tier, availableFrom, availableTo } = req.body;

  if (!name || !price) {
    return res.status(400).json({ error: 'Name and price are required' });
  }

  // Auto-categorize and detect allergens from the name/description/ingredients
  const { category, allergens } = classifyFood(name, description, ingredients);

  const result = await pool.query(
    `INSERT INTO menu_items (kitchen_id, name, description, ingredients, slots, price, cal, protein, fat, calcium, vd, b12, iron, tags, season, prep_extra_min, tier, active, available_from, available_to, category, allergens, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, NOW(), NOW())
     RETURNING *`,
    [id, name, description || null, ingredients || [], slots || [], price, cal || 0, protein || 0, fat || 0, calcium || 0, vd || 0, b12 || 0, iron || 0, tags || [], season || null, prepExtraMin || 0, tier || 'basic', true, availableFrom || '07:00', availableTo || '22:00', category, allergens]
  );

  res.status(201).json({ success: true, item: result.rows[0] });
}));

/**
 * PUT /api/kitchens/:id/menu/:itemId
 * Update a menu item
 */
router.put('/:id/menu/:itemId', authenticate, authorize('kitchen', 'admin'), asyncHandler(async (req, res) => {
  const { id, itemId } = req.params;

  if (req.user.role === 'kitchen' && req.user.kitchenId !== id) {
    return res.status(403).json({ error: 'You can only edit your own kitchen items' });
  }

  const { name, description, ingredients, slots, price, cal, protein, fat, calcium, vd, b12, iron, tags, season, prepExtraMin, tier, active, availableFrom, availableTo } = req.body;

  // Merge with the existing row so classification reflects the final state,
  // even if this request only touched a couple of fields (e.g. just toggling tier).
  const existing = await pool.query('SELECT name, description, ingredients FROM menu_items WHERE id = $1 AND kitchen_id = $2', [itemId, id]);
  if (existing.rows.length === 0) {
    return res.status(404).json({ error: 'Menu item not found' });
  }
  const mergedName = name !== undefined ? name : existing.rows[0].name;
  const mergedDescription = description !== undefined ? description : existing.rows[0].description;
  const mergedIngredients = ingredients !== undefined ? ingredients : existing.rows[0].ingredients;
  const { category, allergens } = classifyFood(mergedName, mergedDescription, mergedIngredients);

  const result = await pool.query(
    `UPDATE menu_items SET
      name = COALESCE($1, name),
      description = COALESCE($2, description),
      ingredients = COALESCE($3, ingredients),
      slots = COALESCE($4, slots),
      price = COALESCE($5, price),
      cal = COALESCE($6, cal),
      protein = COALESCE($7, protein),
      fat = COALESCE($8, fat),
      calcium = COALESCE($9, calcium),
      vd = COALESCE($10, vd),
      b12 = COALESCE($11, b12),
      iron = COALESCE($12, iron),
      tags = COALESCE($13, tags),
      season = COALESCE($14, season),
      prep_extra_min = COALESCE($15, prep_extra_min),
      tier = COALESCE($16, tier),
      active = COALESCE($17, active),
      available_from = COALESCE($18, available_from),
      available_to = COALESCE($19, available_to),
      category = $22,
      allergens = $23,
      updated_at = NOW()
     WHERE id = $20 AND kitchen_id = $21
     RETURNING *`,
    [name, description, ingredients, slots, price, cal, protein, fat, calcium, vd, b12, iron, tags, season, prepExtraMin, tier, active, availableFrom, availableTo, itemId, id, category, allergens]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Menu item not found' });
  }

  res.json({ success: true, item: result.rows[0] });
}));

/**
 * DELETE /api/kitchens/:id/menu/:itemId
 * Delete a menu item
 */
router.delete('/:id/menu/:itemId', authenticate, authorize('kitchen', 'admin'), asyncHandler(async (req, res) => {
  const { id, itemId } = req.params;

  if (req.user.role === 'kitchen' && req.user.kitchenId !== id) {
    return res.status(403).json({ error: 'You can only delete your own kitchen items' });
  }

  const result = await pool.query(
    'DELETE FROM menu_items WHERE id = $1 AND kitchen_id = $2 RETURNING id',
    [itemId, id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Menu item not found' });
  }

  res.json({ success: true, message: 'Menu item deleted' });
}));

/**
 * POST /api/kitchens/:id/menu/:itemId/generate-photo
 * Generate a realistic AI photo for a menu item from its name/description/ingredients/category.
 * Requires OPENAI_API_KEY in .env — see src/services/imageGeneration.js.
 */
router.post('/:id/menu/:itemId/generate-photo', authenticate, authorize('kitchen', 'admin'), asyncHandler(async (req, res) => {
  const { id, itemId } = req.params;

  if (req.user.role === 'kitchen' && req.user.kitchenId !== id) {
    return res.status(403).json({ error: 'You can only edit your own kitchen items' });
  }

  const itemResult = await pool.query(
    'SELECT name, description, ingredients, category FROM menu_items WHERE id = $1 AND kitchen_id = $2',
    [itemId, id]
  );
  if (itemResult.rows.length === 0) {
    return res.status(404).json({ error: 'Menu item not found' });
  }

  const uploadDir = process.env.UPLOAD_DIR || 'uploads';
  const genResult = await generateFoodImage(itemResult.rows[0], uploadDir);

  if (!genResult.success) {
    return res.status(502).json({ error: genResult.error });
  }

  const photoUrl = `/uploads/${genResult.filename}`;
  await pool.query('UPDATE menu_items SET photo_url = $1, updated_at = NOW() WHERE id = $2', [photoUrl, itemId]);

  res.json({ success: true, photoUrl });
}));

/**
 * PATCH /api/kitchens/:id/menu/:itemId/toggle
 * Toggle menu item active status
 */
router.patch('/:id/menu/:itemId/toggle', authenticate, authorize('kitchen', 'admin'), asyncHandler(async (req, res) => {
  const { id, itemId } = req.params;

  if (req.user.role === 'kitchen' && req.user.kitchenId !== id) {
    return res.status(403).json({ error: 'You can only toggle your own kitchen items' });
  }

  const result = await pool.query(
    `UPDATE menu_items SET active = NOT active, updated_at = NOW() WHERE id = $1 AND kitchen_id = $2 RETURNING id, name, active`,
    [itemId, id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Menu item not found' });
  }

  res.json({ success: true, item: result.rows[0] });
}));

/**
 * POST /api/kitchens/:id/photo
 * Upload kitchen photo
 */
router.post('/:id/photo', authenticate, authorize('kitchen', 'admin'), upload.single('photo'), asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (req.user.role === 'kitchen' && req.user.kitchenId !== id) {
    return res.status(403).json({ error: 'You can only update your own kitchen photo' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No photo uploaded' });
  }

  const photoUrl = `/uploads/${req.file.filename}`;

  await pool.query(
    'UPDATE kitchens SET photo_url = $1, updated_at = NOW() WHERE id = $2',
    [photoUrl, id]
  );

  res.json({ success: true, photoUrl });
}));

/**
 * POST /api/kitchens/:id/menu/:itemId/photo
 * Upload food photo for a menu item
 */
router.post('/:id/menu/:itemId/photo', authenticate, authorize('kitchen', 'admin'), upload.single('photo'), asyncHandler(async (req, res) => {
  const { id, itemId } = req.params;

  if (req.user.role === 'kitchen' && req.user.kitchenId !== id) {
    return res.status(403).json({ error: 'You can only update your own kitchen items' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No photo uploaded' });
  }

  const photoUrl = `/uploads/${req.file.filename}`;

  await pool.query(
    'UPDATE menu_items SET photo_url = $1, updated_at = NOW() WHERE id = $2 AND kitchen_id = $3',
    [photoUrl, itemId, id]
  );

  res.json({ success: true, photoUrl });
}));

/**
 * PATCH /api/kitchens/:id/toggle-active
 * Admin: approve a pending kitchen or deactivate an existing one
 */
router.patch('/:id/toggle-active', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { id } = req.params;

  const result = await pool.query('SELECT active FROM kitchens WHERE id = $1', [id]);
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Kitchen not found' });
  }

  const newActive = !result.rows[0].active;
  await pool.query('UPDATE kitchens SET active = $1, updated_at = NOW() WHERE id = $2', [newActive, id]);

  res.json({ success: true, id, active: newActive });
}));

/**
 * PUT /api/kitchens/:id/profile
 * Update kitchen profile
 */
router.put('/:id/profile', authenticate, authorize('kitchen', 'admin'), asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (req.user.role === 'kitchen' && req.user.kitchenId !== id) {
    return res.status(403).json({ error: 'You can only update your own profile' });
  }

  const { name, phone, address, openingTime, closingTime, lat, lng } = req.body;

  await pool.query(
    `UPDATE kitchens SET
      name = COALESCE($1, name),
      phone = COALESCE($2, phone),
      address = COALESCE($3, address),
      opening_time = COALESCE($4, opening_time),
      closing_time = COALESCE($5, closing_time),
      lat = COALESCE($6, lat),
      lng = COALESCE($7, lng),
      updated_at = NOW()
     WHERE id = $8`,
    [name, phone, address, openingTime, closingTime, lat, lng, id]
  );

  res.json({ success: true, message: 'Profile updated' });
}));

/**
 * GET /api/kitchens/:id/earnings
 * Get kitchen earnings (kitchen owner only)
 */
router.get('/:id/earnings', authenticate, authorize('kitchen', 'admin'), asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (req.user.role === 'kitchen' && req.user.kitchenId !== id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  // Today's earnings
  const today = await pool.query(
    `SELECT COALESCE(SUM(total), 0) as total FROM orders WHERE kitchen_id = $1 AND status = 'delivered' AND DATE(placed_at) = CURRENT_DATE`,
    [id]
  );

  // This week
  const week = await pool.query(
    `SELECT COALESCE(SUM(total), 0) as total FROM orders WHERE kitchen_id = $1 AND status = 'delivered' AND placed_at >= DATE_TRUNC('week', CURRENT_DATE)`,
    [id]
  );

  // This month
  const month = await pool.query(
    `SELECT COALESCE(SUM(total), 0) as total FROM orders WHERE kitchen_id = $1 AND status = 'delivered' AND placed_at >= DATE_TRUNC('month', CURRENT_DATE)`,
    [id]
  );

  // Total orders count
  const counts = await pool.query(
    `SELECT status, COUNT(*) as count FROM orders WHERE kitchen_id = $1 GROUP BY status`,
    [id]
  );

  // Popular items
  const popular = await pool.query(
    `SELECT items_by_meal FROM orders WHERE kitchen_id = $1 AND status = 'delivered'`,
    [id]
  );

  // Parse popular items
  const itemCounts = {};
  popular.rows.forEach(row => {
    const meals = row.items_by_meal;
    if (meals) {
      Object.values(meals).forEach(items => {
        if (Array.isArray(items)) {
          items.forEach(item => {
            itemCounts[item.name] = (itemCounts[item.name] || 0) + (item.qty || 1);
          });
        }
      });
    }
  });

  const popularItems = Object.entries(itemCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  res.json({
    today: parseFloat(today.rows[0].total),
    week: parseFloat(week.rows[0].total),
    month: parseFloat(month.rows[0].total),
    orderCounts: counts.rows,
    popularItems,
  });
}));

module.exports = router;
/**
 * Delivery Partner API — Registration, GPS Tracking, Assignment
 */
const { Router } = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db/pool');
const { asyncHandler } = require('../middleware/errorHandler');
const { generateToken, authenticate, authorize } = require('../middleware/auth');
const { broadcastDeliveryLocation } = require('../services/websocket');

const router = Router();

// ─── Delivery Partner Registration ─────────────────────
router.post('/register', asyncHandler(async (req, res) => {
  const { name, phone, password, vehicleType, vehicleNumber } = req.body;

  if (!name || !phone || !password) {
    return res.status(400).json({ error: 'Name, phone, and password are required' });
  }

  if (!/^[6-9]\d{9}$/.test(phone)) {
    return res.status(400).json({ error: 'Valid 10-digit mobile number required' });
  }

  const existing = await pool.query('SELECT id FROM delivery_partners WHERE phone = $1', [phone]);
  if (existing.rows.length > 0) {
    return res.status(409).json({ error: 'A partner with this phone number already exists' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const result = await pool.query(
    `INSERT INTO delivery_partners (name, phone, password, vehicle_type, vehicle_number, status, is_active)
     VALUES ($1, $2, $3, $4, $5, 'available', true)
     RETURNING id, name, phone, vehicle_type, vehicle_number, status, is_active, created_at`,
    [name, phone, hashedPassword, vehicleType || 'bike', vehicleNumber || null]
  );

  const partner = result.rows[0];
  const token = generateToken({ id: partner.id, phone: partner.phone, name: partner.name, role: 'delivery' });

  res.status(201).json({ success: true, token, partner });
}));

// ─── Delivery Partner Login ────────────────────────────
router.post('/login', asyncHandler(async (req, res) => {
  const { phone, password } = req.body;

  if (!phone || !password) {
    return res.status(400).json({ error: 'Phone and password are required' });
  }

  const result = await pool.query('SELECT * FROM delivery_partners WHERE phone = $1', [phone]);
  if (result.rows.length === 0) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const partner = result.rows[0];
  const valid = await bcrypt.compare(password, partner.password);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = generateToken({ id: partner.id, phone: partner.phone, name: partner.name, role: 'delivery' });

  res.json({ success: true, token, partner: { id: partner.id, name: partner.name, phone: partner.phone, vehicle_type: partner.vehicle_type, status: partner.status } });
}));

// ─── List Available Partners ───────────────────────────
router.get('/available', authenticate, authorize('kitchen', 'admin'), asyncHandler(async (req, res) => {
  const { lat, lng, limit } = req.query;

  let query = `SELECT id, name, phone, vehicle_type, vehicle_number, current_lat, current_lng, status FROM delivery_partners WHERE status = 'available' AND is_active = true`;
  const params = [];

  // If lat/lng provided, sort by distance (approximate using haversine)
  if (lat && lng) {
    query += ` AND current_lat IS NOT NULL AND current_lng IS NOT NULL ORDER BY (6371 * acos(cos(radians($1)) * cos(radians(current_lat)) * cos(radians(current_lng) - radians($2)) + sin(radians($1)) * sin(radians(current_lat)))) ASC`;
    params.push(parseFloat(lat), parseFloat(lng));
  } else {
    query += ` ORDER BY name ASC`;
  }

  query += ` LIMIT ${parseInt(limit) || 20}`;

  const result = await pool.query(query, params);
  res.json(result.rows);
}));

// ─── Update GPS Location (partner self-updates) ────────
router.patch('/location', authenticate, authorize('delivery'), asyncHandler(async (req, res) => {
  const { lat, lng, status } = req.body;
  const partnerId = req.user.id;

  if (lat !== undefined && lng !== undefined) {
    await pool.query(
      `UPDATE delivery_partners SET current_lat = $1, current_lng = $2, status = COALESCE($3, status) WHERE id = $4`,
      [parseFloat(lat), parseFloat(lng), status || null, partnerId]
    );
  } else if (status) {
    await pool.query(
      `UPDATE delivery_partners SET status = $1 WHERE id = $2`,
      [status, partnerId]
    );
  } else {
    return res.status(400).json({ error: 'Provide lat/lng or status to update' });
  }

  res.json({ success: true });
}));

// ─── Get Delivery Partner Profile ──────────────────────
router.get('/profile', authenticate, authorize('delivery'), asyncHandler(async (req, res) => {
  const result = await pool.query('SELECT id, name, phone, vehicle_type, vehicle_number, current_lat, current_lng, status, is_active, earnings, created_at FROM delivery_partners WHERE id = $1', [req.user.id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Partner not found' });
  res.json(result.rows[0]);
}));

// ─── Assign Delivery Partner to Order ──────────────────
router.post('/assign', authenticate, authorize('kitchen', 'admin'), asyncHandler(async (req, res) => {
  const { orderId, partnerId } = req.body;

  if (!orderId || !partnerId) {
    return res.status(400).json({ error: 'orderId and partnerId are required' });
  }

  // Verify order exists
  const orderRes = await pool.query('SELECT id, status FROM orders WHERE id = $1', [orderId]);
  if (orderRes.rows.length === 0) return res.status(404).json({ error: 'Order not found' });

  // Verify partner exists and is available
  const partnerRes = await pool.query('SELECT id, status FROM delivery_partners WHERE id = $1 AND is_active = true', [partnerId]);
  if (partnerRes.rows.length === 0) return res.status(404).json({ error: 'Delivery partner not found' });

  // Check if already assigned
  const existing = await pool.query(`SELECT id FROM delivery_assignments WHERE order_id = $1 AND status != 'delivered'`, [orderId]);
  if (existing.rows.length > 0) {
    return res.status(409).json({ error: 'Order already has a delivery partner assigned' });
  }

  // Create assignment
  const assignRes = await pool.query(
    `INSERT INTO delivery_assignments (order_id, partner_id, assigned_at, status)
     VALUES ($1, $2, NOW(), 'assigned')
     RETURNING *`,
    [orderId, partnerId]
  );

  // Mark partner as busy
  await pool.query(`UPDATE delivery_partners SET status = 'busy' WHERE id = $1`, [partnerId]);

  res.status(201).json({ success: true, assignment: assignRes.rows[0] });
}));

// ─── Get Delivery Tracking Info (Customer-facing) ──────
router.get('/tracking/:orderId', asyncHandler(async (req, res) => {
  const { orderId } = req.params;

  const result = await pool.query(
    `SELECT da.id as assignment_id, da.status as delivery_status, da.picked_up_at, da.delivered_at,
            dp.id as partner_id, dp.name as partner_name, dp.phone as partner_phone,
            dp.vehicle_type, dp.vehicle_number, dp.current_lat, dp.current_lng,
            o.status as order_status, o.delivery_lat, o.delivery_lng, o.delivery_eta
     FROM delivery_assignments da
     JOIN delivery_partners dp ON da.partner_id = dp.id
     JOIN orders o ON da.order_id = o.id
     WHERE da.order_id = $1 AND da.status != 'delivered'
     ORDER BY da.assigned_at DESC LIMIT 1`,
    [orderId]
  );

  if (result.rows.length === 0) {
    // Return basic order info even without a partner assigned
    const orderRes = await pool.query('SELECT id, status, delivery_lat, delivery_lng, delivery_eta FROM orders WHERE id = $1', [orderId]);
    if (orderRes.rows.length === 0) return res.status(404).json({ error: 'Order not found' });
    return res.json({ order: orderRes.rows[0], partner: null, delivery_status: null });
  }

  const row = result.rows[0];
  res.json({
    order: { id: orderId, status: row.order_status, delivery_lat: row.delivery_lat, delivery_lng: row.delivery_lng, delivery_eta: row.delivery_eta },
    partner: { id: row.partner_id, name: row.partner_name, phone: row.partner_phone, vehicle_type: row.vehicle_type, vehicle_number: row.vehicle_number, lat: row.current_lat, lng: row.current_lng },
    delivery_status: row.delivery_status,
    picked_up_at: row.picked_up_at,
    delivered_at: row.delivered_at,
  });
}));

// ─── Mark Picked Up ─────────────────────────────────────
router.patch('/:assignmentId/pickup', authenticate, authorize('delivery'), asyncHandler(async (req, res) => {
  const { assignmentId } = req.params;

  const result = await pool.query(
    `UPDATE delivery_assignments SET status = 'picked_up', picked_up_at = NOW() WHERE id = $1 AND status = 'assigned' RETURNING *`,
    [assignmentId]
  );

  if (result.rows.length === 0) return res.status(400).json({ error: 'Assignment not found or already picked up' });

  // Also update order status
  const assign = result.rows[0];
  await pool.query(`UPDATE orders SET status = 'out_for_delivery' WHERE id = $1`, [assign.order_id]);

  res.json({ success: true, assignment: result.rows[0] });
}));

// ─── Mark Delivered ─────────────────────────────────────
router.patch('/:assignmentId/deliver', authenticate, authorize('delivery'), asyncHandler(async (req, res) => {
  const { assignmentId } = req.params;

  const result = await pool.query(
    `UPDATE delivery_assignments SET status = 'delivered', delivered_at = NOW() WHERE id = $1 AND status = 'picked_up' RETURNING *`,
    [assignmentId]
  );

  if (result.rows.length === 0) return res.status(400).json({ error: 'Assignment not found or not in picked_up status' });

  const assign = result.rows[0];

  // Update order status
  await pool.query(`UPDATE orders SET status = 'delivered', delivered_at = NOW() WHERE id = $1`, [assign.order_id]);

  // Mark partner as available again
  await pool.query(`UPDATE delivery_partners SET status = 'available' WHERE id = $1`, [assign.partner_id]);

  // Add earnings (₹20 per delivery as example)
  await pool.query(`UPDATE delivery_partners SET earnings = COALESCE(earnings, 0) + 20 WHERE id = $1`, [assign.partner_id]);

  // Broadcast delivery complete
  const { broadcastOrderUpdate } = require('../services/websocket');
  broadcastOrderUpdate(assign.order_id, 'delivered');

  res.json({ success: true, assignment: result.rows[0] });
}));

// ─── Get Assignments for a Partner ──────────────────────
router.get('/my-assignments', authenticate, authorize('delivery'), asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT da.*, o.customer_name, o.customer_mobile, o.total, o.kitchen_id, o.items_by_meal, o.delivery_address
     FROM delivery_assignments da
     JOIN orders o ON da.order_id = o.id
     WHERE da.partner_id = $1 AND da.status IN ('assigned', 'picked_up')
     ORDER BY da.assigned_at DESC`,
    [req.user.id]
  );
  res.json(result.rows);
}));

// ─── Verify License (Admin) ────────────────────────────
router.patch('/verify-license/:partnerId', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { partnerId } = req.params;

  const result = await pool.query(
    `UPDATE delivery_partners SET license_verified = true WHERE id = $1 RETURNING id, name, license_verified`,
    [partnerId]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Delivery partner not found' });
  }

  res.json({ success: true, partner: result.rows[0] });
}));

// ─── Generate Delivery OTP ──────────────────────────────
router.post('/:assignmentId/generate-otp', authenticate, authorize('kitchen', 'admin'), asyncHandler(async (req, res) => {
  const { assignmentId } = req.params;

  // Get assignment details
  const assignRes = await pool.query(
    `SELECT da.order_id, da.partner_id, o.customer_mobile, o.customer_email, o.customer_name
     FROM delivery_assignments da
     JOIN orders o ON da.order_id = o.id
     WHERE da.id = $1 AND da.status = 'assigned'`,
    [assignmentId]
  );
  if (assignRes.rows.length === 0) return res.status(400).json({ error: 'Assignment not found or not in assigned status' });

  const { order_id, customer_mobile, customer_email, customer_name } = assignRes.rows[0];

  // Generate 6-digit OTP
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry

  // Store OTP
  await pool.query(
    `INSERT INTO delivery_otps (order_id, customer_mobile, customer_email, customer_name, otp, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (order_id) DO UPDATE SET otp = $5, expires_at = $6, attempts = 0`,
    [order_id, customer_mobile || null, customer_email || null, customer_name || null, otp, expiresAt]
  );

  res.json({ success: true, message: 'OTP generated. Share with delivery partner.', otp });
}));

// ─── Verify Delivery OTP ────────────────────────────────
router.post('/:assignmentId/verify-otp', authenticate, authorize('delivery'), asyncHandler(async (req, res) => {
  const { assignmentId } = req.params;
  const { otp } = req.body;

  if (!otp) return res.status(400).json({ error: 'OTP is required' });

  // Get assignment to find order_id
  const assignRes = await pool.query(
    `SELECT order_id, partner_id FROM delivery_assignments WHERE id = $1 AND status = 'picked_up'`,
    [assignmentId]
  );
  if (assignRes.rows.length === 0) return res.status(400).json({ error: 'Assignment not found or not picked up yet' });

  const { order_id, partner_id } = assignRes.rows[0];

  // Verify partner owns this assignment
  if (partner_id !== req.user.id) {
    return res.status(403).json({ error: 'This assignment does not belong to you' });
  }

  // Get stored OTP
  const otpRes = await pool.query(
    `SELECT * FROM delivery_otps WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [order_id]
  );
  if (otpRes.rows.length === 0) return res.status(400).json({ error: 'No OTP generated for this order' });

  const stored = otpRes.rows[0];

  // Check expiry
  if (new Date() > new Date(stored.expires_at)) {
    return res.status(400).json({ error: 'OTP has expired. Please request a new one from the kitchen.' });
  }

  // Check attempts
  if (stored.attempts >= 3) {
    return res.status(400).json({ error: 'Too many failed attempts. Please request a new OTP from the kitchen.' });
  }

  // Verify OTP
  if (stored.otp !== otp) {
    await pool.query(`UPDATE delivery_otps SET attempts = attempts + 1 WHERE id = $1`, [stored.id]);
    return res.status(400).json({ error: 'Invalid OTP' });
  }

  // OTP verified — mark as delivered
  const result = await pool.query(
    `UPDATE delivery_assignments SET status = 'delivered', delivered_at = NOW() WHERE id = $1 AND status = 'picked_up' RETURNING *`,
    [assignmentId]
  );

  if (result.rows.length === 0) return res.status(400).json({ error: 'Failed to mark as delivered' });

  // Update order status
  await pool.query(`UPDATE orders SET status = 'delivered', delivered_at = NOW() WHERE id = $1`, [order_id]);

  // Mark partner as available
  await pool.query(`UPDATE delivery_partners SET status = 'available' WHERE id = $1`, [partner_id]);

  // Add earnings (₹20 per delivery)
  await pool.query(`UPDATE delivery_partners SET earnings = COALESCE(earnings, 0) + 20 WHERE id = $1`, [partner_id]);

  // Broadcast delivery complete
  const { broadcastOrderUpdate } = require('../services/websocket');
  broadcastOrderUpdate(order_id, 'delivered');

  // Clean up OTP
  await pool.query(`DELETE FROM delivery_otps WHERE order_id = $1`, [order_id]);

  res.json({ success: true, message: 'Delivery confirmed via OTP' });
}));

module.exports = router;

/**
 * Authentication Routes
 * Customer signup/login with OTP, Kitchen login, Admin login
 */
const { Router } = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db/pool');
const { asyncHandler } = require('../middleware/errorHandler');
const { generateToken, authenticate, authorize } = require('../middleware/auth');
const { sendOTP } = require('../services/otp');
const rateLimit = require('express-rate-limit');

const router = Router();

// Rate limiter for OTP requests
const otpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 OTP requests per hour per IP
  message: { error: 'Too many OTP requests. Please try again after an hour.' },
});

// In-memory OTP store (use Redis in production)
const otpStore = new Map();

// Cleanup old OTPs every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of otpStore.entries()) {
    if (now > value.expiresAt) {
      otpStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * POST /api/auth/send-otp
 * Send OTP via the customer's chosen channel: 'mobile' (SMS) or 'email' (Gmail).
 * Only one identifier is required — whichever matches the chosen channel.
 */
router.post('/send-otp', otpLimiter, asyncHandler(async (req, res) => {
  const { mobile, name, email, channel } = req.body;

  if (channel !== 'mobile' && channel !== 'email') {
    return res.status(400).json({ error: 'channel must be "mobile" or "email"' });
  }

  if (channel === 'mobile' && (!mobile || !/^[6-9]\d{9}$/.test(mobile))) {
    return res.status(400).json({ error: 'Valid 10-digit mobile number required' });
  }
  if (channel === 'email' && (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return res.status(400).json({ error: 'Valid email address required' });
  }

  const identifier = channel === 'mobile' ? mobile : email.toLowerCase();
  const otpKey = `${channel}:${identifier}`;

  // Send OTP only via the chosen channel — no silent fallback to the other one.
  const result = channel === 'email'
    ? await sendOTP(null, identifier, name)
    : await sendOTP(identifier, null, name);

  // Store OTP temporarily (5 minutes) — server-side only
  otpStore.set(otpKey, {
    otp: result.otp,
    name: name || '',
    channel,
    identifier,
    expiresAt: Date.now() + 5 * 60 * 1000,
    attempts: 0,
    method: result.method || 'unknown',
  });

  // NEVER send OTP back to client — only success/failure
  res.json({
    success: true,
    message: channel === 'email' ? 'OTP sent to your email.' : 'OTP sent via SMS.',
    method: result.method || 'unknown',
  });
}));

/**
 * POST /api/auth/verify-otp
 * Verify OTP and create/login customer. Same channel used to send must be
 * passed back here, along with the matching identifier (mobile or email).
 */
router.post('/verify-otp', asyncHandler(async (req, res) => {
  const { mobile, email, channel, otp } = req.body;

  if (channel !== 'mobile' && channel !== 'email') {
    return res.status(400).json({ error: 'channel must be "mobile" or "email"' });
  }
  const identifier = channel === 'mobile' ? mobile : (email || '').toLowerCase();
  if (!identifier || !otp) {
    return res.status(400).json({ error: `${channel === 'mobile' ? 'Mobile number' : 'Email'} and OTP required` });
  }

  const otpKey = `${channel}:${identifier}`;
  const stored = otpStore.get(otpKey);
  if (!stored) {
    return res.status(400).json({ error: 'No OTP requested for this. Please request OTP first.' });
  }

  if (Date.now() > stored.expiresAt) {
    otpStore.delete(otpKey);
    return res.status(400).json({ error: 'OTP expired. Please request a new one.' });
  }

  // Check attempts
  stored.attempts += 1;
  if (stored.attempts > 3) {
    otpStore.delete(otpKey);
    return res.status(400).json({ error: 'Too many failed attempts. Please request a new OTP.' });
  }

  if (stored.otp !== otp) {
    return res.status(400).json({ error: 'Invalid OTP' });
  }

  // OTP verified — create or update customer
  otpStore.delete(otpKey);

  // Look up by whichever identifier this channel used
  const lookupColumn = channel === 'mobile' ? 'mobile' : 'email';
  let customerResult = await pool.query(
    `SELECT * FROM customers WHERE ${lookupColumn} = $1`,
    [identifier]
  );

  let customer;
  if (customerResult.rows.length === 0) {
    // Create new customer — mobile or email may be null depending on channel used
    const newResult = await pool.query(
      `INSERT INTO customers (name, email, mobile, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       RETURNING *`,
      [stored.name || 'Guest', channel === 'email' ? identifier : null, channel === 'mobile' ? identifier : null]
    );
    customer = newResult.rows[0];
  } else {
    customer = customerResult.rows[0];
    // Update name if provided
    if (stored.name) {
      await pool.query(
        'UPDATE customers SET name = $1, updated_at = NOW() WHERE id = $2',
        [stored.name, customer.id]
      );
      customer.name = stored.name;
    }
  }

  // Generate JWT
  const token = generateToken({
    id: customer.id,
    mobile: customer.mobile,
    name: customer.name,
    role: 'customer',
  });

  res.json({
    success: true,
    token,
    customer: {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      mobile: customer.mobile,
      avatar: customer.avatar,
    },
    profileComplete: customer.age !== null && customer.age !== undefined,
  });
}));

/**
 * PUT /api/auth/customer/profile
 * Save the customer's nutrition profile (age, weight, height, goal, etc.)
 * so menu recommendations can be personalized to them.
 */
router.put('/customer/profile', authenticate, authorize('customer'), asyncHandler(async (req, res) => {
  const { age, weight, height, gender, goal, dietPref, dislikedFoods, deficiencies } = req.body;

  const result = await pool.query(
    `UPDATE customers SET
      age = COALESCE($1, age),
      weight = COALESCE($2, weight),
      height = COALESCE($3, height),
      gender = COALESCE($4, gender),
      goal = COALESCE($5, goal),
      diet_pref = COALESCE($6, diet_pref),
      disliked_foods = COALESCE($7, disliked_foods),
      deficiencies = COALESCE($8, deficiencies),
      updated_at = NOW()
     WHERE id = $9
     RETURNING id, name, email, mobile, age, weight, height, gender, goal, diet_pref, disliked_foods, deficiencies`,
    [age || null, weight || null, height || null, gender || null, goal || null, dietPref || null, dislikedFoods || null, deficiencies || null, req.user.id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  res.json({ success: true, customer: result.rows[0] });
}));

/**
 * POST /api/auth/kitchen/login
 * Kitchen staff login with email/password
 */
router.post('/kitchen/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const result = await pool.query(
    'SELECT * FROM kitchens WHERE email = $1',
    [email]
  );

  if (result.rows.length === 0) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const kitchen = result.rows[0];

  // Check password (if kitchen has password set)
  if (kitchen.password) {
    const valid = await bcrypt.compare(password, kitchen.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
  } else {
    // First time login — set password
    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query(
      'UPDATE kitchens SET password = $1, updated_at = NOW() WHERE id = $2',
      [hashedPassword, kitchen.id]
    );
  }

  const token = generateToken({
    id: kitchen.id,
    name: kitchen.name,
    email: kitchen.email,
    role: 'kitchen',
    kitchenId: kitchen.id,
  });

  res.json({
    success: true,
    token,
    kitchen: {
      id: kitchen.id,
      name: kitchen.name,
      email: kitchen.email,
      type: kitchen.type,
      active: kitchen.active,
    },
  });
}));

/**
 * POST /api/auth/admin/login
 * Admin login
 */
router.post('/admin/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword || email !== adminEmail || password !== adminPassword) {
    return res.status(401).json({ error: 'Invalid admin credentials' });
  }

  const token = generateToken({
    id: 'admin',
    email,
    role: 'admin',
    name: 'Admin',
  });

  res.json({
    success: true,
    token,
    admin: { name: 'Admin', email },
  });
}));

/**
 * GET /api/auth/me
 * Get current authenticated user
 */
router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const { role, id } = req.user;

  if (role === 'customer') {
    const result = await pool.query('SELECT id, name, email, mobile, avatar, age, weight, height, gender, goal, diet_pref, disliked_foods, deficiencies, tier FROM customers WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    return res.json({ user: result.rows[0], role: 'customer' });
  }

  if (role === 'kitchen') {
    const result = await pool.query('SELECT id, name, email, type, active, rating_text, lat, lng FROM kitchens WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Kitchen not found' });
    return res.json({ user: result.rows[0], role: 'kitchen' });
  }

  if (role === 'admin') {
    return res.json({ user: { id: 'admin', name: 'Admin', email: req.user.email }, role: 'admin' });
  }

  res.status(403).json({ error: 'Unknown role' });
}));

module.exports = router;
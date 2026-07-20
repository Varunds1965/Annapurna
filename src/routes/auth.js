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
 * Send OTP to customer's mobile number
 */
router.post('/send-otp', otpLimiter, asyncHandler(async (req, res) => {
  const { mobile, name, email } = req.body;

  if (!mobile || !/^[6-9]\d{9}$/.test(mobile)) {
    return res.status(400).json({ error: 'Valid 10-digit mobile number required' });
  }

  // Send OTP — pass email for free email delivery, never returns OTP to client
  const result = await sendOTP(mobile, email, name);

  // Store OTP temporarily (5 minutes) — server-side only
  otpStore.set(mobile, {
    otp: result.otp,
    name: name || '',
    email: email || '',
    expiresAt: Date.now() + 5 * 60 * 1000,
    attempts: 0,
    method: result.method || 'unknown',
  });

  // NEVER send OTP back to client — only success/failure
  res.json({
    success: true,
    message: 'OTP sent successfully. Check your email or SMS.',
    method: result.method || 'unknown',
  });
}));

/**
 * POST /api/auth/verify-otp
 * Verify OTP and create/login customer
 */
router.post('/verify-otp', asyncHandler(async (req, res) => {
  const { mobile, otp } = req.body;

  if (!mobile || !otp) {
    return res.status(400).json({ error: 'Mobile and OTP required' });
  }

  const stored = otpStore.get(mobile);
  if (!stored) {
    return res.status(400).json({ error: 'No OTP requested for this number. Please request OTP first.' });
  }

  if (Date.now() > stored.expiresAt) {
    otpStore.delete(mobile);
    return res.status(400).json({ error: 'OTP expired. Please request a new one.' });
  }

  // Check attempts
  stored.attempts += 1;
  if (stored.attempts > 3) {
    otpStore.delete(mobile);
    return res.status(400).json({ error: 'Too many failed attempts. Please request a new OTP.' });
  }

  if (stored.otp !== otp) {
    return res.status(400).json({ error: 'Invalid OTP' });
  }

  // OTP verified — create or update customer
  otpStore.delete(mobile);

  // Check if customer exists
  let customerResult = await pool.query(
    'SELECT * FROM customers WHERE mobile = $1',
    [mobile]
  );

  let customer;
  if (customerResult.rows.length === 0) {
    // Create new customer
    const newResult = await pool.query(
      `INSERT INTO customers (name, email, mobile, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       RETURNING *`,
      [stored.name || 'Guest', stored.email || null, mobile]
    );
    customer = newResult.rows[0];
  } else {
    customer = customerResult.rows[0];
    // Update name/email if provided
    if (stored.name) {
      await pool.query(
        'UPDATE customers SET name = $1, email = COALESCE($2, email), updated_at = NOW() WHERE id = $3',
        [stored.name, stored.email, customer.id]
      );
      customer.name = stored.name;
      if (stored.email) customer.email = stored.email;
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
  });
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

  // Simple admin check — in production, use proper admin table
  if (email !== 'admin@thaliplan.com' || password !== 'admin123') {
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
    const result = await pool.query('SELECT id, name, email, mobile, avatar, age, weight, height, gender, goal, diet_pref, tier FROM customers WHERE id = $1', [id]);
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
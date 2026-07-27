/**
 * Authentication Routes — FIXED
 * - Removed kitchen "first login sets password" vulnerability
 * - Kitchen must register with password via /register endpoint
 */
const { Router } = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db/pool');
const { asyncHandler } = require('../middleware/errorHandler');
const { generateToken, authenticate, authorize } = require('../middleware/auth');
const { sendOTP } = require('../services/otp');
const rateLimit = require('express-rate-limit');

const router = Router();

const otpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Too many OTP requests. Please try again after an hour.' },
});

// In-memory OTP store (use Redis in production)
const otpStore = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, value] of otpStore.entries()) {
    if (now > value.expiresAt) otpStore.delete(key);
  }
}, 5 * 60 * 1000);

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

  const result = channel === 'email'
    ? await sendOTP(null, identifier, name)
    : await sendOTP(identifier, null, name);

  otpStore.set(otpKey, {
    otp: result.otp,
    name: name || '',
    channel,
    identifier,
    expiresAt: Date.now() + 5 * 60 * 1000,
    attempts: 0,
    method: result.method || 'unknown',
  });

  res.json({
    success: true,
    message: channel === 'email' ? 'OTP sent to your email.' : 'OTP sent via SMS.',
    method: result.method || 'unknown',
  });
}));

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
  if (!stored) return res.status(400).json({ error: 'No OTP requested. Please request OTP first.' });

  if (Date.now() > stored.expiresAt) {
    otpStore.delete(otpKey);
    return res.status(400).json({ error: 'OTP expired. Please request a new one.' });
  }

  stored.attempts += 1;
  if (stored.attempts > 3) {
    otpStore.delete(otpKey);
    return res.status(400).json({ error: 'Too many failed attempts. Please request a new OTP.' });
  }

  if (stored.otp !== otp) {
    return res.status(400).json({ error: 'Invalid OTP' });
  }

  otpStore.delete(otpKey);

  const lookupColumn = channel === 'mobile' ? 'mobile' : 'email';
  let customerResult = await pool.query(
    `SELECT * FROM customers WHERE ${lookupColumn} = $1`,
    [identifier]
  );

  let customer;
  if (customerResult.rows.length === 0) {
    const newResult = await pool.query(
      `INSERT INTO customers (name, email, mobile, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       RETURNING *`,
      [stored.name || 'Guest', channel === 'email' ? identifier : null, channel === 'mobile' ? identifier : null]
    );
    customer = newResult.rows[0];
    // Generate referral code for new customers
    const referralCode = `TP${customer.id}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    await pool.query('UPDATE customers SET referral_code = $1 WHERE id = $2 AND referral_code IS NULL', [referralCode, customer.id]);
    customer.referral_code = referralCode;
  } else {
    customer = customerResult.rows[0];
    if (stored.name && stored.name !== customer.name) {
      await pool.query('UPDATE customers SET name = $1, updated_at = NOW() WHERE id = $2', [stored.name, customer.id]);
      customer.name = stored.name;
    }
  }

  const token = generateToken({
    id: customer.id,
    mobile: customer.mobile,
    name: customer.name,
    role: 'customer',
  });

  res.json({
    success: true,
    token,
    customer: { id: customer.id, name: customer.name, email: customer.email, mobile: customer.mobile, avatar: customer.avatar },
    profileComplete: customer.age !== null && customer.age !== undefined,
  });
}));

router.put('/customer/profile', authenticate, authorize('customer'), asyncHandler(async (req, res) => {
  const { age, weight, height, gender, goal, dietPref, dislikedFoods, deficiencies } = req.body;

  const result = await pool.query(
    `UPDATE customers SET
     age = COALESCE($1, age), weight = COALESCE($2, weight), height = COALESCE($3, height),
     gender = COALESCE($4, gender), goal = COALESCE($5, goal), diet_pref = COALESCE($6, diet_pref),
     disliked_foods = COALESCE($7, disliked_foods), deficiencies = COALESCE($8, deficiencies),
     updated_at = NOW()
     WHERE id = $9
     RETURNING id, name, email, mobile, age, weight, height, gender, goal, diet_pref, disliked_foods, deficiencies`,
    [age || null, weight || null, height || null, gender || null, goal || null, dietPref || null, dislikedFoods || null, deficiencies || null, req.user.id]
  );

  if (result.rows.length === 0) return res.status(404).json({ error: 'Customer not found' });
  res.json({ success: true, customer: result.rows[0] });
}));

/**
 * Kitchen login — FIXED: password is required, no "set on first login" behavior
 */
router.post('/kitchen/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const result = await pool.query('SELECT * FROM kitchens WHERE email = $1', [email]);
  if (result.rows.length === 0) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const kitchen = result.rows[0];

  // Kitchen MUST have a password (set during registration)
  if (!kitchen.password) {
    return res.status(401).json({ error: 'Account not set up. Please register first.' });
  }

  const valid = await bcrypt.compare(password, kitchen.password);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  if (!kitchen.active) {
    return res.status(403).json({ error: 'Kitchen pending admin approval' });
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
    kitchen: { id: kitchen.id, name: kitchen.name, email: kitchen.email, type: kitchen.type, active: kitchen.active },
  });
}));

router.post('/admin/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    return res.status(500).json({ error: 'Admin credentials not configured' });
  }

  if (email !== adminEmail || password !== adminPassword) {
    return res.status(401).json({ error: 'Invalid admin credentials' });
  }

  const token = generateToken({ id: 'admin', email, role: 'admin', name: 'Admin' });
  res.json({ success: true, token, admin: { name: 'Admin', email } });
}));

router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const { role, id } = req.user;

  if (role === 'customer') {
    const result = await pool.query('SELECT id, name, email, mobile, avatar, age, weight, height, gender, goal, diet_pref, disliked_foods, deficiencies, tier, loyalty_points FROM customers WHERE id = $1', [id]);
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

  if (role === 'delivery') {
    const result = await pool.query('SELECT id, name, phone, vehicle_type, status, earnings FROM delivery_partners WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Partner not found' });
    return res.json({ user: result.rows[0], role: 'delivery' });
  }

  res.status(403).json({ error: 'Unknown role' });
}));

module.exports = router;
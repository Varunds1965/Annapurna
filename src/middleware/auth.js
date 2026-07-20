/**
 * JWT Authentication Middleware
 * Verifies tokens for customers, kitchens, and admin
 */
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'thaliplan_jwt_secret_key_change_in_production_2024';

/**
 * Generate JWT token
 */
function generateToken(payload, expiresIn) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: expiresIn || '7d' });
}

/**
 * Verify JWT token
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

/**
 * Middleware: Authenticate any user (customer, kitchen, admin)
 */
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = authHeader.split(' ')[1];
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.user = decoded;
  next();
}

/**
 * Middleware: Restrict to specific roles
 */
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

/**
 * Middleware: Optional auth (doesn't fail if no token)
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);
    if (decoded) {
      req.user = decoded;
    }
  }
  next();
}

module.exports = {
  generateToken,
  verifyToken,
  authenticate,
  authorize,
  optionalAuth,
};
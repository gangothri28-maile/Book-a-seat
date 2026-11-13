const jwt = require('jsonwebtoken');
const env = require('../config/env');
const db = require('../config/db');

async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required. Missing Bearer token.'
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, env.JWT_SECRET);

    const userRes = await db.query('SELECT id, name, email, role FROM users WHERE id = $1', [decoded.id]);
    if (userRes.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'User account not found.'
      });
    }

    req.user = userRes.rows[0];
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired authentication token.'
    });
  }
}

async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, env.JWT_SECRET);
      const userRes = await db.query('SELECT id, name, email, role FROM users WHERE id = $1', [decoded.id]);
      if (userRes.rows.length > 0) {
        req.user = userRes.rows[0];
      }
    }
  } catch (e) {
    // Optional, ignore error
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: 'Access denied. Administrator privileges required.'
    });
  }
  next();
}

module.exports = {
  authenticate,
  optionalAuth,
  requireAdmin
};

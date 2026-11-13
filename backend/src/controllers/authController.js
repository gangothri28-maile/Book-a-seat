const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');
const env = require('../config/env');

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN }
  );
}

exports.register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: 'Name, email and password are required.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters.' });
    }

    const cleanEmail = email.toLowerCase().trim();

    // Check existing
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [cleanEmail]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ success: false, error: 'An account with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const userId = `usr_${uuidv4().replace(/-/g, '')}`;

    await db.query(
      'INSERT INTO users (id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5)',
      [userId, name.trim(), cleanEmail, passwordHash, 'customer']
    );

    const user = { id: userId, name: name.trim(), email: cleanEmail, role: 'customer' };
    const token = generateToken(user);

    return res.status(201).json({
      success: true,
      message: 'Account created successfully.',
      token,
      user
    });
  } catch (err) {
    console.error('[Auth] Register error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error during registration.' });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const userRes = await db.query('SELECT * FROM users WHERE email = $1', [cleanEmail]);

    if (userRes.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    const user = userRes.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    const safeUser = { id: user.id, name: user.name, email: user.email, role: user.role };
    const token = generateToken(safeUser);

    return res.json({
      success: true,
      message: 'Login successful.',
      token,
      user: safeUser
    });
  } catch (err) {
    console.error('[Auth] Login error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error during login.' });
  }
};

exports.getMe = async (req, res) => {
  return res.json({
    success: true,
    user: req.user
  });
};

exports.logout = async (req, res) => {
  return res.json({
    success: true,
    message: 'Logged out successfully.'
  });
};

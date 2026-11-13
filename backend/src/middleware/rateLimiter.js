// In-memory token-bucket / sliding window rate limiter
const requestCounts = new Map();

function rateLimiter(options = { windowMs: 60000, maxRequests: 120 }) {
  return (req, res, next) => {
    const key = req.ip || req.headers['x-forwarded-for'] || 'unknown_ip';
    const now = Date.now();

    if (!requestCounts.has(key)) {
      requestCounts.set(key, []);
    }

    const timestamps = requestCounts.get(key);
    // Prune timestamps older than window
    const validTimestamps = timestamps.filter(ts => now - ts < options.windowMs);
    validTimestamps.push(now);
    requestCounts.set(key, validTimestamps);

    if (validTimestamps.length > options.maxRequests) {
      return res.status(429).json({
        success: false,
        error: 'Too many requests. Please slow down your interactions.'
      });
    }

    next();
  };
}

module.exports = rateLimiter;

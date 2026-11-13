const db = require('../config/db');
const redis = require('../config/redis');
const seatHoldService = require('../services/seatHoldService');
const botDetectionEngine = require('../bot-detection/botDetectionEngine');

exports.getSeats = async (req, res) => {
  try {
    const { eventId } = req.query;
    if (!eventId) {
      return res.status(400).json({ success: false, error: 'Event ID is required in query params.' });
    }

    const seatsRes = await db.query(
      'SELECT id, event_id, seat_row, seat_number, category, price, status, version FROM seats WHERE event_id = $1 ORDER BY seat_row, seat_number ASC',
      [eventId]
    );

    // Cross-verify with Redis locks for sub-second synchronization
    const seats = await Promise.all(
      seatsRes.rows.map(async seat => {
        if (seat.status === 'available') {
          const redisHeld = await redis.get(`seat:hold:${seat.id}`);
          if (redisHeld) {
            return { ...seat, status: 'held' };
          }
        }
        return seat;
      })
    );

    return res.json({ success: true, seats });
  } catch (err) {
    console.error('[Seat] GetSeats error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve seats map.' });
  }
};

exports.holdSeats = async (req, res) => {
  try {
    const { eventId, seatIds, sessionId } = req.body;
    const userId = req.user.id;

    if (!eventId || !seatIds) {
      return res.status(400).json({ success: false, error: 'Event ID and seatIds are required.' });
    }

    // Bot detection check
    if (sessionId) {
      botDetectionEngine.recordHoldAttempt(sessionId);
      if (botDetectionEngine.isSessionBlocked(sessionId)) {
        return res.status(403).json({
          success: false,
          error: 'Action blocked. Suspicious automated activity flagged on this session.'
        });
      }
    }

    const io = req.app.get('io');
    const result = await seatHoldService.holdSeats(userId, eventId, seatIds, io);

    return res.status(201).json({
      success: true,
      message: 'Seats held successfully. Please complete checkout before timer expires.',
      ...result
    });
  } catch (err) {
    console.error('[Seat] HoldSeats error:', err.message);
    const status = err.statusCode || 500;
    return res.status(status).json({
      success: false,
      error: err.message,
      code: err.code || 'HOLD_ERROR'
    });
  }
};

exports.releaseSeats = async (req, res) => {
  try {
    const { holdId, eventId } = req.body;
    if (!holdId) {
      return res.status(400).json({ success: false, error: 'Hold ID is required.' });
    }

    const io = req.app.get('io');
    const result = await seatHoldService.releaseHold(holdId, eventId, io, 'user_cancelled');
    return res.json({ success: true, message: 'Seats released successfully.', ...result });
  } catch (err) {
    console.error('[Seat] ReleaseSeats error:', err);
    return res.status(500).json({ success: false, error: 'Failed to release seats.' });
  }
};

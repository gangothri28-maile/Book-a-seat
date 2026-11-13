const db = require('../config/db');
const redis = require('../config/redis');
const queueService = require('../services/queueService');
const botDetectionEngine = require('../bot-detection/botDetectionEngine');

exports.getDashboardMetrics = async (req, res) => {
  try {
    const eventId = 'evt_symphony_2026';

    // 1. Total Registered Users
    const usersRes = await db.query('SELECT count(*) as count FROM users');
    const totalUsers = parseInt(usersRes.rows[0].count, 10);

    // 2. Waiting Room Queue Count
    const queueListKey = `queue:list:${eventId}`;
    const waitingUsersCount = await redis.llen(queueListKey);
    const activeAdmittedCount = await queueService.getActiveUserCount(eventId);

    // 3. Seats Breakdown
    const seatsRes = await db.query('SELECT status, count(*) as count FROM seats WHERE event_id = $1 GROUP BY status', [
      eventId
    ]);
    const seatCounts = { available: 0, held: 0, booked: 0, unavailable: 0 };
    seatsRes.rows.forEach(r => {
      seatCounts[r.status] = parseInt(r.count, 10);
    });

    // 4. Revenue & Payments
    const paymentsRes = await db.query(
      `SELECT count(*) as total_payments, COALESCE(SUM(amount), 0) as total_revenue FROM payments WHERE status = 'successful'`
    );
    const successfulPayments = parseInt(paymentsRes.rows[0].total_payments, 10);
    const totalRevenue = parseFloat(paymentsRes.rows[0].total_revenue);

    // 5. Bot & Security Metrics
    const botAssessmentsRes = await db.query('SELECT * FROM bot_risk_assessments ORDER BY created_at DESC');
    const assessments = botAssessmentsRes.rows;
    const suspiciousCount = assessments.filter(a => a.risk_score >= 31).length;
    const highRiskCount = assessments.filter(a => a.risk_score >= 61).length;
    const blockedCount = assessments.filter(a => a.action_taken === 'RESTRICT_BLOCKED').length;

    return res.json({
      success: true,
      metrics: {
        totalRegisteredUsers: totalUsers,
        waitingRoomUsers: waitingUsersCount,
        activeAdmittedUsers: activeAdmittedCount,
        seatsAvailable: seatCounts.available || 0,
        seatsHeld: seatCounts.held || 0,
        seatsBooked: seatCounts.booked || 0,
        totalSeats: 60,
        successfulPayments,
        totalRevenue,
        suspiciousSessions: suspiciousCount,
        highRiskSessions: highRiskCount,
        blockedSessions: blockedCount
      }
    });
  } catch (err) {
    console.error('[Admin] GetDashboardMetrics error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve admin dashboard metrics.' });
  }
};

exports.getQueueDetails = async (req, res) => {
  try {
    const eventId = 'evt_symphony_2026';
    const listKey = `queue:list:${eventId}`;
    const sessions = await redis.lrange(listKey, 0, -1);

    const queueEntriesRes = await db.query(
      'SELECT qe.*, u.name as user_name, u.email as user_email FROM queue_entries qe LEFT JOIN users u ON qe.user_id = u.id WHERE qe.event_id = $1 ORDER BY qe.created_at DESC',
      [eventId]
    );

    return res.json({
      success: true,
      liveWaitingQueue: sessions.map((sid, idx) => ({
        position: idx + 1,
        sessionId: sid
      })),
      historyEntries: queueEntriesRes.rows
    });
  } catch (err) {
    console.error('[Admin] GetQueueDetails error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve queue details.' });
  }
};

exports.getAllBookings = async (req, res) => {
  try {
    const bookingsRes = await db.query(
      'SELECT b.*, u.name as customer_name, u.email as customer_email, e.title as event_title, p.payment_method, p.transaction_ref FROM bookings b LEFT JOIN users u ON b.user_id = u.id LEFT JOIN events e ON b.event_id = e.id LEFT JOIN payments p ON b.id = p.booking_id ORDER BY b.created_at DESC'
    );

    const bookings = await Promise.all(
      bookingsRes.rows.map(async bk => {
        const seatsRes = await db.query(
          'SELECT bs.price_at_booking, s.id, s.seat_row, s.seat_number, s.category FROM booking_seats bs JOIN seats s ON bs.seat_id = s.id WHERE bs.booking_id = $1',
          [bk.id]
        );
        return {
          ...bk,
          seats: seatsRes.rows.map(s => ({
            id: s.id,
            label: `${s.seat_row}${s.seat_number}`,
            row: s.seat_row,
            number: s.seat_number,
            category: s.category,
            price: s.price_at_booking
          }))
        };
      })
    );

    return res.json({ success: true, bookings });
  } catch (err) {
    console.error('[Admin] GetAllBookings error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve bookings.' });
  }
};

exports.getBotActivity = async (req, res) => {
  try {
    const assessmentsRes = await db.query(
      'SELECT a.*, u.name as user_name, u.email as user_email FROM bot_risk_assessments a LEFT JOIN users u ON a.user_id = u.id ORDER BY a.created_at DESC'
    );

    const formatted = assessmentsRes.rows.map(a => ({
      ...a,
      explainable_signals: typeof a.explainable_signals === 'string' ? JSON.parse(a.explainable_signals) : a.explainable_signals
    }));

    return res.json({ success: true, assessments: formatted });
  } catch (err) {
    console.error('[Admin] GetBotActivity error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve bot activity.' });
  }
};

exports.admitNext = async (req, res) => {
  try {
    const eventId = 'evt_symphony_2026';
    const io = req.app.get('io');
    await queueService.processAdmission(eventId, io);
    return res.json({ success: true, message: 'Next queue batch admitted successfully.' });
  } catch (err) {
    console.error('[Admin] AdmitNext error:', err);
    return res.status(500).json({ success: false, error: 'Failed to admit next users.' });
  }
};

exports.toggleBlockSession = async (req, res) => {
  try {
    const { sessionId, blocked } = req.body;
    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'Session ID is required.' });
    }

    botDetectionEngine.setSessionBlocked(sessionId, blocked);

    return res.json({
      success: true,
      message: `Session ${sessionId} has been ${blocked ? 'restricted / blocked' : 'unblocked'}.`
    });
  } catch (err) {
    console.error('[Admin] ToggleBlockSession error:', err);
    return res.status(500).json({ success: false, error: 'Failed to update session status.' });
  }
};

exports.resetSeats = async (req, res) => {
  try {
    const eventId = 'evt_symphony_2026';
    const io = req.app.get('io');

    // Clear holds in Redis
    const holdKeys = await redis.keys('seat:hold:*');
    for (const key of holdKeys) {
      await redis.del(key);
    }

    // Reset holds table
    await db.query(`UPDATE seat_holds SET status = 'released' WHERE event_id = $1 AND status = 'active'`, [eventId]);

    // Reset seats back to available (keep seed A1/A2 booked, or reset all except seed)
    await db.query(
      `UPDATE seats SET status = 'available', version = version + 1 WHERE event_id = $1 AND id NOT IN ('seat_a_1', 'seat_a_2')`,
      [eventId]
    );

    if (io) {
      io.to(`event:${eventId}`).emit('seats:reset', { eventId });
      io.emit('admin:stats_updated');
    }

    return res.json({ success: true, message: 'Seat map reset to initial state for live demo testing.' });
  } catch (err) {
    console.error('[Admin] ResetSeats error:', err);
    return res.status(500).json({ success: false, error: 'Failed to reset seats.' });
  }
};

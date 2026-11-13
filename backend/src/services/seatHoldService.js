const { v4: uuidv4 } = require('uuid');
const redis = require('../config/redis');
const db = require('../config/db');
const env = require('../config/env');

class SeatHoldService {
  constructor() {
    this.HOLD_DURATION_SECONDS = env.SEAT_HOLD_DURATION_SECONDS; // 300s (5 minutes)
    this.expirationWorkerInterval = null;
  }

  /**
   * Atomically holds a list of seats for a given user.
   * Guarantees that if two users request overlapping seats simultaneously,
   * only ONE succeeds and the other receives a 409 Conflict.
   */
  async holdSeats(userId, eventId, seatIds, io = null) {
    if (!seatIds || !Array.isArray(seatIds) || seatIds.length === 0) {
      const err = new Error('Please select at least one seat.');
      err.statusCode = 400;
      throw err;
    }

    if (seatIds.length > 6) {
      const err = new Error('Maximum 6 seats per booking transaction allowed.');
      err.statusCode = 400;
      throw err;
    }

    // Sort seat IDs consistently to avoid deadlock
    const sortedSeatIds = [...seatIds].sort();

    // 1. Acquire atomic Redis locks with NX (Not Exists) and TTL
    const acquiredLocks = [];
    let lockFailed = false;
    let failedSeatId = null;

    for (const seatId of sortedSeatIds) {
      const redisKey = `seat:hold:${seatId}`;
      const result = await redis.set(redisKey, userId, 'EX', this.HOLD_DURATION_SECONDS, 'NX');
      if (result === 'OK') {
        acquiredLocks.push(redisKey);
      } else {
        lockFailed = true;
        failedSeatId = seatId;
        break;
      }
    }

    // If any seat lock failed, rollback all acquired locks immediately!
    if (lockFailed) {
      for (const key of acquiredLocks) {
        await redis.del(key);
      }
      const err = new Error(`Seat ${failedSeatId} is currently held or being checked out by another user.`);
      err.statusCode = 409;
      err.code = 'SEAT_UNAVAILABLE';
      throw err;
    }

    // 2. Execute transactional validation and database hold record creation
    try {
      const holdId = `hold_${uuidv4().replace(/-/g, '')}`;
      const expiresAt = new Date(Date.now() + this.HOLD_DURATION_SECONDS * 1000).toISOString();

      const result = await db.transaction(async (client) => {
        // Query seat records
        const seatsRes = await client.query(
          'SELECT id, seat_row, seat_number, category, price, status FROM seats WHERE event_id = $1',
          [eventId]
        );

        const eventSeats = seatsRes.rows.filter(s => sortedSeatIds.includes(s.id));

        if (eventSeats.length !== sortedSeatIds.length) {
          throw new Error('One or more selected seats do not exist for this event.');
        }

        // Verify all seats are currently available in database
        for (const s of eventSeats) {
          if (s.status === 'booked') {
            const err = new Error(`Seat ${s.seat_row}${s.seat_number} has already been booked.`);
            err.statusCode = 409;
            throw err;
          }
          if (s.status === 'held') {
            // Check if active hold exists
            const existingHoldRes = await client.query(
              `SELECT id, user_id FROM seat_holds WHERE event_id = $1 AND status = 'active' AND expires_at > NOW()`,
              [eventId]
            );
            const otherHold = existingHoldRes.rows.find(h => {
              const ids = JSON.parse(h.seat_ids || '[]');
              return ids.includes(s.id) && h.user_id !== userId;
            });
            if (otherHold) {
              const err = new Error(`Seat ${s.seat_row}${s.seat_number} is currently held by another user.`);
              err.statusCode = 409;
              throw err;
            }
          }
        }

        // Insert seat hold record
        const nowIso = new Date().toISOString();
        await client.query(
          `INSERT INTO seat_holds (id, user_id, event_id, seat_ids, status, created_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [holdId, userId, eventId, JSON.stringify(sortedSeatIds), 'active', nowIso, expiresAt]
        );

        // Update seats status to 'held'
        for (const s of eventSeats) {
          await client.query('UPDATE seats SET status = $1, version = version + 1 WHERE id = $2', [
            'held',
            s.id
          ]);
        }

        const totalPrice = eventSeats.reduce((acc, s) => acc + parseFloat(s.price), 0);

        return {
          holdId,
          userId,
          eventId,
          seats: eventSeats,
          totalPrice,
          expiresAt,
          durationSeconds: this.HOLD_DURATION_SECONDS
        };
      });

      // 3. Broadcast real-time seat status update via Socket.IO
      if (io) {
        io.to(`event:${eventId}`).emit('seats:held', {
          seatIds: sortedSeatIds,
          holdId,
          expiresAt
        });
      }

      return result;
    } catch (err) {
      // Rollback Redis locks if database transaction fails
      for (const key of acquiredLocks) {
        await redis.del(key);
      }
      throw err;
    }
  }

  /**
   * Releases an active hold (e.g., cancelled by user or expired).
   */
  async releaseHold(holdId, eventId, io = null, reason = 'user_released') {
    const holdRes = await db.query('SELECT * FROM seat_holds WHERE id = $1', [holdId]);
    if (holdRes.rows.length === 0) return { success: false, message: 'Hold not found' };

    const hold = holdRes.rows[0];
    const seatIds = JSON.parse(hold.seat_ids || '[]');

    // 1. Remove Redis locks
    for (const seatId of seatIds) {
      await redis.del(`seat:hold:${seatId}`);
    }

    // 2. Update DB status
    await db.query(`UPDATE seat_holds SET status = 'released' WHERE id = $1`, [holdId]);

    for (const seatId of seatIds) {
      // Only set back to available if not already booked
      const s = await db.query('SELECT status FROM seats WHERE id = $1', [seatId]);
      if (s.rows.length > 0 && s.rows[0].status === 'held') {
        await db.query(`UPDATE seats SET status = 'available', version = version + 1 WHERE id = $1`, [seatId]);
      }
    }

    // 3. Broadcast real-time release
    if (io) {
      io.to(`event:${eventId || hold.event_id}`).emit('seats:released', {
        seatIds,
        holdId,
        reason
      });
    }

    return { success: true, releasedSeatIds: seatIds };
  }

  /**
   * Retrieves hold details and validates it is still active.
   */
  async getHoldDetails(holdId) {
    const holdRes = await db.query('SELECT * FROM seat_holds WHERE id = $1', [holdId]);
    if (holdRes.rows.length === 0) {
      const err = new Error('Seat hold reservation not found.');
      err.statusCode = 404;
      throw err;
    }

    const hold = holdRes.rows[0];
    const now = new Date();
    const expiresAt = new Date(hold.expires_at);

    if (hold.status !== 'active' || now > expiresAt) {
      const err = new Error('Your seat hold has expired. Please select your seats again.');
      err.statusCode = 410;
      err.code = 'HOLD_EXPIRED';
      throw err;
    }

    const seatIds = JSON.parse(hold.seat_ids || '[]');
    const seatsRes = await db.query('SELECT id, seat_row, seat_number, category, price FROM seats WHERE event_id = $1', [
      hold.event_id
    ]);
    const seats = seatsRes.rows.filter(s => seatIds.includes(s.id));
    const totalPrice = seats.reduce((acc, s) => acc + parseFloat(s.price), 0);

    return {
      holdId: hold.id,
      userId: hold.user_id,
      eventId: hold.event_id,
      seatIds,
      seats,
      totalPrice,
      expiresAt: hold.expires_at,
      remainingSeconds: Math.max(0, Math.ceil((expiresAt - now) / 1000))
    };
  }

  /**
   * Periodic background expiration cleaner.
   * Runs every 5 seconds to automatically free expired holds.
   */
  startExpirationWorker(io) {
    if (this.expirationWorkerInterval) clearInterval(this.expirationWorkerInterval);

    this.expirationWorkerInterval = setInterval(async () => {
      try {
        const holdsRes = await db.query(`SELECT * FROM seat_holds WHERE status = 'active'`);
        const now = new Date();

        for (const hold of holdsRes.rows) {
          const expiresAt = new Date(hold.expires_at);
          if (now >= expiresAt) {
            console.log(`[HoldWorker] Automatically releasing expired hold ${hold.id}`);
            const seatIds = JSON.parse(hold.seat_ids || '[]');

            // Clear Redis keys
            for (const seatId of seatIds) {
              await redis.del(`seat:hold:${seatId}`);
            }

            // Update hold in DB
            await db.query(`UPDATE seat_holds SET status = 'expired' WHERE id = $1`, [hold.id]);

            // Free seats in DB
            for (const seatId of seatIds) {
              const s = await db.query('SELECT status FROM seats WHERE id = $1', [seatId]);
              if (s.rows.length > 0 && s.rows[0].status === 'held') {
                await db.query(`UPDATE seats SET status = 'available', version = version + 1 WHERE id = $1`, [seatId]);
              }
            }

            // Broadcast real-time availability update
            if (io) {
              io.to(`event:${hold.event_id}`).emit('seats:released', {
                seatIds,
                holdId: hold.id,
                reason: 'expired'
              });
              io.to(`user:${hold.user_id}`).emit('hold:expired', {
                holdId: hold.id,
                message: 'Your seat reservation has expired and the seats have been released.'
              });
            }
          }
        }
      } catch (err) {
        console.warn('[HoldWorker] Expiration sweep warning:', err.message);
      }
    }, 5000);
  }
}

module.exports = new SeatHoldService();

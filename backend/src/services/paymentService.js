const { v4: uuidv4 } = require('uuid');
const redis = require('../config/redis');
const db = require('../config/db');
const seatHoldService = require('./seatHoldService');

class PaymentService {
  /**
   * Processes payment simulation with idempotency and atomic booking confirmation.
   */
  async confirmPayment({ userId, holdId, paymentMethod = 'Credit Card', idempotencyKey, simulationOutcome = 'success' }, io = null) {
    if (!holdId || !idempotencyKey) {
      const err = new Error('Missing holdId or idempotencyKey.');
      err.statusCode = 400;
      throw err;
    }

    // 1. Idempotency Check: prevent duplicate billing or duplicate bookings
    const existingPaymentRes = await db.query(
      'SELECT * FROM payments WHERE idempotency_key = $1',
      [idempotencyKey]
    );

    if (existingPaymentRes.rows.length > 0) {
      const existingPayment = existingPaymentRes.rows[0];
      if (existingPayment.status === 'successful' && existingPayment.booking_id) {
        console.log(`[Payment] Idempotent hit: returning existing booking for key ${idempotencyKey}`);
        const bookingRes = await db.query('SELECT * FROM bookings WHERE id = $1', [existingPayment.booking_id]);
        return {
          isDuplicate: true,
          booking: bookingRes.rows[0],
          payment: existingPayment
        };
      } else if (existingPayment.status === 'failed') {
        const err = new Error('This transaction previously failed. Please initiate a new payment attempt.');
        err.statusCode = 400;
        throw err;
      }
    }

    // 2. Validate Seat Hold Reservation
    const hold = await seatHoldService.getHoldDetails(holdId);

    if (hold.userId !== userId) {
      const err = new Error('Unauthorized. This seat hold belongs to another user.');
      err.statusCode = 403;
      throw err;
    }

    // 3. Handle Simulated Failures
    const paymentId = `pay_${uuidv4().replace(/-/g, '')}`;
    const transactionRef = `TXN_SURGE_${Date.now().toString().slice(-8)}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    if (simulationOutcome === 'failure') {
      await db.query(
        `INSERT INTO payments (id, user_id, amount, payment_method, idempotency_key, status, transaction_ref)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [paymentId, userId, hold.totalPrice, paymentMethod, idempotencyKey, 'failed', transactionRef]
      );

      const err = new Error('Simulated Payment Declined: Insufficient test funds or bank authorization declined.');
      err.statusCode = 402;
      err.code = 'PAYMENT_DECLINED';
      throw err;
    }

    if (simulationOutcome === 'cancelled') {
      await db.query(
        `INSERT INTO payments (id, user_id, amount, payment_method, idempotency_key, status, transaction_ref)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [paymentId, userId, hold.totalPrice, paymentMethod, idempotencyKey, 'cancelled', transactionRef]
      );

      const err = new Error('Payment process was cancelled.');
      err.statusCode = 400;
      err.code = 'PAYMENT_CANCELLED';
      throw err;
    }

    // 4. Atomic Booking & Seat Finalization Transaction
    const bookingId = `bk_${uuidv4().replace(/-/g, '')}`;
    const randomSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
    const bookingReference = `SURGE-${randomSuffix}`;
    const qrPayload = `SEATSURGE:TICKET:${bookingReference}:${hold.eventId}:${hold.seatIds.join(',')}:${Date.now()}`;

    const confirmationResult = await db.transaction(async (client) => {
      // Re-verify hold status inside transaction
      const currentHoldRes = await client.query('SELECT status FROM seat_holds WHERE id = $1', [holdId]);
      if (currentHoldRes.rows.length === 0 || currentHoldRes.rows[0].status !== 'active') {
        const err = new Error('Hold has already been converted, released or expired.');
        err.statusCode = 410;
        throw err;
      }

      // Check none of the seats are booked
      const seatsRes = await client.query(
        'SELECT id, seat_row, seat_number, status, price FROM seats WHERE event_id = $1',
        [hold.eventId]
      );
      const heldSeats = seatsRes.rows.filter(s => hold.seatIds.includes(s.id));

      for (const s of heldSeats) {
        if (s.status === 'booked') {
          const err = new Error(`Double-booking prevented: Seat ${s.seat_row}${s.seat_number} is already booked.`);
          err.statusCode = 409;
          throw err;
        }
      }

      // A. Create Booking
      await client.query(
        `INSERT INTO bookings (id, booking_reference, user_id, event_id, total_amount, status, qr_code_ref)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [bookingId, bookingReference, userId, hold.eventId, hold.totalPrice, 'confirmed', qrPayload]
      );

      // B. Create BookingSeats entries
      for (const s of heldSeats) {
        await client.query(
          `INSERT INTO booking_seats (id, booking_id, seat_id, price_at_booking)
           VALUES ($1, $2, $3, $4)`,
          [`bs_${uuidv4().replace(/-/g, '')}`, bookingId, s.id, parseFloat(s.price)]
        );
      }

      // C. Update seats to 'booked'
      for (const s of heldSeats) {
        await client.query(
          `UPDATE seats SET status = 'booked', version = version + 1 WHERE id = $1`,
          [s.id]
        );
      }

      // D. Mark seat hold as 'converted'
      await client.query(`UPDATE seat_holds SET status = 'converted' WHERE id = $1`, [holdId]);

      // E. Create successful payment record
      await client.query(
        `INSERT INTO payments (id, booking_id, user_id, amount, payment_method, idempotency_key, status, transaction_ref)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [paymentId, bookingId, userId, hold.totalPrice, paymentMethod, idempotencyKey, 'successful', transactionRef]
      );

      // F. Fetch event details for rich confirmation receipt
      const eventRes = await client.query('SELECT title, venue, event_date FROM events WHERE id = $1', [hold.eventId]);
      const eventData = eventRes.rows[0] || {};

      return {
        bookingId,
        bookingReference,
        userId,
        eventId: hold.eventId,
        eventTitle: eventData.title,
        venue: eventData.venue,
        eventDate: eventData.event_date,
        seats: heldSeats.map(s => ({
          id: s.id,
          label: `${s.seat_row}${s.seat_number}`,
          row: s.seat_row,
          number: s.seat_number,
          price: s.price
        })),
        totalAmount: hold.totalPrice,
        paymentStatus: 'successful',
        transactionRef,
        paymentMethod,
        qrCodeRef: qrPayload,
        confirmedAt: new Date().toISOString()
      };
    });

    // 5. Clean up Redis seat holds
    for (const seatId of hold.seatIds) {
      await redis.del(`seat:hold:${seatId}`);
    }

    // 6. Broadcast real-time booking confirmation to all clients
    if (io) {
      io.to(`event:${hold.eventId}`).emit('seats:booked', {
        seatIds: hold.seatIds,
        bookingReference,
        eventId: hold.eventId
      });

      // Notify admin dashboard
      io.to('admin').emit('admin:new_booking', {
        bookingReference,
        amount: hold.totalPrice,
        seatsCount: hold.seatIds.length,
        timestamp: new Date().toISOString()
      });
    }

    return confirmationResult;
  }
}

module.exports = new PaymentService();

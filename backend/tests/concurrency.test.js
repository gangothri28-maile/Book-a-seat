const assert = require('assert');
const seatHoldService = require('../src/services/seatHoldService');
const paymentService = require('../src/services/paymentService');
const db = require('../src/config/db');
const redis = require('../src/config/redis');

async function runConcurrencyTest() {
  console.log('===============================================================');
  console.log('🧪 RUNNING TEST: High-Concurrency Double-Booking Prevention');
  console.log('===============================================================');

  const eventId = 'evt_symphony_2026';
  const targetSeatId = 'seat_c_5';
  const userA = 'usr_cust_001'; // Alice
  const userB = 'usr_cust_002'; // Bob

  // Ensure target seat is available before starting
  await redis.del(`seat:hold:${targetSeatId}`);
  await db.query(`UPDATE seats SET status = 'available' WHERE id = $1`, [targetSeatId]);
  await db.query(`UPDATE seat_holds SET status = 'released' WHERE event_id = $1`, [eventId]);
  // Clean up any previous test booking for this specific test seat
  const rawStore = db.getRawStore();
  if (rawStore && rawStore.booking_seats) {
    rawStore.booking_seats = rawStore.booking_seats.filter(bs => bs.seat_id !== targetSeatId);
  }

  console.log(`[Test] Target seat: ${targetSeatId}`);
  console.log(`[Test] Launching 2 simultaneous hold requests for the exact same seat...`);

  const results = await Promise.allSettled([
    seatHoldService.holdSeats(userA, eventId, [targetSeatId]),
    seatHoldService.holdSeats(userB, eventId, [targetSeatId])
  ]);

  const successes = results.filter(r => r.status === 'fulfilled');
  const rejections = results.filter(r => r.status === 'rejected');

  console.log(`[Test] Successful hold count: ${successes.length}`);
  console.log(`[Test] Rejected count: ${rejections.length}`);

  // Assertion 1: Exactly one user obtains the hold
  assert.strictEqual(successes.length, 1, 'CRITICAL: Exactly one user must succeed in holding the seat.');
  assert.strictEqual(rejections.length, 1, 'CRITICAL: The other concurrent user must be rejected.');

  const winningHold = successes[0].value;
  const losingReason = rejections[0].reason;

  console.log(`[Test] 🏆 Winner: User ${winningHold.userId} secured hold ${winningHold.holdId}`);
  console.log(`[Test] 🛑 Rejection message: "${losingReason.message}" (Status ${losingReason.statusCode})`);

  assert.strictEqual(losingReason.statusCode, 409, 'Rejection should return HTTP 409 Conflict');

  // Assertion 2: Verify seat cannot be booked by the loser
  console.log(`[Test] Attempting payment confirmation by unauthorized user...`);
  try {
    await paymentService.confirmPayment({
      userId: userB,
      holdId: winningHold.holdId,
      idempotencyKey: 'idemp_test_unauth_001'
    });
    assert.fail('Unauthorized user should NOT be able to confirm someone else’s hold!');
  } catch (err) {
    console.log(`[Test] ✅ Unauthorized booking blocked: "${err.message}" (Status ${err.statusCode})`);
    assert.strictEqual(err.statusCode, 403, 'Should reject with 403 Forbidden');
  }

  // Assertion 3: Confirm payment by the legitimate holder
  const testIdempKey = `idemp_test_winner_${Date.now()}`;
  console.log(`[Test] Confirming payment for legitimate winner User ${winningHold.userId}...`);
  const confirmation = await paymentService.confirmPayment({
    userId: winningHold.userId,
    holdId: winningHold.holdId,
    idempotencyKey: testIdempKey
  });

  assert.strictEqual(confirmation.paymentStatus, 'successful');
  assert.ok(confirmation.bookingReference.startsWith('SURGE-'));
  console.log(`[Test] ✅ Booking confirmed! Reference: ${confirmation.bookingReference}`);

  // Assertion 4: Verify seat status is now 'booked'
  const seatCheck = await db.query('SELECT status FROM seats WHERE id = $1', [targetSeatId]);
  assert.strictEqual(seatCheck.rows[0].status, 'booked', 'Seat status must be booked');

  // Assertion 5: Verify idempotency - replay same payment request returns same booking
  const replayResult = await paymentService.confirmPayment({
    userId: winningHold.userId,
    holdId: winningHold.holdId,
    idempotencyKey: testIdempKey
  });
  assert.strictEqual(replayResult.isDuplicate, true, 'Idempotent hit should be detected');
  assert.strictEqual(replayResult.booking.id, confirmation.bookingId);
  console.log(`[Test] ✅ Idempotency verified: duplicate payment prevented, existing booking returned.`);

  console.log('===============================================================');
  console.log('🎉 ALL CONCURRENCY AND DOUBLE-BOOKING TESTS PASSED!');
  console.log('===============================================================');
}

if (require.main === module) {
  runConcurrencyTest()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('❌ Test failed:', err);
      process.exit(1);
    });
}

module.exports = runConcurrencyTest;

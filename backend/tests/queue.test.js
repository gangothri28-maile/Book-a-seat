const assert = require('assert');
const queueService = require('../src/services/queueService');
const redis = require('../src/config/redis');

async function runQueueTest() {
  console.log('===============================================================');
  console.log('🧪 RUNNING TEST: Virtual Waiting Room & FIFO Queue Management');
  console.log('===============================================================');

  const eventId = 'evt_test_queue';
  await redis.del(`queue:list:${eventId}`);

  // Clean any active admission tokens for test users
  for (let i = 1; i <= 10; i++) {
    await redis.del(`queue:session:sess_u${i}:${eventId}`);
  }

  // Artificially saturate active users to simulate flash-sale capacity
  for (let i = 1; i <= 5; i++) {
    await redis.set(`queue:admitted:test_adm_${i}`, '1', 'EX', 300);
  }

  console.log('[Test] Simulated room at maximum capacity (5 active users).');
  console.log('[Test] Enqueuing new incoming flash-sale users...');

  // Users joining full room must be placed in FIFO waiting queue
  const user1 = await queueService.joinQueue('sess_u1', eventId, 'user_1');
  const user2 = await queueService.joinQueue('sess_u2', eventId, 'user_2');
  const user3 = await queueService.joinQueue('sess_u3', eventId, 'user_3');

  console.log(`[Test] User 1 status: ${user1.status}, pos: #${user1.position}`);
  console.log(`[Test] User 2 status: ${user2.status}, pos: #${user2.position}`);
  console.log(`[Test] User 3 status: ${user3.status}, pos: #${user3.position}`);

  assert.strictEqual(user1.position, 1, 'First user in queue must be at position #1');
  assert.strictEqual(user2.position, 2, 'Second user in queue must be at position #2');
  assert.strictEqual(user3.position, 3, 'Third user in queue must be at position #3');

  // Test Duplicate join returns same position
  const user2Dup = await queueService.joinQueue('sess_u2', eventId, 'user_2');
  assert.strictEqual(user2Dup.position, 2, 'Duplicate session join must return same position #2');
  console.log('[Test] ✅ Duplicate queue entry prevented: returned position #2.');

  // Test Leaving queue
  await queueService.leaveQueue('sess_u3', eventId);
  const leftStatus = await queueService.getQueueStatus('sess_u3', eventId);
  assert.strictEqual(leftStatus.status, 'not_in_queue');
  console.log('[Test] ✅ Leave queue verified: sess_u3 status is not_in_queue.');

  // Cleanup test tokens
  for (let i = 1; i <= 5; i++) {
    await redis.del(`queue:admitted:test_adm_${i}`);
  }
  await redis.del(`queue:list:${eventId}`);

  console.log('===============================================================');
  console.log('🎉 ALL QUEUE TESTS PASSED!');
  console.log('===============================================================');
}

if (require.main === module) {
  runQueueTest()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('❌ Queue test failed:', err);
      process.exit(1);
    });
}

module.exports = runQueueTest;

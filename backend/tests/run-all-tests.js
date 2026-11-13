const runConcurrencyTest = require('./concurrency.test');
const runQueueTest = require('./queue.test');
const runBotTest = require('./bot.test');

async function runAll() {
  console.log('\n===============================================================');
  console.log('⚡ SEATSURGE COMPREHENSIVE AUTOMATED TEST SUITE');
  console.log('===============================================================\n');

  try {
    await runConcurrencyTest();
    console.log('\n');
    await runQueueTest();
    console.log('\n');
    await runBotTest();
    console.log('\n');
    console.log('===============================================================');
    console.log('🌟 ALL TEST SUITES COMPLETED WITH 100% SUCCESS!');
    console.log('===============================================================\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ TEST SUITE FAILED:', err);
    process.exit(1);
  }
}

runAll();

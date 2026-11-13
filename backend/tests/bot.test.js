const assert = require('assert');
const botDetectionEngine = require('../src/bot-detection/botDetectionEngine');

async function runBotTest() {
  console.log('===============================================================');
  console.log('🧪 RUNNING TEST: AI Behavioral Bot Detection & Risk Scoring');
  console.log('===============================================================');

  // Test 1: Normal human user telemetry
  console.log('[Test] Evaluating natural human browsing behavior...');
  const humanTelemetry = {
    sessionId: 'sess_human_001',
    mouseMoves: [
      { x: 100, y: 150, t: 100 },
      { x: 140, y: 175, t: 250 },
      { x: 190, y: 220, t: 420 },
      { x: 250, y: 270, t: 610 },
      { x: 310, y: 310, t: 830 },
      { x: 380, y: 340, t: 1050 }
    ],
    clickIntervals: [350, 480, 620, 410],
    formFillDurationMs: 3800,
    pageLoadDurationMs: 2500,
    isKeyboardUser: false,
    isTouchDevice: false
  };

  const humanAssessment = await botDetectionEngine.evaluateSession(humanTelemetry);
  console.log(`[Test] Human Risk Score: ${humanAssessment.risk_score} / 100 (${humanAssessment.risk_category})`);
  console.log(`[Test] Action taken: ${humanAssessment.action_taken}`);
  assert.ok(humanAssessment.risk_score <= 30, 'Normal human behavior must score in Low Risk (<= 30)');
  assert.strictEqual(humanAssessment.action_taken, 'ALLOW');
  console.log('[Test] ✅ Normal human traffic allowed with Low Risk category.');

  // Test 2: Scripted Bot with superhuman speed and linear mouse trajectory
  console.log('[Test] Evaluating scripted high-speed bot behavior...');
  const botTelemetry = {
    sessionId: 'sess_bot_script_999',
    mouseMoves: [
      { x: 0, y: 0, t: 10 },
      { x: 20, y: 20, t: 20 },
      { x: 40, y: 40, t: 30 },
      { x: 60, y: 60, t: 40 },
      { x: 80, y: 80, t: 50 },
      { x: 100, y: 100, t: 60 },
      { x: 120, y: 120, t: 70 }
    ], // Perfectly linear diagonal line
    clickIntervals: [25, 30, 28, 26], // Superhuman click cadence (< 50ms)
    formFillDurationMs: 80, // Instant form injection (80ms)
    pageLoadDurationMs: 150
  };

  // Hammer requests
  for (let i = 0; i < 45; i++) {
    botDetectionEngine.recordRequest('sess_bot_script_999');
  }
  for (let i = 0; i < 5; i++) {
    botDetectionEngine.recordHoldAttempt('sess_bot_script_999');
  }

  const botAssessment = await botDetectionEngine.evaluateSession(botTelemetry);
  console.log(`[Test] Bot Risk Score: ${botAssessment.risk_score} / 100 (${botAssessment.risk_category})`);
  console.log(`[Test] Explainable Signals Detected (${botAssessment.explainable_signals.length}):`);
  botAssessment.explainable_signals.forEach(s => {
    console.log(`       - [${s.signal}] (+${s.weight} pts): ${s.description}`);
  });
  console.log(`[Test] Action taken: ${botAssessment.action_taken}`);

  assert.ok(botAssessment.risk_score >= 60, 'Bot behavior must score High or Critical (>= 60)');
  assert.ok(botAssessment.explainable_signals.length >= 3, 'Must detect at least 3 behavioral signals');
  console.log('[Test] ✅ Scripted bot accurately detected with explainable risk breakdown.');

  console.log('===============================================================');
  console.log('🎉 ALL BOT DETECTION TESTS PASSED!');
  console.log('===============================================================');
}

if (require.main === module) {
  runBotTest()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('❌ Bot test failed:', err);
      process.exit(1);
    });
}

module.exports = runBotTest;

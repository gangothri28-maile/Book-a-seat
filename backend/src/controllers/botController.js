const botDetectionEngine = require('../bot-detection/botDetectionEngine');

exports.submitTelemetry = async (req, res) => {
  try {
    const {
      sessionId,
      mouseMoves,
      clickIntervals,
      formFillDurationMs,
      isKeyboardUser,
      isTouchDevice,
      pageLoadDurationMs
    } = req.body;

    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'Session ID is required.' });
    }

    const userId = req.user ? req.user.id : null;
    const assessment = await botDetectionEngine.evaluateSession({
      sessionId,
      userId,
      mouseMoves,
      clickIntervals,
      formFillDurationMs,
      isKeyboardUser,
      isTouchDevice,
      pageLoadDurationMs
    });

    const io = req.app.get('io');
    if (io && (assessment.risk_category === 'HIGH' || assessment.risk_category === 'CRITICAL')) {
      io.to('admin').emit('admin:bot_alert', {
        sessionId: assessment.session_id,
        riskScore: assessment.risk_score,
        riskCategory: assessment.risk_category,
        actionTaken: assessment.action_taken,
        signals: assessment.explainable_signals,
        timestamp: assessment.created_at
      });
    }

    return res.json({
      success: true,
      assessment
    });
  } catch (err) {
    console.error('[BotController] Telemetry error:', err);
    return res.status(500).json({ success: false, error: 'Failed to evaluate behavioral telemetry.' });
  }
};

exports.verifyChallenge = async (req, res) => {
  try {
    const { sessionId, answer, expectedSum } = req.body;

    if (!sessionId || answer === undefined || expectedSum === undefined) {
      return res.status(400).json({ success: false, error: 'Missing challenge verification parameters.' });
    }

    if (parseInt(answer, 10) === parseInt(expectedSum, 10)) {
      botDetectionEngine.markChallengeSolved(sessionId);
      return res.json({
        success: true,
        message: 'Human verification successful. Normal access restored.',
        verified: true
      });
    } else {
      return res.status(400).json({
        success: false,
        verified: false,
        error: 'Incorrect math challenge response. Please try again.'
      });
    }
  } catch (err) {
    console.error('[BotController] Challenge verification error:', err);
    return res.status(500).json({ success: false, error: 'Verification failed.' });
  }
};

exports.getStatus = async (req, res) => {
  try {
    const { sessionId } = req.query;
    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'Session ID is required.' });
    }

    const isBlocked = botDetectionEngine.isSessionBlocked(sessionId);
    const record = botDetectionEngine._getSessionRecord(sessionId);

    return res.json({
      success: true,
      sessionId,
      isBlocked,
      challengeSolved: record.challengeSolved,
      lastAssessment: record.lastAssessment
    });
  } catch (err) {
    console.error('[BotController] GetStatus error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve bot status.' });
  }
};

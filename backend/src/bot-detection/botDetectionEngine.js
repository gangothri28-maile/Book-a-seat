const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');

// In-memory session tracking for rate & velocity metrics
const sessionStats = new Map();

class BotDetectionEngine {
  constructor() {
    this.CHALLENGE_THRESHOLD = 60;
    this.BLOCK_THRESHOLD = 80;
  }

  _getSessionRecord(sessionId) {
    if (!sessionStats.has(sessionId)) {
      sessionStats.set(sessionId, {
        requests: [],
        holdAttempts: [],
        createdAt: Date.now(),
        isBlocked: false,
        challengeSolved: false,
        lastAssessment: null
      });
    }
    return sessionStats.get(sessionId);
  }

  recordRequest(sessionId) {
    const record = this._getSessionRecord(sessionId);
    const now = Date.now();
    record.requests.push(now);
    // Keep last 60 seconds of requests
    record.requests = record.requests.filter(t => now - t < 60000);
  }

  recordHoldAttempt(sessionId) {
    const record = this._getSessionRecord(sessionId);
    const now = Date.now();
    record.holdAttempts.push(now);
    // Keep last 15 seconds
    record.holdAttempts = record.holdAttempts.filter(t => now - t < 15000);
  }

  isSessionBlocked(sessionId) {
    const record = this._getSessionRecord(sessionId);
    return record.isBlocked;
  }

  setSessionBlocked(sessionId, blocked = true) {
    const record = this._getSessionRecord(sessionId);
    record.isBlocked = blocked;
  }

  markChallengeSolved(sessionId) {
    const record = this._getSessionRecord(sessionId);
    record.challengeSolved = true;
    if (record.lastAssessment) {
      record.lastAssessment.risk_score = Math.max(0, record.lastAssessment.risk_score - 40);
      record.lastAssessment.risk_category = 'LOW';
      record.lastAssessment.action_taken = 'ALLOW';
    }
  }

  /**
   * Evaluates behavioral signals and computes an explainable risk score (0-100).
   */
  async evaluateSession(telemetry) {
    const {
      sessionId,
      userId = null,
      mouseMoves = [],
      clickIntervals = [],
      formFillDurationMs = null,
      isKeyboardUser = false,
      isTouchDevice = false,
      pageLoadDurationMs = null
    } = telemetry;

    const record = this._getSessionRecord(sessionId);
    this.recordRequest(sessionId);

    const now = Date.now();
    const signals = [];
    let riskScore = 0;

    // 1. Evaluate Request Frequency
    const reqCountLast30s = record.requests.filter(t => now - t < 30000).length;
    if (reqCountLast30s > 40) {
      signals.push({
        signal: 'EXTREME_REQUEST_BURST',
        weight: 35,
        description: `Extreme request rate: ${reqCountLast30s} requests in 30 seconds (expected human max < 15)`
      });
      riskScore += 35;
    } else if (reqCountLast30s > 20) {
      signals.push({
        signal: 'HIGH_REQUEST_FREQUENCY',
        weight: 20,
        description: `High request rate: ${reqCountLast30s} requests in 30 seconds`
      });
      riskScore += 20;
    }

    // 2. Evaluate Repeated Hold Attempts (Seat Hammering)
    const holdAttemptsLast10s = record.holdAttempts.filter(t => now - t < 10000).length;
    if (holdAttemptsLast10s >= 4) {
      signals.push({
        signal: 'SEAT_HOLD_HAMMERING',
        weight: 30,
        description: `Rapid repeated seat hold attempts: ${holdAttemptsLast10s} calls within 10 seconds`
      });
      riskScore += 30;
    }

    // 3. Evaluate Mouse Dynamics (only for non-touch, non-keyboard users)
    if (!isTouchDevice && !isKeyboardUser) {
      if (!mouseMoves || mouseMoves.length === 0) {
        // If interaction happened with zero cursor movement on desktop
        signals.push({
          signal: 'ZERO_CURSOR_TRAJECTORY',
          weight: 25,
          description: 'No mouse trajectory detected prior to interaction on desktop environment'
        });
        riskScore += 25;
      } else if (mouseMoves.length >= 6) {
        // Calculate Linearity & Curvature
        // Straight-line bots have perfectly consistent coordinate steps (dx/dy constant)
        let totalDistance = 0;
        let linearDistance = 0;
        const first = mouseMoves[0];
        const last = mouseMoves[mouseMoves.length - 1];

        linearDistance = Math.hypot(last.x - first.x, last.y - first.y);

        for (let i = 1; i < mouseMoves.length; i++) {
          totalDistance += Math.hypot(
            mouseMoves[i].x - mouseMoves[i - 1].x,
            mouseMoves[i].y - mouseMoves[i - 1].y
          );
        }

        // Ratio of total path distance to direct Euclidean distance
        const tortuosity = linearDistance > 0 ? totalDistance / linearDistance : 1;

        if (tortuosity < 1.01 && linearDistance > 100) {
          signals.push({
            signal: 'UNNATURAL_LINEAR_CURSOR',
            weight: 25,
            description: `Unnatural linear cursor trajectory (tortuosity ratio ${tortuosity.toFixed(3)}, perfectly straight line)`
          });
          riskScore += 25;
        }

        // Check for constant velocity steps (robotic step intervals)
        const speeds = [];
        for (let i = 1; i < mouseMoves.length; i++) {
          const dt = Math.max(1, (mouseMoves[i].t || 0) - (mouseMoves[i - 1].t || 0));
          const dist = Math.hypot(mouseMoves[i].x - mouseMoves[i - 1].x, mouseMoves[i].y - mouseMoves[i - 1].y);
          speeds.push(dist / dt);
        }

        if (speeds.length > 4) {
          const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
          const variance = speeds.reduce((a, b) => a + Math.pow(b - avgSpeed, 2), 0) / speeds.length;
          const stdDev = Math.sqrt(variance);

          if (stdDev < 0.05 && avgSpeed > 0.5) {
            signals.push({
              signal: 'CONSTANT_CURSOR_VELOCITY',
              weight: 20,
              description: `Robotic constant speed profile detected (standard deviation ${stdDev.toFixed(4)})`
            });
            riskScore += 20;
          }
        }
      }
    }

    // 4. Evaluate Click Cadence
    if (clickIntervals && clickIntervals.length >= 3) {
      const avgInterval = clickIntervals.reduce((a, b) => a + b, 0) / clickIntervals.length;
      if (avgInterval < 75) {
        signals.push({
          signal: 'SUPERHUMAN_CLICK_SPEED',
          weight: 30,
          description: `Average click interval of ${Math.round(avgInterval)}ms is beyond human physiological limits (< 100ms)`
        });
        riskScore += 30;
      } else {
        // Check metronomic click cadence
        const variance = clickIntervals.reduce((a, b) => a + Math.pow(b - avgInterval, 2), 0) / clickIntervals.length;
        const stdDev = Math.sqrt(variance);
        if (stdDev < 12 && clickIntervals.length >= 4) {
          signals.push({
            signal: 'METRONOMIC_CLICK_CADENCE',
            weight: 25,
            description: `Clockwork repetitive click timing with standard deviation of only ${stdDev.toFixed(1)}ms`
          });
          riskScore += 25;
        }
      }
    }

    // 5. Evaluate Form Interaction Timing
    if (formFillDurationMs !== null && formFillDurationMs !== undefined) {
      if (formFillDurationMs < 250) {
        signals.push({
          signal: 'SUPERHUMAN_FORM_FILL',
          weight: 35,
          description: `Form submitted in ${formFillDurationMs}ms (instant automated injection)`
        });
        riskScore += 35;
      } else if (formFillDurationMs < 600) {
        signals.push({
          signal: 'FAST_FORM_FILL',
          weight: 15,
          description: `Form submitted unusually rapidly in ${formFillDurationMs}ms`
        });
        riskScore += 15;
      }
    }

    // 6. Evaluate Navigation Velocity
    if (pageLoadDurationMs !== null && pageLoadDurationMs < 750) {
      signals.push({
        signal: 'INSTANT_NAVIGATION',
        weight: 15,
        description: `Direct action initiated in ${pageLoadDurationMs}ms from initial page render`
      });
      riskScore += 15;
    }

    // Cap score at 100
    riskScore = Math.min(100, Math.max(0, riskScore));

    // Determine Risk Category and Action
    let riskCategory = 'LOW';
    let actionTaken = 'ALLOW';

    if (riskScore >= this.BLOCK_THRESHOLD) {
      riskCategory = 'CRITICAL';
      actionTaken = 'RESTRICT_BLOCKED';
      record.isBlocked = true;
    } else if (riskScore >= this.CHALLENGE_THRESHOLD) {
      riskCategory = 'HIGH';
      actionTaken = record.challengeSolved ? 'ALLOW' : 'CHALLENGE_CAPTCHA';
    } else if (riskScore >= 31) {
      riskCategory = 'MEDIUM';
      actionTaken = 'MONITOR';
    }

    // If human verification challenge was solved earlier and no critical threat, allow
    if (record.challengeSolved && riskCategory !== 'CRITICAL') {
      actionTaken = 'ALLOW';
    }

    const assessment = {
      id: uuidv4(),
      session_id: sessionId,
      user_id: userId,
      risk_score: riskScore,
      risk_category: riskCategory,
      explainable_signals: signals,
      action_taken: actionTaken,
      created_at: new Date().toISOString()
    };

    record.lastAssessment = assessment;

    // Persist assessment to DB
    try {
      await db.query(
        `INSERT INTO bot_risk_assessments (id, session_id, user_id, risk_score, risk_category, explainable_signals, action_taken)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          assessment.id,
          assessment.session_id,
          assessment.user_id,
          assessment.risk_score,
          assessment.risk_category,
          JSON.stringify(assessment.explainable_signals),
          assessment.action_taken
        ]
      );
    } catch (err) {
      console.warn('[BotEngine] Error saving assessment to DB:', err.message);
    }

    return assessment;
  }
}

module.exports = new BotDetectionEngine();

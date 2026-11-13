const queueService = require('../services/queueService');
const botDetectionEngine = require('../bot-detection/botDetectionEngine');

exports.joinQueue = async (req, res) => {
  try {
    const { sessionId, eventId } = req.body;
    const userId = req.user ? req.user.id : null;

    if (!sessionId || !eventId) {
      return res.status(400).json({ success: false, error: 'Session ID and Event ID are required.' });
    }

    if (botDetectionEngine.isSessionBlocked(sessionId)) {
      return res.status(403).json({
        success: false,
        error: 'Your session has been restricted due to suspicious automated activity.'
      });
    }

    const result = await queueService.joinQueue(sessionId, eventId, userId);
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[Queue] JoinQueue error:', err);
    return res.status(500).json({ success: false, error: 'Failed to join virtual waiting room.' });
  }
};

exports.getQueueStatus = async (req, res) => {
  try {
    const { sessionId, eventId } = req.query;

    if (!sessionId || !eventId) {
      return res.status(400).json({ success: false, error: 'Session ID and Event ID are required in query params.' });
    }

    const result = await queueService.getQueueStatus(sessionId, eventId);
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[Queue] GetQueueStatus error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch queue status.' });
  }
};

exports.leaveQueue = async (req, res) => {
  try {
    const { sessionId, eventId } = req.body;
    if (!sessionId || !eventId) {
      return res.status(400).json({ success: false, error: 'Session ID and Event ID are required.' });
    }

    await queueService.leaveQueue(sessionId, eventId);
    return res.json({ success: true, message: 'Successfully left waiting room.' });
  } catch (err) {
    console.error('[Queue] LeaveQueue error:', err);
    return res.status(500).json({ success: false, error: 'Failed to leave queue.' });
  }
};

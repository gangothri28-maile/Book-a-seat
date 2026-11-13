const { v4: uuidv4 } = require('uuid');
const redis = require('../config/redis');
const db = require('../config/db');
const env = require('../config/env');

class QueueService {
  constructor() {
    this.sequenceCounter = 1000;
    this.activeAdmitted = new Map(); // token -> { sessionId, eventId, expiresAt }
  }

  async joinQueue(sessionId, eventId, userId = null) {
    const listKey = `queue:list:${eventId}`;
    const tokenKey = `queue:session:${sessionId}:${eventId}`;

    // 1. Check if session already has an active admission token
    const existingToken = await redis.get(tokenKey);
    if (existingToken) {
      return {
        status: 'access_granted',
        admissionToken: existingToken,
        position: 0,
        totalInQueue: 0,
        estimatedWaitSeconds: 0,
        message: 'Access already granted to booking room.'
      };
    }

    // 2. Check if already in queue list
    const items = await redis.lrange(listKey, 0, -1);
    const existingIndex = items.indexOf(sessionId);

    if (existingIndex !== -1) {
      const position = existingIndex + 1;
      const totalInQueue = items.length;
      const status = position <= 2 ? 'turn_approaching' : 'waiting';
      const estimatedWaitSeconds = Math.max(5, position * 6);

      return {
        status,
        position,
        totalInQueue,
        estimatedWaitSeconds,
        admissionToken: null,
        message: `You are in line at position #${position}`
      };
    }

    // 3. New queue entry
    this.sequenceCounter++;
    const sequenceNumber = this.sequenceCounter;

    // Check currently active users in booking room
    const currentActiveUsers = await this.getActiveUserCount(eventId);

    // If queue is empty and room is under capacity, admit immediately!
    if (items.length === 0 && currentActiveUsers < env.QUEUE_MAX_CONCURRENT_USERS) {
      const admissionToken = `adm_${uuidv4().replace(/-/g, '')}`;
      await this._grantAdmission(sessionId, eventId, userId, admissionToken, sequenceNumber);

      return {
        status: 'access_granted',
        admissionToken,
        position: 0,
        totalInQueue: 0,
        estimatedWaitSeconds: 0,
        message: 'Access granted! You may proceed to select seats.'
      };
    }

    // Otherwise, append to FIFO list
    await redis.rpush(listKey, sessionId);
    const totalInQueue = items.length + 1;
    const position = totalInQueue;
    const status = position <= 2 ? 'turn_approaching' : 'waiting';
    const estimatedWaitSeconds = position * 6;

    // Persist entry to DB
    const entryId = uuidv4();
    try {
      await db.query(
        `INSERT INTO queue_entries (id, session_id, user_id, event_id, sequence_number, status)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [entryId, sessionId, userId, eventId, sequenceNumber, status]
      );
    } catch (e) {
      // ignore constraint error if already logged
    }

    return {
      status,
      position,
      totalInQueue,
      estimatedWaitSeconds,
      admissionToken: null,
      message: `Joined queue at position #${position}`
    };
  }

  async getQueueStatus(sessionId, eventId) {
    const tokenKey = `queue:session:${sessionId}:${eventId}`;
    const token = await redis.get(tokenKey);

    if (token) {
      return {
        status: 'access_granted',
        admissionToken: token,
        position: 0,
        totalInQueue: 0,
        estimatedWaitSeconds: 0
      };
    }

    const listKey = `queue:list:${eventId}`;
    const items = await redis.lrange(listKey, 0, -1);
    const index = items.indexOf(sessionId);

    if (index === -1) {
      return {
        status: 'not_in_queue',
        position: null,
        totalInQueue: items.length,
        estimatedWaitSeconds: null,
        admissionToken: null
      };
    }

    const position = index + 1;
    const status = position <= 2 ? 'turn_approaching' : 'waiting';

    return {
      status,
      position,
      totalInQueue: items.length,
      estimatedWaitSeconds: Math.max(5, position * 6),
      admissionToken: null
    };
  }

  async leaveQueue(sessionId, eventId) {
    const listKey = `queue:list:${eventId}`;
    await redis.lrem(listKey, 0, sessionId);

    const tokenKey = `queue:session:${sessionId}:${eventId}`;
    const token = await redis.get(tokenKey);
    if (token) {
      await redis.del(`queue:admitted:${token}`);
      await redis.del(tokenKey);
    }

    try {
      await db.query('UPDATE queue_entries SET status = $1 WHERE session_id = $2 AND event_id = $3', [
        'removed',
        sessionId,
        eventId
      ]);
    } catch (e) {}
    return { success: true };
  }

  async validateAdmissionToken(admissionToken) {
    if (!admissionToken) return false;
    const key = `queue:admitted:${admissionToken}`;
    const sessionData = await redis.get(key);
    return !!sessionData;
  }

  async getActiveUserCount(eventId) {
    const activeKeys = await redis.keys('queue:admitted:*');
    return activeKeys.length;
  }

  async _grantAdmission(sessionId, eventId, userId, token, seqNum = 1) {
    const ttlSeconds = 600; // 10 minutes access
    await redis.set(`queue:admitted:${token}`, JSON.stringify({ sessionId, eventId, userId }), 'EX', ttlSeconds);
    await redis.set(`queue:session:${sessionId}:${eventId}`, token, 'EX', ttlSeconds);

    try {
      await db.query(
        `UPDATE queue_entries
         SET status = 'access_granted', admission_token = $1, admitted_at = NOW(), expires_at = NOW() + INTERVAL '10 minutes'
         WHERE session_id = $2 AND event_id = $3`,
        [token, sessionId, eventId]
      );
    } catch (e) {}
  }

  /**
   * Admission scheduler: admits queued users into the booking room as capacity allows.
   */
  async processAdmission(eventId, io) {
    const listKey = `queue:list:${eventId}`;
    const currentActive = await this.getActiveUserCount(eventId);
    const capacity = env.QUEUE_MAX_CONCURRENT_USERS;
    const availableSlots = Math.max(0, capacity - currentActive);

    if (availableSlots <= 0) return;

    const toAdmitCount = Math.min(availableSlots, env.QUEUE_ADMISSION_BATCH_SIZE);

    for (let i = 0; i < toAdmitCount; i++) {
      const sessionId = await redis.lpop(listKey);
      if (!sessionId) break;

      const admissionToken = `adm_${uuidv4().replace(/-/g, '')}`;
      await this._grantAdmission(sessionId, eventId, null, admissionToken);

      console.log(`[Queue] Admitted session ${sessionId} with token ${admissionToken}`);

      if (io) {
        // Direct event to admitted user
        io.to(`queue:${sessionId}`).emit('queue:access_granted', {
          sessionId,
          admissionToken,
          message: 'Your turn has arrived! Access granted to the seat selection arena.'
        });
      }
    }

    // Broadcast updated positions to all remaining sessions in the queue
    if (io) {
      const remaining = await redis.lrange(listKey, 0, -1);
      remaining.forEach((sid, idx) => {
        const position = idx + 1;
        const status = position <= 2 ? 'turn_approaching' : 'waiting';
        io.to(`queue:${sid}`).emit('queue:update', {
          position,
          totalInQueue: remaining.length,
          status,
          estimatedWaitSeconds: Math.max(5, position * 6)
        });
      });
    }
  }
}

module.exports = new QueueService();

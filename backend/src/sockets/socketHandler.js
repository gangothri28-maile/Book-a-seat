const queueService = require('../services/queueService');

function setupSocketIO(io) {
  io.on('connection', (socket) => {
    // 1. Join Event Room for live seat map updates
    socket.on('join:event', ({ eventId }) => {
      if (eventId) {
        socket.join(`event:${eventId}`);
      }
    });

    socket.on('leave:event', ({ eventId }) => {
      if (eventId) {
        socket.leave(`event:${eventId}`);
      }
    });

    // 2. Join Queue Room for personalized FIFO position updates
    socket.on('join:queue', ({ sessionId }) => {
      if (sessionId) {
        socket.join(`queue:${sessionId}`);
      }
    });

    socket.on('leave:queue', ({ sessionId }) => {
      if (sessionId) {
        socket.leave(`queue:${sessionId}`);
      }
    });

    // 3. User channel for personal hold notifications
    socket.on('join:user', ({ userId }) => {
      if (userId) {
        socket.join(`user:${userId}`);
      }
    });

    // 4. Admin room for real-time dashboard monitoring
    socket.on('join:admin', () => {
      socket.join('admin');
    });

    socket.on('disconnect', () => {
      // socket disconnected
    });
  });

  console.log('[Socket.IO] Real-time engine ready for live seats, queue and admin events.');
}

module.exports = setupSocketIO;

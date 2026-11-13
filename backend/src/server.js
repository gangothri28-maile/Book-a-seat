const http = require('http');
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Server } = require('socket.io');

const env = require('./config/env');
const db = require('./config/db');
const redis = require('./config/redis');
const rateLimiter = require('./middleware/rateLimiter');
const setupSocketIO = require('./sockets/socketHandler');

const seatHoldService = require('./services/seatHoldService');
const queueService = require('./services/queueService');

// Route Imports
const authRoutes = require('./routes/auth');
const eventRoutes = require('./routes/event');
const queueRoutes = require('./routes/queue');
const seatRoutes = require('./routes/seats');
const paymentRoutes = require('./routes/payment');
const bookingRoutes = require('./routes/bookings');
const botRoutes = require('./routes/bot');
const adminRoutes = require('./routes/admin');

const app = express();
const server = http.createServer(app);

// Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Attach io instance to express app
app.set('io', io);

// Setup Socket.IO event listeners
setupSocketIO(io);

// Core Middlewares
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(rateLimiter({ windowMs: 60000, maxRequests: 200 }));

// Health Check API
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'SeatSurge - Flash-Sale Ticketing Platform',
    timestamp: new Date().toISOString(),
    database: db.getEngine(),
    redis: 'ready'
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/queue', queueRoutes);
app.use('/api/seats', seatRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/bot', botRoutes);
app.use('/api/admin', adminRoutes);

// Serve Frontend single index.html
const frontendDir = path.resolve(__dirname, '../../frontend');
app.use(express.static(frontendDir));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, error: 'Endpoint not found.' });
  }
  res.sendFile(path.join(frontendDir, 'index.html'));
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[ServerError]', err);
  const status = err.statusCode || 500;
  res.status(status).json({
    success: false,
    error: err.message || 'Internal server error occurred.',
    code: err.code || 'SERVER_ERROR'
  });
});

// Start Background Workers
seatHoldService.startExpirationWorker(io);

// Periodic Queue Admission Controller
const admissionInterval = setInterval(() => {
  queueService.processAdmission('evt_symphony_2026', io).catch(err => {
    console.warn('[QueueAdmissionWorker] Admission tick warning:', err.message);
  });
}, env.QUEUE_ADMISSION_INTERVAL_MS);

// Start HTTP Server
const PORT = env.PORT;
server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`  🚀 SeatSurge Flash-Sale Ticketing Server Active!`);
  console.log(`  🌐 Frontend & API running at: http://localhost:${PORT}`);
  console.log(`  🔒 Database Engine: ${db.getEngine()}`);
  console.log(`  ⚡ Real-Time Engine: Socket.IO connected`);
  console.log(`=======================================================`);
});

// Graceful Shutdown
process.on('SIGINT', () => {
  clearInterval(admissionInterval);
  server.close(() => {
    console.log('[Server] Gracefully terminated SeatSurge.');
    process.exit(0);
  });
});

module.exports = { app, server };

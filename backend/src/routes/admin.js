const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { authenticate, requireAdmin } = require('../middleware/authMiddleware');

router.use(authenticate, requireAdmin);

router.get('/dashboard', adminController.getDashboardMetrics);
router.get('/queue', adminController.getQueueDetails);
router.get('/bookings', adminController.getAllBookings);
router.get('/bot-activity', adminController.getBotActivity);
router.post('/queue/admit-next', adminController.admitNext);
router.post('/sessions/block', adminController.toggleBlockSession);
router.post('/seats/reset', adminController.resetSeats);

module.exports = router;

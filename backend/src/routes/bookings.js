const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');
const { authenticate } = require('../middleware/authMiddleware');

router.get('/', authenticate, bookingController.getMyBookings);
router.get('/:id', authenticate, bookingController.getBookingById);

module.exports = router;

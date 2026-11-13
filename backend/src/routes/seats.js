const express = require('express');
const router = express.Router();
const seatController = require('../controllers/seatController');
const { authenticate } = require('../middleware/authMiddleware');

router.get('/', seatController.getSeats);
router.post('/hold', authenticate, seatController.holdSeats);
router.post('/release', authenticate, seatController.releaseSeats);

module.exports = router;

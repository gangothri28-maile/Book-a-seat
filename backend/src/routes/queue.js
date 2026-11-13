const express = require('express');
const router = express.Router();
const queueController = require('../controllers/queueController');
const { optionalAuth } = require('../middleware/authMiddleware');

router.post('/join', optionalAuth, queueController.joinQueue);
router.get('/status', queueController.getQueueStatus);
router.post('/leave', queueController.leaveQueue);

module.exports = router;

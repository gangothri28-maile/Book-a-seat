const express = require('express');
const router = express.Router();
const botController = require('../controllers/botController');
const { optionalAuth } = require('../middleware/authMiddleware');

router.post('/telemetry', optionalAuth, botController.submitTelemetry);
router.post('/verify-challenge', botController.verifyChallenge);
router.get('/status', botController.getStatus);

module.exports = router;

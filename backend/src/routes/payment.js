const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { authenticate } = require('../middleware/authMiddleware');

router.get('/checkout/:holdId', authenticate, paymentController.getCheckoutSummary);
router.post('/confirm', authenticate, paymentController.processPayment);

module.exports = router;

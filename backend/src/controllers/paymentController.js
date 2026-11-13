const paymentService = require('../services/paymentService');
const seatHoldService = require('../services/seatHoldService');

exports.getCheckoutSummary = async (req, res) => {
  try {
    const { holdId } = req.params;
    if (!holdId) {
      return res.status(400).json({ success: false, error: 'Hold ID is required in URL path.' });
    }

    const holdDetails = await seatHoldService.getHoldDetails(holdId);

    if (holdDetails.userId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Unauthorized to view this reservation.' });
    }

    return res.json({ success: true, ...holdDetails });
  } catch (err) {
    console.error('[Payment] GetCheckoutSummary error:', err.message);
    const status = err.statusCode || 500;
    return res.status(status).json({ success: false, error: err.message, code: err.code });
  }
};

exports.processPayment = async (req, res) => {
  try {
    const { holdId, paymentMethod, idempotencyKey, simulationOutcome } = req.body;
    const userId = req.user.id;

    if (!holdId || !idempotencyKey) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: holdId and idempotencyKey are mandatory.'
      });
    }

    const io = req.app.get('io');
    const result = await paymentService.confirmPayment(
      {
        userId,
        holdId,
        paymentMethod: paymentMethod || 'Credit Card',
        idempotencyKey,
        simulationOutcome: simulationOutcome || 'success'
      },
      io
    );

    return res.status(200).json({
      success: true,
      message: 'Payment verified and booking confirmed successfully!',
      ...result
    });
  } catch (err) {
    console.error('[Payment] ProcessPayment error:', err.message);
    const status = err.statusCode || 500;
    return res.status(status).json({
      success: false,
      error: err.message,
      code: err.code || 'PAYMENT_FAILED'
    });
  }
};

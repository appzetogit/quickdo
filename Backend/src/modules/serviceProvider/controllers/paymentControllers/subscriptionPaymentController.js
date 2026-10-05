const { razorpayKeyId, razorpayKeySecret } = require('../../../../core/settings/platformCredentials.cjs');
const { createOrder, verifyPayment } = require('../../services/razorpayService');
const Worker = require('../../models/Worker');
const WorkerSubscriptionPlan = require('../../models/WorkerSubscriptionPlan');
const { withTransaction, abort } = require('../../utils/withTransaction');
const { confirmGatewayPayment } = require('../../utils/confirmGatewayPayment');

/**
 * POST /api/workers/subscription/create-order
 * Create a Razorpay order for a subscription plan
 */
exports.createSubscriptionOrder = async (req, res) => {
  try {
    const { planId } = req.body;
    const workerId = req.user.id;
    console.log(`[SubscriptionPayment] Creating order for Plan: ${planId}, Worker: ${workerId}`);

    const plan = await WorkerSubscriptionPlan.findById(planId);
    if (!plan) {
      console.warn(`[SubscriptionPayment] Plan ${planId} not found`);
      return res.status(404).json({ success: false, message: 'Plan not found' });
    }
    
    if (!plan.isActive) {
      console.warn(`[SubscriptionPayment] Plan ${planId} is inactive`);
      return res.status(400).json({ success: false, message: 'Plan is currently inactive' });
    }

    const worker = await Worker.findById(workerId).select('name phone');
    if (!worker) {
      console.warn(`[SubscriptionPayment] Worker ${workerId} not found`);
      return res.status(404).json({ success: false, message: 'Worker not found' });
    }

    console.log(`[SubscriptionPayment] Fetching Razorpay order for amount: ${plan.price}`);

    // Create Razorpay order
    const orderResult = await createOrder(
      plan.price,
      'INR',
      `S_${workerId}_${Date.now().toString().slice(-6)}`, // Short receipt ID (max 40 chars)
      {
        workerId: workerId.toString(),
        planId: planId.toString(),
        planTitle: plan.title,
        type: 'worker_subscription'
      }
    );

    if (!orderResult.success) {
      console.error(`[SubscriptionPayment] Razorpay order failed:`, orderResult.error);
      return res.status(500).json({ success: false, message: orderResult.error || 'Failed to create payment order' });
    }

    console.log(`[SubscriptionPayment] ✅ Order created: ${orderResult.orderId}`);

    res.status(200).json({
      success: true,
      data: {
        orderId: orderResult.orderId,
        amount: orderResult.amount,
        currency: orderResult.currency,
        keyId: razorpayKeyId(),
        planTitle: plan.title,
        durationDays: plan.durationDays,
        workerName: worker.name,
        workerPhone: worker.phone
      }
    });
  } catch (error) {
    console.error('[SubscriptionPayment] ❌ Create order crash:', error);
    res.status(500).json({ success: false, message: error.message || 'Server Error' });
  }
};

/**
 * POST /api/workers/subscription/verify-payment
 * Verify Razorpay payment and activate subscription
 */
exports.verifySubscriptionPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const workerId = req.user.id;

    if (!razorpay_order_id || !razorpay_payment_id) {
      return res.status(400).json({ success: false, message: 'Missing payment details' });
    }

    // Verify payment signature
    const isValid = verifyPayment(razorpay_order_id, razorpay_payment_id, razorpay_signature);
    if (!isValid) {
      return res.status(400).json({ success: false, message: 'Invalid payment signature. Payment verification failed.' });
    }

    // Confirm with the gateway. A valid signature proves the payment ids are
    // genuine but says nothing about WHICH plan was bought, so taking planId from
    // the body let a worker pay for the cheapest plan and activate the longest one.
    const confirmed = await confirmGatewayPayment({
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id
    });
    if (!confirmed.ok) {
      return res.status(confirmed.status).json({ success: false, message: confirmed.message });
    }

    // createSubscriptionOrder stamps { workerId, planId, type:'worker_subscription' }
    // into the order notes — server-set, so the client cannot influence them.
    const notes = confirmed.notes || {};
    const planId = confirmed.mock ? req.body.planId : notes.planId;

    if (!planId) {
      return res.status(400).json({ success: false, message: 'Order is not a subscription purchase' });
    }
    if (!confirmed.mock && notes.workerId && String(notes.workerId) !== String(workerId)) {
      return res.status(403).json({ success: false, message: 'This order belongs to a different account' });
    }

    // Get plan details
    const plan = await WorkerSubscriptionPlan.findById(planId);
    if (!plan) {
      return res.status(404).json({ success: false, message: 'Plan not found' });
    }

    const Transaction = require('../../models/Transaction');
    const now = new Date();
    const paidAmount = confirmed.mock ? plan.price : confirmed.amount;

    // Subscription activation and its ledger row commit together. The referenceId
    // lookup makes a replayed request a no-op — without it, re-posting the same
    // payment extended the subscription by another full term, for free.
    const outcome = await withTransaction(async (session) => {
      const already = await Transaction.findOne({
        referenceId: razorpay_payment_id,
        type: 'worker_subscription'
      }).session(session);
      if (already) abort({ alreadyApplied: true });

      // Read inside the transaction so a retry sees fresh state
      const worker = await Worker.findById(workerId).session(session);
      if (!worker) abort({ notFound: true });

      // Calculate new expiry date
      // If subscription still active → extend from current expiry
      // If expired or none → start from now
      const currentExpiry = worker.subscription?.expiryDate
        ? new Date(worker.subscription.expiryDate)
        : null;

      const baseDate = (currentExpiry && currentExpiry > now) ? currentExpiry : now;
      const expiryDate = new Date(baseDate);
      expiryDate.setDate(expiryDate.getDate() + plan.durationDays);

      // Activate subscription
      worker.subscription = {
        isActive: true,
        planId: plan._id,
        planName: plan.title,
        startDate: now,
        expiryDate,
        durationDays: plan.durationDays,
        lastPaymentId: razorpay_payment_id,
        lastOrderId: razorpay_order_id
      };

      await worker.save({ session });

      // --- RECORD TRANSACTION ---
      await Transaction.create([{
        workerId: worker._id,
        type: 'worker_subscription',
        amount: paidAmount,
        status: 'completed',
        paymentMethod: 'razorpay',
        description: `Subscription: ${plan.title} (${plan.durationDays} days)`,
        referenceId: razorpay_payment_id,
        metadata: {
          orderId: razorpay_order_id,
          planId: plan._id,
          expiryDate: expiryDate
        }
      }], { session });

      return { expiryDate };
    });

    if (outcome.notFound) {
      return res.status(404).json({ success: false, message: 'Worker not found' });
    }
    if (outcome.alreadyApplied) {
      return res.status(400).json({ success: false, message: 'This payment has already been applied' });
    }

    const { expiryDate } = outcome;

    // --- UPDATE PLATFORM EARNINGS (post-commit: analytics must not fail the sale) ---
    const { recordWorkerSubscription } = require('../../services/earningTrackerService');
    recordWorkerSubscription(now, paidAmount)
      .catch(err => console.error('[SubscriptionPayment] Earnings tracker failed:', err));

    console.log(`[SubscriptionPayment] ✅ Worker ${workerId} subscribed to ${plan.title} until ${expiryDate}. Revenue recorded: ₹${paidAmount}`);

    res.status(200).json({
      success: true,
      message: `🎉 Subscription activated! Valid until ${expiryDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`,
      data: {
        planName: plan.title,
        expiryDate,
        durationDays: plan.durationDays,
        paymentId: razorpay_payment_id
      }
    });
  } catch (error) {
    console.error('[SubscriptionPayment] Verify error:', error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

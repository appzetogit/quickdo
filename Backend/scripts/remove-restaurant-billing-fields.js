import mongoose from 'mongoose';
import { config } from '../src/config/env.js';

const run = async () => {
  const dryRun = String(process.env.DRY_RUN || 'true').toLowerCase() !== 'false';

  await mongoose.connect(config.mongodbUri);

  const collection = mongoose.connection.db.collection('food_restaurants');
  const filter = {
    $or: [
      { onboardingFeePaid: { $exists: true } },
      { onboardingFeePaidAt: { $exists: true } },
      { onboardingFeePaymentMethod: { $exists: true } },
      { onboardingFeePaymentOrderId: { $exists: true } },
      { onboardingFeePaymentId: { $exists: true } },
      { onboardingFeePaymentSignature: { $exists: true } },
      { subscriptionPlan: { $exists: true } },
      { subscriptionAmount: { $exists: true } },
      { subscriptionPaidAmount: { $exists: true } },
      { subscriptionDueAmount: { $exists: true } },
      { subscriptionStatus: { $exists: true } },
      { subscriptionValidTill: { $exists: true } },
    ],
  };

  const unsetFields = {
    onboardingFeePaid: '',
    onboardingFeePaidAt: '',
    onboardingFeePaymentMethod: '',
    onboardingFeePaymentOrderId: '',
    onboardingFeePaymentId: '',
    onboardingFeePaymentSignature: '',
    subscriptionPlan: '',
    subscriptionAmount: '',
    subscriptionPaidAmount: '',
    subscriptionDueAmount: '',
    subscriptionStatus: '',
    subscriptionValidTill: '',
  };

  const affectedCount = await collection.countDocuments(filter);
  if (dryRun) {
    console.log(`[DRY RUN] food_restaurants documents with billing fields: ${affectedCount}`);
    await mongoose.disconnect();
    return;
  }

  const result = await collection.updateMany(filter, { $unset: unsetFields });
  console.log(`[MIGRATION DONE] matched=${result.matchedCount} modified=${result.modifiedCount}`);

  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error('[MIGRATION FAILED]', err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});

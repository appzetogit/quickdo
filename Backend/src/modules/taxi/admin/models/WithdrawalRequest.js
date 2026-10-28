import mongoose from 'mongoose';

const withdrawalRequestSchema = new mongoose.Schema({
  transactionId: String,
  driver_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiDriver' },
  owner_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiOwner' },
  amount: Number,
  payment_method: String,
  status: { type: String, enum: ['pending', 'completed', 'cancelled'], default: 'pending' }
}, { timestamps: true });

export const WithdrawalRequest = mongoose.models.TaxiWithdrawalRequest || mongoose.model('TaxiWithdrawalRequest', withdrawalRequestSchema);

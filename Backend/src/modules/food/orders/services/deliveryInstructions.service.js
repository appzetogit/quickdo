import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';

/**
 * Admin-managed chip options ("Don't ring bell", "Leave at door", ...) shown
 * on the customer app's checkout screen (Food admin panel -> Delivery
 * Management -> Delivery Instructions).
 *
 * The customer picks free text off this list; orders store the picked
 * strings directly (order.model.js `deliveryInstructions`), not a reference
 * to these rows, so editing or removing an option here never rewrites an
 * order already placed with it.
 */

const instructionSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { collection: 'food_delivery_instructions', timestamps: true },
);

export const FoodDeliveryInstruction = mongoose.models.FoodDeliveryInstruction
  || mongoose.model('FoodDeliveryInstruction', instructionSchema);

const TTL_MS = 30_000;
let cache = null;
const clearCache = () => { cache = null; };

const toDto = (doc) => ({
  id: String(doc._id),
  label: doc.label,
  isActive: doc.isActive !== false,
  sortOrder: doc.sortOrder || 0,
});

/** Every option, active and inactive, for the admin screen. */
export async function listDeliveryInstructionsForAdmin() {
  const rows = await FoodDeliveryInstruction.find({}).sort({ sortOrder: 1, createdAt: 1 }).lean();
  return rows.map(toDto);
}

/**
 * Active options only, for the customer app's chip list. Cached briefly —
 * this is read on every cart screen open.
 */
export async function listActiveDeliveryInstructions() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  const rows = await FoodDeliveryInstruction.find({ isActive: true }).sort({ sortOrder: 1, createdAt: 1 }).lean();
  const dtos = rows.map(toDto);
  cache = { at: Date.now(), rows: dtos };
  return dtos;
}

export async function createDeliveryInstruction(body = {}) {
  const label = String(body.label || '').trim();
  if (!label) throw new ValidationError('Label is required');
  const count = await FoodDeliveryInstruction.countDocuments({});
  const doc = await FoodDeliveryInstruction.create({
    label,
    isActive: body.isActive !== false,
    sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : count,
  });
  clearCache();
  return toDto(doc.toObject());
}

export async function updateDeliveryInstruction(id, body = {}) {
  const set = {};
  if (body.label !== undefined) {
    const label = String(body.label || '').trim();
    if (!label) throw new ValidationError('Label is required');
    set.label = label;
  }
  if (body.isActive !== undefined) set.isActive = body.isActive === true;
  if (body.sortOrder !== undefined) {
    const n = Number(body.sortOrder);
    if (Number.isFinite(n)) set.sortOrder = n;
  }
  const doc = await FoodDeliveryInstruction.findByIdAndUpdate(id, { $set: set }, { new: true }).lean();
  if (!doc) throw new ValidationError('Instruction not found');
  clearCache();
  return toDto(doc);
}

export async function deleteDeliveryInstruction(id) {
  const doc = await FoodDeliveryInstruction.findByIdAndDelete(id).lean();
  if (!doc) throw new ValidationError('Instruction not found');
  clearCache();
  return { deleted: true };
}

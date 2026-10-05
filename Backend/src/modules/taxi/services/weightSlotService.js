import mongoose from 'mongoose';
import { ApiError } from '../../../utils/ApiError.js';
import { GoodsType } from '../admin/models/GoodsType.js';

/**
 * The weight slot a parcel booking picked, read from the admin's goods type --
 * never from what the app sent. The app only names the slot (its _id); the
 * extra amount comes from here, so a modified app cannot choose its own price.
 *
 * Returns null when no slot was chosen (older apps, or a goods type with no
 * slots), which simply means no weight charge. Throws when a slot WAS chosen
 * but is gone, switched off, or belongs to a different goods type than the
 * parcel's, so the rider re-chooses instead of being charged something else.
 */
export const resolveWeightSlot = async ({ weightSlotId, goodsTypeId } = {}) => {
  const slotId = String(weightSlotId || '').trim();
  if (!slotId) return null;
  if (!mongoose.Types.ObjectId.isValid(slotId)) {
    throw new ApiError(400, 'That weight option is not valid. Please choose again.');
  }

  const goodsType = await GoodsType.findOne({ 'weight_slots._id': slotId }).lean();
  const slot = goodsType?.weight_slots?.find((item) => String(item._id) === slotId);
  if (!goodsType || !slot || slot.active === false || Number(goodsType.active) === 0) {
    throw new ApiError(400, 'That weight option is no longer available. Please choose again.');
  }

  const wantedGoodsTypeId = String(goodsTypeId || '').trim();
  if (wantedGoodsTypeId && wantedGoodsTypeId !== String(goodsType._id)) {
    throw new ApiError(400, 'That weight option does not belong to the chosen goods type.');
  }

  return {
    goodsTypeId: String(goodsType._id),
    goodsTypeName: goodsType.goods_type_name || '',
    id: String(slot._id),
    label: slot.label || `${slot.min_kg} - ${slot.max_kg} kg`,
    minKg: Number(slot.min_kg) || 0,
    maxKg: Number(slot.max_kg) || 0,
    price: Math.max(0, Number(slot.price) || 0),
  };
};

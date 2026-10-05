import mongoose from 'mongoose';

const goodsTypeSchema = new mongoose.Schema(
  {
    goods_type_name: {
      type: String,
      required: true,
      trim: true,
    },
    translation_dataset: {
      type: String,
      default: '',
    },
    goods_types_for: {
      type: String,
      default: 'both',
      trim: true,
    },
    company_key: {
      type: String,
      default: null,
    },
    external_id: {
      type: Number,
      default: null,
    },
    active: {
      type: Number,
      default: 1,
    },
    status: {
      type: String,
      default: 'active',
      trim: true,
    },
    goods_type_translation_words: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    icon: {
      type: String,
      default: '',
      trim: true,
    },
    // Weight bands a customer picks from for this goods type. The price is an
    // EXTRA on top of the chosen vehicle's normal parcel fare. Each band's own
    // _id is what the apps send back, so the amount is always re-read here.
    weight_slots: {
      type: [
        new mongoose.Schema({
          label: { type: String, trim: true, default: '' },
          min_kg: { type: Number, min: 0, default: 0 },
          max_kg: { type: Number, min: 0, default: 0 },
          price: { type: Number, min: 0, default: 0 },
          active: { type: Boolean, default: true },
        }),
      ],
      default: [],
    },
  },
  { timestamps: true },
);

goodsTypeSchema.pre('save', function syncName() {
  if (!this.name && this.goods_type_name) {
    this.name = this.goods_type_name;
  }
});

goodsTypeSchema.index({ name: 1 });
goodsTypeSchema.index({ goods_type_for: 1, status: 1 });

export const GoodsType = mongoose.models.TaxiGoodsType || mongoose.model('TaxiGoodsType', goodsTypeSchema);

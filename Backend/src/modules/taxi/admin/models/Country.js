import mongoose from 'mongoose';

const countrySchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true, 
    unique: true,
    trim: true
  },
  code: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true
  },
  active: { 
    type: Boolean, 
    default: true 
  }
}, { timestamps: true });

const Country = mongoose.model('Country', countrySchema);

export default Country;

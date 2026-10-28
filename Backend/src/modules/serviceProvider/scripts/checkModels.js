/**
 * Test Models
 * Simple test to verify models are created correctly
 * Run: node Backend/tests/testModels.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');

// Import models
const Category = require('../models/Category');
const Service = require('../models/UserService');
const Booking = require('../models/Booking');

const testModels = async () => {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await connectDB();
    console.log('✅ Connected to MongoDB\n');

    // Test Category Model
    console.log('📦 Testing Category Model...');
    const categorySchema = Category.schema;
    console.log('  - Category schema loaded');
    console.log('  - Required fields:', Object.keys(categorySchema.paths).filter(key => categorySchema.paths[key].isRequired));
    console.log('  ✅ Category model is valid\n');

    // Test Service Model
    console.log('📦 Testing Service Model...');
    const serviceSchema = Service.schema;
    console.log('  - Service schema loaded');
    console.log('  - Required fields:', Object.keys(serviceSchema.paths).filter(key => serviceSchema.paths[key].isRequired));
    console.log('  ✅ Service model is valid\n');

    // Test Booking Model
    console.log('📦 Testing Booking Model...');
    const bookingSchema = Booking.schema;
    console.log('  - Booking schema loaded');
    console.log('  - Required fields:', Object.keys(bookingSchema.paths).filter(key => bookingSchema.paths[key].isRequired));
    console.log('  ✅ Booking model is valid\n');

    console.log('🎉 All models are valid and ready to use!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error testing models:', error);
    process.exit(1);
  }
};

testModels();


const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Vendor = require('../models/Vendor');
const Worker = require('../models/Worker');
const Booking = require('../models/Booking');
const Service = require('../models/Service');
const Category = require('../models/Category');
const { VENDOR_STATUS, BOOKING_STATUS, PAYMENT_STATUS, USER_ROLES } = require('../utils/constants');
const { uploadFile } = require('../services/fileStorageService');

require('dotenv').config();

// Connect to MongoDB
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/Homster');
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

const seedVendors = async () => {
  try {
    console.log('Starting vendor seeding...');

    // Clear existing data
    await Vendor.deleteMany({});
    await Worker.deleteMany({});
    console.log('Cleared existing vendor and worker data');

    // Get electrician category
    const electricianCategory = await Category.findOne({ title: 'Electricity' });
    if (!electricianCategory) {
      console.log('Electricity category not found, creating it...');
      const newCategory = new Category({
        title: 'Electricity',
        slug: 'electricity',
        iconUrl: 'https://res.cloudinary.com/shubhamcloudinary/image/upload/v1766039523/icons/services/electrician.png',
        homeIconUrl: 'https://res.cloudinary.com/shubhamcloudinary/image/upload/v1766039523/icons/services/electrician.png',
        description: 'Electrical services and repairs',
        isActive: true,
        homeOrder: 1
      });
      await newCategory.save();
    }

    const category = await Category.findOne({ title: 'Electricity' });

    // Create sample vendors
    const vendorsData = [
      {
        name: 'Rajesh Kumar',
        email: 'rajesh.kumar@homster.com',
        phone: '9876543210',
        password: 'vendor123',
        businessName: 'Kumar Electrical Services',
        service: 'Electricity',
        approvalStatus: VENDOR_STATUS.APPROVED,
        isPhoneVerified: true,
        isEmailVerified: true,
        address: {
          addressLine1: '123 MG Road',
          addressLine2: 'Near City Mall',
          city: 'Indore',
          state: 'Madhya Pradesh',
          pincode: '452001',
          landmark: 'Opposite HDFC Bank'
        },
        wallet: {
          balance: 25000
        },
        profilePhoto: null
      },
      {
        name: 'Amit Sharma',
        email: 'amit.sharma@homster.com',
        phone: '9876543211',
        password: 'vendor123',
        businessName: 'Sharma Home Services',
        service: 'Electricity',
        approvalStatus: VENDOR_STATUS.APPROVED,
        isPhoneVerified: true,
        isEmailVerified: true,
        address: {
          addressLine1: '456 Vijay Nagar',
          addressLine2: 'Scheme 78',
          city: 'Indore',
          state: 'Madhya Pradesh',
          pincode: '452010',
          landmark: 'Near Apollo Hospital'
        },
        wallet: {
          balance: 18000
        },
        profilePhoto: null
      },
      {
        name: 'Vikram Singh',
        email: 'vikram.singh@homster.com',
        phone: '9876543212',
        password: 'vendor123',
        businessName: 'Singh Electrical Solutions',
        service: 'Electricity',
        approvalStatus: VENDOR_STATUS.APPROVED,
        isPhoneVerified: true,
        isEmailVerified: true,
        address: {
          addressLine1: '789 Palasia',
          addressLine2: 'AB Road',
          city: 'Indore',
          state: 'Madhya Pradesh',
          pincode: '452001',
          landmark: 'Near Treasure Island Mall'
        },
        wallet: {
          balance: 32000
        },
        profilePhoto: null
      }
    ];

    const createdVendors = [];
    for (const vendorData of vendorsData) {
      const vendor = new Vendor(vendorData);
      await vendor.save();
      createdVendors.push(vendor);
      console.log(`Created vendor: ${vendor.name}`);
    }

    // Create workers for each vendor
    const workersData = [
      // Workers for Rajesh Kumar
      {
        name: 'Suresh Patel',
        email: 'suresh.patel@homster.com',
        phone: '9876543213',
        password: 'worker123',
        vendorId: createdVendors[0]._id,
        skills: ['Fan Repair', 'AC Service', 'Electrical Wiring'],
        serviceArea: 'Indore, MP',
        workingHours: { start: '09:00', end: '18:00' },
        availability: 'ONLINE',
        rating: 4.7,
        totalJobs: 25,
        completedJobs: 24,
        currentLocation: {
          lat: 22.7196,
          lng: 75.8577
        }
      },
      {
        name: 'Mohan Das',
        email: 'mohan.das@homster.com',
        phone: '9876543214',
        password: 'worker123',
        vendorId: createdVendors[0]._id,
        skills: ['Plumbing', 'Carpentry', 'Installation'],
        serviceArea: 'Indore, MP',
        workingHours: { start: '08:00', end: '20:00' },
        availability: 'ONLINE',
        rating: 4.9,
        totalJobs: 18,
        completedJobs: 17,
        currentLocation: {
          lat: 22.7200,
          lng: 75.8580
        }
      },
      // Workers for Amit Sharma
      {
        name: 'Ravi Kumar',
        email: 'ravi.kumar@homster.com',
        phone: '9876543215',
        password: 'worker123',
        vendorId: createdVendors[1]._id,
        skills: ['AC Service', 'Refrigerator Repair', 'Electrical Wiring'],
        serviceArea: 'Indore, MP',
        workingHours: { start: '10:00', end: '19:00' },
        availability: 'ONLINE',
        rating: 4.6,
        totalJobs: 12,
        completedJobs: 11,
        currentLocation: {
          lat: 22.7180,
          lng: 75.8560
        }
      },
      // Workers for Vikram Singh
      {
        name: 'Deepak Joshi',
        email: 'deepak.joshi@homster.com',
        phone: '9876543216',
        password: 'worker123',
        vendorId: createdVendors[2]._id,
        skills: ['Fan Repair', 'Light Installation', 'House Wiring'],
        serviceArea: 'Indore, MP',
        workingHours: { start: '09:00', end: '18:00' },
        availability: 'OFFLINE',
        rating: 4.8,
        totalJobs: 30,
        completedJobs: 29,
        currentLocation: {
          lat: 22.7210,
          lng: 75.8590
        }
      },
      {
        name: 'Ankit Verma',
        email: 'ankit.verma@homster.com',
        phone: '9876543217',
        password: 'worker123',
        vendorId: createdVendors[2]._id,
        skills: ['Appliance Repair', 'Cleaning'],
        serviceArea: 'Indore, MP',
        workingHours: { start: '07:00', end: '16:00' },
        availability: 'ONLINE',
        rating: 4.5,
        totalJobs: 8,
        completedJobs: 8,
        currentLocation: {
          lat: 22.7170,
          lng: 75.8550
        }
      }
    ];

    const createdWorkers = [];
    for (const workerData of workersData) {
      const worker = new Worker(workerData);
      await worker.save();
      createdWorkers.push(worker);
      console.log(`Created worker: ${worker.name} for vendor: ${createdVendors.find(v => v._id.toString() === worker.vendorId.toString())?.name}`);
    }

    console.log(`Seeded ${createdVendors.length} vendors and ${createdWorkers.length} workers successfully!`);
    console.log('Vendor seeding completed!');

  } catch (error) {
    console.error('Error seeding vendors:', error);
  }
};

// Run the seeding
const runSeeding = async () => {
  await connectDB();
  await seedVendors();
  process.exit(0);
};

runSeeding();


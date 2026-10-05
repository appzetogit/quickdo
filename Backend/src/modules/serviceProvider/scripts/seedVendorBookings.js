const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Vendor = require('../models/Vendor');
const Worker = require('../models/Worker');
const User = require('../models/User');
const Service = require('../models/Service');
const { BOOKING_STATUS, PAYMENT_STATUS } = require('../utils/constants');

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

const seedVendorBookings = async () => {
  try {
    console.log('Starting vendor bookings seeding...');

    // Get existing vendors, workers, and services
    const vendors = await Vendor.find({ approvalStatus: 'approved' });
    const workers = await Worker.find({});
    const services = await Service.find({});

    if (vendors.length === 0) {
      console.log('No approved vendors found. Run vendor seeding first.');
      return;
    }

    // Create sample users for bookings
    const sampleUsers = [
      {
        name: 'John Doe',
        email: 'john.doe@example.com',
        phone: '9876543220',
        isPhoneVerified: true,
        isEmailVerified: true
      },
      {
        name: 'Priya Sharma',
        email: 'priya.sharma@example.com',
        phone: '9876543221',
        isPhoneVerified: true,
        isEmailVerified: true
      },
      {
        name: 'Rahul Verma',
        email: 'rahul.verma@example.com',
        phone: '9876543222',
        isPhoneVerified: true,
        isEmailVerified: true
      }
    ];

    const createdUsers = [];
    for (const userData of sampleUsers) {
      let user = await User.findOne({ phone: userData.phone });
      if (!user) {
        user = new User(userData);
        await user.save();
      }
      createdUsers.push(user);
    }

    // Clear existing bookings
    await Booking.deleteMany({});
    console.log('Cleared existing bookings');

    // Create sample bookings for each vendor
    const bookingsData = [];

    // Bookings for Rajesh Kumar
    const rajesh = vendors.find(v => v.name === 'Rajesh Kumar');
    if (rajesh) {
      const rajeshWorkers = workers.filter(w => w.vendorId.toString() === rajesh._id.toString());

      bookingsData.push(
        {
          userId: createdUsers[0]._id,
          vendorId: rajesh._id,
          serviceId: services[0]?._id || null,
          workerId: rajeshWorkers[0]?._id || null,
          baseAmount: 500,
          finalAmount: 500,
          scheduledDate: new Date(),
          scheduledTimeSlot: '2:00 PM - 4:00 PM',
          status: BOOKING_STATUS.COMPLETED,
          paymentStatus: PAYMENT_STATUS.SUCCESS,
          address: {
            addressLine1: '456 Park Avenue, Indore, MP 452001',
            city: 'Indore',
            state: 'Madhya Pradesh',
            pincode: '452001'
          },
          description: 'Fan is not working properly, needs repair',
          completedAt: new Date(Date.now() - 2 * 60 * 60 * 1000)
        },
        {
          userId: createdUsers[1]._id,
          vendorId: rajesh._id,
          serviceId: services[1]?._id || null,
          workerId: rajeshWorkers[1]?._id || null,
          baseAmount: 1200,
          finalAmount: 1200,
          scheduledDate: new Date(),
          scheduledTimeSlot: '10:00 AM - 12:00 PM',
          status: BOOKING_STATUS.IN_PROGRESS,
          paymentStatus: PAYMENT_STATUS.SUCCESS,
          address: {
            addressLine1: '789 MG Road, Indore, MP 452002',
            city: 'Indore',
            state: 'Madhya Pradesh',
            pincode: '452002'
          },
          description: 'AC not cooling properly'
        },
        {
          userId: createdUsers[2]._id,
          vendorId: rajesh._id,
          serviceId: services[2]?._id || null,
          baseAmount: 800,
          finalAmount: 800,
          scheduledDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
          scheduledTimeSlot: '11:00 AM - 1:00 PM',
          status: BOOKING_STATUS.ACCEPTED,
          paymentStatus: PAYMENT_STATUS.PENDING,
          address: {
            addressLine1: '321 Station Road, Indore, MP 452003',
            city: 'Indore',
            state: 'Madhya Pradesh',
            pincode: '452003'
          },
          description: 'Leakage in bathroom tap'
        }
      );
    }

    // Bookings for Amit Sharma
    const amit = vendors.find(v => v.name === 'Amit Sharma');
    if (amit) {
      const amitWorkers = workers.filter(w => w.vendorId.toString() === amit._id.toString());

      bookingsData.push(
        {
          userId: createdUsers[0]._id,
          vendorId: amit._id,
          serviceId: services[0]?._id || null,
          workerId: amitWorkers[0]?._id || null,
          baseAmount: 600,
          finalAmount: 600,
          scheduledDate: new Date(Date.now() - 24 * 60 * 60 * 1000), // Yesterday
          scheduledTimeSlot: '9:00 AM - 11:00 AM',
          status: BOOKING_STATUS.COMPLETED,
          paymentStatus: PAYMENT_STATUS.SUCCESS,
          address: {
            addressLine1: '555 New Colony, Indore, MP 452004',
            city: 'Indore',
            state: 'Madhya Pradesh',
            pincode: '452004'
          },
          description: 'Electrical wiring repair needed',
          completedAt: new Date(Date.now() - 24 * 60 * 60 * 1000)
        }
      );
    }

    // Create bookings
    for (const bookingData of bookingsData) {
      const booking = new Booking(bookingData);
      await booking.save();
      console.log(`Created booking for vendor: ${booking.vendorId} with status: ${booking.status}`);
    }

    console.log(`Seeded ${bookingsData.length} bookings successfully!`);
    console.log('Vendor bookings seeding completed!');

  } catch (error) {
    console.error('Error seeding vendor bookings:', error);
  }
};

// Run the seeding
const runSeeding = async () => {
  await connectDB();
  await seedVendorBookings();
  process.exit(0);
};

runSeeding();


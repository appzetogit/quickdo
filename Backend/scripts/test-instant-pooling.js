import dns from 'dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);

import mongoose from 'mongoose';
import { config } from '../src/config/env.js';
import { Driver } from '../src/modules/taxi/driver/models/Driver.js';
import { Ride } from '../src/modules/taxi/user/models/Ride.js';
import { User } from '../src/modules/taxi/user/models/User.js';
import { Vehicle } from '../src/modules/taxi/admin/models/Vehicle.js';
import { InstantPoolGroup } from '../src/modules/taxi/admin/models/InstantPoolGroup.js';
import { AdminBusinessSetting } from '../src/modules/taxi/admin/models/AdminBusinessSetting.js';
import { matchDrivers } from '../src/modules/taxi/services/matchingService.js';
import { acceptRideAssignment } from '../src/modules/taxi/services/rideService.js';
import { verifyPassengerOtp, completePassengerRide, removeRideFromPoolGroup } from '../src/modules/taxi/services/instantPoolingService.js';

const testPoolingLifecycle = async () => {
  console.log('Connecting to database...');
  await mongoose.connect(config.mongodbUri);

  console.log('Cleaning up existing mock data...');
  const mockEmail = 'pooling.test.driver@k9rides.com';
  const mockUserEmailA = 'passenger.a@k9rides.com';
  const mockUserEmailB = 'passenger.b@k9rides.com';

  await Driver.deleteMany({ email: mockEmail });
  await User.deleteMany({ email: { $in: [mockUserEmailA, mockUserEmailB] } });
  await InstantPoolGroup.deleteMany({});
  await Ride.deleteMany({ isPoolRide: true });

  console.log('Seeding mock vehicle type...');
  let vehicle = await Vehicle.findOne({ name: 'Sedan' });
  if (!vehicle) {
    vehicle = await Vehicle.create({
      name: 'Sedan',
      icon_types: 'car',
      capacity: 4,
      status: 1,
    });
  }

  console.log('Seeding mock passengers...');
  const userA = await User.create({
    name: 'Passenger A',
    email: mockUserEmailA,
    phone: '9999900001',
    password: 'password123',
    role: 'user',
  });

  const userB = await User.create({
    name: 'Passenger B',
    email: mockUserEmailB,
    phone: '9999900002',
    password: 'password123',
    role: 'user',
  });

  console.log('Seeding mock driver...');
  const driver = await Driver.create({
    name: 'Pooling Captain',
    email: mockEmail,
    phone: '8888800001',
    password: 'password123',
    vehicleType: 'car',
    vehicleTypeId: vehicle._id,
    registerFor: 'taxi',
    isOnline: true,
    isOnRide: false,
    isPoolEnabled: true,
    maxPoolSeats: 4,
    wallet: {
      balance: 1000,
      isBlocked: false,
    },
    location: {
      type: 'Point',
      coordinates: [75.8500, 22.7150], // Near Indore
    },
    approve: true,
    status: 'approved',
    active: 1,
  });

  console.log('Seeding admin pooling configuration...');
  await AdminBusinessSetting.updateOne(
    { scope: 'default' },
    {
      $set: {
        instant_pooling: {
          enable: '1',
          max_radius_meters: '5000',
          max_detour_meters: '5000',
          max_eta_increase_minutes: '15',
          max_passengers: '3',
          discount_percentage: '20',
          timeout_seconds: '60',
          surge_multiplier: '1.0',
          cancellation_fee: '50',
        }
      }
    },
    { upsert: true }
  );

  console.log('Seeding completed. Initiating Task flows...');

  // --- Step 1: Create Ride Request A ---
  console.log('\n--- STEP 1: Creating Ride A Request ---');
  const rideA = await Ride.create({
    userId: userA._id,
    pickupLocation: { type: 'Point', coordinates: [75.8577, 22.7196] },
    dropLocation: { type: 'Point', coordinates: [75.8937, 22.7533] },
    pickupAddress: 'Bhawarkua Indore',
    dropAddress: 'Vijay Nagar Indore',
    fare: 150,
    baseFare: 150,
    isPoolRide: true,
    poolSeats: 1,
    transport_type: 'taxi',
    status: 'searching',
    liveStatus: 'searching',
    otp: '1111',
  });
  console.log(`Ride A created successfully with ID: ${rideA._id}`);

  // --- Step 2: Match Drivers for Ride A ---
  console.log('\n--- STEP 2: Matching Drivers for Ride A ---');
  const matchResultA = await matchDrivers(rideA.pickupLocation.coordinates, {
    maxDistance: 5000,
    vehicleTypeId: vehicle._id,
    transportType: 'pooling',
    seats: 1,
  });

  const matchedDriverIdsA = matchResultA.drivers.map(d => String(d._id));
  console.log('Matched drivers A:', matchedDriverIdsA);
  if (!matchedDriverIdsA.includes(String(driver._id))) {
    throw new Error('Driver A was not matched for Ride A!');
  }
  console.log('SUCCESS: Driver A matched Ride A successfully.');

  // --- Step 3: Driver Accepts Ride A ---
  console.log('\n--- STEP 3: Driver Accepts Ride A ---');
  await acceptRideAssignment({ rideId: rideA._id, driverId: driver._id });

  // Load updated driver and group
  const updatedDriverAfterAcceptA = await Driver.findById(driver._id);
  console.log('Driver status after accepting A:', {
    isOnRide: updatedDriverAfterAcceptA.isOnRide,
    activePoolGroupId: updatedDriverAfterAcceptA.activePoolGroupId,
    poolOccupiedSeats: updatedDriverAfterAcceptA.poolOccupiedSeats,
    activePoolRideCount: updatedDriverAfterAcceptA.activePoolRideCount,
  });

  if (!updatedDriverAfterAcceptA.isOnRide || !updatedDriverAfterAcceptA.activePoolGroupId) {
    throw new Error('Driver states were not updated correctly after accepting A!');
  }

  const poolGroup = await InstantPoolGroup.findById(updatedDriverAfterAcceptA.activePoolGroupId);
  console.log('Pool group stops sequence:', poolGroup.routeSequence);
  if (poolGroup.routeSequence.length !== 2) {
    throw new Error('Optimal sequence does not contain correct number of stops!');
  }
  console.log('SUCCESS: Pool group initialized with first rider sequence.');

  // --- Step 4: Create overlapping Ride Request B ---
  console.log('\n--- STEP 4: Creating Overlapping Ride B Request ---');
  const rideB = await Ride.create({
    userId: userB._id,
    pickupLocation: { type: 'Point', coordinates: [75.8600, 22.7210] }, // Overlapping route
    dropLocation: { type: 'Point', coordinates: [75.8900, 22.7500] },
    pickupAddress: 'Sapna Sangeeta Indore',
    dropAddress: 'Vijay Nagar Square Indore',
    fare: 120,
    baseFare: 120,
    isPoolRide: true,
    poolSeats: 2,
    transport_type: 'taxi',
    status: 'searching',
    liveStatus: 'searching',
    otp: '2222',
  });

  // --- Step 5: Match Driver carrying Rider A to Rider B ---
  console.log('\n--- STEP 5: Matching Active Pool Driver to Ride B ---');
  const matchResultB = await matchDrivers(rideB.pickupLocation.coordinates, {
    maxDistance: 5000,
    vehicleTypeId: vehicle._id,
    transportType: 'pooling',
    seats: 2,
  });

  const matchedDriverIdsB = matchResultB.drivers.map(d => String(d._id));
  console.log('Matched drivers for B (should include active pool captain):', matchedDriverIdsB);
  if (!matchedDriverIdsB.includes(String(driver._id))) {
    throw new Error('Driver was not matched for Ride B while carrying passenger A!');
  }
  console.log('SUCCESS: Active driver matched overlapping passenger B successfully.');

  // --- Step 6: Accept Ride B ---
  console.log('\n--- STEP 6: Driver Accepts Ride B ---');
  await acceptRideAssignment({ rideId: rideB._id, driverId: driver._id });

  const updatedDriverAfterAcceptB = await Driver.findById(driver._id);
  console.log('Driver status after accepting B:', {
    isOnRide: updatedDriverAfterAcceptB.isOnRide,
    activePoolGroupId: updatedDriverAfterAcceptB.activePoolGroupId,
    poolOccupiedSeats: updatedDriverAfterAcceptB.poolOccupiedSeats,
    activePoolRideCount: updatedDriverAfterAcceptB.activePoolRideCount,
  });

  if (updatedDriverAfterAcceptB.poolOccupiedSeats !== 3 || updatedDriverAfterAcceptB.activePoolRideCount !== 2) {
    throw new Error('Seat accounting failed on joining pool!');
  }

  const updatedPoolGroup = await InstantPoolGroup.findById(updatedDriverAfterAcceptB.activePoolGroupId);
  console.log('Optimal re-ordered stops sequence:', updatedPoolGroup.routeSequence.map(s => `${s.type} - ${s.passengerName} (ETA: ${s.etaMinutes}m)`));
  if (updatedPoolGroup.routeSequence.length !== 4) {
    throw new Error('Route optimizer failed to optimize combined routing sequence!');
  }
  console.log('SUCCESS: Route optimized and sequence updated dynamically.');

  // --- Step 7: Board Rider A (OTP Verify) ---
  console.log('\n--- STEP 7: Boarding Passenger A (OTP Verification) ---');
  await verifyPassengerOtp(rideA._id, '1111');
  const verifiedRideA = await Ride.findById(rideA._id);
  console.log('Ride A status after board:', verifiedRideA.status);
  if (verifiedRideA.status !== 'ongoing') {
    throw new Error('Passenger A boarding verification failed!');
  }
  console.log('SUCCESS: Passenger A boarded successfully.');

  // --- Step 8: Board Rider B (OTP Verify) ---
  console.log('\n--- STEP 8: Boarding Passenger B (OTP Verification) ---');
  await verifyPassengerOtp(rideB._id, '2222');
  const verifiedRideB = await Ride.findById(rideB._id);
  console.log('Ride B status after board:', verifiedRideB.status);
  if (verifiedRideB.status !== 'ongoing') {
    throw new Error('Passenger B boarding verification failed!');
  }
  console.log('SUCCESS: Passenger B boarded successfully.');

  // --- Step 9: Complete Passenger A ---
  console.log('\n--- STEP 9: Completing Passenger A Ride ---');
  await completePassengerRide(rideA._id);
  const completedRideA = await Ride.findById(rideA._id);
  console.log('Ride A fare split details:', {
    status: completedRideA.status,
    fare: completedRideA.fare,
    commissionAmount: completedRideA.commissionAmount,
    driverEarnings: completedRideA.driverEarnings,
  });
  if (completedRideA.status !== 'completed' || completedRideA.driverEarnings <= 0) {
    throw new Error('Fare splitting or wallet updates failed on completion!');
  }

  const driverAfterCompleteA = await Driver.findById(driver._id);
  console.log('Driver status after completing A (should still be on ride carrying B):', {
    isOnRide: driverAfterCompleteA.isOnRide,
    activePoolGroupId: driverAfterCompleteA.activePoolGroupId,
    poolOccupiedSeats: driverAfterCompleteA.poolOccupiedSeats,
  });
  if (!driverAfterCompleteA.isOnRide || driverAfterCompleteA.poolOccupiedSeats !== 2) {
    throw new Error('Driver released prematurely before completing last passenger B!');
  }
  console.log('SUCCESS: Passenger A completed. Driver continues carrying B.');

  // --- Step 10: Complete Passenger B ---
  console.log('\n--- STEP 10: Completing Passenger B Ride ---');
  await completePassengerRide(rideB._id);
  const completedRideB = await Ride.findById(rideB._id);
  console.log('Ride B final status:', completedRideB.status);

  const driverAfterCompleteB = await Driver.findById(driver._id);
  console.log('Driver status after completing B (should be released and idle):', {
    isOnRide: driverAfterCompleteB.isOnRide,
    activePoolGroupId: driverAfterCompleteB.activePoolGroupId,
    poolOccupiedSeats: driverAfterCompleteB.poolOccupiedSeats,
  });
  if (driverAfterCompleteB.isOnRide || driverAfterCompleteB.activePoolGroupId) {
    throw new Error('Driver was not released after last passenger dropped!');
  }

  const finalPoolGroup = await InstantPoolGroup.findById(poolGroup._id);
  console.log('Final pool group status:', finalPoolGroup.status);
  if (finalPoolGroup.status !== 'completed') {
    throw new Error('Pool group lifecycle status closing failed!');
  }
  console.log('SUCCESS: All passengers dropped. Pool group successfully archived.');

  console.log('\n=========================================');
  console.log('ALL TASKS LOGIC VERIFIED SUCCESSFULLY!');
  console.log('=========================================');
};

testPoolingLifecycle()
  .then(() => {
    console.log('Test completed successfully.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Test execution failed:', err);
    process.exit(1);
  });

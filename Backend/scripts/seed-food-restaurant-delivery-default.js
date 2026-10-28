import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const DEFAULTS = {
  restaurant: {
    phone: "9009925021",
    countryCode: "+91",
    restaurantName: "K9 Rides Demo Restaurant",
    ownerName: "K9 Rides Restaurant Owner",
    ownerEmail: "restaurant@K9 Rides.com",
    city: "Bhopal",
    state: "Madhya Pradesh",
    status: "approved",
  },
  delivery: {
    phone: "7610416911",
    countryCode: "+91",
    name: "K9 Rides Delivery Partner",
    city: "Bhopal",
    state: "Madhya Pradesh",
    vehicleType: "bike",
    status: "approved",
  },
};

const normalizePhone = (value) => String(value || "").replace(/\D/g, "").slice(-10);

const connect = async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error("Missing MONGODB_URI / MONGO_URI in environment.");
  const dbName = process.env.MONGODB_DB_NAME || undefined;
  await mongoose.connect(uri, dbName ? { dbName } : undefined);
};

const upsertRestaurant = async () => {
  const phone = normalizePhone(DEFAULTS.restaurant.phone);
  const now = new Date();
  const restaurantCol = mongoose.connection.collection("food_restaurants");

  const result = await restaurantCol.updateOne(
    { $or: [{ ownerPhone: phone }, { primaryContactNumber: phone }] },
    {
      $set: {
        restaurantName: DEFAULTS.restaurant.restaurantName,
        ownerName: DEFAULTS.restaurant.ownerName,
        ownerEmail: DEFAULTS.restaurant.ownerEmail,
        ownerPhone: phone,
        primaryContactNumber: phone,
        countryCode: DEFAULTS.restaurant.countryCode,
        city: DEFAULTS.restaurant.city,
        state: DEFAULTS.restaurant.state,
        status: DEFAULTS.restaurant.status,
        approvedAt: now,
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    { upsert: true },
  );

  const doc = await restaurantCol.findOne(
    { $or: [{ ownerPhone: phone }, { primaryContactNumber: phone }] },
    { projection: { _id: 1, ownerPhone: 1, primaryContactNumber: 1 } },
  );

  return {
    id: doc?._id ? String(doc._id) : null,
    phone,
    upsertedId: result.upsertedId || null,
  };
};

const upsertDeliveryPartner = async () => {
  const phone = normalizePhone(DEFAULTS.delivery.phone);
  const now = new Date();
  const deliveryCol = mongoose.connection.collection("food_delivery_partners");

  const result = await deliveryCol.updateOne(
    { phone },
    {
      $set: {
        name: DEFAULTS.delivery.name,
        phone,
        countryCode: DEFAULTS.delivery.countryCode,
        city: DEFAULTS.delivery.city,
        state: DEFAULTS.delivery.state,
        vehicleType: DEFAULTS.delivery.vehicleType,
        status: DEFAULTS.delivery.status,
        approvedAt: now,
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    { upsert: true },
  );

  const doc = await deliveryCol.findOne({ phone }, { projection: { _id: 1, phone: 1 } });
  return {
    id: doc?._id ? String(doc._id) : null,
    phone,
    upsertedId: result.upsertedId || null,
  };
};

const run = async () => {
  await connect();
  const [restaurant, delivery] = await Promise.all([upsertRestaurant(), upsertDeliveryPartner()]);

  console.log("Food restaurant + delivery partner credentials seeded successfully.");
  console.log("Restaurant:", restaurant);
  console.log("Delivery Partner:", delivery);
  console.log("OTP for delivery/user flows is controlled by env static OTP keys.");
};

run()
  .catch((err) => {
    console.error("Failed to seed food restaurant/delivery credentials:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
  });

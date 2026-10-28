import dotenv from "dotenv";
import mongoose from "mongoose";

import { FoodAdmin } from "../src/core/admin/admin.model.js";
import { FoodUser } from "../src/core/users/user.model.js";
import { FoodRestaurant } from "../src/modules/food/restaurant/models/restaurant.model.js";
import { FoodDeliveryPartner } from "../src/modules/food/delivery/models/deliveryPartner.model.js";

dotenv.config();

// Seed credentials come from the environment so no real password lives in the repo.
// Set SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD in .env before running this script.
const SEED_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || "admin@k9rides.local";
const SEED_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "";

if (!SEED_ADMIN_PASSWORD) {
  console.error(
    "Refusing to seed: SEED_ADMIN_PASSWORD is not set.\n" +
    "Add SEED_ADMIN_PASSWORD=<a strong password> to Backend/.env and re-run."
  );
  process.exit(1);
}

const DEFAULTS = {
  admin: {
    email: SEED_ADMIN_EMAIL,
    password: SEED_ADMIN_PASSWORD,
    name: "K9 Rides Admin",
    servicesAccess: ["food", "quickCommerce", "taxi"],
  },
  user: {
    phone: "9407046608",
    countryCode: "+91",
    name: "K9 Rides User",
  },
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
  otp: "1234",
};

const normalizePhone = (value) => String(value || "").replace(/\D/g, "").slice(-10);

const connect = async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("Missing MONGO_URI / MONGODB_URI in environment.");
  }
  await mongoose.connect(uri);
};

const upsertAdmin = async () => {
  const email = DEFAULTS.admin.email.toLowerCase().trim();
  let admin = await FoodAdmin.findOne({ email });
  if (!admin) {
    admin = new FoodAdmin({ email });
  }

  admin.email = email;
  admin.name = DEFAULTS.admin.name;
  admin.password = DEFAULTS.admin.password; // hashed by model pre-save hook
  admin.isActive = true;
  admin.servicesAccess = DEFAULTS.admin.servicesAccess;
  await admin.save();

  return { id: String(admin._id), email: admin.email };
};

const upsertUser = async () => {
  const phone = normalizePhone(DEFAULTS.user.phone);
  let user = await FoodUser.findOne({ phone });
  if (!user) {
    user = new FoodUser({ phone });
  }

  user.phone = phone;
  user.countryCode = DEFAULTS.user.countryCode;
  user.name = user.name || DEFAULTS.user.name;
  user.isVerified = true;
  user.isActive = true;
  user.role = "USER";
  await user.save();

  return { id: String(user._id), phone: user.phone };
};

const upsertRestaurant = async () => {
  const phone = normalizePhone(DEFAULTS.restaurant.phone);
  let restaurant = await FoodRestaurant.findOne({
    $or: [{ ownerPhone: phone }, { primaryContactNumber: phone }],
  });

  if (!restaurant) {
    restaurant = new FoodRestaurant({
      restaurantName: DEFAULTS.restaurant.restaurantName,
      ownerName: DEFAULTS.restaurant.ownerName,
      ownerPhone: phone,
      primaryContactNumber: phone,
    });
  }

  restaurant.restaurantName = restaurant.restaurantName || DEFAULTS.restaurant.restaurantName;
  restaurant.ownerName = restaurant.ownerName || DEFAULTS.restaurant.ownerName;
  restaurant.ownerEmail = restaurant.ownerEmail || DEFAULTS.restaurant.ownerEmail;
  restaurant.ownerPhone = phone;
  restaurant.primaryContactNumber = phone;
  restaurant.countryCode = DEFAULTS.restaurant.countryCode;
  restaurant.city = restaurant.city || DEFAULTS.restaurant.city;
  restaurant.state = restaurant.state || DEFAULTS.restaurant.state;
  restaurant.status = DEFAULTS.restaurant.status;
  restaurant.approvedAt = new Date();
  restaurant.rejectedAt = undefined;
  restaurant.rejectionReason = "";
  await restaurant.save();

  return { id: String(restaurant._id), phone };
};

const upsertDelivery = async () => {
  const phone = normalizePhone(DEFAULTS.delivery.phone);
  let partner = await FoodDeliveryPartner.findOne({ phone });
  if (!partner) {
    partner = new FoodDeliveryPartner({
      name: DEFAULTS.delivery.name,
      phone,
    });
  }

  partner.name = partner.name || DEFAULTS.delivery.name;
  partner.phone = phone;
  partner.countryCode = DEFAULTS.delivery.countryCode;
  partner.city = partner.city || DEFAULTS.delivery.city;
  partner.state = partner.state || DEFAULTS.delivery.state;
  partner.vehicleType = partner.vehicleType || DEFAULTS.delivery.vehicleType;
  partner.status = DEFAULTS.delivery.status;
  partner.approvedAt = new Date();
  partner.rejectedAt = undefined;
  partner.rejectionReason = "";
  await partner.save();

  return { id: String(partner._id), phone };
};

const run = async () => {
  await connect();

  const [admin, user, restaurant, delivery] = await Promise.all([
    upsertAdmin(),
    upsertUser(),
    upsertRestaurant(),
    upsertDelivery(),
  ]);

  console.log("Default credentials seeded successfully.");
  console.log("Admin:", admin);
  console.log("User:", user);
  console.log("Restaurant:", restaurant);
  console.log("Delivery:", delivery);
  console.log(`OTP for user/restaurant/delivery login: ${DEFAULTS.otp}`);
  console.log("Set USE_DEFAULT_OTP=true in Backend/.env to enforce OTP 1234.");
};

run()
  .catch((err) => {
    console.error("Failed to seed default credentials:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
  });

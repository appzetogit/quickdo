import dotenv from "dotenv";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

import { Driver } from "../src/modules/taxi/driver/models/Driver.js";

dotenv.config();

const DEFAULT_DRIVER = {
  phone: "7974161582",
  name: "Default Taxi Driver",
  vehicleType: "bike",
  password: "driver@123",
};

const normalizePhone = (value) => String(value || "").replace(/\D/g, "").slice(-10);

const connect = async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    throw new Error("Missing MONGODB_URI / MONGO_URI in environment.");
  }

  const dbName = process.env.MONGODB_DB_NAME || undefined;
  await mongoose.connect(uri, dbName ? { dbName } : undefined);
};

const upsertDriver = async () => {
  const phone = normalizePhone(DEFAULT_DRIVER.phone);
  let driver = await Driver.findOne({ phone });
  if (!driver) {
    driver = new Driver({ phone });
  }

  driver.phone = phone;
  driver.name = driver.name || DEFAULT_DRIVER.name;
  driver.vehicleType = driver.vehicleType || DEFAULT_DRIVER.vehicleType;
  driver.password = await bcrypt.hash(DEFAULT_DRIVER.password, 10);
  driver.approve = true;
  driver.status = "approved";
  driver.active = true;
  await driver.save();

  return { id: String(driver._id), phone: driver.phone };
};

const run = async () => {
  await connect();
  const driver = await upsertDriver();

  console.log("Taxi driver default credentials seeded successfully.");
  console.log("Driver:", driver);
  console.log("Login phone:", DEFAULT_DRIVER.phone);
  console.log("OTP is controlled by env: USE_DEFAULT_OTP / STATIC_OTP_PHONE / STATIC_OTP_CODE");
};

run()
  .catch((err) => {
    console.error("Failed to seed taxi driver credentials:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
  });

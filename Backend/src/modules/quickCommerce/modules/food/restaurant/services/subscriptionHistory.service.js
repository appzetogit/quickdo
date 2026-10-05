import mongoose from "mongoose";
import { FoodRestaurant } from "../models/restaurant.model.js";
import { FoodTransaction } from "../../orders/models/foodTransaction.model.js";
import { FoodRestaurantSubscriptionHistory } from "../models/subscriptionHistory.model.js";

const toNum = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const logRestaurantSubscriptionHistory = async (payload = {}) => {
  const restaurantId = String(payload?.restaurantId || "");
  if (!mongoose.Types.ObjectId.isValid(restaurantId)) return null;
  if (!payload?.eventType) return null;

  return FoodRestaurantSubscriptionHistory.create({
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
    eventType: String(payload.eventType),
    plan: String(payload.plan || "").toLowerCase(),
    paymentType: String(payload.paymentType || "").toLowerCase(),
    amount: Math.max(0, toNum(payload.amount, 0)),
    dueBefore: Math.max(0, toNum(payload.dueBefore, 0)),
    dueAfter: Math.max(0, toNum(payload.dueAfter, 0)),
    paidBefore: Math.max(0, toNum(payload.paidBefore, 0)),
    paidAfter: Math.max(0, toNum(payload.paidAfter, 0)),
    gmvLast30Days: Math.max(0, toNum(payload.gmvLast30Days, 0)),
    note: String(payload.note || "").trim(),
    metadata: payload?.metadata && typeof payload.metadata === "object" ? payload.metadata : {},
  });
};

export const getRestaurantSubscriptionHistory = async (restaurantId, query = {}) => {
  if (!restaurantId || !mongoose.Types.ObjectId.isValid(String(restaurantId))) {
    return { items: [], page: 1, limit: 20, total: 0 };
  }
  const page = Math.max(1, Number(query?.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query?.limit) || 20));
  const skip = (page - 1) * limit;
  const rid = new mongoose.Types.ObjectId(String(restaurantId));

  const [items, total, restaurant] = await Promise.all([
    FoodRestaurantSubscriptionHistory.find({ restaurantId: rid })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    FoodRestaurantSubscriptionHistory.countDocuments({ restaurantId: rid }),
    FoodRestaurant.findById(rid)
      .select("subscriptionPlan subscriptionAmount subscriptionPaidAmount subscriptionDueAmount subscriptionStatus subscriptionValidTill createdAt updatedAt")
      .lean(),
  ]);

  if (total > 0 || !restaurant) {
    return { items, page, limit, total };
  }

  // Backward-compatible fallback for restaurants created before history logging was introduced.
  const fallbackItem = {
    _id: `fallback-${String(restaurant._id)}`,
    restaurantId: restaurant._id,
    eventType: "subscription_payment",
    plan: String(restaurant.subscriptionPlan || "").toLowerCase(),
    paymentType: "legacy",
    amount: Math.max(0, toNum(restaurant.subscriptionPaidAmount, 0)),
    dueBefore: Math.max(0, toNum(restaurant.subscriptionAmount, 0)),
    dueAfter: Math.max(0, toNum(restaurant.subscriptionDueAmount, 0)),
    paidBefore: 0,
    paidAfter: Math.max(0, toNum(restaurant.subscriptionPaidAmount, 0)),
    gmvLast30Days: 0,
    note: "Legacy subscription state imported for history visibility",
    metadata: { source: "fallback_legacy_subscription" },
    createdAt: restaurant.updatedAt || restaurant.createdAt || new Date(),
    updatedAt: restaurant.updatedAt || restaurant.createdAt || new Date(),
  };

  return { items: [fallbackItem], page, limit, total: 1 };
};

export const getAdminRestaurantSubscriptionHistory = async (query = {}) => {
  const page = Math.max(1, Number(query?.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query?.limit) || 20));
  const skip = (page - 1) * limit;
  const search = String(query?.search || "").trim();

  const filter = { status: "approved" };
  if (search) {
    const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ restaurantName: regex }, { ownerName: regex }, { ownerPhone: regex }];
  }

  const [rows, total] = await Promise.all([
    FoodRestaurant.find(filter)
      .select("restaurantName ownerName ownerPhone subscriptionPlan subscriptionStatus subscriptionDueAmount subscriptionValidTill subscriptionAutoDeductedAmount")
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    FoodRestaurant.countDocuments(filter),
  ]);

  const ids = rows.map((row) => row?._id).filter(Boolean);
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - 30);

  const [gmvAgg, historyAgg] = await Promise.all([
    FoodTransaction.aggregate([
      {
        $match: {
          restaurantId: { $in: ids },
          status: { $in: ["authorized", "captured"] },
          createdAt: { $gte: start, $lte: now },
        },
      },
      {
        $group: {
          _id: "$restaurantId",
          gmvLast30Days: { $sum: { $ifNull: ["$amounts.restaurantShare", 0] } },
        },
      },
    ]),
    FoodRestaurantSubscriptionHistory.aggregate([
      { $match: { restaurantId: { $in: ids } } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$restaurantId",
          lastEventAt: { $first: "$createdAt" },
          totalAutoDeducted: {
            $sum: {
              $cond: [{ $eq: ["$eventType", "subscription_auto_deduct"] }, { $ifNull: ["$amount", 0] }, 0],
            },
          },
        },
      },
    ]),
  ]);

  const gmvMap = new Map(gmvAgg.map((row) => [String(row._id), Math.max(0, toNum(row.gmvLast30Days, 0))]));
  const historyMap = new Map(historyAgg.map((row) => [String(row._id), row]));

  const items = rows.map((row) => {
    const id = String(row._id);
    const h = historyMap.get(id);
    return {
      ...row,
      gmvLast30Days: gmvMap.get(id) || 0,
      totalAutoDeducted: Math.max(
        0,
        toNum(h?.totalAutoDeducted, 0),
        toNum(row?.subscriptionAutoDeductedAmount, 0)
      ),
      lastEventAt: h?.lastEventAt || null,
    };
  });

  return { items, page, limit, total };
};

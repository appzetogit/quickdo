const axios = require('axios');

/**
 * Location Service
 * Handles location-based operations using Google Maps API
 */

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const GOOGLE_MAPS_API_URL = 'https://maps.googleapis.com/maps/api';

/**
 * Calculate distance between two coordinates using Haversine formula
 * @param {Object} coord1 - {lat, lng}
 * @param {Object} coord2 - {lat, lng}
 * @returns {number} Distance in kilometers
 */
const calculateDistance = (coord1, coord2) => {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (coord2.lat - coord1.lat) * Math.PI / 180;
  const dLng = (coord2.lng - coord1.lng) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(coord1.lat * Math.PI / 180) * Math.cos(coord2.lat * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

/**
 * Geocode address to coordinates using Google Maps API
 * @param {string} address - Full address string
 * @returns {Promise<Object>} {lat, lng} coordinates
 */
const geocodeAddress = async (address) => {
  try {
    if (!GOOGLE_MAPS_API_KEY) {
      console.warn('Google Maps API key not configured, geocoding skipped');
      return null;
    }

    const response = await axios.get(`${GOOGLE_MAPS_API_URL}/geocode/json`, {
      params: {
        address: address,
        key: GOOGLE_MAPS_API_KEY
      }
    });

    if (response.data.status === 'OK' && response.data.results.length > 0) {
      const location = response.data.results[0].geometry.location;
      return {
        lat: location.lat,
        lng: location.lng
      };
    }

    throw new Error(`Geocoding failed: ${response.data.status}`);
  } catch (error) {
    console.error('Geocoding error:', error);
    return null;
  }
};

const _buildVendorQuery = (filters = {}) => {
  const { VENDOR_STATUS } = require('../utils/constants');

  const checkCashLimit = filters.checkCashLimit;
  const serviceCategory = filters.service;

  const queryFilters = { ...filters };
  delete queryFilters.checkCashLimit;
  delete queryFilters.service;
  delete queryFilters.city;

  const baseQuery = {
    approvalStatus: VENDOR_STATUS.APPROVED,
    isActive: true,
    ...queryFilters
  };

  if (filters.city) {
    baseQuery['address.city'] = { $regex: new RegExp(filters.city, 'i') };
  }

  if (serviceCategory) {
    baseQuery.$or = [
      { categories: { $in: [serviceCategory] } },
      { service: { $in: [serviceCategory] } }
    ];
  }

  // The cash-limit check is no longer in the query: the limit now comes from
  // Platform settings (which the database cannot evaluate per vendor), so it is
  // applied to the results by withinCashLimit() below. checkCashLimit is still
  // read by the callers.
  void checkCashLimit;

  return baseQuery;
};

/*
 * Keep vendors whose dues are within their effective cash limit, then drop the
 * wallet from the result so dues never travel with a vendor into booking payloads.
 * One settings read for the whole candidate list (utils/cashLimit.js).
 */
const withinCashLimit = async (vendors, filters = {}) => {
  let kept = vendors;
  if (filters.checkCashLimit && vendors.length) {
    const { effectiveCashLimits } = require('../utils/cashLimit');
    const limits = await effectiveCashLimits(vendors);
    kept = vendors.filter((v) => (Number(v.wallet?.dues) || 0) <= (limits.get(String(v._id))?.limit ?? Infinity));
  }
  return kept.map(({ wallet, ...rest }) => rest);
};

/**
 * Find vendors within specified radius of a location
 */
const findNearbyVendors = async (centerLocation, radiusKm = 10, filters = {}) => {
  const Vendor = require('../models/Vendor');
  const Settings = require('../models/Settings');
  const { VENDOR_STATUS } = require('../utils/constants');
  const { getNearbyVendorsFromCache, isRedisConnected } = require('./redisService');

  if (!centerLocation || typeof centerLocation.lat !== 'number' || typeof centerLocation.lng !== 'number') {
    console.warn('[LocationService] Invalid coordinates. City fallback for:', filters.city);
    if (filters.city) {
      return findVendorsByCity(filters.city, filters);
    }
    return [];
  }

  try {
    // Fetch default radius from settings
    if (radiusKm === 10) {
      const globalSettings = await Settings.findOne({ type: 'global' }).select('searchRadius').lean();
      if (globalSettings?.searchRadius) radiusKm = globalSettings.searchRadius;
    }

    const baseQuery = _buildVendorQuery(filters);
    // VENDOR_STATUS.APPROVED is 'approved'. This diagnostic used a hardcoded
    // uppercase 'APPROVED', which matches nothing, so it always logged 0 --
    // including while the query below was successfully returning vendors.
    const totalApprovedVendors = await Vendor.countDocuments({ approvalStatus: VENDOR_STATUS.APPROVED, isActive: true });
    console.log(`[LocationService] Total Approved/Active Vendors in DB: ${totalApprovedVendors}`);
    console.log(`[LocationService] Searching with query: ${JSON.stringify(baseQuery)}`);


    // OPTION 1: Try Redis geo cache first (fastest - <5ms)
    if (isRedisConnected()) {
      const cachedVendors = await getNearbyVendorsFromCache(centerLocation.lat, centerLocation.lng, radiusKm);

      if (cachedVendors && cachedVendors.length > 0) {
        console.log(`[LocationService] Found ${cachedVendors.length} vendors from Redis cache`);

        // Fetch full vendor details from MongoDB
        const vendorIds = cachedVendors.map(v => v.vendorId);
        const vendors = await Vendor.find({
          _id: { $in: vendorIds },
          ...baseQuery
        }).select('name businessName phone address profilePhoto service rating isOnline availability geoLocation wallet.dues wallet.cashLimit');

        // Merge distance from cache
        const vendorMap = new Map(vendors.map(v => [v._id.toString(), v.toObject()]));
        const result = cachedVendors
          .filter(cv => vendorMap.has(cv.vendorId))
          .map(cv => ({
            ...vendorMap.get(cv.vendorId),
            distance: cv.distance
          }));

        console.log(`[LocationService] Found ${result.length} matching vendors via Redis path`);
        return withinCashLimit(result, filters);
      }
    }

    // OPTION 2: Try MongoDB 2dsphere geo query (fast)
    let nearbyVendors = [];

    try {
      // Check if any vendors have geoLocation set
      const hasGeoVendors = await Vendor.countDocuments({
        ...baseQuery,
        'geoLocation.coordinates': { $ne: [0, 0] }
      });

      if (hasGeoVendors > 0) {
        // Use fast 2dsphere query
        nearbyVendors = await Vendor.find({
          ...baseQuery,
          geoLocation: {
            $near: {
              $geometry: {
                type: 'Point',
                coordinates: [centerLocation.lng, centerLocation.lat] // GeoJSON is [lng, lat]
              },
              $maxDistance: radiusKm * 1000 // Convert km to meters
            }
          }
        })
          .select('name businessName phone address profilePhoto service rating isOnline availability geoLocation settings wallet.dues wallet.cashLimit')
          .limit(50); // Increased limit as we filter below

        // Calculate distance for each vendor
        nearbyVendors = nearbyVendors.map(vendor => {
          const vendorObj = vendor.toObject();
          if (vendor.geoLocation && vendor.geoLocation.coordinates) {
            vendorObj.distance = calculateDistance(centerLocation, {
              lat: vendor.geoLocation.coordinates[1],
              lng: vendor.geoLocation.coordinates[0]
            });
          } else {
            vendorObj.distance = null;
          }
          return vendorObj;
        });

        // Filter by individual vendor range
        nearbyVendors = nearbyVendors.filter(v => {
          const vRange = v.settings?.serviceRange || radiusKm;
          return v.distance <= vRange;
        });

        console.log(`[LocationService] Found ${nearbyVendors.length} vendors using 2dsphere query`);
        return withinCashLimit(nearbyVendors, filters);
      }
    } catch (geoError) {
      console.warn('[LocationService] 2dsphere query failed, falling back to Haversine:', geoError.message);
    }

    // Fallback: Use Haversine formula (slower but works without geo index)
    const vendors = await Vendor.find(baseQuery)
      .select('name businessName phone address location profilePhoto service rating isOnline availability settings wallet.dues wallet.cashLimit');

    console.log(`[LocationService] Haversine fallback: found ${vendors.length} vendors matching baseQuery before distance filter`);

    // Calculate distances and filter by radius
    nearbyVendors = vendors.map(vendor => {
      let distance = null;

      // PRIORITY: Use real-time location (location) first, then registered address
      const vLat = vendor.location?.lat || vendor.address?.lat;
      const vLng = vendor.location?.lng || vendor.address?.lng;

      if (vLat && vLng) {
        distance = calculateDistance(centerLocation, {
          lat: vLat,
          lng: vLng
        });
      }

      const vRange = vendor.settings?.serviceRange || radiusKm;
      return {
        ...vendor.toObject(),
        distance: distance,
        withinRange: distance !== null && distance <= vRange,
        isUsingCurrentLocation: !!vendor.location?.lat // Flag for debugging
      };
    }).filter(vendor => vendor.withinRange);

    const currentLocCount = nearbyVendors.filter(v => v.isUsingCurrentLocation).length;
    console.log(`[LocationService] Found ${nearbyVendors.length} vendors (Online/Current: ${currentLocCount}) using Haversine`);
    return withinCashLimit(nearbyVendors, filters);
  } catch (error) {
    console.error('Find nearby vendors error:', error);
    return [];
  }
};

const getDistanceMatrix = async (origins, destinations) => {
  try {
    if (!GOOGLE_MAPS_API_KEY) {
      console.warn('Google Maps API key not configured, using mock distances');
      // Return mock distances
      return origins.map(() => destinations.map(() => ({ distance: { value: 5000 } })));
    }

    const originsStr = origins.map(coord => `${coord.lat},${coord.lng}`).join('|');
    const destinationsStr = destinations.map(coord => `${coord.lat},${coord.lng}`).join('|');

    const response = await axios.get(`${GOOGLE_MAPS_API_URL}/distancematrix/json`, {
      params: {
        origins: originsStr,
        destinations: destinationsStr,
        key: GOOGLE_MAPS_API_KEY,
        units: 'metric'
      }
    });

    return response.data.rows;
  } catch (error) {
    console.error('Distance matrix error:', error);
    return [];
  }
};

/**
 * Find vendors in a specific city (fallback when coordinates are missing)
 * @param {string} city - City name
 * @param {Object} filters - Additional filters
 * @returns {Promise<Array>} Array of vendors
 */
const findVendorsByCity = async (city, filters = {}) => {
  try {
    const Vendor = require('../models/Vendor');
    const baseQuery = _buildVendorQuery({ ...filters, city });

    console.log(`[LocationService] City search query: ${JSON.stringify(baseQuery)}`);
    const vendors = await Vendor.find(baseQuery)
      .select('name businessName phone address location profilePhoto service rating isOnline availability settings wallet.dues wallet.cashLimit')
      .limit(50);

    console.log(`[LocationService] Found ${vendors.length} vendors in city: ${city}`);
    return withinCashLimit(vendors.map(v => ({ ...v.toObject(), distance: null })), filters);
  } catch (error) {
    console.error('Find vendors by city error:', error);
    return [];
  }
};

/**
 * Find workers within specified radius of a location
 * Criteria: Online, Approved, Active Subscription, Matching Expertise
 */
const findNearbyWorkers = async (centerLocation, radiusKm = 10, filters = {}) => {
  const Worker = require('../models/Worker');
  const Settings = require('../models/Settings');

  if (!centerLocation || typeof centerLocation.lat !== 'number' || typeof centerLocation.lng !== 'number') {
    return [];
  }

  try {
    // Fetch default radius from settings
    if (radiusKm === 10) {
      const globalSettings = await Settings.findOne({ type: 'global' }).select('searchRadius').lean();
      if (globalSettings?.searchRadius) radiusKm = globalSettings.searchRadius;
    }

    const serviceCategory = filters.service;

    // Base query for Workers
    const baseQuery = {
      approvalStatus: 'approved',
      isActive: true,
      status: 'ONLINE', // Manual duty switch (ensures off-duty workers aren't disturbed)
      // isOnline is NOT checked here so FCM can wake up killed apps if duty is ONLINE
      'subscription.isActive': true,
      'subscription.expiryDate': { $gt: new Date() }
    };

    if (serviceCategory) {
      baseQuery.serviceCategories = { $in: [serviceCategory] };
    }

    console.log(`[LocationService] Searching workers with query: ${JSON.stringify(baseQuery)}`);

    // Use 2dsphere query
    let nearbyWorkers = await Worker.find({
      ...baseQuery,
      geoLocation: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [centerLocation.lng, centerLocation.lat]
          },
          $maxDistance: radiusKm * 1000
        }
      }
    }).select('name phone profilePhoto serviceCategories rating totalJobs location geoLocation subscription fcmTokens fcmTokenMobile').limit(50);

    // Fallback: If no workers within 2dsphere radius, find any active online approved workers
    if (nearbyWorkers.length === 0) {
      console.log('[LocationService] ⚠️ No 2dsphere GPS workers found. Running fallback search for approved online workers...');
      nearbyWorkers = await Worker.find(baseQuery)
        .select('name phone profilePhoto serviceCategories rating totalJobs location geoLocation subscription fcmTokens fcmTokenMobile')
        .limit(10);
    }

    // Calculate distance and format
    return nearbyWorkers.map(worker => {
      const workerObj = worker.toObject();
      if (worker.geoLocation && worker.geoLocation.coordinates) {
        workerObj.distance = calculateDistance(centerLocation, {
          lat: worker.geoLocation.coordinates[1],
          lng: worker.geoLocation.coordinates[0]
        });
      } else {
        workerObj.distance = null;
      }
      return workerObj;
    });

  } catch (error) {
    console.error('Find nearby workers error:', error);
    return [];
  }
};

module.exports = {
  geocodeAddress,
  findNearbyVendors,
  findNearbyWorkers,
  findVendorsByCity,
  calculateDistance,
  getDistanceMatrix
};

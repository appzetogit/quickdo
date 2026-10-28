const Scrap = require('../models/Scrap');
const User = require('../models/User');
const Admin = require('../models/Admin');
const { validationResult } = require('express-validator');
const { createNotification } = require('./notificationControllers/notificationController');

// Create a new scrap item (User)
exports.createScrap = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { title, description, images, address } = req.body;

    const scrap = new Scrap({
      userId: req.user.id,
      title,
      description,
      images,
      address
    });

    await scrap.save();

    // Fetch user details for notification
    const user = await User.findById(req.user.id);

    // Notify User
    await createNotification({
      userId: req.user.id,
      type: 'scrap_listed',
      title: 'Scrap Listed Successfully',
      message: `Your scrap item "${scrap.title}" has been listed. Vendors in your area will be notified.`,
      relatedId: scrap._id,
      relatedType: 'scrap'
    });

    // Notify Admins
    const admins = await Admin.find({});
    for (const admin of admins) {
      await createNotification({
        adminId: admin._id,
        type: 'new_scrap_added',
        title: 'New Scrap Item',
        message: `${user ? user.name : 'A user'} has added a new scrap item: "${scrap.title}"`,
        relatedId: scrap._id,
        relatedType: 'scrap'
      });
    }

    res.status(201).json({
      success: true,
      data: scrap,
      message: 'Scrap item listed successfully'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// Get list of scrap items for the logged-in user
exports.getMyScrap = async (req, res) => {
  try {
    const scraps = await Scrap.find({ userId: req.user.id }).sort({ createdAt: -1 });
    res.json({ success: true, data: scraps });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// Get scrap items accepted by vendor
exports.getMyAcceptedScrap = async (req, res) => {
  try {
    const scraps = await Scrap.find({ vendorId: req.user.id })
      .populate('userId', 'name phone address')
      .sort({ updatedAt: -1 });
    res.json({ success: true, data: scraps });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// Get all pending scrap items (Vendor view)
// Can filter by nearby location logic
exports.getAvailableScrap = async (req, res) => {
  try {
    // Return all pending items
    const scraps = await Scrap.find({ status: 'pending' })
      .populate('userId', 'name phone')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: scraps });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// Vendor accepts/buys a scrap request
exports.acceptScrap = async (req, res) => {
  try {
    const { id } = req.params;
    const vendorId = req.user.id; // vendor middleware ensures this

    const scrap = await Scrap.findById(id);
    if (!scrap) return res.status(404).json({ success: false, message: 'Scrap item not found' });

    if (scrap.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Item already taken or cancelled' });
    }

    scrap.status = 'accepted';
    scrap.vendorId = vendorId;
    scrap.pickupDate = new Date(); // Default to now, or accept from body
    await scrap.save();

    // Customize message based on acceptor role
    const { USER_ROLES } = require('../utils/constants');
    const isVendor = req.userRole === USER_ROLES.VENDOR;
    const acceptorType = isVendor ? 'A vendor' : 'An admin';

    // Notify User
    await createNotification({
      userId: scrap.userId,
      type: 'scrap_accepted',
      title: 'Scrap Request Accepted!',
      message: `${acceptorType} has accepted your scrap request for "${scrap.title}". They will contact you shortly.`,
      relatedId: scrap._id,
      relatedType: 'scrap'
    });

    res.json({ success: true, data: scrap, message: 'Request accepted. Please contact user for pickup.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// Vendor marks item as picked up / completed
exports.completeScrap = async (req, res) => {
  try {
    const { id } = req.params;
    const { finalPrice } = req.body;

    const scrap = await Scrap.findById(id);
    if (!scrap) return res.status(404).json({ success: false, message: 'Scrap item not found' });

    // Check if the user is the assigned vendor OR an admin
    const { USER_ROLES } = require('../utils/constants');
    const isAdmin = req.userRole === USER_ROLES.ADMIN || req.userRole === 'admin' || req.userRole === 'super_admin';

    if (scrap.vendorId && scrap.vendorId.toString() !== req.user.id && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    scrap.status = 'completed';
    if (finalPrice) scrap.finalPrice = finalPrice;
    await scrap.save();

    // Notify User
    await createNotification({
      userId: scrap.userId,
      type: 'scrap_completed',
      title: 'Scrap Pickup Completed',
      message: `Your scrap item "${scrap.title}" has been successfully picked up and completed.`,
      relatedId: scrap._id,
      relatedType: 'scrap'
    });

    res.json({ success: true, data: scrap, message: 'Transactions completed' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// Admin: Get all scrap items
exports.getAllScrapAdmin = async (req, res) => {
  try {
    const scraps = await Scrap.find({})
      .populate('userId', 'name email phone')
      .populate('vendorId', 'name businessName phone')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: scraps });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// Get single scrap by ID
exports.getScrapById = async (req, res) => {
  try {
    const scrap = await Scrap.findById(req.params.id)
      .populate('userId', 'name phone email profilePhoto')
      .populate('vendorId', 'name businessName phone profilePhoto');

    if (!scrap) {
      return res.status(404).json({ success: false, message: 'Scrap not found' });
    }

    /*
     * Any logged-in user, vendor or worker could read any scrap request: the
     * customer's pickup address and coordinates, name, phone and email. Now the
     * owner, the vendor who accepted it and admins see it in full; other vendors see
     * only PENDING requests (the marketplace they accept from) without the customer's
     * contact details; everyone else gets 404.
     */
    const role = String(req.userRole || '').toUpperCase();
    const me = String(req.user?.id || req.user?._id || '');
    const ownerId = String(scrap.userId?._id || scrap.userId || '');
    const vendorId = String(scrap.vendorId?._id || scrap.vendorId || '');
    const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(role);
    const isOwner = role === 'USER' && ownerId === me;
    const isAssignedVendor = role === 'VENDOR' && vendorId === me;

    if (isAdmin || isOwner || isAssignedVendor) {
      return res.json({ success: true, data: scrap });
    }
    if (role === 'VENDOR' && scrap.status === 'pending') {
      const data = scrap.toObject();
      if (data.userId && typeof data.userId === 'object') {
        data.userId = { _id: data.userId._id, name: data.userId.name, profilePhoto: data.userId.profilePhoto };
      }
      return res.json({ success: true, data });
    }
    return res.status(404).json({ success: false, message: 'Scrap not found' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// Delete scrap item
exports.deleteScrap = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role; // e.g., 'ADMIN', 'USER'

    const scrap = await Scrap.findById(id);
    if (!scrap) return res.status(404).json({ success: false, message: 'Scrap item not found' });

    // Authorization check
    // Allow deletion if:
    // 1. User is the creator of the scrap item
    // 2. User is an Admin
    const isOwner = scrap.userId.toString() === userId;
    const isAdmin = ['ADMIN', 'admin', 'super_admin'].includes(userRole);

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Not authorized to delete this item' });
    }

    await Scrap.findByIdAndDelete(id);

    res.json({ success: true, message: 'Scrap item deleted successfully' });
  } catch (error) {
    console.error('Delete scrap error:', error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

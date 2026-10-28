const Admin = require('../../models/Admin');
const { validationResult } = require('express-validator');

/**
 * Get all admins (Super Admin only)
 */
const getAllAdmins = async (req, res) => {
  try {
    const admins = await Admin.find()
      .select('-password')
      .populate('cityId', 'name')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: admins
    });
  } catch (error) {
    console.error('Get all admins error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch admins' });
  }
};

/**
 * Create new admin (Super Admin only)
 */
const createAdmin = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { name, email, password, role, cityId, cityName } = req.body;

    // Check if admin already exists
    const existingAdmin = await Admin.findOne({ email });
    if (existingAdmin) {
      return res.status(400).json({
        success: false,
        message: 'Admin with this email already exists'
      });
    }

    // Create new admin
    const admin = await Admin.create({
      name,
      email,
      password,
      role: role || 'admin',
      cityId: cityId || null,
      cityName: cityName || ''
    });

    res.status(201).json({
      success: true,
      message: 'Admin created successfully',
      data: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        cityId: admin.cityId,
        cityName: admin.cityName
      }
    });
  } catch (error) {
    console.error('Create admin error:', error);
    res.status(500).json({ success: false, message: 'Failed to create admin' });
  }
};

/**
 * Delete admin (Super Admin only)
 * Note: Primary super admin (admin@admin.com) cannot be deleted
 */
const deleteAdmin = async (req, res) => {
  try {
    const { id } = req.params;

    // Prevent self-deletion
    if (id === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete your own account'
      });
    }

    const admin = await Admin.findById(id);
    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }

    // Protect primary super admin
    if (admin.email === 'admin@admin.com') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete the primary super admin account'
      });
    }

    await Admin.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: 'Admin deleted successfully'
    });
  } catch (error) {
    console.error('Delete admin error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete admin' });
  }
};

/**
 * Update admin role (Super Admin only)
 */
const updateAdminRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!['super_admin', 'admin'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role. Must be super_admin or admin'
      });
    }

    // Prevent self-demotion
    if (id === req.user.id && role !== 'super_admin') {
      return res.status(400).json({
        success: false,
        message: 'Cannot change your own role'
      });
    }

    const admin = await Admin.findByIdAndUpdate(
      id,
      { role },
      { new: true }
    ).select('-password');

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Admin role updated successfully',
      data: admin
    });
  } catch (error) {
    console.error('Update admin role error:', error);
    res.status(500).json({ success: false, message: 'Failed to update admin role' });
  }
};

module.exports = {
  getAllAdmins,
  createAdmin,
  deleteAdmin,
  updateAdminRole,

  /**
   * Update admin details (Super Admin only)
   */
  updateAdmin: async (req, res) => {
    try {
      const { id } = req.params;
      const { name, email, password, role, cityId, cityName } = req.body;

      // Find admin
      let admin = await Admin.findById(id);
      if (!admin) {
        return res.status(404).json({ success: false, message: 'Admin not found' });
      }

      // Check email uniqueness if changed
      if (email && email !== admin.email) {
        const existing = await Admin.findOne({ email });
        if (existing) {
          return res.status(400).json({ success: false, message: 'Email already in use' });
        }
      }

      // Update fields
      if (name) admin.name = name;
      if (email) admin.email = email;
      if (password) admin.password = password; // Pre-save hook will hash it
      if (cityId !== undefined) admin.cityId = cityId || null; // Allow clearing city
      if (cityName !== undefined) admin.cityName = cityName || '';

      if (role && ['super_admin', 'admin'].includes(role)) {
        // Prevent self-demotion
        if (id === req.user.id && role !== 'super_admin' && admin.role === 'super_admin') {
          return res.status(400).json({ success: false, message: 'Cannot demote yourself' });
        }
        admin.role = role;
      }

      await admin.save();

      // Populate city for response
      await admin.populate('cityId', 'name');

      res.status(200).json({
        success: true,
        message: 'Admin updated successfully',
        data: {
          id: admin._id,
          name: admin.name,
          email: admin.email,
          role: admin.role,
          cityId: admin.cityId,
          cityName: admin.cityName,
          isActive: admin.isActive
        }
      });
    } catch (error) {
      console.error('Update admin error:', error);
      res.status(500).json({ success: false, message: 'Failed to update admin' });
    }
  },

  /**
   * Toggle admin status (Block/Unblock)
   */
  toggleAdminStatus: async (req, res) => {
    try {
      const { id } = req.params;

      // Prevent self-blocking
      if (id === req.user.id) {
        return res.status(400).json({ success: false, message: 'Cannot block yourself' });
      }

      const admin = await Admin.findById(id);
      if (!admin) {
        return res.status(404).json({ success: false, message: 'Admin not found' });
      }

      // Protect primary super admin
      if (admin.email === 'admin@admin.com') {
        return res.status(400).json({ success: false, message: 'Cannot block primary super admin' });
      }

      admin.isActive = !admin.isActive;
      await admin.save();

      res.status(200).json({
        success: true,
        message: `Admin ${admin.isActive ? 'unblocked' : 'blocked'} successfully`,
        data: { isActive: admin.isActive }
      });
    } catch (error) {
      console.error('Toggle status error:', error);
      res.status(500).json({ success: false, message: 'Failed to update status' });
    }
  }
};

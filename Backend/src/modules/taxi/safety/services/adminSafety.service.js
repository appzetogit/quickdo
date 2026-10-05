import EmergencyAlert from '../models/EmergencyAlert.js';
import SafetyReport from '../models/SafetyReport.js';
import RideCheckLog from '../models/RideCheckLog.js';
import SafetyTip from '../models/SafetyTip.js';
import EmergencySetting from '../models/EmergencySetting.js';

class AdminSafetyService {
  async getSettings() {
    let settings = await EmergencySetting.findOne();
    if (!settings) {
      settings = await EmergencySetting.create({});
    }
    return settings;
  }

  async updateSettings(data) {
    return EmergencySetting.findOneAndUpdate({}, data, { new: true, upsert: true });
  }

  async getEmergencyAlerts(filters = {}, pagination = { page: 1, limit: 20 }) {
    const query = {};
    if (filters.status) query.status = filters.status;
    if (filters.alert_type) query.alert_type = filters.alert_type;
    
    const skip = (pagination.page - 1) * pagination.limit;
    
    const alerts = await EmergencyAlert.find(query)
      .populate('user_id', 'name phone email')
      .populate('driver_id', 'name phone')
      .populate('trip_id', 'booking_reference pickup_location dropoff_location')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pagination.limit);
      
    const total = await EmergencyAlert.countDocuments(query);
    
    return { alerts, total, page: pagination.page, limit: pagination.limit };
  }

  async updateAlertStatus(alertId, status, note, adminId) {
    return EmergencyAlert.findByIdAndUpdate(
      alertId,
      { status, admin_note: note, resolved_by: adminId },
      { new: true }
    );
  }

  async getSafetyReports(filters = {}, pagination = { page: 1, limit: 20 }) {
    const query = {};
    if (filters.status) query.status = filters.status;
    
    const skip = (pagination.page - 1) * pagination.limit;
    
    const reports = await SafetyReport.find(query)
      .populate('user_id', 'name phone')
      .populate('driver_id', 'name phone')
      .populate('trip_id', 'booking_reference')
      .populate('assigned_admin_id', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pagination.limit);
      
    const total = await SafetyReport.countDocuments(query);
    
    return { reports, total, page: pagination.page, limit: pagination.limit };
  }

  async updateReportStatus(reportId, data, adminId) {
    return SafetyReport.findByIdAndUpdate(
      reportId,
      { ...data, assigned_admin_id: adminId },
      { new: true }
    );
  }

  async getRideCheckLogs(filters = {}, pagination = { page: 1, limit: 20 }) {
    const query = {};
    if (filters.user_response) query.user_response = filters.user_response;
    
    const skip = (pagination.page - 1) * pagination.limit;
    
    const logs = await RideCheckLog.find(query)
      .populate('user_id', 'name phone')
      .populate('trip_id', 'booking_reference')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pagination.limit);
      
    const total = await RideCheckLog.countDocuments(query);
    
    return { logs, total, page: pagination.page, limit: pagination.limit };
  }

  async getSafetyTips() {
    return SafetyTip.find().sort({ priority: -1, createdAt: -1 });
  }

  async addSafetyTip(data) {
    const tip = new SafetyTip(data);
    return tip.save();
  }

  async updateSafetyTip(tipId, data) {
    return SafetyTip.findByIdAndUpdate(tipId, data, { new: true });
  }

  async deleteSafetyTip(tipId) {
    return SafetyTip.findByIdAndDelete(tipId);
  }

  async getAnalytics() {
    const [totalAlerts, activeAlerts, totalReports, unresolvedReports] = await Promise.all([
      EmergencyAlert.countDocuments(),
      EmergencyAlert.countDocuments({ status: { $in: ['new', 'investigating'] } }),
      SafetyReport.countDocuments(),
      SafetyReport.countDocuments({ status: { $in: ['pending', 'investigating'] } }),
    ]);

    return {
      alerts: { total: totalAlerts, active: activeAlerts },
      reports: { total: totalReports, unresolved: unresolvedReports },
    };
  }
}

export default new AdminSafetyService();

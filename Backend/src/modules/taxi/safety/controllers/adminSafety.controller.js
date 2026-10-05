import adminSafetyService from '../services/adminSafety.service.js';

export const getSettings = async (req, res, next) => {
  try {
    const settings = await adminSafetyService.getSettings();
    res.status(200).json({ success: true, data: settings });
  } catch (error) {
    next(error);
  }
};

export const updateSettings = async (req, res, next) => {
  try {
    const settings = await adminSafetyService.updateSettings(req.body);
    res.status(200).json({ success: true, data: settings });
  } catch (error) {
    next(error);
  }
};

export const getAlerts = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status, alert_type } = req.query;
    const result = await adminSafetyService.getEmergencyAlerts(
      { status, alert_type },
      { page: parseInt(page), limit: parseInt(limit) }
    );
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

export const updateAlertStatus = async (req, res, next) => {
  try {
    const { status, note } = req.body;
    const alert = await adminSafetyService.updateAlertStatus(req.params.id, status, note, req.user._id);
    res.status(200).json({ success: true, data: alert });
  } catch (error) {
    next(error);
  }
};

export const getReports = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const result = await adminSafetyService.getSafetyReports(
      { status },
      { page: parseInt(page), limit: parseInt(limit) }
    );
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

export const updateReportStatus = async (req, res, next) => {
  try {
    const report = await adminSafetyService.updateReportStatus(req.params.id, req.body, req.user._id);
    res.status(200).json({ success: true, data: report });
  } catch (error) {
    next(error);
  }
};

export const getRideCheckLogs = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, user_response } = req.query;
    const result = await adminSafetyService.getRideCheckLogs(
      { user_response },
      { page: parseInt(page), limit: parseInt(limit) }
    );
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

export const getAnalytics = async (req, res, next) => {
  try {
    const data = await adminSafetyService.getAnalytics();
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const getSafetyTips = async (req, res, next) => {
  try {
    const tips = await adminSafetyService.getSafetyTips();
    res.status(200).json({ success: true, data: tips });
  } catch (error) {
    next(error);
  }
};

export const addSafetyTip = async (req, res, next) => {
  try {
    const tip = await adminSafetyService.addSafetyTip(req.body);
    res.status(201).json({ success: true, data: tip });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const updateSafetyTip = async (req, res, next) => {
  try {
    const tip = await adminSafetyService.updateSafetyTip(req.params.id, req.body);
    res.status(200).json({ success: true, data: tip });
  } catch (error) {
    next(error);
  }
};

export const deleteSafetyTip = async (req, res, next) => {
  try {
    await adminSafetyService.deleteSafetyTip(req.params.id);
    res.status(200).json({ success: true, message: 'Tip deleted' });
  } catch (error) {
    next(error);
  }
};

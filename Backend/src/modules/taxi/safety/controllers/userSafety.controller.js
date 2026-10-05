import userSafetyService from '../services/userSafety.service.js';

export const getTrustedContacts = async (req, res, next) => {
  try {
    const contacts = await userSafetyService.getTrustedContacts(req.user._id);
    res.status(200).json({ success: true, data: contacts });
  } catch (error) {
    next(error);
  }
};

export const addTrustedContact = async (req, res, next) => {
  try {
    const contact = await userSafetyService.addTrustedContact(req.user._id, req.body);
    res.status(201).json({ success: true, data: contact });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const updateTrustedContact = async (req, res, next) => {
  try {
    const contact = await userSafetyService.updateTrustedContact(req.user._id, req.params.id, req.body);
    res.status(200).json({ success: true, data: contact });
  } catch (error) {
    next(error);
  }
};

export const deleteTrustedContact = async (req, res, next) => {
  try {
    await userSafetyService.deleteTrustedContact(req.user._id, req.params.id);
    res.status(200).json({ success: true, message: 'Trusted contact deleted' });
  } catch (error) {
    next(error);
  }
};

export const triggerSOS = async (req, res, next) => {
  try {
    const alert = await userSafetyService.triggerSOS(req.user._id, req.body);
    res.status(201).json({ success: true, data: alert, message: 'Emergency alert sent successfully. Help is on the way.' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const shareTrip = async (req, res, next) => {
  try {
    const link = await userSafetyService.shareTrip(req.user._id, req.body);
    res.status(201).json({ success: true, data: link });
  } catch (error) {
    next(error);
  }
};

export const reportDriver = async (req, res, next) => {
  try {
    const filePaths = {
      image: req.files?.image ? req.files.image[0].path : null,
      audio: req.files?.audio ? req.files.audio[0].path : null,
    };
    const report = await userSafetyService.reportDriver(req.user._id, req.body, filePaths);
    res.status(201).json({ success: true, data: report, message: 'Report submitted successfully' });
  } catch (error) {
    next(error);
  }
};

export const submitRideCheck = async (req, res, next) => {
  try {
    const log = await userSafetyService.submitRideCheck(req.user._id, req.body);
    res.status(201).json({ success: true, data: log });
  } catch (error) {
    next(error);
  }
};

export const getSafetyTips = async (req, res, next) => {
  try {
    const tips = await userSafetyService.getSafetyTips();
    res.status(200).json({ success: true, data: tips });
  } catch (error) {
    next(error);
  }
};

export const getEmergencySettings = async (req, res, next) => {
  try {
    const settings = await userSafetyService.getSettings();
    res.status(200).json({ success: true, data: settings });
  } catch (error) {
    next(error);
  }
};

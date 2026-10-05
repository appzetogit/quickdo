import crypto from 'crypto';
import TrustedContact from '../models/TrustedContact.js';
import EmergencyAlert from '../models/EmergencyAlert.js';
import SafetyReport from '../models/SafetyReport.js';
import RideCheckLog from '../models/RideCheckLog.js';
import SafetyTip from '../models/SafetyTip.js';
import TripShareLink from '../models/TripShareLink.js';
import EmergencySetting from '../models/EmergencySetting.js';

class UserSafetyService {
  async getSettings() {
    let settings = await EmergencySetting.findOne();
    if (!settings) {
      settings = await EmergencySetting.create({});
    }
    return settings;
  }

  async getTrustedContacts(userId) {
    return TrustedContact.find({ user_id: userId }).sort({ is_primary: -1, createdAt: -1 });
  }

  async addTrustedContact(userId, data) {
    const settings = await this.getSettings();
    const count = await TrustedContact.countDocuments({ user_id: userId });
    
    if (count >= settings.max_trusted_contacts) {
      throw new Error(`Maximum of ${settings.max_trusted_contacts} trusted contacts allowed.`);
    }

    if (data.is_primary) {
      await TrustedContact.updateMany({ user_id: userId }, { is_primary: false });
    }

    const contact = new TrustedContact({
      user_id: userId,
      ...data,
    });
    return contact.save();
  }

  async updateTrustedContact(userId, contactId, data) {
    if (data.is_primary) {
      await TrustedContact.updateMany({ user_id: userId }, { is_primary: false });
    }
    return TrustedContact.findOneAndUpdate(
      { _id: contactId, user_id: userId },
      data,
      { new: true }
    );
  }

  async deleteTrustedContact(userId, contactId) {
    return TrustedContact.findOneAndDelete({ _id: contactId, user_id: userId });
  }

  async triggerSOS(userId, data) {
    const settings = await this.getSettings();
    if (!settings.enable_sos) {
      throw new Error('SOS feature is currently disabled.');
    }

    const alert = new EmergencyAlert({
      user_id: userId,
      trip_id: data.trip_id,
      driver_id: data.driver_id,
      location: {
        type: 'Point',
        coordinates: [data.longitude, data.latitude],
      },
      ride_status: data.ride_status,
      alert_type: 'sos_button',
    });
    
    await alert.save();
    
    // In future: Trigger SMS/Push notification to trusted contacts and admin
    
    return alert;
  }

  async shareTrip(userId, data) {
    const token = crypto.randomBytes(24).toString('hex');
    
    // Default expiry 24 hours
    const expiryTime = new Date();
    expiryTime.setHours(expiryTime.getHours() + 24);

    const shareLink = new TripShareLink({
      user_id: userId,
      trip_id: data.trip_id,
      token,
      expiry_time: expiryTime,
    });

    await shareLink.save();
    return shareLink;
  }

  async reportDriver(userId, data, filePaths = {}) {
    const report = new SafetyReport({
      user_id: userId,
      trip_id: data.trip_id,
      driver_id: data.driver_id,
      reason: data.reason,
      description: data.description,
      image: filePaths.image,
      audio: filePaths.audio,
    });

    await report.save();
    return report;
  }

  async submitRideCheck(userId, data) {
    const log = new RideCheckLog({
      user_id: userId,
      trip_id: data.trip_id,
      popup_time: data.popup_time,
      user_response: data.user_response,
      response_time: new Date(),
    });

    await log.save();

    if (data.user_response === 'need_help' || data.user_response === 'no_response') {
      // Create SOS alert
      const alert = new EmergencyAlert({
        user_id: userId,
        trip_id: data.trip_id,
        location: {
          type: 'Point',
          coordinates: [data.longitude || 0, data.latitude || 0],
        },
        alert_type: data.user_response === 'need_help' ? 'ride_check_help' : 'ride_check_missed',
      });
      await alert.save();
    }

    return log;
  }

  async getSafetyTips() {
    return SafetyTip.find({ status: 'active' }).sort({ priority: -1, createdAt: -1 });
  }
}

export default new UserSafetyService();

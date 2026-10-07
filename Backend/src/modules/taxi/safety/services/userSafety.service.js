import TrustedContact from '../models/TrustedContact.js';
import SafetyReport from '../models/SafetyReport.js';
import RideCheckLog from '../models/RideCheckLog.js';
import SafetyTip from '../models/SafetyTip.js';
import EmergencySetting from '../models/EmergencySetting.js';
import { triggerSos } from './sos.service.js';
import { createTripShareLink } from './tripShare.service.js';

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

  /*
   * POST /safety/sos. Goes through the one SOS service (sos.service.js), which
   * alerts the admins, texts the trusted contacts and tracks the location --
   * this used to save an EmergencyAlert and tell nobody.
   */
  async triggerSOS(userId, data) {
    return triggerSos({
      sourceApp: 'user',
      actorId: userId,
      rideId: data.trip_id || data.rideId,
      location: data.location || { lat: data.latitude, lng: data.longitude },
      notes: data.notes,
    });
  }

  /** POST /safety/trip/share: the rider's own ride only; returns the link with its url. */
  async shareTrip(userId, data) {
    return createTripShareLink({ userId, rideId: data.trip_id || data.rideId });
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
      // The same SOS as the button: admins, contacts and live location.
      await triggerSos({
        sourceApp: 'user',
        actorId: userId,
        rideId: data.trip_id,
        location: { lat: data.latitude, lng: data.longitude },
        reason: data.user_response === 'need_help' ? 'ride_check_help' : 'ride_check_missed',
      });
    }

    return log;
  }

  async getSafetyTips() {
    return SafetyTip.find({ status: 'active' }).sort({ priority: -1, createdAt: -1 });
  }
}

export default new UserSafetyService();

const mongoose = require('mongoose');

const notificationLogSchema = new mongoose.Schema({
  notificationId: { 
    type: String, 
    unique: true, 
    required: true,
    index: true 
  },
  userId: {
    type: String, 
    required: true,
    index: true
  },
  tokens: [String],
  status: {
    type: String,
    enum: ['sent', 'failed'],
    default: 'sent'
  },
  createdAt: { 
    type: Date, 
    default: Date.now, 
    expires: 86400 // Auto-delete after 24 hours to keep DB clean
  }
});

module.exports = mongoose.models.SPNotificationLog || mongoose.model('SPNotificationLog', notificationLogSchema, 'sp_notification_logs');

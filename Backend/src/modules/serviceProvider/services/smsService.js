const { smsCredentials } = require('../../../core/settings/platformCredentials.cjs');
const axios = require('axios');

/**
 * Send SMS via SMS India Hub
 * @param {string} phone - Phone number
 * @param {string} message - Message content
 * @returns {Promise<Object>} - Response data
 */
const sendSMS = async (phone, message) => {
  try {
    // Suppress the real SMS for exactly the numbers that are served the static test
    // code, using the SAME predicate that decides that -- see usesStaticOtp().
    //
    // Gating this on USE_DEFAULT_OTP by itself is what caused the deadlock: in
    // production that flag mocked every message while the static code was vetoed,
    // so every user got a silent send and an unguessable OTP.
    //
    // Required lazily to keep this module free of a load-order dependency on the
    // OTP util (which pulls in redis and the Token model).
    const { usesStaticOtp } = require('../utils/redisOtp.util');
    if (usesStaticOtp(phone)) {
      console.log(`[SMS MOCK] To: ${phone}, Msg: ${message}`);
      return { success: true, data: 'Mock Success' };
    }

    // Check if SMS credentials are configured (Master settings, else .env)
    const sms = smsCredentials();
    if (!sms.apiKey || !sms.senderId) {
      console.warn('[SMS] SMS credentials missing in .env. SMS not sent.');
      console.log(`[SMS MOCK] To: ${phone}, Msg: ${message}`);
      return { success: false, message: 'SMS configuration missing' };
    }

    // Build parameters matching exactly what works in the browser
    const params = {
      APIKey: sms.apiKey,
      msisdn: phone,
      sid: sms.senderId,
      msg: message,
      fl: 0,
      gwid: 2,
    };

    // Add DLT Template ID if available
    if (sms.templateId) {
      params.TemplateId = sms.templateId;
    }

    // Use HTTPS for secure transmission
    const baseUrl = process.env.SMS_BASE_URL || 'https://cloud.smsindiahub.in/vendorsms/pushsms.aspx';
    console.log('[SMS] Sending request to (HTTPS):', baseUrl);
    console.log('[SMS] Params (masked):', { ...params, password: '***', apikey: '***' });

    const response = await axios.get(baseUrl, { params });

    console.log('[SMS] Response status:', response.status);
    console.log('[SMS] Response data:', response.data);

    // Check for successful response
    // SMS India Hub can return JSON object OR string
    let isSuccess = false;
    const data = response.data;

    if (typeof data === 'object' && data !== null) {
      // Handle JSON response
      if (data.ErrorCode === '000' || data.ErrorMessage === 'Done' || data.ErrorMessage === 'Success') {
        isSuccess = true;
      }
    } else {
      // Handle String response
      const responseStr = String(data || '');
      if (responseStr.startsWith('Success')) {
        isSuccess = true;
      }
    }

    if (isSuccess) {
      console.log(`[SMS] ✅ SMS sent successfully to ${phone}`);
      return { success: true, data: response.data };
    } else {
      console.error(`[SMS] ❌ SMS Provider Error:`, JSON.stringify(response.data));
      // Parse common string errors if it is a string
      if (typeof data === 'string' && data.includes('Invalid Login')) {
        console.error('[SMS] ⚠️  Authentication failed - check SMS_INDIA_HUB_USERNAME and SMS_INDIA_HUB_API_KEY');
      }
      return { success: false, error: response.data };
    }

  } catch (error) {
    console.error('[SMS] Network Error:', error.message);
    if (error.response) {
      console.error('[SMS] Error Response:', error.response.data);
    }
    return { success: false, error: error.message };
  }
};

/**
 * Send OTP specific SMS
 * @param {string} phone - Phone number
 * @param {string} otp - OTP code
 */
const sendOTP = async (phone, otp) => {
  // Template: "Welcome to the ##var## powered by Appzeto.Your OTP for registration is ##var##.BGADEC"
  const appName = 'Truliq';
  const message = `Welcome to the ${appName} powered by Appzeto.Your OTP for registration is ${otp}.BGADEC`;

  console.log(`[SMS] Attempting to send OTP to ${phone}`);
  console.log(`[SMS] Message: ${message}`);

  const result = await sendSMS(phone, message);

  if (!result.success) {
    console.error(`[SMS] Failed to send OTP to ${phone}:`, result.error);
  }

  return result;
};

module.exports = {
  sendSMS,
  sendOTP
};

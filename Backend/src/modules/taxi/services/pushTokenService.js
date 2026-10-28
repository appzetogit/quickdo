import { ApiError } from '../../../utils/ApiError.js';

const MOBILE_PLATFORMS = new Set(['android', 'ios', 'mobile']);
const WEB_PLATFORMS = new Set(['web', 'browser', 'pwa']);

export const normalizePushPlatform = (platform) => {
  const normalized = String(platform || '').trim().toLowerCase();

  if (WEB_PLATFORMS.has(normalized)) {
    return 'web';
  }

  if (MOBILE_PLATFORMS.has(normalized)) {
    return 'mobile';
  }

  throw new ApiError(400, 'platform must be web, android, ios, or mobile');
};

export const normalizePushToken = (token) => {
  const normalized = String(token || '').trim();

  if (!normalized) {
    throw new ApiError(400, 'token is required');
  }

  if (normalized.length < 20) {
    throw new ApiError(400, 'token looks invalid');
  }

  return normalized;
};

export const getPushTokenField = (platform) =>
  normalizePushPlatform(platform) === 'web' ? 'fcmTokens' : 'fcmTokenMobile';

export const assignPushTokenToEntity = (entity, { token, platform }) => {
  const normalizedToken = normalizePushToken(token);
  const normalizedPlatform = normalizePushPlatform(platform);
  const fieldName = getPushTokenField(normalizedPlatform);
  const nextTokens = new Set([
    ...toTokenArray(entity[fieldName]),
    normalizedToken,
  ]);
  entity[fieldName] = Array.from(nextTokens);

  return {
    token: normalizedToken,
    platform: normalizedPlatform,
    fieldName,
  };
};

const toTokenArray = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  return [String(value || '').trim()].filter(Boolean);
};

export const listEntityPushTokens = (entity = {}, role = 'unknown') =>
  [
    ...toTokenArray(entity.fcmTokens).map((token) => ({
      role,
      field: 'fcmTokens',
      platform: 'web',
      token,
    })),
    ...toTokenArray(entity.fcmTokenMobile).map((token) => ({
      role,
      field: 'fcmTokenMobile',
      platform: 'mobile',
      token,
    })),
  ];

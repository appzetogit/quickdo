import { ApiError } from '../../../utils/ApiError.js';
import { razorpayCredentials, razorpayKeyId, razorpayKeySecret } from '../../../core/settings/platformProfile.service.js';
import { ensureThirdPartySettings } from '../admin/services/adminService.js';
import { env } from '../../../config/env.js';

const PAYMENT_GATEWAY_SPECS = {
  razor_pay: {
    label: 'Razorpay',
    environmentKey: 'environment',
    liveValue: 'live',
    credentialsByEnvironment: {
      test: ['test_api_key', 'test_secret_key'],
      live: ['live_api_key', 'live_secret_key'],
    },
  },
  phone_pay: {
    label: 'PhonePe',
    environmentKey: 'environment',
    liveValue: 'production',
    credentialsByEnvironment: {
      test: ['merchant_id', 'salt_key', 'salt_index'],
      production: ['merchant_id', 'salt_key', 'salt_index'],
    },
  },
  stripe: {
    label: 'Stripe',
    environmentKey: 'environment',
    liveValue: 'live',
    credentialsByEnvironment: {
      test: ['test_secret_key', 'test_publishable_key'],
      live: ['live_secret_key', 'live_publishable_key'],
    },
  },
};

const normalizeString = (value = '') => String(value || '').trim();
const normalizeEnabled = (value) => (String(value ?? '0').trim() === '1' ? '1' : '0');
const isDemoLikeValue = (value = '') => normalizeString(value).toLowerCase().includes('demo');

const normalizeGatewayConfig = (gatewayKey, gatewayValue = {}) => {
  const current = gatewayValue && typeof gatewayValue === 'object' ? gatewayValue : {};
  const normalized = { ...current, enabled: normalizeEnabled(current.enabled) };
  const spec = PAYMENT_GATEWAY_SPECS[gatewayKey];

  if (spec?.environmentKey) {
    const fallbackEnvironment = Object.keys(spec.credentialsByEnvironment)[0] || 'test';
    normalized[spec.environmentKey] = normalizeString(current[spec.environmentKey] || fallbackEnvironment).toLowerCase();
  }

  return normalized;
};

const getCredentialFieldLabel = (field) =>
  field
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

export const validateGatewayConfiguration = (gatewayKey, gatewayValue = {}) => {
  const spec = PAYMENT_GATEWAY_SPECS[gatewayKey];
  if (!spec) {
    return normalizeGatewayConfig(gatewayKey, gatewayValue);
  }

  const normalized = normalizeGatewayConfig(gatewayKey, gatewayValue);
  if (normalized.enabled !== '1') {
    return normalized;
  }

  const environment = normalizeString(normalized[spec.environmentKey] || '').toLowerCase();
  const requiredFields = spec.credentialsByEnvironment[environment] || [];
  const missingField = requiredFields.find((field) => !normalizeString(normalized[field]));

  if (missingField) {
    throw new ApiError(
      400,
      `${spec.label} ${getCredentialFieldLabel(missingField)} is required before enabling the gateway`,
    );
  }

  return normalized;
};

export const normalizePaymentSettingsPayload = (currentPaymentSettings = {}, payload = {}) => {
  const merged = {
    ...currentPaymentSettings,
    ...payload,
  };

  for (const gatewayKey of Object.keys(PAYMENT_GATEWAY_SPECS)) {
    merged[gatewayKey] = validateGatewayConfiguration(gatewayKey, merged[gatewayKey] || {});
  }

  const enabledGatewayKeys = Object.keys(PAYMENT_GATEWAY_SPECS).filter(
    (gatewayKey) => merged[gatewayKey]?.enabled === '1',
  );

  if (enabledGatewayKeys.length > 1) {
    const winningGatewayKey = enabledGatewayKeys[enabledGatewayKeys.length - 1];
    for (const gatewayKey of enabledGatewayKeys) {
      merged[gatewayKey] = {
        ...(merged[gatewayKey] || {}),
        enabled: gatewayKey === winningGatewayKey ? '1' : '0',
      };
    }
  }

  return merged;
};

export const getActivePaymentGateway = async () => {
  const settings = await ensureThirdPartySettings();
  const payment = settings?.payment || {};

  for (const gatewayKey of Object.keys(PAYMENT_GATEWAY_SPECS)) {
    const gateway = normalizeGatewayConfig(gatewayKey, payment[gatewayKey] || {});
    if (gateway.enabled === '1') {
      return {
        slug: gatewayKey,
        label: PAYMENT_GATEWAY_SPECS[gatewayKey].label,
        settings: gateway,
      };
    }
  }

  return null;
};

export const getPublicActivePaymentGateway = async () => {
  const activeGateway = await getActivePaymentGateway();

  if (!activeGateway) {
    return {
      activeGateway: null,
    };
  }

  return {
    activeGateway: {
      slug: activeGateway.slug,
      label: activeGateway.label,
      supportsWalletTopUp: ['razor_pay', 'phone_pay'].includes(activeGateway.slug),
      walletTopUpMode:
        activeGateway.slug === 'razor_pay'
          ? 'razorpay_checkout'
          : activeGateway.slug === 'phone_pay'
            ? 'phonepe_redirect'
            : 'unsupported',
    },
  };
};

export const resolveConfiguredGatewayCredentials = async (gatewayKey) => {
  const spec = PAYMENT_GATEWAY_SPECS[gatewayKey];
  if (!spec) {
    throw new ApiError(400, 'Unsupported payment gateway');
  }

  // Direct environment fallback for development testing
  const platformRazorpay = razorpayCredentials();
  if (gatewayKey === 'razor_pay' && platformRazorpay.keyId && platformRazorpay.keySecret) {
    return {
      keyId: platformRazorpay.keyId,
      keySecret: platformRazorpay.keySecret,
      environment: 'test'
    };
  }

  const settings = await ensureThirdPartySettings();
  const gateway = normalizeGatewayConfig(gatewayKey, settings?.payment?.[gatewayKey] || {});

  if (gateway.enabled !== '1') {
    throw new ApiError(403, `${spec.label} gateway is disabled`);
  }

  const environment = normalizeString(gateway[spec.environmentKey]).toLowerCase();
  const isLive = environment === spec.liveValue;
  const validatedGateway = validateGatewayConfiguration(gatewayKey, gateway);

  if (gatewayKey === 'razor_pay') {
    let keyId = normalizeString(isLive ? validatedGateway.live_api_key : validatedGateway.test_api_key);
    let keySecret = normalizeString(isLive ? validatedGateway.live_secret_key : validatedGateway.test_secret_key);

    const hasInvalidConfiguredKeys =
      !keyId ||
      !keySecret ||
      isDemoLikeValue(keyId) ||
      isDemoLikeValue(keySecret);

    if (hasInvalidConfiguredKeys) {
      const envKeyId = normalizeString(razorpayKeyId());
      const envKeySecret = normalizeString(razorpayKeySecret());
      if (envKeyId && envKeySecret) {
        keyId = envKeyId;
        keySecret = envKeySecret;
      }
    }

    if (!keyId || !keySecret || isDemoLikeValue(keyId) || isDemoLikeValue(keySecret)) {
      throw new ApiError(500, 'Razorpay keys are demo placeholders. Configure real keys in Admin > Payment Gateways or .env');
    }

    return { keyId, keySecret, environment };
  }

  if (gatewayKey === 'phone_pay') {
    const merchantId = normalizeString(validatedGateway.merchant_id);
    const saltKey = normalizeString(validatedGateway.salt_key);
    const saltIndex = normalizeString(validatedGateway.salt_index || '1');

    if (merchantId.toLowerCase().includes('demo') || saltKey.toLowerCase().includes('demo')) {
      throw new ApiError(500, 'PhonePe keys are demo placeholders. Configure real keys in Admin > Payment Gateways');
    }

    return { merchantId, saltKey, saltIndex, environment };
  }

  return { ...validatedGateway, environment };
};

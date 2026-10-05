import { createDefaultAppSettings } from '../admin/data/defaultAppSettings.js';
import { AdminAppSetting } from '../admin/models/AdminAppSetting.js';

const defaultAppSettings = createDefaultAppSettings();

export const getTipSettings = async () => {
  const settings = await AdminAppSetting.findOne({ scope: 'default' })
    .select('tip_setting')
    .lean();

  return {
    ...(defaultAppSettings.tip_setting || {}),
    ...(settings?.tip_setting || {}),
  };
};

export const getWalletSettings = async () => {
  const settings = await AdminAppSetting.findOne({ scope: 'default' })
    .select('wallet_setting')
    .lean();

  return {
    ...(defaultAppSettings.wallet_setting || {}),
    ...(settings?.wallet_setting || {}),
  };
};

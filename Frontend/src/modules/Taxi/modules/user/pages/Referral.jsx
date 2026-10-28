import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, CheckCircle2, Copy, Gift, Loader2, Share2 } from 'lucide-react';
import BottomNavbar from '../components/BottomNavbar';
import { userAuthService } from '../services/authService';
import {
  getReferralSettingsContent,
  getReferralTranslationContent,
} from '../../shared/services/referralTranslationService';
import {
  applyReferralSettingPlaceholders,
  buildReferralPreviewBlocks,
  getStoredReferralLanguageCode,
  USER_REFERRAL_TRANSLATION_FIELDS,
} from '../../shared/utils/referralTranslationFields';
import { useSettings } from '../../../shared/context/SettingsContext';

const readStoredUserInfo = () => {
  try {
    return JSON.parse(localStorage.getItem('userInfo') || '{}');
  } catch {
    return {};
  }
};

const LEGACY_BRAND_REGEX = /\bzyder\b/gi;

const replaceLegacyReferralBrand = (value, appName) => {
  const safeAppName = String(appName || '').trim() || 'App';
  return String(value || '').replace(LEGACY_BRAND_REGEX, safeAppName);
};

const Referral = () => {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const [activeTab, setActiveTab] = useState('refer');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(() => {
    const stored = readStoredUserInfo();
    return {
      referralCode: stored.referralCode || '',
      referralCount: Number(stored.referralCount || 0),
    };
  });
  const [translation, setTranslation] = useState({
    language_code: 'en',
    user_referral: {
      instant_referrer_user: '',
      instant_referrer_user_and_new_user: '',
      conditional_referrer_user_ride_count: '',
      conditional_referrer_user_earnings: '',
      dual_conditional_referrer_user_and_new_user_ride_count: '',
      dual_conditional_referrer_user_and_new_user_earnings: '',
      banner_text: '',
    },
  });

  useEffect(() => {
    const loadReferralPage = async () => {
      setLoading(true);

      const languageCode = getStoredReferralLanguageCode('user');
      const stored = readStoredUserInfo();
      const fallbackUserSection = {
        instant_referrer_user: '',
        instant_referrer_user_and_new_user: '',
        conditional_referrer_user_ride_count: '',
        conditional_referrer_user_earnings: '',
        dual_conditional_referrer_user_and_new_user_ride_count: '',
        dual_conditional_referrer_user_and_new_user_earnings: '',
        banner_text: '',
      };

      try {
        const [userResponse, translationResponse, settingsResponse] = await Promise.all([
          userAuthService.getCurrentUser(),
          getReferralTranslationContent(languageCode),
          getReferralSettingsContent('user'),
        ]);

        const user = userResponse?.data?.user || {};
        const translationData = translationResponse?.data || {};
        const settingsData = settingsResponse?.data || {};
        const hydratedUserReferral = applyReferralSettingPlaceholders(
          translationData.user_referral || fallbackUserSection,
          settingsData,
        );

        setProfile({
          referralCode: user.referralCode || stored.referralCode || '',
          referralCount: Number(user.referralCount || 0),
        });
        setTranslation({
          language_code: translationData.language_code || languageCode,
          user_referral: hydratedUserReferral,
        });

        localStorage.setItem(
          'userInfo',
          JSON.stringify({
            ...stored,
            referralCode: user.referralCode || '',
            referralCount: Number(user.referralCount || 0),
          }),
        );
      } catch {
        try {
          const [translationResponse, settingsResponse] = await Promise.all([
            getReferralTranslationContent(languageCode),
            getReferralSettingsContent('user'),
          ]);
          setTranslation({
            language_code: translationResponse?.data?.language_code || languageCode,
            user_referral: applyReferralSettingPlaceholders(
              translationResponse?.data?.user_referral || fallbackUserSection,
              settingsResponse?.data || {},
            ),
          });
        } catch {
          // Keep local fallback state.
        }
      } finally {
        setLoading(false);
      }
    };

    loadReferralPage();
  }, []);

  const appName = settings.general?.app_name || 'App';
  const referralCode = profile.referralCode || '';
  const normalizedUserReferral = Object.fromEntries(
    Object.entries(translation.user_referral || {}).map(([key, value]) => [
      key,
      replaceLegacyReferralBrand(value, appName),
    ]),
  );
  const bannerText = normalizedUserReferral.banner_text || `${appName} Refer and Earn`;
  const infoBlocks = buildReferralPreviewBlocks(
    normalizedUserReferral,
    USER_REFERRAL_TRANSLATION_FIELDS,
  );

  const handleCopy = async () => {
    if (!referralCode) {
      return;
    }

    try {
      await navigator.clipboard.writeText(referralCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard failures silently.
    }
  };

  const handleShare = async () => {
    if (!referralCode) {
      return;
    }
    const signupLink = `${window.location.origin}/taxi/user/signup?ref=${encodeURIComponent(referralCode)}`;
    const shareText = `${bannerText}\nUse my referral code ${referralCode} to sign up.\n${signupLink}`;

    try {
      if (navigator.share) {
        await navigator.share({
          title: bannerText,
          text: shareText,
        });
        return;
      }
    } catch {
      // Fall through to desktop-friendly sharing options.
    }

    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard failures and continue to WhatsApp fallback.
    }

    window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank');
  };

  return (
    <div className="min-h-screen bg-[#f5f7fb] max-w-lg mx-auto font-sans pb-28">
      <header className="bg-white px-5 pt-10 pb-4 sticky top-0 z-20 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="w-9 h-9 rounded-xl border border-gray-200 bg-white flex items-center justify-center shadow-sm"
          >
            <ArrowLeft size={18} className="text-gray-900" strokeWidth={2.3} />
          </button>
          <div className="flex-1 text-center pr-12">
            <h1 className="text-[19px] font-semibold text-gray-900">Referrals</h1>
          </div>
        </div>
      </header>

      <div className="px-5 pt-5">
        <div className="rounded-[28px] border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="bg-[#1830b8] px-5 py-5 text-white flex items-center justify-between">
            <div>
              <p className="text-[26px] font-semibold leading-tight">{bannerText}</p>
              <p className="text-[11px] text-indigo-100 mt-1">Language: {translation.language_code?.toUpperCase() || 'EN'}</p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center">
              <Gift size={20} />
            </div>
          </div>

          <div className="px-4 py-4">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <div className="rounded-xl border border-dashed border-gray-300 px-3 py-3 text-center">
                <p className="text-[18px] font-semibold text-gray-900 tracking-wide">
                  {referralCode || 'Not available'}
                </p>
                <p className="text-[10px] text-gray-400 mt-1">Your referral code</p>
              </div>
              <button
                type="button"
                onClick={handleCopy}
                disabled={!referralCode}
                className="rounded-xl bg-[#1830b8] text-white px-4 text-sm font-medium flex items-center gap-2 disabled:opacity-50"
              >
                {copied ? <CheckCircle2 size={15} /> : <Copy size={15} />}
                Copy
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 mt-3">
              <button
                type="button"
                onClick={() => setActiveTab('refer')}
                className={`rounded-lg py-2 text-xs font-medium ${
                  activeTab === 'refer' ? 'bg-white border border-gray-200 text-gray-900' : 'bg-gray-100 text-gray-500'
                }`}
              >
                Refer and earn
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('history')}
                className={`rounded-lg py-2 text-xs font-medium ${
                  activeTab === 'history' ? 'bg-white border border-gray-200 text-gray-900' : 'bg-gray-100 text-gray-500'
                }`}
              >
                Referral history
              </button>
            </div>
          </div>

          <div className="px-4 pb-4 min-h-[340px]">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="animate-spin text-[#1830b8]" size={26} />
              </div>
            ) : activeTab === 'refer' ? (
              <div className="space-y-4">
                <h2 className="text-[18px] font-semibold text-gray-900">How it works?</h2>
                {infoBlocks.length === 0 ? (
                  <p className="text-sm text-gray-400">Referral content will appear here after admin updates this language.</p>
                ) : (
                  infoBlocks.map((block) => (
                    <div
                      key={block.key}
                      className="text-[14px] leading-6 text-gray-800 prose prose-sm max-w-none"
                      dangerouslySetInnerHTML={{ __html: block.html }}
                    />
                  ))
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-5 py-8 text-center">
                <p className="text-sm font-medium text-gray-900">Successful referrals</p>
                <p className="text-3xl font-semibold text-[#1830b8] mt-2">{profile.referralCount}</p>
                <p className="text-xs text-gray-400 mt-2">Detailed referral history is not available on this screen yet.</p>
              </div>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={handleShare}
          disabled={!referralCode}
          className="w-full rounded-xl bg-[#ef4444] text-white py-3.5 text-sm font-semibold mt-5 flex items-center justify-center gap-2 disabled:opacity-50"
        >
          Refer now <Share2 size={16} />
        </button>
      </div>

      <AnimatePresence>
        {copied ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 rounded-2xl bg-gray-900 text-white px-4 py-3 text-xs font-semibold shadow-xl"
          >
            Referral code copied
          </motion.div>
        ) : null}
      </AnimatePresence>

      <BottomNavbar />
    </div>
  );
};

export default Referral;

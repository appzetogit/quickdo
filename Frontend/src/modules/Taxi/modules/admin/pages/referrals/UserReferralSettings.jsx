import React, { useState, useEffect } from 'react';
import {
  ChevronRight,
  Share2,
  Save,
  Loader2,
  Info,
  UserCheck,
  ArrowLeft
} from 'lucide-react';
import { adminService } from '../../services/adminService';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

const unwrap = (response) => response?.data?.data || response?.data || response || {};

const UserReferralSettings = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [settings, setSettings] = useState({
    enabled: false,
    type: 'instant_referrer',
    amount: 0,
    ride_count: 0,
  });

  const referralTypes = [
    { value: 'instant_referrer', label: 'Instant for Referrer User' },
    { value: 'instant_referrer_new', label: 'Instant for Referrer User and New User' },
    { value: 'conditional_referrer', label: 'Conditional for Referrer User' },
    { value: 'conditional_referrer_new', label: 'Conditional for Referrer User and New User' },
  ];

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await adminService.getReferralSettings('user');
        const payload = unwrap(res);
        if (payload) {
          setSettings({
            enabled: payload.enabled ?? false,
            type: payload.type || 'instant_referrer',
            amount: payload.amount || 0,
            ride_count: payload.ride_count || 0,
          });
        }
      } catch (err) {
        console.error('Fetch error:', err);
        toast.error('Failed to load settings');
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, []);

  const handleUpdate = async () => {
    setSaving(true);
    try {
      const res = await adminService.updateReferralSettings('user', {
        ...settings,
        amount: Number(settings.amount || 0),
        ride_count: Number(settings.ride_count || 0),
      });
      if (unwrap(res)) {
        setShowSuccess(true);
        toast.success('Referral settings updated successfully');
        setTimeout(() => setShowSuccess(false), 3000);
      }
    } catch (err) {
      console.error('Update error:', err);
      toast.error('Failed to update settings');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (newVal) => {
    const updated = { ...settings, enabled: newVal };
    setSettings(updated);
    try {
      await adminService.updateReferralSettings('user', updated);
      setShowSuccess(true);
      toast.success('Referral settings toggled successfully');
      setTimeout(() => setShowSuccess(false), 3000);
    } catch (err) {
      toast.error('Failed to toggle settings');
      setSettings(settings); // revert
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="animate-spin text-indigo-600" size={32} />
          <span className="text-sm text-gray-500 font-medium">Loading settings...</span>
        </div>
      </div>
    );
  }

  const labelClass = "block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wider";
  const inputClass = "w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm text-gray-800 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-colors";

  const isConditional = settings.type?.includes('conditional');

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-8">
      {/* HEADER BLOCK */}
      <div className="mb-6">
        <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
          <span>User Referral Settings</span>
          <ChevronRight size={12} />
          <span className="text-gray-700">User Referral Settings</span>
        </div>
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900 uppercase tracking-tight">User Referral Settings</h1>
          <button 
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <ArrowLeft size={16} /> Back
          </button>
        </div>
      </div>

      <div className="max-w-5xl space-y-6">
        {/* FORM CARD */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {/* Main Toggle Section */}
          <div className="p-6 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600">
                <UserCheck size={20} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-900 uppercase">User Referral Earnings Setup</h3>
                <p className="text-xs text-gray-400 mt-0.5 font-medium">Invite others to use our app with your unique referral code and earn exciting rewards!</p>
              </div>
            </div>
            <button 
              onClick={() => handleToggle(!settings.enabled)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${settings.enabled ? 'bg-indigo-600' : 'bg-gray-200'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>

          <div className="p-8 space-y-8">
            {/* Referral Type Selection */}
            <div className="max-w-xl space-y-2">
              <label className={labelClass}>
                Referral Commission Type <Info size={14} className="inline ml-1 text-gray-400 cursor-help" />
              </label>
              <div className="relative">
                <select
                  value={settings.type}
                  onChange={(e) => setSettings({ ...settings, type: e.target.value })}
                  className={`${inputClass} appearance-none pr-10`}
                >
                  <option value="">Select</option>
                  {referralTypes.map((type) => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </select>
                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                  <ChevronRight size={16} className="rotate-90" />
                </div>
              </div>
            </div>

            {/* Referral Info Card Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
              <div className="bg-white rounded-xl border border-dashed border-gray-200 p-6 flex items-center gap-5 transition-all hover:border-indigo-200">
                <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shadow-sm">
                  <Share2 size={24} />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-gray-900">User Share the code To Refer User</h4>
                  <p className="text-xs text-gray-500 mt-1 leading-relaxed">Offer a reward to Users for each referral when they share their code.</p>
                </div>
              </div>

              <div className="space-y-4">
                {isConditional && (
                  <div className="bg-gray-50/50 rounded-xl border border-gray-200 p-6 space-y-3">
                    <label className={labelClass}>Required Ride Count</label>
                    <div className="relative">
                      <input
                        type="number"
                        value={settings.ride_count}
                        onChange={(e) => setSettings({ ...settings, ride_count: e.target.value })}
                        className={inputClass}
                        placeholder="5"
                      />
                    </div>
                    <p className="text-[11px] text-gray-400 font-medium">Number of rides required before earning rewards.</p>
                  </div>
                )}

                <div className="bg-gray-50/50 rounded-xl border border-gray-200 p-6 space-y-3">
                  <label className={labelClass}>Earnings to Each Referral</label>
                  <div className="relative">
                    <input
                      type="number"
                      value={settings.amount}
                      onChange={(e) => setSettings({ ...settings, amount: e.target.value })}
                      className={inputClass}
                      placeholder="100"
                    />
                  </div>
                  <p className="text-[11px] text-gray-400 font-medium">Enter the amount Users earn for each referral.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Action Footer */}
          <div className="p-6 bg-gray-50 border-t border-gray-100 flex flex-col gap-4">
            <button
              onClick={handleUpdate}
              disabled={saving}
              className="w-fit flex items-center gap-2 px-6 py-2.5 bg-indigo-900 text-white text-xs font-bold uppercase tracking-wider rounded-lg hover:bg-indigo-800 transition-colors shadow-sm disabled:opacity-50"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              Update Referral Settings
            </button>

            {showSuccess && (
              <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50 px-4 py-3 rounded-lg border border-emerald-100 animate-in fade-in slide-in-from-bottom-2">
                <div className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center">
                  <ChevronRight size={12} className="rotate-45" />
                </div>
                <span className="text-xs font-bold uppercase tracking-tight">Referral settings updated successfully</span>
                <button onClick={() => setShowSuccess(false)} className="ml-auto text-emerald-400 hover:text-emerald-600">
                  <span className="text-lg">×</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserReferralSettings;

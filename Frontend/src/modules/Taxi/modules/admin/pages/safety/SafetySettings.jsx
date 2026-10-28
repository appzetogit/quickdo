import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Save, ShieldCheck, AlertTriangle, Clock, Phone, LoaderCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../../shared/api/axiosInstance';

const SafetySettings = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [settings, setSettings] = useState({
    enable_sos: true,
    enable_ride_check: true,
    popup_interval_minutes: 15,
    max_trusted_contacts: 5,
    emergency_helpline: '911',
    alert_timeout_minutes: 5,
  });

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    setIsLoading(true);
    try {
      const response = await api.get('/admin/safety/settings');
      if (response.data?.data) {
        setSettings(response.data.data);
      }
    } catch (error) {
      toast.error('Failed to load safety settings');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await api.put('/admin/safety/settings', settings);
      toast.success('Safety settings updated successfully', {
        icon: '✅',
        style: {
          borderRadius: '10px',
          background: '#333',
          color: '#fff',
        },
      });
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to update settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setSettings((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  if (isLoading) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Safety & Emergency Settings</h1>
          <p className="mt-1 text-sm font-medium text-slate-500">
            Configure SOS options, ride checks, and emergency contacts dynamically.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-primary/30 transition-all hover:bg-primary/90 disabled:opacity-50"
        >
          {isSaving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {isSaving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-[24px] border border-slate-100 bg-white p-6 shadow-sm">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900">Core Features</h3>
              <p className="text-xs font-medium text-slate-500">Enable or disable safety modules</p>
            </div>
          </div>

          <div className="space-y-4">
            <label className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-100 p-4 transition-colors hover:bg-slate-50">
              <div className="space-y-0.5">
                <span className="font-bold text-slate-900 text-sm">Enable SOS Button</span>
                <span className="block text-xs font-medium text-slate-500">Allow users and drivers to trigger SOS</span>
              </div>
              <input
                type="checkbox"
                name="enable_sos"
                checked={settings.enable_sos}
                onChange={handleChange}
                className="h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary"
              />
            </label>

            <label className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-100 p-4 transition-colors hover:bg-slate-50">
              <div className="space-y-0.5">
                <span className="font-bold text-slate-900 text-sm">Enable Ride Check</span>
                <span className="block text-xs font-medium text-slate-500">Ask if the user is okay during long stops</span>
              </div>
              <input
                type="checkbox"
                name="enable_ride_check"
                checked={settings.enable_ride_check}
                onChange={handleChange}
                className="h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary"
              />
            </label>
          </div>
        </div>

        <div className="rounded-[24px] border border-slate-100 bg-white p-6 shadow-sm">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900">Thresholds & Limits</h3>
              <p className="text-xs font-medium text-slate-500">Configure parameters for safety checks</p>
            </div>
          </div>

          <div className="space-y-5">
            <div>
              <label className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700">
                <Clock className="h-4 w-4 text-slate-400" /> Ride Check Interval (Minutes)
              </label>
              <input
                type="number"
                name="popup_interval_minutes"
                value={settings.popup_interval_minutes}
                onChange={handleChange}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="e.g. 15"
              />
            </div>

            <div>
              <label className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700">
                <Clock className="h-4 w-4 text-slate-400" /> SOS Auto-Escalation (Minutes)
              </label>
              <input
                type="number"
                name="alert_timeout_minutes"
                value={settings.alert_timeout_minutes}
                onChange={handleChange}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="e.g. 5"
              />
            </div>
          </div>
        </div>

        <div className="rounded-[24px] border border-slate-100 bg-white p-6 shadow-sm md:col-span-2">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <Phone className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900">Contacts & Helplines</h3>
              <p className="text-xs font-medium text-slate-500">Emergency numbers and trusted contact limits</p>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-bold text-slate-700">Central Emergency Helpline</label>
              <input
                type="text"
                name="emergency_helpline"
                value={settings.emergency_helpline}
                onChange={handleChange}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="e.g. 911 or 112"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-bold text-slate-700">Max Trusted Contacts per User</label>
              <input
                type="number"
                name="max_trusted_contacts"
                value={settings.max_trusted_contacts}
                onChange={handleChange}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="e.g. 5"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SafetySettings;

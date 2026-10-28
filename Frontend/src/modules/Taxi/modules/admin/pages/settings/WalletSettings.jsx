import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronRight,
  Loader2,
  Save,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../../shared/api/axiosInstance';

const AMOUNT_FIELDS = [
  {
    name: 'driver_wallet_minimum_amount_to_get_an_order',
    label: 'Driver minimum balance to get orders',
    help: 'Driver app blocks new orders when wallet balance is below this amount. Use a negative value to allow cash debt.',
    placeholder: '-500',
  },
  {
    name: 'minimum_amount_added_to_wallet',
    label: 'Minimum driver top-up amount',
    help: 'Driver cannot add less than this amount from the wallet page.',
    placeholder: '500',
  },
  {
    name: 'minimum_wallet_amount_for_transfer',
    label: 'Minimum transfer amount',
    help: 'Shown to drivers as the minimum amount for wallet transfers.',
    placeholder: '100',
  },
  {
    name: 'owner_wallet_minimum_amount_to_get_an_order',
    label: 'Owner minimum balance to get orders',
    help: 'Kept here for owner wallet rules.',
    placeholder: '-500',
  },
];

const SWITCH_FIELDS = [
  {
    name: 'show_wallet_feature_for_driver',
    label: 'Driver wallet enabled',
    help: 'Controls whether the driver wallet can be used.',
  },
  {
    name: 'enable_wallet_transfer_driver',
    label: 'Driver wallet transfer enabled',
    help: 'Controls the transfer status shown in driver wallet.',
  },
  {
    name: 'show_wallet_feature_for_owner',
    label: 'Owner wallet enabled',
    help: 'Keeps owner wallet visibility controlled from here too.',
  },
  {
    name: 'enable_wallet_transfer_owner',
    label: 'Owner wallet transfer enabled',
    help: 'Controls owner wallet transfer availability.',
  },
  {
    name: 'show_wallet_feature_on_mobile_app',
    label: 'Wallet feature on mobile app',
    help: 'Master mobile visibility flag for wallet features.',
  },
];

const isEnabled = (value) => ['1', 'true', 'yes', 'on'].includes(String(value ?? '1').trim().toLowerCase());

const Stat = ({ label, value, tone = 'slate' }) => {
  const toneClass = tone === 'green' ? 'text-emerald-600 bg-emerald-50' : 'text-slate-700 bg-slate-50';

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4">
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className={`mt-2 inline-flex rounded-full px-3 py-1 text-sm font-black ${toneClass}`}>{value}</p>
    </div>
  );
};

const AmountField = ({ field, value, onChange }) => (
  <label className="block rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
    <span className="text-sm font-black text-slate-900">{field.label}</span>
    <span className="mt-1 block text-xs font-semibold leading-relaxed text-slate-500">{field.help}</span>
    <input
      type="number"
      name={field.name}
      value={value ?? ''}
      onChange={(event) => onChange(field.name, event.target.value)}
      placeholder={field.placeholder}
      className="mt-4 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-900 outline-none transition focus:border-slate-900 focus:bg-white"
    />
  </label>
);

const SwitchField = ({ field, checked, onToggle }) => (
  <button
    type="button"
    onClick={() => onToggle(field.name)}
    className="flex w-full items-center justify-between gap-4 rounded-2xl border border-slate-100 bg-white p-4 text-left shadow-sm"
  >
    <span>
      <span className="block text-sm font-black text-slate-900">{field.label}</span>
      <span className="mt-1 block text-xs font-semibold leading-relaxed text-slate-500">{field.help}</span>
    </span>
    <span className={`relative h-7 w-12 shrink-0 rounded-full transition ${checked ? 'bg-emerald-500' : 'bg-slate-300'}`}>
      <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${checked ? 'left-6' : 'left-1'}`} />
    </span>
  </button>
);

const WalletSettings = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState({});

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await api.get('/admin/general-settings/wallet');
      setSettings(res.data?.settings || res.settings || {});
    } catch (err) {
      console.error('Fetch error:', err);
      toast.error('Failed to load wallet settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const preview = useMemo(() => {
    const driverMinimum = Number(settings.driver_wallet_minimum_amount_to_get_an_order || 0);
    const sampleBalance = -47.55;

    return {
      driverMinimum,
      sampleBalance,
      canReceiveOrders: isEnabled(settings.show_wallet_feature_for_driver) && sampleBalance >= driverMinimum,
    };
  }, [settings]);

  const handleUpdate = async () => {
    try {
      setSaving(true);
      const response = await api.patch('/admin/general-settings/wallet', { settings });
      setSettings(response.data?.settings || response.settings || settings);
      toast.success('Wallet settings saved');
    } catch (err) {
      toast.error('Failed to save wallet settings');
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (name, value) => {
    setSettings((prev) => ({ ...prev, [name]: value }));
  };

  const handleToggle = (name) => {
    setSettings((prev) => ({ ...prev, [name]: isEnabled(prev[name]) ? '0' : '1' }));
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="h-10 w-10 animate-spin text-slate-900" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F6F4EF] p-5 lg:p-8">
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">App Settings</p>
          <h1 className="mt-1 text-2xl font-black text-slate-950">Wallet Settings</h1>
        </div>
        <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-slate-400">
          <span>Wallet Settings</span>
          <ChevronRight size={13} strokeWidth={3} />
          <span className="text-slate-900">Wallet</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 pb-28 xl:grid-cols-[1.25fr_0.75fr]">
        <section className="space-y-5">
          <div className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
            <div className="mb-5 flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-950 text-white">
                <Wallet size={21} />
              </div>
              <div>
                <h2 className="text-lg font-black text-slate-950">Amounts</h2>
                <p className="text-xs font-semibold text-slate-500">These numbers directly control driver wallet behavior.</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {AMOUNT_FIELDS.map((field) => (
                <AmountField key={field.name} field={field} value={settings[field.name]} onChange={handleChange} />
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
            <div className="mb-5 flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-50 text-emerald-600">
                <ShieldCheck size={21} />
              </div>
              <div>
                <h2 className="text-lg font-black text-slate-950">Feature Controls</h2>
                <p className="text-xs font-semibold text-slate-500">Switch wallet features on or off without touching code.</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {SWITCH_FIELDS.map((field) => (
                <SwitchField key={field.name} field={field} checked={isEnabled(settings[field.name])} onToggle={handleToggle} />
              ))}
            </div>
          </div>
        </section>

        <aside className="space-y-5">
          <div className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Driver preview</p>
            <div className="mt-4 rounded-[2rem] bg-slate-950 p-5 text-white">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/45">Sample wallet balance</p>
              <h3 className="mt-2 text-4xl font-black">Rs {preview.sampleBalance.toFixed(2)}</h3>
              <p className={`mt-4 inline-flex rounded-full px-3 py-1 text-[11px] font-black ${preview.canReceiveOrders ? 'bg-emerald-400/15 text-emerald-200' : 'bg-amber-400/15 text-amber-200'}`}>
                {preview.canReceiveOrders ? 'Ready for orders' : 'Top up to receive orders'}
              </p>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3">
              <Stat label="Driver order minimum" value={`Rs ${preview.driverMinimum.toFixed(2)}`} tone="green" />
              <Stat label="Driver wallet" value={isEnabled(settings.show_wallet_feature_for_driver) ? 'Enabled' : 'Disabled'} />
              <Stat label="Driver transfer" value={isEnabled(settings.enable_wallet_transfer_driver) ? 'Enabled' : 'Disabled'} />
            </div>
          </div>

          <div className="rounded-3xl border border-amber-100 bg-amber-50 p-5">
            <p className="text-sm font-black text-amber-900">How driver control works</p>
            <p className="mt-2 text-xs font-bold leading-relaxed text-amber-800">
              The driver wallet page reads these settings from the backend. Top-up minimum is enforced by the API, and order eligibility uses the driver minimum balance.
            </p>
          </div>
        </aside>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-slate-200 bg-white/90 p-4 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] justify-end">
          <button
            onClick={handleUpdate}
            disabled={saving}
            className="flex h-12 min-w-[150px] items-center justify-center gap-2 rounded-2xl bg-slate-950 px-6 text-sm font-black uppercase tracking-widest text-white shadow-lg disabled:bg-slate-300"
          >
            {saving ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

export default WalletSettings;

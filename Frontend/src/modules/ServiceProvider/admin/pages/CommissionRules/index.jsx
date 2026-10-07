import React, { useState, useEffect, useMemo } from 'react';
import api from '@sp/services/api';
import { FiPlus, FiEdit2, FiTrash2, FiX, FiInfo, FiPercent } from 'react-icons/fi';
import { toast } from 'react-hot-toast';

/**
 * Commission Rules (SOW §8, plan §3.2)
 *
 * Bookings up to the commission threshold are covered by the provider's
 * subscription (no commission). Above it, the most specific active rule wins:
 * provider > category > global. Editing a rule never changes bookings already
 * priced; each booking keeps a snapshot of the rule it was charged under.
 */

const TABS = [
  { id: 'global', label: 'Global' },
  { id: 'category', label: 'Category' },
  { id: 'provider', label: 'Provider' }
];

const emptyForm = (scope) => ({
  scope,
  refId: '',
  providerType: 'worker',
  type: 'percentage',
  value: '',
  active: true,
  validFrom: '',
  validTo: '',
  note: ''
});

const toDateInput = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const formatValue = (rule) => (rule.type === 'fixed' ? `₹${Number(rule.value).toLocaleString('en-IN')}` : `${rule.value}%`);
const formatWindow = (rule) => {
  if (!rule.validFrom && !rule.validTo) return 'Always';
  const from = rule.validFrom ? new Date(rule.validFrom).toLocaleDateString('en-IN') : '…';
  const to = rule.validTo ? new Date(rule.validTo).toLocaleDateString('en-IN') : '…';
  return `${from} – ${to}`;
};

const CommissionRules = () => {
  const [activeTab, setActiveTab] = useState('global');
  const [rules, setRules] = useState([]);
  const [engineSettings, setEngineSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [formData, setFormData] = useState(emptyForm('global'));
  const [options, setOptions] = useState([]);
  const [saving, setSaving] = useState(false);

  const fetchRules = async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/commission-rules');
      if (res.data.success) {
        setRules(res.data.data || []);
        setEngineSettings(res.data.settings || null);
      }
    } catch (error) {
      console.error('Fetch commission rules failed', error);
      toast.error('Failed to load commission rules');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRules();
  }, []);

  // Pick-list for category / provider rules
  const optionKind = formData.scope === 'category' ? 'category' : formData.scope === 'provider' ? formData.providerType : null;
  useEffect(() => {
    if (!isModalOpen || !optionKind) {
      setOptions([]);
      return;
    }
    api.get('/admin/commission-rules/options', { params: { kind: optionKind } })
      .then((res) => setOptions(res.data?.data || []))
      .catch(() => setOptions([]));
  }, [isModalOpen, optionKind]);

  const tabRules = useMemo(() => rules.filter((r) => r.scope === activeTab), [rules, activeTab]);
  const hasActiveGlobal = rules.some((r) => r.scope === 'global' && r.active);

  const openCreate = () => {
    setEditing(null);
    setFormData(emptyForm(activeTab));
    setIsModalOpen(true);
  };

  const openEdit = (rule) => {
    setEditing(rule);
    setFormData({
      scope: rule.scope,
      refId: rule.refId || '',
      providerType: rule.providerType || 'worker',
      type: rule.type,
      value: rule.value,
      active: rule.active,
      validFrom: toDateInput(rule.validFrom),
      validTo: toDateInput(rule.validTo),
      note: rule.note || ''
    });
    setIsModalOpen(true);
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
      // A different provider type means a different pick-list
      ...(name === 'providerType' ? { refId: '' } : {})
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...formData,
        value: Number(formData.value),
        refId: formData.scope === 'global' ? null : formData.refId,
        providerType: formData.scope === 'provider' ? formData.providerType : null,
        validFrom: formData.validFrom || null,
        validTo: formData.validTo || null
      };
      if (editing) {
        await api.put(`/admin/commission-rules/${editing._id}`, payload);
        toast.success('Rule updated');
      } else {
        await api.post('/admin/commission-rules', payload);
        toast.success('Rule created');
      }
      setIsModalOpen(false);
      fetchRules();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Error saving rule');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (rule) => {
    try {
      await api.patch(`/admin/commission-rules/${rule._id}/toggle`, { active: !rule.active });
      fetchRules();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to update rule');
    }
  };

  const handleDelete = async (rule) => {
    if (!window.confirm('Delete this rule? Bookings already charged under it keep their amounts.')) return;
    try {
      await api.delete(`/admin/commission-rules/${rule._id}`);
      toast.success('Rule deleted');
      fetchRules();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to delete rule');
    }
  };

  const threshold = engineSettings?.commissionThreshold ?? 1000;

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Commission Rules</h1>
          <p className="text-gray-500">Commission charged on bookings above ₹{Number(threshold).toLocaleString('en-IN')}</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 transition-colors shadow-md w-fit"
        >
          <FiPlus /> Add {TABS.find((t) => t.id === activeTab)?.label} Rule
        </button>
      </div>

      {/* How the engine decides */}
      <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 flex gap-3 text-sm text-indigo-900">
        <FiInfo className="w-5 h-5 flex-shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p>Up to ₹{Number(threshold).toLocaleString('en-IN')}: no commission for providers with an active subscription (₹{Number(engineSettings?.subscriptionPrice ?? 1000).toLocaleString('en-IN')}/month, platform fee ₹{Number(engineSettings?.subscriptionPlatformFee ?? 100).toLocaleString('en-IN')}).</p>
          <p>Above it: the provider rule applies, else the category rule, else the global rule, on the whole booking.</p>
          {!hasActiveGlobal && (
            <p className="font-semibold">No active global rule: {engineSettings?.fallbackCommissionPercentage ?? 10}% is used (100 − Service Payout % in Settings).</p>
          )}
          <p className="text-indigo-700/80">Threshold and subscription amounts are set in Settings → Financial.</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-6 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${activeTab === tab.id
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
          >
            {tab.label}
            <span className="ml-2 text-xs text-gray-400">{rules.filter((r) => r.scope === tab.id).length}</span>
          </button>
        ))}
      </div>

      {/* List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
        {loading ? (
          <div className="p-10 text-center text-gray-400">Loading…</div>
        ) : tabRules.length === 0 ? (
          <div className="p-10 text-center text-gray-400">
            <FiPercent className="w-8 h-8 mx-auto mb-2" />
            No {activeTab} rules yet
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                {activeTab !== 'global' && <th className="px-4 py-3 text-left">{activeTab === 'category' ? 'Category' : 'Provider'}</th>}
                <th className="px-4 py-3 text-left">Commission</th>
                <th className="px-4 py-3 text-left">Valid</th>
                <th className="px-4 py-3 text-left">Note</th>
                <th className="px-4 py-3 text-left">Active</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tabRules.map((rule) => (
                <tr key={rule._id} className={rule.active ? '' : 'opacity-60'}>
                  {activeTab !== 'global' && (
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-800">{rule.refLabel || '-'}</div>
                      {rule.providerType && <div className="text-xs text-gray-400 capitalize">{rule.providerType}</div>}
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <span className="font-semibold text-gray-800">{formatValue(rule)}</span>
                    <span className="ml-2 text-xs text-gray-400">{rule.type}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{formatWindow(rule)}</td>
                  <td className="px-4 py-3 text-gray-500 max-w-[200px] truncate">{rule.note || '-'}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleToggle(rule)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${rule.active ? 'bg-green-500' : 'bg-gray-300'}`}
                      aria-label={rule.active ? 'Deactivate rule' : 'Activate rule'}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${rule.active ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => openEdit(rule)} className="p-2 text-gray-500 hover:text-indigo-600" aria-label="Edit rule"><FiEdit2 /></button>
                    <button onClick={() => handleDelete(rule)} className="p-2 text-gray-500 hover:text-red-600" aria-label="Delete rule"><FiTrash2 /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create / edit modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-800">
                {editing ? 'Edit' : 'New'} {TABS.find((t) => t.id === formData.scope)?.label} Rule
              </h2>
              <button onClick={() => setIsModalOpen(false)} className="p-2 text-gray-400 hover:text-gray-600" aria-label="Close"><FiX /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              {formData.scope === 'provider' && (
                <div className="space-y-1.5">
                  <label className="text-sm font-bold text-gray-700">Provider Type</label>
                  <select name="providerType" value={formData.providerType} onChange={handleChange}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="worker">Worker</option>
                    <option value="vendor">Vendor</option>
                  </select>
                </div>
              )}
              {formData.scope !== 'global' && (
                <div className="space-y-1.5">
                  <label className="text-sm font-bold text-gray-700">{formData.scope === 'category' ? 'Category' : 'Provider'}</label>
                  <select name="refId" value={formData.refId} onChange={handleChange} required
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="">Select…</option>
                    {editing && formData.refId && !options.some((o) => o.id === formData.refId) && (
                      <option value={formData.refId}>{editing.refLabel || formData.refId}</option>
                    )}
                    {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-bold text-gray-700">Type</label>
                  <select name="type" value={formData.type} onChange={handleChange}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="percentage">Percentage</option>
                    <option value="fixed">Fixed (₹)</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-bold text-gray-700">{formData.type === 'fixed' ? 'Amount (₹)' : 'Percentage (%)'}</label>
                  <input type="number" name="value" value={formData.value} onChange={handleChange} required
                    min="0" max={formData.type === 'percentage' ? 100 : undefined} step="0.01"
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
              {formData.type === 'fixed' && (
                <p className="text-xs text-gray-400">A fixed commission never exceeds the booking amount it is charged on.</p>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-bold text-gray-700">Valid From</label>
                  <input type="date" name="validFrom" value={formData.validFrom} onChange={handleChange}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-bold text-gray-700">Valid To</label>
                  <input type="date" name="validTo" value={formData.validTo} onChange={handleChange}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-bold text-gray-700">Note</label>
                <input type="text" name="note" value={formData.note} onChange={handleChange} placeholder="Optional"
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <label className="flex items-center gap-3 text-sm font-bold text-gray-700">
                <input type="checkbox" name="active" checked={formData.active} onChange={handleChange} className="w-5 h-5 text-indigo-600 rounded" />
                Active
              </label>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button type="submit" disabled={saving}
                  className="px-5 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 disabled:opacity-60">
                  {saving ? 'Saving…' : 'Save Rule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default CommissionRules;

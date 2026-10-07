import React, { useCallback, useEffect, useState } from 'react';
import { FiCheck, FiX, FiRotateCcw, FiExternalLink } from 'react-icons/fi';
import { toast } from 'react-hot-toast';
import api from '@sp/services/api';

/**
 * Onboarding details for a vendor or worker (plan §3.3): GST / PAN documents,
 * experience, certifications, bank details (account number masked by the API)
 * and the verification checklist with verify / reject buttons.
 *
 * Reads GET /admin/{vendors|workers}/:id (data.onboarding) and writes
 * PUT /admin/{vendors|workers}/:id/verification/:item.
 */
const ITEMS = [
  ['aadhaar', 'Aadhaar'],
  ['pan', 'PAN'],
  ['gst', 'GST'],
  ['address', 'Address'],
  ['background', 'Background check']
];

const STATUS_STYLE = {
  verified: 'bg-green-50 text-green-700 border-green-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
  pending: 'bg-yellow-50 text-yellow-700 border-yellow-200'
};

const DocLink = ({ url, label }) => (url ? (
  <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">
    {label} <FiExternalLink className="w-3 h-3" />
  </a>
) : <span className="text-xs text-gray-400">No document</span>);

const Field = ({ label, children }) => (
  <div>
    <div className="text-[11px] font-semibold text-gray-500 uppercase mb-0.5">{label}</div>
    <div className="text-sm text-gray-900">{children}</div>
  </div>
);

const ProviderOnboardingPanel = ({ role, providerId, onChange }) => {
  const base = role === 'vendor' ? '/admin/vendors' : '/admin/workers';
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    if (!providerId) return;
    setLoading(true);
    try {
      const res = await api.get(`${base}/${providerId}`);
      setData(res.data?.data?.onboarding || null);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to load onboarding details');
    } finally {
      setLoading(false);
    }
  }, [base, providerId]);

  useEffect(() => { load(); }, [load]);

  const setItem = async (item, status) => {
    let note;
    if (status === 'rejected') {
      note = window.prompt('Reason for rejecting this item?');
      if (!note) return;
    }
    setBusy(item);
    try {
      const res = await api.put(`${base}/${providerId}/verification/${item}`, { status, note });
      setData(res.data?.data || null);
      toast.success(res.data?.message || 'Updated');
      if (onChange) onChange(res.data?.data);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to update');
    } finally {
      setBusy(null);
    }
  };

  if (loading && !data) return <div className="text-sm text-gray-500">Loading onboarding details…</div>;
  if (!data) return null;

  const v = data.verification || { items: {}, missing: [], required: [] };
  const bank = data.bankDetails;

  return (
    <div className="space-y-5">
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Profile &amp; documents</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="GST">
            {data.gst?.number || '—'}
            {data.gst?.number && (
              <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] border ${data.gst.verified ? STATUS_STYLE.verified : STATUS_STYLE.pending}`}>
                {data.gst.verified ? 'verified' : 'unverified'}
              </span>
            )}
            <div><DocLink url={data.gst?.document} label="GST certificate" /></div>
          </Field>
          <Field label="PAN">
            {data.pan?.number || '—'}
            <div><DocLink url={data.pan?.document} label="PAN card" /></div>
          </Field>
          <Field label="Experience">{data.experienceYears !== null && data.experienceYears !== undefined ? `${data.experienceYears} years` : '—'}</Field>
          <Field label={role === 'worker' ? 'Service radius' : 'Service range'}>{data.serviceRadiusKm ? `${data.serviceRadiusKm} km` : 'Platform default'}</Field>
          <Field label="Email verified">{data.isEmailVerified ? 'Yes' : 'No'}</Field>
          <Field label="Bank details">
            {bank ? (
              <div className="space-y-0.5">
                {bank.accountNumber && <div>A/c {bank.accountNumber} · {bank.ifscCode}</div>}
                {bank.accountHolderName && <div className="text-xs text-gray-500">{bank.accountHolderName}{bank.bankName ? ` · ${bank.bankName}` : ''}</div>}
                {bank.upiId && <div className="text-xs text-gray-500">UPI {bank.upiId}</div>}
              </div>
            ) : '—'}
          </Field>
        </div>
        {data.certifications?.length > 0 && (
          <div className="mt-4">
            <div className="text-[11px] font-semibold text-gray-500 uppercase mb-1">Certifications</div>
            <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
              {data.certifications.map((c, i) => (
                <li key={`${c.name}-${i}`} className="px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>
                    <span className="font-medium">{c.name}</span>
                    {c.issuer && <span className="text-gray-500"> · {c.issuer}</span>}
                    {c.expiresAt && (
                      <span className={`ml-2 text-xs ${new Date(c.expiresAt) < new Date() ? 'text-red-600' : 'text-gray-500'}`}>
                        expires {new Date(c.expiresAt).toLocaleDateString()}
                      </span>
                    )}
                  </span>
                  <DocLink url={c.document} label="View" />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold text-gray-700">Verification checklist</h4>
          {v.missing?.length > 0
            ? <span className="text-xs text-red-600">Approval needs: {v.missing.join(', ')}</span>
            : <span className="text-xs text-green-600">Ready to approve</span>}
        </div>
        <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
          {ITEMS.map(([key, label]) => {
            const item = v.items?.[key] || { status: 'pending' };
            return (
              <li key={key} className="px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900">
                    {label}
                    {item.required && <span className="ml-1 text-[10px] text-gray-500">(required)</span>}
                  </div>
                  <div className="text-xs text-gray-500">
                    <span className={`px-1.5 py-0.5 rounded border ${STATUS_STYLE[item.status] || STATUS_STYLE.pending}`}>{item.status}</span>
                    {item.verifiedAt && <span className="ml-2">{new Date(item.verifiedAt).toLocaleString()}</span>}
                    {item.note && <span className="ml-2 italic">“{item.note}”</span>}
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <button type="button" disabled={busy === key || item.status === 'verified'} onClick={() => setItem(key, 'verified')}
                    className="px-2 py-1 text-xs rounded-md bg-green-600 text-white disabled:opacity-40 inline-flex items-center gap-1">
                    <FiCheck className="w-3 h-3" /> Verify
                  </button>
                  <button type="button" disabled={busy === key || item.status === 'rejected'} onClick={() => setItem(key, 'rejected')}
                    className="px-2 py-1 text-xs rounded-md bg-red-600 text-white disabled:opacity-40 inline-flex items-center gap-1">
                    <FiX className="w-3 h-3" /> Reject
                  </button>
                  {item.status !== 'pending' && (
                    <button type="button" disabled={busy === key} onClick={() => setItem(key, 'pending')}
                      className="px-2 py-1 text-xs rounded-md border border-gray-300 text-gray-700 disabled:opacity-40 inline-flex items-center gap-1" title="Reset to pending">
                      <FiRotateCcw className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};

export default ProviderOnboardingPanel;

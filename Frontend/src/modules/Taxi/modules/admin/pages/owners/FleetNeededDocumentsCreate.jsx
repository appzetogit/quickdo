import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Save } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import AdminPageHeader from '../../components/ui/AdminPageHeader';

const BASE = `${globalThis.__LEGACY_BACKEND_ORIGIN__}/api/v1/taxi/admin/owner-management`;

const inputClass =
  'w-full border border-gray-200 rounded-lg px-4 py-3 text-sm text-gray-800 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-colors';
const labelClass = 'block text-sm font-semibold text-gray-900 mb-2';

const FleetNeededDocumentsCreate = () => {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    image_type: '',
    has_expiry_date: '',
    has_identify_number: '',
    is_editable: false,
    is_required: false,
    active: true,
  });

  const token = (localStorage.getItem('admin_accessToken') || localStorage.getItem('adminToken')) || '';

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!formData.name || !formData.image_type || formData.has_expiry_date === '' || formData.has_identify_number === '') {
      alert('Please fill all required fields');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${BASE}/driver-needed-document`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...formData,
          has_expiry_date: formData.has_expiry_date === '1',
          has_identify_number: formData.has_identify_number === '1',
        }),
      });

      const json = await res.json();
      if (json?.success) {
        navigate('/taxi/admin/fleet/documents');
        return;
      }
      alert(json?.message || 'Operation failed');
    } catch (error) {
      console.error('Failed to create fleet needed document:', error);
      alert('Network error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-950">
      <div className="px-5 pt-3">
        <AdminPageHeader
          module="Fleet Management"
          page="Fleet Needed Documents"
          title="Create Fleet Needed Document"
          backto="/taxi/admin/fleet/documents"
        />
      </div>

      <div className="px-5 pb-10">
        <div className="rounded border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-8 py-6" />

          <form onSubmit={handleSubmit} className="p-8">
            <div className="grid grid-cols-1 gap-x-10 gap-y-7 md:grid-cols-2">
              <div>
                <label className={labelClass}>
                  Document Name <span className="text-rose-500">*</span>
                </label>
                <input
                  value={formData.name}
                  onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                  className={inputClass}
                  placeholder="Enter Name"
                />
              </div>

              <div>
                <label className={labelClass}>
                  Image Type <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <select
                    value={formData.image_type}
                    onChange={(e) => setFormData((prev) => ({ ...prev, image_type: e.target.value }))}
                    className={`${inputClass} appearance-none pr-10`}
                  >
                    <option value="">Select</option>
                    <option value="front">Front</option>
                    <option value="front_back">Front&amp;Back</option>
                  </select>
                  <ChevronDown size={18} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
                </div>
              </div>

              <div>
                <label className={labelClass}>
                  Has Expiry Date <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <select
                    value={formData.has_expiry_date}
                    onChange={(e) => setFormData((prev) => ({ ...prev, has_expiry_date: e.target.value }))}
                    className={`${inputClass} appearance-none pr-10`}
                  >
                    <option value="">Select</option>
                    <option value="1">Yes</option>
                    <option value="0">No</option>
                  </select>
                  <ChevronDown size={18} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
                </div>
              </div>

              <div>
                <label className={labelClass}>
                  Has Identify Number <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <select
                    value={formData.has_identify_number}
                    onChange={(e) => setFormData((prev) => ({ ...prev, has_identify_number: e.target.value }))}
                    className={`${inputClass} appearance-none pr-10`}
                  >
                    <option value="">Select</option>
                    <option value="1">Yes</option>
                    <option value="0">No</option>
                  </select>
                  <ChevronDown size={18} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
                </div>
              </div>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-16">
              <label className="flex items-center gap-3 text-sm font-semibold text-gray-900">
                <input
                  type="checkbox"
                  checked={formData.is_editable}
                  onChange={(e) => setFormData((prev) => ({ ...prev, is_editable: e.target.checked }))}
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                Is Editable?
              </label>
              <label className="flex items-center gap-3 text-sm font-semibold text-gray-900">
                <input
                  type="checkbox"
                  checked={formData.is_required}
                  onChange={(e) => setFormData((prev) => ({ ...prev, is_required: e.target.checked }))}
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                Is Required?
              </label>
            </div>

            <div className="mt-10 flex items-center justify-end">
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex h-12 items-center gap-2 rounded bg-indigo-950 px-8 text-sm font-semibold text-white transition-colors hover:bg-indigo-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                Save
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default FleetNeededDocumentsCreate;


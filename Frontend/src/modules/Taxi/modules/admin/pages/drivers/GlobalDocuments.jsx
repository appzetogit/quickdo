import React, { useEffect, useMemo, useState } from 'react';
import { ChevronRight, PencilLine, Plus, Search, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { adminService } from '../../services/adminService';
import { useDriverPaths } from './driverPaths';

const inputClass =
  'w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm text-gray-800 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500';

const typeLabel = (value) =>
  String(value || '')
    .split('_')
    .filter(Boolean)
    .map((item) => item.charAt(0).toUpperCase() + item.slice(1))
    .join(' ');

const vehicleFieldOrder = [
  'locationId',
  'serviceCategories',
  'vehicleTypeId',
  'make',
  'model',
  'year',
  'number',
  'color',
  'companyName',
  'companyAddress',
  'city',
  'postalCode',
  'taxNumber',
];

const getVehicleFieldPriority = (fieldKey = '') => {
  const index = vehicleFieldOrder.indexOf(String(fieldKey || '').trim());
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
};

const GlobalDocuments = () => {
  const navigate = useNavigate();
  const driverPaths = useDriverPaths();
  const [documents, setDocuments] = useState([]);
  const [vehicleFields, setVehicleFields] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [pageSize, setPageSize] = useState(10);
  const [error, setError] = useState('');

  const loadItems = async () => {
    setIsLoading(true);
    setError('');

    try {
      const [documentResponse, fieldResponse] = await Promise.all([
        adminService.getDriverNeededDocuments('document'),
        adminService.getDriverNeededDocuments('vehicle_field'),
      ]);

      const nextDocuments = documentResponse?.data?.data?.results || documentResponse?.data?.results || [];
      const nextVehicleFields = fieldResponse?.data?.data?.results || fieldResponse?.data?.results || [];

      setDocuments(Array.isArray(nextDocuments) ? nextDocuments : []);
      setVehicleFields(Array.isArray(nextVehicleFields) ? nextVehicleFields : []);
    } catch (err) {
      setError(err?.message || 'Unable to load onboarding configuration');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadItems();
  }, []);

  const handleDelete = async (id, entityLabel) => {
    if (!window.confirm(`Delete this ${entityLabel}?`)) {
      return;
    }

    try {
      await adminService.deleteDriverNeededDocument(id);
      await loadItems();
    } catch (err) {
      alert(err?.message || `Unable to delete ${entityLabel}`);
    }
  };

  const handleToggleStatus = async (item) => {
    try {
      await adminService.updateDriverNeededDocument(item.id || item._id, {
        active: !item.active,
      });
      await loadItems();
    } catch (err) {
      alert(err?.message || 'Unable to update status');
    }
  };

  const filteredDocuments = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return documents;

    return documents.filter((item) =>
      [item.name, item.account_type, item.image_type]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [documents, searchTerm]);

  const filteredVehicleFields = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return vehicleFields;

    return vehicleFields.filter((item) =>
      [item.name, item.field_key, item.field_type, item.account_type, item.field_group]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [vehicleFields, searchTerm]);

  const paginatedDocuments = filteredDocuments.slice(0, Number(pageSize));
  const paginatedVehicleFields = [...filteredVehicleFields]
    .sort((a, b) => {
      const priorityDifference =
        getVehicleFieldPriority(a.field_key) - getVehicleFieldPriority(b.field_key);

      if (priorityDifference !== 0) {
        return priorityDifference;
      }

      return Number(a.sort_order || 0) - Number(b.sort_order || 0);
    })
    .slice(0, Number(pageSize));

  const renderStatusButton = (item) => (
    <button
      type="button"
      onClick={() => handleToggleStatus(item)}
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
        item.active
          ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
      }`}
    >
      {item.active ? 'Active' : 'Inactive'}
    </button>
  );

  const renderActions = (item, templateType) => (
    <div className="flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={() => navigate(`${driverPaths.docs}/edit/${item.id || item._id}?type=${templateType}`)}
        className="rounded-lg border border-gray-200 p-2 text-amber-600 transition-colors hover:bg-amber-50"
      >
        <PencilLine size={16} />
      </button>
      <button
        type="button"
        onClick={() => handleDelete(item.id || item._id, templateType === 'vehicle_field' ? 'vehicle field' : 'document')}
        className="rounded-lg border border-gray-200 p-2 text-rose-600 transition-colors hover:bg-rose-50"
      >
        <Trash2 size={16} />
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-8">
      <div className="mb-6">
        <div className="mb-2 flex items-center gap-1.5 text-xs text-gray-400">
          <span>Masters</span>
          <ChevronRight size={12} />
          <span className="text-gray-700">Driver Onboarding Config</span>
        </div>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Driver Onboarding Config</h1>
            <p className="mt-1 text-sm text-gray-500">
              Manage both driver document templates and the dynamic fields shown on the vehicle onboarding step.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => navigate(`${driverPaths.docs}/create?type=document`)}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
            >
              <Plus size={16} />
              Add Document
            </button>
            <button
              type="button"
              onClick={() => navigate(`${driverPaths.docs}/create?type=vehicle_field`)}
              className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-white px-4 py-2 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-50"
            >
              <Plus size={16} />
              Add Vehicle Field
            </button>
          </div>
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3 text-sm text-gray-500">
            <span>Show</span>
            <select
              value={pageSize}
              onChange={(event) => setPageSize(Number(event.target.value))}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
            <span>entries</span>
          </div>

          <div className="relative w-full lg:max-w-sm">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Filter documents or fields..."
              className={inputClass}
            />
          </div>
        </div>
      </div>

      {error ? (
        <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
          {error}
        </div>
      ) : null}

      <div className="space-y-6">
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-6 py-4">
            <h2 className="text-base font-semibold text-gray-900">Driver Needed Documents</h2>
            <p className="mt-1 text-sm text-gray-500">Templates used by the documents step of onboarding.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Name</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Account Type</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Image Type</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Status</th>
                  <th className="px-6 py-4 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {isLoading ? (
                  <tr>
                    <td colSpan="5" className="px-6 py-16 text-center text-sm text-gray-500">Loading document templates...</td>
                  </tr>
                ) : paginatedDocuments.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="px-6 py-16 text-center text-sm text-gray-500">No document templates found.</td>
                  </tr>
                ) : (
                  paginatedDocuments.map((item) => (
                    <tr key={item.id || item._id} className="hover:bg-gray-50/70">
                      <td className="px-6 py-4 text-sm font-semibold text-gray-900">{item.name}</td>
                      <td className="px-6 py-4 text-sm text-gray-700">{typeLabel(item.account_type)}</td>
                      <td className="px-6 py-4 text-sm text-gray-700">{typeLabel(item.image_type)}</td>
                      <td className="px-6 py-4">{renderStatusButton(item)}</td>
                      <td className="px-6 py-4">{renderActions(item, 'document')}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-6 py-4">
            <h2 className="text-base font-semibold text-gray-900">Vehicle Step Fields</h2>
            <p className="mt-1 text-sm text-gray-500">
              These control which fields appear on `/taxi/driver/step-vehicle`, their labels, placeholders, order, and required state.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Label</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Field Key</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Field Type</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Account Type</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Order</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Required</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Status</th>
                  <th className="px-6 py-4 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {isLoading ? (
                  <tr>
                    <td colSpan="8" className="px-6 py-16 text-center text-sm text-gray-500">Loading vehicle fields...</td>
                  </tr>
                ) : paginatedVehicleFields.length === 0 ? (
                  <tr>
                    <td colSpan="8" className="px-6 py-16 text-center text-sm text-gray-500">No vehicle fields found.</td>
                  </tr>
                ) : (
                  paginatedVehicleFields.map((item, index) => (
                    <tr key={item.id || item._id} className="hover:bg-gray-50/70">
                      <td className="px-6 py-4">
                        <div className="text-sm font-semibold text-gray-900">{item.name}</div>
                        {item.placeholder ? <div className="mt-1 text-xs text-gray-500">{item.placeholder}</div> : null}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-700">{item.field_key}</td>
                      <td className="px-6 py-4 text-sm text-gray-700">{typeLabel(item.field_type)}</td>
                      <td className="px-6 py-4 text-sm text-gray-700">{typeLabel(item.account_type)}</td>
                      <td className="px-6 py-4 text-sm text-gray-700">{index + 1}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                          item.is_required ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'
                        }`}>
                          {item.is_required ? 'Required' : 'Optional'}
                        </span>
                      </td>
                      <td className="px-6 py-4">{renderStatusButton(item)}</td>
                      <td className="px-6 py-4">{renderActions(item, 'vehicle_field')}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GlobalDocuments;

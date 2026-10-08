import React, { useState, useEffect, useMemo } from 'react';
import api from '@sp/services/api';
import { FiPlus, FiEdit2, FiTrash2, FiX, FiInfo, FiPackage } from 'react-icons/fi';
import { toast } from 'react-hot-toast';

/**
 * Service Packages (plan §3.4)
 *
 * Several services and add-ons sold together at one price. A booking made from
 * a package is priced from the package on the server; the provider sees every
 * item. Commission and the bill work on the package price like any booking.
 */

const emptyForm = () => ({
  title: '',
  description: '',
  imageUrl: '',
  categoryId: '',
  price: '',
  gstPercentage: '',
  validFrom: '',
  validTo: '',
  active: true,
  sortOrder: 0,
  items: [{ serviceId: '', addOnId: '', quantity: 1 }]
});

const toDateInput = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const idOf = (v) => (v && typeof v === 'object' ? v._id || v.id : v) || '';

const formatWindow = (p) => {
  if (!p.validFrom && !p.validTo) return 'Always';
  const from = p.validFrom ? new Date(p.validFrom).toLocaleDateString('en-IN') : '…';
  const to = p.validTo ? new Date(p.validTo).toLocaleDateString('en-IN') : '…';
  return `${from} – ${to}`;
};

const ServicePackages = () => {
  const [packages, setPackages] = useState([]);
  const [categories, setCategories] = useState([]);
  const [services, setServices] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [formData, setFormData] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  const fetchPackages = async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/service-packages', { params: categoryFilter ? { categoryId: categoryFilter } : {} });
      if (res.data.success) setPackages(res.data.data || []);
    } catch (error) {
      console.error('Fetch packages failed', error);
      toast.error('Failed to load packages');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPackages();
  }, [categoryFilter]);

  useEffect(() => {
    api.get('/admin/categories')
      .then((res) => setCategories((res.data?.categories || []).map((c) => ({ id: c.id || c._id, title: c.title }))))
      .catch(() => setCategories([]));
    api.get('/admin/services')
      .then((res) => setServices(res.data?.services || []))
      .catch(() => setServices([]));
  }, []);

  const serviceById = useMemo(() => new Map(services.map((s) => [String(s._id), s])), [services]);
  const categoryTitle = (id) => categories.find((c) => String(c.id) === String(id))?.title;

  // What the items would cost bought separately, from the current catalogue.
  const catalogValue = useMemo(() => formData.items.reduce((sum, item) => {
    const svc = serviceById.get(String(item.serviceId));
    if (!svc) return sum;
    const unit = item.addOnId
      ? Number((svc.addOns || []).find((a) => String(a._id) === String(item.addOnId))?.price || 0)
      : Number(svc.basePrice || 0);
    return sum + unit * Math.max(1, Number(item.quantity) || 1);
  }, 0), [formData.items, serviceById]);

  const openCreate = () => {
    setEditing(null);
    setFormData({ ...emptyForm(), categoryId: categoryFilter || '' });
    setIsModalOpen(true);
  };

  const openEdit = (pkg) => {
    setEditing(pkg);
    setFormData({
      title: pkg.title,
      description: pkg.description || '',
      imageUrl: pkg.imageUrl || '',
      categoryId: String(idOf(pkg.categoryId)),
      price: pkg.price,
      gstPercentage: pkg.gstPercentage ?? '',
      validFrom: toDateInput(pkg.validFrom),
      validTo: toDateInput(pkg.validTo),
      active: pkg.active,
      sortOrder: pkg.sortOrder || 0,
      items: (pkg.items || []).map((i) => ({ serviceId: String(i.serviceId), addOnId: i.addOnId ? String(i.addOnId) : '', quantity: i.quantity || 1 }))
    });
    setIsModalOpen(true);
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const setItem = (idx, patch) => {
    setFormData((prev) => ({
      ...prev,
      items: prev.items.map((item, i) => (i === idx ? { ...item, ...patch } : item))
    }));
  };
  const addItem = () => setFormData((prev) => ({ ...prev, items: [...prev.items, { serviceId: '', addOnId: '', quantity: 1 }] }));
  const removeItem = (idx) => setFormData((prev) => ({ ...prev, items: prev.items.filter((_, i) => i !== idx) }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...formData,
        price: Number(formData.price),
        gstPercentage: formData.gstPercentage === '' ? null : Number(formData.gstPercentage),
        sortOrder: Number(formData.sortOrder) || 0,
        imageUrl: formData.imageUrl || null,
        validFrom: formData.validFrom || null,
        validTo: formData.validTo || null,
        items: formData.items.map((i) => ({ serviceId: i.serviceId, addOnId: i.addOnId || null, quantity: Number(i.quantity) || 1 }))
      };
      if (editing) {
        await api.put(`/admin/service-packages/${editing._id}`, payload);
        toast.success('Package updated');
      } else {
        await api.post('/admin/service-packages', payload);
        toast.success('Package created');
      }
      setIsModalOpen(false);
      fetchPackages();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Error saving package');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (pkg) => {
    try {
      await api.patch(`/admin/service-packages/${pkg._id}/toggle`, { active: !pkg.active });
      fetchPackages();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to update package');
    }
  };

  const handleDelete = async (pkg) => {
    if (!window.confirm(`Delete "${pkg.title}"? Bookings already made from it keep their price and items.`)) return;
    try {
      await api.delete(`/admin/service-packages/${pkg._id}`);
      toast.success('Package deleted');
      fetchPackages();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to delete package');
    }
  };

  const inputClass = 'w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500';

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Service Packages</h1>
          <p className="text-gray-500">Services and add-ons sold together at one price</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
            aria-label="Filter by category">
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 transition-colors shadow-md w-fit"
          >
            <FiPlus /> Add Package
          </button>
        </div>
      </div>

      <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 flex gap-3 text-sm text-indigo-900">
        <FiInfo className="w-5 h-5 flex-shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p>Customers see packages that are active and inside their sale window, under the package's category. The price charged is the package price plus GST (the visit is included).</p>
          <p className="text-indigo-700/80">Commission is worked out on the package price, as for any booking. Editing or deleting a package never changes bookings already made.</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
        {loading ? (
          <div className="p-10 text-center text-gray-400">Loading…</div>
        ) : packages.length === 0 ? (
          <div className="p-10 text-center text-gray-400">
            <FiPackage className="w-8 h-8 mx-auto mb-2" />
            No packages yet
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Package</th>
                <th className="px-4 py-3 text-left">Category</th>
                <th className="px-4 py-3 text-left">Items</th>
                <th className="px-4 py-3 text-left">Price</th>
                <th className="px-4 py-3 text-left">On sale</th>
                <th className="px-4 py-3 text-left">Active</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {packages.map((pkg) => (
                <tr key={pkg._id} className={pkg.active ? '' : 'opacity-60'}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-800">{pkg.title}</div>
                    {pkg.description && <div className="text-xs text-gray-400 max-w-[240px] truncate">{pkg.description}</div>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{pkg.categoryId?.title || categoryTitle(idOf(pkg.categoryId)) || '-'}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {(pkg.items || []).map((i, idx) => (
                      <div key={idx} className="text-xs">{i.quantity > 1 ? `${i.quantity} × ` : ''}{i.name}</div>
                    ))}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-gray-800">{rupees(pkg.price)}</div>
                    {pkg.savings > 0 && <div className="text-xs text-green-600">saves {rupees(pkg.savings)} of {rupees(pkg.catalogValue)}</div>}
                    <div className="text-xs text-gray-400">GST {pkg.gstPercentage ?? 'default'}{pkg.gstPercentage !== null && pkg.gstPercentage !== undefined ? '%' : ''}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{formatWindow(pkg)}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleToggle(pkg)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${pkg.active ? 'bg-green-500' : 'bg-gray-300'}`}
                      aria-label={pkg.active ? 'Deactivate package' : 'Activate package'}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${pkg.active ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => openEdit(pkg)} className="p-2 text-gray-500 hover:text-indigo-600" aria-label="Edit package"><FiEdit2 /></button>
                    <button onClick={() => handleDelete(pkg)} className="p-2 text-gray-500 hover:text-red-600" aria-label="Delete package"><FiTrash2 /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-800">{editing ? 'Edit Package' : 'New Package'}</h2>
              <button onClick={() => setIsModalOpen(false)} className="p-2 text-gray-400 hover:text-gray-600" aria-label="Close"><FiX /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-bold text-gray-700">Title</label>
                  <input type="text" name="title" value={formData.title} onChange={handleChange} required className={inputClass} placeholder="e.g. AC complete care" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-bold text-gray-700">Category</label>
                  <select name="categoryId" value={formData.categoryId} onChange={handleChange} required className={inputClass}>
                    <option value="">Select…</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-bold text-gray-700">Description</label>
                <textarea name="description" value={formData.description} onChange={handleChange} className={`${inputClass} min-h-[70px]`} placeholder="Optional" />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-bold text-gray-700">Items</label>
                  <button type="button" onClick={addItem} className="text-sm text-indigo-600 font-semibold hover:underline">+ Add item</button>
                </div>
                {formData.items.map((item, idx) => {
                  const svc = serviceById.get(String(item.serviceId));
                  return (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                      <select value={item.serviceId} onChange={(e) => setItem(idx, { serviceId: e.target.value, addOnId: '' })} required
                        className={`${inputClass} col-span-12 sm:col-span-5`} aria-label="Service">
                        <option value="">Service…</option>
                        {services.map((s) => <option key={s._id} value={s._id}>{s.title} ({rupees(s.basePrice)})</option>)}
                      </select>
                      <select value={item.addOnId} onChange={(e) => setItem(idx, { addOnId: e.target.value })}
                        className={`${inputClass} col-span-7 sm:col-span-4`} aria-label="Add-on" disabled={!svc || !(svc.addOns || []).length}>
                        <option value="">The service itself</option>
                        {(svc?.addOns || []).map((a) => <option key={a._id} value={a._id}>Add-on: {a.name} ({rupees(a.price)})</option>)}
                      </select>
                      <input type="number" min="1" value={item.quantity} onChange={(e) => setItem(idx, { quantity: e.target.value })}
                        className={`${inputClass} col-span-3 sm:col-span-2`} aria-label="Quantity" />
                      <button type="button" onClick={() => removeItem(idx)} disabled={formData.items.length === 1}
                        className="col-span-2 sm:col-span-1 p-2 text-gray-400 hover:text-red-600 disabled:opacity-30" aria-label="Remove item"><FiTrash2 /></button>
                    </div>
                  );
                })}
                <p className="text-xs text-gray-400">Bought separately: {rupees(catalogValue)}. The first item's service is the booking's main service.</p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-bold text-gray-700">Package Price (₹)</label>
                  <input type="number" name="price" value={formData.price} onChange={handleChange} required min="0" step="0.01" className={inputClass} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-bold text-gray-700">GST (%)</label>
                  <input type="number" name="gstPercentage" value={formData.gstPercentage} onChange={handleChange} min="0" max="100" step="0.01" placeholder="Default" className={inputClass} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-bold text-gray-700">Sort Order</label>
                  <input type="number" name="sortOrder" value={formData.sortOrder} onChange={handleChange} className={inputClass} />
                </div>
              </div>
              {Number(formData.price) > 0 && catalogValue > Number(formData.price) && (
                <p className="text-xs text-green-600">Customers save {rupees(catalogValue - Number(formData.price))}.</p>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-bold text-gray-700">On Sale From</label>
                  <input type="date" name="validFrom" value={formData.validFrom} onChange={handleChange} className={inputClass} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-bold text-gray-700">On Sale Until</label>
                  <input type="date" name="validTo" value={formData.validTo} onChange={handleChange} className={inputClass} />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-bold text-gray-700">Image URL</label>
                <input type="url" name="imageUrl" value={formData.imageUrl} onChange={handleChange} placeholder="Optional" className={inputClass} />
              </div>

              <label className="flex items-center gap-3 text-sm font-bold text-gray-700">
                <input type="checkbox" name="active" checked={formData.active} onChange={handleChange} className="w-5 h-5 text-indigo-600 rounded" />
                Active
              </label>

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button type="submit" disabled={saving}
                  className="px-5 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 disabled:opacity-60">
                  {saving ? 'Saving…' : 'Save Package'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ServicePackages;

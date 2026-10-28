import React, { useState, useEffect } from 'react';
import { FiPlus, FiEdit2, FiTrash2, FiSave, FiX } from 'react-icons/fi';
import { toast } from 'react-hot-toast';
import Modal from './Modal'; // Assuming Modal is in same directory
import { serviceService } from '@sp/services/catalogService';
import { z } from 'zod';

const serviceSchema = z.object({
  title: z.string().min(2, "Title is required"),
  basePrice: z.number().min(0, "Price must be non-negative"),
  gstPercentage: z.number().min(0).max(100).default(18),
  discountPrice: z.number().optional()
});

const BrandServicesModal = ({ isOpen, onClose, brand }) => {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({
    title: '',
    basePrice: '',
    gstPercentage: 18,
    discountPrice: ''
  });

  useEffect(() => {
    if (isOpen && brand) {
      loadServices();
    } else {
      setServices([]);
      resetForm();
    }
  }, [isOpen, brand]);

  const loadServices = async () => {
    try {
      setLoading(true);
      const response = await serviceService.getAll({ brandId: brand.id });
      if (response.success) {
        setServices(response.services || []);
      }
    } catch (error) {
      console.error('Failed to load services:', error);
      toast.error('Failed to load services');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setEditingId(null);
    setForm({
      title: '',
      basePrice: '',
      gstPercentage: 18,
      discountPrice: ''
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Parse numbers
    const data = {
      title: form.title,
      basePrice: Number(form.basePrice),
      gstPercentage: Number(form.gstPercentage),
      discountPrice: form.discountPrice ? Number(form.discountPrice) : undefined
    };

    const result = serviceSchema.safeParse(data);
    if (!result.success) {
      toast.error(result.error.errors[0].message);
      return;
    }

    try {
      setLoading(true);
      if (editingId) {
        const response = await serviceService.update(editingId, {
          ...result.data,
          brandId: brand.id
        });
        if (response.success) {
          toast.success('Service updated');
          loadServices();
          resetForm();
        }
      } else {
        const response = await serviceService.create({
          ...result.data,
          brandId: brand.id
        });
        if (response.success) {
          toast.success('Service created');
          loadServices();
          resetForm();
        }
      }
    } catch (error) {
      console.error('Save service error:', error);
      toast.error(error.response?.data?.message || 'Failed to save service');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure?')) return;
    try {
      await serviceService.delete(id);
      toast.success('Service deleted');
      loadServices();
    } catch (error) {
      toast.error('Failed to delete service');
    }
  };

  const handleEdit = (service) => {
    setEditingId(service.id || service._id);
    setForm({
      title: service.title,
      basePrice: service.basePrice,
      gstPercentage: service.gstPercentage || 18,
      discountPrice: service.discountPrice || ''
    });
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Manage Services for ${brand?.title}`} size="xl">
      <div className="space-y-6">
        {/* Form */}
        <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
          <h3 className="text-sm font-bold text-gray-700 mb-3 uppercase tracking-wide">
            {editingId ? 'Edit Service' : 'Add New Service'}
          </h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-gray-600 mb-1">Service Title</label>
              <input
                value={form.title}
                onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                placeholder="e.g. AC Filter Cleaning"
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Base Price (₹)</label>
              <input
                type="number"
                value={form.basePrice}
                onChange={e => setForm(p => ({ ...p, basePrice: e.target.value }))}
                placeholder="0"
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">GST %</label>
              <input
                type="number"
                value={form.gstPercentage}
                onChange={e => setForm(p => ({ ...p, gstPercentage: e.target.value }))}
                placeholder="18"
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
            <div className="sm:col-start-4">
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2 bg-primary-600 text-white rounded-lg text-sm font-semibold hover:bg-primary-700 disabled:opacity-50"
              >
                {editingId ? 'Update' : 'Add'}
              </button>
            </div>
            {editingId && (
              <div className="sm:col-start-4">
                <button
                  type="button"
                  onClick={resetForm}
                  className="w-full py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-50"
                >
                  Cancel Edit
                </button>
              </div>
            )}
          </form>
        </div>

        {/* List */}
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Title</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Price</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">GST</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {services.map(service => (
                <tr key={service.id || service._id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{service.title}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">₹{service.basePrice}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{service.gstPercentage}%</td>
                  <td className="px-4 py-3 text-right flex justify-end gap-2">
                    <button
                      onClick={() => handleEdit(service)}
                      className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"
                      title="Edit"
                    >
                      <FiEdit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(service.id || service._id)}
                      className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                      title="Delete"
                    >
                      <FiTrash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {services.length === 0 && (
                <tr>
                  <td colSpan="4" className="px-4 py-8 text-center text-sm text-gray-500">
                    No services found for this brand. Add one above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
};

export default BrandServicesModal;


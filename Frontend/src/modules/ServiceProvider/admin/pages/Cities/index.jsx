import React, { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { cityService } from '../../services/cityService';
import { HiPlus, HiPencil, HiTrash, HiCheck, HiX } from 'react-icons/hi';


const CityManagement = () => {
  const [cities, setCities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCity, setEditingCity] = useState(null);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    state: '',
    country: 'India',
    isActive: true,
    isDefault: false
  });

  const fetchCities = async () => {
    try {
      setLoading(true);
      const response = await cityService.getAll();
      if (response.success) {
        setCities(response.cities);
      }
    } catch (error) {
      toast.error('Failed to load cities');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCities();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (/\d/.test(formData.name)) {
      return toast.error('City name cannot contain digits');
    }
    if (formData.state && /\d/.test(formData.state)) {
      return toast.error('State cannot contain digits');
    }
    if (formData.country && /\d/.test(formData.country)) {
      return toast.error('Country cannot contain digits');
    }
    try {
      if (editingCity) {
        await cityService.update(editingCity._id, formData);
        toast.success('City updated successfully');
      } else {
        await cityService.create(formData);
        toast.success('City created successfully');
      }
      setIsModalOpen(false);
      setEditingCity(null);
      resetForm();
      fetchCities();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Operation failed');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this city?')) return;
    try {
      await cityService.delete(id);
      toast.success('City deleted successfully');
      fetchCities();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Delete failed');
    }
  };

  const handleToggleStatus = async (id) => {
    try {
      await cityService.toggleStatus(id);
      toast.success('Status updated');
      fetchCities();
    } catch (error) {
      toast.error('Status update failed');
    }
  };

  const openEditModal = (city) => {
    setEditingCity(city);
    setFormData({
      name: city.name,
      state: city.state,
      country: city.country,
      isActive: city.isActive,
      isDefault: city.isDefault
    });
    setIsModalOpen(true);
  };

  const openCreateModal = () => {
    setEditingCity(null);
    resetForm();
    setIsModalOpen(true);
  };

  const resetForm = () => {
    setFormData({
      name: '',
      state: '',
      country: 'India',
      isActive: true,
      isDefault: false
    });
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-800">City Management</h1>
        <button
          onClick={openCreateModal}
          className="flex items-center gap-2 bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 transition-colors"
        >
          <HiPlus /> Add City
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="p-4 font-semibold text-gray-600">Name</th>
              <th className="p-4 font-semibold text-gray-600">State</th>
              <th className="p-4 font-semibold text-gray-600">Slug</th>
              <th className="p-4 font-semibold text-gray-600">Status</th>
              <th className="p-4 font-semibold text-gray-600">Default</th>
              <th className="p-4 font-semibold text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {cities.map((city) => (
              <tr key={city._id} className="hover:bg-gray-50/50">
                <td className="p-4 font-medium text-gray-900">{city.name}</td>
                <td className="p-4 text-gray-600">{city.state}</td>
                <td className="p-4 text-gray-500 text-sm">{city.slug}</td>
                <td className="p-4">
                  <button
                    onClick={() => handleToggleStatus(city._id)}
                    className={`px-3 py-1 rounded-full text-xs font-medium ${city.isActive
                      ? 'bg-green-100 text-green-700'
                      : 'bg-red-100 text-red-700'
                      }`}
                  >
                    {city.isActive ? 'Active' : 'Inactive'}
                  </button>
                </td>
                <td className="p-4">
                  {city.isDefault ? (
                    <span className="flex items-center gap-1 text-teal-600 text-sm font-medium">
                      <HiCheck /> Default
                    </span>
                  ) : (
                    <span className="text-gray-400 text-sm">-</span>
                  )}
                </td>
                <td className="p-4">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openEditModal(city)}
                      className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    >
                      <HiPencil className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => handleDelete(city._id)}
                      className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <HiTrash className="w-5 h-5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {cities.length === 0 && !loading && (
              <tr>
                <td colSpan="6" className="p-8 text-center text-gray-400">
                  No cities found. Add your first city!
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Edit/Create Modal - Inline Implementation for simplicity if common modal not found easily */}
      {/* Assuming we might want a simple overlay here if we don't use the common Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h2 className="font-bold text-lg">{editingCity ? 'Edit City' : 'Add City'}</h2>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-gray-500 hover:bg-gray-200 rounded-full p-1"
              >
                <HiX className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">City Name</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value.replace(/\d/g, '') })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                  placeholder="e.g. Mumbai"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
                <input
                  type="text"
                  value={formData.state}
                  onChange={(e) => setFormData({ ...formData, state: e.target.value.replace(/\d/g, '') })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                  placeholder="e.g. Maharashtra"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
                <input
                  type="text"
                  value={formData.country}
                  onChange={(e) => setFormData({ ...formData, country: e.target.value.replace(/\d/g, '') })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div className="flex items-center gap-4 pt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.isActive}
                    onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                    className="w-4 h-4 text-teal-600 rounded focus:ring-teal-500"
                  />
                  <span className="text-sm text-gray-700">Active</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.isDefault}
                    onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
                    className="w-4 h-4 text-teal-600 rounded focus:ring-teal-500"
                    disabled={editingCity?.isDefault} // Cannot unset default directly, must set another
                  />
                  <span className="text-sm text-gray-700">Default City</span>
                </label>
              </div>

              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors font-medium"
                >
                  {editingCity ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default CityManagement;


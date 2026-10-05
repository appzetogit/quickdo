import React, { useState, useEffect } from "react";
import { FiPlus, FiEdit2, FiTrash2, FiSave, FiX, FiSearch } from "react-icons/fi";
import { toast } from "react-hot-toast";
import CardShell from "../components/CardShell";
import Modal from "../components/Modal";
import { vendorCatalogService, categoryService } from "@sp/services/catalogService";
import { z } from "zod";

const schema = z.object({
  name: z.string().min(2, "Name is required"),
  basePrice: z.number().min(0, "Price must be non-negative"),
  description: z.string().optional(),
  categoryId: z.string().min(1, "Category is required")
});

const VendorServicesPage = () => {
  const [services, setServices] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: "", basePrice: "", description: "", categoryId: "" });

  useEffect(() => {
    loadServices();
    loadCategories();
  }, []);

  const loadCategories = async () => {
    try {
      const response = await categoryService.getAll();
      if (response.success) {
        setCategories(response.categories || []);
      }
    } catch (error) {
      console.error("Failed to load categories:", error);
    }
  };

  const loadServices = async () => {
    try {
      setFetching(true);
      const response = await vendorCatalogService.getAllServices();
      if (response.success) {
        setServices(response.services || []);
      }
    } catch (error) {
      console.error("Failed to load vendor services:", error);
      toast.error("Failed to load services");
    } finally {
      setFetching(false);
    }
  };

  const handleSave = async () => {
    const data = {
      name: form.name,
      basePrice: Number(form.basePrice),
      description: form.description,
      categoryId: form.categoryId
    };

    const result = schema.safeParse(data);
    if (!result.success) {
      const errorList = result.error.errors || result.error.issues || [];
      if (errorList.length > 0) {
        toast.error(errorList[0].message);
      } else {
        toast.error("Validation failed");
      }
      return;
    }

    try {
      setLoading(true);
      if (editingId) {
        const response = await vendorCatalogService.updateService(editingId, result.data);
        if (response.success) {
          toast.success("Service updated");
          loadServices();
          reset();
        }
      } else {
        const response = await vendorCatalogService.createService(result.data);
        if (response.success) {
          toast.success("Service created");
          loadServices();
          reset();
        }
      }
    } catch (error) {
      console.error("Save error:", error);
      toast.error(error.response?.data?.message || "Failed to save service");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this service?")) return;
    try {
      setLoading(true);
      const response = await vendorCatalogService.deleteService(id);
      if (response.success) {
        toast.success("Service deleted");
        loadServices();
      }
    } catch (error) {
      toast.error("Failed to delete service");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setEditingId(null);
    setForm({ name: "", basePrice: "", description: "", categoryId: "" });
    setIsModalOpen(false);
  };

  const openEdit = (svc) => {
    setEditingId(svc._id || svc.id);
    setForm({
      name: svc.name,
      basePrice: svc.basePrice || svc.price,
      description: svc.description || "",
      categoryId: svc.categoryId?._id || svc.categoryId || ""
    });
    setIsModalOpen(true);
  };

  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState("All");

  const filteredServices = services.filter(s => {
    const matchesSearch = s.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategoryFilter === "All" ||
      (s.categoryId?._id === selectedCategoryFilter) ||
      (s.categoryId === selectedCategoryFilter) ||
      (s.categoryId?.id === selectedCategoryFilter); // Handle populated or raw ID
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="space-y-6">
      <CardShell title="Vendor Services Catalog" icon={FiPlus}>
        <div className="flex flex-col sm:flex-row gap-4 justify-between items-center mb-6">
          <div className="flex gap-4 w-full sm:w-auto flex-1">
            <div className="relative w-full sm:w-64">
              <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search services..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border rounded-xl focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div className="w-full sm:w-48">
              <select
                value={selectedCategoryFilter}
                onChange={(e) => setSelectedCategoryFilter(e.target.value)}
                className="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-primary-500 bg-white"
              >
                <option value="All">All Categories</option>
                {categories.map(cat => (
                  <option key={cat.id || cat._id} value={cat.id || cat._id}>{cat.title}</option>
                ))}
              </select>
            </div>
          </div>
          <button
            onClick={() => { reset(); setIsModalOpen(true); }}
            className="px-4 py-2 bg-primary-600 text-white rounded-xl font-semibold hover:bg-primary-700 flex items-center gap-2 shrink-0"
          >
            <FiPlus /> Add Service
          </button>
        </div>

        {fetching ? (
          <div className="text-center py-8">Loading...</div>
        ) : filteredServices.length === 0 ? (
          <div className="text-center py-8 text-gray-500">No services found.</div>
        ) : (
          <div className="overflow-x-auto border rounded-xl">
            <table className="w-full">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="p-3 text-xs font-bold text-gray-500 uppercase">Category</th>
                  <th className="p-3 text-xs font-bold text-gray-500 uppercase">Name</th>
                  <th className="p-3 text-xs font-bold text-gray-500 uppercase">Price (₹)</th>
                  <th className="p-3 text-xs font-bold text-gray-500 uppercase">Description</th>
                  <th className="p-3 text-right text-xs font-bold text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredServices.map((s) => (
                  <tr key={s._id || s.id} className="hover:bg-gray-50">
                    <td className="p-3">
                      <span className="px-2 py-1 bg-gray-100 rounded text-xs font-medium">
                        {s.categoryId?.title || "N/A"}
                      </span>
                    </td>
                    <td className="p-3 font-medium">{s.name}</td>
                    <td className="p-3">₹{s.basePrice || s.price}</td>
                    <td className="p-3 text-sm text-gray-600 truncate max-w-xs">{s.description || "—"}</td>
                    <td className="p-3 text-right flex justify-end gap-2">
                      <button onClick={() => openEdit(s)} className="p-2 text-blue-600 hover:bg-blue-50 rounded">
                        <FiEdit2 />
                      </button>
                      <button onClick={() => handleDelete(s._id || s.id)} className="p-2 text-red-600 hover:bg-red-50 rounded">
                        <FiTrash2 />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardShell>

      <Modal isOpen={isModalOpen} onClose={reset} title={editingId ? "Edit Vendor Service" : "Add Vendor Service"}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-bold mb-1">Category</label>
            <select
              value={form.categoryId}
              onChange={(e) => setForm(p => ({ ...p, categoryId: e.target.value }))}
              className="w-full px-4 py-2 border rounded-xl"
            >
              <option value="">Select Category</option>
              {categories.map(cat => (
                <option key={cat.id || cat._id} value={cat.id || cat._id}>
                  {cat.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-bold mb-1">Service Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))}
              className="w-full px-4 py-2 border rounded-xl"
              placeholder="e.g. AC Service"
            />
          </div>
          <div>
            <label className="block text-sm font-bold mb-1">Base Price (₹)</label>
            <input
              type="number"
              value={form.basePrice}
              onChange={(e) => setForm(p => ({ ...p, basePrice: e.target.value }))}
              className="w-full px-4 py-2 border rounded-xl"
              placeholder="0"
            />
          </div>
          <div>
            <label className="block text-sm font-bold mb-1">Description (Optional)</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm(p => ({ ...p, description: e.target.value }))}
              className="w-full px-4 py-2 border rounded-xl"
              rows={3}
            />
          </div>
          <button
            onClick={handleSave}
            disabled={loading}
            className="w-full py-3 bg-primary-600 text-white rounded-xl font-bold hover:bg-primary-700 disabled:opacity-50"
          >
            {loading ? "Saving..." : "Save Service"}
          </button>
        </div>
      </Modal>
    </div>
  );
};

export default VendorServicesPage;


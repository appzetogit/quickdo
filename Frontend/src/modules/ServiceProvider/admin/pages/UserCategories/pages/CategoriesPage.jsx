import React, { useEffect, useMemo, useState } from "react";
import { FiGrid, FiPlus, FiEdit2, FiTrash2, FiSave, FiChevronUp, FiChevronDown, FiMove, FiX } from "react-icons/fi";
import { toast } from "react-hot-toast";
import CardShell from "../components/CardShell";
import Modal from "../components/Modal";
import ModeSelector from "../components/ModeSelector";
import { ensureIds, saveCatalog, slugify, toAssetUrl } from "../utils";

import { categoryService, serviceService } from "@sp/services/catalogService";
import { z } from "zod";

// Define Zod schema
const categorySchema = z.object({
  title: z.string().min(2, "Category title must be at least 2 characters"),
  slug: z.string().optional(),
  homeIconUrl: z.string().optional(),
  homeBadge: z.string().optional(),
  hasSaleBadge: z.boolean(),
  showOnHome: z.boolean(),
});

const CategoriesPage = ({ catalog, setCatalog, selectedCity }) => {
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);

  const [form, setForm] = useState({
    title: "",
    slug: "",
    homeIconUrl: "",
    homeBadge: "",
    hasSaleBadge: false,
    showOnHome: true,
  });
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [showReorderModal, setShowReorderModal] = useState(false);
  const [draggedItem, setDraggedItem] = useState(null);

  const categories = (catalog.categories || []).sort((a, b) => (a.homeOrder || 0) - (b.homeOrder || 0));
  const editing = useMemo(() => categories.find((c) => c.id === editingId) || null, [categories, editingId]);

  // Fetch categories from API on mount or city change
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        setFetching(true);
        // Pass city filters
        const params = { status: 'active' };
        if (selectedCity) {
          params.cityId = selectedCity;
        }

        const response = await categoryService.getAll(params);

        if (response.success && response.categories) {
          // Map backend format to frontend format
          const mappedCategories = response.categories.map(cat => ({
            id: cat.id, // Backend returns id (not _id)
            title: cat.title,
            slug: cat.slug,
            homeIconUrl: cat.homeIconUrl || "",
            homeBadge: cat.homeBadge || "",
            hasSaleBadge: cat.hasSaleBadge || false,
            showOnHome: cat.showOnHome !== false,
          }));

          // Update catalog with fetched categories
          const next = { ...catalog, categories: mappedCategories };
          setCatalog(next);
          saveCatalog(next); // Also save to localStorage for backward compatibility
        }
      } catch (error) {
        console.error('Failed to fetch categories:', error);
        toast.error('Failed to load categories. Using cached data.');
      } finally {
        setFetching(false);
      }
    };

    fetchCategories();
  }, [selectedCity]); // Re-fetch when city changes

  useEffect(() => {
    if (!editing) {
      setForm({
        title: "",
        slug: "",
        homeIconUrl: "",
        homeBadge: "",
        hasSaleBadge: false,
        showOnHome: true,
      });
      return;
    }
    const safe = ensureIds({ ...catalog, categories: [editing] }).categories[0];
    setForm({
      title: safe.title || "",
      slug: safe.slug || "",
      homeIconUrl: safe.homeIconUrl || "",
      homeBadge: safe.homeBadge || "",
      hasSaleBadge: Boolean(safe.hasSaleBadge),
      showOnHome: safe.showOnHome !== false,
    });
  }, [editing]);

  const [isModalOpen, setIsModalOpen] = useState(false);

  const reset = () => {
    setEditingId(null);
    setForm({
      title: "",
      slug: "",
      homeIconUrl: "",
      homeBadge: "",
      hasSaleBadge: false,
      showOnHome: true,
    });
    setIsModalOpen(false);
  };



  const upsert = async () => {
    // Validate form with Zod
    const validationResult = categorySchema.safeParse({
      title: form.title.trim(),
      slug: slugify(form.title.trim()), // derived
      homeIconUrl: form.homeIconUrl.trim(),
      homeBadge: form.homeBadge.trim(),
      hasSaleBadge: Boolean(form.hasSaleBadge),
      showOnHome: Boolean(form.showOnHome)
    });

    if (!validationResult.success) {
      // Show first error in toast
      const firstError = validationResult.error.errors[0];
      toast.error(firstError.message);
      return;
    }

    const { title, slug, homeIconUrl, homeBadge, hasSaleBadge, showOnHome } = validationResult.data;

    try {
      setLoading(true);

      // Determine homeOrder for new categories
      let homeOrder = 0;
      if (editingId && editingId.startsWith('ucat-')) {
        // New category - find the highest order and add 1
        const maxOrder = Math.max(...categories.map(c => c.homeOrder || 0), 0);
        homeOrder = maxOrder + 1;
      } else if (editingId) {
        // Existing category - keep current order
        const existingCategory = categories.find(c => c.id === editingId);
        homeOrder = existingCategory?.homeOrder || 0;
      } else {
        // New category (fallback)
        const maxOrder = Math.max(...categories.map(c => c.homeOrder || 0), 0);
        homeOrder = maxOrder + 1;
      }

      const categoryData = {
        title,
        slug,
        homeIconUrl: homeIconUrl || null,
        homeBadge: homeBadge || null,
        hasSaleBadge,
        showOnHome,
        homeOrder,
        cityIds: selectedCity ? [selectedCity] : [],
      };

      if (editingId && !editingId.startsWith('ucat-')) {
        const existingCat = categories.find(c => c.id === editingId);
        if (selectedCity) {
          categoryData.cityIds = [selectedCity];
        } else {
          // If in global mode, preserve existing cityIds so it doesn't accidentally become Global
          categoryData.cityIds = existingCat ? existingCat.cityIds : [];
        }
      }

      let savedCategory;
      if (editingId && editingId.startsWith('ucat-')) {
        // This is a local ID, create new in backend
        const response = await categoryService.create(categoryData);
        if (response.success) {
          savedCategory = {
            id: response.category.id,
            title: response.category.title,
            slug: response.category.slug,
            homeIconUrl: response.category.homeIconUrl || "",
            homeBadge: response.category.homeBadge || "",
            hasSaleBadge: response.category.hasSaleBadge || false,
            showOnHome: response.category.showOnHome !== false,
            homeOrder: response.category.homeOrder || 0,
          };
        } else {
          throw new Error(response.message || 'Failed to create category');
        }
      } else if (editingId) {
        // Update existing category in backend
        const response = await categoryService.update(editingId, categoryData);
        if (response.success) {
          savedCategory = {
            id: response.category.id,
            title: response.category.title,
            slug: response.category.slug,
            homeIconUrl: response.category.homeIconUrl || "",
            homeBadge: response.category.homeBadge || "",
            hasSaleBadge: response.category.hasSaleBadge || false,
            showOnHome: response.category.showOnHome !== false,
            homeOrder: response.category.homeOrder || 0,
          };
        } else {
          throw new Error(response.message || 'Failed to update category');
        }
      } else {
        // Create new category
        const response = await categoryService.create(categoryData);
        if (response.success) {
          savedCategory = {
            id: response.category.id,
            title: response.category.title,
            slug: response.category.slug,
            homeIconUrl: response.category.homeIconUrl || "",
            homeBadge: response.category.homeBadge || "",
            hasSaleBadge: response.category.hasSaleBadge || false,
            showOnHome: response.category.showOnHome !== false,
            homeOrder: response.category.homeOrder || 0,
          };
        } else {
          throw new Error(response.message || 'Failed to create category');
        }
      }

      // Update local state
      const next = ensureIds(catalog);
      const exists = next.categories.find((c) => c.id === editingId || c.id === savedCategory.id);

      if (exists && editingId) {
        // Update existing
        next.categories = next.categories.map((c) =>
          (c.id === editingId || c.id === savedCategory.id) ? savedCategory : c
        );
      } else {
        // Add new
        next.categories = [...next.categories, savedCategory];
      }



      setCatalog(next);
      saveCatalog(next);
      toast.success(editingId ? "Category updated successfully" : "Category created successfully");
      reset();
    } catch (error) {
      console.error('Upsert category error:', error);
      toast.error(error.message || 'Failed to save category. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this category?")) return;

    // If it's a local ID (starts with ucat-), just remove from local state
    if (id.startsWith('ucat-')) {
      const next = { ...catalog, categories: categories.filter((c) => c.id !== id) };
      setCatalog(next);
      saveCatalog(next);
      if (editingId === id) reset();
      return;
    }

    try {
      setLoading(true);
      const response = await categoryService.delete(id);

      if (response.success) {
        // Remove from local state
        const next = { ...catalog, categories: categories.filter((c) => c.id !== id) };
        setCatalog(next);
        saveCatalog(next);
        if (editingId === id) reset();
        toast.success("Category deleted successfully");
      } else {
        throw new Error(response.message || 'Failed to delete category');
      }
    } catch (error) {
      console.error('Delete category error:', error);
      toast.error(error.message || 'Failed to delete category. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const moveCategoryUp = async (categoryId, currentIndex) => {
    if (currentIndex === 0) return; // Already at top

    try {
      setLoading(true);
      const category = categories[currentIndex];
      const previousCategory = categories[currentIndex - 1];

      // Swap orders
      await categoryService.updateOrder(category.id, currentIndex - 1);
      await categoryService.updateOrder(previousCategory.id, currentIndex);

      // Update local state
      const updatedCategories = [...categories];
      [updatedCategories[currentIndex], updatedCategories[currentIndex - 1]] =
        [updatedCategories[currentIndex - 1], updatedCategories[currentIndex]];

      setCatalog(prev => ({ ...prev, categories: updatedCategories }));
      saveCatalog({ ...catalog, categories: updatedCategories });

      toast.success("Category moved up successfully");
    } catch (error) {
      console.error('Move category up error:', error);
      toast.error('Failed to reorder category');
    } finally {
      setLoading(false);
    }
  };

  const moveCategoryDown = async (categoryId, currentIndex) => {
    if (currentIndex === categories.length - 1) return; // Already at bottom

    try {
      setLoading(true);
      const category = categories[currentIndex];
      const nextCategory = categories[currentIndex + 1];

      // Swap orders
      await categoryService.updateOrder(category.id, currentIndex + 1);
      await categoryService.updateOrder(nextCategory.id, currentIndex);

      // Update local state
      const updatedCategories = [...categories];
      [updatedCategories[currentIndex], updatedCategories[currentIndex + 1]] =
        [updatedCategories[currentIndex + 1], updatedCategories[currentIndex]];

      setCatalog(prev => ({ ...prev, categories: updatedCategories }));
      saveCatalog({ ...catalog, categories: updatedCategories });

      toast.success("Category moved down successfully");
    } catch (error) {
      console.error('Move category down error:', error);
      toast.error('Failed to reorder category');
    } finally {
      setLoading(false);
    }
  };

  // Drag and drop functions for bulk reordering
  const handleDragStart = (e, index) => {
    setDraggedItem(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e, dropIndex) => {
    e.preventDefault();
    const draggedIndex = draggedItem;

    if (draggedIndex === null || draggedIndex === dropIndex) {
      setDraggedItem(null);
      return;
    }

    const newCategories = [...categories];
    const [draggedCategory] = newCategories.splice(draggedIndex, 1);
    newCategories.splice(dropIndex, 0, draggedCategory);

    // Update orders for all categories
    const bulkUpdates = newCategories.map((cat, index) =>
      categoryService.updateOrder(cat.id, index)
    );

    Promise.all(bulkUpdates)
      .then(() => {
        setCatalog(prev => ({ ...prev, categories: newCategories }));
        saveCatalog({ ...catalog, categories: newCategories });
        toast.success("Categories reordered successfully");
      })
      .catch((error) => {
        console.error('Bulk reorder error:', error);
        toast.error('Failed to reorder categories');
      })
      .finally(() => {
        setDraggedItem(null);
      });
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
  };

  return (
    <div className="space-y-6">
      {/* App Mode selector removed as per request */}

      <CardShell icon={FiGrid}>
        {fetching && (
          <div className="text-center py-4 text-gray-500">Loading categories...</div>
        )}
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm text-gray-600">{categories.length} categories</div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowReorderModal(true)}
              disabled={categories.length < 2}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg font-semibold transition-all flex items-center gap-2 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FiMove className="w-4 h-4" />
              <span>Reorder</span>
            </button>
            <button
              onClick={() => {
                reset();
                setIsModalOpen(true);
              }}
              className="px-4 py-2 text-white rounded-lg font-semibold transition-all flex items-center gap-2 shadow-md hover:shadow-lg relative z-10"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                backgroundColor: '#2874F0',
                border: 'none',
                cursor: 'pointer'
              }}
              onMouseEnter={(e) => e.target.style.backgroundColor = '#1e5fd4'}
              onMouseLeave={(e) => e.target.style.backgroundColor = '#2874F0'}
            >
              <FiPlus className="w-4 h-4" style={{ display: 'block', color: '#ffffff' }} />
              <span>Add Category</span>
            </button>
          </div>
        </div>
        {categories.length === 0 ? (
          <div className="text-center py-8 text-gray-500">No categories yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b-2 border-gray-200">
                  <th className="text-left py-3 px-4 text-sm font-bold text-gray-700 w-12">#</th>
                  <th className="text-left py-3 px-4 text-sm font-bold text-gray-700 w-20">Icon</th>
                  <th className="text-left py-3 px-4 text-sm font-bold text-gray-700">Name</th>
                  <th className="text-left py-3 px-4 text-sm font-bold text-gray-700">Slug</th>
                  <th className="text-left py-3 px-4 text-sm font-bold text-gray-700">Badge</th>
                  <th className="text-center py-3 px-4 text-sm font-bold text-gray-700 w-20">
                    Order
                    <button
                      onClick={() => setShowReorderModal(true)}
                      className="ml-2 text-purple-600 hover:text-purple-800 text-xs"
                      title="Bulk reorder"
                    >
                      <FiMove className="w-3 h-3 inline" />
                    </button>
                  </th>
                  <th className="text-center py-3 px-4 text-sm font-bold text-gray-700 w-32">Status</th>
                  <th className="text-center py-3 px-4 text-sm font-bold text-gray-700 w-32">Actions</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((c, idx) => (
                  <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-4 px-4 text-sm font-semibold text-gray-600">{idx + 1}</td>
                    <td className="py-4 px-4">
                      {c.homeIconUrl ? (
                        <img src={toAssetUrl(c.homeIconUrl)} alt={c.title} className="h-10 w-10 object-contain rounded bg-gray-50 border border-gray-100" />
                      ) : (
                        <div className="h-12 w-12 bg-gray-100 rounded-lg border border-gray-200 flex items-center justify-center">
                          <span className="text-xs text-gray-400">No icon</span>
                        </div>
                      )}
                    </td>
                    <td className="py-4 px-4">
                      <div className="font-bold text-gray-900">{c.title || "Untitled"}</div>
                    </td>
                    <td className="py-4 px-4">
                      <div className="text-sm text-gray-600">{c.slug || "—"}</div>
                    </td>
                    <td className="py-4 px-4">
                      {c.homeBadge ? (
                        <span className="inline-block px-2 py-1 text-xs font-semibold bg-blue-100 text-blue-700 rounded">{c.homeBadge}</span>
                      ) : (
                        <span className="text-sm text-gray-400">—</span>
                      )}
                    </td>
                    <td className="py-4 px-4 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => moveCategoryUp(c.id, idx)}
                          disabled={idx === 0 || loading}
                          className="p-1 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          title="Move Up"
                        >
                          <FiChevronUp className="w-4 h-4" />
                        </button>
                        <span className="text-xs font-semibold text-gray-600 mx-1">{idx + 1}</span>
                        <button
                          onClick={() => moveCategoryDown(c.id, idx)}
                          disabled={idx === categories.length - 1 || loading}
                          className="p-1 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          title="Move Down"
                        >
                          <FiChevronDown className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                    <td className="py-4 px-4 text-center">
                      <span className={`inline-block px-3 py-1 text-xs font-bold rounded ${c.showOnHome !== false ? "bg-green-500 text-white" : "bg-gray-300 text-gray-700"}`}>
                        {c.showOnHome !== false ? "VISIBLE" : "HIDDEN"}
                      </span>
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => {
                            setEditingId(c.id);
                            setIsModalOpen(true);
                          }}
                          className="p-2 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                          title="Edit"
                        >
                          <FiEdit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => remove(c.id)}
                          className="p-2 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                          title="Delete"
                        >
                          <FiTrash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardShell>

      <Modal
        isOpen={isModalOpen}
        onClose={reset}
        title={editing ? "Edit Category" : "Add Category"}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-base font-bold text-gray-900 mb-2">Title</label>
            <input
              value={form.title}
              onChange={(e) => {
                const title = e.target.value;
                setForm((p) => ({ ...p, title, slug: slugify(title) }));
              }}
              placeholder="e.g. Electricity, Salon for Women"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-base font-bold text-gray-900 mb-2">Home Icon</label>
            <div className="space-y-3">
              <input
                type="file"
                accept="image/*"
                disabled={uploadingIcon}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setUploadingIcon(true);
                    try {
                      const categorySlug = form.slug || form.title?.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
                      const folder = `Truliq/${categorySlug}/icons`;
                      const response = await serviceService.uploadImage(file, folder);
                      if (response.success && response.imageUrl) {
                        setForm((p) => ({ ...p, homeIconUrl: response.imageUrl }));
                        toast.success("Icon uploaded successfully");
                      } else {
                        toast.error("Upload failed");
                      }
                    } catch (error) {
                      console.error('Category icon upload error:', error);
                      toast.error("Failed to upload image");
                    } finally {
                      setUploadingIcon(false);
                    }
                  }
                }}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all bg-white file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100 disabled:opacity-50 disabled:cursor-not-allowed"
              />
              {uploadingIcon && (
                <div className="flex items-center gap-2 text-blue-600">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                  <span className="text-sm font-medium">Uploading...</span>
                </div>
              )}
              {form.homeIconUrl && !uploadingIcon && (
                <img src={toAssetUrl(form.homeIconUrl)} alt="Icon Preview" className="h-16 w-16 object-cover rounded-lg border border-gray-200" />
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-1 gap-3">
            {/* Home Badge (optional) input removed as requested */}
            <div className="flex items-center gap-3 pt-4">
              <input
                id="hasSaleBadge"
                type="checkbox"
                checked={form.hasSaleBadge}
                onChange={(e) => setForm((p) => ({ ...p, hasSaleBadge: e.target.checked }))}
                className="h-4 w-4"
              />
              <label htmlFor="hasSaleBadge" className="text-base font-semibold text-gray-800">
                Show sale badge on home card
              </label>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <input
              id="showOnHome"
              type="checkbox"
              checked={form.showOnHome}
              onChange={(e) => setForm((p) => ({ ...p, showOnHome: e.target.checked }))}
              className="h-4 w-4"
            />
            <label htmlFor="showOnHome" className="text-base font-semibold text-gray-800">
              Show this category on home
            </label>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              onClick={upsert}
              disabled={loading}
              className="flex-1 py-3.5 bg-primary-600 text-white rounded-xl font-semibold hover:bg-primary-700 transition-all flex items-center justify-center gap-2 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FiSave className="w-5 h-5" />
              {loading ? "Saving..." : (editing ? "Update Category" : "Add Category")}
            </button>
            <button
              onClick={reset}
              className="px-6 py-3.5 text-gray-700 rounded-xl font-medium hover:bg-gray-100 transition-all border border-gray-200"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>

      {/* Reorder Categories Modal */}
      <Modal
        isOpen={showReorderModal}
        onClose={() => setShowReorderModal(false)}
        title="Reorder Categories"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Drag and drop categories to reorder them. The new order will be saved automatically.
          </p>

          <div className="max-h-96 overflow-y-auto space-y-2">
            {categories.map((category, index) => (
              <div
                key={category.id}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, index)}
                onDragEnd={handleDragEnd}
                className={`
                  flex items-center gap-3 p-3 border rounded-lg cursor-move transition-all
                  ${draggedItem === index ? 'opacity-50 bg-blue-50 border-blue-300' : 'bg-white border-gray-200 hover:border-blue-300'}
                  ${draggedItem !== null && draggedItem !== index ? 'hover:bg-gray-50' : ''}
                `}
              >
                <div className="flex items-center justify-center w-8 h-8 bg-gray-100 rounded-full text-sm font-semibold text-gray-600">
                  {index + 1}
                </div>

                {category.homeIconUrl ? (
                  <img
                    src={toAssetUrl(category.homeIconUrl)}
                    alt={category.title}
                    className="w-8 h-8 object-contain rounded"
                  />
                ) : (
                  <div className="w-8 h-8 bg-gray-200 rounded flex items-center justify-center">
                    <span className="text-xs text-gray-500">?</span>
                  </div>
                )}

                <div className="flex-1">
                  <div className="font-medium text-gray-900">{category.title}</div>
                  <div className="text-sm text-gray-500">{category.slug}</div>
                </div>

                <FiMove className="w-4 h-4 text-gray-400" />
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <button
              onClick={() => setShowReorderModal(false)}
              className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default CategoriesPage;



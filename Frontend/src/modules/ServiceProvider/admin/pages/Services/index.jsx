import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FiGrid, FiSettings, FiTag, FiPlus, FiEdit2, FiTrash2, FiSave } from 'react-icons/fi';

const Services = () => {
  const [serviceMode, setServiceMode] = useState('multi'); // 'single' or 'multi'
  const [categories, setCategories] = useState([]);
  const [editingCategory, setEditingCategory] = useState(null);
  const [newCategory, setNewCategory] = useState({ name: '', skills: [] });
  const [availableSkills, setAvailableSkills] = useState([]);

  useEffect(() => {
    // Load service configuration
    const config = JSON.parse(localStorage.getItem('adminServiceConfig') || '{}');
    setServiceMode(config.mode || 'multi');

    // Load categories
    const savedCategories = JSON.parse(localStorage.getItem('serviceCategories') || '[]');
    setCategories(savedCategories);

    // Load available skills
    const savedSkills = JSON.parse(localStorage.getItem('availableSkills') || '[]');
    setAvailableSkills(savedSkills);
  }, []);

  const handleModeChange = (mode) => {
    setServiceMode(mode);
    const config = { mode, updatedAt: new Date().toISOString() };
    localStorage.setItem('adminServiceConfig', JSON.stringify(config));

    // If switching to single, keep only first category
    if (mode === 'single' && categories.length > 1) {
      const singleCategory = [categories[0]];
      setCategories(singleCategory);
      localStorage.setItem('serviceCategories', JSON.stringify(singleCategory));
    }
  };

  const handleAddCategory = () => {
    if (!newCategory.name.trim()) {
      alert('Please enter category name');
      return;
    }

    const category = {
      id: `cat-${Date.now()}`,
      name: newCategory.name,
      skills: newCategory.skills,
      createdAt: new Date().toISOString(),
    };

    const updated = [...categories, category];
    setCategories(updated);
    localStorage.setItem('serviceCategories', JSON.stringify(updated));

    // Update vendor and worker themes if needed
    window.dispatchEvent(new Event('serviceCategoriesUpdated'));

    setNewCategory({ name: '', skills: [] });
  };

  const handleEditCategory = (category) => {
    setEditingCategory(category);
    setNewCategory({ name: category.name, skills: category.skills || [] });
  };

  const handleUpdateCategory = () => {
    if (!newCategory.name.trim()) {
      alert('Please enter category name');
      return;
    }

    const updated = categories.map(cat =>
      cat.id === editingCategory.id
        ? { ...cat, name: newCategory.name, skills: newCategory.skills, updatedAt: new Date().toISOString() }
        : cat
    );
    setCategories(updated);
    localStorage.setItem('serviceCategories', JSON.stringify(updated));
    window.dispatchEvent(new Event('serviceCategoriesUpdated'));

    setEditingCategory(null);
    setNewCategory({ name: '', skills: [] });
  };

  const handleDeleteCategory = (id) => {
    if (!window.confirm('Are you sure you want to delete this category?')) return;

    const updated = categories.filter(cat => cat.id !== id);
    setCategories(updated);
    localStorage.setItem('serviceCategories', JSON.stringify(updated));
    window.dispatchEvent(new Event('serviceCategoriesUpdated'));
  };

  const handleAddSkill = (skillName) => {
    if (!skillName.trim()) return;

    const skill = {
      id: `skill-${Date.now()}`,
      name: skillName,
      categoryId: editingCategory?.id || null,
    };

    const updated = [...availableSkills, skill];
    setAvailableSkills(updated);
    localStorage.setItem('availableSkills', JSON.stringify(updated));
  };

  const handleToggleSkill = (skillName) => {
    if (newCategory.skills.includes(skillName)) {
      setNewCategory(prev => ({
        ...prev,
        skills: prev.skills.filter(s => s !== skillName)
      }));
    } else {
      setNewCategory(prev => ({
        ...prev,
        skills: [...prev.skills, skillName]
      }));
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      {/* Service Mode Selection */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
        <div className="flex items-center gap-2 mb-3">
          <FiSettings className="w-4 h-4 text-gray-600" />
          <h2 className="text-base font-bold text-gray-800">Service Mode</h2>
        </div>
        <div className="flex gap-4">
          <button
            onClick={() => handleModeChange('single')}
            className={`flex-1 p-3 rounded-lg border-2 transition-all ${serviceMode === 'single'
              ? 'border-primary-600 bg-primary-50 text-primary-700'
              : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
              }`}
          >
            <div className="font-semibold text-sm mb-0.5">Single Service</div>
            <div className="text-xs opacity-80">One service category only</div>
          </button>
          <button
            onClick={() => handleModeChange('multi')}
            className={`flex-1 p-3 rounded-lg border-2 transition-all ${serviceMode === 'multi'
              ? 'border-primary-600 bg-primary-50 text-primary-700'
              : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
              }`}
          >
            <div className="font-semibold text-sm mb-0.5">Multi Service</div>
            <div className="text-xs opacity-80">Multiple service categories</div>
          </button>
        </div>
      </div>

      {/* Add/Edit Category Form */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
        <div className="flex items-center gap-2 mb-3">
          <FiTag className="w-4 h-4 text-gray-600" />
          <h2 className="text-base font-bold text-gray-800">
            {editingCategory ? 'Edit Category' : 'Add New Category'}
          </h2>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Category Name
            </label>
            <input
              type="text"
              value={newCategory.name}
              onChange={(e) => setNewCategory(prev => ({ ...prev, name: e.target.value }))}
              placeholder="e.g., Electrician, Plumber, Salon"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Skills
            </label>
            <div className="flex flex-wrap gap-2 mb-2">
              {availableSkills
                .filter(skill => !skill.categoryId || skill.categoryId === editingCategory?.id)
                .map(skill => (
                  <button
                    key={skill.id}
                    onClick={() => handleToggleSkill(skill.name)}
                    className={`px-2 py-1 rounded-lg text-xs font-medium transition-all ${newCategory.skills.includes(skill.name)
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                  >
                    {skill.name}
                  </button>
                ))}
            </div>
            <input
              type="text"
              placeholder="Add new skill and press Enter"
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  handleAddSkill(e.target.value);
                  e.target.value = '';
                }
              }}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <button
            onClick={editingCategory ? handleUpdateCategory : handleAddCategory}
            className="w-full py-2 bg-primary-600 text-white rounded-lg text-sm font-semibold hover:bg-primary-700 transition-colors flex items-center justify-center gap-2"
          >
            <FiSave className="w-4 h-4" />
            {editingCategory ? 'Update Category' : 'Add Category'}
          </button>

          {editingCategory && (
            <button
              onClick={() => {
                setEditingCategory(null);
                setNewCategory({ name: '', skills: [] });
              }}
              className="w-full py-1.5 text-xs text-gray-600 rounded-lg font-medium hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Categories List */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
        <div className="flex items-center gap-2 mb-3">
          <FiGrid className="w-4 h-4 text-gray-600" />
          <h2 className="text-base font-bold text-gray-800">Categories ({categories.length})</h2>
        </div>

        {categories.length === 0 ? (
          <div className="text-center py-6 text-xs text-gray-500">
            No categories added yet. Add your first category above.
          </div>
        ) : (
          <div className="space-y-2">
            {categories.map((category) => (
              <div
                key={category.id}
                className="p-4 border border-gray-200 rounded-lg hover:border-primary-300 transition-colors"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-800">{category.name}</h3>
                    {category.skills && category.skills.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {category.skills.map((skill, idx) => (
                          <span
                            key={idx}
                            className="px-2 py-1 bg-primary-100 text-primary-700 rounded text-xs font-medium"
                          >
                            {skill}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEditCategory(category)}
                      className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    >
                      <FiEdit2 className="w-4 h-4" />
                    </button>
                    {serviceMode === 'multi' && (
                      <button
                        onClick={() => handleDeleteCategory(category.id)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <FiTrash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default Services;



import React, { useState, useEffect } from 'react';
import { FiSave, FiShield, FiFileText, FiLifeBuoy } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { getSettings, updateSettings } from '../../services/settingsService';

const getPageConfig = (type) => {
  switch(type) {
    case 'terms': return { title: 'Terms & Conditions', Icon: FiFileText, fieldKey: 'termsAndConditions' };
    case 'privacy': return { title: 'Privacy Policy', Icon: FiShield, fieldKey: 'privacyPolicy' };
    case 'support': return { title: 'Support & Help', Icon: FiLifeBuoy, fieldKey: 'supportPageContent' };
    default: return { title: 'Terms & Conditions', Icon: FiFileText, fieldKey: 'termsAndConditions' };
  }
};

const LegalSettings = ({ type }) => {
  const [content, setContent] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const { title, Icon, fieldKey } = getPageConfig(type);

  useEffect(() => {
    fetchContent();
  }, [type]);

  const fetchContent = async () => {
    setIsLoading(true);
    try {
      const res = await getSettings();
      if (res.success && res.settings) {
        setContent(res.settings[fieldKey] || '');
      } else {
        toast.error('Failed to load content');
      }
    } catch (error) {
      console.error('Error loading legal settings:', error);
      toast.error('Failed to load content');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const payload = {
        [fieldKey]: content
      };
      
      const res = await updateSettings(payload);
      if (res.success) {
        toast.success(`${title} updated successfully`);
      } else {
        toast.error(`Failed to update ${title}`);
      }
    } catch (error) {
      console.error('Error saving legal settings:', error);
      toast.error(`Failed to update ${title}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-primary-50 rounded-xl">
            <Icon className="text-xl text-primary-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">{title}</h1>
            <p className="text-sm text-slate-500">
              Manage the content for your {title.toLowerCase()} page. You can use basic HTML tags for formatting.
            </p>
          </div>
        </div>
        
        <button
          onClick={handleSave}
          disabled={isSaving || isLoading}
          className="flex items-center gap-2 px-6 py-2.5 bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition-colors disabled:opacity-50 whitespace-nowrap"
        >
          <FiSave className={isSaving ? "animate-spin" : ""} />
          <span>{isSaving ? 'Saving...' : 'Save Changes'}</span>
        </button>
      </div>

      {/* Editor Section */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-4 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
          <span className="text-sm font-semibold text-slate-700">Content Editor</span>
          <span className="text-xs text-slate-500">Just type normally (Line breaks are supported)</span>
        </div>
        
        <div className="p-6">
          {isLoading ? (
            <div className="animate-pulse space-y-4">
              <div className="h-4 bg-slate-200 rounded w-3/4"></div>
              <div className="h-4 bg-slate-200 rounded w-1/2"></div>
              <div className="h-4 bg-slate-200 rounded w-5/6"></div>
              <div className="h-32 bg-slate-200 rounded w-full"></div>
            </div>
          ) : (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={`Enter your ${title.toLowerCase()} here...`}
              className="w-full min-h-[500px] p-4 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all resize-y font-mono text-sm leading-relaxed"
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default LegalSettings;

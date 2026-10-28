import React, { useState, useEffect, useRef } from 'react';
import {
  ChevronRight,
  Save,
  Loader2,
  ArrowLeft,
  Video,
  Image as ImageIcon,
  Upload,
  X,
  Plus,
  Trash2,
  Globe,
  Link as LinkIcon,
  Mail,
  Phone,
  MapPin,
  FileText,
  Bold,
  Italic,
  Heading1,
  Heading2,
  List,
  Code
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { adminService } from '../../services/adminService';
import toast from 'react-hot-toast';

const DEFAULT_LAT = 26.7271;
const DEFAULT_LNG = 88.3953;

const RichTextEditor = ({ value, onChange }) => {
  const [isCodeView, setIsCodeView] = useState(false);
  const editorRef = useRef(null);

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value || '';
    }
  }, [value, isCodeView]);

  const executeCommand = (command, argument = null) => {
    document.execCommand(command, false, argument);
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
  };

  const handleLink = () => {
    const url = prompt('Enter link URL (e.g. https://google.com):');
    if (url) {
      executeCommand('createLink', url);
    }
  };

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
      {/* Editor Toolbar */}
      <div className="bg-gray-50 border-b border-gray-200 px-4 py-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => executeCommand('bold')}
          className="p-1.5 rounded hover:bg-gray-200 text-gray-700 transition-colors"
          title="Bold"
          disabled={isCodeView}
        >
          <Bold size={16} />
        </button>
        <button
          type="button"
          onClick={() => executeCommand('italic')}
          className="p-1.5 rounded hover:bg-gray-200 text-gray-700 transition-colors"
          title="Italic"
          disabled={isCodeView}
        >
          <Italic size={16} />
        </button>
        <button
          type="button"
          onClick={() => executeCommand('formatBlock', '<h1>')}
          className="p-1.5 rounded hover:bg-gray-200 text-gray-700 font-bold text-xs transition-colors flex items-center"
          title="Heading 1"
          disabled={isCodeView}
        >
          <Heading1 size={16} />
        </button>
        <button
          type="button"
          onClick={() => executeCommand('formatBlock', '<h2>')}
          className="p-1.5 rounded hover:bg-gray-200 text-gray-700 font-bold text-xs transition-colors flex items-center"
          title="Heading 2"
          disabled={isCodeView}
        >
          <Heading2 size={16} />
        </button>
        <button
          type="button"
          onClick={() => executeCommand('insertUnorderedList')}
          className="p-1.5 rounded hover:bg-gray-200 text-gray-700 transition-colors"
          title="Bullet List"
          disabled={isCodeView}
        >
          <List size={16} />
        </button>
        <button
          type="button"
          onClick={handleLink}
          className="p-1.5 rounded hover:bg-gray-200 text-gray-700 transition-colors"
          title="Add Link"
          disabled={isCodeView}
        >
          <LinkIcon size={16} />
        </button>
        <div className="w-px h-6 bg-gray-200 mx-1" />
        <button
          type="button"
          onClick={() => setIsCodeView(!isCodeView)}
          className={`p-1.5 rounded transition-colors flex items-center gap-1 text-xs font-bold ${isCodeView ? 'bg-indigo-50 text-indigo-600 border border-indigo-100' : 'hover:bg-gray-200 text-gray-700'}`}
          title="Toggle Code View"
        >
          <Code size={16} /> HTML Code
        </button>
      </div>

      {/* Content Area */}
      {isCodeView ? (
        <textarea
          className="w-full min-h-[300px] p-4 text-xs font-mono border-none outline-none focus:ring-0 text-slate-800 bg-slate-900 text-slate-100 resize-y"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="<h1>Write HTML here...</h1>"
        />
      ) : (
        <div
          ref={editorRef}
          contentEditable
          onInput={(e) => onChange(e.currentTarget.innerHTML)}
          className="w-full min-h-[300px] p-6 text-sm text-slate-800 bg-white outline-none focus:ring-0 overflow-y-auto prose max-w-none prose-slate prose-headings:font-black prose-p:leading-relaxed"
          style={{ minHeight: '300px' }}
        />
      )}
    </div>
  );
};

const SectionCard = ({ title, children, subtitle }) => (
  <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-8">
    {title && (
      <div className="px-8 py-5 border-b border-gray-100 bg-gray-50/30">
        <h3 className="text-[13px] font-bold text-gray-700 uppercase tracking-tight">{title}</h3>
        {subtitle && <p className="text-xs text-gray-400 mt-1 font-medium italic">{subtitle}</p>}
      </div>
    )}
    <div className="p-8">
      {children}
    </div>
  </div>
);

const InputField = ({ label, name, value, onChange, placeholder, info, type = "text" }) => (
  <div className="space-y-1">
    <label className="block text-xs font-semibold text-gray-500 mb-1.5">{label}</label>
    <input
      type={type}
      name={name}
      value={value || ''}
      onChange={(e) => onChange(name, e.target.value)}
      placeholder={placeholder}
      className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm text-gray-800 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-colors shadow-sm"
    />
    {info && <p className="text-[10px] text-gray-400 italic mt-1">{info}</p>}
  </div>
);

const LandingPageSettings = ({ defaultTab = 'general', defaultPage = 'about_us' }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const paramTab = queryParams.get('tab');

  const [activeTab, setActiveTab] = useState(paramTab || defaultTab);
  const [activePage, setActivePage] = useState(defaultPage);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Settings State
  const [settings, setSettings] = useState({
    video_url: '',
    logo_url: '',
    hero_title: '',
    hero_description: '',
    hero_image_url: '',
    why_us_image_url: '',
    social_links: {
      facebook: '',
      twitter: '',
      instagram: '',
      linkedin: '',
      youtube: ''
    },
    contact_email: '',
    contact_phone: '',
    contact_address: '',
    contact_location: {
      lat: DEFAULT_LAT,
      lng: DEFAULT_LNG
    },
    play_store_url: '',
    app_store_url: '',
    faqs: [],
    pages: {
      about_us: '',
      careers: '',
      newsroom: '',
      terms_conditions: '',
      privacy_policy: '',
      refund_policy: '',
      cancellation_policy: ''
    }
  });

  const [faqInput, setFaqInput] = useState({ question: '', answer: '' });

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const res = await adminService.getLandingPageSettings();
      if (res?.success && res?.data) {
        const data = res.data;
        const unescapeHtml = (text) => text ? text
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&#x2F;/g, '/') : '';

        setSettings({
          video_url: data.video_url || '',
          logo_url: data.logo_url || '',
          hero_title: data.hero_title || '',
          hero_description: data.hero_description || '',
          hero_image_url: data.hero_image_url || '',
          why_us_image_url: data.why_us_image_url || '',
          social_links: {
            facebook: data.social_links?.facebook || '',
            twitter: data.social_links?.twitter || '',
            instagram: data.social_links?.instagram || '',
            linkedin: data.social_links?.linkedin || '',
            youtube: data.social_links?.youtube || ''
          },
          contact_email: data.contact_email || '',
          contact_phone: data.contact_phone || '',
          contact_address: data.contact_address || '',
          contact_location: {
            lat: data.contact_location?.lat || DEFAULT_LAT,
            lng: data.contact_location?.lng || DEFAULT_LNG
          },
          play_store_url: data.play_store_url || '',
          app_store_url: data.app_store_url || '',
          faqs: data.faqs || [],
          pages: {
            about_us: unescapeHtml(data.pages?.about_us),
            careers: unescapeHtml(data.pages?.careers),
            newsroom: unescapeHtml(data.pages?.newsroom),
            terms_conditions: unescapeHtml(data.pages?.terms_conditions),
            privacy_policy: unescapeHtml(data.pages?.privacy_policy),
            refund_policy: unescapeHtml(data.pages?.refund_policy),
            cancellation_policy: unescapeHtml(data.pages?.cancellation_policy)
          }
        });
      }
    } catch (err) {
      console.error('Failed to load landing settings:', err);
      toast.error('Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleChange = (field, value) => {
    setSettings(prev => ({ ...prev, [field]: value }));
  };

  const handleNestedChange = (parent, field, value) => {
    setSettings(prev => ({
      ...prev,
      [parent]: {
        ...prev[parent],
        [field]: value
      }
    }));
  };

  const fileToDataUrl = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  // Client preview helper (also validates 5MB limit before base64 conversion)
  const handleImageSelect = async (field, file) => {
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File size exceeds the 5MB limit. Please choose a smaller image.');
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      handleChange(field, dataUrl);
    } catch (err) {
      toast.error('Failed to process image file');
    }
  };

  // Upload inline base64 previews to Cloudinary if they exist, returning clean URLs
  const uploadBase64ImagesToCloudinary = async (currentSettings) => {
    const fieldsToUpload = ['logo_url', 'hero_image_url', 'why_us_image_url'];
    const updated = { ...currentSettings };

    for (const field of fieldsToUpload) {
      const val = updated[field];
      if (val && val.startsWith('data:image')) {
        try {
          const uploadRes = await adminService.uploadImage(val);
          if (uploadRes.data?.success && uploadRes.data?.data?.url) {
            updated[field] = uploadRes.data.data.url;
          }
        } catch (err) {
          console.error(`Failed to upload ${field} to Cloudinary:`, err);
          throw new Error(`Failed to upload ${field.replace('_url', '')} graphic asset.`);
        }
      }
    }
    return updated;
  };

  const handleUpdate = async () => {
    try {
      setSaving(true);

      // 1. Client validations
      if (settings.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.contact_email)) {
        toast.error('Invalid email format in contact info');
        setSaving(false);
        return;
      }
      if (settings.contact_phone && !/^\+?[1-9]\d{1,14}$|^[0-9-\s\+\(\)]+$/.test(settings.contact_phone)) {
        toast.error('Invalid phone number format in contact info');
        setSaving(false);
        return;
      }

      // 2. Upload images to Cloudinary dynamically
      const processedSettings = await uploadBase64ImagesToCloudinary(settings);

      // 3. Save to backend API
      const res = await adminService.updateLandingPageSettings(processedSettings);
      if (res.data?.success) {
        toast.success('Landing page settings updated successfully');
        fetchSettings();
      }
    } catch (err) {
      console.error('Save error:', err);
      toast.error(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  // FAQ handlers
  const handleAddFaq = () => {
    if (!faqInput.question.trim() || !faqInput.answer.trim()) {
      toast.error('FAQ question and answer are required');
      return;
    }
    const newFaq = {
      question: faqInput.question.trim(),
      answer: faqInput.answer.trim(),
      order: settings.faqs.length
    };
    handleChange('faqs', [...settings.faqs, newFaq]);
    setFaqInput({ question: '', answer: '' });
  };

  const handleRemoveFaq = (index) => {
    const filtered = settings.faqs.filter((_, idx) => idx !== index);
    handleChange('faqs', filtered);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <Loader2 className="animate-spin text-indigo-600" size={32} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-8 font-sans pb-20">
      {/* Header Block */}
      <div className="mb-8 max-w-6xl mx-auto">
        <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
          <span>Settings</span>
          <ChevronRight size={12} />
          <span>CMS</span>
          <ChevronRight size={12} />
          <span className="text-gray-700">Landing Page CMS</span>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">Landing Page Management</h1>
            <p className="text-gray-400 font-bold text-[11px] mt-1 uppercase tracking-widest leading-none">Make the landing page and footer policies completely dynamic</p>
          </div>
          <button onClick={() => navigate('/taxi/admin/dashboard')} className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors shadow-sm">
            <ArrowLeft size={16} /> Back to Dashboard
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto flex flex-col lg:flex-row gap-8">

        {/* Navigation Tabs */}
        <div className="w-full lg:w-64 shrink-0 space-y-2">
          {[
            { id: 'general', label: 'Branding & Hero', icon: <ImageIcon size={18} /> },
            { id: 'social', label: 'Social & Store Links', icon: <LinkIcon size={18} /> },
            { id: 'contact', label: 'Contact & Location', icon: <MapPin size={18} /> },
            { id: 'faqs', label: 'Frequently FAQs', icon: <Plus size={18} /> },
            { id: 'pages', label: 'Footer Policies & About', icon: <FileText size={18} /> },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full flex items-center justify-between p-3.5 rounded-xl transition-all border ${activeTab === tab.id
                  ? 'bg-black text-white border-black shadow-lg shadow-black/10'
                  : 'bg-white text-gray-600 hover:bg-gray-50 border-gray-100 shadow-sm'
                }`}
            >
              <div className="flex items-center gap-3 font-bold text-[13px]">
                {tab.icon} {tab.label}
              </div>
            </button>
          ))}

          <div className="mt-8 p-4 bg-amber-50/50 border border-amber-200/50 rounded-xl space-y-3">
            <div className="flex items-center gap-2 text-[#C5902A] font-bold text-[12px] uppercase tracking-widest">
              <Globe size={16} /> Live Sync
            </div>
            <p className="text-[11px] font-semibold text-amber-800 leading-relaxed">
              Updates saved here will propagate instantly to the public landing page at <a href="/" target="_blank" className="underline font-bold text-amber-900">your website's home page (/)</a>.
            </p>
          </div>
        </div>

        {/* Form/Content Section */}
        <div className="flex-1 space-y-6">

          {activeTab === 'general' && (
            <div className="space-y-6">
              <SectionCard title="Hero Section Configurations" subtitle="Edit main headers, descriptors, and media links">
                <div className="grid grid-cols-1 gap-6">
                  <InputField
                    label="Hero Main Title"
                    name="hero_title"
                    value={settings.hero_title}
                    onChange={handleChange}
                    placeholder="All-in-One Platform for Rides, Food & Logistics"
                  />
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-gray-500 mb-1.5">Hero Main Description</label>
                    <textarea
                      value={settings.hero_description || ''}
                      onChange={(e) => handleChange('hero_description', e.target.value)}
                      placeholder="Quick Drop is the multi-service super-app..."
                      rows={3}
                      className="w-full border border-gray-200 rounded-lg p-4 text-sm text-gray-800 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-colors shadow-sm resize-y"
                    />
                  </div>
                  <InputField
                    label="Promotional/Hero Video Link (YouTube embed link)"
                    name="video_url"
                    value={settings.video_url}
                    onChange={handleChange}
                    placeholder="https://www.youtube.com/embed/dQw4w9WgXcQ"
                    info="Specify embed URL so it displays in an iframe player."
                  />
                </div>
              </SectionCard>

              <SectionCard title="Branding Media Uploads" subtitle="Select files to preview and publish. Maximum file size is 5MB.">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                  {/* Brand Logo */}
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-gray-500">Brand Logo Graphic</label>
                    <div className="aspect-[3/1] border border-dashed border-gray-200 rounded-xl bg-gray-50/50 flex flex-col items-center justify-center p-4 relative overflow-hidden group">
                      {settings.logo_url ? (
                        <img src={settings.logo_url} alt="Logo Preview" className="h-full object-contain" />
                      ) : (
                        <div className="text-center text-gray-400 text-xs">
                          <ImageIcon size={24} className="mx-auto mb-2 opacity-50" />
                          <span>No logo uploaded</span>
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                        <label className="p-2 bg-white text-gray-900 rounded-lg shadow-sm hover:scale-105 transition-transform cursor-pointer">
                          <Upload size={16} />
                          <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files[0] && handleImageSelect('logo_url', e.target.files[0])} />
                        </label>
                        {settings.logo_url && (
                          <button onClick={() => handleChange('logo_url', '')} className="p-2 bg-red-500 text-white rounded-lg shadow-sm hover:scale-105 transition-transform">
                            <X size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Hero Image */}
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-gray-500">Hero Section Main Illustration</label>
                    <div className="aspect-[3/1] border border-dashed border-gray-200 rounded-xl bg-gray-50/50 flex flex-col items-center justify-center p-4 relative overflow-hidden group">
                      {settings.hero_image_url ? (
                        <img src={settings.hero_image_url} alt="Hero Preview" className="h-full object-contain" />
                      ) : (
                        <div className="text-center text-gray-400 text-xs">
                          <ImageIcon size={24} className="mx-auto mb-2 opacity-50" />
                          <span>No hero image uploaded</span>
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                        <label className="p-2 bg-white text-gray-900 rounded-lg shadow-sm hover:scale-105 transition-transform cursor-pointer">
                          <Upload size={16} />
                          <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files[0] && handleImageSelect('hero_image_url', e.target.files[0])} />
                        </label>
                        {settings.hero_image_url && (
                          <button onClick={() => handleChange('hero_image_url', '')} className="p-2 bg-red-500 text-white rounded-lg shadow-sm hover:scale-105 transition-transform">
                            <X size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Why Us Image */}
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-gray-500">Why Us Accent Background Graphic</label>
                    <div className="aspect-[3/1] border border-dashed border-gray-200 rounded-xl bg-gray-50/50 flex flex-col items-center justify-center p-4 relative overflow-hidden group">
                      {settings.why_us_image_url ? (
                        <img src={settings.why_us_image_url} alt="Why Us Preview" className="h-full object-contain" />
                      ) : (
                        <div className="text-center text-gray-400 text-xs">
                          <ImageIcon size={24} className="mx-auto mb-2 opacity-50" />
                          <span>No illustration uploaded</span>
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                        <label className="p-2 bg-white text-gray-900 rounded-lg shadow-sm hover:scale-105 transition-transform cursor-pointer">
                          <Upload size={16} />
                          <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files[0] && handleImageSelect('why_us_image_url', e.target.files[0])} />
                        </label>
                        {settings.why_us_image_url && (
                          <button onClick={() => handleChange('why_us_image_url', '')} className="p-2 bg-red-500 text-white rounded-lg shadow-sm hover:scale-105 transition-transform">
                            <X size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                </div>
              </SectionCard>
            </div>
          )}

          {activeTab === 'social' && (
            <div className="space-y-6">
              <SectionCard title="Social Media Connections" subtitle="Add full URLs to your corporate channels">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <InputField label="Facebook URL" name="facebook" value={settings.social_links.facebook} onChange={(n, v) => handleNestedChange('social_links', n, v)} placeholder="https://facebook.com/yourbrand" />
                  <InputField label="Twitter/X URL" name="twitter" value={settings.social_links.twitter} onChange={(n, v) => handleNestedChange('social_links', n, v)} placeholder="https://twitter.com/yourbrand" />
                  <InputField label="Instagram URL" name="instagram" value={settings.social_links.instagram} onChange={(n, v) => handleNestedChange('social_links', n, v)} placeholder="https://instagram.com/yourbrand" />
                  <InputField label="LinkedIn URL" name="linkedin" value={settings.social_links.linkedin} onChange={(n, v) => handleNestedChange('social_links', n, v)} placeholder="https://linkedin.com/company/yourbrand" />
                  <InputField label="YouTube Channel URL" name="youtube" value={settings.social_links.youtube} onChange={(n, v) => handleNestedChange('social_links', n, v)} placeholder="https://youtube.com/yourbrand" />
                </div>
              </SectionCard>

              <SectionCard title="Mobile Stores Link Badges" subtitle="App download redirects from hero and footer blocks">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <InputField label="Google Play Store Badge URL" name="play_store_url" value={settings.play_store_url} onChange={handleChange} placeholder="https://play.google.com/store/apps/details?id=..." />
                  <InputField label="Apple App Store Badge URL" name="app_store_url" value={settings.app_store_url} onChange={handleChange} placeholder="https://apps.apple.com/app/id..." />
                </div>
              </SectionCard>
            </div>
          )}

          {activeTab === 'contact' && (
            <SectionCard title="Office Contacts & Coordinates" subtitle="Used in the footer address coordinates and contact lists">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2">
                  <InputField label="Office Physical Address" name="contact_address" value={settings.contact_address} onChange={handleChange} placeholder="123 Corporate St, Sector 5..." />
                </div>
                <InputField label="Support Contact Email" name="contact_email" value={settings.contact_email} onChange={handleChange} placeholder="k9bharatrides@gmail.com" />
                <InputField label="Support Hotline Number" name="contact_phone" value={settings.contact_phone} onChange={handleChange} placeholder="+91 7358789910" />

                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1.5">Map Latitude</label>
                  <input
                    type="number"
                    step="0.000001"
                    value={settings.contact_location.lat}
                    onChange={(e) => handleNestedChange('contact_location', 'lat', Number(e.target.value))}
                    className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm text-gray-800 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none shadow-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1.5">Map Longitude</label>
                  <input
                    type="number"
                    step="0.000001"
                    value={settings.contact_location.lng}
                    onChange={(e) => handleNestedChange('contact_location', 'lng', Number(e.target.value))}
                    className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm text-gray-800 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none shadow-sm"
                  />
                </div>
              </div>
            </SectionCard>
          )}

          {activeTab === 'faqs' && (
            <div className="space-y-6">
              <SectionCard title="Add Frequently Asked Question" subtitle="Create a Q&A record. Required values.">
                <div className="space-y-4">
                  <InputField
                    label="Question"
                    name="question"
                    value={faqInput.question}
                    onChange={(n, v) => setFaqInput(prev => ({ ...prev, question: v }))}
                    placeholder="E.g., How long do refunds take?"
                  />
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-gray-500 mb-1.5">Answer</label>
                    <textarea
                      value={faqInput.answer}
                      onChange={(e) => setFaqInput(prev => ({ ...prev, answer: e.target.value }))}
                      placeholder="Type accordion details..."
                      rows={3}
                      className="w-full border border-gray-200 rounded-lg p-4 text-sm text-gray-800 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none shadow-sm resize-y"
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleAddFaq}
                      className="px-4 py-2 bg-black text-white rounded-lg text-xs font-bold hover:opacity-90 flex items-center gap-2"
                    >
                      <Plus size={14} /> Add FAQ to List
                    </button>
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="Active FAQs Accordion List" subtitle="Order matches display arrangement on landing page">
                {settings.faqs.length === 0 ? (
                  <p className="text-gray-400 text-xs italic text-center py-6">No FAQs configured yet.</p>
                ) : (
                  <div className="divide-y divide-gray-100 border border-gray-100 rounded-xl overflow-hidden shadow-sm">
                    {settings.faqs.map((faq, idx) => (
                      <div key={idx} className="p-4 bg-white hover:bg-gray-50/50 flex items-start justify-between gap-4 group">
                        <div className="space-y-1">
                          <p className="text-sm font-bold text-gray-900 flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                            {faq.question}
                          </p>
                          <p className="text-xs text-gray-500 pl-3.5 leading-relaxed">{faq.answer}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveFaq(idx)}
                          className="text-gray-300 group-hover:text-red-500 p-1 rounded-lg hover:bg-red-50 transition-colors"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            </div>
          )}

          {activeTab === 'pages' && (
            <SectionCard title="Legal & Policy Pages Content" subtitle="Select a document below to edit its HTML representation">
              <div className="space-y-6">

                {/* Policy Page selector tabs */}
                <div className="flex flex-wrap gap-2 border-b border-gray-100 pb-4">
                  {[
                    { id: 'about_us', label: 'About Us' },
                    { id: 'careers', label: 'Careers' },
                    { id: 'newsroom', label: 'Newsroom' },
                    { id: 'terms_conditions', label: 'Terms & Conditions' },
                    { id: 'privacy_policy', label: 'Privacy Policy' },
                    { id: 'refund_policy', label: 'Refund Policy' },
                    { id: 'cancellation_policy', label: 'Cancellation Policy' },
                  ].map((page) => (
                    <button
                      key={page.id}
                      type="button"
                      onClick={() => setActivePage(page.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${activePage === page.id
                          ? 'bg-indigo-50 text-indigo-600 border-indigo-200 font-black'
                          : 'bg-white text-gray-500 hover:text-gray-700 border-gray-200'
                        }`}
                    >
                      {page.label}
                    </button>
                  ))}
                </div>

                {/* Custom Rich Text Editor */}
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-gray-500">Document Markup Content</label>
                  <RichTextEditor
                    value={settings.pages[activePage] || ''}
                    onChange={(val) => handleNestedChange('pages', activePage, val)}
                  />
                </div>

              </div>
            </SectionCard>
          )}

          {/* Persistent controls bar */}
          <div className="fixed bottom-10 right-10 z-50">
            <button
              onClick={handleUpdate}
              disabled={saving}
              className="bg-[#00BFA5] text-white w-16 h-16 rounded-full flex items-center justify-center shadow-[0_15px_40px_rgba(0,191,165,0.4)] hover:bg-[#00AC95] active:scale-95 transition-all disabled:opacity-50"
              title="Save All Configuration Changes"
            >
              {saving ? <Loader2 size={24} className="animate-spin" /> : <Save size={24} />}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
};

export default LandingPageSettings;

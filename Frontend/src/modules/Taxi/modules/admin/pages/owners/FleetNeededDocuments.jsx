import React, { useCallback, useState, useEffect } from 'react';
import {
  Plus, ChevronRight, Edit2, Trash2, FileText, Save, Check,
  ChevronDown, LayoutGrid, Loader2, AlertCircle, ArrowLeft,
  Shield, ClipboardCheck, Info, FileSearch, Menu
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import AdminPageHeader from '../../components/ui/AdminPageHeader';

const BASE = globalThis.__LEGACY_BACKEND_ORIGIN__ + '/api/v1/taxi/admin/owner-management';
const MotionDiv = motion.div;

const FleetNeededDocuments = () => {
  const navigate = useNavigate();
  const [view, setView] = useState('list');
  const [documents, setDocuments] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState(null);

  const [formData, setFormData] = useState({
    name: '',
    image_type: '',
    has_expiry_date: '',
    has_identify_number: '',
    is_editable: false,
    is_required: false,
    active: true
  });

  const token = (localStorage.getItem('admin_accessToken') || localStorage.getItem('adminToken')) || '';

  const fetchDocuments = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${BASE}/driver-needed-document`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setDocuments(Array.isArray(data.data) ? data.data : (data.data?.results || []));
      }
    } catch (err) {
      console.error("Failed to fetch documents:", err);
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  useEffect(() => {
    setPage(1);
  }, [itemsPerPage]);

  const resetForm = () => {
    setFormData({
      name: '',
      image_type: '',
      has_expiry_date: '',
      has_identify_number: '',
      is_editable: false,
      is_required: false,
      active: true
    });
    setEditingId(null);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!formData.name || !formData.image_type || formData.has_expiry_date === '' || formData.has_identify_number === '') {
        alert("Please fill all required fields");
        return;
    }

    setSubmitting(true);
    const isEditing = !!editingId;
    const url = isEditing ? `${BASE}/driver-needed-document/${editingId}` : `${BASE}/driver-needed-document`;
    
    try {
      const res = await fetch(url, {
        method: isEditing ? 'PATCH' : 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            ...formData,
            has_expiry_date: formData.has_expiry_date === '1' ? true : false,
            has_identify_number: formData.has_identify_number === '1' ? true : false
        })
      });
      const json = await res.json();
      if (json.success) {
        setView('list');
        fetchDocuments();
        resetForm();
      } else {
        alert(json.message || "Operation failed");
      }
    } catch {
      alert("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this document requirement?")) return;
    try {
      const res = await fetch(`${BASE}/driver-needed-document/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const json = await res.json();
      if (json.success) {
        fetchDocuments();
      }
    } catch {
      alert("Error deleting document");
    }
  };

  const handleEdit = (doc) => {
    setEditingId(doc._id);
    setFormData({
      name: doc.name,
      image_type: doc.image_type,
      has_expiry_date: doc.has_expiry_date ? '1' : '0',
      has_identify_number: doc.has_identify_number ? '1' : '0',
      is_editable: doc.is_editable,
      is_required: doc.is_required,
      active: doc.active
    });
    setView('create');
  };

  const totalEntries = documents.length;
  const totalPages = Math.max(1, Math.ceil(totalEntries / itemsPerPage));
  const safePage = Math.min(page, totalPages);
  const paginatedDocs = documents.slice((safePage - 1) * itemsPerPage, safePage * itemsPerPage);
  const showingFrom = totalEntries === 0 ? 0 : (safePage - 1) * itemsPerPage + 1;
  const showingTo = totalEntries === 0 ? 0 : Math.min(showingFrom + paginatedDocs.length - 1, totalEntries);

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-950">
      {view === 'list' ? (
        <div className="px-5 pt-3">
          <AdminPageHeader module="Fleet Management" page="Fleet Needed Documents" title="Fleet Needed Documents" />
        </div>
      ) : (
        <div className="mb-8 flex items-center justify-between px-1">
          <div className="flex items-center gap-6">
            <button
              onClick={() => { setView('list'); resetForm(); }}
              className="p-4 bg-white border border-gray-100 rounded-[20px] hover:bg-gray-50 text-gray-400 hover:text-gray-950 transition-all shadow-sm active:scale-95"
            >
              <ArrowLeft size={24} />
            </button>
            <div>
              <h1 className="text-2xl font-black text-gray-900 tracking-tight uppercase leading-none mb-2">
                  {editingId ? 'Edit Requirement' : 'Create Requirement'}
              </h1>
              <div className="flex items-center gap-2 text-[11px] font-black text-gray-400 uppercase tracking-widest leading-none">
                 <span className="cursor-pointer hover:text-gray-900 transition-colors" onClick={() => setView('list')}>Fleet Needed Documents</span>
                 <ChevronRight size={10} className="opacity-50" />
                 <span className="text-gray-900">Configuration</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <AnimatePresence mode="wait">
        {view === 'list' ? (
          <MotionDiv 
            key="list"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="px-5"
          >
            <div className="relative rounded border border-gray-200 bg-white shadow-sm">
              <div className="flex flex-col gap-5 px-5 py-5 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-3 text-sm font-semibold text-slate-400">
                  <span>show</span>
                  <div className="relative">
                    <select
                      value={itemsPerPage}
                      onChange={(event) => setItemsPerPage(Number(event.target.value) || 10)}
                      className="h-9 w-24 appearance-none rounded border border-gray-300 bg-white px-3 text-sm text-gray-950 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    >
                      {[10, 25, 50, 100].map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={16}
                      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-700"
                    />
                  </div>
                  <span>entries</span>
                </div>

                <button
                  type="button"
                  onClick={() => navigate('/taxi/admin/fleet/documents/create')}
                  className="flex h-12 items-center gap-3 rounded bg-indigo-950 px-6 text-sm font-semibold text-white transition-colors hover:bg-indigo-900"
                >
                  <Plus size={16} /> Add Fleet Needed Documents
                </button>
              </div>

              <div className="px-5">
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-4 text-sm font-bold text-gray-950">Name</th>
                        <th className="px-3 py-4 text-sm font-bold text-gray-950">Document Type</th>
                        <th className="px-3 py-4 text-sm font-bold text-gray-950">Has Expiry Date</th>
                        <th className="px-3 py-4 text-sm font-bold text-gray-950">Status</th>
                        <th className="px-3 py-4 text-sm font-bold text-gray-950">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {isLoading ? (
                        <tr>
                          <td colSpan="5" className="px-3 py-24 text-center">
                            <div className="flex flex-col items-center gap-4 text-slate-400">
                              <Loader2 size={34} className="animate-spin text-teal-500" />
                              <p className="text-sm font-semibold">Loading fleet needed documents...</p>
                            </div>
                          </td>
                        </tr>
                      ) : paginatedDocs.length === 0 ? (
                        <tr>
                          <td colSpan="5" className="border-b border-gray-200 px-3 py-10 text-center">
                            <div className="flex min-h-[130px] flex-col items-center justify-center text-slate-700">
                              <FileSearch size={92} strokeWidth={1.7} className="mb-2 text-indigo-950" />
                              <p className="text-xl font-medium">No Data Found</p>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        paginatedDocs.map((doc) => (
                          <tr key={doc._id} className="bg-white transition-colors hover:bg-gray-50">
                            <td className="px-3 py-5 text-sm text-gray-950">{doc.name || '-'}</td>
                            <td className="px-3 py-5 text-sm capitalize text-gray-950">
                              {(doc.image_type || 'image').replace(/_/g, ' ')}
                            </td>
                            <td className="px-3 py-5 text-sm text-gray-950">{doc.has_expiry_date ? 'Yes' : 'No'}</td>
                            <td className="px-3 py-5">
                              <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${doc.active ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                                {doc.active ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            <td className="px-3 py-5">
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleEdit(doc)}
                                  className="inline-flex h-9 w-10 items-center justify-center rounded bg-amber-50 text-amber-600 transition-colors hover:bg-amber-100"
                                  title="Edit document"
                                >
                                  <Edit2 size={16} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDelete(doc._id)}
                                  className="inline-flex h-9 w-10 items-center justify-center rounded bg-rose-50 text-rose-600 transition-colors hover:bg-rose-100"
                                  title="Delete document"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <button
                type="button"
                className="absolute -right-1 top-[72%] flex h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full bg-teal-500 text-white shadow-xl transition-colors hover:bg-teal-600"
              >
                <Menu size={24} />
              </button>
            </div>

            <div className="mt-8 flex items-center justify-between">
              <p className="text-sm font-medium text-slate-400">
                Showing {showingFrom} to {showingTo} of {totalEntries} entries
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={safePage <= 1}
                  className="rounded border border-gray-200 bg-white px-4 py-2 text-sm text-slate-500 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Prev
                </button>
                <button type="button" className="rounded bg-indigo-950 px-4 py-2 text-sm font-semibold text-white">
                  {safePage}
                </button>
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  disabled={safePage >= totalPages}
                  className="rounded border border-gray-200 bg-white px-4 py-2 text-sm text-slate-500 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Next
                </button>
              </div>
            </div>
          </MotionDiv>
        ) : (
          <MotionDiv 
            key="form"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="flex justify-center py-4"
          >
            <div className="w-full max-w-5xl bg-white rounded-[48px] border border-gray-100 shadow-2xl relative overflow-hidden group">
               <div className="absolute top-0 left-0 w-full h-3 bg-gradient-to-r from-indigo-500 to-purple-500" />
               
               <div className="p-12">
                  <div className="flex items-center justify-between mb-12">
                     <div>
                        <h3 className="text-3xl font-black text-gray-950 uppercase tracking-tight italic leading-none mb-3">CREATE RECORD</h3>
                        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.3em]">Configure Document Compliance Protocol</p>
                     </div>
                     <div className="w-16 h-16 bg-indigo-50 rounded-3xl flex items-center justify-center text-[#2D3A6E] group-hover:rotate-12 transition-transform">
                        <Shield size={32} strokeWidth={2.5} />
                     </div>
                  </div>

                  <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-10">
                     <div className="space-y-3">
                        <label className="text-[11px] font-black text-gray-950 uppercase tracking-[0.2em] flex items-center gap-2 italic">
                           Document Name <span className="text-rose-500">*</span>
                        </label>
                        <div className="relative group">
                           <FileText className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-300 group-focus-within:text-[#2D3A6E] transition-colors" size={20} />
                           <input 
                             type="text" 
                             placeholder="Enter Name"
                             required
                             value={formData.name}
                             onChange={(e) => setFormData({...formData, name: e.target.value})}
                             className="w-full h-16 pl-14 pr-6 bg-gray-50 border-2 border-transparent rounded-2xl text-[15px] font-bold text-gray-900 outline-none focus:bg-white focus:border-[#2D3A6E]/10 transition-all shadow-inner"
                           />
                        </div>
                     </div>

                     <div className="space-y-3">
                        <label className="text-[11px] font-black text-gray-950 uppercase tracking-[0.2em] flex items-center gap-2 italic">
                           Image Type <span className="text-rose-500">*</span>
                        </label>
                        <div className="relative group">
                           <LayoutGrid className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-300 group-focus-within:text-[#2D3A6E] transition-colors" size={20} />
                           <select 
                             required
                             value={formData.image_type}
                             onChange={(e) => setFormData({...formData, image_type: e.target.value})}
                             className="w-full h-16 pl-14 pr-12 bg-gray-50 border-2 border-transparent rounded-2xl text-[15px] font-bold text-gray-950 outline-none appearance-none focus:bg-white focus:border-[#2D3A6E]/10 transition-all shadow-inner cursor-pointer"
                           >
                             <option value="">Select</option>
                             <option value="front">Front</option>
                             <option value="front_back">Front&Back</option>
                           </select>
                           <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 text-gray-200 pointer-events-none" size={18} />
                        </div>
                     </div>

                     <div className="space-y-3">
                        <label className="text-[11px] font-black text-gray-950 uppercase tracking-[0.2em] flex items-center gap-2 italic">
                           Has Expiry Date <span className="text-rose-500">*</span>
                        </label>
                        <div className="relative group">
                           <ClipboardCheck className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-300 group-focus-within:text-[#2D3A6E] transition-colors" size={20} />
                           <select 
                             required
                             value={formData.has_expiry_date}
                             onChange={(e) => setFormData({...formData, has_expiry_date: e.target.value})}
                             className="w-full h-16 pl-14 pr-12 bg-gray-50 border-2 border-transparent rounded-2xl text-[15px] font-bold text-gray-950 outline-none appearance-none focus:bg-white focus:border-[#2D3A6E]/10 transition-all shadow-inner cursor-pointer"
                           >
                             <option value="">Select</option>
                             <option value="1">Yes</option>
                             <option value="0">No</option>
                           </select>
                           <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 text-gray-200 pointer-events-none" size={18} />
                        </div>
                     </div>

                     <div className="space-y-3">
                        <label className="text-[11px] font-black text-gray-950 uppercase tracking-[0.2em] flex items-center gap-2 italic">
                           Has Identify Number <span className="text-rose-500">*</span>
                        </label>
                        <div className="relative group">
                           <Info className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-300 group-focus-within:text-[#2D3A6E] transition-colors" size={20} />
                           <select 
                             required
                             value={formData.has_identify_number}
                             onChange={(e) => setFormData({...formData, has_identify_number: e.target.value})}
                             className="w-full h-16 pl-14 pr-12 bg-gray-50 border-2 border-transparent rounded-2xl text-[15px] font-bold text-gray-950 outline-none appearance-none focus:bg-white focus:border-[#2D3A6E]/10 transition-all shadow-inner cursor-pointer font-sans"
                           >
                             <option value="">Select</option>
                             <option value="1">Yes</option>
                             <option value="0">No</option>
                           </select>
                           <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 text-gray-200 pointer-events-none" size={18} />
                        </div>
                     </div>

                     <div className="col-span-full flex flex-wrap items-center gap-10 pt-4 px-2">
                        <label className="flex items-center gap-4 cursor-pointer group/check">
                           <div className="relative">
                              <input 
                                type="checkbox" 
                                checked={formData.is_editable}
                                onChange={(e) => setFormData({...formData, is_editable: e.target.checked})}
                                className="peer hidden"
                              />
                              <div className="w-7 h-7 border-2 border-gray-200 rounded-lg group-hover/check:border-[#2D3A6E]/50 transition-all peer-checked:bg-[#2D3A6E] peer-checked:border-[#2D3A6E] flex items-center justify-center text-white">
                                 <Check size={16} strokeWidth={4} className="scale-0 peer-checked:scale-100 transition-transform" />
                              </div>
                           </div>
                           <span className="text-[13px] font-black text-gray-900 uppercase tracking-widest italic group-hover/check:text-[#2D3A6E] transition-colors">Is Editable?</span>
                        </label>

                        <label className="flex items-center gap-4 cursor-pointer group/check">
                           <div className="relative">
                              <input 
                                type="checkbox" 
                                checked={formData.is_required}
                                onChange={(e) => setFormData({...formData, is_required: e.target.checked})}
                                className="peer hidden"
                              />
                              <div className="w-7 h-7 border-2 border-gray-200 rounded-lg group-hover/check:border-[#2D3A6E]/50 transition-all peer-checked:bg-[#2D3A6E] peer-checked:border-[#2D3A6E] flex items-center justify-center text-white">
                                 <Check size={16} strokeWidth={4} className="scale-0 peer-checked:scale-100 transition-transform" />
                              </div>
                           </div>
                           <span className="text-[13px] font-black text-gray-900 uppercase tracking-widest italic group-hover/check:text-[#2D3A6E] transition-colors">Is Required?</span>
                        </label>
                     </div>

                     <div className="col-span-full pt-10 border-t border-gray-50 flex items-center justify-end gap-5">
                         <button 
                           type="button"
                           onClick={() => { setView('list'); resetForm(); }}
                           className="h-16 px-10 rounded-[28px] text-[13px] font-black text-gray-400 uppercase tracking-widest hover:text-gray-950 transition-colors"
                         >
                            Cancel
                         </button>
                         <button 
                           type="submit"
                           disabled={submitting}
                           className="h-16 px-12 bg-[#2D3A6E] text-white rounded-[28px] text-[13px] font-black uppercase tracking-[0.2em] flex items-center gap-3 hover:bg-[#1e274a] transition-all shadow-2xl shadow-indigo-200 active:scale-95 disabled:opacity-50"
                         >
                            {submitting ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
                            {editingId ? 'Update Requirement' : 'Save'}
                         </button>
                     </div>
                  </form>
               </div>
               
               <div className="bg-indigo-50/30 p-10 flex items-start gap-5">
                  <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-indigo-400 shadow-sm shrink-0">
                     <AlertCircle size={24} />
                  </div>
                  <div>
                     <p className="text-[11px] font-black text-gray-900 uppercase tracking-widest mb-1 italic">Validation Logic</p>
                     <p className="text-[12px] font-bold text-gray-400 leading-relaxed max-w-2xl">
                        Ensuring all fleet documents meet strict verification standards. Identify numbers and expiry dates will be mandatory for OCR processing if enabled.
                     </p>
                  </div>
               </div>
            </div>
          </MotionDiv>
        )}
      </AnimatePresence>
    </div>
  );
};

export default FleetNeededDocuments;



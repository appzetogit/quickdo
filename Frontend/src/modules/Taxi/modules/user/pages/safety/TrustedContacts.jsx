import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, UserPlus, Star, Trash2, Edit2, LoaderCircle, Users } from 'lucide-react';
import api from '../../../../shared/api/axiosInstance';
import toast from 'react-hot-toast';

const TrustedContacts = () => {
  const navigate = useNavigate();
  const [contacts, setContacts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchContacts = async () => {
    try {
      const response = await api.get('/safety/trusted-contacts');
      setContacts(response.data?.data || []);
    } catch (err) {
      console.error(err);
      toast.error('Could not load trusted contacts');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchContacts();
  }, []);

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this contact?')) return;
    try {
      await api.delete(`/safety/trusted-contacts/${id}`);
      toast.success('Contact deleted');
      fetchContacts();
    } catch (err) {
      toast.error('Failed to delete contact');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-10">
      <div className="bg-white px-5 pt-10 pb-4 shadow-sm sticky top-0 z-10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="w-10 h-10 bg-slate-50 rounded-full flex items-center justify-center transition-all active:scale-95">
            <ArrowLeft size={20} className="text-slate-700" strokeWidth={2.5} />
          </button>
          <h1 className="text-lg font-bold text-slate-900">Trusted Contacts</h1>
        </div>
        <button className="w-10 h-10 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center transition-all active:scale-95">
          <UserPlus size={18} strokeWidth={2.5} />
        </button>
      </div>

      <div className="px-5 mt-6">
        <p className="text-[13px] text-slate-500 font-medium mb-4">
          Add family members or close friends to share your live trip details automatically during emergencies.
        </p>

        {isLoading ? (
          <div className="flex justify-center mt-10">
            <LoaderCircle className="animate-spin text-slate-400" />
          </div>
        ) : contacts.length === 0 ? (
          <div className="bg-white border border-slate-100 rounded-2xl p-8 text-center mt-6 shadow-sm">
            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <Users size={32} className="text-slate-300" />
            </div>
            <h3 className="text-[15px] font-bold text-slate-900">No contacts added</h3>
            <p className="text-[12px] text-slate-500 mt-1 mb-4">Add your loved ones to stay safe.</p>
            <button className="bg-slate-900 text-white px-6 py-2.5 rounded-xl text-[13px] font-bold">
              Add Contact
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {contacts.map((contact, idx) => (
              <motion.div
                key={contact._id || idx}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white p-4 rounded-[16px] shadow-sm border border-slate-100 flex items-center gap-4"
              >
                <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center text-emerald-600 shrink-0 font-bold text-lg">
                  {contact.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-[14px] font-bold text-slate-900 truncate flex items-center gap-2">
                    {contact.name}
                    {contact.is_primary && <Star size={12} className="text-amber-500 fill-amber-500" />}
                  </h4>
                  <p className="text-[12px] text-slate-500 truncate">{contact.relation} • {contact.phone}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-slate-600 active:scale-95">
                    <Edit2 size={14} />
                  </button>
                  <button onClick={() => handleDelete(contact._id)} className="w-8 h-8 rounded-full bg-red-50 flex items-center justify-center text-red-500 active:scale-95">
                    <Trash2 size={14} />
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default TrustedContacts;

import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, FileWarning, UploadCloud, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../../shared/api/axiosInstance';

const ReportDriver = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const rideId = searchParams.get('rideId');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedReason, setSelectedReason] = useState('');
  const [description, setDescription] = useState('');
  const [image, setImage] = useState(null);

  const reasons = [
    'Unsafe Driving',
    'Driver was rude or unprofessional',
    'Asked for extra cash/toll',
    'Vehicle condition was poor',
    'Driver did not match profile',
    'Vehicle did not match profile',
    'Harassment or misbehavior',
    'Other'
  ];

  const handleImageChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setImage(e.target.files[0]);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedReason) {
      toast.error('Please select a reason for reporting.');
      return;
    }

    setIsSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('trip_id', rideId);
      formData.append('reason', selectedReason);
      formData.append('description', description);
      if (image) formData.append('image', image);

      await api.post('/safety/driver/report', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      
      toast.success('Report submitted successfully. Our safety team will review this shortly.', { duration: 4000 });
      navigate(-1);
    } catch (err) {
      toast.error('Failed to submit report. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-10">
      <div className="bg-white px-5 pt-10 pb-4 shadow-sm sticky top-0 z-10 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="w-10 h-10 bg-slate-50 rounded-full flex items-center justify-center transition-all active:scale-95">
          <ArrowLeft size={20} className="text-slate-700" strokeWidth={2.5} />
        </button>
        <h1 className="text-lg font-bold text-slate-900">Report Issue</h1>
      </div>

      <form onSubmit={handleSubmit} className="px-5 mt-6 flex flex-col gap-6">
        <div className="bg-orange-50 border border-orange-100 rounded-[20px] p-5 flex items-start gap-4 shadow-sm">
          <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center text-orange-600 shrink-0">
            <FileWarning size={20} />
          </div>
          <div>
            <h3 className="text-[14px] font-bold text-slate-900">Help us keep you safe</h3>
            <p className="text-[12px] text-slate-600 mt-1 leading-snug">
              Your feedback is treated with strict confidentiality. We take strict actions against policy violations.
            </p>
          </div>
        </div>

        <div>
          <h4 className="text-[14px] font-bold text-slate-900 mb-3">What went wrong?</h4>
          <div className="flex flex-col gap-2">
            {reasons.map((reason) => (
              <label 
                key={reason} 
                className={`flex items-center gap-3 p-3.5 rounded-[16px] border cursor-pointer transition-all ${
                  selectedReason === reason 
                    ? 'border-emerald-500 bg-emerald-50/50' 
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <input 
                  type="radio" 
                  name="reason" 
                  checked={selectedReason === reason}
                  onChange={() => setSelectedReason(reason)}
                  className="w-4 h-4 text-emerald-600 focus:ring-emerald-500"
                />
                <span className={`text-[13px] font-bold ${selectedReason === reason ? 'text-emerald-900' : 'text-slate-700'}`}>
                  {reason}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <h4 className="text-[14px] font-bold text-slate-900 mb-3">Additional Details (Optional)</h4>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Tell us more about what happened..."
            className="w-full bg-white border border-slate-200 rounded-[16px] p-4 text-[13px] font-medium focus:outline-none focus:border-emerald-500 min-h-[120px] shadow-sm"
          />
        </div>

        <div>
          <h4 className="text-[14px] font-bold text-slate-900 mb-3">Upload Proof (Optional)</h4>
          {!image ? (
            <label className="w-full border-2 border-dashed border-slate-200 rounded-[16px] p-6 flex flex-col items-center justify-center bg-white cursor-pointer hover:bg-slate-50 transition-colors">
              <UploadCloud size={24} className="text-slate-400 mb-2" />
              <span className="text-[13px] font-bold text-slate-600">Tap to upload image</span>
              <span className="text-[11px] text-slate-400 mt-1">JPEG, PNG up to 5MB</span>
              <input type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
            </label>
          ) : (
            <div className="relative w-24 h-24 rounded-[16px] overflow-hidden border border-slate-200">
              <img src={URL.createObjectURL(image)} alt="Preview" className="w-full h-full object-cover" />
              <button 
                type="button"
                onClick={() => setImage(null)}
                className="absolute top-1 right-1 w-6 h-6 bg-black/50 backdrop-blur-md rounded-full flex items-center justify-center text-white"
              >
                <X size={14} />
              </button>
            </div>
          )}
        </div>

        <motion.button
          whileTap={{ scale: 0.98 }}
          type="submit"
          disabled={isSubmitting || !selectedReason}
          className="w-full bg-slate-900 text-white font-bold py-4 rounded-[16px] shadow-[0_8px_20px_rgba(15,23,42,0.15)] disabled:opacity-50 disabled:shadow-none mt-2"
        >
          {isSubmitting ? 'Submitting...' : 'Submit Report'}
        </motion.button>
      </form>
    </div>
  );
};

export default ReportDriver;

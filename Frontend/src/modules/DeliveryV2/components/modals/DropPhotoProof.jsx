import React, { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Camera, Loader2, X, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import apiClient from '@/services/api/axios';
import { ActionSlider } from '@/modules/DeliveryV2/components/ui/ActionSlider';

/**
 * Proof of delivery (plan 5.4): the rider photographs the drop and the photo,
 * where they stood and when go with the completion. Required by the server
 * when the customer's handover code is not in use for the order (admin
 * setting, or a contactless drop); optional otherwise.
 */

const currentPosition = () =>
  new Promise((resolve) => {
    if (!navigator?.geolocation) return resolve({});
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve({}),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
    return undefined;
  });

export const DropPhotoProof = ({ order, onProof, onClose }) => {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [proof, setProof] = useState(null);

  const pick = async (file) => {
    if (!file) return;
    if (!String(file.type || '').startsWith('image/')) {
      toast.error('Please take a photo');
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('folder', 'delivery/drop-proof');
      const [res, where] = await Promise.all([
        apiClient.post('/uploads/image', form, { headers: { 'Content-Type': 'multipart/form-data' }, contextModule: 'delivery' }),
        currentPosition(),
      ]);
      const url = res?.data?.data?.url || res?.data?.url;
      if (!url) throw new Error('Upload failed');
      setProof({ photoUrl: url, ...where });
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not upload the photo');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="absolute inset-0 z-120 flex items-end justify-center pointer-events-none">
      <div className="absolute inset-0 bg-black/40 -z-10 pointer-events-auto" onClick={onClose} />
      <motion.div
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="w-full bg-white rounded-t-[3.5rem] shadow-[0_-25px_80px_rgba(0,0,0,0.5)] p-8 pb-12 pointer-events-auto max-w-lg"
      >
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-2xl font-black text-gray-900 tracking-tight">Delivery photo</h2>
            <p className="text-[11px] font-bold text-gray-500">
              Photograph the order at the door or with the customer{order?.contactlessDelivery ? ' (contactless drop)' : ''}.
            </p>
          </div>
          <button onClick={onClose} className="p-3 bg-gray-50 rounded-2xl text-gray-400"><X className="w-5 h-5" /></button>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0])}
        />

        {proof ? (
          <div className="mb-6">
            <img src={proof.photoUrl} alt="Delivery proof" className="w-full h-56 object-cover rounded-3xl border border-gray-100" />
            <p className="mt-2 flex items-center gap-1 text-xs font-bold text-emerald-700"><CheckCircle2 className="w-4 h-4" /> Photo ready</p>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="mb-6 w-full flex items-center justify-center gap-3 py-10 rounded-3xl border-2 border-dashed border-gray-200 text-gray-600 font-black text-xs uppercase tracking-widest"
          >
            {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
            {uploading ? 'Uploading...' : 'Take photo'}
          </button>
        )}

        <ActionSlider
          key="action-photo"
          label={proof ? 'Slide to continue' : 'Take a photo first'}
          successLabel="Saved"
          disabled={!proof}
          onConfirm={async () => onProof(proof)}
          color="bg-emerald-600"
        />
      </motion.div>
    </div>
  );
};

export default DropPhotoProof;

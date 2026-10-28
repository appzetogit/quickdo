import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ShieldCheck, Phone, Users, ShieldAlert, HeartHandshake, Info, ArrowLeft } from 'lucide-react';
import toast from 'react-hot-toast';

const SafetyCenter = () => {
  const navigate = useNavigate();

  const safetyFeatures = [
    {
      title: 'Trusted Contacts',
      description: 'Add contacts to share your live trip details automatically.',
      icon: Users,
      color: 'bg-blue-100 text-blue-600',
      action: () => navigate('/taxi/user/safety/contacts'),
    },
    {
      title: 'Emergency SOS',
      description: 'Instantly share location and ride details with police and loved ones.',
      icon: ShieldAlert,
      color: 'bg-red-100 text-red-600',
      action: () => toast('SOS is active during rides via the floating SOS button.', { icon: '🚨', style: { borderRadius: '10px', background: '#333', color: '#fff' } }),
    },
    {
      title: 'Live Trip Sharing',
      description: 'Generate a secure link to let others track your ride in real-time.',
      icon: HeartHandshake,
      color: 'bg-emerald-100 text-emerald-600',
      action: () => navigate('/taxi/user/safety/trip-sharing'),
    },
    {
      title: 'Safety Tips',
      description: 'Guidelines and best practices for a secure journey.',
      icon: Info,
      color: 'bg-indigo-100 text-indigo-600',
      action: () => navigate('/taxi/user/safety/tips'),
    },
    {
      title: '24/7 Support',
      description: 'Call our dedicated safety team anytime.',
      icon: Phone,
      color: 'bg-orange-100 text-orange-600',
      action: () => window.location.href = 'tel:911',
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-10">
      <div className="bg-[#0F766E] text-white px-5 pt-12 pb-8 rounded-b-[32px] shadow-lg relative overflow-hidden">
        <div className="absolute top-0 right-0 p-10 opacity-10">
          <ShieldCheck size={180} />
        </div>
        
        <div className="flex items-center gap-3 mb-6 relative z-10">
          <button onClick={() => navigate(-1)} className="w-10 h-10 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center transition-all active:scale-95">
            <ArrowLeft size={20} strokeWidth={2.5} />
          </button>
          <h1 className="text-xl font-bold">Women Safety Center</h1>
        </div>

        <div className="relative z-10">
          <p className="text-[13px] text-emerald-50 leading-relaxed max-w-[280px]">
            Your safety is our top priority. We have built industry-leading features to ensure you have a secure and comfortable journey.
          </p>
        </div>
      </div>

      <div className="px-5 mt-6 flex flex-col gap-4">
        {safetyFeatures.map((feature, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            onClick={feature.action}
            className="bg-white p-4 rounded-[20px] shadow-[0_4px_16px_rgba(15,23,42,0.04)] border border-slate-100 flex items-center gap-4 active:scale-[0.98] transition-all cursor-pointer"
          >
            <div className={`w-14 h-14 rounded-[16px] flex items-center justify-center shrink-0 ${feature.color}`}>
              <feature.icon size={26} strokeWidth={2.5} />
            </div>
            <div className="flex-1">
              <h3 className="text-[15px] font-bold text-slate-900">{feature.title}</h3>
              <p className="text-[12px] font-medium text-slate-500 mt-0.5 leading-snug">{feature.description}</p>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export default SafetyCenter;

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Info, CheckCircle, ShieldAlert } from 'lucide-react';

const SafetyTips = () => {
  const navigate = useNavigate();

  const tips = [
    {
      title: "Check Your Ride",
      desc: "Always verify the vehicle make, model, license plate, and driver photo before getting in.",
      icon: CheckCircle,
      color: "text-emerald-600 bg-emerald-50 border-emerald-100",
    },
    {
      title: "Share Your Trip Details",
      desc: "Use the 'Share Trip' feature to let loved ones follow your ride in real-time.",
      icon: Info,
      color: "text-blue-600 bg-blue-50 border-blue-100",
    },
    {
      title: "Use the In-App SOS",
      desc: "If you feel unsafe, tap the red SOS button during your ride to immediately alert our safety team.",
      icon: ShieldAlert,
      color: "text-red-600 bg-red-50 border-red-100",
    }
  ];

  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-10">
      <div className="bg-white px-5 pt-10 pb-4 shadow-sm sticky top-0 z-10 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="w-10 h-10 bg-slate-50 rounded-full flex items-center justify-center transition-all active:scale-95">
          <ArrowLeft size={20} className="text-slate-700" strokeWidth={2.5} />
        </button>
        <h1 className="text-lg font-bold text-slate-900">Safety Tips</h1>
      </div>

      <div className="px-5 mt-6 flex flex-col gap-4">
        {tips.map((tip, i) => (
          <div key={i} className={`p-5 rounded-[20px] border shadow-sm ${tip.color} flex flex-col gap-3`}>
            <div className="flex items-center gap-2">
              <tip.icon size={22} />
              <h3 className="text-[15px] font-bold text-slate-900">{tip.title}</h3>
            </div>
            <p className="text-[13px] text-slate-700 leading-relaxed font-medium">
              {tip.desc}
            </p>
          </div>
        ))}

        <div className="mt-4 p-5 bg-white border border-slate-200 rounded-[20px] shadow-sm">
          <h3 className="text-[15px] font-bold text-slate-900 mb-2">Our Commitment</h3>
          <p className="text-[13px] text-slate-500 leading-relaxed">
            Every driver undergoes rigorous background checks. We continuously monitor rides and maintain a 24/7 dedicated safety response team to ensure you always reach your destination securely.
          </p>
        </div>
      </div>
    </div>
  );
};

export default SafetyTips;

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ShieldCheck, DollarSign, CheckCircle2, 
  QrCode, Loader2, Info, X, RefreshCw, Package
} from 'lucide-react';
import { deliveryAPI } from '@food/api';
import { toast } from 'sonner';
import { ActionSlider } from '@/modules/DeliveryV2/components/ui/ActionSlider';

const Backdrop = ({ onClose }) => (
  <motion.div 
    initial={{ opacity: 0 }} 
    animate={{ opacity: 1 }} 
    exit={{ opacity: 0 }}
    className="absolute inset-0 bg-black/40 -z-10 pointer-events-auto" 
    onClick={onClose}
  />
);

const DeliveryInstructionsPanel = ({ note }) => {
  const text = String(note || '').trim()
  if (!text) return null

  return (
    <div className="w-full rounded-3xl mb-6 overflow-hidden border border-primary-orange/10 shadow-sm">
      <div className="bg-linear-to-r from-primary-orange/50 to-amber-500 px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 bg-white/20 rounded-2xl flex items-center justify-center text-white">
            <Package className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[10px] font-black text-white uppercase tracking-[0.2em]">
              Delivery instruction
            </p>
            <p className="text-[11px] font-semibold text-white/90">
              Read before handover
            </p>
          </div>
        </div>
      </div>
      <div className="bg-primary-orange/5 px-5 py-4">
        <p className="text-sm font-bold text-gray-950 leading-relaxed wrap-break-word">
          “{text}”
        </p>
      </div>
    </div>
  )
}

const OtpModal = ({ order, onVerified, onClose }) => {
  const [otp, setOtp] = useState(['', '', '', '']);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [isOtpVerified, setIsOtpVerified] = useState(false);
  const inputRefs = [useRef(), useRef(), useRef(), useRef()];

  useEffect(() => {
    const savedCode = order?.deliveryVerification?.dropOtp?.code;
    if (savedCode && String(savedCode).length === 4) {
      setOtp(String(savedCode).split(''));
    }
    const timer = setTimeout(() => {
      inputRefs[0].current?.focus();
    }, 500);
    return () => clearTimeout(timer);
  }, [order?.deliveryVerification?.dropOtp?.code]);

  const orderId = order.orderMongoId || order._id || order.orderId || 'ORD';

  const handleOtpChange = (index, value) => {
    if (value && !/^\d+$/.test(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value.substring(value.length - 1);
    setOtp(newOtp);
    if (value && index < 3) inputRefs[index + 1].current?.focus();
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) inputRefs[index - 1].current?.focus();
  };

  const verifyOtp = async () => {
    const otpString = otp.join('');
    if (otpString.length < 4) return;
    setIsVerifyingOtp(true);
    try {
      const res = await deliveryAPI.verifyDropOtp(orderId, otpString);
      if (res?.data?.success) {
        setIsOtpVerified(true);
        // toast.success("OTP Verified Successfully");
        setTimeout(() => onVerified(otpString), 600);
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || "Invalid OTP entered");
      throw err;
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  const isAlreadyVerified = order?.deliveryVerification?.dropOtp?.verified;

  return (
    <div className="absolute inset-0 z-120 flex items-end justify-center pointer-events-none">
      <Backdrop onClose={onClose} />
      <motion.div 
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="w-full bg-white rounded-t-[3.5rem] shadow-[0_-25px_80px_rgba(0,0,0,0.5)] flex flex-col max-h-[85vh] pointer-events-auto max-w-lg overflow-hidden"
      >
        {/* Handle / Minimize */}
        <div className="w-full flex justify-center py-3 bg-white relative z-20">
          <div className="w-12 h-1.5 bg-gray-200 rounded-full" />
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar p-8 pt-4">
          <div className="flex justify-between items-center mb-8">
             <div className="flex items-center gap-4">
               <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg ${isOtpVerified ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-100 text-gray-400'}`}>
                 <ShieldCheck className="w-8 h-8" />
               </div>
               <div>
                 <h2 className="text-2xl font-black text-gray-900 tracking-tight">Handover Code</h2>
                 <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Step 1 of 2 • Secure Drop</p>
               </div>
             </div>
             <button onClick={onClose} className="p-3 bg-gray-50 rounded-2xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all active:scale-90"><X className="w-5 h-5"/></button>
          </div>

          <DeliveryInstructionsPanel note={order?.note} />

          <div className="flex justify-center gap-4 mb-10">
            {otp.map((digit, i) => (
              <input
                key={i}
                ref={inputRefs[i]}
                type="number"
                disabled={isOtpVerified}
                value={digit}
                onChange={(e) => handleOtpChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                className={`w-16 h-20 bg-gray-50 border-2 rounded-[1.5rem] text-center text-3xl font-black transition-all ${
                  isOtpVerified ? 'border-emerald-500 bg-emerald-50 text-emerald-700 shadow-inner' : 'border-gray-100 focus:border-emerald-600 focus:bg-white text-gray-900'
                }`}
              />
            ))}
          </div>
        </div>

        <div className="p-8 pt-0 pb-12 bg-white border-t border-gray-50">
          <div className="pt-6">
            <ActionSlider 
              key="action-otp"
              label={isVerifyingOtp ? "Verifying..." : isAlreadyVerified ? "Code verified ✓" : "Slide to Verify OTP"} 
              successLabel="Verified!"
              disabled={otp.some(d => !d) || isVerifyingOtp || isOtpVerified || isAlreadyVerified}
              onConfirm={verifyOtp}
              color="bg-gray-950"
            />
          </div>
        </div>
      </motion.div>
    </div>
  );
};


const PaymentModal = ({ order, otpString, onComplete, onClose }) => {
  const [showQrModal, setShowQrModal] = useState(false);
  const [collectQrLink, setCollectQrLink] = useState(null);
  const [isGeneratingQr, setIsGeneratingQr] = useState(false);
  const isInitialPaid = ['paid', 'captured', 'authorized'].includes(String(order.payment?.status || "").toLowerCase());
  const [paymentStatus, setPaymentStatus] = useState(isInitialPaid ? 'paid' : 'idle');
  const [isSyncing, setIsSyncing] = useState(false);
  const [isCashAccepted, setIsCashAccepted] = useState(false);
  const [isSwitchingToCash, setIsSwitchingToCash] = useState(false);
  const pollingRef = useRef(null);

  const orderId = order?.orderMongoId || order?._id || order?.orderId || 'ORD';
  const amountToCollect = order.pricing?.total || order.amountToCollect || 0;


  const checkPaymentSync = useCallback(async (isManual = false) => {
    try {
      const res = await deliveryAPI.getPaymentStatus(orderId);
      // Handle both response shapes: { data: { payment } } and { data: { data: { payment } } }
      const payload = res?.data?.data ?? res?.data ?? {};
      const status = String(payload?.payment?.status || "").toLowerCase();
      console.log('[PaymentSync] polled status:', status, payload?.payment);
      if (['paid', 'partially_paid', 'captured', 'authorized'].includes(status)) {
        setPaymentStatus('paid');
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
        setShowQrModal(false);
        toast.success("Payment Received!");
      } else if (isManual) {
        toast.error(`Payment not received yet (${status || 'pending'})`);
      }
    } catch (e) {
      console.error('[PaymentSync] poll failed:', e?.response?.data || e?.message);
      if (isManual) {
        toast.error("Failed to check payment status");
      }
    }
  }, [orderId]);

  const handleManualCheck = async () => {
    setIsSyncing(true);
    await checkPaymentSync(true);
    setTimeout(() => setIsSyncing(false), 800);
  };

  // Only poll when QR payment is actively pending
  useEffect(() => {
    if (paymentStatus === 'pending' && !isCashAccepted) {
      // Immediate check, then every 4 seconds
      checkPaymentSync();
      if (pollingRef.current) clearInterval(pollingRef.current);
      pollingRef.current = setInterval(checkPaymentSync, 4000);
    } else {
      // Stop polling if we switched away from pending
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    }
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [paymentStatus, isCashAccepted, checkPaymentSync]);


  const generateQr = async () => {
    setIsGeneratingQr(true);
    try {
      const res = await deliveryAPI.createCollectQr(orderId, {
        name: order.userName || 'Customer',
        phone: order.userPhone || ''
      });
      const link = res?.data?.data?.shortUrl || res?.data?.shortUrl || null;
      if (link) {
        setCollectQrLink(link);
        setPaymentStatus('pending');
        setShowQrModal(true);
        setIsCashAccepted(false); // Reset cash if they try QR
      } else {
        toast.error("Could not generate QR code");
      }
    } catch (e) {
      const msg = e?.response?.data?.message || e?.response?.data?.error || e?.message || "QR Generation failed";
      toast.error(`QR Generation failed: ${msg}`);
      console.error("QR Generation error", e?.response?.data || e);
    } finally {
      setIsGeneratingQr(false);
    }
  };

  const handleTakeCash = async () => {
    setIsSwitchingToCash(true);
    try {
      await deliveryAPI.switchToCash(orderId);
      setIsCashAccepted(true);
      setPaymentStatus('idle');
      setShowQrModal(false);
      toast.success("Switched to Cash Collection");
    } catch (err) {
      toast.error("Failed to switch to cash");
    } finally {
      setIsSwitchingToCash(false);
    }
  };

  const isPaid = paymentStatus === 'paid';
  const canComplete = isPaid || isCashAccepted;

  return (
    <>
      <div className="absolute inset-0 z-120 flex items-end justify-center pointer-events-none">
        <Backdrop onClose={onClose} />
        <motion.div 
          initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          className="w-full bg-white rounded-t-[3.5rem] shadow-[0_-25px_80px_rgba(0,0,0,0.5)] flex flex-col max-h-[85vh] pointer-events-auto max-w-lg"
        >
          <div className="w-full flex justify-center py-3 bg-white relative z-20">
            <div className="w-12 h-1.5 bg-gray-200 rounded-full" />
          </div>

          <div className="flex-1 overflow-y-auto no-scrollbar p-8 pt-4">
            <div className="flex justify-between items-center mb-8">
               <div className="flex items-center gap-4">
                 <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg ${isPaid ? 'bg-emerald-100 text-emerald-600' : isCashAccepted ? 'bg-blue-100 text-blue-600' : 'bg-amber-100 text-amber-600'}`}>
                   {isCashAccepted ? <CheckCircle2 className="w-8 h-8" /> : <DollarSign className="w-8 h-8" />}
                 </div>
                 <div>
                   <h2 className="text-2xl font-black text-gray-900 tracking-tight">Collect Payment</h2>
                   <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Step 2 of 2 • Handover</p>
                 </div>
               </div>
               <button onClick={onClose} className="p-3 bg-gray-50 rounded-2xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all active:scale-90"><X className="w-5 h-5"/></button>
            </div>

            <DeliveryInstructionsPanel note={order?.note} />

            <div className="bg-amber-50/50 rounded-[2.5rem] p-8 border border-amber-100 mb-8 relative overflow-hidden group">
               <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity">
                  <DollarSign className="w-24 h-24" />
               </div>

               <div className="relative z-10">
                 <p className="text-amber-700 text-[10px] font-black uppercase tracking-[0.25em] mb-2">
                    {isPaid ? "Payment Already Settled" : isCashAccepted ? "Collect Cash" : "Amount to Collect"}
                 </p>
                 <div className="flex items-baseline gap-1 mb-3">
                    <span className="text-2xl font-bold text-amber-950/60">₹</span>
                    <p className="text-amber-950 text-5xl font-black tracking-tighter leading-none">{amountToCollect.toFixed(2)}</p>
                 </div>
                 {isPaid ? (
                   <div className="inline-flex items-center gap-2 bg-emerald-500 text-white pl-3 pr-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest shadow-lg shadow-emerald-500/20">
                     <CheckCircle2 className="w-3.5 h-3.5" />
                     Payment Received
                   </div>
                 ) : isCashAccepted && (
                   <div className="inline-flex items-center gap-2 bg-blue-500 text-white pl-3 pr-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest shadow-lg shadow-blue-500/20">
                     <DollarSign className="w-3.5 h-3.5" />
                     Collecting Cash
                   </div>
                 )}
               </div>


               {!isPaid && (
                 <div className="space-y-4 relative z-10">
                   <button 
                     onClick={generateQr}
                     disabled={isGeneratingQr || isSwitchingToCash}
                     className={`w-full py-5 bg-white border-2 text-[11px] font-black uppercase tracking-[0.15em] flex items-center justify-center gap-3 shadow-xl shadow-amber-900/5 active:scale-95 transition-all rounded-2xl ${isCashAccepted ? 'border-gray-100 text-gray-400 opacity-50' : 'border-amber-200 text-amber-800'}`}
                   >
                     {isGeneratingQr ? <Loader2 className="w-5 h-5 animate-spin" /> : <QrCode className="w-5 h-5" />}
                     Show Payment QR
                   </button>


                   {/* Take Cash button — shows confirmed state after selection */}
                   {isCashAccepted ? (
                     <div className="w-full py-4 bg-blue-50 border-2 border-blue-400 rounded-2xl flex items-center justify-center gap-3">
                       <CheckCircle2 className="w-5 h-5 text-blue-600" />
                       <span className="text-blue-700 font-black text-[11px] uppercase tracking-[0.15em]">Cash Collection Mode</span>
                     </div>
                   ) : (
                     <button 
                       onClick={handleTakeCash}
                       disabled={isGeneratingQr || isSwitchingToCash}
                       className="w-full py-5 bg-white border-2 border-gray-200 text-gray-700 text-[11px] font-black uppercase tracking-[0.15em] flex items-center justify-center gap-3 shadow-xl active:scale-95 transition-all rounded-2xl"
                     >
                       {isSwitchingToCash ? <Loader2 className="w-5 h-5 animate-spin" /> : <DollarSign className="w-5 h-5" />}
                       Take Cash
                     </button>
                   )}

                 </div>
               )}
            </div>
          </div>

          <div className="p-8 pt-0 pb-12 bg-white border-t border-gray-50">
            <div className="pt-6">
              <ActionSlider 
                key={`action-payment-${isPaid}-${isCashAccepted}`}
                label={isPaid ? "Slide to Complete" : isCashAccepted ? "Slide to Complete" : "Payment Required"} 
                successLabel="Delivered! ✓"
                disabled={!canComplete}
                onConfirm={async () => {
                    try {
                        await onComplete(otpString);
                    } catch (e) {
                        throw e;
                    }
                }}
                color={isPaid ? "bg-emerald-600" : isCashAccepted ? "bg-blue-600" : "bg-gray-400"}
              />
            </div>
          </div>
        </motion.div>
      </div>


      <AnimatePresence>
        {showQrModal && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-200 bg-black/80 flex items-center justify-center p-6 pointer-events-auto"
            onClick={() => setShowQrModal(false)}
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }}
              className="bg-white w-full max-w-sm rounded-3xl p-8 flex flex-col items-center text-center shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <h3 className="text-gray-950 font-bold text-xl mb-2">Scan to Pay</h3>
              <p className="text-gray-500 text-sm mb-8 font-medium">Order Total: ₹{amountToCollect.toFixed(2)}</p>
              
              <div className="relative p-6 bg-gray-50 rounded-3xl border-2 border-gray-100 mb-8">
                 <img 
                   src={`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(collectQrLink)}`} 
                   alt="Razorpay QR"
                   className="w-56 h-56"
                 />
                 <button 
                    onClick={handleManualCheck}
                    disabled={isSyncing}
                    className="absolute top-2 right-2 flex gap-1.5 items-center bg-green-500 text-white px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest shadow-lg active:scale-95 transition-all"
                 >
                    {isSyncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} 
                    Check Status
                 </button>
              </div>

              <button 
                onClick={() => setShowQrModal(false)}
                className="w-full py-4 bg-gray-100 text-gray-500 rounded-2xl font-bold text-xs uppercase tracking-widest"
              >
                Close QR
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export const DeliveryVerificationModal = ({ order, onComplete, onClose }) => {
  const alreadyVerified = !!order?.deliveryVerification?.dropOtp?.verified;
  const paymentMethod = (
    order?.paymentMethod ||
    order?.payment?.method ||
    order?.transaction?.payment?.method ||
    order?.transaction?.paymentMethod ||
    'cod'
  ).toLowerCase();
  const isCod = ['cash', 'cod', 'cash_on_delivery', 'razorpay_qr'].includes(paymentMethod);

  // Determine initial step: skip OTP if already verified
  const [step, setStep] = useState(() => {
    if (alreadyVerified) {
      return isCod ? 'payment' : 'complete';
    }
    return 'otp';
  });
  const [verifiedOtp, setVerifiedOtp] = useState(alreadyVerified ? (order.deliveryVerification.dropOtp.code || '') : '');

  const handleOtpVerified = (otpValue) => {
    setVerifiedOtp(otpValue);
    // After OTP is verified: COD → show payment panel, Online → show complete button
    setStep(isCod ? 'payment' : 'complete');
  };

  // If OTP was already verified on mount and it's a non-COD order, auto-complete
  useEffect(() => {
    if (step === 'complete' && !isCod) {
      onComplete(verifiedOtp);
    }
  }, []); // only on mount

  if (!order) return null;

  return (
    <AnimatePresence mode="wait">
      {step === 'otp' && (
        <OtpModal 
          key="otp-modal" 
          order={order} 
          onVerified={handleOtpVerified} 
          onClose={onClose || (() => {})} 
        />
      )}
      {step === 'payment' && (
        <PaymentModal 
          key="payment-modal" 
          order={order} 
          otpString={verifiedOtp} 
          onComplete={onComplete} 
          onClose={onClose || (() => {})} 
        />
      )}
      {step === 'complete' && (
        <div className="absolute inset-0 z-120 flex items-end justify-center pointer-events-none">
          <Backdrop onClose={onClose || (() => {})} />
          <motion.div 
            key="complete-modal"
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="w-full bg-white rounded-t-[3.5rem] shadow-[0_-25px_80px_rgba(0,0,0,0.5)] p-8 pb-12 pointer-events-auto max-w-lg mb-0"
          >
            <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mb-8" />
            <div className="flex items-center gap-4 mb-10">
              <div className="w-16 h-16 rounded-[1.5rem] bg-emerald-50 flex items-center justify-center text-emerald-600 shadow-lg shadow-emerald-500/5 ring-4 ring-emerald-50/50">
                <CheckCircle2 className="w-9 h-9" />
              </div>
              <div>
                <h2 className="text-3xl font-black text-gray-900 tracking-tight">Verified √</h2>
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-emerald-600">Secure Drop Authenticated</p>
              </div>
            </div>
            <div className="pt-2">
              <ActionSlider 
                key="action-complete"
                label="Slide to Complete Delivery" 
                successLabel="Delivered! ✓"
                onConfirm={async () => {
                  await onComplete(verifiedOtp);
                }}
                color="bg-emerald-600"
              />
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

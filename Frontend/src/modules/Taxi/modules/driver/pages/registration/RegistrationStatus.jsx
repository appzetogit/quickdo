import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Clock,
  Mail,
  Search,
  ChevronRight
} from "lucide-react";
import { motion } from "framer-motion";
import { useSettings } from "../../../../shared/context/SettingsContext";
import {
  clearDriverRegistrationSession,
  getDriverApprovalStatus,
  getDriverDocumentTemplates,
  clearDriverAuthState,
  getLocalDriverToken,
  getStoredDriverRole,
  persistDriverAuthSession,
} from "../../services/registrationService";

const APPROVAL_POLL_MS = 2500;

const unwrapDriver = (response) =>
  response?.data?.data || response?.data || response;

const isDriverApproved = (driver) => {
  if (!driver) {
    return false;
  }

  const approval = String(driver.approve ?? "").toLowerCase();
  const status = String(driver.status || "").toLowerCase();

  return (
    driver.approve === true ||
    driver.approve === 1 ||
    ["true", "1", "yes", "approved"].includes(approval) ||
    ["approved", "active", "verified"].includes(status)
  );
};

const redirectToDriverLogin = (navigate) => {
  clearDriverAuthState();
  navigate("/taxi/driver/login", { replace: true });
};

const RegistrationStatus = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { settings, activeLogo } = useSettings();
  const [checking, setChecking] = useState(true);
  const [driver, setDriver] = useState(null);
  const [documentTemplates, setDocumentTemplates] = useState([]);
  const [statusMessage, setStatusMessage] = useState(
    "Waiting for admin approval",
  );
  const timeoutRef = useRef(null);
  const requestInFlightRef = useRef(false);
  const mountedRef = useRef(false);

  const appName = settings.general?.app_name || "App";
  const appLogo = activeLogo || settings.general?.logo || settings.customization?.logo;
  const isVehicleReapproval = location.state?.statusReason === "vehicle-update" || driver?.approve === false;
  const routePrefix = location.pathname.startsWith('/taxi/owner') ? '/taxi/owner' : '/taxi/driver';

  useEffect(() => {
    if (location.state?.role) {
      const normalizedRole =
        String(location.state.role).toLowerCase() === "owner"
          ? "owner"
          : "driver";
      persistDriverAuthSession({ role: normalizedRole });
    }

    const onboardingToken =
      location.state?.completedRegistration?.token ||
      location.state?.token ||
      "";

    if (onboardingToken) {
      const roleFromState = String(location.state?.role || "").toLowerCase();
      persistDriverAuthSession({
        token: onboardingToken,
        role: roleFromState === "owner" ? "owner" : "driver",
      });
    }

    mountedRef.current = true;

    const fetchTemplates = async () => {
      try {
        const role = getStoredDriverRole() || location.state?.role || "driver";
        const response = await getDriverDocumentTemplates(role);
        const templates = response?.data?.data?.results || response?.data?.results || [];
        if (mountedRef.current) setDocumentTemplates(templates);
      } catch (err) {
        console.error("Failed to fetch templates", err);
      }
    };

    fetchTemplates();

    const checkApproval = async () => {
      if (!mountedRef.current || requestInFlightRef.current) {
        return;
      }

      requestInFlightRef.current = true;
      const token = getLocalDriverToken();

      if (!token) {
        if (mountedRef.current) {
          setChecking(false);
          setStatusMessage(
            "Registration session not found. Please start again.",
          );
        }
        redirectToDriverLogin(navigate);
        requestInFlightRef.current = false;
        return;
      }

      try {
        const response = await getDriverApprovalStatus();
        const driverData = unwrapDriver(response);
        if (mountedRef.current) setDriver(driverData);

        const isApproved = isDriverApproved(driverData);

        if (!mountedRef.current) {
          return;
        }

        if (isApproved) {
          clearDriverRegistrationSession();
          const normalizedRole =
            String(getStoredDriverRole() || location.state?.role || "driver").toLowerCase();

          const isOwner = normalizedRole === "owner";
          const path = isOwner ? "/taxi/owner/home" : "/taxi/driver/home";

          navigate(path, { replace: true });
          requestInFlightRef.current = false;
          return;
        }

        setChecking(false);
        setStatusMessage("Your application is being audited by our verification team.");
      } catch (error) {
        if (!mountedRef.current) {
          return;
        }

        if (error?.status === 401) {
          redirectToDriverLogin(navigate);
          requestInFlightRef.current = false;
          return;
        }

        if (error?.status === 404) {
          setStatusMessage("Driver account deleted. Redirecting to login...");
          redirectToDriverLogin(navigate);
          requestInFlightRef.current = false;
          return;
        }

        setChecking(false);
        setStatusMessage(
          error?.message || "Your request is still under review.",
        );
      } finally {
        requestInFlightRef.current = false;
      }
    };

    checkApproval();
    timeoutRef.current = setInterval(checkApproval, APPROVAL_POLL_MS);

    return () => {
      mountedRef.current = false;
      requestInFlightRef.current = false;
      clearInterval(timeoutRef.current);
    };
  }, [location.state, navigate]);

  const getStatusColor = (status) => {
    const s = String(status || '').toLowerCase();
    if (['approved', 'active', 'verified', 'true', '1'].includes(s)) return 'text-emerald-500 bg-emerald-50';
    if (['rejected', 'declined', 'failed'].includes(s)) return 'text-rose-500 bg-rose-50';
    return 'text-amber-500 bg-amber-50';
  };

  const getDocumentStatus = (doc = {}) =>
    String(
      doc?.status ||
      doc?.verificationStatus ||
      doc?.approvalStatus ||
      doc?.reviewStatus ||
      'pending',
    ).toLowerCase();

  const getDocumentReason = (doc = {}) =>
    String(
      doc?.comment ||
      doc?.remarks ||
      doc?.reason ||
      doc?.admin_comment ||
      doc?.rejection_reason ||
      '',
    ).trim();

  const getDocumentImage = (doc = {}) =>
    String(
      doc?.previewUrl ||
      doc?.secureUrl ||
      doc?.url ||
      '',
    ).trim();

  const getDocumentReviewTimestamp = (doc = {}) => {
    const reviewTime = new Date(
      doc?.reverificationRequestedAt ||
      doc?.uploadedAt ||
      doc?.updatedAt ||
      0,
    ).getTime();
    const reviewedTime = new Date(doc?.reviewedAt || 0).getTime();

    if (!Number.isFinite(reviewTime) || reviewTime <= 0) {
      return false;
    }

    return Number.isFinite(reviewedTime) && reviewedTime > 0 && reviewTime >= reviewedTime;
  };

  const getDocumentDetails = () => {
    if (!driver || !documentTemplates.length) return [];

    const docs = driver.documents || {};
    const flatFields = documentTemplates.flatMap(t => t.fields || []);

    return flatFields.map(field => {
      const doc = docs[field.key];
      const status = getDocumentStatus(doc);
      const reason = getDocumentReason(doc);

      return {
        label: field.label || field.name || field.key,
        status,
        reason,
        key: field.key,
        previewUrl: getDocumentImage(doc),
        reverificationPending: status === 'pending' && getDocumentReviewTimestamp(doc),
      };
    });
  };

  const docDetails = getDocumentDetails();
  const rejectedDocs = docDetails.filter(d => d.status === 'rejected' || d.status === 'declined');
  const pendingReverificationDocs = docDetails.filter((doc) => doc.reverificationPending);

  return (
    <div
      className="min-h-screen bg-[linear-gradient(180deg,#f6efe4_0%,#fcfaf6_28%,#ffffff_100%)] px-5 pb-10 pt-12 select-none overflow-x-hidden flex flex-col items-center"
      style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}
    >
      <header className="mb-10 w-full flex flex-col items-center">
        {appLogo ? (
          <img
            src={appLogo}
            alt={appName}
            className="h-10 object-contain drop-shadow-sm"
          />
        ) : (
          <div className="rounded-2xl bg-slate-950 px-5 py-2.5 text-lg font-black tracking-tighter text-white shadow-xl shadow-slate-950/20 border border-white/10">
            {appName}
          </div>
        )}
      </header>

      <main className="w-full max-w-sm space-y-8">
        <section className="flex flex-col items-center text-center space-y-6">
          <div className="relative group">
            <div className="w-28 h-28 bg-white rounded-[2.5rem] flex items-center justify-center text-slate-900 shadow-[0_20px_50px_rgba(0,0,0,0.08)] border border-white/80 group-hover:scale-105 transition-transform duration-500">
              <Clock size={42} strokeWidth={2.5} className="animate-pulse" />
            </div>
            <div className="absolute -bottom-1 -right-1 w-10 h-10 bg-slate-950 rounded-2xl flex items-center justify-center text-white border-4 border-white shadow-xl">
              <Search size={16} strokeWidth={3} />
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400 opacity-60">
              {pendingReverificationDocs.length > 0 ? "Submission received" : isVehicleReapproval ? "Update in review" : "Live Audit Status"}
            </p>
            <h1 className="font-['Outfit'] text-[42px] font-black leading-[1] tracking-[-0.04em] text-slate-900">
              {rejectedDocs.length > 0 ? (
                <>Action <span className="text-slate-400">Required</span></>
              ) : pendingReverificationDocs.length > 0 ? (
                <>Verification <span className="text-slate-400">Pending</span></>
              ) : (
                <>Review <span className="text-slate-400">Started</span></>
              )}
            </h1>
            <p className="mx-auto max-w-[28ch] text-[15px] font-bold leading-relaxed text-slate-500 opacity-80">
              {rejectedDocs.length > 0
                ? "Some of your documents were rejected. Please re-upload them to continue."
                : pendingReverificationDocs.length > 0
                  ? "Your updated documents were sent back to admin for another review."
                  : "Our team is currently performing a manual audit of your profile."}
            </p>
          </div>
        </section>

        {driver && (
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ scale: 1.01 }}
            className="bg-white rounded-[2.5rem] p-6 border border-slate-100 shadow-[0_10px_40px_rgba(0,0,0,0.04)] space-y-4"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-slate-50 rounded-[1rem] flex items-center justify-center text-slate-400">
                <Mail size={24} />
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="text-base font-black tracking-tight text-slate-900 truncate">{driver.name || 'Captain'}</h4>
                <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest opacity-60 truncate">
                  +91 {driver.phone}
                </p>
              </div>
              <div className="flex-shrink-0 px-3 py-1.5 bg-slate-950 text-white rounded-full text-[9px] font-black uppercase tracking-[0.15em] shadow-lg shadow-slate-950/20 border border-white/10">
                {driver.status || 'Pending'}
              </div>
            </div>
          </motion.section>
        )}

        <section className="space-y-4">
          <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] px-2 opacity-60">Checklist Summary</h3>
          <div className="space-y-4">
            {docDetails.length > 0 ? docDetails.map((doc, idx) => (
              <div key={idx} className="bg-white rounded-[1.8rem] border border-slate-100 p-5 shadow-[0_8px_30px_rgba(0,0,0,0.03)] space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[15px] font-black tracking-tight text-slate-800 truncate">{doc.label}</span>
                  <span className={`flex-shrink-0 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest ${getStatusColor(doc.status)}`}>
                    {doc.status}
                  </span>
                </div>
                {doc.reason && (
                  <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl">
                    <p className="text-[13px] font-bold text-rose-600 leading-relaxed">
                      <span className="opacity-60 uppercase text-[10px] block mb-1 tracking-widest">Reason for rejection:</span>
                      {doc.reason}
                    </p>
                  </div>
                )}
                {doc.reverificationPending && (
                  <div className="p-4 bg-slate-900/5 border border-slate-900/10 rounded-2xl">
                    <p className="text-[13px] font-bold text-slate-600 leading-relaxed">
                      Re-uploaded and waiting for admin re-verification.
                    </p>
                  </div>
                )}
                {(doc.status === 'rejected' || doc.status === 'declined') && (
                  <button
                    onClick={() => navigate(`${routePrefix}/documents`, {
                      state: {
                        focusDocumentKey: doc.key,
                        fromRegistrationStatus: true,
                      },
                    })}
                    className="w-full h-12 bg-slate-900 text-white rounded-2xl flex items-center justify-center gap-2 text-[13px] font-black uppercase tracking-widest active:scale-95 transition-all shadow-xl shadow-slate-900/10"
                  >
                    Fix Document <ChevronRight size={16} strokeWidth={3} />
                  </button>
                )}
              </div>
            )) : (
              <div className="bg-white rounded-[1.8rem] border border-slate-100 p-10 text-center shadow-sm">
                <div className="h-6 w-6 border-2 border-slate-100 border-t-slate-900 rounded-full animate-spin mx-auto mb-4" />
                <p className="text-[12px] font-black uppercase tracking-widest text-slate-400 opacity-60">Syncing documents...</p>
              </div>
            )}
          </div>
        </section>

        <div className="sticky bottom-0 z-10 -mx-1 mt-2 rounded-[28px] border border-slate-100 bg-white/95 p-4 shadow-[0_-12px_30px_rgba(15,23,42,0.08)] backdrop-blur-xl flex flex-col gap-3">
          {rejectedDocs.length > 0 ? (
            <div className="rounded-2xl bg-rose-50 border border-rose-100 px-5 py-4 text-[12px] font-bold leading-relaxed text-rose-600 shadow-sm">
              Select a rejected document above to re-upload the correct file.
            </div>
          ) : null}
          <button
            onClick={() => navigate(`${routePrefix}/support/chat`, {
              state: {
                backPath: `${routePrefix}/registration-status`,
                backState: location.state || null,
              },
            })}
            className="w-full h-14 bg-white border border-slate-200 text-slate-600 rounded-2xl flex items-center justify-center gap-2 text-[15px] font-bold active:scale-95 transition-all"
          >
            Contact Support
          </button>
        </div>
      </main>
    </div>
  );
};
export default RegistrationStatus;

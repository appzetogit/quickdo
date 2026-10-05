import React, { useEffect, useMemo, useState } from 'react';
import { 
    ArrowLeft, 
    Camera, 
    CheckCircle2, 
    FileText, 
    ImagePlus,
    ShieldCheck, 
    AlertCircle,
    ChevronRight,
    UploadCloud
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  clearDriverRegistrationSession,
  completeDriverOnboarding,
  getDriverDocumentTemplates,
  getStoredDriverRegistrationSession,
  persistDriverAuthSession,
  saveDriverDocuments,
  saveDriverRegistrationSession,
} from '../../services/registrationService';
import {
  flattenDriverDocumentFields,
  getDocumentPreviewUrl,
  normalizeDriverDocumentTemplates,
} from '../../utils/documentTemplates';

const unwrap = (response) => response?.data?.data || response?.data || response;

const normalizeDocument = (doc) => {
  if (!doc) {
    return null;
  }

  if (typeof doc === 'string') {
    return {
      previewUrl: doc,
      secureUrl: doc,
      uploaded: true,
    };
  }

  return {
    ...doc,
    previewUrl: getDocumentPreviewUrl(doc),
    uploaded: doc.uploaded ?? Boolean(getDocumentPreviewUrl(doc)),
    identifyNumber: String(doc.identifyNumber || doc.identify_number || doc.documentNumber || doc.document_number || '').trim(),
    expiryDate: String(doc.expiryDate || doc.expiry_date || doc.expiry || doc.expiresAt || '').trim(),
  };
};

const getDocumentIdentifyValue = (doc) =>
  String(doc?.identifyNumber || doc?.identify_number || doc?.documentNumber || doc?.document_number || '').trim();

const getDocumentExpiryValue = (doc) =>
  String(doc?.expiryDate || doc?.expiry_date || doc?.expiry || doc?.expiresAt || '').trim();

const buildTemplateMetaState = (templates = [], documents = {}) =>
  Object.fromEntries(
    templates.map((template) => {
      const templateFields = Array.isArray(template.fields) ? template.fields : [];
      const firstDocument = templateFields
        .map((field) => normalizeDocument(documents?.[field.key]))
        .find(Boolean);

      return [
        template.id,
        {
          identifyNumber: getDocumentIdentifyValue(firstDocument),
          expiryDate: getDocumentExpiryValue(firstDocument),
        },
      ];
    }),
  );

const formatMetaLabel = (value) =>
  String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());

const fileToDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });

const normalizeSignupRole = (role) =>
  String(role || 'driver').toLowerCase() === 'owner' ? 'owner' : 'driver';

const matchesDocumentRole = (accountType, role) => {
  const rawAccountType = String(accountType || '').trim().toLowerCase();
  const normalizedAccountType = rawAccountType || 'individual';
  const normalizedRole = normalizeSignupRole(role);

  if (normalizedAccountType === 'both') {
    return true;
  }

  if (normalizedRole === 'owner') {
    if (!rawAccountType) {
      return true;
    }

    return ['fleet_drivers', 'owner', 'owners', 'fleet_owner', 'fleet_owners'].includes(normalizedAccountType);
  }

  return normalizedAccountType === 'individual';
};

const isImageLikeFile = (file) => {
  if (!file) {
    return false;
  }

  if (String(file.type || '').startsWith('image/')) {
    return true;
  }

  return /\.(jpg|jpeg|png|webp|heic|heif|bmp|gif)$/i.test(String(file.name || ''));
};

const inferImageMeta = (file, dataUrl) => {
  const mimeMatch = String(dataUrl || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/i);
  const mimeType = String(file?.type || mimeMatch?.[1] || 'image/jpeg').toLowerCase();
  const extension = mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
  const originalName = String(file?.name || '').trim();

  return {
    mimeType,
    fileName: originalName || `capture-${Date.now()}.${extension}`,
  };
};

const StepDocuments = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const session = {
    ...getStoredDriverRegistrationSession(),
    ...(location.state || {}),
  };
  const normalizedRole = normalizeSignupRole(session.role);

  const [templates, setTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [docs, setDocs] = useState(() =>
    Object.fromEntries(
      Object.entries(session.documents || {}).map(([key, value]) => [key, normalizeDocument(value)]),
    ),
  );
  const [documentMeta, setDocumentMeta] = useState({});
  const [uploading, setUploading] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadTemplates = async () => {
      setTemplatesLoading(true);

      try {
        const response = await getDriverDocumentTemplates(normalizedRole);
        const results = response?.data?.data?.results || response?.data?.results || [];
        setTemplates(normalizeDriverDocumentTemplates(results));
      } catch {
        setTemplates(normalizeDriverDocumentTemplates([]));
      } finally {
        setTemplatesLoading(false);
      }
    };

    loadTemplates();
  }, [normalizedRole]);

  const documentTemplates = useMemo(
    () =>
      normalizeDriverDocumentTemplates(templates).filter((template) =>
        matchesDocumentRole(template.account_type, normalizedRole),
      ),
    [normalizedRole, templates],
  );
  const uploadFields = useMemo(
    () => flattenDriverDocumentFields(documentTemplates),
    [documentTemplates],
  );
  const requiredUploadFields = useMemo(
    () => uploadFields.filter((item) => Boolean(item.isRequired)),
    [uploadFields],
  );
  const templateFieldMap = useMemo(
    () =>
      Object.fromEntries(
        documentTemplates.map((template) => [template.id, Array.isArray(template.fields) ? template.fields : []]),
      ),
    [documentTemplates],
  );

  useEffect(() => {
    setDocumentMeta((current) => ({
      ...buildTemplateMetaState(documentTemplates, docs),
      ...current,
    }));
  }, [documentTemplates, docs]);

  const applyTemplateMetaToDocuments = (templateId, templateDocuments, metaOverride = null) => {
    const meta = metaOverride || documentMeta[templateId] || { identifyNumber: '', expiryDate: '' };
    const identifyNumber = String(meta.identifyNumber || '').trim();
    const expiryDate = String(meta.expiryDate || '').trim();

    return Object.fromEntries(
      Object.entries(templateDocuments).map(([docKey, docValue]) => [
        docKey,
        docValue
          ? {
              ...docValue,
              identifyNumber,
              identify_number: identifyNumber,
              documentNumber: identifyNumber,
              document_number: identifyNumber,
              expiryDate,
              expiry_date: expiryDate,
            }
          : docValue,
      ]),
    );
  };

  const handleMetaChange = (templateId, fieldName, nextValue) => {
    const nextMeta = {
      ...(documentMeta[templateId] || {}),
      [fieldName]: nextValue,
    };

    setDocumentMeta((current) => ({
      ...current,
      [templateId]: nextMeta,
    }));

    const templateFields = templateFieldMap[templateId] || [];
    if (templateFields.length === 0) {
      return;
    }

    setDocs((current) => {
      const nextDocuments = { ...current };
      for (const field of templateFields) {
        if (!nextDocuments[field.key]) {
          continue;
        }

        nextDocuments[field.key] = applyTemplateMetaToDocuments(
          templateId,
          { [field.key]: nextDocuments[field.key] },
          nextMeta,
        )[field.key];
      }
      return nextDocuments;
    });
  };

  const handleFileChange = async (templateId, key, event) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    setUploading(key);
    setError('');

    try {
      const dataUrl = await fileToDataUrl(file);
      if (!String(dataUrl || '').startsWith('data:image/')) {
        throw new Error('Please upload an image file');
      }

      const { fileName, mimeType } = inferImageMeta(file, dataUrl);

      setDocs((prev) => ({
        ...prev,
        [key]: {
          ...(prev[key] || {}),
          previewUrl: dataUrl,
          fileName,
          mimeType,
          uploaded: false,
          uploading: true,
        },
      }));

      const response = await saveDriverDocuments({
        registrationId: session.registrationId,
        phone: session.phone,
        documents: {
          [key]: {
            dataUrl,
            fileName,
            mimeType,
            identifyNumber: documentMeta[templateId]?.identifyNumber || '',
            expiryDate: documentMeta[templateId]?.expiryDate || '',
          },
        },
      });
      const payload = unwrap(response);

      const uploadedDoc = payload?.documents?.[key] || payload?.session?.documents?.[key];
      const nextDoc = normalizeDocument(uploadedDoc) || {
        previewUrl: dataUrl,
        secureUrl: dataUrl,
        fileName,
        mimeType,
        uploaded: true,
      };
      const nextDocWithMeta = applyTemplateMetaToDocuments(templateId, { [key]: nextDoc })[key];

      setDocs((prev) => ({
        ...prev,
        [key]: nextDocWithMeta,
      }));

      const storedSession = getStoredDriverRegistrationSession();
      saveDriverRegistrationSession({
        ...storedSession,
        ...session,
        documents: {
          ...(storedSession.documents || {}),
          [key]: nextDocWithMeta,
        },
      });
    } catch (uploadError) {
      setError(uploadError?.message || 'Unable to upload document');
      setDocs((prev) => ({
        ...prev,
        [key]: normalizeDocument(session.documents?.[key]),
      }));
    } finally {
      setUploading(null);
    }
  };

  const isComplete =
    requiredUploadFields.every((item) => Boolean(docs[item.key]?.uploaded || docs[item.key]?.secureUrl)) &&
    documentTemplates.every((template) => {
      if (!template.is_required) {
        return true;
      }

      const meta = documentMeta[template.id] || {};
      const hasIdentifyNumber = !template.has_identify_number || Boolean(String(meta.identifyNumber || '').trim());
      const hasExpiryDate = !template.has_expiry_date || Boolean(String(meta.expiryDate || '').trim());
      return hasIdentifyNumber && hasExpiryDate;
    }) &&
    !uploading &&
    !templatesLoading;

  const handleSubmit = async () => {
    if (!isComplete) {
      setError(uploading ? 'Please wait for the current upload to finish' : 'Please upload every required document image');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const submittedDocuments = Object.fromEntries(
        Object.entries(docs).filter(([, value]) => Boolean(value?.uploaded || value?.secureUrl)),
      );
      const submittedDocumentsWithMeta = { ...submittedDocuments };

      for (const template of documentTemplates) {
        const templateFields = Array.isArray(template.fields) ? template.fields : [];
        const templateDocuments = Object.fromEntries(
          templateFields
            .filter((field) => submittedDocumentsWithMeta[field.key])
            .map((field) => [field.key, submittedDocumentsWithMeta[field.key]]),
        );

        if (Object.keys(templateDocuments).length === 0) {
          continue;
        }

        Object.assign(
          submittedDocumentsWithMeta,
          applyTemplateMetaToDocuments(template.id, templateDocuments),
        );
      }

      const completeResponse = await completeDriverOnboarding({
        registrationId: session.registrationId,
        phone: session.phone,
        documents: submittedDocumentsWithMeta,
      });
      const payload = unwrap(completeResponse);

      const token = payload?.token;
      if (token) {
        const normalizedRole =
          String(session.role || 'driver').toLowerCase() === 'owner' ? 'owner' : 'driver';
        persistDriverAuthSession({ token, role: normalizedRole });
      }

      saveDriverRegistrationSession({
        ...session,
        documents: docs,
        completedRegistration: payload || null,
      });
      clearDriverRegistrationSession();

      navigate('/taxi/driver/registration-status', {
        state: {
          ...session,
          documents: docs,
          completedRegistration: payload || null,
        },
      });
    } catch (submitError) {
      setError(submitError?.message || 'Unable to complete registration');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div 
        className="min-h-screen bg-[linear-gradient(180deg,#f6efe4_0%,#fcfaf6_28%,#ffffff_100%)] px-5 pb-32 pt-8 select-none overflow-x-hidden"
        style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}
    >
      <main className="mx-auto max-w-sm space-y-6">
        <header className="space-y-5">
            <div className="flex items-center justify-between">
                <button
                    onClick={() => navigate('/taxi/driver/step-vehicle', { state: session })}
                    className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/70 bg-white/80 text-slate-900 shadow-[0_10px_30px_rgba(15,23,42,0.08)] backdrop-blur-sm transition-transform active:scale-95"
                >
                    <ArrowLeft size={18} strokeWidth={2.5} />
                </button>
                <div className="rounded-full bg-slate-900/5 px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.15em] text-slate-500 border border-slate-900/5">
                    Step 4 of 4
                </div>
            </div>

            <section className="space-y-3">
                <div className="flex items-center gap-3">
                     <div className="flex h-11 w-11 items-center justify-center rounded-[1.25rem] bg-slate-900 text-white shadow-xl shadow-slate-900/10">
                        <ShieldCheck size={22} strokeWidth={2.5} />
                    </div>
                    <span className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400 opacity-60">
                        Identity Verification
                    </span>
                </div>
                <h1 className="font-['Outfit'] text-[48px] font-black leading-[1] tracking-[-0.04em] text-slate-900">
                    KYC <span className="text-slate-400">Vault</span>
                </h1>
                <p className="text-[15px] leading-relaxed text-slate-500 font-bold opacity-80 max-w-[28ch]">
                    Upload clear photos of the required documents to verify your identity.
                </p>
            </section>
        </header>

        {error && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 shadow-[0_10px_30px_rgba(244,63,94,0.08)]">
                {error}
            </div>
        )}

        <div className="space-y-6">
          {templatesLoading ? (
            <div className="bg-white rounded-[2.5rem] p-12 text-center space-y-4 shadow-[0_10px_40px_rgba(0,0,0,0.04)] border border-slate-100">
              <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto animate-pulse">
                <FileText size={20} className="text-slate-300" />
              </div>
              <p className="text-[12px] font-black text-slate-400 uppercase tracking-widest">Loading checklist...</p>
            </div>
          ) : (
            documentTemplates.map((template) => (
              <section key={template.id} className="space-y-5 rounded-[2.5rem] border border-slate-100 bg-white p-6 shadow-[0_10px_40px_rgba(0,0,0,0.04)]">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1.5">
                    <h3 className="text-lg font-black tracking-tight text-slate-900">{template.name}</h3>
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest opacity-60">
                           {template.fields.length > 1 ? 'Multiple Sides' : 'Single Side'}
                        </span>
                        <div className="w-1 h-1 rounded-full bg-slate-200" />
                        <span className={`text-[10px] font-black uppercase tracking-widest ${template.is_required ? 'text-emerald-600' : 'text-slate-400 opacity-60'}`}>
                          {template.is_required ? 'Mandatory' : 'Optional'}
                        </span>
                    </div>
                  </div>
                  <div className="rounded-full bg-slate-900/5 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-slate-500 border border-slate-900/5">
                    {template.account_type || 'individual'}
                  </div>
                </div>

                <div className="space-y-6">
                  {template.fields.map((field) => {
                    const document = docs[field.key];
                    const isUploading = uploading === field.key;
                    const isRequired = Boolean(field.required ?? field.isRequired);

                    return (
                      <div key={field.key} className="space-y-3">
                        <div className="flex items-center justify-between gap-2 px-1">
                          <label className="block text-[11px] font-black uppercase tracking-widest text-slate-400 opacity-80">{field.label}</label>
                          <span className={`text-[9px] font-black uppercase tracking-[0.15em] px-2 py-0.5 rounded-md ${isRequired ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-50 text-slate-400'}`}>
                            {isRequired ? 'Required' : 'Optional'}
                          </span>
                        </div>
                        
                        <div className="grid grid-cols-1 gap-3">
                            <div
                                className={`relative min-h-[160px] rounded-[1.8rem] border-2 transition-all overflow-hidden flex flex-col items-center justify-center gap-2 ${
                                    document?.previewUrl
                                        ? 'border-emerald-500/20 bg-emerald-50/10'
                                        : 'border-dashed border-slate-100 bg-slate-50 hover:border-slate-200'
                                }`}
                            >
                                {isUploading ? (
                                    <div className="flex flex-col items-center gap-3">
                                        <div className="w-6 h-6 border-2 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
                                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Uploading</span>
                                    </div>
                                ) : document?.previewUrl ? (
                                    <>
                                        <img src={document.previewUrl} alt={field.label} className="absolute inset-0 h-full w-full object-cover" />
                                        <div className="absolute inset-0 bg-black/10" />
                                        <div className="absolute bottom-4 right-4 w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center text-white shadow-xl border-2 border-white">
                                            <CheckCircle2 size={16} strokeWidth={3} />
                                        </div>
                                        <div className="absolute top-4 left-4 bg-black/40 backdrop-blur-md rounded-xl px-3 py-1.5 flex items-center gap-2 border border-white/20">
                                            <Camera size={12} className="text-white" />
                                            <span className="text-[10px] font-black text-white uppercase tracking-widest">Retake Photo</span>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div className="w-12 h-12 rounded-2xl bg-white text-slate-400 flex items-center justify-center shadow-sm border border-slate-100">
                                            <UploadCloud size={20} />
                                        </div>
                                        <div className="text-center">
                                            <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Tap to upload</p>
                                        </div>
                                        <div className="absolute top-4 right-4 w-8 h-8 rounded-xl bg-slate-900/5 flex items-center justify-center">
                                            <Camera size={14} className="text-slate-400" />
                                        </div>
                                    </>
                                )}
                            </div>

                            <div className="flex gap-2">
                                <label className={`flex-1 relative flex h-12 items-center justify-center gap-2 text-center rounded-2xl border text-[11px] font-black uppercase tracking-widest transition-all ${
                                    isUploading
                                    ? 'cursor-not-allowed border-slate-50 bg-slate-50 text-slate-300'
                                    : 'cursor-pointer border-slate-100 bg-white text-slate-600 hover:bg-slate-50 active:scale-[0.98]'
                                }`}>
                                    <ImagePlus size={16} />
                                    Gallery
                                    <input
                                    type="file"
                                    accept="image/*"
                                    disabled={isUploading}
                                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                                    aria-label={`Upload ${field.label} from gallery`}
                                    onChange={(event) => handleFileChange(template.id, field.key, event)}
                                    />
                                </label>
                                <label className={`flex-1 relative flex h-12 items-center justify-center gap-2 text-center rounded-2xl border text-[11px] font-black uppercase tracking-widest transition-all ${
                                    isUploading
                                    ? 'cursor-not-allowed border-slate-50 bg-slate-50 text-slate-300'
                                    : 'cursor-pointer border-slate-900 bg-slate-900 text-white hover:bg-black shadow-lg shadow-slate-900/10 active:scale-[0.98]'
                                }`}>
                                    <Camera size={16} />
                                    Camera
                                    <input
                                    type="file"
                                    accept="image/*"
                                    capture="environment"
                                    disabled={isUploading}
                                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                                    aria-label={`Capture ${field.label} from camera`}
                                    onChange={(event) => handleFileChange(template.id, field.key, event)}
                                    />
                                </label>
                            </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {(template.has_identify_number || template.has_expiry_date) ? (
                  <div className="space-y-4 pt-2">
                    {template.has_identify_number ? (
                      <div className="group rounded-[1.8rem] border-2 transition-all p-4 border-slate-50 bg-slate-50 focus-within:border-slate-900/10 focus-within:bg-white focus-within:shadow-xl focus-within:shadow-slate-900/5">
                        <div className="flex items-center gap-4">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-sm group-focus-within:bg-slate-900 group-focus-within:text-white transition-all">
                                <FileText size={20} strokeWidth={2.5} />
                            </div>
                            <div className="min-w-0 flex-1 space-y-0.5">
                                <label className="block text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 opacity-70">
                                    {formatMetaLabel(template.identify_number_key) || `${template.name} Number`}
                                </label>
                                <input
                                    type="text"
                                    value={documentMeta[template.id]?.identifyNumber || ''}
                                    onChange={(event) => handleMetaChange(template.id, 'identifyNumber', event.target.value.trim().toUpperCase())}
                                    placeholder={`Enter ${formatMetaLabel(template.identify_number_key) || 'Number'}`}
                                    className="w-full border-none bg-transparent p-0 text-lg font-black text-slate-900 outline-none focus:ring-0 placeholder:text-slate-200"
                                />
                            </div>
                        </div>
                      </div>
                    ) : null}

                    {template.has_expiry_date ? (
                      <div className="group rounded-[1.8rem] border-2 transition-all p-4 border-slate-50 bg-slate-50 focus-within:border-slate-900/10 focus-within:bg-white focus-within:shadow-xl focus-within:shadow-slate-900/5">
                        <div className="flex items-center gap-4">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-sm group-focus-within:bg-slate-900 group-focus-within:text-white transition-all">
                                <AlertCircle size={20} strokeWidth={2.5} />
                            </div>
                            <div className="min-w-0 flex-1 space-y-0.5">
                                <label className="block text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 opacity-70">
                                    Expiry Date
                                </label>
                                <input
                                    type="date"
                                    value={documentMeta[template.id]?.expiryDate || ''}
                                    onChange={(event) => handleMetaChange(template.id, 'expiryDate', event.target.value)}
                                    className="w-full border-none bg-transparent p-0 text-lg font-black text-slate-900 outline-none focus:ring-0"
                                />
                            </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ))
          )}
        </div>

        <div className="bg-white/40 backdrop-blur-sm p-5 rounded-[2rem] flex gap-4 mt-6 border border-white/50 shadow-sm">
          <div className="w-10 h-10 rounded-2xl bg-amber-100 flex items-center justify-center shrink-0">
            <AlertCircle size={20} className="text-amber-600" />
          </div>
          <p className="text-[12px] font-black text-amber-900/60 leading-relaxed uppercase tracking-tight">
            Choose Gallery or Camera for each document. Ensure all photos are well-lit and all text is clearly readable to avoid rejection.
          </p>
        </div>

        <div className="fixed bottom-0 left-0 right-0 p-8 bg-gradient-to-t from-slate-50 via-slate-50 to-transparent">
            <div className="mx-auto max-w-sm">
                <motion.button
                    whileHover={{ scale: 1.02, y: -2 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleSubmit}
                    disabled={loading || !isComplete}
                    className={`group flex h-16 w-full items-center justify-center gap-3 rounded-[1.8rem] text-[15px] font-black tracking-tight transition-all relative overflow-hidden ${
                        isComplete
                            ? 'bg-slate-900 text-white shadow-[0_20px_40px_rgba(0,0,0,0.2)] active:bg-black'
                            : 'pointer-events-none bg-slate-200 text-slate-400 shadow-none'
                    }`}
                >
                    {loading ? (
                        <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                        <>
                            <span className="relative z-10 uppercase tracking-widest">Review & Submit</span>
                            <ChevronRight size={18} strokeWidth={3} className="relative z-10 group-hover:translate-x-1 transition-transform" />
                        </>
                    )}
                </motion.button>
            </div>
        </div>
      </main>
    </div>
  );
};

export default StepDocuments;

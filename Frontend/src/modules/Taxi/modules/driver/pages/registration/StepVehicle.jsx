import React, { useEffect, useState } from 'react';
import {
    ArrowLeft,
    Car,
    ChevronRight,
    MapPin,
    ShieldCheck,
    Info
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useNavigate, useLocation } from 'react-router-dom';
import {
    getStoredDriverRegistrationSession,
    getDriverServiceLocations,
    saveDriverRegistrationSession,
    saveDriverVehicle,
    getDriverVehicleTypes,
    getDriverVehicleFieldTemplates,
} from '../../services/registrationService';

const VEHICLE_NUMBER_REGEX = /^[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{4}$/;
const getCurrentVehicleYear = () => new Date().getFullYear();
const normalizeVehicleNumber = (value = '') => String(value).replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 11);
const normalizePostalCode = (value = '') => String(value).replace(/\D/g, '').slice(0, 6);
const matchesVehicleFieldAccountType = (accountType, isOwner) => {
    const normalizedAccountType = String(accountType || 'individual').trim().toLowerCase();

    if (normalizedAccountType === 'both') {
        return true;
    }

    if (isOwner) {
        return normalizedAccountType === 'fleet_drivers' || normalizedAccountType === 'fleet drivers';
    }

    return normalizedAccountType === 'individual';
};
const normalizeServiceCategories = (value, registerFor = 'taxi') => {
    const rawValues = Array.isArray(value)
        ? value
        : typeof value === 'string'
            ? value.split(',')
            : [];

    const normalized = [...new Set(
        rawValues
            .map((item) => String(item || '').trim().toLowerCase())
            .flatMap((item) => item === 'both' ? ['taxi', 'outstation'] : item ? [item] : [])
            .filter((item) => ['taxi', 'outstation', 'delivery', 'pooling'].includes(item)),
    )];

    if (normalized.length > 0) {
        return normalized;
    }

    const fallback = String(registerFor || 'taxi').trim().toLowerCase();
    if (fallback === 'both') {
        return ['taxi', 'outstation'];
    }

    return ['taxi', 'outstation', 'delivery', 'pooling'].includes(fallback) ? [fallback] : ['taxi'];
};

const getPrimaryRegisterFor = (serviceCategories = [], fallback = 'taxi') => {
    const normalized = normalizeServiceCategories(serviceCategories, fallback);

    if (normalized.includes('taxi') && normalized.includes('outstation')) return 'both';
    if (normalized.includes('taxi')) return 'taxi';
    if (normalized.includes('outstation')) return 'outstation';
    if (normalized.includes('delivery')) return 'delivery';
    if (normalized.includes('pooling')) return 'pooling';

    return String(fallback || 'taxi').trim().toLowerCase() || 'taxi';
};

const defaultVehicleFieldConfigs = [
    { field_key: 'locationId', name: 'Operating City', account_type: 'both', is_required: true, active: true, sort_order: 10, placeholder: '', help_text: '' },
    { field_key: 'serviceCategories', name: 'Service Category', account_type: 'individual', is_required: true, active: true, sort_order: 20, placeholder: '', help_text: '' },
    { field_key: 'vehicleTypeId', name: 'Vehicle Type', account_type: 'individual', is_required: true, active: true, sort_order: 30, placeholder: '', help_text: 'Select the type of vehicle you drive.' },
    { field_key: 'make', name: 'Brand / Make', account_type: 'individual', is_required: true, active: true, sort_order: 40, placeholder: 'e.g. Maruti Suzuki', help_text: '' },
    { field_key: 'model', name: 'Model', account_type: 'individual', is_required: true, active: true, sort_order: 50, placeholder: 'Swift, Bolt', help_text: '' },
    { field_key: 'year', name: 'Year', account_type: 'individual', is_required: true, active: true, sort_order: 60, placeholder: String(getCurrentVehicleYear()), help_text: '' },
    { field_key: 'number', name: 'Plate Number', account_type: 'individual', is_required: true, active: true, sort_order: 70, placeholder: 'DL1RT1234', help_text: '' },
    { field_key: 'color', name: 'Exterior Color', account_type: 'individual', is_required: true, active: true, sort_order: 80, placeholder: 'e.g. White, Black', help_text: '' },
    { field_key: 'companyName', name: 'Company Name', account_type: 'fleet_drivers', is_required: true, active: true, sort_order: 30, placeholder: 'Legal Company Name', help_text: '' },
    { field_key: 'companyAddress', name: 'Company Address', account_type: 'fleet_drivers', is_required: true, active: true, sort_order: 40, placeholder: 'Business Address', help_text: '' },
    { field_key: 'city', name: 'City', account_type: 'fleet_drivers', is_required: true, active: true, sort_order: 50, placeholder: 'City', help_text: '' },
    { field_key: 'postalCode', name: 'Postal Code', account_type: 'fleet_drivers', is_required: true, active: true, sort_order: 60, placeholder: 'Pincode', help_text: '' },
    { field_key: 'taxNumber', name: 'Tax Number (GST/VAT)', account_type: 'fleet_drivers', is_required: true, active: true, sort_order: 70, placeholder: 'Tax Identification', help_text: '' },
];


const StepVehicle = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const session = {
        ...getStoredDriverRegistrationSession(),
        ...(location.state || {}),
    };
    const role = session.role || 'driver';
    const isOwner = role === 'owner';

    const [locations, setLocations] = useState([]);
    const [locationsLoading, setLocationsLoading] = useState(true);
    const [locationsError, setLocationsError] = useState('');

    const [vehicleTypes, setVehicleTypes] = useState([]);
    const [vehicleTypesLoading, setVehicleTypesLoading] = useState(false);
    const [vehicleFieldConfigs, setVehicleFieldConfigs] = useState(defaultVehicleFieldConfigs);

    const [formData, setFormData] = useState({
        registerFor: getPrimaryRegisterFor(session.serviceCategories || session.vehicleSession?.vehicle?.serviceCategories || [], session.registerFor || 'taxi'),
        serviceCategories: normalizeServiceCategories(session.serviceCategories || session.vehicleSession?.vehicle?.serviceCategories || [], session.registerFor || 'taxi'),
        locationId: session.locationId || '',
        vehicleTypeId: session.vehicleTypeId || '',
        make: session.make || '',
        model: session.model || '',
        year: session.year || '',
        number: session.number || '',
        color: session.color || '',
        // Company info for owners
        companyName: session.companyName || '',
        companyAddress: session.companyAddress || '',
        city: session.city || '',
        postalCode: session.postalCode || '',
        taxNumber: session.taxNumber || '',
        customFields: session.customFields || session.vehicleSession?.vehicle?.customFields || {},
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const trimmedModel = String(formData.model || '').trim();

    useEffect(() => {
        saveDriverRegistrationSession({
            ...session,
            ...formData,
        });
    }, [formData]);

    useEffect(() => {
        let active = true;

        const loadLocations = async () => {
            try {
                setLocationsLoading(true);
                setLocationsError('');

                const response = await getDriverServiceLocations();
                const results = response?.data?.results || response?.data || [];

                if (active) {
                    setLocations(Array.isArray(results) ? results : []);
                }
            } catch (err) {
                if (active) {
                    setLocationsError(err?.message || 'Unable to load service locations');
                    setLocations([]);
                }
            } finally {
                if (active) {
                    setLocationsLoading(false);
                }
            }
        };

        const loadVehicleTypes = async () => {
            try {
                setVehicleTypesLoading(true);
                const response = await getDriverVehicleTypes();
                const results = response?.data?.results || response?.data || [];
                if (active) {
                    setVehicleTypes(Array.isArray(results) ? results : []);
                }
            } catch (err) {
                console.error('Failed to load vehicle types:', err);
            } finally {
                if (active) {
                    setVehicleTypesLoading(false);
                }
            }
        };

        const loadVehicleFieldConfigs = async () => {
            try {
                const response = await getDriverVehicleFieldTemplates(isOwner ? 'owner' : 'driver');
                const results = response?.data?.results || response?.data?.data?.results || [];
                if (active && Array.isArray(results) && results.length > 0) {
                    setVehicleFieldConfigs(results);
                }
            } catch (err) {
                console.error('Failed to load vehicle field configs:', err);
            }
        };

        loadLocations();
        loadVehicleTypes();
        loadVehicleFieldConfigs();

        return () => {
            active = false;
        };
    }, []);

    const activeVehicleFields = vehicleFieldConfigs
        .filter((item) => item?.active !== false)
        .sort((a, b) => Number(a?.sort_order || 0) - Number(b?.sort_order || 0));

    const builtInVehicleFieldKeys = new Set([
        'locationId',
        'serviceCategories',
        'vehicleTypeId',
        'make',
        'model',
        'year',
        'number',
        'color',
        'companyName',
        'companyAddress',
        'city',
        'postalCode',
        'taxNumber',
    ]);

    const fieldConfigMap = activeVehicleFields.reduce((acc, item) => {
        acc[String(item.field_key || '').trim()] = item;
        return acc;
    }, {});

    const getFieldConfig = (key, fallback = {}) => ({
        name: fallback.name || '',
        placeholder: fallback.placeholder || '',
        help_text: fallback.help_text || '',
        is_required: fallback.is_required ?? true,
        ...fieldConfigMap[key],
    });

    const shouldShowField = (key, fallback = true) => {
        if (!fieldConfigMap[key]) return fallback;
        return fieldConfigMap[key].active !== false;
    };

    const isFieldRequired = (key, fallback = true) => {
        if (!fieldConfigMap[key]) return fallback;
        return fieldConfigMap[key].is_required !== false;
    };

    const isFilled = (value) => Array.isArray(value) ? value.length > 0 : Boolean(String(value || '').trim());
    const handleCustomFieldChange = (key, value) => {
        setFormData((previous) => ({
            ...previous,
            customFields: {
                ...(previous.customFields || {}),
                [key]: value,
            },
        }));
    };
    const customVehicleFields = activeVehicleFields.filter((item) => !builtInVehicleFieldKeys.has(String(item?.field_key || '').trim()));
    const visibleCustomVehicleFields = customVehicleFields.filter((item) =>
        matchesVehicleFieldAccountType(item?.account_type, isOwner),
    );

    const handleContinue = async () => {
        const required = isOwner
            ? ['locationId', 'companyName', 'companyAddress', 'city', 'postalCode', 'taxNumber'].filter((key) => isFieldRequired(key, true))
            : ['locationId', 'vehicleTypeId', 'make', 'model', 'year', 'number', 'color'].filter((key) => isFieldRequired(key, true));

        const missingCustomField = visibleCustomVehicleFields.find(
            (field) => field?.is_required !== false && !isFilled(formData.customFields?.[field.field_key]),
        );
        if (missingCustomField) {
            setError(`${missingCustomField.name || 'Additional field'} is required`);
            return;
        }

        if (required.every((key) => isFilled(formData[key]))) {
            if (isOwner) {
                if (isFilled(formData.postalCode) && !/^\d{6}$/.test(formData.postalCode)) {
                    setError('Postal code must be a 6 digit number');
                    return;
                }
            } else {
                const vehicleYear = Number(formData.year);
                const currentYear = getCurrentVehicleYear();
                const normalizedNumber = normalizeVehicleNumber(formData.number);

                if (isFilled(formData.year) && (!/^\d{4}$/.test(formData.year) || vehicleYear < 1980 || vehicleYear > currentYear)) {
                    setError(`Vehicle year must be between 1980 and ${currentYear}`);
                    return;
                }

                if (isFilled(normalizedNumber) && !VEHICLE_NUMBER_REGEX.test(normalizedNumber)) {
                    setError('Vehicle number must be in a valid Indian format, for example DL1RT1234 or MH12AB1234');
                    return;
                }

                if (isFilled(trimmedModel) && /^\d+$/.test(trimmedModel)) {
                    setError('Vehicle model cannot contain only numbers');
                    return;
                }
            }

            setLoading(true);
            setError('');

            try {
                const normalizedNumber = normalizeVehicleNumber(formData.number);
                const selectedServiceLocation = locations.find(
                    (item) => String(item._id || item.id) === String(formData.locationId)
                );

                const response = await saveDriverVehicle({
                    registrationId: session.registrationId,
                    phone: session.phone,
                    registerFor: formData.registerFor,
                    serviceCategories: formData.serviceCategories,
                    locationId: formData.locationId,
                    locationName: selectedServiceLocation?.name || selectedServiceLocation?.service_location_name || '',
                    serviceLocation: selectedServiceLocation || null,
                    vehicleTypeId: formData.vehicleTypeId,
                    make: formData.make,
                    model: formData.model,
                    year: formData.year,
                    number: normalizedNumber,
                    color: formData.color,
                    companyName: formData.companyName,
                    companyAddress: formData.companyAddress,
                    city: isOwner ? formData.city : selectedServiceLocation?.name || selectedServiceLocation?.service_location_name || formData.city,
                    postalCode: formData.postalCode,
                    taxNumber: formData.taxNumber,
                    customFields: formData.customFields,
                });

                const nextState = saveDriverRegistrationSession({
                    ...session,
                    ...formData,
                    number: normalizedNumber,
                    vehicleSession: response?.data?.session || null,
                });

                navigate('/taxi/driver/step-documents', { state: nextState });
            } catch (err) {
                setError(err?.message || 'Unable to save vehicle details');
            } finally {
                setLoading(false);
            }
        } else {
            setError(isOwner ? 'Please fill all required company information fields' : 'Please fill all required vehicle information fields');
        }
    };

    const locationField = getFieldConfig('locationId', { name: 'Operating City' });
    const vehicleTypeField = getFieldConfig('vehicleTypeId', { name: 'Vehicle Type', help_text: 'Select the type of vehicle you drive.' });
    const companyNameField = getFieldConfig('companyName', { name: 'Company Name', placeholder: 'Legal Company Name' });
    const companyAddressField = getFieldConfig('companyAddress', { name: 'Company Address', placeholder: 'Business Address' });
    const cityField = getFieldConfig('city', { name: 'City', placeholder: 'City' });
    const postalCodeField = getFieldConfig('postalCode', { name: 'Postal Code', placeholder: 'Pincode' });
    const taxNumberField = getFieldConfig('taxNumber', { name: 'Tax Number (GST/VAT)', placeholder: 'Tax Identification' });
    const makeField = getFieldConfig('make', { name: 'Brand / Make', placeholder: 'e.g. Maruti Suzuki' });
    const modelField = getFieldConfig('model', { name: 'Model', placeholder: 'Swift, Bolt' });
    const yearField = getFieldConfig('year', { name: 'Year', placeholder: String(getCurrentVehicleYear()) });
    const numberField = getFieldConfig('number', { name: 'Plate Number', placeholder: 'DL1RT1234' });
    const colorField = getFieldConfig('color', { name: 'Exterior Color', placeholder: 'e.g. White, Black' });
    const ownerHasVisibleFields = ['companyName', 'companyAddress', 'city', 'postalCode', 'taxNumber'].some((key) => shouldShowField(key, true));
    const driverHasTechnicalFields = ['make', 'model', 'year', 'number', 'color'].some((key) => shouldShowField(key, true));
    const canContinue = isOwner
        ? [
            !isFieldRequired('locationId', true) || isFilled(formData.locationId),
            !isFieldRequired('companyName', true) || isFilled(formData.companyName),
            !isFieldRequired('companyAddress', true) || isFilled(formData.companyAddress),
            !isFieldRequired('city', true) || isFilled(formData.city),
            !isFieldRequired('postalCode', true) || isFilled(formData.postalCode),
            !isFieldRequired('taxNumber', true) || isFilled(formData.taxNumber),
        ].every(Boolean)
        : [
            !isFieldRequired('locationId', true) || isFilled(formData.locationId),
            !isFieldRequired('vehicleTypeId', true) || isFilled(formData.vehicleTypeId),
            !isFieldRequired('make', true) || isFilled(formData.make),
            !isFieldRequired('model', true) || isFilled(formData.model),
            !isFieldRequired('year', true) || isFilled(formData.year),
            !isFieldRequired('number', true) || isFilled(formData.number),
            !isFieldRequired('color', true) || isFilled(formData.color),
        ].every(Boolean);
    const hasRequiredCustomFields = visibleCustomVehicleFields.every(
        (field) => field?.is_required === false || isFilled(formData.customFields?.[field.field_key]),
    );

    return (
        <div
            className="min-h-screen bg-[linear-gradient(180deg,#f6efe4_0%,#fcfaf6_28%,#ffffff_100%)] px-5 pb-32 pt-8 select-none overflow-x-hidden"
            style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}
        >
            <main className="mx-auto max-w-sm space-y-6">
                <header className="space-y-6">
                    <div className="flex items-center justify-between">
                        <motion.button
                            whileTap={{ scale: 0.9 }}
                            onClick={() => navigate('/taxi/driver/step-referral', { state: session })}
                            className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white border border-slate-100 text-slate-900 shadow-sm transition-all"
                        >
                            <ArrowLeft size={18} strokeWidth={2.5} />
                        </motion.button>
                        <div className="rounded-full bg-slate-900/5 px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.15em] text-slate-500 border border-slate-900/5">
                            Step 3 of 4
                        </div>
                    </div>

                    <section className="space-y-3">
                        <div className="flex items-center gap-3">
                            <div className="flex h-11 w-11 items-center justify-center rounded-[1.25rem] bg-slate-900 text-white shadow-xl shadow-slate-900/10">
                                <Car size={22} strokeWidth={2.5} />
                            </div>
                            <span className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400 opacity-60">
                                Vehicle Details
                            </span>
                        </div>
                        <h1 className="font-['Outfit'] text-[48px] font-black leading-[1] tracking-[-0.04em] text-slate-900">
                            {isOwner ? 'Fleet' : 'Vehicle'} <span className="text-slate-400">Setup</span>
                        </h1>
                        <p className="text-[15px] leading-relaxed text-slate-500 font-bold opacity-80 max-w-[28ch]">
                            {isOwner ? 'Setup your business profile to start managing your fleet.' : 'Tell us about the vehicle you\'ll be using for your services.'}
                        </p>
                    </section>
                </header>

                <div className="space-y-5">
                    <section className="space-y-5 rounded-[2.5rem] border border-slate-100 bg-white p-6 shadow-[0_10px_40px_rgba(0,0,0,0.04)]">
                        {shouldShowField('locationId', true) ? (
                            <div className="group rounded-[1.8rem] border-2 transition-all p-4 border-slate-50 bg-slate-50 focus-within:border-slate-900/10 focus-within:bg-white focus-within:shadow-xl focus-within:shadow-slate-900/5">
                                <div className="flex items-center gap-4">
                                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-sm group-focus-within:bg-slate-900 group-focus-within:text-white transition-all">
                                        <MapPin size={20} strokeWidth={2.5} />
                                    </div>
                                    <div className="min-w-0 flex-1 space-y-0.5 overflow-hidden">
                                        <label className="block text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 opacity-70">{locationField.name}</label>
                                        <select
                                            value={formData.locationId}
                                            onChange={(e) => {
                                                const nextLocationId = e.target.value;
                                                const selectedServiceLocation = locations.find(
                                                    (item) => String(item._id || item.id) === String(nextLocationId),
                                                );

                                                setFormData((p) => ({
                                                    ...p,
                                                    locationId: nextLocationId,
                                                    vehicleTypeId: '',
                                                    ...(isOwner
                                                        ? {
                                                            companyAddress: p.companyAddress || String(selectedServiceLocation?.address || '').trim(),
                                                            city:
                                                                p.city ||
                                                                String(
                                                                    selectedServiceLocation?.service_location_name ||
                                                                    selectedServiceLocation?.name ||
                                                                    '',
                                                                ).trim(),
                                                        }
                                                        : {}),
                                                }));
                                            }}
                                            disabled={locationsLoading || locations.length === 0}
                                            className="w-full bg-transparent border-none p-0 text-lg font-black text-slate-900 focus:outline-none focus:ring-0 appearance-none cursor-pointer disabled:opacity-50"
                                        >
                                            <option value="">{locationsLoading ? 'Loading...' : 'Select City'}</option>
                                            {locations.map(loc => (
                                                <option key={loc._id || loc.id} value={loc._id || loc.id}>
                                                    {loc.service_location_name || loc.name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        {isOwner ? (
                            <div className="space-y-3.5 animate-in fade-in slide-in-from-top-2 duration-300">
                                {ownerHasVisibleFields && shouldShowField('companyName', true) ? (
                                    <div className="group rounded-[1.8rem] border-2 transition-all p-4 border-slate-50 bg-slate-50 focus-within:border-slate-900/10 focus-within:bg-white focus-within:shadow-xl focus-within:shadow-slate-900/5">
                                        <label className="block text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 opacity-70 px-1 mb-1">{companyNameField.name}</label>
                                        <input
                                            value={formData.companyName}
                                            onChange={(e) => setFormData(p => ({ ...p, companyName: e.target.value }))}
                                            placeholder={companyNameField.placeholder || 'Legal Company Name'}
                                            className="w-full bg-transparent border-none p-0 text-lg font-black text-slate-900 focus:outline-none focus:ring-0 placeholder:text-slate-200"
                                        />
                                    </div>
                                ) : null}

                                {shouldShowField('companyAddress', true) ? (
                                    <div className="group rounded-[1.8rem] border-2 transition-all p-4 border-slate-50 bg-slate-50 focus-within:border-slate-900/10 focus-within:bg-white focus-within:shadow-xl focus-within:shadow-slate-900/5">
                                        <label className="block text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 opacity-70 px-1 mb-1">{companyAddressField.name}</label>
                                        <input
                                            value={formData.companyAddress}
                                            onChange={(e) => setFormData(p => ({ ...p, companyAddress: e.target.value }))}
                                            placeholder={companyAddressField.placeholder || 'Business Address'}
                                            className="w-full bg-transparent border-none p-0 text-lg font-black text-slate-900 focus:outline-none focus:ring-0 placeholder:text-slate-200"
                                        />
                                    </div>
                                ) : null}

                                <div className="grid grid-cols-2 gap-3">
                                    {shouldShowField('city', true) ? (
                                        <div className="group rounded-[1.8rem] border-2 transition-all p-4 border-slate-50 bg-slate-50 focus-within:border-slate-900/10 focus-within:bg-white focus-within:shadow-xl focus-within:shadow-slate-900/5">
                                            <label className="block text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 opacity-70 px-1 mb-1">{cityField.name}</label>
                                            <input
                                                value={formData.city}
                                                onChange={(e) => setFormData(p => ({ ...p, city: e.target.value }))}
                                                placeholder={cityField.placeholder || 'City'}
                                                className="w-full bg-transparent border-none p-0 text-lg font-black text-slate-900 focus:outline-none focus:ring-0 placeholder:text-slate-200"
                                            />
                                        </div>
                                    ) : null}
                                    {shouldShowField('postalCode', true) ? (
                                        <div className="group rounded-[1.8rem] border-2 transition-all p-4 border-slate-50 bg-slate-50 focus-within:border-slate-900/10 focus-within:bg-white focus-within:shadow-xl focus-within:shadow-slate-900/5">
                                            <label className="block text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 opacity-70 px-1 mb-1">{postalCodeField.name}</label>
                                            <input
                                                value={formData.postalCode}
                                                onChange={(e) => setFormData(p => ({ ...p, postalCode: normalizePostalCode(e.target.value) }))}
                                                placeholder={postalCodeField.placeholder || 'Pincode'}
                                                inputMode="numeric"
                                                maxLength={6}
                                                className="w-full bg-transparent border-none p-0 text-lg font-black text-slate-900 focus:outline-none focus:ring-0 placeholder:text-slate-200"
                                            />
                                        </div>
                                    ) : null}
                                </div>

                                {shouldShowField('taxNumber', true) ? (
                                    <div className="group rounded-[1.8rem] border-2 transition-all p-4 border-slate-50 bg-slate-50 focus-within:border-slate-900/10 focus-within:bg-white focus-within:shadow-xl focus-within:shadow-slate-900/5">
                                        <label className="block text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 opacity-70 px-1 mb-1">{taxNumberField.name}</label>
                                        <input
                                            value={formData.taxNumber}
                                            onChange={(e) => setFormData(p => ({ ...p, taxNumber: e.target.value.toUpperCase() }))}
                                            placeholder={taxNumberField.placeholder || 'Tax Identification'}
                                            className="w-full bg-transparent border-none p-0 text-lg font-black text-slate-900 focus:outline-none focus:ring-0 placeholder:text-slate-200 uppercase"
                                        />
                                    </div>
                                ) : null}
                            </div>
                        ) : (
                            <div className="space-y-5 animate-in fade-in slide-in-from-top-4 duration-500">
                                {shouldShowField('vehicleTypeId', true) && (
                                    <div className="space-y-4 pt-1">
                                        <div className="space-y-1 px-1">
                                            <h2 className="text-base font-semibold tracking-[-0.03em] text-slate-950">{vehicleTypeField.name}</h2>
                                            <p className="text-sm text-slate-500">
                                                {formData.locationId
                                                    ? (vehicleTypeField.help_text || 'Select the type of vehicle you drive.')
                                                    : 'Select a vehicle type now. Choosing your city later will refine availability if needed.'}
                                            </p>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            {vehicleTypesLoading ? (
                                                Array.from({ length: 4 }).map((_, i) => (
                                                    <div key={i} className="h-32 bg-slate-50/50 rounded-2xl animate-pulse" />
                                                ))
                                            ) : (
                                                vehicleTypes.map((type) => (
                                                    <button
                                                        key={type._id || type.id}
                                                        type="button"
                                                        onClick={() => setFormData(p => ({ ...p, vehicleTypeId: type._id || type.id }))}
                                                        className={`relative h-32 rounded-3xl border transition-all flex flex-col group overflow-hidden cursor-pointer touch-manipulation text-left ${formData.vehicleTypeId === (type._id || type.id)
                                                                ? 'border-slate-900 bg-slate-900/[0.02] ring-1 ring-slate-900/5'
                                                                : 'border-slate-100 bg-[#FCFCFB] hover:border-slate-200'
                                                            }`}
                                                    >
                                                        <div className="flex-1 flex items-center justify-center p-3">
                                                            {type.image || type.icon || type.map_icon ? (
                                                                <img
                                                                    src={type.image || type.icon || type.map_icon}
                                                                    alt={type.name}
                                                                    className="max-h-14 w-auto object-contain transition-transform duration-500"
                                                                />
                                                            ) : (
                                                                <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-300">
                                                                    <Car size={24} />
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className={`p-2.5 text-center transition-colors ${formData.vehicleTypeId === (type._id || type.id) ? 'bg-slate-900 text-white font-bold' : 'bg-white/50 text-slate-700 font-semibold'
                                                            }`}>
                                                            <span className="text-[11px] tracking-tight uppercase">{type.name || type.vehicle_type_name}</span>
                                                        </div>
                                                    </button>
                                                ))
                                            )}
                                        </div>
                                    </div>
                                )}

                                {driverHasTechnicalFields ? (
                                    <div className="space-y-5 pt-1">
                                        <div className="space-y-1 px-1">
                                            <h2 className="text-lg font-black tracking-tight text-slate-900">Technical Specs</h2>
                                            <p className="text-[12px] font-black text-slate-400 uppercase tracking-widest opacity-60">Verified from RC/Permit</p>
                                        </div>

                                        <div className="grid grid-cols-2 gap-3">
                                            {shouldShowField('make', true) ? (
                                                <div className="group rounded-[1.8rem] border-2 transition-all p-4 border-slate-50 bg-slate-50 focus-within:border-slate-900/10 focus-within:bg-white focus-within:shadow-xl focus-within:shadow-slate-900/5 col-span-2">
                                                    <label className="block text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 opacity-70 px-1 mb-1">{makeField.name}</label>
                                                    <input
                                                        value={formData.make}
                                                        onChange={(e) => setFormData(p => ({ ...p, make: e.target.value }))}
                                                        placeholder={makeField.placeholder || 'e.g. Maruti Suzuki'}
                                                        className="w-full bg-transparent border-none p-0 text-lg font-black text-slate-900 focus:outline-none focus:ring-0 placeholder:text-slate-200"
                                                    />
                                                </div>
                                            ) : null}

                                            {shouldShowField('model', true) ? (
                                                <div className="group rounded-[1.8rem] border-2 transition-all p-4 border-slate-50 bg-slate-50 focus-within:border-slate-900/10 focus-within:bg-white focus-within:shadow-xl focus-within:shadow-slate-900/5">
                                                    <label className="block text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 opacity-70 px-1 mb-1">{modelField.name}</label>
                                                    <input
                                                        value={formData.model}
                                                        onChange={(e) => setFormData(p => ({ ...p, model: e.target.value }))}
                                                        placeholder={modelField.placeholder || 'Swift, Bolt'}
                                                        className="w-full bg-transparent border-none p-0 text-lg font-black text-slate-900 focus:outline-none focus:ring-0 placeholder:text-slate-200"
                                                    />
                                                </div>
                                            ) : null}

                                            {shouldShowField('year', true) ? (
                                                <div className="group rounded-[1.8rem] border-2 transition-all p-4 border-slate-50 bg-slate-50 focus-within:border-slate-900/10 focus-within:bg-white focus-within:shadow-xl focus-within:shadow-slate-900/5">
                                                    <label className="block text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 opacity-70 px-1 mb-1">{yearField.name}</label>
                                                    <input
                                                        type="tel"
                                                        maxLength={4}
                                                        value={formData.year}
                                                        onChange={(e) => setFormData(p => ({ ...p, year: e.target.value.replace(/\D/g, '') }))}
                                                        placeholder={yearField.placeholder || String(getCurrentVehicleYear())}
                                                        className="w-full bg-transparent border-none p-0 text-lg font-black text-slate-900 focus:outline-none focus:ring-0 placeholder:text-slate-200"
                                                    />
                                                </div>
                                            ) : null}

                                            {shouldShowField('number', true) ? (
                                                <div className="group rounded-[1.8rem] border-2 transition-all p-4 border-slate-50 bg-slate-50 focus-within:border-slate-900/10 focus-within:bg-white focus-within:shadow-xl focus-within:shadow-slate-900/5 col-span-2">
                                                    <label className="block text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 opacity-70 px-1 mb-1">{numberField.name}</label>
                                                    <input
                                                        value={formData.number}
                                                        onChange={(e) => setFormData(p => ({ ...p, number: normalizeVehicleNumber(e.target.value) }))}
                                                        placeholder={numberField.placeholder || 'DL1RT1234'}
                                                        className="w-full bg-transparent border-none p-0 text-[16px] font-semibold text-slate-950 focus:outline-none focus:ring-0 placeholder:text-slate-300 uppercase tracking-widest"
                                                    />
                                                </div>
                                            ) : null}

                                            {shouldShowField('color', true) ? (
                                                <div className="group rounded-[1.8rem] border-2 transition-all p-4 border-slate-50 bg-slate-50 focus-within:border-slate-900/10 focus-within:bg-white focus-within:shadow-xl focus-within:shadow-slate-900/5 col-span-2">
                                                    <label className="block text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 opacity-70 px-1 mb-1">{colorField.name}</label>
                                                    <input
                                                        value={formData.color}
                                                        onChange={(e) => setFormData(p => ({ ...p, color: e.target.value }))}
                                                        placeholder={colorField.placeholder || 'e.g. White, Black'}
                                                        className="w-full bg-transparent border-none p-0 text-lg font-black text-slate-900 focus:outline-none focus:ring-0 placeholder:text-slate-200"
                                                    />
                                                </div>
                                            ) : null}
                                        </div>
                                    </div>
                                ) : null}

                                {visibleCustomVehicleFields.length > 0 ? (
                                    <div className="space-y-5 pt-1">
                                        <div className="space-y-1 px-1">
                                            <h2 className="text-lg font-black tracking-tight text-slate-900">Additional Details</h2>
                                            <p className="text-[12px] font-black text-slate-400 uppercase tracking-widest opacity-60">
                                                Configured from admin
                                            </p>
                                        </div>

                                        <div className="grid grid-cols-1 gap-3">
                                            {visibleCustomVehicleFields.map((field) => {
                                                const fieldKey = String(field.field_key || '').trim();
                                                const fieldType = String(field.field_type || 'text').trim().toLowerCase();
                                                const value = formData.customFields?.[fieldKey] || (fieldType === 'multi_select' ? [] : '');
                                                const optionList = Array.isArray(field.options) ? field.options : [];

                                                if (fieldType === 'textarea') {
                                                    return (
                                                        <div key={fieldKey} className="group rounded-[1.8rem] border-2 transition-all p-4 border-slate-50 bg-slate-50 focus-within:border-slate-900/10 focus-within:bg-white focus-within:shadow-xl focus-within:shadow-slate-900/5">
                                                            <label className="block text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 opacity-70 px-1 mb-1">{field.name}</label>
                                                            <textarea
                                                                value={value}
                                                                onChange={(event) => handleCustomFieldChange(fieldKey, event.target.value)}
                                                                placeholder={field.placeholder || ''}
                                                                rows={3}
                                                                className="w-full resize-none bg-transparent border-none p-0 text-lg font-black text-slate-900 focus:outline-none focus:ring-0 placeholder:text-slate-200"
                                                            />
                                                            {field.help_text ? <p className="mt-2 text-xs text-slate-400">{field.help_text}</p> : null}
                                                        </div>
                                                    );
                                                }

                                                if (fieldType === 'select') {
                                                    return (
                                                        <div key={fieldKey} className="group rounded-[1.8rem] border-2 transition-all p-4 border-slate-50 bg-slate-50 focus-within:border-slate-900/10 focus-within:bg-white focus-within:shadow-xl focus-within:shadow-slate-900/5">
                                                            <label className="block text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 opacity-70 px-1 mb-1">{field.name}</label>
                                                            <select
                                                                value={value}
                                                                onChange={(event) => handleCustomFieldChange(fieldKey, event.target.value)}
                                                                className="w-full bg-transparent border-none p-0 text-lg font-black text-slate-900 focus:outline-none focus:ring-0 appearance-none"
                                                            >
                                                                <option value="">{field.placeholder || `Select ${field.name}`}</option>
                                                                {optionList.map((option) => (
                                                                    <option key={option} value={option}>{option}</option>
                                                                ))}
                                                            </select>
                                                            {field.help_text ? <p className="mt-2 text-xs text-slate-400">{field.help_text}</p> : null}
                                                        </div>
                                                    );
                                                }

                                                if (fieldType === 'multi_select') {
                                                    const selectedValues = Array.isArray(value) ? value : [];
                                                    return (
                                                        <div key={fieldKey} className="space-y-3 rounded-[1.8rem] border-2 border-slate-50 bg-slate-50 p-4">
                                                            <div>
                                                                <label className="block text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 opacity-70 px-1 mb-1">{field.name}</label>
                                                                {field.help_text ? <p className="text-xs text-slate-400 px-1">{field.help_text}</p> : null}
                                                            </div>
                                                            <div className="flex flex-wrap gap-2">
                                                                {optionList.map((option) => {
                                                                    const selected = selectedValues.includes(option);
                                                                    return (
                                                                        <button
                                                                            key={option}
                                                                            type="button"
                                                                            onClick={() => {
                                                                                const nextValues = selected
                                                                                    ? selectedValues.filter((item) => item !== option)
                                                                                    : [...selectedValues, option];
                                                                                handleCustomFieldChange(fieldKey, nextValues);
                                                                            }}
                                                                            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${selected
                                                                                    ? 'bg-slate-900 text-white'
                                                                                    : 'bg-white text-slate-700 border border-slate-200'
                                                                                }`}
                                                                        >
                                                                            {option}
                                                                        </button>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    );
                                                }

                                                return (
                                                    <div key={fieldKey} className="group rounded-[1.8rem] border-2 transition-all p-4 border-slate-50 bg-slate-50 focus-within:border-slate-900/10 focus-within:bg-white focus-within:shadow-xl focus-within:shadow-slate-900/5">
                                                        <label className="block text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 opacity-70 px-1 mb-1">{field.name}</label>
                                                        <input
                                                            type={fieldType === 'number' ? 'tel' : 'text'}
                                                            value={value}
                                                            onChange={(event) => handleCustomFieldChange(
                                                                fieldKey,
                                                                fieldType === 'number'
                                                                    ? event.target.value.replace(/\D/g, '')
                                                                    : event.target.value,
                                                            )}
                                                            placeholder={field.placeholder || ''}
                                                            className="w-full bg-transparent border-none p-0 text-lg font-black text-slate-900 focus:outline-none focus:ring-0 placeholder:text-slate-200"
                                                        />
                                                        {field.help_text ? <p className="mt-2 text-xs text-slate-400">{field.help_text}</p> : null}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        )}
                    </section>
                </div>

                <div className="bg-blue-50/50 p-4 rounded-3xl flex gap-3 mt-4 border border-blue-100">
                    <Info size={18} className="text-blue-500 shrink-0" />
                    <p className="text-xs font-medium text-slate-600 leading-relaxed">
                        Your vehicle information will be visible to passengers for safety and identification.
                    </p>
                </div>

                {error && (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 shadow-[0_10px_30px_rgba(244,63,94,0.08)]">
                        {error}
                    </div>
                )}

                <div className="fixed bottom-0 left-0 right-0 p-8 bg-gradient-to-t from-slate-50 via-slate-50 to-transparent">
                    <div className="mx-auto max-w-sm">
                        <motion.button
                            whileHover={{ scale: 1.02, y: -2 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={handleContinue}
                            disabled={loading}
                            className={`group flex h-16 w-full items-center justify-center gap-3 rounded-[1.8rem] text-[15px] font-black tracking-tight transition-all relative overflow-hidden ${canContinue && hasRequiredCustomFields
                                    ? 'bg-slate-900 text-white shadow-[0_20px_40px_rgba(0,0,0,0.2)] active:bg-black'
                                    : 'pointer-events-none bg-slate-200 text-slate-400 shadow-none'
                                }`}
                        >
                            {loading ? (
                                <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                <>
                                    <span className="relative z-10 uppercase tracking-widest">Save & Continue</span>
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

export default StepVehicle;

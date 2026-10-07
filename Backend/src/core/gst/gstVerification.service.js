import { inspectGstin, normalizeGstin } from './gstin.js';
import { logger } from '../../utils/logger.js';

/**
 * GSTIN verification, pluggable by environment (SOW plan 6.4).
 *
 *   GST_VERIFY_PROVIDER   unset / "none"  -> offline only: format + checksum +
 *                                             embedded PAN + state code
 *                         "http"          -> GET GST_VERIFY_URL (with {gstin}
 *                                             replaced) for the taxpayer record
 *   GST_VERIFY_URL        e.g. https://gst.example.com/v1/taxpayer/{gstin}
 *   GST_VERIFY_API_KEY    sent as "Authorization: Bearer <key>", or in the
 *                         header named by GST_VERIFY_AUTH_HEADER (e.g. x-api-key)
 *   GST_VERIFY_TIMEOUT_MS default 8000
 *
 * The "http" adapter reads the GSTN public-search shape most Indian GST APIs
 * pass through (lgnm, tradeNam, sts, pradr.adr / pradr.addr) as well as the
 * common snake/camel variants, at the top level or under data/result. Another
 * vendor is one registerGstProvider() call.
 *
 * A provider that is down never blocks onboarding: the result is
 * status "error" with the offline checks still filled in, and admin review
 * shows it as unverified.
 *
 * Result (stored on the restaurant as gstVerification):
 *   status: verified | offline_valid | invalid | not_found | inactive | error
 *   provider, gstin, formatValid, checksumValid, stateCode, stateName, pan,
 *   legalName, tradeName, address, taxpayerStatus, mismatches[], checkedAt
 */

const providers = new Map();

export function registerGstProvider(name, impl) {
    providers.set(String(name).toLowerCase(), impl);
}

export const configuredGstProvider = () => String(process.env.GST_VERIFY_PROVIDER || 'none').trim().toLowerCase() || 'none';

const pick = (obj, paths) => {
    for (const path of paths) {
        const v = path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
        if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return undefined;
};

function addressFrom(raw) {
    if (!raw) return '';
    if (typeof raw === 'string') return raw.trim();
    if (typeof raw !== 'object') return '';
    const a = raw.addr || raw.adr || raw;
    if (typeof a === 'string') return a.trim();
    const parts = [a.bno, a.bnm, a.flno, a.st, a.loc, a.city, a.dst, a.stcd, a.pncd]
        .map((p) => (p === undefined || p === null ? '' : String(p).trim()))
        .filter(Boolean);
    return parts.join(', ');
}

/** Map a vendor response body to the fields we use. Exported for tests. */
export function mapTaxpayerRecord(body) {
    const root = body?.data?.data || body?.data?.result || body?.data || body?.result || body?.taxpayerInfo || body || {};
    const legalName = pick(root, ['lgnm', 'legal_name', 'legalName', 'legal_name_of_business', 'legalNameOfBusiness']);
    const tradeName = pick(root, ['tradeNam', 'trade_name', 'tradeName', 'trade_name_of_business']);
    const status = pick(root, ['sts', 'gstin_status', 'status', 'gstinStatus', 'taxpayer_status']);
    const rawAddress = pick(root, ['pradr', 'principal_address', 'principalAddress', 'address', 'adr']);
    return {
        found: Boolean(legalName || tradeName),
        legalName: legalName ? String(legalName).trim() : '',
        tradeName: tradeName ? String(tradeName).trim() : '',
        taxpayerStatus: status ? String(status).trim() : '',
        address: addressFrom(rawAddress),
    };
}

registerGstProvider('http', async (gstin) => {
    const template = String(process.env.GST_VERIFY_URL || '').trim();
    if (!template) throw new Error('GST_VERIFY_URL is not set');
    const url = template.includes('{gstin}') ? template.replace('{gstin}', encodeURIComponent(gstin)) : `${template.replace(/\/$/, '')}/${encodeURIComponent(gstin)}`;
    const key = String(process.env.GST_VERIFY_API_KEY || '').trim();
    const headerName = String(process.env.GST_VERIFY_AUTH_HEADER || '').trim();
    const headers = { Accept: 'application/json' };
    if (key) {
        if (headerName) headers[headerName] = key;
        else headers.Authorization = `Bearer ${key}`;
    }
    const timeout = Math.max(1000, Number(process.env.GST_VERIFY_TIMEOUT_MS) || 8000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const res = await fetch(url, { headers, signal: controller.signal });
        if (res.status === 404) return { found: false };
        if (!res.ok) throw new Error(`GST provider answered ${res.status}`);
        return mapTaxpayerRecord(await res.json());
    } finally {
        clearTimeout(timer);
    }
});

const comparable = (s) => String(s || '')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/\b(M\/S|MESSRS)\b/g, ' ')
    .replace(/\bPRIVATE\b/g, 'PVT')
    .replace(/\bLIMITED\b/g, 'LTD')
    .replace(/[^A-Z0-9]/g, '');

/** Same business name, give or take punctuation, case and Pvt/Private, Ltd/Limited. */
export function namesMatch(a, b) {
    const x = comparable(a);
    const y = comparable(b);
    if (!x || !y) return true;
    return x === y || x.includes(y) || y.includes(x);
}

const stateMatches = (provided, stateName) => {
    const x = comparable(provided);
    const y = comparable(stateName);
    if (!x || !y) return true;
    return x.includes(y) || y.includes(x) || (y === 'DELHI' && x.includes('DELHI'));
};

/**
 * Verify a GSTIN, and compare what the applicant typed with what is on record.
 *
 * @param {string} gstin
 * @param {object} [provided]  { legalName, address, panNumber, state }
 */
export async function verifyGstin(gstin, provided = {}) {
    const offline = inspectGstin(gstin);
    const provider = configuredGstProvider();
    const base = {
        ...offline,
        provider,
        legalName: '',
        tradeName: '',
        address: '',
        taxpayerStatus: '',
        mismatches: [],
        checkedAt: new Date(),
    };

    const mismatches = [];
    const providedPan = normalizeGstin(provided.panNumber);
    if (offline.formatValid && providedPan && providedPan !== offline.pan) {
        mismatches.push({ field: 'pan', provided: providedPan, registered: offline.pan, note: 'The PAN inside the GSTIN differs from the PAN given' });
    }
    if (offline.formatValid && provided.state && offline.stateName && !stateMatches(provided.state, offline.stateName)) {
        mismatches.push({ field: 'state', provided: String(provided.state), registered: offline.stateName, note: 'The GSTIN is registered in a different state' });
    }

    if (!offline.formatValid || !offline.checksumValid) {
        return {
            ...base,
            status: 'invalid',
            reason: !offline.formatValid ? 'GSTIN format is invalid' : 'GSTIN check character does not match (likely a typo)',
            mismatches,
        };
    }

    const impl = provider === 'none' ? null : providers.get(provider);
    if (!impl) {
        if (provider !== 'none') logger.warn(`GST_VERIFY_PROVIDER "${provider}" is not a known provider; using offline checks`);
        return { ...base, provider: 'none', status: 'offline_valid', mismatches };
    }

    let record;
    try {
        record = await impl(offline.gstin);
    } catch (err) {
        logger.warn(`GSTIN verification via ${provider} failed: ${err.message}`);
        return { ...base, status: 'error', reason: 'Verification service unavailable', mismatches };
    }
    if (!record || !record.found) {
        return { ...base, status: 'not_found', reason: 'No taxpayer is registered under this GSTIN', mismatches };
    }

    if (provided.legalName && !namesMatch(provided.legalName, record.legalName) && !namesMatch(provided.legalName, record.tradeName)) {
        mismatches.push({ field: 'legalName', provided: String(provided.legalName), registered: record.legalName || record.tradeName });
    }
    const inactive = record.taxpayerStatus && !/^active/i.test(record.taxpayerStatus);
    return {
        ...base,
        legalName: record.legalName,
        tradeName: record.tradeName,
        address: record.address,
        taxpayerStatus: record.taxpayerStatus,
        status: inactive ? 'inactive' : 'verified',
        reason: inactive ? `GSTIN status is "${record.taxpayerStatus}"` : undefined,
        mismatches,
    };
}

/** What admin review and the onboarding form show, without internal fields. */
export function publicVerification(v) {
    if (!v) return null;
    return {
        status: v.status,
        provider: v.provider,
        gstin: v.gstin,
        formatValid: v.formatValid,
        checksumValid: v.checksumValid,
        stateCode: v.stateCode,
        stateName: v.stateName,
        legalName: v.legalName || '',
        tradeName: v.tradeName || '',
        address: v.address || '',
        taxpayerStatus: v.taxpayerStatus || '',
        mismatches: v.mismatches || [],
        reason: v.reason || '',
        checkedAt: v.checkedAt,
    };
}

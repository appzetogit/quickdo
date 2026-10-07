/**
 * GSTIN structure checks that need no network.
 *
 *   27 AAPFU0939F 1 Z V
 *   |  |          | | +- check character (mod-36 Luhn variant over the first 14)
 *   |  |          | +--- always "Z" today
 *   |  |          +----- entity number for this PAN in this state (1-9, A-Z)
 *   |  +---------------- the holder's PAN
 *   +------------------- state code
 *
 * The format regex is the one the onboarding and admin forms already used;
 * the checksum catches the typo the regex cannot (one wrong character still
 * matches the pattern, but almost never the check character).
 */

export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export const GST_STATE_CODES = Object.freeze({
    '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
    '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
    '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur',
    '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
    '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
    '25': 'Daman and Diu', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra',
    '28': 'Andhra Pradesh', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala',
    '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands', '36': 'Telangana',
    '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory', '99': 'Centre Jurisdiction',
});

export const normalizeGstin = (value) => String(value || '').toUpperCase().replace(/[^0-9A-Z]/g, '');

/** The 15th character the first 14 require, or null if they contain a character outside 0-9A-Z. */
export function gstinCheckCharacter(first14) {
    const s = String(first14 || '').toUpperCase();
    if (s.length < 14) return null;
    let sum = 0;
    for (let i = 0; i < 14; i += 1) {
        const v = CHARSET.indexOf(s[i]);
        if (v < 0) return null;
        const product = v * (i % 2 === 0 ? 1 : 2);
        sum += Math.floor(product / 36) + (product % 36);
    }
    return CHARSET[(36 - (sum % 36)) % 36];
}

export function isGstinChecksumValid(gstin) {
    const g = normalizeGstin(gstin);
    if (g.length !== 15) return false;
    return gstinCheckCharacter(g.slice(0, 14)) === g[14];
}

/**
 * Everything knowable offline: format, checksum, state, embedded PAN.
 */
export function inspectGstin(value) {
    const gstin = normalizeGstin(value);
    const formatValid = GSTIN_REGEX.test(gstin);
    const stateCode = gstin.slice(0, 2);
    const stateName = GST_STATE_CODES[stateCode] || null;
    return {
        gstin,
        formatValid,
        checksumValid: formatValid && isGstinChecksumValid(gstin),
        stateCode: formatValid ? stateCode : null,
        stateName: formatValid ? stateName : null,
        knownState: formatValid && Boolean(stateName),
        pan: formatValid ? gstin.slice(2, 12) : null,
    };
}

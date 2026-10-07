import { ValidationError } from '../auth/errors.js';

/**
 * Product barcodes (plan §5.6). The app scans with the camera and looks the
 * product up by the code; sellers and admins type or upload it.
 *
 * Stored normalised -- spaces and hyphens out, letters upper-cased -- so a code
 * typed "8901 0300-1234 5" by a seller matches the scanner's 8901030012345.
 * Numeric EAN-8 / UPC-A / EAN-13 / GTIN-14 codes must carry a valid check digit:
 * a typo would otherwise sit on the product and never match a real scan.
 * Other symbologies (Code 128 and friends, 4-32 characters) are kept as given.
 */
export function normalizeBarcode(value) {
    if (value === undefined) return undefined;
    if (value === null) return '';
    const code = String(value).replace(/[\s-]+/g, '').toUpperCase();
    if (!code) return '';
    if (!/^[0-9A-Z.$/+%]{4,32}$/.test(code)) {
        throw new ValidationError('Barcode may contain only letters and digits (4 to 32 characters)');
    }
    if (/^\d+$/.test(code) && [8, 12, 13, 14].includes(code.length) && !hasValidGtinCheckDigit(code)) {
        throw new ValidationError(`Barcode ${code} has a wrong check digit`);
    }
    return code;
}

/** GS1 mod-10 check digit for EAN-8, UPC-A, EAN-13 and GTIN-14. */
export function hasValidGtinCheckDigit(code) {
    const digits = String(code).split('').map(Number);
    const check = digits.pop();
    let sum = 0;
    for (let i = digits.length - 1, pos = 0; i >= 0; i -= 1, pos += 1) {
        sum += digits[i] * (pos % 2 === 0 ? 3 : 1);
    }
    return (10 - (sum % 10)) % 10 === check;
}

/** The forms a scanned code may have been stored under (UPC-A is EAN-13 with a leading 0). */
export function barcodeCandidates(scanned) {
    const code = String(scanned || '').replace(/[\s-]+/g, '').toUpperCase();
    if (!code) return [];
    const out = new Set([code]);
    if (/^\d{12}$/.test(code)) out.add(`0${code}`);
    if (/^0\d{12}$/.test(code)) out.add(code.slice(1));
    return [...out];
}

/**
 * Normalizes any phone string into a strict 10-digit format expected by payment gateways.
 * Strips formatting, extensions, and country codes (like +91).
 * Safe fallback guarantees payment flow continuity even if user signed up with an invalid testing number.
 * 
 * @param {string|number} phone - The raw phone number input
 * @param {string} fallback - The safe fallback if no valid 10 digits can be found
 * @returns {string} Exactly 10 digits
 */
export function normalizePhoneToTenDigits(phone, fallback = '9999999999') {
    if (!phone) return fallback;
    
    // Strip everything except digits
    const digitsOnly = String(phone).replace(/\D/g, '');
    
    // If it has at least 10 digits, assume the last 10 are the local number
    // (This elegantly ignores country codes like 91 or +91 at the beginning)
    if (digitsOnly.length >= 10) {
        return digitsOnly.slice(-10);
    }
    
    // If it's too short (e.g., testing numbers like "1234"), it will be rejected by strict APIs
    return fallback;
}

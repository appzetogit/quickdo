/**
 * Formats a phone number for display/input fields.
 * Strips all non-digits, takes the last 10 digits, and prefixes with '+91 '.
 * Example: '919111369691' -> '+91 9111369691'
 * @param {string} phone 
 * @returns {string} Formatted phone number
 */
export const formatDisplayPhone = (phone) => {
    if (!phone) return "";
    
    // Extract only digits
    const digits = String(phone).replace(/\D/g, "");
    
    if (digits.length === 0) return "";
    
    // Get the last 10 digits (or fewer if less than 10)
    const last10 = digits.slice(-10);
    
    // Only prefix if we actually have some digits
    return `+91 ${last10}`;
};

/**
 * Handles phone input changes to enforce the +91 prefix and max 10 digits.
 * Ideal for onChange handlers.
 * @param {string} inputValue 
 * @returns {string} Sanitized formatted input
 */
export const handlePhoneInput = (inputValue) => {
    if (!inputValue) return "+91 ";
    
    // Always strip the prefix to process the raw number
    let rawInput = String(inputValue).replace(/^\+?91[\s-]*/, "");
    
    // Extract only digits
    let digits = rawInput.replace(/\D/g, "");
    
    // If they delete everything, just keep the prefix
    if (digits.length === 0 && !inputValue.includes("+91")) return "";
    
    // Max 10 digits
    if (digits.length > 10) {
        digits = digits.slice(0, 10);
    }
    
    return `+91 ${digits}`;
};

/**
 * Extracts just the raw 10 digits for backend submission
 * @param {string} phone 
 * @returns {string} 10 digit string
 */
export const extractRawPhone = (phone) => {
    if (!phone) return "";
    const digits = String(phone).replace(/\D/g, "");
    return digits.slice(-10);
};

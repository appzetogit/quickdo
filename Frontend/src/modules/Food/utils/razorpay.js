/**
 * Razorpay Payment Integration Utility
 * Handles Razorpay payment initialization and verification
 */

let razorpayLoaded = false;

/**
 * Load Razorpay checkout script
 */
export const loadRazorpayScript = () => {
  return new Promise((resolve, reject) => {
    if (razorpayLoaded || window.Razorpay) {
      razorpayLoaded = true;
      resolve();
      return;
    }
    
    // Check if script is already added but not yet loaded
    const existing = document.querySelector('script[src*="razorpay"]');
    if (existing) {
      existing.onload = () => {
        razorpayLoaded = true;
        resolve();
      };
      existing.onerror = () => reject(new Error('Failed to load Razorpay script'));
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    
    // Add timeout to prevent freeze
    const timeout = setTimeout(() => {
      reject(new Error('Razorpay script load timeout'));
    }, 10000);

    script.onload = () => {
      clearTimeout(timeout);
      razorpayLoaded = true;
      resolve();
    };
    script.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('Failed to load Razorpay script'));
    };
    document.body.appendChild(script);
  });
};

/**
 * Initialize Razorpay payment
 * @param {Object} options - Payment options
 * @param {String} options.key - Razorpay key ID
 * @param {String} options.amount - Amount in paise
 * @param {String} options.currency - Currency code
 * @param {String} options.order_id - Razorpay order ID
 * @param {String} options.name - Company/App name
 * @param {String} options.description - Payment description
 * @param {String} options.prefill.name - Customer name
 * @param {String} options.prefill.email - Customer email
 * @param {String} options.prefill.contact - Customer phone
 * @param {Object} options.notes - Additional notes
 * @param {Function} options.handler - Success callback
 * @param {Function} options.onError - Error callback
 * @param {Function} options.onClose - Close callback
 */
export const initRazorpayPayment = async (options) => {
  try {
    if (options.order_id?.startsWith('mock_order_')) {
      console.warn('⚠️ Bypassing Razorpay checkout due to mock order ID (development fallback)');
      if (options.handler) {
        setTimeout(() => {
          options.handler({
            razorpay_payment_id: `mock_pay_${Date.now()}`,
            razorpay_order_id: options.order_id,
            razorpay_signature: 'mock_signature_bypass'
          });
        }, 1000);
      }
      return { on: () => {}, open: () => {} };
    }

    // Load Razorpay script if not already loaded
    await loadRazorpayScript();

    if (!window.Razorpay) {
      throw new Error('Razorpay SDK not available');
    }

    const razorpayOptions = {
      key: options.key,
      amount: options.amount,
      currency: options.currency || 'INR',
      order_id: options.order_id,
      name: options.name || 'Quick Drop',
      description: options.description || 'Order Payment',
      image: options.image || '/k9-logo.jpg',
      prefill: {
        name: options.prefill?.name || '',
        email: options.prefill?.email || '',
        contact: options.prefill?.contact || ''
      },
      notes: options.notes || {},
      theme: {
        color: '#E23744'
      },
      handler: function(response) {
        if (options.handler) {
          options.handler(response);
        }
      },
      modal: {
        ondismiss: function() {
          if (options.onClose) {
            options.onClose();
          }
        },
        // Ensure modal is clickable
        escape: true,
        animation: true
      },
      // Ensure proper z-index
      retry: {
        enabled: true,
        max_count: 3
      }
    };

    const razorpay = new window.Razorpay(razorpayOptions);
    
    // Handle payment failures
    razorpay.on('payment.failed', function(response) {
      console.error('Razorpay payment failed:', response);
      if (options.onError) {
        options.onError(response.error || { description: 'Payment failed. Please try again.' });
      }
    });

    // Handle payment method selection failures
    razorpay.on('payment.method_selection_failed', function(response) {
      console.error('Razorpay payment method selection failed:', response);
      if (options.onError) {
        options.onError(response.error || { description: 'Please select another payment method.' });
      }
    });

    // Open Razorpay modal
    razorpay.open();
    
    console.log('✅ Razorpay checkout opened successfully');
    console.log('Razorpay options:', {
      key: razorpayOptions.key ? 'Present' : 'Missing',
      amount: razorpayOptions.amount,
      order_id: razorpayOptions.order_id
    });

    return razorpay;
  } catch (error) {
    console.error('Error initializing Razorpay:', error);
    if (options.onError) {
      options.onError(error);
    }
    throw error;
  }
};

/**
 * Format amount for display
 * @param {Number} amount - Amount in paise
 * @returns {String} Formatted amount string
 */
export const formatAmount = (amount) => {
  return `₹${(amount / 100).toFixed(2)}`;
};



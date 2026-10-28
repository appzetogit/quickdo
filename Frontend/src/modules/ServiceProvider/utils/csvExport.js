/**
 * Robust CSV Export Utility
 * Handles data validation, proper formatting for Indian business needs
 */

import { toast } from 'react-hot-toast';

/**
 * Format date to Indian standard (DD-MM-YYYY)
 */
export const formatDateIndian = (date) => {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  return `${d.getDate().toString().padStart(2, '0')}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getFullYear()}`;
};

/**
 * Format date with time (DD-MM-YYYY HH:MM)
 */
export const formatDateTimeIndian = (date) => {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  return `${formatDateIndian(date)} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
};

/**
 * Format currency to Indian format (X,XX,XXX.XX)
 */
export const formatCurrencyIndian = (amount) => {
  if (amount === null || amount === undefined) return '';
  const num = Number(amount);
  if (isNaN(num)) return '';
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(num);
};

/**
 * Format phone number with +91 prefix
 */
export const formatPhoneIndian = (phone) => {
  if (!phone) return '';
  const cleaned = phone.toString().replace(/\D/g, '');
  if (cleaned.length === 10) return `+91 ${cleaned}`;
  return phone;
};

/**
 * Get nested value from object using dot notation
 * e.g., getNestedValue(obj, 'user.name') returns obj.user.name
 */
const getNestedValue = (obj, path) => {
  if (!path) return obj;
  return path.split('.').reduce((current, key) => current?.[key], obj);
};

/**
 * Escape CSV value (handle quotes and special characters)
 */
const escapeCSVValue = (value) => {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // If contains comma, newline, or quote, wrap in quotes and escape existing quotes
  if (str.includes(',') || str.includes('\n') || str.includes('"')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

/**
 * Column configuration type
 * @typedef {Object} ColumnConfig
 * @property {string} key - The key path in data object (supports dot notation)
 * @property {string} label - Column header label
 * @property {('text'|'date'|'datetime'|'currency'|'phone'|'number')} [type='text'] - Data type for formatting
 * @property {function} [formatter] - Custom formatter function
 */

/**
 * Export data to CSV with validation and proper formatting
 * 
 * @param {Array} data - Array of objects to export
 * @param {string} filename - Filename without extension
 * @param {ColumnConfig[]} columns - Column configuration
 * @returns {boolean} - Success status
 */
export const exportToCSV = (data, filename, columns) => {
  // Validate data
  if (!data) {
    toast.error('No data available to export');
    return false;
  }

  if (!Array.isArray(data)) {
    toast.error('Invalid data format');
    return false;
  }

  if (data.length === 0) {
    toast.error('No records found to export');
    return false;
  }

  if (!columns || columns.length === 0) {
    toast.error('Column configuration missing');
    return false;
  }

  try {
    // Add BOM for Excel UTF-8 compatibility
    const BOM = '\uFEFF';

    // Build headers
    const headers = columns.map(col => escapeCSVValue(col.label)).join(',');

    // Build rows
    const rows = data.map(row => {
      return columns.map(col => {
        let value = getNestedValue(row, col.key);

        // Apply custom formatter if provided
        if (col.formatter && typeof col.formatter === 'function') {
          value = col.formatter(value, row);
        } else {
          // Apply type-based formatting
          switch (col.type) {
            case 'date':
              value = formatDateIndian(value);
              break;
            case 'datetime':
              value = formatDateTimeIndian(value);
              break;
            case 'currency':
              value = formatCurrencyIndian(value);
              break;
            case 'phone':
              value = formatPhoneIndian(value);
              break;
            case 'number':
              value = value !== null && value !== undefined ? Number(value) : '';
              break;
            default:
              // Keep as is
              break;
          }
        }

        return escapeCSVValue(value);
      }).join(',');
    }).join('\n');

    // Combine CSV content
    const csvContent = BOM + headers + '\n' + rows;

    // Create and trigger download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    // Generate filename with date
    const dateStr = formatDateIndian(new Date()).replace(/-/g, '');
    const fullFilename = `${filename}_${dateStr}.csv`;

    link.setAttribute('href', url);
    link.setAttribute('download', fullFilename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast.success(`Exported ${data.length} records successfully`);
    return true;
  } catch (error) {
    console.error('CSV Export Error:', error);
    toast.error('Failed to export data');
    return false;
  }
};

/**
 * Pre-defined column configurations for common exports
 */
export const CSV_COLUMNS = {
  bookings: [
    { key: 'bookingId', label: 'Booking ID' },
    { key: 'createdAt', label: 'Date', type: 'date' },
    { key: 'user.name', label: 'Customer Name' },
    { key: 'user.phone', label: 'Phone', type: 'phone' },
    { key: 'service.name', label: 'Service' },
    { key: 'vendor.businessName', label: 'Vendor' },
    { key: 'worker.name', label: 'Worker' },
    { key: 'status', label: 'Status' },
    { key: 'pricing.subtotal', label: 'Subtotal', type: 'currency' },
    { key: 'pricing.gst', label: 'GST', type: 'currency' },
    { key: 'pricing.total', label: 'Total', type: 'currency' },
    { key: 'paymentMethod', label: 'Payment Mode' },
    { key: 'paymentStatus', label: 'Payment Status' }
  ],

  payments: [
    { key: '_id', label: 'Transaction ID' },
    { key: 'createdAt', label: 'Date', type: 'datetime' },
    { key: 'type', label: 'Type' },
    { key: 'description', label: 'Description' },
    { key: 'amount', label: 'Amount', type: 'currency' },
    { key: 'status', label: 'Status' },
    { key: 'reference', label: 'Reference' }
  ],

  settlements: [
    { key: '_id', label: 'Settlement ID' },
    { key: 'createdAt', label: 'Date', type: 'date' },
    { key: 'vendor.businessName', label: 'Vendor' },
    { key: 'grossAmount', label: 'Gross Amount', type: 'currency' },
    { key: 'commission', label: 'Platform Fee', type: 'currency' },
    { key: 'netAmount', label: 'Net Payout', type: 'currency' },
    { key: 'paymentMode', label: 'Mode' },
    { key: 'utr', label: 'UTR/Reference' }
  ],

  users: [
    { key: 'name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone', type: 'phone' },
    { key: 'createdAt', label: 'Registered On', type: 'date' },
    { key: 'totalBookings', label: 'Total Bookings', type: 'number' },
    { key: 'totalSpent', label: 'Total Spent', type: 'currency' }
  ],

  vendors: [
    { key: 'businessName', label: 'Business Name' },
    { key: 'name', label: 'Owner Name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone', type: 'phone' },
    { key: 'status', label: 'Status' },
    { key: 'createdAt', label: 'Registered On', type: 'date' },
    { key: 'totalEarnings', label: 'Total Earnings', type: 'currency' },
    { key: 'wallet.dues', label: 'Current Dues', type: 'currency' }
  ],

  workers: [
    { key: 'name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone', type: 'phone' },
    { key: 'status', label: 'Status' },
    { key: 'createdAt', label: 'Registered On', type: 'date' },
    { key: 'totalJobs', label: 'Total Jobs', type: 'number' },
    { key: 'totalEarnings', label: 'Total Earnings', type: 'currency' }
  ],

  revenue: [
    { key: '_id', label: 'Period' },
    { key: 'revenue', label: 'Total Revenue', type: 'currency' },
    { key: 'commission', label: 'Commission Earned', type: 'currency' },
    { key: 'bookings', label: 'Bookings', type: 'number' }
  ]
};

export default exportToCSV;


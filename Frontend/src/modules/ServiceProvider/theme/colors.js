/**
 * Centralized Theme Colors Configuration
 * Separate themes for User and Vendor modules
 * Update colors here to change theme across entire app
 * 
 * Usage:
 * - User module: import { userTheme } from '../../../../theme'
 * - Vendor module: import { vendorTheme } from '../../../../theme'
 * - Worker module: import { workerTheme } from '../../../../theme'
 */

// Truliq LOGO Core Brand Colors
const brand = {
  teal: '#347989',
  yellow: '#D68F35',
  orange: '#BB5F36',
  gradient: 'linear-gradient(135deg, #347989 0%, #D68F35 50%, #BB5F36 100%)',
  conic: 'conic-gradient(from 0deg, #347989, #D68F35, #BB5F36, #347989)'
};

// User Theme Colors
const userTheme = {
  backgroundGradient: 'linear-gradient(180deg, #F0FDFA 0%, #F5FAFF 15%, #FFFFFF 30%)',
  gradient: brand.gradient,
  headerGradient: 'linear-gradient(135deg, #00a6a6 0%, #008a8a 50%, #006b6b 100%)',
  headerBg: '#EBF8FF',
  button: brand.teal,
  icon: brand.teal,
  cardShadow: '0 8px 16px -2px rgba(0, 166, 166, 0.15), 0 4px 8px -1px rgba(0, 166, 166, 0.1)',
  cardBorder: '1px solid rgba(0, 166, 166, 0.15)',
  brand: brand
};

// Vendor Theme Colors
const vendorTheme = {
  backgroundGradient: 'linear-gradient(to bottom, rgba(52, 121, 137, 0.03) 0%, rgba(187, 95, 54, 0.02) 10%, #ffffff 20%)',
  gradient: brand.gradient,
  headerGradient: brand.teal,
  button: brand.teal,
  icon: brand.teal,
  brand: brand
};

// Worker Theme Colors
const workerTheme = {
  backgroundGradient: 'linear-gradient(to bottom, rgba(52, 121, 137, 0.03) 0%, rgba(187, 95, 54, 0.02) 10%, #ffffff 20%)',
  gradient: brand.gradient,
  headerGradient: brand.teal,
  button: brand.teal,
  icon: brand.teal,
  brand: brand
};

// Default theme (for backward compatibility)
const themeColors = userTheme;

// Export all themes
export { userTheme, vendorTheme, workerTheme, brand };
export default themeColors;




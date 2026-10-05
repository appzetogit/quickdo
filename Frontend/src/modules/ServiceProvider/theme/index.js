/**
 * Theme Configuration Export
 * Import this file to use centralized theme colors
 */

import themeColors, { userTheme, vendorTheme, workerTheme } from './colors';

// Re-export all themes
export { themeColors, userTheme, vendorTheme, workerTheme };

// Helper functions for common theme usage
export const getThemeColor = (colorPath) => {
  const paths = colorPath.split('.');
  let value = themeColors;

  for (const path of paths) {
    value = value[path];
    if (value === undefined) {
      console.warn(`Theme color path "${colorPath}" not found`);
      return '#000000'; // Fallback to black
    }
  }

  return value;
};

// Common theme utilities
export const theme = {
  colors: themeColors,
  getColor: getThemeColor,
};

export default theme;



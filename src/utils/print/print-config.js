/**
 * Print configuration manager
 * Centralized print settings and profiles
 */

/**
 * Default print configurations
 */
export const DEFAULT_PRINT_CONFIG = {
  // Paper sizes
  slipPaperSize: 'A5',
  listPaperSize: 'A4',
  statisticsPaperSize: 'A4',
  
  // Margins (in mm)
  slipMargins: { top: 10, right: 10, bottom: 10, left: 10 },
  listMargins: { top: 12, right: 12, bottom: 12, left: 12 },
  statisticsMargins: { top: 12, right: 12, bottom: 12, left: 12 },
  
  // Window dimensions
  slipWindowSize: { width: 900, height: 700 },
  listWindowSize: { width: 1100, height: 800 },
  statisticsWindowSize: { width: 1100, height: 800 },
  
  // Fonts
  fontFamily: 'Arial, sans-serif',
  
  // Colors
  colors: {
    text: '#1f2937',
    border: '#d1d5db',
    lightBorder: '#e5e7eb',
    background: '#f3f4f6',
    label: '#6b7280'
  },
  
  // Features
  enableBarcode: true,
  enableWatermark: false,
  autoPrint: true
};

/**
 * Print profile definitions for different printer types
 */
export const PRINT_PROFILES = {
  labelPrinter: {
    paperSize: '4x6',
    margins: { top: 5, right: 5, bottom: 5, left: 5 },
    windowSize: { width: 600, height: 400 },
    fontSize: 12
  },
  slipPrinter: {
    paperSize: 'A5',
    margins: { top: 10, right: 10, bottom: 10, left: 10 },
    windowSize: { width: 900, height: 700 },
    fontSize: 14
  },
  documentPrinter: {
    paperSize: 'A4',
    margins: { top: 12, right: 12, bottom: 12, left: 12 },
    windowSize: { width: 1100, height: 800 },
    fontSize: 12
  }
};

/**
 * Get print configuration by key
 * @param {string} key - Configuration key
 * @returns {*} Configuration value
 */
export function getPrintConfig(key) {
  if (key in DEFAULT_PRINT_CONFIG) {
    return DEFAULT_PRINT_CONFIG[key];
  }
  return null;
}

/**
 * Get print profile by name
 * @param {string} profileName - Profile name (labelPrinter, slipPrinter, documentPrinter)
 * @returns {Object|null} Print profile or null if not found
 */
export function getPrintProfile(profileName) {
  if (profileName in PRINT_PROFILES) {
    return PRINT_PROFILES[profileName];
  }
  return null;
}

/**
 * Merge custom config with defaults
 * @param {Object} customConfig - Custom configuration to merge
 * @returns {Object} Merged configuration
 */
export function mergePrintConfig(customConfig) {
  return {
    ...DEFAULT_PRINT_CONFIG,
    ...customConfig
  };
}

/**
 * Validate print configuration
 * @param {Object} config - Configuration to validate
 * @returns {Object} Validation result
 */
export function validatePrintConfig(config) {
  const errors = [];
  
  if (!config) {
    return { isValid: false, errors: ['Configuration is required'] };
  }
  
  // Validate paper size
  if (config.paperSize && !['A4', 'A5', '4x6', 'Letter'].includes(config.paperSize)) {
    errors.push('Invalid paper size');
  }
  
  // Validate margins
  if (config.margins) {
    const marginKeys = ['top', 'right', 'bottom', 'left'];
    for (const key of marginKeys) {
      if (key in config.margins) {
        if (typeof config.margins[key] !== 'number' || config.margins[key] < 0) {
          errors.push(`Invalid margin value for ${key}`);
        }
      }
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

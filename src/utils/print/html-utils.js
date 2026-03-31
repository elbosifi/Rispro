/**
 * Print utility functions for HTML escaping and safety
 */

/**
 * Escape HTML special characters to prevent XSS attacks
 * @param {*} value - The value to escape
 * @returns {string} Escaped string safe for HTML insertion
 */
export function escapeHtml(value) {
  if (value === null || value === undefined) {
    return "";
  }
  
  const stringValue = String(value);
  
  return stringValue
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Validate that required print data fields are present
 * @param {Object} data - The data object to validate
 * @param {Array<string>} requiredFields - List of required field names
 * @returns {Object} Validation result with isValid boolean and errors array
 */
export function validatePrintData(data, requiredFields) {
  const errors = [];
  
  if (!data || typeof data !== 'object') {
    return {
      isValid: false,
      errors: ['Print data is required and must be an object']
    };
  }
  
  for (const field of requiredFields) {
    if (!(field in data)) {
      errors.push(`Missing required field: ${field}`);
    } else if (data[field] === null || data[field] === undefined) {
      errors.push(`Field '${field}' cannot be null or undefined`);
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Sanitize text content for safe printing
 * @param {string} text - The text to sanitize
 * @returns {string} Sanitized text
 */
export function sanitizeForPrint(text) {
  if (!text) return '';
  return escapeHtml(text).trim();
}

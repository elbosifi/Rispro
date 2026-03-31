/**
 * Barcode generation utilities for print slips
 */

import { escapeHtml } from './html-utils.js';

/**
 * Build Code39 barcode as SVG
 * @param {string} value - The value to encode in the barcode
 * @returns {string} SVG markup for the barcode
 */
export function buildCode39Svg(value) {
  if (!value) {
    return '';
  }

  const CODE39_MAP = {
    '0': '000110100',
    '1': '100100001',
    '2': '001100001',
    '3': '101100000',
    '4': '000110001',
    '5': '100110000',
    '6': '001110000',
    '7': '000100101',
    '8': '100100100',
    '9': '001100100',
    'A': '100001001',
    'B': '001001001',
    'C': '101001000',
    'D': '000011001',
    'E': '100011000',
    'F': '001011000',
    'G': '000001101',
    'H': '100001100',
    'I': '001001100',
    'J': '000011100',
    'K': '100000011',
    'L': '001000011',
    'M': '101000010',
    'N': '000010011',
    'O': '100010010',
    'P': '001010010',
    'Q': '000000111',
    'R': '100000110',
    'S': '001000110',
    'T': '000010110',
    'U': '110000001',
    'V': '011000001',
    'W': '111000000',
    'X': '010010001',
    'Y': '110010000',
    'Z': '011010000',
    '-': '010000101',
    '.': '110000100',
    ' ': '011000100',
    '$': '010101000',
    '/': '010100010',
    '+': '010001010',
    '%': '000101010',
    '*': '010010100' // Start/Stop character
  };

  const cleanValue = String(value).toUpperCase();
  const withStartStop = `*${cleanValue}*`;
  
  let bars = '';
  for (const char of withStartStop) {
    const pattern = CODE39_MAP[char];
    if (!pattern) {
      continue; // Skip unsupported characters
    }
    
    for (let i = 0; i < pattern.length; i++) {
      const width = pattern[i] === '1' ? 2 : 1;
      const color = i % 2 === 0 ? '#000' : '#fff';
      bars += `<rect x="${bars.length}" y="0" width="${width}" height="72" fill="${color}"/>`;
    }
    
    // Inter-character gap
    bars += `<rect x="${bars.length}" y="0" width="1" height="72" fill="#fff"/>`;
  }

  const x = bars.length > 0 ? bars.length : 100;
  const height = 72;

  return `<svg class="barcode-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.max(x, 1)} ${height}" role="img" aria-label="${escapeHtml(`Barcode ${cleanValue || '-'}`)}">${bars}</svg>`;
}

/**
 * Validate barcode input
 * @param {string} value - The value to validate
 * @returns {Object} Validation result
 */
export function validateBarcodeInput(value) {
  if (!value) {
    return {
      isValid: false,
      error: 'Barcode value is required'
    };
  }

  const stringValue = String(value);
  
  if (stringValue.length > 80) {
    return {
      isValid: false,
      error: 'Barcode value is too long (max 80 characters)'
    };
  }

  const supportedChars = /^[0-9A-Z\-\. \$\/\+\%]+$/;
  if (!supportedChars.test(stringValue.toUpperCase())) {
    return {
      isValid: false,
      error: 'Barcode contains unsupported characters'
    };
  }

  return {
    isValid: true,
    error: null
  };
}

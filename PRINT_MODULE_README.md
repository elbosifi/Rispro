# Print Module Refactoring - Implementation Guide

## Overview
This document describes the modular print architecture that has been implemented to improve the printing functionality in RISpro. The refactoring follows best practices for separation of concerns, testability, and maintainability.

## Architecture

### Module Structure
```
src/
├── utils/print/
│   ├── index.js              # Main export file
│   ├── html-utils.js         # HTML escaping and validation utilities
│   ├── barcode-generator.js  # Code39 barcode generation
│   └── print-config.js       # Configuration management
└── services/print/
    ├── index.js              # Service layer exports
    └── print-templates.js    # Template generation functions
```

## Key Improvements

### 1. Separation of Concerns
- **Utilities Layer** (`utils/print/`): Pure functions for HTML escaping, barcode generation, and configuration
- **Service Layer** (`services/print/`): Business logic for template generation
- **Frontend Integration**: Clean API for frontend to consume print services

### 2. Strategy Pattern Implementation
Different print types (slip, daily list, statistics) are handled by separate generator functions:
- `generateAppointmentSlipHtml()`
- `generateDailyListHtml()`
- `generateStatisticsHtml()`

### 3. Dependency Injection
All formatting functions are passed as parameters, allowing:
- Easy testing with mock formatters
- Custom formatting per use case
- No hard dependencies on global state

### 4. Security Enhancements
- All user input is escaped using `escapeHtml()` before insertion into HTML
- XSS prevention built into every template
- Input validation for barcode data

### 5. Configuration Management
Centralized print settings via `print-config.js`:
- Paper sizes (A4, A5, 4x6)
- Margins per document type
- Window dimensions
- Color schemes

## API Reference

### Utility Functions

#### `escapeHtml(value)`
Escapes HTML special characters to prevent XSS attacks.

```javascript
import { escapeHtml } from './utils/print/html-utils.js';
const safe = escapeHtml(userInput);
```

#### `buildCode39Svg(value)`
Generates a Code39 barcode as SVG markup.

```javascript
import { buildCode39Svg } from './utils/print/barcode-generator.js';
const barcode = buildCode39Svg('ABC123');
```

#### `validatePrintData(data, requiredFields)`
Validates that required fields are present in print data.

```javascript
import { validatePrintData } from './utils/print/html-utils.js';
const validation = validatePrintData(data, ['accessionNumber', 'patientName']);
```

### Service Functions

#### `buildAppointmentSlipData(source)`
Processes raw appointment data into slip format.

```javascript
import { buildAppointmentSlipData } from './services/print/index.js';
const slipData = buildAppointmentSlipData(appointment);
```

#### `generateAppointmentSlipHtml(slipData, translations, language, formatDisplayDateFn)`
Generates complete HTML for appointment slip printing.

```javascript
import { generateAppointmentSlipHtml } from './services/print/index.js';
const html = generateAppointmentSlipHtml(slipData, t, state.language, formatDisplayDate);
```

#### `generateDailyListHtml(appointments, title, translations, language, ...)`
Generates HTML for daily appointment lists.

#### `generateStatisticsHtml(snapshot, filters, translations, language, modalities, ...)`
Generates HTML for statistics reports.

## Migration Plan

### Phase 1: Foundation (Completed ✓)
- [x] Create utility modules
- [x] Implement barcode generator
- [x] Build configuration manager
- [x] Create template generators

### Phase 2: Frontend Integration (Next Steps)
1. Import new print services in `app.js`:
```javascript
import {
  buildAppointmentSlipData,
  generateAppointmentSlipHtml,
  generateDailyListHtml,
  generateStatisticsHtml,
  formatDisplayDate,
  formatExamName
} from './services/print/index.js';
```

2. Replace inline HTML generation in print functions:
```javascript
// Before: Inline template in openAppointmentSlipPrint()
// After: Use service function
function openAppointmentSlipPrint(source) {
  const slipData = buildAppointmentSlipData(source);
  if (!slipData) return;
  
  const html = generateAppointmentSlipHtml(
    slipData,
    t(),
    state.language,
    formatDisplayDate
  );
  
  const printWindow = window.open('', '_blank', 'width=900,height=700');
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}
```

### Phase 3: Testing
1. Unit tests for utility functions
2. Visual regression tests for templates
3. Integration tests for print workflows

### Phase 4: Cleanup
1. Remove old inline template code
2. Update documentation
3. Performance optimization

## Rollback Strategy

If issues arise during integration:
1. The new modules are additive - they don't modify existing code
2. Old print functions remain untouched until Phase 2
3. Simply don't import the new modules to rollback
4. Git can restore previous state if needed

## Benefits

1. **Testability**: Each function can be unit tested independently
2. **Maintainability**: Changes to print templates are isolated
3. **Reusability**: Utilities can be used across the application
4. **Security**: Consistent XSS prevention across all print outputs
5. **Extensibility**: New print types can be added easily
6. **Configuration**: Print settings are centralized and configurable

## Next Steps

To complete the integration:
1. Review the generated templates match current output
2. Test barcode rendering matches existing behavior
3. Gradually replace inline templates in `app.js`
4. Add comprehensive test coverage
5. Document any customizations needed

## Support

For questions or issues:
- Check JSDoc comments in each module
- Review test examples when available
- Consult the architecture documentation

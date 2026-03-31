/**
 * Print templates for different document types
 * Uses strategy pattern for different print formats
 */

import { escapeHtml } from '../../utils/print/html-utils.js';
import { buildCode39Svg } from '../../utils/print/barcode-generator.js';
import { getPrintConfig, DEFAULT_PRINT_CONFIG } from '../../utils/print/print-config.js';

/**
 * Base CSS styles for all print documents
 */
const BASE_CSS = `
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none !important; }
  }
`;

/**
 * Generate CSS for appointment slip
 */
function generateSlipCss() {
  const config = getPrintConfig('slipMargins');
  return `
    ${BASE_CSS}
    @page { size: A5 portrait; margin: ${config.top}mm ${config.right}mm ${config.bottom}mm ${config.left}mm; }
    body { font-family: Arial, sans-serif; margin: 0; color: #1f2937; }
    .sheet { width: 100%; border: 1px solid #d1d5db; border-radius: 12px; padding: 18px; box-sizing: border-box; }
    .top { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 18px; }
    .eyebrow { font-size: 12px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.08em; }
    .title { font-size: 28px; font-weight: 700; margin: 8px 0 4px; }
    .subtitle { color: #4b5563; font-size: 15px; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-bottom: 18px; }
    .card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px; }
    .card.full { grid-column: 1 / -1; }
    .label { font-size: 12px; color: #6b7280; margin-bottom: 6px; }
    .value { font-size: 16px; font-weight: 600; }
    .value.small { font-size: 14px; font-weight: 500; line-height: 1.5; }
    .barcode { margin-top: 24px; border: 1px dashed #9ca3af; border-radius: 10px; padding: 16px; text-align: center; }
    .barcode-lines { margin-bottom: 10px; background: #fff; padding: 6px; display: flex; justify-content: center; }
    .barcode-svg { display: block; height: 72px; width: min(540px, 100%); }
    .barcode-text { font-size: 18px; font-weight: 700; letter-spacing: 0.08em; }
    .footnote { margin-top: 10px; font-size: 11px; color: #6b7280; text-align: left; line-height: 1.45; }
  `;
}

/**
 * Generate CSS for daily/statistics lists
 */
function generateListCss() {
  const config = getPrintConfig('listMargins');
  return `
    ${BASE_CSS}
    @page { size: A4 portrait; margin: ${config.top}mm ${config.right}mm ${config.bottom}mm ${config.left}mm; }
    body { font-family: Arial, sans-serif; margin: 0; color: #1f2937; }
    .wrap { padding: 4mm 0; }
    .head { margin-bottom: 16px; }
    .title { font-size: 22px; font-weight: 700; }
    .meta { font-size: 12px; color: #4b5563; margin-top: 4px; }
    .table-wrapper { width: 100%; overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border: 1px solid #d1d5db; padding: 7px; text-align: left; vertical-align: top; }
    th { background: #f3f4f6; font-weight: 700; }
    .summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-bottom: 16px; }
    .card { border: 1px solid #d1d5db; border-radius: 8px; padding: 10px; }
    .card .label { color: #6b7280; font-size: 11px; margin-bottom: 6px; }
    .card .value { font-size: 18px; font-weight: 700; }
    h2 { margin: 20px 0 8px; font-size: 15px; }
  `;
}

/**
 * Build appointment slip template data
 * @param {Object} source - Source appointment data
 * @returns {Object|null} Processed slip data or null if invalid
 */
export function buildAppointmentSlipData(source) {
  if (!source || !source.accessionNumber) {
    return null;
  }

  return {
    accessionNumber: String(source.accessionNumber),
    patientArabicName: source.patientArabicName || '—',
    patientEnglishName: source.patientEnglishName || '—',
    appointmentDate: source.appointmentDate,
    modalityName: source.modalityName || '—',
    examName: source.examName || '—',
    modalityInstruction: source.modalityInstruction || '—',
    examInstruction: source.examInstruction || '—',
    notes: source.notes || '',
    registrationDate: source.registrationDate
  };
}

/**
 * Format date for display
 * @param {*} date - Date value to format
 * @returns {string} Formatted date string
 */
export function formatDisplayDate(date) {
  if (!date) return '—';
  try {
    return new Date(date).toLocaleDateString();
  } catch {
    return String(date);
  }
}

/**
 * Format exam name from appointment
 * @param {Object} appointment - Appointment object
 * @returns {string} Formatted exam name
 */
export function formatExamName(appointment) {
  return appointment.exam_name || appointment.exam_type || '—';
}

/**
 * Get appointment field label with language support
 * @param {string} key - Field key
 * @param {Object} translations - Translation functions/objects
 * @param {string} language - Current language code
 * @returns {string} Field label
 */
export function appointmentFieldLabel(key, translations, language) {
  if (language === 'ar' && ['modality', 'examType', 'priority', 'notes'].includes(key)) {
    return translations.en?.appointments?.fields?.[key] || translations.appointments?.fields?.[key] || key;
  }
  return translations.appointments?.fields?.[key] || key;
}

/**
 * Generate appointment slip HTML
 * @param {Object} slipData - Processed slip data
 * @param {Object} translations - Translation functions/objects
 * @param {string} language - Current language code
 * @param {Function} formatDisplayDateFn - Date formatting function
 * @returns {string} Complete HTML document
 */
export function generateAppointmentSlipHtml(slipData, translations, language, formatDisplayDateFn = formatDisplayDate) {
  const barcodeMarkup = buildCode39Svg(slipData.accessionNumber);
  const registrationDateLabel = language === 'ar' 
    ? 'تاريخ التسجيل (تاريخ حجز الموعد وليس تاريخ الفحص)'
    : 'Registration date (date the appointment was booked, not exam date)';

  const notesSection = slipData.notes
    ? `
      <div class="grid">
        <div class="card full">
          <div class="label">${escapeHtml(translations.appointments.fields.notes)}</div>
          <div class="value small">${escapeHtml(slipData.notes)}</div>
        </div>
      </div>`
    : '';

  return `
    <!doctype html>
    <html lang="${escapeHtml(language)}">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(slipData.accessionNumber)}</title>
        <style>${generateSlipCss()}</style>
      </head>
      <body>
        <div class="sheet">
          <div class="top">
            <div>
              <div class="eyebrow">${escapeHtml(translations.print.slipPreview)}</div>
              <div class="title">${escapeHtml(slipData.accessionNumber)}</div>
              <div class="subtitle">${escapeHtml(formatDisplayDateFn(slipData.appointmentDate))}</div>
            </div>
          </div>
          <div class="grid">
            <div class="card">
              <div class="label">${escapeHtml(translations.patients.fields.arabicFullName)}</div>
              <div class="value">${escapeHtml(slipData.patientArabicName)}</div>
            </div>
            <div class="card">
              <div class="label">${escapeHtml(translations.patients.fields.englishFullName)}</div>
              <div class="value">${escapeHtml(slipData.patientEnglishName)}</div>
            </div>
            <div class="card">
              <div class="label">${escapeHtml(translations.appointments.fields.appointmentDate)}</div>
              <div class="value">${escapeHtml(formatDisplayDateFn(slipData.appointmentDate))}</div>
            </div>
            <div class="card">
              <div class="label">${escapeHtml(appointmentFieldLabel('modality', translations, language))}</div>
              <div class="value">${escapeHtml(slipData.modalityName)}</div>
            </div>
            <div class="card">
              <div class="label">${escapeHtml(appointmentFieldLabel('examType', translations, language))}</div>
              <div class="value">${escapeHtml(slipData.examName)}</div>
            </div>
          </div>
          <div class="grid">
            <div class="card full">
              <div class="label">${escapeHtml(translations.print.fields.modalityInstructions)}</div>
              <div class="value small">${escapeHtml(slipData.modalityInstruction)}</div>
            </div>
            <div class="card full">
              <div class="label">${escapeHtml(translations.print.fields.examInstructions)}</div>
              <div class="value small">${escapeHtml(slipData.examInstruction)}</div>
            </div>
          </div>
          ${notesSection}
          <div class="barcode">
            <div class="label">${escapeHtml(translations.appointments.fields.accessionNumber)}</div>
            <div class="barcode-lines">${barcodeMarkup}</div>
            <div class="barcode-text">${escapeHtml(slipData.accessionNumber)}</div>
            <div class="footnote">${escapeHtml(`${registrationDateLabel}: ${formatDisplayDateFn(slipData.registrationDate)}`)}</div>
          </div>
        </div>
      </body>
    </html>
  `;
}

/**
 * Generate daily list HTML
 * @param {Array} appointments - List of appointments
 * @param {string} title - Document title
 * @param {Object} translations - Translation functions/objects
 * @param {string} language - Current language code
 * @param {Function} formatDisplayDateFn - Date formatting function
 * @param {Function} formatExamNameFn - Exam name formatting function
 * @returns {string} Complete HTML document
 */
export function generateDailyListHtml(appointments, title, translations, language, formatDisplayDateFn = formatDisplayDate, formatExamNameFn = formatExamName) {
  if (!appointments || appointments.length === 0) {
    throw new Error(language === 'ar' ? 'لا توجد مواعيد للطباعة.' : 'No appointments available to print.');
  }

  const tableRows = appointments
    .map((appointment) => `
      <tr>
        <td>${escapeHtml(appointment.accession_number || '')}</td>
        <td>${escapeHtml(appointment.arabic_full_name || '')}</td>
        <td>${escapeHtml(appointment.english_full_name || '')}</td>
        <td>${escapeHtml(formatExamNameFn(appointment))}</td>
        <td>${escapeHtml(formatDisplayDateFn(appointment.appointment_date))}</td>
        <td>${escapeHtml(appointment.status || '')}</td>
      </tr>
    `)
    .join('');

  return `
    <!doctype html>
    <html lang="${escapeHtml(language)}">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(title)}</title>
        <style>${generateListCss()}</style>
      </head>
      <body>
        <div class="wrap">
          <div class="head">
            <div class="title">${escapeHtml(title)}</div>
            <div class="meta">${escapeHtml(formatDisplayDateFn(new Date()))}</div>
          </div>
          <div class="table-wrapper">
            <table>
            <thead>
              <tr>
                <th>${escapeHtml(translations.appointments.fields.accessionNumber)}</th>
                <th>${escapeHtml(translations.patients.fields.arabicFullName)}</th>
                <th>${escapeHtml(translations.patients.fields.englishFullName)}</th>
                <th>${escapeHtml(appointmentFieldLabel('examType', translations, language))}</th>
                <th>${escapeHtml(translations.appointments.fields.appointmentDate)}</th>
                <th>${escapeHtml(translations.common.status)}</th>
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
            </table>
          </div>
        </div>
      </body>
    </html>
  `;
}

/**
 * Generate statistics report HTML
 * @param {Object} snapshot - Statistics snapshot data
 * @param {Object} filters - Applied filters
 * @param {Object} translations - Translation functions/objects
 * @param {string} language - Current language code
 * @param {Array} modalities - List of modalities for lookup
 * @param {Function} formatDisplayDateFn - Date formatting function
 * @param {Function} formatPercentFn - Percentage formatting function
 * @param {Function} formatModalityNameFn - Modality name formatting function
 * @returns {string} Complete HTML document
 */
export function generateStatisticsHtml(snapshot, filters, translations, language, modalities, formatDisplayDateFn = formatDisplayDate, formatPercentFn, formatModalityNameFn) {
  const summary = snapshot?.summary || {};
  const modalityBreakdown = snapshot?.modalityBreakdown || [];
  const statusBreakdown = snapshot?.statusBreakdown || [];
  const dailyBreakdown = snapshot?.dailyBreakdown || [];
  const totalAppointments = Number(summary.total_appointments || 0);

  if (!totalAppointments && !modalityBreakdown.length && !statusBreakdown.length && !dailyBreakdown.length) {
    throw new Error(language === 'ar' ? 'لا توجد إحصائيات للطباعة.' : 'No statistics available to print.');
  }

  const selectedModality = modalities?.find(
    (entry) => String(entry.id) === String(filters.modalityId || '')
  );
  const modalityLabel = selectedModality ? formatModalityNameFn(selectedModality) : translations.common.optional;
  const rangeText =
    filters.dateFrom || filters.dateTo
      ? `${filters.dateFrom || filters.dateTo} → ${filters.dateTo || filters.dateFrom}`
      : filters.date || '';

  const modalityRows = modalityBreakdown
    .map((entry) => {
      const total = Number(entry.total_count || 0);
      const noShowRate = formatPercentFn ? formatPercentFn(entry.no_show_count, total) : `${Math.round((entry.no_show_count / total) * 100) || 0}%`;
      return `
        <tr>
          <td>${escapeHtml(formatModalityNameFn(entry) || `#${entry.modality_id}`)}</td>
          <td>${escapeHtml(String(total))}</td>
          <td>${escapeHtml(String(entry.completed_count || 0))}</td>
          <td>${escapeHtml(noShowRate)}</td>
        </tr>
      `;
    })
    .join('');

  const statusRows = statusBreakdown
    .map(
      (entry) => {
        const pct = formatPercentFn ? formatPercentFn(entry.total_count, totalAppointments) : `${Math.round((entry.total_count / totalAppointments) * 100) || 0}%`;
        return `
        <tr>
          <td>${escapeHtml(entry.status || '')}</td>
          <td>${escapeHtml(String(entry.total_count || 0))}</td>
          <td>${escapeHtml(pct)}</td>
        </tr>
      `;
      }
    )
    .join('');

  const dailyRows = dailyBreakdown
    .map((entry) => {
      const total = Number(entry.total_count || 0);
      const noShowRate = formatPercentFn ? formatPercentFn(entry.no_show_count, total) : `${Math.round((entry.no_show_count / total) * 100) || 0}%`;
      return `
        <tr>
          <td>${escapeHtml(String(entry.appointment_date || ''))}</td>
          <td>${escapeHtml(String(total))}</td>
          <td>${escapeHtml(String(entry.completed_count || 0))}</td>
          <td>${escapeHtml(noShowRate)}</td>
        </tr>
      `;
    })
    .join('');

  return `
    <!doctype html>
    <html lang="${escapeHtml(language)}">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(translations.statistics.title)}</title>
        <style>${generateListCss()}</style>
      </head>
      <body>
        <div class="wrap">
          <div class="head">
            <div class="title">${escapeHtml(translations.statistics.title)}</div>
            <div class="meta">${escapeHtml(`${translations.print.date}: ${rangeText || '—'}`)}</div>
            <div class="meta">${escapeHtml(`${translations.statistics.modality}: ${modalityLabel}`)}</div>
          </div>

          <div class="summary">
            <div class="card">
              <div class="label">${escapeHtml(translations.statistics.totalAppointments)}</div>
              <div class="value">${escapeHtml(String(totalAppointments))}</div>
            </div>
            <div class="card">
              <div class="label">${escapeHtml(translations.statistics.uniquePatients)}</div>
              <div class="value">${escapeHtml(String(summary.unique_patients || 0))}</div>
            </div>
            <div class="card">
              <div class="label">${escapeHtml(translations.statistics.noShowRate)}</div>
              <div class="value">${escapeHtml(formatPercentFn ? formatPercentFn(summary.no_show_count, totalAppointments) : `${Math.round((summary.no_show_count / totalAppointments) * 100) || 0}%`)}</div>
            </div>
          </div>

          <h2>${escapeHtml(translations.statistics.byModalityTitle)}</h2>
          <div class="table-wrapper">
            <table>
            <thead>
              <tr>
                <th>${escapeHtml(translations.statistics.modality)}</th>
                <th>${escapeHtml(translations.statistics.totalAppointments)}</th>
                <th>${escapeHtml(translations.statistics.completed)}</th>
                <th>${escapeHtml(translations.statistics.noShowRate)}</th>
              </tr>
            </thead>
            <tbody>${modalityRows || `<tr><td colspan="4">${escapeHtml(translations.common.noData)}</td></tr>`}</tbody>
            </table>
          </div>

          <h2>${escapeHtml(translations.statistics.byStatusTitle)}</h2>
          <div class="table-wrapper">
            <table>
            <thead>
              <tr>
                <th>${escapeHtml(translations.common.status)}</th>
                <th>${escapeHtml(translations.statistics.totalAppointments)}</th>
                <th>${escapeHtml(translations.statistics.percentage)}</th>
              </tr>
            </thead>
            <tbody>${statusRows || `<tr><td colspan="3">${escapeHtml(translations.common.noData)}</td></tr>`}</tbody>
            </table>
          </div>

          <h2>${escapeHtml(translations.statistics.byDayTitle)}</h2>
          <div class="table-wrapper">
            <table>
            <thead>
              <tr>
                <th>${escapeHtml(translations.print.date)}</th>
                <th>${escapeHtml(translations.statistics.totalAppointments)}</th>
                <th>${escapeHtml(translations.statistics.completed)}</th>
                <th>${escapeHtml(translations.statistics.noShowRate)}</th>
              </tr>
            </thead>
            <tbody>${dailyRows || `<tr><td colspan="4">${escapeHtml(translations.common.noData)}</td></tr>`}</tbody>
            </table>
          </div>
        </div>
      </body>
    </html>
  `;
}

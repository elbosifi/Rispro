/**
 * Print templates for generating HTML print output
 * Uses strategy pattern for different print types
 */

/**
 * Generate appointment slip HTML
 * @param {object} slip - Appointment slip data
 * @param {string} language - Current language (ar/en)
 * @returns {string} HTML string
 */
function generateAppointmentSlipHtml(slip, language) {
  const patientArabic = slip.patientArabicName || "—";
  const patientEnglish = slip.patientEnglishName || "—";
  const modalityInstruction = slip.modalityInstruction || "—";
  const examInstruction = slip.examInstruction || "—";
  const registrationDate = slip.registrationDate ? formatDisplayDate(slip.registrationDate) : "—";
  const registrationDateLabel =
    language === "ar"
      ? "تاريخ التسجيل (تاريخ حجز الموعد وليس تاريخ الفحص)"
      : "Registration date (date the appointment was booked, not exam date)";
  const barcodeMarkup = buildCode39Svg(slip.accessionNumber);

  return `
    <!doctype html>
    <html lang="${escapeHtml(language)}">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(slip.accessionNumber)}</title>
        <style>
          @page { size: A5 portrait; margin: 10mm; }
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
          @media print {
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          }
        </style>
      </head>
      <body>
        <div class="sheet">
          <div class="top">
            <div>
              <div class="eyebrow">${escapeHtml(t().print.slipPreview)}</div>
              <div class="title">${escapeHtml(slip.accessionNumber)}</div>
              <div class="subtitle">${escapeHtml(formatDisplayDate(slip.appointmentDate))}</div>
            </div>
          </div>
          <div class="grid">
            <div class="card">
              <div class="label">${escapeHtml(t().patients.fields.arabicFullName)}</div>
              <div class="value">${escapeHtml(patientArabic)}</div>
            </div>
            <div class="card">
              <div class="label">${escapeHtml(t().patients.fields.englishFullName)}</div>
              <div class="value">${escapeHtml(patientEnglish)}</div>
            </div>
            <div class="card">
              <div class="label">${escapeHtml(t().appointments.fields.appointmentDate)}</div>
              <div class="value">${escapeHtml(formatDisplayDate(slip.appointmentDate))}</div>
            </div>
            <div class="card">
              <div class="label">${escapeHtml(appointmentFieldLabel("modality"))}</div>
              <div class="value">${escapeHtml(slip.modalityName)}</div>
            </div>
            <div class="card">
              <div class="label">${escapeHtml(appointmentFieldLabel("examType"))}</div>
              <div class="value">${escapeHtml(slip.examName)}</div>
            </div>
          </div>
          <div class="grid">
            <div class="card full">
              <div class="label">${escapeHtml(t().print.fields.modalityInstructions)}</div>
              <div class="value small">${escapeHtml(modalityInstruction)}</div>
            </div>
            <div class="card full">
              <div class="label">${escapeHtml(t().print.fields.examInstructions)}</div>
              <div class="value small">${escapeHtml(examInstruction)}</div>
            </div>
          </div>
          ${
            slip.notes
              ? `
          <div class="grid">
            <div class="card full">
              <div class="label">${escapeHtml(appointmentFieldLabel("notes"))}</div>
              <div class="value small">${escapeHtml(slip.notes)}</div>
            </div>
          </div>`
              : ""
          }
          <div class="barcode">
            <div class="label">${escapeHtml(t().appointments.fields.accessionNumber)}</div>
            <div class="barcode-lines">${barcodeMarkup}</div>
            <div class="barcode-text">${escapeHtml(slip.accessionNumber)}</div>
            <div class="footnote">${escapeHtml(`${registrationDateLabel}: ${registrationDate}`)}</div>
          </div>
        </div>
      </body>
    </html>
  `;
}

/**
 * Generate daily list HTML
 * @param {array} appointments - List of appointments
 * @param {string} title - Report title
 * @param {string} language - Current language
 * @returns {string} HTML string
 */
function generateDailyListHtml(appointments, title, language) {
  const tableRows = appointments
    .map(
      (appointment) => `
        <tr>
          <td>${escapeHtml(appointment.accession_number || "")}</td>
          <td>${escapeHtml(appointment.arabic_full_name || "")}</td>
          <td>${escapeHtml(appointment.english_full_name || "")}</td>
          <td>${escapeHtml(formatExamName(appointment))}</td>
          <td>${escapeHtml(formatDisplayDate(appointment.appointment_date))}</td>
          <td>${escapeHtml(appointment.status || "")}</td>
        </tr>
      `
    )
    .join("");

  return `
    <!doctype html>
    <html lang="${escapeHtml(language)}">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(title)}</title>
        <style>
          @page { size: A4 portrait; margin: 12mm; }
          body { font-family: Arial, sans-serif; margin: 0; color: #1f2937; }
          .wrap { padding: 4mm 0; }
          .head { margin-bottom: 12px; }
          .title { font-size: 22px; font-weight: 700; }
          .meta { font-size: 12px; color: #4b5563; margin-top: 4px; }
          .table-wrapper { width: 100%; overflow-x: auto; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th, td { border: 1px solid #d1d5db; padding: 7px; text-align: left; vertical-align: top; }
          th { background: #f3f4f6; font-weight: 700; }
          @media print {
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          }
        </style>
      </head>
      <body>
        <div class="wrap">
          <div class="head">
            <div class="title">${escapeHtml(title)}</div>
            <div class="meta">${escapeHtml(formatDisplayDate(new Date()))}</div>
          </div>
          <div class="table-wrapper">
            <table>
            <thead>
              <tr>
                <th>${escapeHtml(t().appointments.fields.accessionNumber)}</th>
                <th>${escapeHtml(t().patients.fields.arabicFullName)}</th>
                <th>${escapeHtml(t().patients.fields.englishFullName)}</th>
                <th>${escapeHtml(appointmentFieldLabel("examType"))}</th>
                <th>${escapeHtml(t().appointments.fields.appointmentDate)}</th>
                <th>${escapeHtml(t().common.status)}</th>
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
 * @param {object} snapshot - Statistics snapshot
 * @param {object} filters - Applied filters
 * @param {string} language - Current language
 * @returns {string} HTML string
 */
function generateStatisticsHtml(snapshot, filters = {}, language) {
  const summary = snapshot?.summary || {};
  const modalityBreakdown = snapshot?.modalityBreakdown || [];
  const statusBreakdown = snapshot?.statusBreakdown || [];
  const dailyBreakdown = snapshot?.dailyBreakdown || [];
  const totalAppointments = Number(summary.total_appointments || 0);

  const filterText = Object.entries(filters)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}: ${value}`)
    .join(" | ");

  const modalityRows = modalityBreakdown
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.modality_name || "—")}</td>
          <td>${escapeHtml(item.count || 0)}</td>
          <td>${escapeHtml(item.percentage || "0%")}</td>
        </tr>
      `
    )
    .join("");

  const statusRows = statusBreakdown
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.status || "—")}</td>
          <td>${escapeHtml(item.count || 0)}</td>
          <td>${escapeHtml(item.percentage || "0%")}</td>
        </tr>
      `
    )
    .join("");

  const dailyRows = dailyBreakdown
    .map(
      (entry) => `
        <tr>
          <td>${escapeHtml(normalizeDateText(entry.appointment_date))}</td>
          <td>${escapeHtml(entry.count || 0)}</td>
        </tr>
      `
    )
    .join("");

  return `
    <!doctype html>
    <html lang="${escapeHtml(language)}">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(t().reports.statistics)}</title>
        <style>
          @page { size: A4 portrait; margin: 12mm; }
          body { font-family: Arial, sans-serif; margin: 0; color: #1f2937; }
          .wrap { padding: 4mm 0; }
          .head { margin-bottom: 16px; }
          .title { font-size: 22px; font-weight: 700; }
          .filters { font-size: 11px; color: #6b7280; margin-top: 6px; }
          .summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 20px; }
          .summary-card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; text-align: center; }
          .summary-value { font-size: 24px; font-weight: 700; color: #111827; }
          .summary-label { font-size: 11px; color: #6b7280; margin-top: 4px; text-transform: uppercase; }
          .section { margin-bottom: 20px; }
          .section-title { font-size: 16px; font-weight: 600; margin-bottom: 8px; color: #374151; }
          table { width: 100%; border-collapse: collapse; font-size: 11px; }
          th, td { border: 1px solid #d1d5db; padding: 6px; text-align: left; }
          th { background: #f3f4f6; font-weight: 600; }
          @media print {
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          }
        </style>
      </head>
      <body>
        <div class="wrap">
          <div class="head">
            <div class="title">${escapeHtml(t().reports.statistics)}</div>
            ${filterText ? `<div class="filters">${escapeHtml(filterText)}</div>` : ""}
          </div>
          
          <div class="summary">
            <div class="summary-card">
              <div class="summary-value">${escapeHtml(totalAppointments)}</div>
              <div class="summary-label">${escapeHtml(t().common.total)}</div>
            </div>
            <div class="summary-card">
              <div class="summary-value">${escapeHtml(summary.completed_count || 0)}</div>
              <div class="summary-label">${escapeHtml(t().common.completed)}</div>
            </div>
            <div class="summary-card">
              <div class="summary-value">${escapeHtml(summary.pending_count || 0)}</div>
              <div class="summary-label">${escapeHtml(t().common.pending)}</div>
            </div>
          </div>

          ${modalityBreakdown.length ? `
          <div class="section">
            <div class="section-title">${escapeHtml(t().modalities.title)}</div>
            <table>
              <thead>
                <tr>
                  <th>${escapeHtml(t().common.name)}</th>
                  <th>${escapeHtml(t().common.count)}</th>
                  <th>${escapeHtml(t().common.percentage)}</th>
                </tr>
              </thead>
              <tbody>${modalityRows}</tbody>
            </table>
          </div>
          ` : ""}

          ${statusBreakdown.length ? `
          <div class="section">
            <div class="section-title">${escapeHtml(t().common.status)}</div>
            <table>
              <thead>
                <tr>
                  <th>${escapeHtml(t().common.status)}</th>
                  <th>${escapeHtml(t().common.count)}</th>
                  <th>${escapeHtml(t().common.percentage)}</th>
                </tr>
              </thead>
              <tbody>${statusRows}</tbody>
            </table>
          </div>
          ` : ""}

          ${dailyBreakdown.length ? `
          <div class="section">
            <div class="section-title">${escapeHtml(t().common.daily)}</div>
            <table>
              <thead>
                <tr>
                  <th>${escapeHtml(t().appointments.fields.appointmentDate)}</th>
                  <th>${escapeHtml(t().common.count)}</th>
                </tr>
              </thead>
              <tbody>${dailyRows}</tbody>
            </table>
          </div>
          ` : ""}
        </div>
      </body>
    </html>
  `;
}

// Export for use in app.js
window.PrintTemplates = {
  generateAppointmentSlipHtml,
  generateDailyListHtml,
  generateStatisticsHtml
};

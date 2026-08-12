import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildReportCenterHtml, parseReportCenterRenderModel } from "./report-center-pdf-service.js";

const base = {
  templateId: "daily-appointments",
  source: "appointments",
  orientation: "landscape",
  title: "Daily appointments",
  dateLabel: "2026-08-07",
  columns: [{ key: "patient", label: "Patient" }, { key: "status", label: "Status" }],
  rows: [{ patient: "Patient <One>", status: "cancelled" }],
  summaryRows: [{ label: "cancelled", value: "1" }],
};

describe("Report Center PDF render model", () => {
  it("accepts exact bounded rows without filtering and emits zero-margin physical page CSS", () => {
    const model = parseReportCenterRenderModel(base, "supervisor");
    assert.equal(model.rows[0]?.status, "cancelled");
    const html = buildReportCenterHtml(model);
    assert.match(html, /@page \{ size: 297mm 210mm; margin: 0; \}/);
    assert.match(html, /Patient &lt;One&gt;/);
    assert.match(html, /data-report-center-document="true"/);
  });

  it("supports only the ten truthful appointment report templates", () => {
    const ids = ["daily-appointments", "no-show-list", "cancellation-list", "walk-in-list", "priority-urgent", "waiting-list", "appointment-volume-by-modality", "special-quota", "supervisor-override", "exam-type-volume"];
    assert.equal(ids.length, 10);
    for (const templateId of ids) assert.doesNotThrow(() => parseReportCenterRenderModel({ ...base, templateId }, "supervisor"));
  });

  it("enforces source, template, role, columns, sensitive fields, and row bounds", () => {
    assert.throws(() => parseReportCenterRenderModel({ ...base, templateId: "daily-room-station" }, "super_admin"), /not printable/);
    assert.throws(() => parseReportCenterRenderModel({ ...base, templateId: "no-show-list" }, "receptionist"), /cannot print/);
    assert.throws(() => parseReportCenterRenderModel({ ...base, columns: [{ key: "phone", label: "Phone" }], rows: [{ phone: "secret" }] }, "receptionist"), /Sensitive/);
    assert.throws(() => parseReportCenterRenderModel({ ...base, columns: [{ key: "html", label: "HTML" }], rows: [{ html: "<b>x</b>" }] }, "super_admin"), /not allowed/);
    assert.throws(() => parseReportCenterRenderModel({ ...base, rows: Array.from({ length: 501 }, () => ({ patient: "x", status: "scheduled" })) }, "super_admin"), /rows/);
  });

  it("allows Patient Directory and super-admin audit but preserves their authority", () => {
    assert.doesNotThrow(() => parseReportCenterRenderModel({ ...base, templateId: "patient-directory", source: "patients", columns: [{ key: "patient", label: "Patient" }], rows: [{ patient: "One" }] }, "receptionist"));
    const audit = { ...base, templateId: "printed-documents-audit", source: "audit", columns: [{ key: "action", label: "Output" }], rows: [{ action: "pdf" }] };
    assert.doesNotThrow(() => parseReportCenterRenderModel(audit, "super_admin"));
    assert.throws(() => parseReportCenterRenderModel(audit, "supervisor"), /not printable/);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildStatisticsHtml, parseStatisticsRenderModel } from "./statistics-pdf-service.js";

const valid = {
  dateFrom: "2026-08-01", dateTo: "2026-08-07", modalityLabel: "All modalities",
  summary: [{ label: "Appointments", value: 12 }], operational: [{ label: "Completion rate (%)", value: 50 }],
  statusBreakdown: [{ status: "Completed", count: 6 }],
  modalityBreakdown: [{ modality: "CT", total: 12, scheduled: 1, inQueue: 2, completed: 6, noShow: 1, cancelled: 1, discontinued: 1 }],
  dailyBreakdown: [{ date: "2026-08-01", total: 12, completed: 6, noShow: 1, cancelled: 1, discontinued: 1 }],
};

describe("statistics PDF render model", () => {
  it("preserves the bounded structured selection and renders fixed landscape page geometry", () => {
    const model = parseStatisticsRenderModel(valid);
    assert.deepEqual(model, valid);
    const html = buildStatisticsHtml(model);
    assert.match(html, /@page\{size:297mm 210mm;margin:0\}/);
    assert.match(html, /RISpro Statistics/);
    assert.doesNotMatch(html, /<script/i);
  });

  it("rejects extra fields, unbounded rows, and invalid values", () => {
    assert.throws(() => parseStatisticsRenderModel({ ...valid, rawHtml: "<b>unsafe</b>" }), /fields/);
    assert.throws(() => parseStatisticsRenderModel({ ...valid, dailyBreakdown: Array.from({ length: 367 }, () => valid.dailyBreakdown[0]) }), /rows/);
    assert.throws(() => parseStatisticsRenderModel({ ...valid, summary: [{ label: "Appointments", value: -1 }] }), /value/);
  });
});

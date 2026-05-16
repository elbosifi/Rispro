import test from "node:test";
import assert from "node:assert/strict";
import { normalizePatientQrSettings } from "./patient-qr-settings.js";

test("normalizePatientQrSettings defaults QR slip paper to a4 blank", () => {
  const normalized = normalizePatientQrSettings({});

  assert.equal(normalized.qrSlipPaperMode, "blank");
  assert.equal(normalized.qrSlipPaperSize, "a4");
});

test("normalizePatientQrSettings accepts QR slip paper overrides", () => {
  const normalized = normalizePatientQrSettings({
    qrSlipPaperMode: "preprinted",
    qrSlipPaperSize: "a5",
  });

  assert.equal(normalized.qrSlipPaperMode, "preprinted");
  assert.equal(normalized.qrSlipPaperSize, "a5");
});

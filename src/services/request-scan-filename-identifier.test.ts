import assert from "node:assert/strict";
import test from "node:test";
import {
  decideRequestScanFilenameEvidence,
  normalizeRequestScanFilename,
  parseRequestScanFilenameIdentifiers,
  requestScanSafeDisplayFilename,
} from "./request-scan-filename-identifier.js";

test("normalizes only a recognized upload extension and exact final Windows duplicate suffix", () => {
  assert.equal(normalizeRequestScanFilename("V2-001234 (15).pdf"), "V2-001234");
  assert.equal(normalizeRequestScanFilename("V2-001234 (1) extra.pdf"), "V2-001234 (1) extra");
  assert.equal(normalizeRequestScanFilename("folder/V2-001234.jpg"), "V2-001234");
  assert.equal(normalizeRequestScanFilename("V2-001234.png"), "V2-001234.png");
});

test("extracts embedded accessions case-insensitively, normalizes them, and deduplicates repeats", () => {
  assert.deepEqual(parseRequestScanFilenameIdentifiers("V2-001234.pdf").accessions, ["V2-001234"]);
  assert.deepEqual(parseRequestScanFilenameIdentifiers("v2-001234.pdf").accessions, ["V2-001234"]);
  assert.deepEqual(parseRequestScanFilenameIdentifiers("Scan_v2-001234_V2-001234_Page1.pdf").accessions, ["V2-001234"]);
  assert.deepEqual(parseRequestScanFilenameIdentifiers("V2-001234_2026-07-23.pdf").accessions, ["V2-001234"]);
  assert.deepEqual(parseRequestScanFilenameIdentifiers("XV2-001234_and_V2-123.pdf"), {
    normalizedBasename: "XV2-001234_and_V2-123",
    accessions: [],
    qrTokens: [],
    invalidAccessionCount: 1,
    invalidQrCount: 0,
  });
});

test("extracts scanner-safe and normal public appointment tokens without changing underscores", () => {
  const token = "pa_ab_CD-12.ef_gh";
  assert.deepEqual(
    parseRequestScanFilenameIdentifiers(`https___rispro.nccb.com.ly_public_appointment_t=${token} (1).pdf`).qrTokens,
    [token]
  );
  assert.deepEqual(
    parseRequestScanFilenameIdentifiers(`https://rispro.nccb.com.ly/public/appointment?t=${token}.pdf`).qrTokens,
    [token]
  );
  assert.equal(requestScanSafeDisplayFilename(`https___rispro.nccb.com.ly_public_appointment_t=${token}.pdf`), "Patient appointment QR.pdf");
});

test("filename evidence distinguishes fast-path source, consensus, partial evidence, and conflict", () => {
  assert.deepEqual(decideRequestScanFilenameEvidence({
    accessionCandidateCount: 1, qrCandidateCount: 0, invalidCandidateCount: 0, unresolvedCandidateCount: 0,
    verified: [{ appointmentId: 7, source: "accession" }],
  }), { kind: "success", appointmentId: 7, strategy: "filename_accession" });
  assert.deepEqual(decideRequestScanFilenameEvidence({
    accessionCandidateCount: 1, qrCandidateCount: 1, invalidCandidateCount: 0, unresolvedCandidateCount: 0,
    verified: [{ appointmentId: 7, source: "accession" }, { appointmentId: 7, source: "qr" }],
  }), { kind: "success", appointmentId: 7, strategy: "filename_consensus" });
  assert.deepEqual(decideRequestScanFilenameEvidence({
    accessionCandidateCount: 1, qrCandidateCount: 1, invalidCandidateCount: 0, unresolvedCandidateCount: 1,
    verified: [{ appointmentId: 7, source: "accession" }],
  }), { kind: "partial", appointmentId: 7, strategy: "document_confirmation" });
  assert.deepEqual(decideRequestScanFilenameEvidence({
    accessionCandidateCount: 1, qrCandidateCount: 1, invalidCandidateCount: 0, unresolvedCandidateCount: 0,
    verified: [{ appointmentId: 7, source: "accession" }, { appointmentId: 8, source: "qr" }],
  }), { kind: "conflict", appointmentId: null, strategy: "manual_review" });
});

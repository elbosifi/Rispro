import { randomBytes } from "node:crypto";

if (process.env.RISPRO_E2E !== "1") throw new Error("RISPRO_E2E=1 is required to start the E2E server.");

// Disposable browser fixtures need the existing platform credential encryption prerequisite.
process.env.RISPRO_SECRET_ENCRYPTION_KEY ||= randomBytes(32).toString("base64");

const { e2eReportingBoardAssignmentBatchChecker } = await import("./reporting-board-e2e-checker.js");
const sonicDicomCacheService = await import("../src/services/reporting-board-sonicdicom-cache-service.js");

sonicDicomCacheService.__setReportingBoardSonicDicomReadersForTest({
  checkStatusesBatch: e2eReportingBoardAssignmentBatchChecker,
  fetchDocumentHistoriesBatch: async () => new Map(),
});
await import("../src/server.js");

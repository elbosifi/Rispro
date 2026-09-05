if (process.env.RISPRO_E2E !== "1") throw new Error("RISPRO_E2E=1 is required to start the E2E server.");

const { e2eReportingBoardAssignmentBatchChecker } = await import("./reporting-board-e2e-checker.js");
const sonicDicomCacheService = await import("../src/services/reporting-board-sonicdicom-cache-service.js");

sonicDicomCacheService.__setReportingBoardSonicDicomReadersForTest({
  checkStatusesBatch: e2eReportingBoardAssignmentBatchChecker,
  fetchDocumentHistoriesBatch: async () => new Map(),
});
await import("../src/server.js");

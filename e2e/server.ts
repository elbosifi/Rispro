if (process.env.RISPRO_E2E !== "1") throw new Error("RISPRO_E2E=1 is required to start the E2E server.");

const reportingBoardService = await import("../src/modules/doctor-portal/reporting-board-service.js");
const { e2eReportingBoardAssignmentBatchChecker } = await import("./reporting-board-e2e-checker.js");

reportingBoardService.__setReportingBoardAssignmentBatchCheckerForTest(e2eReportingBoardAssignmentBatchChecker);
await import("../src/server.js");

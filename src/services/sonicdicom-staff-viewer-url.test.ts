import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.DATABASE_URL ||= "postgres://user:password@localhost:5432/rispro_test";
process.env.JWT_SECRET ||= "test-secret";

describe("SonicDICOM staff image viewer URL", () => {
  it("renders a no-credential staff viewer URL with encoded accession number", async () => {
    const { buildSonicDicomStaffImageViewerUrl } = await import("./sonicdicom-report-service.js");
    const { DEFAULT_SONICDICOM_REPORT_SETTINGS } = await import("./sonicdicom-report-settings.js");
    const url = buildSonicDicomStaffImageViewerUrl({
      settings: {
        ...DEFAULT_SONICDICOM_REPORT_SETTINGS,
        sonicDicomReportsEnabled: true,
        sonicDicomPublicBaseUrl: "https://sonic.example/viewer/",
        sonicDicomStaffImageViewerUrlTemplate: "{{publicBaseUrl}}/#/viewer?accessionnumber={{accessionNumber}}&study={{studyInstanceUid}}",
      },
      accessionNumber: "ACC 1/2",
      studyInstanceUid: "1.2.3",
    });

    assert.equal(url, "https://sonic.example/viewer/#/viewer?accessionnumber=ACC%201%2F2&study=1.2.3");
    assert.doesNotMatch(url, /username|password/i);
  });

  it("rejects credential placeholders in the staff viewer template", async () => {
    const { HttpError } = await import("../utils/http-error.js");
    const { buildSonicDicomStaffImageViewerUrl } = await import("./sonicdicom-report-service.js");
    const { DEFAULT_SONICDICOM_REPORT_SETTINGS } = await import("./sonicdicom-report-settings.js");
    assert.throws(
      () => buildSonicDicomStaffImageViewerUrl({
        settings: {
          ...DEFAULT_SONICDICOM_REPORT_SETTINGS,
          sonicDicomReportsEnabled: true,
          sonicDicomPublicBaseUrl: "https://sonic.example/viewer",
          sonicDicomStaffImageViewerUrlTemplate: "{{publicBaseUrl}}/#/viewer?id={{username}}&password={{password}}&accessionnumber={{accessionNumber}}",
        },
        accessionNumber: "ACC-1",
      }),
      (error) => error instanceof HttpError && error.statusCode === 503 && /username or password/.test(error.message)
    );
  });
});

import { describe, expect, it } from "vitest";
import { deriveRequestScanActions, extractFilenameAccession } from "./request-scan-action-policy";

const base = { appointment_id: null, document_id: null } as const;
const kinds = (job: Parameters<typeof deriveRequestScanActions>[0], role = "modality_staff") => {
  const actions = deriveRequestScanActions(job, role);
  return { primary: actions.primary?.kind ?? null, secondary: actions.secondary.map((item) => item.kind) };
};

describe("deriveRequestScanActions", () => {
  it("pending jobs expose Start now and queued work", () => {
    expect(kinds({ ...base, status: "pending" }).primary).toBe("start-now");
    expect(kinds({ ...base, status: "pending" }).secondary).toContain("start-now");
  });

  it("processing jobs expose Stop & review only before attachment begins", () => {
    expect(kinds({ ...base, status: "processing", processing_stage: "recognition" }).primary).toBe("stop-review");
    for (const processing_stage of ["attaching_document", "moving_file", "completed"]) {
      expect(kinds({ ...base, status: "processing", processing_stage }).primary).not.toBe("stop-review");
      expect(kinds({ ...base, status: "processing", processing_stage }).secondary).not.toContain("stop-review");
    }
    expect(kinds({ ...base, status: "processing", attachment_completed_at: "2026-07-27T10:00:00Z" }).primary).not.toBe("stop-review");
  });

  it("failed assignment, retry, archive, blocked export, and dismissed policies are state-aware", () => {
    expect(kinds({ ...base, status: "failed" }).primary).toBe("assign-appointment");
    expect(kinds({ ...base, status: "failed" }).secondary).toContain("retry-automatic");
    expect(kinds({ ...base, status: "failed", appointment_id: 12 }).primary).toBe("retry");
    expect(kinds({ ...base, status: "failed", appointment_id: 12, document_id: 4, attachment_completed_at: "2026-07-27", clinical_document_export_status: null }, "supervisor").primary).toBe("retry-archive");
    expect(kinds({ ...base, status: "failed", appointment_id: 12, document_id: 4, attachment_completed_at: "2026-07-27" }, "modality_staff").primary).toBeNull();
    expect(kinds({ ...base, status: "failed", appointment_id: 12, clinical_document_export_status: "blocked" }, "supervisor").secondary).toContain("retry-matching");
    expect(kinds({ ...base, status: "failed", appointment_id: 12, clinical_document_export_status: "blocked" }, "modality_staff").secondary).not.toContain("retry-matching");
    expect(kinds({ ...base, status: "failed", dismissed_at: "2026-07-27" }, "super_admin").secondary).toContain("restore");
    expect(kinds({ ...base, status: "failed", dismissed_at: "2026-07-27" }, "modality_staff").secondary).not.toContain("restore");
  });

  it("filename accession is a suggestion only and requires one valid accession", () => {
    expect(extractFilenameAccession("V2-003838.pdf")).toBe("V2-003838");
    expect(extractFilenameAccession("scan-V2-003838-V2-004000.pdf")).toBeNull();
    expect(extractFilenameAccession("request.pdf")).toBeNull();
  });
});

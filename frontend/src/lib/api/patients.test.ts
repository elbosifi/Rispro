import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  createPatient,
  deletePatient,
  dismissPatientDuplicate,
  fetchPatientById,
  fetchPatientDirectory,
  mergePatients,
  searchPatients,
  updatePatient,
} from "./patients";

vi.mock("@/lib/api-client", () => ({ api: vi.fn() }));

describe("patient API contracts", () => {
  beforeEach(() => vi.mocked(api).mockReset().mockResolvedValue({ patient: {}, patients: [], items: [], sections: [] }));

  it("preserves search and CRUD routes", async () => {
    await searchPatients("A 123");
    await fetchPatientById(9);
    await createPatient({ fullName: "Patient" } as never);
    await updatePatient(9, { fullName: "Updated" } as never);
    await deletePatient(9);

    expect(api).toHaveBeenNthCalledWith(1, "/patients?q=A+123");
    expect(api).toHaveBeenNthCalledWith(2, "/patients/9");
    expect(api).toHaveBeenNthCalledWith(3, "/patients", { method: "POST", body: JSON.stringify({ fullName: "Patient" }) });
    expect(api).toHaveBeenNthCalledWith(4, "/patients/9", { method: "PUT", body: JSON.stringify({ fullName: "Updated" }) });
    expect(api).toHaveBeenNthCalledWith(5, "/patients/9", { method: "DELETE" });
  });

  it("preserves directory filters and duplicate safety payloads", async () => {
    await fetchPatientDirectory({ page: 2, pageSize: 25, q: "Ali" });
    await mergePatients(10, 11);
    await dismissPatientDuplicate(10, 11, "different people");

    expect(api).toHaveBeenNthCalledWith(1, "/patients/directory?q=Ali&page=2&pageSize=25");
    expect(api).toHaveBeenNthCalledWith(2, "/patients/merge", { method: "POST", body: JSON.stringify({ targetPatientId: 10, sourcePatientId: 11, confirmationText: "MERGE" }) });
    expect(api).toHaveBeenNthCalledWith(3, "/settings/patient-duplicates/dismiss", { method: "POST", body: JSON.stringify({ patientAId: 10, patientBId: 11, reason: "different people" }) });
  });
});

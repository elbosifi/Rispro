import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AppointmentCreatePage } from "./appointment-create-page";

const patient = {
  id: 7,
  arabicFullName: "المريض",
  englishFullName: "Patient",
  category: "non_oncology" as const,
  identifierType: "national_id",
  identifierValue: "123456789012",
  mrn: "MRN-7",
  sex: "M",
  ageYears: 40,
  demographicsEstimated: false,
  identityDocumentVerified: false,
};

const risk = {
  maskedPrimaryIdentifier: "••••9012",
  primaryIdentifierType: "national_id",
  primaryIdentifierTypeLabelAr: "الرقم الوطني",
  primaryIdentifierTypeLabelEn: "National ID",
  estimatedDateOfBirth: null,
  identityRisk: "none" as const,
  identityVerificationRequired: false,
  identityDocumentVerified: true,
  similarPatientCount: 0,
  availableVerificationMethods: [],
};

vi.mock("./api", () => ({
  createV2Booking: vi.fn(),
  evaluateV2Scheduling: vi.fn(),
  fetchV2AppointmentPatientRisk: vi.fn(),
  useV2Lookups: () => ({ data: { modalities: [] }, isLoading: false, isError: false }),
  useV2SpecialReasonCodes: () => ({ data: [], isLoading: false, isError: false }),
  useV2Priorities: () => ({ data: [], isLoading: false, isError: false }),
}));

vi.mock("./components/CreateAppointmentTab", () => ({
  CreateAppointmentTab: ({ initialSelectedPatient }: { initialSelectedPatient: { identityDocumentVerified?: boolean } | null }) => (
    <div data-testid="preselected-patient-badge">
      {initialSelectedPatient?.identityDocumentVerified ? "blue" : "not-verified"}
    </div>
  ),
}));

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({ user: { role: "receptionist" } }),
}));

vi.mock("@/providers/language-provider", () => ({
  useLanguage: () => ({ language: "en" }),
}));

vi.mock("@/lib/api-hooks", () => ({
  fetchDoctorMe: vi.fn(async () => ({ moduleCapabilities: [] })),
  fetchPatientById: vi.fn(async () => patient),
}));

vi.mock("@/lib/api/complementary-recalls", () => ({
  fetchComplementaryRecallBookingContext: vi.fn(),
}));

vi.mock("@/lib/api/ir-referrals", () => ({
  fetchIrReferralScheduleBookingContext: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === "patient-by-id") {
      return { data: [patient, risk], isLoading: false, isError: false, isSuccess: true };
    }
    return { data: null, isLoading: false, isError: false, isSuccess: true };
  },
}));

describe("AppointmentCreatePage identity badge mapping", () => {
  it("passes a verified preselected patient through to the create form", () => {
    render(
      <MemoryRouter initialEntries={["/appointments?patientId=7"]}>
        <AppointmentCreatePage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("preselected-patient-badge").textContent).toBe("blue");
  });
});

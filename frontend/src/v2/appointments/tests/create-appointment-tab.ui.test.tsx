import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { CreateAppointmentTab } from "../components/CreateAppointmentTab";
import { LanguageProvider } from "@/providers/language-provider-component";
import type { AvailabilityRowViewModel } from "../hooks/availability-row-mapper";
import type { BookingResponse, CreateBookingRequest, CreateSchedulingOverrideRequestInput, SchedulingDecisionDto } from "../types";
import type { ModalityDto } from "../types";
import type { DoctorModuleCapability } from "@/types/api";

type MockNoShowAppointment = {
  id: number;
  appointmentDate: string;
  examNameEn: string | null;
  examNameAr: string | null;
  status?: string;
};

const mockFetchAppointments = vi.fn<
  (params: unknown) => Promise<MockNoShowAppointment[]>
>(async () => []);
const mockFetchPatientNoShowHistory = vi.fn<(patientId: number) => Promise<{
  noShowCount: number;
  bookingRestricted: boolean;
  lastNoShowAppointment: null;
  lastAuthorizationUser: null;
  lastAuthorizationReason: null;
  lastAuthorizationAt: null;
  lastNoShowDate: null;
}>>(async () => ({
    noShowCount: 0,
    bookingRestricted: false,
    lastNoShowAppointment: null,
    lastAuthorizationUser: null,
    lastAuthorizationReason: null,
    lastAuthorizationAt: null,
    lastNoShowDate: null,
  }));
const mockFetchPatientQrSettings = vi.fn(async () => ({
  defaultReportRequiredForOncology: true,
  defaultReportRequiredForNonOncology: false,
}));
const mockGetAppointmentById = vi.fn(async (id: number) => ({
  id,
  publicAppointmentUrl: `https://rispro.nccb.com.ly/public/appointment?t=token-${id}`,
  phone1: "0912345678",
}));
const mockQueueWalkInEnabled = { current: true };
const mockReceptionOverrideRequestsEnabled = { current: true };
const mockListAppointmentDocuments = vi.fn<(appointmentId: number, appointmentRefType?: string) => Promise<unknown[]>>(
  async () => []
);
const mockUploadAppointmentDocument = vi.fn<(payload: unknown) => Promise<unknown>>(async () => ({}));
const mockDeleteAppointmentDocument = vi.fn<(documentId: number) => Promise<{ deleted: boolean; documentId: number }>>(
  async () => ({ deleted: true, documentId: 1 })
);
const mockPrepareScanSession = vi.fn<(payload: unknown) => Promise<{ preparation: Record<string, unknown> }>>(
  async () => ({ preparation: {} })
);
const mockPrintAppointmentSlipById = vi.fn<(appointmentId: number) => Promise<void>>(async () => {});
const mockCreateSchedulingOverrideRequest = vi.fn<
  (input: CreateSchedulingOverrideRequestInput) => Promise<{ request: { id: number; status: "pending" } }>
>(async () => ({ request: { id: 1, status: "pending" } }));
const mockIntendedReportingDoctors = {
  current: [
    { id: 42, displayName: "Dr Target", canFinalizeReports: true },
  ],
};

vi.mock("@/lib/api-hooks", () => ({
  fetchAppointments: (params: unknown) => mockFetchAppointments(params),
  fetchPatientNoShowHistory: (patientId: number) => mockFetchPatientNoShowHistory(patientId),
  fetchPatientQrSettings: () => mockFetchPatientQrSettings(),
  fetchPublicSchedulingCapacitySettings: () => Promise.resolve({
    allow_reception_override_requests_from_availability: mockReceptionOverrideRequestsEnabled.current ? "enabled" : "disabled",
    can_request_scheduling_override: mockReceptionOverrideRequestsEnabled.current ? "enabled" : "disabled",
  }),
  fetchSettings: (category: string) => {
    if (category === "queue_and_arrival") {
      return Promise.resolve({ walk_in_queue: mockQueueWalkInEnabled.current ? "enabled" : "disabled" });
    }
    if (category === "scheduling_and_capacity") {
      return Promise.resolve({
        allow_reception_override_requests_from_availability: mockReceptionOverrideRequestsEnabled.current ? "enabled" : "disabled",
      });
    }
    return Promise.resolve({});
  },
  getAppointmentById: (id: number) => mockGetAppointmentById(id),
  listAppointmentDocuments: (appointmentId: number, appointmentRefType?: string) =>
    mockListAppointmentDocuments(appointmentId, appointmentRefType),
  uploadAppointmentDocument: (payload: unknown) => mockUploadAppointmentDocument(payload),
  deleteAppointmentDocument: (documentId: number) => mockDeleteAppointmentDocument(documentId),
  prepareScanSession: (payload: unknown) => mockPrepareScanSession(payload),
}));

vi.mock("@/lib/appointment-printing", () => ({
  printAppointmentSlipById: (appointmentId: number) => mockPrintAppointmentSlipById(appointmentId),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options?: { queryKey?: unknown[] }) => {
    const key = Array.isArray(options?.queryKey) ? options.queryKey.join(":") : "";
    if (key.includes("queue_and_arrival")) {
      return {
        data: { walk_in_queue: mockQueueWalkInEnabled.current ? "enabled" : "disabled" },
        isLoading: false,
        isError: false,
        error: null,
      };
    }
	    if (key.includes("scheduling_and_capacity")) {
	      return {
	        data: {
	          allow_reception_override_requests_from_availability: mockReceptionOverrideRequestsEnabled.current ? "enabled" : "disabled",
	          can_request_scheduling_override: mockReceptionOverrideRequestsEnabled.current ? "enabled" : "disabled",
	        },
	        isLoading: false,
	        isError: false,
	        error: null,
	      };
	    }
	    if (key.includes("intended-reporting-doctors")) {
	      return {
	        data: mockIntendedReportingDoctors.current,
	        isLoading: false,
	        isError: false,
	        error: null,
	      };
	    }

    return {
      data: {
        defaultReportRequiredForOncology: true,
        defaultReportRequiredForNonOncology: false,
      },
      isLoading: false,
      isError: false,
      error: null,
    };
  },
}));

vi.mock("@/components/documents/request-documents-panel", () => ({
  RequestDocumentsPanel: () => <div data-testid="request-documents-panel" />,
}));

vi.mock("../components/PatientSearchSection", () => ({
  PatientSearchSection: ({
    onSelectPatient,
    value,
  }: {
    onSelectPatient: (p: unknown) => void;
    value: { englishFullName?: string | null; arabicFullName?: string | null; identifierValue?: string | null; nationalId?: string | null; mrn?: string | null; sex?: string | null; ageYears?: number | null; demographicsEstimated?: boolean } | null;
  }) => (
    <div>
      {value ? (
        <div className="card-shell p-4">
          <div className="font-semibold">{value.arabicFullName ?? value.englishFullName}</div>
          <div className="text-sm text-muted-foreground">Primary ID: {value.identifierValue || value.nationalId || value.mrn || "—"}</div>
          <div className="text-sm text-muted-foreground">
            Sex: {value.sex ?? "—"} · Age: {value.ageYears ?? "—"}{value.demographicsEstimated ? " (Estimated)" : ""}
          </div>
        </div>
      ) : null}
      <button
        type="button"
        onClick={() =>
          onSelectPatient({
            id: 9,
            arabicFullName: "Test Patient",
            englishFullName: "Test Patient",
            category: "oncology",
            identifierType: "passport",
            identifierValue: "P-12345",
            nationalId: "123",
            mrn: "MRN-9",
            sex: "M",
            ageYears: 30,
            phone1: "0912345678",
          })
        }
      >
        Select Test Patient
      </button>
      <button
        type="button"
        onClick={() => onSelectPatient({
          id: 10,
          arabicFullName: "Other Patient",
          englishFullName: "Other Patient",
          category: "non_oncology",
          identifierType: "passport",
          identifierValue: "P-67890",
          nationalId: "456",
          mrn: "MRN-10",
          sex: "F",
          ageYears: 28,
          phone1: "0923456789",
        })}
      >
        Select Other Patient
      </button>
    </div>
  ),
}));

const availabilityRows: AvailabilityRowViewModel[] = [
  {
    date: "2027-01-01",
    dayLabel: "Fri, Jan 1",
    status: "blocked",
    bucketMode: "partitioned",
    remainingCapacity: null,
    dailyCapacity: null,
    oncologyReserved: null,
    oncologyFilled: 0,
    oncologyRemaining: null,
    nonOncologyReserved: null,
    nonOncologyFilled: 0,
    nonOncologyRemaining: null,
    specialQuotaRemaining: null,
    reasonText: "Blocked",
    requiresSupervisorOverride: false,
  },
  {
    date: "2027-01-02",
    dayLabel: "Sat, Jan 2",
    status: "restricted",
    bucketMode: "partitioned",
    remainingCapacity: 1,
    dailyCapacity: 20,
    oncologyReserved: 10,
    oncologyFilled: 5,
    oncologyRemaining: 5,
    nonOncologyReserved: 10,
    nonOncologyFilled: 9,
    nonOncologyRemaining: 1,
    specialQuotaRemaining: null,
    reasonText: "Supervisor required",
    requiresSupervisorOverride: true,
    reasonCodes: ["category_capacity_exhausted"],
    examMixQuotaSummaries: [
      {
        ruleId: 501,
        title: "Brain MRI group",
        dailyLimit: 2,
        consumed: 2,
        remaining: 0,
        isBlocking: true,
        isPrimaryBlocking: true,
      },
    ],
  },
  {
    date: "2027-01-03",
    dayLabel: "Sun, Jan 3",
    status: "full",
    bucketMode: "partitioned",
    remainingCapacity: 0,
    dailyCapacity: 20,
    oncologyReserved: 10,
    oncologyFilled: 10,
    oncologyRemaining: 0,
    nonOncologyReserved: 10,
    nonOncologyFilled: 10,
    nonOncologyRemaining: 0,
    specialQuotaRemaining: null,
    reasonText: "Full but overridable",
    requiresSupervisorOverride: true,
    reasonCodes: ["category_capacity_exhausted"],
  },
  {
    date: "2027-01-04",
    dayLabel: "Mon, Jan 4",
    status: "blocked",
    bucketMode: "partitioned",
    remainingCapacity: null,
    dailyCapacity: null,
    oncologyReserved: null,
    oncologyFilled: 0,
    oncologyRemaining: null,
    nonOncologyReserved: null,
    nonOncologyFilled: 0,
    nonOncologyRemaining: null,
    specialQuotaRemaining: null,
    reasonText: "Closed weekday",
    requiresSupervisorOverride: false,
    reasonCodes: ["closed_weekday_override_forbidden"],
  },
];

const mockRowsRef = { current: availabilityRows };
const mockAvailabilityLoading = { current: false };
const mockRawItemsByExamType: { current: Record<number, MockRawAvailabilityItem[]> | null } = { current: null };
type MockRawAvailabilityItem = {
  date: string;
  specialQuotaSummary: {
    examTypeId: number;
    configured: number;
    consumed: number;
    remaining: number;
  } | null;
  examMixQuotaSummaries?: Array<{
    ruleId: number;
    title: string | null;
    dailyLimit: number;
    consumed: number;
    remaining: number;
    isBlocking: boolean;
    isPrimaryBlocking: boolean;
  }>;
};
const mockRawItemsRef: { current: MockRawAvailabilityItem[] } = {
  current: [
    {
      date: "2027-01-02",
      specialQuotaSummary: {
        examTypeId: 101,
        configured: 2,
        consumed: 0,
        remaining: 2,
      },
    },
  ],
};

vi.mock("../hooks/useAppointmentAvailability", () => ({
  useAppointmentAvailability: (args: { examTypeId?: number | null }) => ({
    enabled: true,
    rows: mockRowsRef.current,
    rawItems: args.examTypeId != null && mockRawItemsByExamType.current
      ? (mockRawItemsByExamType.current[args.examTypeId] ?? [])
      : mockRawItemsRef.current,
    isLoading: mockAvailabilityLoading.current,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("../api", () => ({
	  useCreateSchedulingOverrideRequest: () => ({
	    mutateAsync: mockCreateSchedulingOverrideRequest,
	    isPending: false,
	  }),
	  fetchIntendedReportingDoctors: () => Promise.resolve(mockIntendedReportingDoctors.current),
	  useV2ExamTypes: (modalityId: number | null) => {
    if (modalityId === 1) {
      return {
        data: [
          { id: 101, name: "CT Head", nameAr: "دماغ", nameEn: "CT Head", code: "CTH", modalityId: 1, isActive: true },
          { id: 102, name: "CT Chest", nameAr: "صدر", nameEn: "CT Chest", code: "CTC", modalityId: 1, isActive: true },
        ],
      };
    }
    if (modalityId === 2) {
      return {
        data: [
          { id: 201, name: "MRI Brain", nameAr: "دماغ بالرنين", nameEn: "MRI Brain", code: "MRB", modalityId: 2, isActive: true },
        ],
      };
    }
    return { data: [] };
  },
}));

const availabilityRowsWithAvailable: AvailabilityRowViewModel[] = [
  {
    date: "2027-01-03",
    dayLabel: "Sun, Jan 3",
    status: "available",
    bucketMode: "total_only",
    remainingCapacity: 5,
    dailyCapacity: 20,
    oncologyReserved: null,
    oncologyFilled: 7,
    oncologyRemaining: null,
    nonOncologyReserved: null,
    nonOncologyFilled: 8,
    nonOncologyRemaining: null,
    specialQuotaRemaining: null,
    reasonText: "Available",
    requiresSupervisorOverride: false,
  },
];

const availabilityRowsWithHiddenAndAvailable: AvailabilityRowViewModel[] = [
  {
    ...availabilityRows[3],
    date: "2027-01-01",
    dayLabel: "Fri, Jan 1",
    hideAlways: true,
  },
  {
    ...availabilityRows[2],
    date: "2027-01-02",
    dayLabel: "Sat, Jan 2",
  },
  {
    ...availabilityRowsWithAvailable[0],
    date: "2027-01-05",
    dayLabel: "Tue, Jan 5",
  },
];

const supervisorTotalCapacityRows: AvailabilityRowViewModel[] = [
  {
    ...availabilityRows[2],
    date: "2027-01-06",
    dayLabel: "Wed, Jan 6",
    reasonText: "Total modality capacity exhausted",
    reasonCodes: ["modality_daily_capacity_exhausted"],
  },
];

const allowedSpecialQuotaDecision: SchedulingDecisionDto = {
  isAllowed: true,
  requiresSupervisorOverride: false,
  displayStatus: "available",
  suggestedBookingMode: "special",
  consumedCapacityMode: "special",
  remainingStandardCapacity: 0,
  remainingSpecialQuota: 2,
  matchedRuleIds: [],
  reasons: [],
  policy: { policySetKey: "default", versionId: 1, versionNo: 1, configHash: "x" },
  decisionTrace: { evaluatedAt: "", input: {} },
};

const assignedReceptionistQuotaRows: AvailabilityRowViewModel[] = [
  {
    ...availabilityRows[1],
    specialQuotaRemaining: 2,
    hasSpecialQuotaPath: true,
    requiresSupervisorOverride: false,
  },
];

function setup(
  canUseNonStandardCapacityModes: boolean = true,
  priorityOptions: Array<{ id: number; nameEn: string; nameAr: string }> = [],
  modalityOptions: ModalityDto[] = [
    { id: 1, name: "CT", nameAr: "أشعة مقطعية", nameEn: "CT", code: "CT", isActive: true, safetyWarningEn: null, safetyWarningAr: null, safetyWarningEnabled: false },
    { id: 2, name: "MRI", nameAr: "رنين مغناطيسي", nameEn: "MRI", code: "MRI", isActive: true, safetyWarningEn: null, safetyWarningAr: null, safetyWarningEnabled: false },
  ],
  currentUserRole: "receptionist" | "supervisor" | "super_admin" = "supervisor",
  doctorModuleCapabilities: DoctorModuleCapability[] = [],
  evaluateDecision?: SchedulingDecisionDto,
  examTypeOptions: Array<{ id: number; name: string; nameEn: string; nameAr: string; code: string; modalityId: number; isActive: boolean }> = []
) {
  const onCreateAppointment = vi.fn(async (payload: CreateBookingRequest): Promise<BookingResponse> => ({
    booking: {
      id: 10,
      patientId: payload.patientId,
      modalityId: payload.modalityId,
      examTypeId: payload.examTypeId,
      reportingPriorityId: null,
      bookingDate: payload.bookingDate,
      bookingTime: null,
      caseCategory: payload.caseCategory,
      status: "scheduled" as const,
      notes: payload.notes,
      policyVersionId: 1,
      capacityResolutionMode: payload.capacityResolutionMode ?? "standard",
      usesSpecialQuota: payload.capacityResolutionMode === "special_quota_extra",
      createdAt: "",
      updatedAt: "",
    },
    decision: {},
    wasOverride: Boolean(payload.override),
  }));

  const onEvaluateAvailability = vi.fn(async (): Promise<SchedulingDecisionDto> => evaluateDecision ?? ({
    isAllowed: false,
    requiresSupervisorOverride: true,
    displayStatus: "restricted" as const,
    suggestedBookingMode: "override" as const,
    consumedCapacityMode: "override" as const,
    remainingStandardCapacity: 0,
    remainingSpecialQuota: null,
    matchedRuleIds: [],
    reasons: [{ code: "needs_override", severity: "warning", message: "override" }],
    policy: { policySetKey: "default", versionId: 1, versionNo: 1, configHash: "x" },
    decisionTrace: { evaluatedAt: "", input: {} },
  }));

  render(
    <LanguageProvider>
      <MemoryRouter initialEntries={["/appointments"]}>
        <Routes>
          <Route path="/appointments" element={
            <CreateAppointmentTab
              patientLookups={{}}
              modalityOptions={modalityOptions}
              examTypeOptions={examTypeOptions}
              specialReasonOptions={[{ code: "urgent", labelAr: "", labelEn: "Urgent", isActive: true }]}
              priorityOptions={priorityOptions}
              schedulingEngineEnabled
	              canUseNonStandardCapacityModes={canUseNonStandardCapacityModes}
	              currentUserRole={currentUserRole}
	              doctorModuleCapabilities={doctorModuleCapabilities}
	              onCreateAppointment={onCreateAppointment}
              onEvaluateAvailability={onEvaluateAvailability}
            />
          } />
          <Route path="/print" element={<PrintPlaceholder />} />
        </Routes>
      </MemoryRouter>
    </LanguageProvider>
  );

  return { onCreateAppointment, onEvaluateAvailability };
}

function PrintPlaceholder() {
  const location = useLocation();
  return <div data-testid="print-page">{`Print Page ${location.pathname}${location.search}`}</div>;
}

describe("CreateAppointmentTab UI interactions", () => {
  beforeEach(() => {
    localStorage.setItem("rispro-language", "en");
    localStorage.setItem("rispro:create-appointment:entity-display-mode", "en");
    mockFetchAppointments.mockReset();
    mockFetchAppointments.mockResolvedValue([]);
    mockFetchPatientNoShowHistory.mockReset();
    mockFetchPatientNoShowHistory.mockResolvedValue({
      noShowCount: 0,
      bookingRestricted: false,
      lastNoShowAppointment: null,
      lastAuthorizationUser: null,
      lastAuthorizationReason: null,
      lastAuthorizationAt: null,
      lastNoShowDate: null,
    });
    mockGetAppointmentById.mockReset();
    mockGetAppointmentById.mockImplementation(async (id: number) => ({
      id,
      publicAppointmentUrl: `https://rispro.nccb.com.ly/public/appointment?t=token-${id}`,
      phone1: "0912345678",
    }));
    mockListAppointmentDocuments.mockReset();
    mockListAppointmentDocuments.mockResolvedValue([]);
    mockUploadAppointmentDocument.mockReset();
    mockUploadAppointmentDocument.mockResolvedValue({});
    mockDeleteAppointmentDocument.mockReset();
    mockDeleteAppointmentDocument.mockResolvedValue({ deleted: true, documentId: 1 });
    mockPrepareScanSession.mockReset();
    mockPrepareScanSession.mockResolvedValue({ preparation: {} });
    mockPrintAppointmentSlipById.mockReset();
    mockPrintAppointmentSlipById.mockResolvedValue(undefined);
    mockCreateSchedulingOverrideRequest.mockReset();
    mockCreateSchedulingOverrideRequest.mockResolvedValue({ request: { id: 1, status: "pending" } });
    mockReceptionOverrideRequestsEnabled.current = true;
    mockAvailabilityLoading.current = false;
    mockRawItemsByExamType.current = null;
    mockIntendedReportingDoctors.current = [
      { id: 42, displayName: "Dr Target", canFinalizeReports: true },
    ];
    mockRowsRef.current = availabilityRows;
    mockRawItemsRef.current = [
      {
        date: "2027-01-02",
        specialQuotaSummary: {
          examTypeId: 101,
          configured: 2,
          consumed: 0,
          remaining: 2,
        },
        examMixQuotaSummaries: [
          {
            ruleId: 501,
            title: "Brain MRI group",
            dailyLimit: 2,
            consumed: 2,
            remaining: 0,
            isBlocking: true,
            isPrimaryBlocking: true,
          },
        ],
      },
    ];
  });

  afterEach(() => {
    if (vi.isMockFunction(window.open)) {
      vi.mocked(window.open).mockRestore();
    }
  });

  it("renders entity display mode control with default both mode", async () => {
    localStorage.removeItem("rispro:create-appointment:entity-display-mode");
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));

    const modeSelect = screen.getByLabelText("Entity Display") as HTMLSelectElement;
    expect(modeSelect.value).toBe("both");
  });

  it("applies Arabic mode to modality and exam labels", async () => {
    localStorage.setItem("rispro:create-appointment:entity-display-mode", "ar");
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
    fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });

    expect((screen.getByLabelText("Modality") as HTMLSelectElement).textContent).toContain("أشعة مقطعية");
    expect((screen.getByLabelText("Exam Type") as HTMLSelectElement).textContent).toContain("دماغ");
  });

  it("applies English mode to modality and exam labels", async () => {
    localStorage.setItem("rispro:create-appointment:entity-display-mode", "en");
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
    fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });

    expect((screen.getByLabelText("Modality") as HTMLSelectElement).textContent).toContain("CT");
    expect((screen.getByLabelText("Exam Type") as HTMLSelectElement).textContent).toContain("CT Head");
  });

  it("applies Both mode as compact English — Arabic labels", async () => {
    localStorage.setItem("rispro:create-appointment:entity-display-mode", "both");
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
    fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });

    expect((screen.getByLabelText("Modality") as HTMLSelectElement).textContent).toContain("CT —");
    expect((screen.getByLabelText("Exam Type") as HTMLSelectElement).textContent).toContain("CT Head —");
  });

  it("falls back to available name in Both mode when one language is missing", async () => {
    localStorage.setItem("rispro:create-appointment:entity-display-mode", "both");
    mockFetchAppointments.mockResolvedValueOnce([
      { id: 91, appointmentDate: "2026-03-01", examNameEn: "MRI Spine", examNameAr: null, status: "no-show" },
    ]);

    setup();
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));

    expect(await screen.findByText("2026-03-01 — MRI Spine (no-show)")).toBeTruthy();
  });

  it("filters exam types by selected modality", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));

    fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });

    const examType = screen.getByLabelText("Exam Type") as HTMLSelectElement;
    expect(examType.textContent).toContain("CT Head");
    expect(examType.textContent).not.toContain("MRI Brain");

    fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "2" } });
    expect(examType.textContent).toContain("MRI Brain");
    expect(examType.textContent).not.toContain("CT Head");
  });

  it("shows intended reporting doctor only to privileged users and submits the selected intent", async () => {
    const { onCreateAppointment, onEvaluateAvailability } = setup(true, [], undefined, "supervisor");
    onEvaluateAvailability.mockResolvedValue({
      isAllowed: true,
      requiresSupervisorOverride: false,
      displayStatus: "available",
      suggestedBookingMode: "standard",
      consumedCapacityMode: "standard",
      remainingStandardCapacity: 1,
      remainingSpecialQuota: null,
      matchedRuleIds: [],
      reasons: [],
      policy: { policySetKey: "default", versionId: 1, versionNo: 1, configHash: "x" },
      decisionTrace: { evaluatedAt: "", input: {} },
    });
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
    fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });
    const reportRequired = screen.getByLabelText("Report required") as HTMLInputElement;
    if (!reportRequired.checked) {
      await userEvent.click(reportRequired);
    }

    expect(screen.getByText("The doctor will be notified when the study is completed and becomes available for reporting. Leave empty to keep the case in the normal reporting pool.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Intended reporting doctor"), { target: { value: "42" } });
    fireEvent.change(screen.getByLabelText("Intended reporting doctor reason"), { target: { value: "Subspecialty reader" } });
    fireEvent.change(screen.getByLabelText("Appointment Date"), { target: { value: "2027-01-03" } });
    await userEvent.click(screen.getByRole("button", { name: "Create Appointment" }));

    await waitFor(() => {
      expect(onCreateAppointment).toHaveBeenCalled();
    });
    const callArg = onCreateAppointment.mock.calls[0][0];
    expect(callArg.intendedReportingDoctorId).toBe(42);
    expect(callArg.intendedReportingDoctorReason).toBe("Subspecialty reader");
  });

  it("hides intended reporting doctor for receptionists and clears it when report is not required", async () => {
    setup(false, [], undefined, "receptionist");
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
    fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });
    await userEvent.click(screen.getByLabelText("Report required"));

    expect(screen.queryByLabelText("Intended reporting doctor")).toBeNull();
  });

  it("persists entity display mode in localStorage", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
    fireEvent.change(screen.getByLabelText("Entity Display"), { target: { value: "en" } });
    expect(localStorage.getItem("rispro:create-appointment:entity-display-mode")).toBe("en");
  });

  it("changing display mode keeps selected modalityId and examTypeId", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
    await userEvent.selectOptions(screen.getByLabelText("Modality"), "1");
    await userEvent.selectOptions(screen.getByLabelText("Exam Type"), "101");

    await userEvent.selectOptions(screen.getByLabelText("Entity Display"), "ar");

    await waitFor(() => {
      expect((screen.getByLabelText("Modality") as HTMLSelectElement).value).toBe("1");
      expect((screen.getByLabelText("Exam Type") as HTMLSelectElement).value).toBe("101");
    });
  });

  it("keeps blocked row non-clickable", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
    fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });

    await userEvent.click(screen.getByRole("button", { name: "Show full days" }));

    expect(screen.queryByRole("button", { name: /2027-01-01 blocked/i })).toBeNull();
  });

  it("allows receptionist to select restricted, full, and closed rows when override is requestable", async () => {
    setup(false, [], undefined, "receptionist");
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
    fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });

    await userEvent.click(screen.getByRole("button", { name: "Show full days" }));
    await userEvent.click(screen.getByRole("button", { name: /2027-01-02 restricted/i }));
    expect((screen.getByRole("button", { name: "Create Appointment" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Request override approval" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: /2027-01-03 full/i }));
    expect((screen.getByRole("button", { name: "Create Appointment" }) as HTMLButtonElement).disabled).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: /2027-01-04 blocked/i }));
    expect((screen.getByRole("button", { name: "Create Appointment" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps full and policy-hidden visibility filters independent", async () => {
    const previousRows = mockRowsRef.current;
    mockRowsRef.current = availabilityRowsWithHiddenAndAvailable;
    try {
      setup(false, [], undefined, "supervisor");
      await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
      fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
      fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });

      expect(screen.queryByRole("button", { name: /2027-01-01 blocked/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /2027-01-02 full/i })).toBeNull();
      expect(screen.getByRole("button", { name: /2027-01-05 available/i })).toBeTruthy();

      await userEvent.click(screen.getByRole("button", { name: "Show hidden days" }));
      expect(screen.queryByRole("button", { name: /2027-01-01 blocked/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /2027-01-02 full/i })).toBeNull();

      await userEvent.click(screen.getByRole("button", { name: "Show full days" }));
      expect(screen.getByRole("button", { name: /2027-01-01 blocked/i })).toBeTruthy();
      expect(screen.getByRole("button", { name: /2027-01-02 full/i })).toBeTruthy();
    } finally {
      mockRowsRef.current = previousRows;
    }
  });

  it("auto-selects the closest normally bookable visible day", async () => {
    const previousRows = mockRowsRef.current;
    mockRowsRef.current = availabilityRowsWithHiddenAndAvailable;
    try {
      setup(false, [], undefined, "receptionist");
      await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
      fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
      fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });

      await waitFor(() => {
        expect((screen.getByRole("button", { name: /2027-01-05 available/i }) as HTMLButtonElement).style.border).toContain("var(--blue)");
      });
      expect((screen.getByRole("button", { name: "Create Appointment" }) as HTMLButtonElement).disabled).toBe(false);
      expect(screen.queryByRole("button", { name: "Request override approval" })).toBeNull();
    } finally {
      mockRowsRef.current = previousRows;
    }
  });

  it("shows primary exam-mix group in top summary strip", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
    fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });
    fireEvent.change(screen.getByLabelText("Appointment Date"), { target: { value: "2027-01-02" } });
    await userEvent.click(screen.getByRole("button", { name: "Show full days" }));
    expect(screen.getByText(/Exam mix groups:/)).toBeTruthy();
    expect(screen.getByText(/Brain MRI group 2\/2/)).toBeTruthy();
  });

  it("shows selected patient primary identifier value instead of MRN in summary", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
    expect(screen.getByText("Primary ID: P-12345")).toBeTruthy();
  });

  it("defaults case category from selected patient category and preserves manual override", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));

    const categorySelect = screen.getByLabelText("Case Category") as HTMLSelectElement;
    expect(categorySelect.value).toBe("oncology");

    fireEvent.change(categorySelect, { target: { value: "non_oncology" } });
    expect(categorySelect.value).toBe("non_oncology");

    fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });
    await userEvent.click(screen.getByRole("button", { name: "Show full days" }));
    await userEvent.click(screen.getByRole("button", { name: /2027-01-02 restricted/i }));

    expect((screen.getByLabelText("Case Category") as HTMLSelectElement).value).toBe("non_oncology");
  });

  it("shows previous no-shows list with date and exam type", async () => {
    mockFetchAppointments.mockImplementation(async (params: unknown) => {
      const status = (params as { status?: string[] }).status;
      return Array.isArray(status) && status.includes("no-show")
        ? [
            {
              id: 91,
              appointmentDate: "2026-03-01",
              examNameEn: "MRI Spine",
              examNameAr: null,
              status: "no-show",
            },
          ]
        : [];
    });
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
    expect(await screen.findByText("Previous No-Shows")).toBeTruthy();
    expect(await screen.findByText("2026-03-01 — MRI Spine (no-show)")).toBeTruthy();
  });

  it("shows Arabic modality and exam labels when Arabic catalog names are available", async () => {
    localStorage.setItem("rispro-language", "ar");
    localStorage.setItem("rispro:create-appointment:entity-display-mode", "ar");
    const previousRows = mockRowsRef.current;
    mockRowsRef.current = availabilityRowsWithAvailable;
    try {
      setup();

      await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
      fireEvent.change(screen.getByLabelText("الجهاز"), { target: { value: "1" } });
      fireEvent.change(screen.getByLabelText("نوع الفحص"), { target: { value: "101" } });

      const modalitySelect = screen.getByLabelText("الجهاز") as HTMLSelectElement;
      const examTypeSelect = screen.getByLabelText("نوع الفحص") as HTMLSelectElement;
      expect(Array.from(modalitySelect.options).map((option) => option.textContent ?? "")).toContain("أشعة مقطعية");
      expect(Array.from(examTypeSelect.options).map((option) => option.textContent ?? "")).toContain("دماغ");

      await userEvent.click(screen.getByRole("button", { name: /2027-01-03 available/i }));
      await userEvent.click(screen.getByRole("button", { name: /إنشاء موعد|Create Appointment/ }));

      await screen.findByText("مطلوب تجاوز من المشرف");
      fireEvent.change(screen.getByPlaceholderText("اسم مستخدم المشرف"), { target: { value: "sup" } });
      fireEvent.change(screen.getByPlaceholderText("كلمة المرور"), { target: { value: "pass" } });
      fireEvent.change(screen.getByPlaceholderText("سبب التجاوز"), { target: { value: "approved" } });
      await userEvent.click(screen.getByRole("button", { name: /اعتماد والحجز|Approve & Book/ }));

      await screen.findByText("تم إنشاء الموعد بنجاح");
      const successHeading = screen.getByText("تم إنشاء الموعد بنجاح");
      const successCard = successHeading.closest(".card-shell");
      expect(successCard?.textContent ?? "").toContain("أشعة مقطعية");
      expect(successCard?.textContent ?? "").toContain("دماغ");
    } finally {
      mockRowsRef.current = previousRows;
    }
  });

  it("keeps routine as default but removes routine from selectable priorities", async () => {
    setup(true, [
      { id: 1, nameEn: "Routine", nameAr: "عادي" },
      { id: 2, nameEn: "Urgent", nameAr: "عاجل" },
      { id: 3, nameEn: "STAT", nameAr: "فوري" },
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));

    const prioritySelect = screen.getByLabelText("Priority") as HTMLSelectElement;
    const optionTexts = Array.from(prioritySelect.options).map((option) => option.textContent ?? "");
    const optionValues = Array.from(prioritySelect.options).map((option) => option.value);

    expect(optionTexts).toContain("Routine (default)");
    expect(optionValues).not.toContain("1");
    expect(optionValues).toContain("2");
    expect(optionValues).toContain("3");
  });

  it("uses sticky booking controls pane styling", async () => {
    setup();
    const stickyPane = document.querySelector(".lg\\:sticky");
    expect(stickyPane).toBeTruthy();
  });

  it("supports availability window navigation controls", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
    fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });

    const startDateInput = screen.getByLabelText("Start date") as HTMLInputElement;
    fireEvent.change(startDateInput, { target: { value: "2027-01-15" } });
    expect(startDateInput.value).toBe("2027-01-15");

    expect(screen.getByRole("button", { name: "Previous slots" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next slots" })).toBeTruthy();
  });

  it("opens override modal and submits override payload", async () => {
    const { onCreateAppointment } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
    fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });
    await userEvent.click(screen.getByRole("button", { name: "Show full days" }));
    await userEvent.click(screen.getByRole("button", { name: /2027-01-02 restricted/i }));

    await userEvent.click(screen.getByRole("button", { name: "Create Appointment" }));

    expect(await screen.findByText("Supervisor Override Required")).toBeTruthy();

    fireEvent.change(await screen.findByPlaceholderText("Supervisor Username"), { target: { value: "sup" } });
    fireEvent.change(screen.getByPlaceholderText("Password"), { target: { value: "pass" } });
    fireEvent.change(screen.getByPlaceholderText("Override Reason"), { target: { value: "urgent" } });

    await userEvent.click(screen.getByRole("button", { name: "Approve & Book" }));

    await waitFor(() => {
      expect(onCreateAppointment).toHaveBeenCalled();
    });

    const callArg = onCreateAppointment.mock.calls[0][0];
    expect(callArg.override).toBeTruthy();
    expect(callArg.override!.supervisorUsername).toBe("sup");
    expect(callArg.override!.reason).toBe("urgent");
  });

  it("lets receptionist request override approval without booking", async () => {
    const { onCreateAppointment } = setup(false, [], undefined, "receptionist");
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
    fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });
    await userEvent.click(screen.getByRole("button", { name: "Show full days" }));
    await userEvent.click(screen.getByRole("button", { name: /2027-01-02 restricted/i }));

    expect(screen.getByRole("button", { name: "Request override approval" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Request override approval" }));
    expect(await screen.findByRole("heading", { name: "Request override approval" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Submit request" }));
    expect(await screen.findByText("Requester reason is required.")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("Explain why this appointment needs override approval"), {
      target: { value: "Urgent clinical request" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Submit request" }));

    await waitFor(() => {
      expect(mockCreateSchedulingOverrideRequest).toHaveBeenCalled();
    });
    expect(onCreateAppointment).not.toHaveBeenCalled();
    const [requestPayload] = mockCreateSchedulingOverrideRequest.mock.calls[0];
    expect(requestPayload).toMatchObject({
      requestType: "create_booking",
      requesterReason: "Urgent clinical request",
      requestPayload: {
        patientId: 9,
        modalityId: 1,
        examTypeId: 101,
        bookingDate: "2027-01-02",
        caseCategory: "oncology",
      },
    });
  });

  it("lets receptionist request closed weekday override approval without booking", async () => {
    const { onCreateAppointment } = setup(false, [], undefined, "receptionist");
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
    fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });
    await userEvent.click(screen.getByRole("button", { name: "Show full days" }));
    await userEvent.click(screen.getByRole("button", { name: "Show hidden days" }));
    await userEvent.click(screen.getByRole("button", { name: /2027-01-04 blocked/i }));

    expect(screen.getByRole("button", { name: "Request override approval" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Request override approval" }));
    fireEvent.change(await screen.findByPlaceholderText("Explain why this appointment needs override approval"), {
      target: { value: "Closed day exception" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Submit request" }));

    await waitFor(() => {
      expect(mockCreateSchedulingOverrideRequest).toHaveBeenCalled();
    });
    expect(onCreateAppointment).not.toHaveBeenCalled();
    expect(mockCreateSchedulingOverrideRequest.mock.calls[0][0]).toMatchObject({
      requestType: "create_booking",
      requesterReason: "Closed day exception",
      requestPayload: {
        bookingDate: "2027-01-04",
      },
    });
  });

  it("lets supervisor request total capacity override approval without immediate booking", async () => {
    const previousRows = mockRowsRef.current;
    mockRowsRef.current = supervisorTotalCapacityRows;
    const { onCreateAppointment } = setup(true, [], undefined, "supervisor");
    try {
      await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
      fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
      fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });
      await userEvent.click(screen.getByRole("button", { name: "Show full days" }));
      await userEvent.click(screen.getByRole("button", { name: /2027-01-06 full/i }));

      expect((screen.getByRole("button", { name: "Create Appointment" }) as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByRole("button", { name: "Request override approval" })).toBeTruthy();
      await userEvent.click(screen.getByRole("button", { name: "Request override approval" }));
      fireEvent.change(await screen.findByPlaceholderText("Explain why this appointment needs override approval"), {
        target: { value: "Need superadmin total capacity approval" },
      });
      await userEvent.click(screen.getByRole("button", { name: "Submit request" }));

      await waitFor(() => {
        expect(mockCreateSchedulingOverrideRequest).toHaveBeenCalled();
      });
      expect(onCreateAppointment).not.toHaveBeenCalled();
      expect(mockCreateSchedulingOverrideRequest.mock.calls[0][0]).toMatchObject({
        requestType: "create_booking",
        requesterReason: "Need superadmin total capacity approval",
        requestPayload: {
          bookingDate: "2027-01-06",
        },
      });
    } finally {
      mockRowsRef.current = previousRows;
    }
  });

  it("does not let receptionist select override-only rows when override requests are disabled in settings", async () => {
    mockReceptionOverrideRequestsEnabled.current = false;
    setup(false, [], undefined, "receptionist");
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
    fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /2027-01-02 restricted/i })).toBeNull();
    });
    expect(screen.queryByRole("button", { name: /2027-01-04 blocked/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Request override approval" })).toBeNull();
  });

  it("keeps non-overridable blocked rows non-actionable for receptionists", async () => {
    setup(false, [], undefined, "receptionist");
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
    fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });

    await userEvent.click(screen.getByRole("button", { name: "Show full days" }));

    expect(screen.queryByRole("button", { name: /2027-01-01 blocked/i })).toBeNull();
    expect((screen.queryByRole("button", { name: "Request override approval" }))).toBeNull();
    expect((screen.getByLabelText("Case Category") as HTMLSelectElement).value).toBe("oncology");
  });

  it("requires special reason when special quota mode is selected", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
    fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });
    await userEvent.click(screen.getByRole("button", { name: "Show full days" }));
    await userEvent.click(screen.getByRole("button", { name: /2027-01-02 restricted/i }));

    fireEvent.change(screen.getByLabelText(/Capacity Resolution Action/), {
      target: { value: "special_quota_extra" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Create Appointment" }));

    expect(await screen.findByText("Special reason code required")).toBeTruthy();
  });

  it("requires special-reason confirmation checkbox when special quota mode is selected", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
    fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });
    await userEvent.click(screen.getByRole("button", { name: "Show full days" }));
    await userEvent.click(screen.getByRole("button", { name: /2027-01-02 restricted/i }));

    fireEvent.change(screen.getByLabelText(/Capacity Resolution Action/), {
      target: { value: "special_quota_extra" },
    });
    fireEvent.change(screen.getByLabelText("Special Reason"), { target: { value: "urgent" } });
    await userEvent.click(screen.getByRole("button", { name: "Create Appointment" }));

    expect(await screen.findByText("Confirm special reason selection")).toBeTruthy();
  });

  it("passes specialReasonNote in create payload when special quota is enabled", async () => {
    const { onCreateAppointment } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
    fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });
    await userEvent.click(screen.getByRole("button", { name: "Show full days" }));
    await userEvent.click(screen.getByRole("button", { name: /2027-01-02 restricted/i }));

    fireEvent.change(screen.getByLabelText(/Capacity Resolution Action/), {
      target: { value: "special_quota_extra" },
    });
    const selects = screen.getAllByRole("combobox");
    const specialReasonSelect = selects[selects.length - 1] as HTMLSelectElement;
    fireEvent.change(specialReasonSelect, { target: { value: "urgent" } });
    await userEvent.click(screen.getByLabelText("I confirm the selected special reason is correct"));
    fireEvent.change(screen.getByPlaceholderText("Optional note"), { target: { value: "High-risk escalation" } });

    await userEvent.click(screen.getByRole("button", { name: "Create Appointment" }));
    expect(await screen.findByText("Supervisor Override Required")).toBeTruthy();

    fireEvent.change(await screen.findByPlaceholderText("Supervisor Username"), { target: { value: "sup" } });
    fireEvent.change(screen.getByPlaceholderText("Password"), { target: { value: "pass" } });
    fireEvent.change(screen.getByPlaceholderText("Override Reason"), { target: { value: "approved" } });
    await userEvent.click(screen.getByRole("button", { name: "Approve & Book" }));

    await waitFor(() => {
      expect(onCreateAppointment).toHaveBeenCalled();
    });

    const callArg = onCreateAppointment.mock.calls[0][0];
    expect(callArg.capacityResolutionMode).toBe("special_quota_extra");
    expect(callArg.useSpecialQuota).toBe(true);
    expect(callArg.specialReasonCode).toBe("urgent");
    expect(callArg.specialReasonNote).toBe("High-risk escalation");
  });

  it("does not offer special_quota_extra mode when no special quota exists", async () => {
    mockRawItemsRef.current = [];
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
    fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });
    const select = screen.getByLabelText(/Capacity Resolution Action/) as HTMLSelectElement;
    expect(Array.from(select.options).some((option) => option.value === "special_quota_extra")).toBe(false);
  });

  it("does not offer special_quota_extra when configured quota is exhausted", async () => {
    mockRawItemsRef.current = [
      {
        date: "2027-01-02",
        specialQuotaSummary: {
          examTypeId: 101,
          configured: 3,
          consumed: 3,
          remaining: 0,
        },
      },
    ];
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
    fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });
    await userEvent.click(screen.getByRole("button", { name: "Show full days" }));
    await userEvent.click(screen.getByRole("button", { name: /2027-01-02 restricted/i }));
    const select = screen.getByLabelText(/Capacity Resolution Action/) as HTMLSelectElement;
    expect(Array.from(select.options).some((option) => option.value === "special_quota_extra")).toBe(false);
  });

  it("non-supervisor UI does not show capacity resolution selector", async () => {
    mockRawItemsRef.current = [];
    setup(false, [], undefined, "receptionist");
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
    fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });
    expect(screen.queryByLabelText(/Capacity Resolution Action/)).toBeNull();
  });

  it("shows assigned receptionist special quota without category or total overrides", async () => {
    mockRowsRef.current = assignedReceptionistQuotaRows;
    const { onCreateAppointment } = setup(false, [], undefined, "receptionist", [], allowedSpecialQuotaDecision);
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
    fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });

    const quotaDate = screen.getByRole("button", { name: /2027-01-02 restricted/i });
    expect(quotaDate).toBeTruthy();
    expect(screen.getByText("Special quota available")).toBeTruthy();
    await userEvent.click(quotaDate);

    const capacityAction = screen.getByLabelText(/Capacity Resolution Action/) as HTMLSelectElement;
    expect(capacityAction.value).toBe("special_quota_extra");
    expect(Array.from(capacityAction.options).map((option) => option.value)).toEqual([
      "standard",
      "special_quota_extra",
    ]);
    fireEvent.change(screen.getByLabelText("Special Reason"), { target: { value: "urgent" } });
    await userEvent.click(screen.getByLabelText("I confirm the selected special reason is correct"));
    await userEvent.click(screen.getByRole("button", { name: "Create Appointment" }));

    await waitFor(() => expect(onCreateAppointment).toHaveBeenCalled());
    expect(onCreateAppointment.mock.calls[0][0]).toMatchObject({
      capacityResolutionMode: "special_quota_extra",
      useSpecialQuota: true,
      specialReasonCode: "urgent",
    });
  });

  it("does not show special quota for an unassigned receptionist", async () => {
    mockRawItemsRef.current = [];
    mockRowsRef.current = [availabilityRowsWithAvailable[0]];
    setup(false, [], undefined, "receptionist");
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
    fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });

    expect(screen.queryByLabelText(/Capacity Resolution Action/)).toBeNull();
  });

  it("keeps an assigned receptionist quota selection during availability loading", async () => {
    mockRowsRef.current = assignedReceptionistQuotaRows;
    setup(false, [], undefined, "receptionist");
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
    fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });
    await userEvent.click(screen.getByRole("button", { name: /2027-01-02 restricted/i }));

    mockRawItemsRef.current = [];
    mockAvailabilityLoading.current = true;
    fireEvent.change(screen.getByLabelText("Case Category"), { target: { value: "non_oncology" } });

    expect((screen.getByLabelText(/Capacity Resolution Action/) as HTMLSelectElement).value).toBe("special_quota_extra");
  });

  it("resets special quota mode after changing to an exam type without an authorized quota", async () => {
    mockRowsRef.current = assignedReceptionistQuotaRows;
    mockRawItemsByExamType.current = { 101: mockRawItemsRef.current, 102: [] };
    setup(false, [], undefined, "receptionist");
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
    fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });
    await userEvent.click(screen.getByRole("button", { name: /2027-01-02 restricted/i }));
    expect((screen.getByLabelText(/Capacity Resolution Action/) as HTMLSelectElement).value).toBe("special_quota_extra");

    fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "102" } });
    await waitFor(() => {
      expect(screen.queryByLabelText(/Capacity Resolution Action/)).toBeNull();
    });
    fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });
    await waitFor(() => {
      expect((screen.getByLabelText(/Capacity Resolution Action/) as HTMLSelectElement).value).toBe("standard");
    });
  });

  it("retains supervisor capacity control boundaries", async () => {
    setup(true, [], undefined, "supervisor");
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
    fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });
    const supervisorOptions = Array.from((screen.getByLabelText(/Capacity Resolution Action/) as HTMLSelectElement).options).map((option) => option.value);
    expect(supervisorOptions).toEqual(["standard", "category_override", "special_quota_extra"]);

  });

  it("retains super-admin total-capacity control", async () => {
    setup(true, [], undefined, "super_admin");
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
    fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });

    const options = Array.from((screen.getByLabelText(/Capacity Resolution Action/) as HTMLSelectElement).options).map((option) => option.value);
    expect(options).toEqual(["standard", "category_override", "total_capacity_override", "special_quota_extra"]);
  });

  describe("success state actions", () => {
  beforeEach(() => {
    mockRowsRef.current = availabilityRowsWithAvailable;
    mockQueueWalkInEnabled.current = true;
  });

    function setupSuccess() {
      const onCreateAppointment = vi.fn(async (payload: CreateBookingRequest): Promise<BookingResponse> => ({
        booking: {
          id: 42,
          patientId: payload.patientId,
          modalityId: payload.modalityId,
          examTypeId: payload.examTypeId,
          reportingPriorityId: null,
          bookingDate: "2027-01-03",
          bookingTime: null,
          caseCategory: payload.caseCategory,
          status: "scheduled" as const,
          notes: payload.notes,
          policyVersionId: 1,
          capacityResolutionMode: payload.capacityResolutionMode ?? "standard",
          usesSpecialQuota: payload.capacityResolutionMode === "special_quota_extra",
          createdAt: "",
          updatedAt: "",
        },
        decision: {},
        wasOverride: false,
      }));

      const onEvaluateAvailability = vi.fn(async (): Promise<SchedulingDecisionDto> => ({
        isAllowed: true,
        requiresSupervisorOverride: false,
        displayStatus: "available" as const,
        suggestedBookingMode: "standard" as const,
        consumedCapacityMode: "standard" as const,
        remainingStandardCapacity: 5,
        remainingSpecialQuota: null,
        matchedRuleIds: [],
        reasons: [],
        policy: { policySetKey: "default", versionId: 1, versionNo: 1, configHash: "x" },
        decisionTrace: { evaluatedAt: "", input: {} },
      }));

      render(
        <LanguageProvider>
          <MemoryRouter initialEntries={["/appointments"]}>
            <Routes>
              <Route path="/appointments" element={
                <CreateAppointmentTab
                  patientLookups={{}}
                  modalityOptions={[
                    { id: 1, name: "CT", nameAr: "أشعة مقطعية", nameEn: "CT", code: "CT", isActive: true, safetyWarningEn: null, safetyWarningAr: null, safetyWarningEnabled: false },
                  ]}
                  examTypeOptions={[]}
                  specialReasonOptions={[]}
                  priorityOptions={[]}
                  schedulingEngineEnabled
                  canUseNonStandardCapacityModes
                  onCreateAppointment={onCreateAppointment}
                  onEvaluateAvailability={onEvaluateAvailability}
                />
              } />
              <Route path="/print" element={<PrintPlaceholder />} />
            </Routes>
          </MemoryRouter>
        </LanguageProvider>
      );

      return { onCreateAppointment, onEvaluateAvailability };
    }

    it("success summary respects selected entity display mode", async () => {
      localStorage.setItem("rispro:create-appointment:entity-display-mode", "both");
      setupSuccess();
      await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
      fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
      fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });
      await userEvent.click(await screen.findByRole("button", { name: /2027-01-03/i }));
      await userEvent.click(screen.getByRole("button", { name: "Create Appointment" }));

      await waitFor(() => {
        expect(screen.getByText("Appointment Created Successfully")).toBeTruthy();
      });
      expect(screen.getByText(/CT —/)).toBeTruthy();
      expect(screen.getByText(/CT Head —/)).toBeTruthy();
    });

    it("View Details navigates to /print?appointmentId=<id>", async () => {
      setupSuccess();
      const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
      await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
      fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
      fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });
      await userEvent.click(await screen.findByRole("button", { name: /2027-01-03/i }));
      await userEvent.click(screen.getByRole("button", { name: "Create Appointment" }));

      await waitFor(() => {
        expect(screen.getByText("Appointment Created Successfully")).toBeTruthy();
      });
      expect(screen.getByRole("button", { name: "View Appointment Link" })).toBeTruthy();
      await userEvent.click(screen.getByRole("button", { name: "View Appointment Link" }));
      expect(openSpy).toHaveBeenCalledWith(
        "https://rispro.nccb.com.ly/public/appointment?t=token-42",
        "_blank",
        "noopener,noreferrer"
      );

      await userEvent.click(screen.getByRole("button", { name: "View Details" }));

      await waitFor(() => {
        expect(screen.getByTestId("print-page").textContent).toContain("/print?appointmentId=42");
      });
    });

    it("Open WhatsApp composes the appointment reminder message", async () => {
      setupSuccess();
      const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
      await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
      fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
      fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });
      await userEvent.click(await screen.findByRole("button", { name: /2027-01-03/i }));
      await userEvent.click(screen.getByRole("button", { name: "Create Appointment" }));

      await waitFor(() => {
        expect(screen.getByText("Appointment Created Successfully")).toBeTruthy();
      });

      await userEvent.click(screen.getByRole("button", { name: "Open WhatsApp" }));

      expect(openSpy).toHaveBeenCalledTimes(1);
      const [url, target, features] = openSpy.mock.calls[0] ?? [];
      expect(url).toContain("https://wa.me/218912345678?text=");
      expect(decodeURIComponent(String(url))).toContain("Reminder: you have an appointment on");
      expect(decodeURIComponent(String(url))).toContain("03/01/2027");
      expect(decodeURIComponent(String(url))).toContain("https://rispro.nccb.com.ly/public/appointment?t=token-42");
      expect(target).toBe("_blank");
      expect(features).toBe("noopener,noreferrer");
    });

    it("Print View navigates to /print?appointmentId=<id>", async () => {
      setupSuccess();
      await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
      fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
      fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });
      await userEvent.click(await screen.findByRole("button", { name: /2027-01-03/i }));
      await userEvent.click(screen.getByRole("button", { name: "Create Appointment" }));

      await waitFor(() => {
        expect(screen.getByText("Appointment Created Successfully")).toBeTruthy();
      });

      await userEvent.click(screen.getByRole("button", { name: "Print View" }));

      await waitFor(() => {
        expect(screen.getByTestId("print-page").textContent).toContain("/print?appointmentId=42");
      });
    });

    it("Print Now stays on the page and prints immediately", async () => {
      setupSuccess();
      await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
      fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
      fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });
      await userEvent.click(await screen.findByRole("button", { name: /2027-01-03/i }));
      await userEvent.click(screen.getByRole("button", { name: "Create Appointment" }));

      await waitFor(() => {
        expect(screen.getByText("Appointment Created Successfully")).toBeTruthy();
      });

      await userEvent.click(screen.getByRole("button", { name: "Print Now" }));

      await waitFor(() => {
        expect(mockPrintAppointmentSlipById).toHaveBeenCalledWith(42);
      });
      expect(screen.queryByTestId("print-page")).toBeNull();
    });

    it("Create Another resets form state", async () => {
      setupSuccess();
      await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
      fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
      fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });
      await userEvent.click(await screen.findByRole("button", { name: /2027-01-03/i }));
      await userEvent.click(screen.getByRole("button", { name: "Create Appointment" }));

      await waitFor(() => {
        expect(screen.getByText("Appointment Created Successfully")).toBeTruthy();
      });

      await userEvent.click(screen.getByRole("button", { name: "Create Another" }));

      expect(screen.queryByText("Appointment Created Successfully")).toBeNull();
      expect((screen.getByLabelText("Modality") as HTMLSelectElement).value).toBe("");
      expect((screen.getByLabelText("Exam Type") as HTMLSelectElement).value).toBe("");
    });
  });

});

describe("inline modality safety workflow", () => {
  const standardModality: ModalityDto = {
    id: 1,
    name: "CT",
    nameAr: "CT",
    nameEn: "CT",
    code: "CT",
    isActive: true,
    safetyWarningEn: "Radiation risk",
    safetyWarningAr: "Radiation risk",
    safetyWarningEnabled: true,
    safetyWorkflowType: "standard_acknowledgement",
  };
  const mriModality: ModalityDto = {
    id: 2,
    name: "MRI",
    nameAr: "MRI",
    nameEn: "MRI",
    code: "MRI",
    isActive: true,
    safetyWarningEn: "Magnet safety",
    safetyWarningAr: "Magnet safety",
    safetyWarningEnabled: true,
    safetyWorkflowType: "mri_primary_implant_screening",
  };
  const examTypes = [
    { id: 101, name: "CT exam", nameEn: "CT exam", nameAr: "CT exam", code: "CT-1", modalityId: 1, isActive: true },
    { id: 201, name: "MRI exam", nameEn: "MRI exam", nameAr: "MRI exam", code: "MRI-1", modalityId: 2, isActive: true },
  ];

  beforeEach(() => {
    mockRowsRef.current = availabilityRowsWithAvailable;
  });

  afterEach(() => {
    localStorage.setItem("rispro-language", "en");
  });

  async function selectPatientAndModality(modalityId: number) {
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
    fireEvent.change(screen.getByLabelText("Modality"), { target: { value: String(modalityId) } });
  }

  it("gates the standard workflow inline, restores it after acknowledgement, and never shows the late modal", async () => {
    setup(true, [], [standardModality], "receptionist", [], undefined, examTypes);
    await selectPatientAndModality(1);

    const grid = screen.getByTestId("appointment-create-grid");
    const formRegion = screen.getByTestId("appointment-form-region");
    const availabilityRegion = screen.getByTestId("appointment-availability-region");
    expect(formRegion.parentElement).toBe(grid);
    expect(availabilityRegion.parentElement).toBe(grid);
    expect(screen.getByText("Complete the required safety screening to view available appointment days.")).toBeTruthy();
    expect(screen.queryByLabelText("Start date")).toBeNull();
    expect(screen.getByText("Radiation risk")).toBeTruthy();
    expect(screen.getByText("Modality safety warning")).toBeTruthy();
    expect(screen.getAllByText("Required before booking").length).toBeGreaterThan(0);
    expect(screen.getByText("I have reviewed this warning with the patient and completed the required initial check.")).toBeTruthy();
    expect(screen.queryByLabelText("Exam Type")).toBeNull();
    expect(screen.queryByText("Safety Confirmation")).toBeNull();
    expect(screen.queryByLabelText("Capacity Action")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Acknowledge and continue" }));

    expect(screen.getByText("Modality safety warning acknowledged")).toBeTruthy();
    expect(screen.getByLabelText("Exam Type")).toBeTruthy();
    expect(screen.queryByTestId("safety-locked-availability")).toBeNull();
    expect(screen.getByLabelText("Start date")).toBeTruthy();
    expect(screen.getByTestId("appointment-create-grid")).toBe(grid);
    expect(screen.getByTestId("appointment-form-region")).toBe(formRegion);
    expect(screen.getByTestId("appointment-availability-region")).toBe(availabilityRegion);
    expect(screen.queryByText("Safety Confirmation")).toBeNull();
  });

  it("shows MRI choices, requires implant site, and renders the correct green and yellow badges", async () => {
    setup(true, [], [mriModality], "supervisor", [], undefined, examTypes);
    await selectPatientAndModality(2);

    expect(screen.getByRole("group", { name: "MRI primary screening" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Patient reports no known implant, implanted device, or metallic foreign body" })).toBeTruthy();
    const implantRadio = screen.getByRole("radio", { name: "Patient reports an implant, implanted device, or metallic foreign body" });
    await userEvent.click(implantRadio);
    expect((implantRadio as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText("Implant/device site")).toBeTruthy();
    expect(screen.getByLabelText("Implant/device description")).toBeTruthy();
    expect(screen.getByLabelText("Previously reviewed by, as reported")).toBeTruthy();
    expect(screen.getByText("Enter the implant/device site to continue.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Complete primary screening" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(screen.getByLabelText("Implant/device site"), "left hip");
    expect(screen.queryByText("Enter the implant/device site to continue.")).toBeNull();
    expect((screen.getByRole("button", { name: "Complete primary screening" }) as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Complete primary screening" }));

    expect(screen.getByText("MRI primary screening complete")).toBeTruthy();
    expect(screen.getByText("Implant reported — MRI staff review required")).toBeTruthy();
    expect(screen.getByText("Implant reported — MRI staff review required").querySelector("svg")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Change screening response" }));
    await userEvent.click(screen.getByText("Patient reports no known implant, implanted device, or metallic foreign body"));
    await userEvent.click(screen.getByRole("button", { name: "Complete primary screening" }));
    expect(screen.getByText("MRI primary screening complete — no implant reported")).toBeTruthy();
  });

  it("shows only localized Arabic MRI workflow text and localized completed badges", async () => {
    localStorage.setItem("rispro-language", "ar");
    setup(true, [], [{ ...mriModality, safetyWarningAr: "تحذير المغناطيس" }], "supervisor", [], undefined, examTypes);
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
    fireEvent.change(screen.getByLabelText("الجهاز"), { target: { value: "2" } });

    expect(screen.getByRole("heading", { name: "التحقق الأولي من سلامة الرنين المغناطيسي" })).toBeTruthy();
    expect(screen.getByText("تحذير المغناطيس")).toBeTruthy();
    expect(screen.getByText("أكمل التحقق المطلوب من السلامة لعرض الأيام المتاحة للحجز.")).toBeTruthy();
    expect(screen.queryByText("MRI primary screening")).toBeNull();
    expect(screen.queryByText("Complete the required safety screening to view available appointment days.")).toBeNull();

    const implantRadio = screen.getByRole("radio", { name: "تم التحقق من الجسم المزروع من قبل الفريق الطبي مبدئياً" });
    await userEvent.click(implantRadio);
    expect(screen.getByLabelText("موضع الجهاز المزروع أو التركيب المعدني أو الجسم المعدني")).toBeTruthy();
    expect(screen.getByText("أدخل موضع الجهاز المزروع أو التركيب المعدني أو الجسم المعدني للمتابعة.")).toBeTruthy();
    const completeButton = screen.getByRole("button", { name: "حفظ التحقق الأولي والمتابعة" }) as HTMLButtonElement;
    expect(completeButton.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText("موضع الجهاز المزروع أو التركيب المعدني أو الجسم المعدني"), "الورك الأيسر");
    await userEvent.click(completeButton);

    expect(screen.getByText("اكتمل التحقق الأولي لسلامة الرنين")).toBeTruthy();
    expect(screen.getByText("تم الإبلاغ عن جهاز مزروع أو تركيب معدني أو جسم معدني — يلزم تقييم فريق الرنين المغناطيسي")).toBeTruthy();
    expect(screen.getByRole("button", { name: "تعديل إجابة التحقق الأولي" })).toBeTruthy();
    expect(screen.queryByText("MRI primary screening complete")).toBeNull();
  });

  it("resets completion when patient or modality changes", async () => {
    setup(true, [], [standardModality, { ...standardModality, id: 2, code: "CT2", name: "CT2", nameEn: "CT2" }], "supervisor", [], undefined, examTypes);
    await selectPatientAndModality(1);
    await userEvent.click(screen.getByRole("button", { name: "Acknowledge and continue" }));
    expect(screen.getByLabelText("Exam Type")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Select Other Patient" }));
    fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
    await waitFor(() => expect(screen.queryByLabelText("Exam Type")).toBeNull());
    await userEvent.click(screen.getByRole("button", { name: "Acknowledge and continue" }));
    fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "2" } });
    await waitFor(() => expect(screen.queryByLabelText("Exam Type")).toBeNull());
  });

  it("does not reset completion when exam, date, or capacity mode changes", async () => {
    setup(true, [], [standardModality], "supervisor", [], undefined, examTypes);
    await selectPatientAndModality(1);
    await userEvent.click(screen.getByRole("button", { name: "Acknowledge and continue" }));
    fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });
    await userEvent.click(screen.getByRole("button", { name: /2027-01-03/i }));
    const capacity = screen.queryByLabelText("Capacity Action");
    if (capacity) fireEvent.change(capacity, { target: { value: "category_override" } });
    expect(screen.getByText("Modality safety warning acknowledged")).toBeTruthy();
  });

  it.each(["supervisor", "super_admin"] as const)("does not allow %s to bypass the inline gate", async (role) => {
    setup(true, [], [standardModality], role, [], undefined, examTypes);
    await selectPatientAndModality(1);
    expect(screen.queryByLabelText("Exam Type")).toBeNull();
    expect(screen.queryByLabelText("Capacity Action")).toBeNull();
    expect(screen.queryByRole("button", { name: "Create Appointment" })).toBeNull();
  });

  it("leaves warning-disabled modalities unchanged", async () => {
    setup(true, [], [{ ...standardModality, safetyWarningEnabled: false }], "receptionist", [], undefined, examTypes);
    await selectPatientAndModality(1);
    expect(screen.getByLabelText("Exam Type")).toBeTruthy();
    expect(screen.queryByText("Modality safety warning")).toBeNull();
  });

  it("blocks the workspace for an enabled modality with no configured warning text", async () => {
    setup(true, [], [{ ...standardModality, safetyWarningEn: null, safetyWarningAr: null }], "supervisor", [], undefined, examTypes);
    await selectPatientAndModality(1);
    expect(screen.getByText("Booking is blocked because this modality's mandatory safety warning has not been configured. Contact an administrator.")).toBeTruthy();
    expect(screen.queryByLabelText("Exam Type")).toBeNull();
    expect(screen.queryByLabelText("Capacity Action")).toBeNull();
  });

  it("localizes the blocking configuration error in Arabic", async () => {
    localStorage.setItem("rispro-language", "ar");
    setup(true, [], [{ ...standardModality, safetyWarningEn: null, safetyWarningAr: null }], "supervisor", [], undefined, examTypes);
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
    fireEvent.change(screen.getByLabelText("الجهاز"), { target: { value: "1" } });

    expect(screen.getByText("تعذر استكمال الحجز لأن تنبيه السلامة الإلزامي للفحص المحدد غير مُهيّأ. يُرجى التواصل مع مسؤول النظام.")).toBeTruthy();
    expect(screen.queryByText("Booking is blocked because this modality's mandatory safety warning has not been configured. Contact an administrator.")).toBeNull();
    expect(screen.queryByLabelText("نوع الفحص")).toBeNull();
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { CreateAppointmentTab } from "../components/CreateAppointmentTab";
import type { AvailabilityRowViewModel } from "../hooks/availability-row-mapper";
import type { BookingResponse, CreateBookingRequest, SchedulingDecisionDto } from "../types";

vi.mock("../components/PatientSearchSection", () => ({
  PatientSearchSection: ({ onSelectPatient }: { onSelectPatient: (p: unknown) => void }) => (
    <button
      type="button"
      onClick={() =>
        onSelectPatient({
          id: 9,
          arabicFullName: "Test Patient",
          englishFullName: "Test Patient",
          nationalId: "123",
          mrn: "MRN-9",
          sex: "M",
          ageYears: 30,
        })
      }
    >
      Select Test Patient
    </button>
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
  },
];

const mockRowsRef = { current: availabilityRows };
const mockRawItemsRef = {
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
  useAppointmentAvailability: () => ({
    enabled: true,
    rows: mockRowsRef.current,
    rawItems: mockRawItemsRef.current,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("../api", () => ({
  useV2ExamTypes: (modalityId: number | null) => {
    if (modalityId === 1) {
      return {
        data: [
          { id: 101, name: "CT Head", code: "CTH", modalityId: 1, isActive: true },
          { id: 102, name: "CT Chest", code: "CTC", modalityId: 1, isActive: true },
        ],
      };
    }
    if (modalityId === 2) {
      return {
        data: [
          { id: 201, name: "MRI Brain", code: "MRB", modalityId: 2, isActive: true },
        ],
      };
    }
    return { data: [] };
  },
  useV2Suggestions: (_params: { modalityId: number; days: number; examTypeId: number; caseCategory: string } | undefined) => {
    if (_params == null) {
      return { data: undefined, isLoading: false, isError: false };
    }
    return {
      data: {
        items: [
          { modalityId: _params.modalityId, date: "2027-01-10", decision: { displayStatus: "available" } },
          { modalityId: _params.modalityId, date: "2027-01-11", decision: { displayStatus: "available" } },
        ],
      },
      isLoading: false,
      isError: false,
    };
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

function setup(canUseNonStandardCapacityModes: boolean = true) {
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

  const onEvaluateAvailability = vi.fn(async (): Promise<SchedulingDecisionDto> => ({
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
    <MemoryRouter initialEntries={["/v3/appointments/create"]}>
      <Routes>
        <Route path="/v3/appointments/create" element={
          <CreateAppointmentTab
            patientLookups={{}}
            modalityOptions={[
              { id: 1, name: "CT", nameAr: "CT", nameEn: "CT", code: "CT", isActive: true, safetyWarningEn: null, safetyWarningAr: null, safetyWarningEnabled: false },
              { id: 2, name: "MRI", nameAr: "MRI", nameEn: "MRI", code: "MRI", isActive: true, safetyWarningEn: null, safetyWarningAr: null, safetyWarningEnabled: false },
            ]}
            examTypeOptions={[]}
            specialReasonOptions={[{ code: "urgent", labelAr: "", labelEn: "Urgent", isActive: true }]}
            priorityOptions={[]}
            schedulingEngineEnabled
            canUseNonStandardCapacityModes={canUseNonStandardCapacityModes}
            onCreateAppointment={onCreateAppointment}
            onEvaluateAvailability={onEvaluateAvailability}
          />
        } />
        <Route path="/print" element={<PrintPlaceholder />} />
      </Routes>
    </MemoryRouter>
  );

  return { onCreateAppointment, onEvaluateAvailability };
}

function PrintPlaceholder() {
  const location = useLocation();
  return <div data-testid="print-page">{`Print Page ${location.pathname}${location.search}`}</div>;
}

describe("CreateAppointmentTab UI interactions", () => {
  beforeEach(() => {
    mockRawItemsRef.current = [
      {
        date: "2027-01-02",
        specialQuotaSummary: {
          examTypeId: 101,
          configured: 2,
          consumed: 0,
          remaining: 2,
        },
      },
    ];
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

  it("keeps blocked row non-clickable", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
    fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });

    await userEvent.click(screen.getByRole("button", { name: /2027-01-01 blocked/i }));

    expect((screen.getByLabelText("Appointment Date") as HTMLInputElement).value).toBe("");
  });

  it("allows restricted and full-with-override row selection", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
    fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });

    await userEvent.click(screen.getByRole("button", { name: /2027-01-02 restricted/i }));
    expect((screen.getByLabelText("Appointment Date") as HTMLInputElement).value).toBe("2027-01-02");

    await userEvent.click(screen.getByRole("button", { name: /2027-01-03 full/i }));
    expect((screen.getByLabelText("Appointment Date") as HTMLInputElement).value).toBe("2027-01-03");
  });

  it("opens override modal and submits override payload", async () => {
    const { onCreateAppointment } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
    fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });
    await userEvent.click(screen.getByRole("button", { name: /2027-01-02 restricted/i }));

    await userEvent.click(screen.getByRole("button", { name: "Create Appointment" }));

    expect(await screen.findByText("Supervisor Override Required")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("Supervisor username"), { target: { value: "sup" } });
    fireEvent.change(screen.getByPlaceholderText("Supervisor password"), { target: { value: "pass" } });
    fireEvent.change(screen.getByPlaceholderText("Override reason"), { target: { value: "urgent" } });

    await userEvent.click(screen.getByRole("button", { name: "Confirm Override" }));

    await waitFor(() => {
      expect(onCreateAppointment).toHaveBeenCalled();
    });

    const callArg = onCreateAppointment.mock.calls[0][0];
    expect(callArg.override).toBeTruthy();
    expect(callArg.override!.supervisorUsername).toBe("sup");
    expect(callArg.override!.reason).toBe("urgent");
  });

  it("requires special reason when special quota mode is selected", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
    fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });
    await userEvent.click(screen.getByRole("button", { name: /2027-01-02 restricted/i }));

    fireEvent.change(screen.getByLabelText("Capacity Resolution Action"), {
      target: { value: "special_quota_extra" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Create Appointment" }));

    expect(await screen.findByText("Special reason code required")).toBeTruthy();
  });

  it("passes specialReasonNote in create payload when special quota is enabled", async () => {
    const { onCreateAppointment } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
    fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });
    await userEvent.click(screen.getByRole("button", { name: /2027-01-02 restricted/i }));

    fireEvent.change(screen.getByLabelText("Capacity Resolution Action"), {
      target: { value: "special_quota_extra" },
    });
    const selects = screen.getAllByRole("combobox");
    const specialReasonSelect = selects[selects.length - 1] as HTMLSelectElement;
    fireEvent.change(specialReasonSelect, { target: { value: "urgent" } });
    fireEvent.change(screen.getByPlaceholderText("Optional note"), { target: { value: "High-risk escalation" } });

    await userEvent.click(screen.getByRole("button", { name: "Create Appointment" }));
    expect(await screen.findByText("Supervisor Override Required")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("Supervisor username"), { target: { value: "sup" } });
    fireEvent.change(screen.getByPlaceholderText("Supervisor password"), { target: { value: "pass" } });
    fireEvent.change(screen.getByPlaceholderText("Override reason"), { target: { value: "approved" } });
    await userEvent.click(screen.getByRole("button", { name: "Confirm Override" }));

    await waitFor(() => {
      expect(onCreateAppointment).toHaveBeenCalled();
    });

    const callArg = onCreateAppointment.mock.calls[0][0];
    expect(callArg.capacityResolutionMode).toBe("special_quota_extra");
    expect(callArg.useSpecialQuota).toBe(true);
    expect(callArg.specialReasonCode).toBe("urgent");
    expect(callArg.specialReasonNote).toBe("High-risk escalation");
  });

  it("disables special_quota_extra mode when no special quota exists", async () => {
    mockRawItemsRef.current = [];
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
    fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });
    const select = screen.getByLabelText("Capacity Resolution Action") as HTMLSelectElement;
    const option = Array.from(select.options).find((o) => o.value === "special_quota_extra");
    expect(option?.disabled).toBe(true);
  });

  it("disables special_quota_extra when configured quota exists but remaining is 0 for selected date", async () => {
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
    await userEvent.click(screen.getByRole("button", { name: /2027-01-02 restricted/i }));
    const select = screen.getByLabelText("Capacity Resolution Action") as HTMLSelectElement;
    const option = Array.from(select.options).find((o) => o.value === "special_quota_extra");
    expect(option?.disabled).toBe(true);
  });

  it("non-supervisor UI does not show capacity resolution selector", async () => {
    setup(false);
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
    fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });
    expect(screen.queryByLabelText("Capacity Resolution Action")).toBeNull();
  });

  describe("success state actions", () => {
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
        <MemoryRouter initialEntries={["/v3/appointments/create"]}>
          <Routes>
            <Route path="/v3/appointments/create" element={
              <CreateAppointmentTab
                patientLookups={{}}
                modalityOptions={[
                  { id: 1, name: "CT", nameAr: "CT", nameEn: "CT", code: "CT", isActive: true, safetyWarningEn: null, safetyWarningAr: null, safetyWarningEnabled: false },
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
      );

      return { onCreateAppointment, onEvaluateAvailability };
    }

    it("View Details navigates to /print?source=v2&v2BookingId=<id>", async () => {
      setupSuccess();
      await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
      fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
      fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });
      await userEvent.click(screen.getByRole("button", { name: /2027-01-03/i }));
      await userEvent.click(screen.getByRole("button", { name: "Create Appointment" }));

      await waitFor(() => {
        expect(screen.getByText("Appointment Created Successfully")).toBeTruthy();
      });

      await userEvent.click(screen.getByRole("button", { name: "View Details" }));

      await waitFor(() => {
        expect(screen.getByTestId("print-page").textContent).toContain("/print?source=v2&v2BookingId=42");
      });
    });

    it("Print Slip navigates to /print?source=v2&v2BookingId=<id>&autoprint=1", async () => {
      setupSuccess();
      await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
      fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
      fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });
      await userEvent.click(screen.getByRole("button", { name: /2027-01-03/i }));
      await userEvent.click(screen.getByRole("button", { name: "Create Appointment" }));

      await waitFor(() => {
        expect(screen.getByText("Appointment Created Successfully")).toBeTruthy();
      });

      await userEvent.click(screen.getByRole("button", { name: "Print Slip" }));

      await waitFor(() => {
        expect(screen.getByTestId("print-page").textContent).toContain("/print?source=v2&v2BookingId=42&autoprint=1");
      });
    });

    it("Create Another resets form state", async () => {
      setupSuccess();
      await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
      fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
      fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });
      await userEvent.click(screen.getByRole("button", { name: /2027-01-03/i }));
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

describe("safety modal interactions", () => {
    beforeEach(() => {
      mockRowsRef.current = availabilityRowsWithAvailable;
    });

    function setupWithSafetyWarning() {
      const onCreateAppointment = vi.fn(async (payload: CreateBookingRequest): Promise<BookingResponse> => ({
        booking: {
          id: 50,
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
        <MemoryRouter initialEntries={["/v3/appointments/create"]}>
          <Routes>
            <Route path="/v3/appointments/create" element={
              <CreateAppointmentTab
                patientLookups={{}}
                modalityOptions={[
                  { id: 1, name: "CT", nameAr: "CT", nameEn: "CT", code: "CT", isActive: true, safetyWarningEn: "Radiation risk", safetyWarningAr: "Radiation risk", safetyWarningEnabled: true },
                  { id: 2, name: "MRI", nameAr: "MRI", nameEn: "MRI", code: "MRI", isActive: true, safetyWarningEn: "Magnet safety", safetyWarningAr: "Magnet safety", safetyWarningEnabled: true },
                ]}
                examTypeOptions={[]}
                specialReasonOptions={[]}
                priorityOptions={[{ id: 1, nameEn: "Urgent", nameAr: "Urgent" }]}
                schedulingEngineEnabled
                canUseNonStandardCapacityModes
                onCreateAppointment={onCreateAppointment}
                onEvaluateAvailability={onEvaluateAvailability}
              />
            } />
            <Route path="/print" element={<PrintPlaceholder />} />
          </Routes>
        </MemoryRouter>
      );

      return { onCreateAppointment, onEvaluateAvailability };
    }

    it("safety modal blocks submit before confirmation", async () => {
      const { onCreateAppointment } = setupWithSafetyWarning();
      await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
      fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
      fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });
      await userEvent.click(screen.getByRole("button", { name: /2027-01-03/i }));
      await userEvent.click(screen.getByRole("button", { name: "Create Appointment" }));

      expect(await screen.findByText("Safety Confirmation")).toBeTruthy();
      expect(onCreateAppointment).not.toHaveBeenCalled();
    });

    it("confirm safety warning allows submit to proceed", async () => {
      const { onCreateAppointment } = setupWithSafetyWarning();
      await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
      fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
      fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });
      await userEvent.click(screen.getByRole("button", { name: /2027-01-03/i }));
      await userEvent.click(screen.getByRole("button", { name: "Create Appointment" }));

      await screen.findByText("Safety Confirmation");
      await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

      await waitFor(() => {
        expect(onCreateAppointment).toHaveBeenCalled();
      });
    });

    it("modality change resets safety acknowledgment", async () => {
      const { onCreateAppointment } = setupWithSafetyWarning();

      await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));

      // Select modality A (CT) with safety warning
      fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
      fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });
      await userEvent.click(screen.getByRole("button", { name: /2027-01-03/i }));
      await userEvent.click(screen.getByRole("button", { name: "Create Appointment" }));

      // Confirm safety for modality A
      await screen.findByText("Safety Confirmation");
      await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

      await waitFor(() => {
        expect(onCreateAppointment).toHaveBeenCalledTimes(1);
      });

      // Click Create Another to go back to form
      await userEvent.click(screen.getByRole("button", { name: "Create Another" }));

      await waitFor(() => {
        expect(screen.getByLabelText("Modality")).toBeTruthy();
      });

      // Switch to modality B (MRI) - also has safety, should reset
      fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "2" } });
      fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "201" } });
      await userEvent.click(screen.getByRole("button", { name: /2027-01-03/i }));
      await userEvent.click(screen.getByRole("button", { name: "Create Appointment" }));

      expect(await screen.findByText("Safety Confirmation")).toBeTruthy();
      expect(onCreateAppointment).toHaveBeenCalledTimes(1);
    });

    it("reset button clears safety acknowledgment and modal", async () => {
      setupWithSafetyWarning();
      await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
      fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
      fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });
      await userEvent.click(screen.getByRole("button", { name: /2027-01-03/i }));
      await userEvent.click(screen.getByRole("button", { name: "Create Appointment" }));

      await screen.findByText("Safety Confirmation");
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(screen.queryByText("Safety Confirmation")).toBeNull();

      await userEvent.click(screen.getByRole("button", { name: "Reset" }));

      await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
      fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
      fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });
      await userEvent.click(screen.getByRole("button", { name: /2027-01-03/i }));
      await userEvent.click(screen.getByRole("button", { name: "Create Appointment" }));

      await screen.findByText("Safety Confirmation");
    });

    it("selected priority is passed in create payload", async () => {
      const { onCreateAppointment } = setupWithSafetyWarning();
      await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
      fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
      fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });
      fireEvent.change(screen.getByLabelText("Priority"), { target: { value: "1" } });
      await userEvent.click(screen.getByRole("button", { name: /2027-01-03/i }));
      await userEvent.click(screen.getByRole("button", { name: "Create Appointment" }));

      await screen.findByText("Safety Confirmation");
      await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

      await waitFor(() => {
        expect(onCreateAppointment).toHaveBeenCalled();
      });

      const callArg = onCreateAppointment.mock.calls[0][0];
      expect(callArg.reportingPriorityId).toBe(1);
    });

    it("walk-in checkbox is passed in create payload", async () => {
      const { onCreateAppointment } = setupWithSafetyWarning();
      await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
      fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
      fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });
      await userEvent.click(screen.getByRole("checkbox", { name: "Walk-in patient" }));
      await userEvent.click(screen.getByRole("button", { name: /2027-01-03/i }));
      await userEvent.click(screen.getByRole("button", { name: "Create Appointment" }));

      await screen.findByText("Safety Confirmation");
      await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

      await waitFor(() => {
        expect(onCreateAppointment).toHaveBeenCalled();
      });

      const callArg = onCreateAppointment.mock.calls[0][0];
      expect(callArg.isWalkIn).toBe(true);
    });
  });
});

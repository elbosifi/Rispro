import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
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
    remainingCapacity: null,
    dailyCapacity: null,
    reasonText: "Blocked",
    requiresSupervisorOverride: false,
  },
  {
    date: "2027-01-02",
    dayLabel: "Sat, Jan 2",
    status: "restricted",
    remainingCapacity: 1,
    dailyCapacity: 20,
    reasonText: "Supervisor required",
    requiresSupervisorOverride: true,
  },
  {
    date: "2027-01-03",
    dayLabel: "Sun, Jan 3",
    status: "full",
    remainingCapacity: 0,
    dailyCapacity: 20,
    reasonText: "Full but overridable",
    requiresSupervisorOverride: true,
  },
];

vi.mock("../hooks/useAppointmentAvailability", () => ({
  useAppointmentAvailability: () => ({
    enabled: true,
    rows: availabilityRows,
    rawItems: [],
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
}));

function setup() {
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
              { id: 1, name: "CT", code: "CT", isActive: true },
              { id: 2, name: "MRI", code: "MRI", isActive: true },
            ]}
            examTypeOptions={[]}
            specialReasonOptions={[{ code: "urgent", labelAr: "", labelEn: "Urgent", isActive: true }]}
            schedulingEngineEnabled
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
  return <div data-testid="print-page">Print Page</div>;
}

describe("CreateAppointmentTab UI interactions", () => {
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

  it("requires special reason when special quota is enabled", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Select Test Patient" }));
    fireEvent.change(screen.getByLabelText("Modality"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Exam Type"), { target: { value: "101" } });
    await userEvent.click(screen.getByRole("button", { name: /2027-01-02 restricted/i }));

    await userEvent.click(screen.getByRole("checkbox", { name: "Use special quota" }));
    await userEvent.click(screen.getByRole("button", { name: "Create Appointment" }));

    expect(await screen.findByText("Special reason code required")).toBeTruthy();
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
                  { id: 1, name: "CT", code: "CT", isActive: true },
                ]}
                examTypeOptions={[]}
                specialReasonOptions={[]}
                schedulingEngineEnabled
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

    it("View Details navigates to /print?appointmentId=<id>", async () => {
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
        expect(screen.getByTestId("print-page")).toBeTruthy();
      });
    });

    it("Print Slip navigates to /print?appointmentId=<id>&autoprint=1", async () => {
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
        expect(screen.getByTestId("print-page")).toBeTruthy();
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
});

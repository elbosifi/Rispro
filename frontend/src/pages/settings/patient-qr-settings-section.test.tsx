import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import PatientQrSettingsSection from "./patient-qr-settings-section";
import {
  fetchModalitiesSettings,
  fetchPatientQrSettings,
  DEFAULT_PATIENT_QR_SETTINGS,
  savePatientQrSettings,
  type PatientQrSettings,
} from "@/lib/api-hooks";
import { LanguageProvider } from "@/providers/language-provider-component";

vi.mock("@/lib/api-hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-hooks")>();
  return {
    ...actual,
    fetchModalitiesSettings: vi.fn(),
    fetchPatientQrSettings: vi.fn(),
    savePatientQrSettings: vi.fn(),
  };
});

const baseSettings: PatientQrSettings = {
  ...DEFAULT_PATIENT_QR_SETTINGS,
  enabled: true,
  risproPublicBaseUrl: "https://rispro.nccb.com.ly",
  printQrOnAppointmentSlip: true,
  allowCancellation: true,
  allowAddToCalendar: true,
  showBookingTime: true,
  showPreparationInstructions: true,
  showDocumentsChecklist: true,
  showDepartmentContact: true,
  showLocationDirections: true,
  allowReportAccess: false,
  reportAccessModalityMode: "all",
  reportAccessModalityIds: [],
  allowImageAccess: false,
  imageAccessModalityMode: "all",
  imageAccessModalityIds: [],
  showReportPendingCard: true,
  reportAccessRequiresCompletedAppointment: true,
  imageAccessRequiresCompletedAppointment: true,
  imageAccessRequiresReportRequiredFlag: false,
  showReportNotRequiredMessage: false,
  defaultReportRequiredForOncology: true,
  defaultReportRequiredForNonOncology: false,
  qrReportCheckingMessage: "Checking report status...",
  qrReportFinalMessage: "Your report is ready.",
  qrReportDraftMessage: "Your report is still under review and is not finalized yet.",
  qrReportNoReportMessage: "No report is available for this appointment yet.",
  qrReportUnavailableMessage: "The report system is temporarily unavailable. Please try again later.",
  qrReportNotRequiredMessage: "",
  qrReportNotCompletedMessage: "Report access becomes available after the examination is completed.",
  qrReportCheckButtonLabel: "Check report",
  qrReportViewButtonLabel: "View report",
  qrImageViewButtonLabel: "View images",
  qrImageUnavailableMessage: "Image viewing is currently unavailable. Please try again later.",
  qrReportStudyNotFoundMessage: "Your study is not available in the report system yet. Please try again later.",
  qrImageStudyNotFoundMessage: "Your study images are not available yet. Please try again later.",
  pageTitleAr: "Ø®Ø¯Ù…Ø© Ø§Ù„Ù…Ø±ÙŠØ¶ Ø¹Ø¨Ø± Ø±Ù…Ø² QR",
  pageTitleEn: "Patient QR Service",
  introTextAr: "Ù…Ù‚Ø¯Ù…Ø©",
  introTextEn: "Introduction",
  genericPreparationTextAr: "ØªØ­Ø¶ÙŠØ± Ø¹Ø§Ù…",
  genericPreparationTextEn: "General preparation",
  documentsChecklistAr: ["ÙˆØ±Ù‚Ø© Ø§Ù„Ø¥Ø­Ø§Ù„Ø©", "Ø¥Ø«Ø¨Ø§Øª Ø§Ù„Ù‡ÙˆÙŠØ©"],
  documentsChecklistEn: ["Referral paper", "ID proof"],
  contact: {
    primaryPhone: "0912345678",
    secondaryPhone: "",
    whatsapp: "0912345678",
    whatsappEnabled: true,
    workingHoursAr: "08:00 - 14:00",
    workingHoursEn: "08:00 - 14:00",
    noteAr: "Ù…Ù„Ø§Ø­Ø¸Ø©",
    noteEn: "Note",
  },
  location: {
    centerNameAr: "Ø§Ù„Ù…Ø±ÙƒØ² Ø§Ù„ÙˆØ·Ù†ÙŠ Ù„Ù„Ø£ÙˆØ±Ø§Ù… Ø¨Ù†ØºØ§Ø²ÙŠ",
    centerNameEn: "National Cancer Center Benghazi",
    departmentLocationAr: "Ù‚Ø³Ù… Ø§Ù„Ø£Ø´Ø¹Ø© Ø§Ù„ØªØ´Ø®ÙŠØµÙŠØ©",
    departmentLocationEn: "Diagnostic Imaging Department",
    roomUnitFloorAr: "Ø§Ù„Ø·Ø§Ø¨Ù‚ Ø§Ù„Ø£ÙˆÙ„ / ØºØ±ÙØ© 3",
    roomUnitFloorEn: "1st Floor / Room 3",
    addressAr: "Ø´Ø§Ø±Ø¹ Ø§Ù„Ù…Ø³ØªØ´ÙÙ‰",
    addressEn: "Hospital Street",
    arrivalInstructionsAr: "Ø§Ù„Ø­Ø¶ÙˆØ± Ù‚Ø¨Ù„ 15 Ø¯Ù‚ÙŠÙ‚Ø©",
    arrivalInstructionsEn: "Arrive 15 minutes early",
    googleMapsUrl: "https://maps.google.com/?q=test",
    parkingNoteAr: "Ù…ÙˆØ§Ù‚Ù Ù…ØªØ§Ø­Ø©",
    parkingNoteEn: "Parking available",
  },
};

function renderComponent() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <LanguageProvider>
      <QueryClientProvider client={queryClient}>
        <PatientQrSettingsSection onReAuthRequired={vi.fn()} />
      </QueryClientProvider>
    </LanguageProvider>
  );
}

describe("PatientQrSettingsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchModalitiesSettings).mockResolvedValue({
      modalities: [
        { id: 2, nameAr: "MRI", nameEn: "MRI", code: "MR" },
        { id: 3, nameAr: "CT", nameEn: "CT", code: "CT" },
      ].map((row) => ({
        id: row.id,
        code: row.code,
        name_ar: row.nameAr,
        name_en: row.nameEn,
        daily_capacity: null,
        general_instruction_ar: null,
        general_instruction_en: null,
        is_active: true,
        safety_warning_ar: null,
        safety_warning_en: null,
        safety_warning_enabled: true,
      })),
    });
    vi.mocked(fetchPatientQrSettings).mockResolvedValue(baseSettings);
    vi.mocked(savePatientQrSettings).mockResolvedValue({});
  });

  it("loads the current settings", async () => {
    renderComponent();

    expect((await screen.findAllByRole("heading", { name: /QR/i })).length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue("Ø®Ø¯Ù…Ø© Ø§Ù„Ù…Ø±ÙŠØ¶ Ø¹Ø¨Ø± Ø±Ù…Ø² QR")).toBeTruthy();
    expect(screen.getByDisplayValue("https://rispro.nccb.com.ly")).toBeTruthy();
    expect(screen.getByDisplayValue("ÙˆØ±Ù‚Ø© Ø§Ù„Ø¥Ø­Ø§Ù„Ø©")).toBeTruthy();
    expect(screen.getByDisplayValue("Ø§Ù„Ø·Ø§Ø¨Ù‚ Ø§Ù„Ø£ÙˆÙ„ / ØºØ±ÙØ© 3")).toBeTruthy();
    expect(screen.getByDisplayValue("Ø´Ø§Ø±Ø¹ Ø§Ù„Ù…Ø³ØªØ´ÙÙ‰")).toBeTruthy();
  });

  it("saves toggles and content changes", async () => {
    const user = userEvent.setup();
    renderComponent();

    await screen.findAllByRole("heading", { name: /QR/i });
    const intro = screen.getByDisplayValue("Ù…Ù‚Ø¯Ù…Ø©") as HTMLTextAreaElement;
    await user.clear(intro);
    await user.type(intro, "Ù…Ù‚Ø¯Ù…Ø© Ø¬Ø¯ÙŠØ¯Ø©");
    await user.click(screen.getByRole("checkbox", { name: "إظهار بطاقة الموقع" }));

    await user.click(screen.getByRole("button", { name: "حفظ" }));

    await waitFor(() => {
      expect(savePatientQrSettings).toHaveBeenCalled();
    });
    const payload = vi.mocked(savePatientQrSettings).mock.calls[0][0];
    expect(payload.introTextAr).toBe("Ù…Ù‚Ø¯Ù…Ø© Ø¬Ø¯ÙŠØ¯Ø©");
    expect(payload.risproPublicBaseUrl).toBe("https://rispro.nccb.com.ly");
    expect(payload.showLocationDirections).toBe(false);
    expect(payload.showBookingTime).toBe(true);
    expect(payload.location.roomUnitFloorAr).toBe("Ø§Ù„Ø·Ø§Ø¨Ù‚ Ø§Ù„Ø£ÙˆÙ„ / ØºØ±ÙØ© 3");
    expect(payload.location.addressAr).toBe("Ø´Ø§Ø±Ø¹ Ø§Ù„Ù…Ø³ØªØ´ÙÙ‰");
  });

  it("supports adding, removing, and reordering checklist items", async () => {
    const user = userEvent.setup();
    renderComponent();

    await screen.findAllByRole("heading", { name: /QR/i });
    const addInput = screen.getByPlaceholderText("إضافة عنصر جديد...");
    await user.type(addInput, "ØªØ­Ø§Ù„ÙŠÙ„ Ø­Ø¯ÙŠØ«Ø©");
    await user.click(screen.getByRole("button", { name: "إضافة" }));
    expect(screen.getByDisplayValue("ØªØ­Ø§Ù„ÙŠÙ„ Ø­Ø¯ÙŠØ«Ø©")).toBeTruthy();

    const moveUpButtons = screen.getAllByRole("button", { name: "تحريك العنصر إلى الأعلى" });
    await user.click(moveUpButtons[moveUpButtons.length - 1]);

    await user.click(screen.getByRole("button", { name: "حفظ" }));

    await waitFor(() => {
      expect(savePatientQrSettings).toHaveBeenCalled();
    });
    const payload = vi.mocked(savePatientQrSettings).mock.calls[0][0];
    expect(payload.documentsChecklistAr).toEqual(["ÙˆØ±Ù‚Ø© Ø§Ù„Ø¥Ø­Ø§Ù„Ø©", "ØªØ­Ø§Ù„ÙŠÙ„ Ø­Ø¯ÙŠØ«Ø©", "Ø¥Ø«Ø¨Ø§Øª Ø§Ù„Ù‡ÙˆÙŠØ©"]);
  });

  it("shows validation errors for invalid phone and URL values", async () => {
    renderComponent();

    await screen.findAllByRole("heading", { name: /QR/i });
    fireEvent.change(screen.getByLabelText("رقم الهاتف الرئيسي"), { target: { value: "abc" } });
    fireEvent.change(screen.getByLabelText("رابط خرائط Google"), { target: { value: "bad-url" } });
    fireEvent.change(screen.getByLabelText("رابط RISpro العام"), { target: { value: "bad-url" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));

    expect(await screen.findByText("Public RISpro URL is invalid.")).toBeTruthy();
    expect(await screen.findByText("رقم الهاتف غير صالح.")).toBeTruthy();
    expect(screen.getByText("رابط خرائط Google غير صالح.")).toBeTruthy();
  });

  it("asks for supervisor re-authentication when saving is rejected with 403", async () => {
    const onReAuthRequired = vi.fn();
    vi.mocked(savePatientQrSettings).mockRejectedValueOnce(
      new ApiError("Recent supervisor re-authentication is required.", 403, { code: "forbidden" })
    );

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    const user = userEvent.setup();
    render(
      <LanguageProvider>
        <QueryClientProvider client={queryClient}>
          <PatientQrSettingsSection onReAuthRequired={onReAuthRequired} />
        </QueryClientProvider>
      </LanguageProvider>
    );

    await screen.findAllByRole("heading", { name: /QR/i });
    await user.click(screen.getByRole("button", { name: "حفظ" }));

    await waitFor(() => {
      expect(onReAuthRequired).toHaveBeenCalledWith(["settings", "patient_qr_self_service"]);
    });
  });

  it("retries the pending save after supervisor re-authentication succeeds", async () => {
    const onReAuthRequired = vi.fn();
    vi.mocked(savePatientQrSettings)
      .mockRejectedValueOnce(new ApiError("Recent supervisor re-authentication is required.", 403, { code: "forbidden" }))
      .mockResolvedValueOnce({});

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    const user = userEvent.setup();
    const { rerender } = render(
      <LanguageProvider>
        <QueryClientProvider client={queryClient}>
          <PatientQrSettingsSection onReAuthRequired={onReAuthRequired} reauthVersion={0} />
        </QueryClientProvider>
      </LanguageProvider>
    );

    await screen.findAllByRole("heading", { name: /QR/i });
    await user.click(screen.getByRole("button", { name: "حفظ" }));

    await waitFor(() => {
      expect(onReAuthRequired).toHaveBeenCalledWith(["settings", "patient_qr_self_service"]);
    });

    rerender(
      <LanguageProvider>
        <QueryClientProvider client={queryClient}>
          <PatientQrSettingsSection onReAuthRequired={onReAuthRequired} reauthVersion={1} />
        </QueryClientProvider>
      </LanguageProvider>
    );

    await waitFor(() => {
      expect(savePatientQrSettings).toHaveBeenCalledTimes(2);
    });
  });

  it("saves report/image modality scope selections", async () => {
    const user = userEvent.setup();
    renderComponent();

    await screen.findAllByRole("heading", { name: /QR/i });

    await user.selectOptions(screen.getByLabelText(/Report modality scope|نطاق الأجهزة للتقارير/i), "include");
    await user.click(screen.getByRole("checkbox", { name: "MRI" }));

    await user.selectOptions(screen.getByLabelText(/Image modality scope|نطاق الأجهزة للصور/i), "exclude");
    await user.click(screen.getAllByRole("checkbox", { name: "CT" })[1]);

    await user.click(screen.getByRole("button", { name: "حفظ" }));

    await waitFor(() => {
      expect(savePatientQrSettings).toHaveBeenCalled();
    });
    const payload = vi.mocked(savePatientQrSettings).mock.calls[0][0];
    expect(payload.reportAccessModalityMode).toBe("include");
    expect(payload.reportAccessModalityIds).toEqual([2]);
    expect(payload.imageAccessModalityMode).toBe("exclude");
    expect(payload.imageAccessModalityIds).toEqual([3]);
  });
});
import { fireEvent } from "@testing-library/react";

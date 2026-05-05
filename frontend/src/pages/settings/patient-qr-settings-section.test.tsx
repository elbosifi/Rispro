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
import { LanguageProvider } from "@/providers/language-provider";

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

describe.skip("PatientQrSettingsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchModalitiesSettings).mockResolvedValue({
      modalities: [
        { id: 2, nameAr: "Ã˜Â±Ã™â€ Ã™Å Ã™â€ ", nameEn: "MRI", code: "MR" },
        { id: 3, nameAr: "Ã˜Â£Ã˜Â´Ã˜Â¹Ã˜Â© Ã™â€¦Ã™â€šÃ˜Â·Ã˜Â¹Ã™Å Ã˜Â©", nameEn: "CT", code: "CT" },
      ],
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
    await user.click(screen.getByRole("checkbox", { name: /Ø¥Ø¸Ù‡Ø§Ø± Ø¨Ø·Ø§Ù‚Ø© Ø§Ù„Ù…ÙˆÙ‚Ø¹/i }));

    await user.click(screen.getByRole("button", { name: /Ø­ÙØ¸/i }));

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
    const addInput = screen.getByPlaceholderText("Ø¥Ø¶Ø§ÙØ© Ø¹Ù†ØµØ± Ø¬Ø¯ÙŠØ¯...");
    await user.type(addInput, "ØªØ­Ø§Ù„ÙŠÙ„ Ø­Ø¯ÙŠØ«Ø©");
    await user.click(screen.getByRole("button", { name: /Ø¥Ø¶Ø§ÙØ©/i }));
    expect(screen.getByDisplayValue("ØªØ­Ø§Ù„ÙŠÙ„ Ø­Ø¯ÙŠØ«Ø©")).toBeTruthy();

    const moveUpButtons = screen.getAllByRole("button", { name: "ØªØ­Ø±ÙŠÙƒ Ø§Ù„Ø¹Ù†ØµØ± Ø¥Ù„Ù‰ Ø§Ù„Ø£Ø¹Ù„Ù‰" });
    await user.click(moveUpButtons[2]);

    await user.click(screen.getByRole("button", { name: /Ø­ÙØ¸/i }));

    await waitFor(() => {
      expect(savePatientQrSettings).toHaveBeenCalled();
    });
    const payload = vi.mocked(savePatientQrSettings).mock.calls[0][0];
    expect(payload.documentsChecklistAr).toEqual(["ÙˆØ±Ù‚Ø© Ø§Ù„Ø¥Ø­Ø§Ù„Ø©", "ØªØ­Ø§Ù„ÙŠÙ„ Ø­Ø¯ÙŠØ«Ø©", "Ø¥Ø«Ø¨Ø§Øª Ø§Ù„Ù‡ÙˆÙŠØ©"]);
  });

  it("shows validation errors for invalid phone and URL values", async () => {
    const user = userEvent.setup();
    renderComponent();

    await screen.findAllByRole("heading", { name: /QR/i });
    await user.clear(screen.getByLabelText("Ø±Ù‚Ù… Ø§Ù„Ù‡Ø§ØªÙ Ø§Ù„Ø±Ø¦ÙŠØ³ÙŠ"));
    await user.type(screen.getByLabelText("Ø±Ù‚Ù… Ø§Ù„Ù‡Ø§ØªÙ Ø§Ù„Ø±Ø¦ÙŠØ³ÙŠ"), "abc");
    await user.clear(screen.getByLabelText("Ø±Ø§Ø¨Ø· Ø®Ø±Ø§Ø¦Ø· Google"));
    await user.type(screen.getByLabelText("Ø±Ø§Ø¨Ø· Ø®Ø±Ø§Ø¦Ø· Google"), "bad-url");
    await user.clear(screen.getByLabelText("Ø±Ø§Ø¨Ø· RISpro Ø§Ù„Ø¹Ø§Ù…"));
    await user.type(screen.getByLabelText("Ø±Ø§Ø¨Ø· RISpro Ø§Ù„Ø¹Ø§Ù…"), "bad-url");
    await user.click(screen.getByRole("button", { name: /Ø­ÙØ¸/i }));

    expect(await screen.findByText("Public RISpro URL is invalid.")).toBeTruthy();
    expect(await screen.findByText("Ø±Ù‚Ù… Ø§Ù„Ù‡Ø§ØªÙ ØºÙŠØ± ØµØ§Ù„Ø­.")).toBeTruthy();
    expect(screen.getByText("Ø±Ø§Ø¨Ø· Ø®Ø±Ø§Ø¦Ø· Google ØºÙŠØ± ØµØ§Ù„Ø­.")).toBeTruthy();
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
    await user.click(screen.getByRole("button", { name: /Ø­ÙØ¸/i }));

    await waitFor(() => {
      expect(onReAuthRequired).toHaveBeenCalledWith(["settings", "patient_qr_self_service"]);
    });
  });

  it("saves report/image modality scope selections", async () => {
    const user = userEvent.setup();
    renderComponent();

    await screen.findAllByRole("heading", { name: /QR/i });

    await user.selectOptions(screen.getByLabelText(/Report modality scope|Ù†Ø·Ø§Ù‚ Ø§Ù„Ø£Ø¬Ù‡Ø²Ø© Ù„Ù„ØªÙ‚Ø§Ø±ÙŠØ±/i), "include");
    await user.click(screen.getByRole("checkbox", { name: "MRI" }));

    await user.selectOptions(screen.getByLabelText(/Image modality scope|Ù†Ø·Ø§Ù‚ Ø§Ù„Ø£Ø¬Ù‡Ø²Ø© Ù„Ù„ØµÙˆØ±/i), "exclude");
    await user.click(screen.getByRole("checkbox", { name: "CT" }));

    await user.click(screen.getByRole("button", { name: /Ã˜Â­Ã™ÂÃ˜Â¸/i }));

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

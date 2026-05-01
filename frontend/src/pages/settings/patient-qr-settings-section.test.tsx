import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import PatientQrSettingsSection from "./patient-qr-settings-section";
import { fetchModalitiesSettings, fetchPatientQrSettings, savePatientQrSettings } from "@/lib/api-hooks";
import { LanguageProvider } from "@/providers/language-provider";

vi.mock("@/lib/api-hooks", () => ({
  fetchModalitiesSettings: vi.fn(),
  fetchPatientQrSettings: vi.fn(),
  savePatientQrSettings: vi.fn(),
}));

const baseSettings = {
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
  pageTitleAr: "خدمة المريض عبر رمز QR",
  pageTitleEn: "Patient QR Service",
  introTextAr: "مقدمة",
  introTextEn: "Introduction",
  genericPreparationTextAr: "تحضير عام",
  genericPreparationTextEn: "General preparation",
  documentsChecklistAr: ["ورقة الإحالة", "إثبات الهوية"],
  documentsChecklistEn: ["Referral paper", "ID proof"],
  contact: {
    primaryPhone: "0912345678",
    secondaryPhone: "",
    whatsapp: "0912345678",
    whatsappEnabled: true,
    workingHoursAr: "08:00 - 14:00",
    workingHoursEn: "08:00 - 14:00",
    noteAr: "ملاحظة",
    noteEn: "Note",
  },
  location: {
    centerNameAr: "المركز الوطني للأورام بنغازي",
    centerNameEn: "National Cancer Center Benghazi",
    departmentLocationAr: "قسم الأشعة التشخيصية",
    departmentLocationEn: "Diagnostic Imaging Department",
    roomUnitFloorAr: "الطابق الأول / غرفة 3",
    roomUnitFloorEn: "1st Floor / Room 3",
    addressAr: "شارع المستشفى",
    addressEn: "Hospital Street",
    arrivalInstructionsAr: "الحضور قبل 15 دقيقة",
    arrivalInstructionsEn: "Arrive 15 minutes early",
    googleMapsUrl: "https://maps.google.com/?q=test",
    parkingNoteAr: "مواقف متاحة",
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
        { id: 2, nameAr: "Ø±Ù†ÙŠÙ†", nameEn: "MRI", code: "MR" },
        { id: 3, nameAr: "Ø£Ø´Ø¹Ø© Ù…Ù‚Ø·Ø¹ÙŠØ©", nameEn: "CT", code: "CT" },
      ],
    });
    vi.mocked(fetchPatientQrSettings).mockResolvedValue(baseSettings);
    vi.mocked(savePatientQrSettings).mockResolvedValue({});
  });

  it("loads the current settings", async () => {
    renderComponent();

    expect(await screen.findByText("إعدادات صفحة المريض ورمز QR")).toBeTruthy();
    expect(screen.getByDisplayValue("خدمة المريض عبر رمز QR")).toBeTruthy();
    expect(screen.getByDisplayValue("https://rispro.nccb.com.ly")).toBeTruthy();
    expect(screen.getByDisplayValue("ورقة الإحالة")).toBeTruthy();
    expect(screen.getByDisplayValue("الطابق الأول / غرفة 3")).toBeTruthy();
    expect(screen.getByDisplayValue("شارع المستشفى")).toBeTruthy();
  });

  it("saves toggles and content changes", async () => {
    const user = userEvent.setup();
    renderComponent();

    await screen.findByText("إعدادات صفحة المريض ورمز QR");
    const intro = screen.getByDisplayValue("مقدمة") as HTMLTextAreaElement;
    await user.clear(intro);
    await user.type(intro, "مقدمة جديدة");
    await user.click(screen.getByRole("checkbox", { name: /إظهار بطاقة الموقع/i }));

    await user.click(screen.getByRole("button", { name: /حفظ/i }));

    await waitFor(() => {
      expect(savePatientQrSettings).toHaveBeenCalled();
    });
    const payload = vi.mocked(savePatientQrSettings).mock.calls[0][0];
    expect(payload.introTextAr).toBe("مقدمة جديدة");
    expect(payload.risproPublicBaseUrl).toBe("https://rispro.nccb.com.ly");
    expect(payload.showLocationDirections).toBe(false);
    expect(payload.showBookingTime).toBe(true);
    expect(payload.location.roomUnitFloorAr).toBe("الطابق الأول / غرفة 3");
    expect(payload.location.addressAr).toBe("شارع المستشفى");
  });

  it("supports adding, removing, and reordering checklist items", async () => {
    const user = userEvent.setup();
    renderComponent();

    await screen.findByText("إعدادات صفحة المريض ورمز QR");
    const addInput = screen.getByPlaceholderText("إضافة عنصر جديد...");
    await user.type(addInput, "تحاليل حديثة");
    await user.click(screen.getByRole("button", { name: /إضافة/i }));
    expect(screen.getByDisplayValue("تحاليل حديثة")).toBeTruthy();

    const moveUpButtons = screen.getAllByRole("button", { name: "تحريك العنصر إلى الأعلى" });
    await user.click(moveUpButtons[2]);

    await user.click(screen.getByRole("button", { name: /حفظ/i }));

    await waitFor(() => {
      expect(savePatientQrSettings).toHaveBeenCalled();
    });
    const payload = vi.mocked(savePatientQrSettings).mock.calls[0][0];
    expect(payload.documentsChecklistAr).toEqual(["ورقة الإحالة", "تحاليل حديثة", "إثبات الهوية"]);
  });

  it("shows validation errors for invalid phone and URL values", async () => {
    const user = userEvent.setup();
    renderComponent();

    await screen.findByText("إعدادات صفحة المريض ورمز QR");
    await user.clear(screen.getByLabelText("رقم الهاتف الرئيسي"));
    await user.type(screen.getByLabelText("رقم الهاتف الرئيسي"), "abc");
    await user.clear(screen.getByLabelText("رابط خرائط Google"));
    await user.type(screen.getByLabelText("رابط خرائط Google"), "bad-url");
    await user.clear(screen.getByLabelText("رابط RISpro العام"));
    await user.type(screen.getByLabelText("رابط RISpro العام"), "bad-url");
    await user.click(screen.getByRole("button", { name: /حفظ/i }));

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

    await screen.findByText("إعدادات صفحة المريض ورمز QR");
    await user.click(screen.getByRole("button", { name: /حفظ/i }));

    await waitFor(() => {
      expect(onReAuthRequired).toHaveBeenCalledWith(["settings", "patient_qr_self_service"]);
    });
  });

  it("saves report/image modality scope selections", async () => {
    const user = userEvent.setup();
    renderComponent();

    await screen.findByText("Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª ØµÙØ­Ø© Ø§Ù„Ù…Ø±ÙŠØ¶ ÙˆØ±Ù…Ø² QR");

    await user.selectOptions(screen.getByLabelText(/Report modality scope|نطاق الأجهزة للتقارير/i), "include");
    await user.click(screen.getByRole("checkbox", { name: "MRI" }));

    await user.selectOptions(screen.getByLabelText(/Image modality scope|نطاق الأجهزة للصور/i), "exclude");
    await user.click(screen.getByRole("checkbox", { name: "CT" }));

    await user.click(screen.getByRole("button", { name: /Ø­ÙØ¸/i }));

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

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PatientQrSettingsSection from "./patient-qr-settings-section";
import { fetchPatientQrSettings, savePatientQrSettings } from "@/lib/api-hooks";

vi.mock("@/lib/api-hooks", () => ({
  fetchPatientQrSettings: vi.fn(),
  savePatientQrSettings: vi.fn(),
}));

const baseSettings = {
  enabled: true,
  printQrOnAppointmentSlip: true,
  allowCancellation: true,
  allowAddToCalendar: true,
  showPreparationInstructions: true,
  showDocumentsChecklist: true,
  showDepartmentContact: true,
  showLocationDirections: true,
  pageTitleAr: "خدمة المريض عبر رمز QR",
  introTextAr: "مقدمة",
  genericPreparationTextAr: "تحضير عام",
  documentsChecklistAr: ["ورقة الإحالة", "إثبات الهوية"],
  contact: {
    primaryPhone: "0912345678",
    secondaryPhone: "",
    whatsapp: "0912345678",
    whatsappEnabled: true,
    workingHoursAr: "08:00 - 14:00",
    noteAr: "ملاحظة",
  },
  location: {
    centerNameAr: "المركز الوطني لعلاج الأورام - بنغازي",
    departmentLocationAr: "الطابق الأول",
    arrivalInstructionsAr: "الحضور قبل 15 دقيقة",
    googleMapsUrl: "https://maps.google.com/?q=test",
    parkingNoteAr: "مواقف متاحة",
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
    <QueryClientProvider client={queryClient}>
      <PatientQrSettingsSection />
    </QueryClientProvider>
  );
}

describe("PatientQrSettingsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchPatientQrSettings).mockResolvedValue(baseSettings);
    vi.mocked(savePatientQrSettings).mockResolvedValue({});
  });

  it("loads the current settings", async () => {
    renderComponent();

    expect(await screen.findByText("إعدادات صفحة المريض ورمز QR")).toBeTruthy();
    expect(screen.getByDisplayValue("خدمة المريض عبر رمز QR")).toBeTruthy();
    expect(screen.getByDisplayValue("ورقة الإحالة")).toBeTruthy();
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
    expect(payload.showLocationDirections).toBe(false);
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
    await user.click(screen.getByRole("button", { name: /حفظ/i }));

    expect(await screen.findByText("رقم الهاتف غير صالح.")).toBeTruthy();
    expect(screen.getByText("رابط خرائط Google غير صالح.")).toBeTruthy();
  });
});

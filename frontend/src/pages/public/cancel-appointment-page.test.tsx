import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import PublicCancelAppointmentPage, { createCalendarBlob } from "./cancel-appointment-page";
import {
  cancelPublicAppointment,
  fetchPublicPushConfig,
  fetchPublicAppointmentReportStatus,
  fetchPublicAppointmentCancelPreview,
  type PatientQrSettings,
  type PublicAppointmentCancelPreview,
} from "@/lib/api-hooks";

vi.mock("@/lib/api-hooks", () => ({
  fetchPublicAppointmentCancelPreview: vi.fn(),
  fetchPublicAppointmentReportStatus: vi.fn(),
  cancelPublicAppointment: vi.fn(),
  fetchPublicPushConfig: vi.fn(),
  subscribePublicPush: vi.fn(),
  unsubscribePublicPush: vi.fn(),
  testPublicPush: vi.fn(),
}));

function baseSettings(overrides: Partial<PatientQrSettings> = {}): PatientQrSettings {
  return {
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
    webPushEnabled: false,
    webPushDefaultReminder24h: true,
    webPushDefaultRescheduled: true,
    webPushDefaultCancelled: true,
    webPushDefaultChanged: true,
    webPushDefaultReportReady: true,
    webPushDefaultImageReady: false,
    webPushCardTitleAr: "تذكير وتنبيهات الموعد",
    webPushCardTitleEn: "Appointment reminders and alerts",
    webPushCardBodyAr: "يمكنك تفعيل تنبيهات المتصفح لهذا الموعد.",
    webPushCardBodyEn: "You can enable browser notifications for this appointment.",
    webPushSubscribeButtonAr: "تفعيل التنبيهات",
    webPushSubscribeButtonEn: "Enable notifications",
    webPushUnsubscribeButtonAr: "إيقاف التنبيهات",
    webPushUnsubscribeButtonEn: "Disable notifications",
    webPushTestButtonAr: "إرسال تنبيه تجريبي",
    webPushTestButtonEn: "Send test notification",
    webPushUnsupportedMessageAr: "تنبيهات المتصفح غير مدعومة على هذا الجهاز.",
    webPushUnsupportedMessageEn: "Browser notifications are not supported on this device.",
    webPushDeniedMessageAr: "تم رفض إذن التنبيهات من المتصفح.",
    webPushDeniedMessageEn: "Notification permission was denied in this browser.",
    webPushAppointmentReminder24hTitle: "Appointment reminder",
    webPushAppointmentReminder24hBody: "You have an appointment soon. Open your appointment page for details.",
    webPushAppointmentReminder24hTitleAr: "تذكير بالموعد",
    webPushAppointmentReminder24hBodyAr: "لديك موعد قريب. افتح صفحة الموعد للاطلاع على التفاصيل.",
    webPushAppointmentRescheduledTitle: "Appointment updated",
    webPushAppointmentRescheduledBody: "Your appointment date or time changed. Open your appointment page for details.",
    webPushAppointmentRescheduledTitleAr: "تم تحديث الموعد",
    webPushAppointmentRescheduledBodyAr: "تم تغيير تاريخ أو وقت الموعد. افتح صفحة الموعد للاطلاع على التفاصيل.",
    webPushAppointmentCancelledTitle: "Appointment cancelled",
    webPushAppointmentCancelledBody: "Your appointment has been cancelled. Open your appointment page for details.",
    webPushAppointmentCancelledTitleAr: "تم إلغاء الموعد",
    webPushAppointmentCancelledBodyAr: "تم إلغاء موعدك. افتح صفحة الموعد للاطلاع على التفاصيل.",
    webPushAppointmentChangedTitle: "Appointment updated",
    webPushAppointmentChangedBody: "Your appointment details changed. Open your appointment page for details.",
    webPushAppointmentChangedTitleAr: "تم تحديث الموعد",
    webPushAppointmentChangedBodyAr: "تم تحديث تفاصيل الموعد. افتح صفحة الموعد للاطلاع على التفاصيل.",
    webPushReportReadyTitle: "Report ready",
    webPushReportReadyBody: "Your report is ready. Open your appointment page for access options.",
    webPushReportReadyTitleAr: "التقرير جاهز",
    webPushReportReadyBodyAr: "تقريرك جاهز. افتح صفحة الموعد للاطلاع على خيارات الوصول.",
    webPushImageReadyTitle: "Images ready",
    webPushImageReadyBody: "Your images are ready. Open your appointment page for access options.",
    webPushImageReadyTitleAr: "الصور جاهزة",
    webPushImageReadyBodyAr: "صورك جاهزة. افتح صفحة الموعد للاطلاع على خيارات الوصول.",
    webPushTestTitle: "Notifications enabled",
    webPushTestBody: "Browser notifications are enabled for this appointment.",
    webPushTestTitleAr: "تم تفعيل التنبيهات",
    webPushTestBodyAr: "تم تفعيل تنبيهات المتصفح لهذا الموعد.",
    pageTitleEn: "Patient QR Service",
    introTextAr: "يمكنك مراجعة تفاصيل الموعد والتعليمات ومعلومات القسم من هذه الصفحة.",
    introTextEn: "You can review appointment details, instructions, and department information from this page.",
    genericPreparationTextAr: "تعليمات عامة",
    genericPreparationTextEn: "General instructions",
    documentsChecklistAr: ["ورقة الإحالة", "إثبات الهوية"],
    documentsChecklistEn: ["Referral paper", "ID proof"],
    contact: {
      primaryPhone: "0912345678",
      secondaryPhone: "",
      whatsapp: "0912345678",
      whatsappEnabled: true,
      workingHoursAr: "08:00 - 14:00",
      workingHoursEn: "08:00 - 14:00",
      noteAr: "يرجى الاتصال خلال ساعات العمل",
      noteEn: "Please call during working hours",
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
      parkingNoteAr: "مواقف أمامية متاحة",
      parkingNoteEn: "Front parking available",
    },
    ...overrides,
  };
}

function preview(overrides: Partial<PublicAppointmentCancelPreview> = {}): PublicAppointmentCancelPreview {
  return {
    bookingId: 12,
    patientDisplayName: "Test Patient",
    bookingDate: "2026-07-01",
    bookingTime: "10:30:00",
    requiresReport: false,
    modalityId: 2,
    modalityNameAr: "CT",
    modalityNameEn: "CT",
    examNameAr: "CT Head",
    examNameEn: "CT Head",
    modalityInstructionAr: "لا طعام قبل الفحص",
    modalityInstructionEn: "",
    examInstructionAr: "تعليمات الفحص",
    examInstructionEn: "",
    currentStatus: "scheduled",
    patientQrSettings: baseSettings(),
    ...overrides,
  };
}

function renderPage(entry = "/public/appointment?t=test-token") {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/public/appointment" element={<PublicCancelAppointmentPage />} />
          <Route path="/public/cancel-appointment" element={<PublicCancelAppointmentPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("PublicCancelAppointmentPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchPublicAppointmentCancelPreview).mockResolvedValue(preview());
    vi.mocked(cancelPublicAppointment).mockResolvedValue({
      ok: true,
      alreadyCancelled: false,
      bookingId: 12,
      status: "cancelled",
    });
    vi.mocked(fetchPublicPushConfig).mockResolvedValue({
      enabled: false,
      vapidPublicKey: "",
      defaults: {
        appointmentReminder24h: true,
        appointmentRescheduled: true,
        appointmentCancelled: true,
        appointmentChanged: true,
        reportReady: true,
        imageReady: false,
      },
      labels: {
        cardTitleAr: "تذكير وتنبيهات الموعد",
        cardTitleEn: "Appointment reminders and alerts",
        cardBodyAr: "يمكنك تفعيل تنبيهات المتصفح لهذا الموعد.",
        cardBodyEn: "You can enable browser notifications for this appointment.",
        subscribeButtonAr: "تفعيل التنبيهات",
        subscribeButtonEn: "Enable notifications",
        unsubscribeButtonAr: "إيقاف التنبيهات",
        unsubscribeButtonEn: "Disable notifications",
        testButtonAr: "إرسال تنبيه تجريبي",
        testButtonEn: "Send test notification",
        unsupportedMessageAr: "تنبيهات المتصفح غير مدعومة على هذا الجهاز.",
        unsupportedMessageEn: "Browser notifications are not supported on this device.",
        deniedMessageAr: "تم رفض إذن التنبيهات من المتصفح.",
        deniedMessageEn: "Notification permission was denied in this browser.",
      },
    });
  });

  it("shows the landing page first and keeps the destructive action hidden until requested", async () => {
    renderPage();

    expect(await screen.findByText("خدمة المريض عبر رمز QR")).toBeTruthy();
    expect(screen.getByText("وقت الموعد")).toBeTruthy();
    expect(screen.getByRole("button", { name: /إضافة إلى التقويم/i })).toBeTruthy();
    expect(screen.getByText("تعليمات خاصة بالجهاز")).toBeTruthy();
    expect(screen.getByText("تعليمات خاصة بالفحص")).toBeTruthy();
    expect(screen.getByText("ما الذي يجب إحضاره؟")).toBeTruthy();
    expect(screen.getByText("التواصل مع القسم")).toBeTruthy();
    expect(screen.getByText("موقع القسم")).toBeTruthy();
    expect(screen.getByText("الطابق / الوحدة / الغرفة")).toBeTruthy();
    expect(screen.getByText("العنوان")).toBeTruthy();
    expect(screen.getByRole("link", { name: /فتح الخريطة/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /إلغاء الموعد/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /تأكيد الإلغاء/i })).toBeNull();
    expect(fetchPublicAppointmentCancelPreview).toHaveBeenCalledWith("test-token");
    expect(fetchPublicAppointmentReportStatus).not.toHaveBeenCalled();
    expect(screen.queryByText(/طلب موعد جديد/i)).toBeNull();
    expect(screen.queryByText("العودة للرئيسية")).toBeNull();
  });

  it("shows View images button only when image access is eligible", async () => {
    vi.mocked(fetchPublicAppointmentCancelPreview).mockResolvedValueOnce(
      preview({
        currentStatus: "completed",
        requiresReport: false,
        patientQrSettings: baseSettings({
          allowImageAccess: true,
          imageAccessRequiresCompletedAppointment: true,
          imageAccessRequiresReportRequiredFlag: false,
          allowReportAccess: false,
        }),
      })
    );

    renderPage();
    expect(await screen.findByRole("button", { name: /View images/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Check report/i })).toBeNull();
  });

  it("shows a notification card when patient web push is enabled", async () => {
    vi.mocked(fetchPublicAppointmentCancelPreview).mockResolvedValueOnce(
      preview({ patientQrSettings: baseSettings({ webPushEnabled: true }) })
    );
    vi.mocked(fetchPublicPushConfig).mockResolvedValueOnce({
      enabled: true,
      vapidPublicKey: "public-key",
      defaults: {
        appointmentReminder24h: true,
        appointmentRescheduled: true,
        appointmentCancelled: true,
        appointmentChanged: true,
        reportReady: true,
        imageReady: false,
      },
      labels: {
        cardTitleAr: "تنبيهات الموعد",
        cardTitleEn: "Appointment alerts",
        cardBodyAr: "فعّل التنبيهات لهذا الموعد.",
        cardBodyEn: "Enable alerts for this appointment.",
        subscribeButtonAr: "تفعيل التنبيهات",
        subscribeButtonEn: "Enable notifications",
        unsubscribeButtonAr: "إيقاف التنبيهات",
        unsubscribeButtonEn: "Disable notifications",
        testButtonAr: "إرسال تنبيه تجريبي",
        testButtonEn: "Send test notification",
        unsupportedMessageAr: "تنبيهات المتصفح غير مدعومة على هذا الجهاز.",
        unsupportedMessageEn: "Browser notifications are not supported on this device.",
        deniedMessageAr: "تم رفض إذن التنبيهات من المتصفح.",
        deniedMessageEn: "Notification permission was denied in this browser.",
      },
    });

    renderPage();

    expect(await screen.findByText("تنبيهات الموعد")).toBeTruthy();
    expect(screen.getByText("تنبيهات المتصفح غير مدعومة على هذا الجهاز.")).toBeTruthy();
  });

  it("hides report and image actions when modality scope blocks access", async () => {
    vi.mocked(fetchPublicAppointmentCancelPreview).mockResolvedValueOnce(
      preview({
        currentStatus: "completed",
        requiresReport: true,
        modalityId: 2,
        patientQrSettings: baseSettings({
          allowReportAccess: true,
          reportAccessModalityMode: "include",
          reportAccessModalityIds: [3],
          allowImageAccess: true,
          imageAccessModalityMode: "exclude",
          imageAccessModalityIds: [2],
        }),
      })
    );

    renderPage();
    await screen.findByRole("heading", { name: /QR/i });
    expect(screen.queryByRole("button", { name: /Check report/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /View images/i })).toBeNull();
  });

  it("moves from landing to confirmation and requires acknowledgement before canceling", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("button", { name: /إلغاء الموعد/i });
    await user.click(screen.getByRole("button", { name: /إلغاء الموعد/i }));

    expect(await screen.findByText("تأكيد إلغاء الموعد")).toBeTruthy();

    const confirmButton = screen.getByRole("button", { name: /تأكيد الإلغاء/i }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);

    await user.click(screen.getByRole("checkbox", { name: /أفهم أن هذا الإلغاء نهائي/i }));
    expect(confirmButton.disabled).toBe(false);

    await user.click(confirmButton);

    await waitFor(() => {
      expect(cancelPublicAppointment).toHaveBeenCalledWith("test-token");
    });

    expect(await screen.findByText("تم إلغاء الموعد بنجاح")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /تأكيد الإلغاء/i })).toBeNull();
    expect(screen.queryByText("العودة للرئيسية")).toBeNull();
  });

  it("shows the already-cancelled state when the QR link is reopened after cancellation", async () => {
    vi.mocked(fetchPublicAppointmentCancelPreview).mockResolvedValueOnce(
      preview({ currentStatus: "cancelled" })
    );

    renderPage();

    expect(await screen.findByText("هذا الموعد ملغى مسبقاً")).toBeTruthy();
    expect(screen.getByText("لا توجد أي إجراءات مطلوبة.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /تأكيد الإلغاء/i })).toBeNull();
    expect(screen.queryByText("العودة للرئيسية")).toBeNull();
  });

  it("shows a safe disabled message when QR access is turned off", async () => {
    vi.mocked(fetchPublicAppointmentCancelPreview).mockRejectedValue(
      new ApiError("Patient QR access is disabled.", 403, { code: "patient_qr_disabled" })
    );

    renderPage();

    expect(await screen.findByText("خدمة عرض تفاصيل الموعد عبر رمز QR غير مفعلة حالياً.")).toBeTruthy();
  });

  it("shows a safe invalid-link state", async () => {
    vi.mocked(fetchPublicAppointmentCancelPreview).mockRejectedValue(
      new ApiError("Invalid cancellation token.", 400, { code: "invalid_token" })
    );

    renderPage();

    expect(await screen.findByText("رابط غير صالح أو منتهي الصلاحية")).toBeTruthy();
    expect(screen.queryByText("Test Patient")).toBeNull();
  });

  it("shows a safe expired-link state", async () => {
    vi.mocked(fetchPublicAppointmentCancelPreview).mockRejectedValue(
      new ApiError("Cancellation link has expired.", 401, { code: "expired_link" })
    );

    renderPage();

    expect(await screen.findByText("رابط غير صالح أو منتهي الصلاحية")).toBeTruthy();
    expect(screen.getByText(/انتهت صلاحية هذا الرابط/i)).toBeTruthy();
  });

  it("shows a retry-safe error when cancellation fails", async () => {
    const user = userEvent.setup();
    vi.mocked(cancelPublicAppointment).mockRejectedValueOnce(
      new ApiError("Temporary failure", 500, { code: "server_error" })
    );

    renderPage();

    await screen.findByRole("button", { name: /إلغاء الموعد/i });
    await user.click(screen.getByRole("button", { name: /إلغاء الموعد/i }));
    await user.click(screen.getByRole("checkbox", { name: /أفهم أن هذا الإلغاء نهائي/i }));
    await user.click(screen.getByRole("button", { name: /تأكيد الإلغاء/i }));

    expect(await screen.findByText("تعذر إلغاء الموعد الآن. يمكنك المحاولة مرة أخرى بأمان.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /تأكيد الإلغاء/i })).toBeTruthy();
  });

  it("hides disabled sections and add-to-calendar when configured off", async () => {
    vi.mocked(fetchPublicAppointmentCancelPreview).mockResolvedValueOnce(
      preview({
        patientQrSettings: baseSettings({
          showBookingTime: false,
          showPreparationInstructions: false,
          showDocumentsChecklist: false,
          showDepartmentContact: false,
          showLocationDirections: false,
          allowAddToCalendar: false,
        }),
      })
    );

    renderPage();

    expect(await screen.findByText("خدمة المريض عبر رمز QR")).toBeTruthy();
    expect(screen.queryByText("تعليمات التحضير")).toBeNull();
    expect(screen.queryByText("تعليمات خاصة بالجهاز")).toBeNull();
    expect(screen.queryByText("تعليمات خاصة بالفحص")).toBeNull();
    expect(screen.queryByText("ما الذي يجب إحضاره؟")).toBeNull();
    expect(screen.queryByText("التواصل مع القسم")).toBeNull();
    expect(screen.queryByText("موقع القسم")).toBeNull();
    expect(screen.queryByText("إضافة إلى التقويم")).toBeNull();
    expect(screen.queryByText("وقت الموعد")).toBeNull();
  });

  it("shows the booking time row when configured on", async () => {
    renderPage();

    expect(await screen.findByText("وقت الموعد")).toBeTruthy();
    expect(screen.getByText("10:30")).toBeTruthy();
  });

  it("generates an ICS file when add-to-calendar is enabled", async () => {
    const user = userEvent.setup();
    const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake");
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    renderPage();

    await screen.findByRole("button", { name: /إضافة إلى التقويم/i });
    await user.click(screen.getByRole("button", { name: /إضافة إلى التقويم/i }));

    expect(createObjectUrl).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
  });

  it("builds calendar entries with the patient page link and reminder", async () => {
    const blob = createCalendarBlob(preview(), baseSettings(), "http://localhost:3000/public/appointment?t=test-token");
    const text = await blob.text();

    expect(text).toContain("DTSTART:20260701T103000");
    expect(text).toContain("DTEND:20260701T113000");
    expect(text).toContain("URL:http://localhost:3000/public/appointment?t=test-token");
    expect(text).toContain("TRIGGER:-PT24H");
    expect(text).toContain("استخدم هذا الرابط للحصول على المزيد من المعلومات عن الجهاز والفحص.");
  });

  it("falls back to the 8:30 to 13:30 window when booking time is missing", async () => {
    const blob = createCalendarBlob(
      preview({ bookingTime: "" }),
      baseSettings(),
      "http://localhost:3000/public/appointment?t=test-token"
    );
    const text = await blob.text();

    expect(text).toContain("DTSTART:20260701T083000");
    expect(text).toContain("DTEND:20260701T133000");
  });
});

import { getAppointmentById } from "@/lib/api-hooks";
import { type Language, t } from "@/lib/i18n";
import { printAppointmentSlip } from "@/lib/print-utils";
import { pushToast } from "@/lib/toast";
import { directPrint, resolveAppointmentDocumentType } from "@/services/printing/direct-print-service";
import { loadQzPrinterSettings } from "@/services/printing/workstation-printer-settings";
import type { DirectPrintResult } from "@/types/printing";

function resolvePrintLanguage(language?: Language): Language {
  if (language === "ar" || language === "en") {
    return language;
  }

  if (typeof window !== "undefined") {
    const storedLanguage = window.localStorage.getItem("rispro-language");
    if (storedLanguage === "ar" || storedLanguage === "en") {
      return storedLanguage;
    }
  }

  return "en";
}

export async function printAppointmentSlipById(appointmentId: number, language?: Language): Promise<void> {
  try {
    const appointment = await getAppointmentById(appointmentId);
    const documentType = await resolveAppointmentDocumentType();
    const result = await directPrint({ documentType, appointmentId, accessionNumber: appointment.accessionNumber, appointmentSnapshot: appointment });
    if (result.success) {
      pushToast({ type: "success", title: "Print job submitted", message: `Print job sent to ${result.printerName}.` });
      return;
    }
    showDirectPrintFailure(result, () => printAppointmentSlip(appointment), language);
  } catch (error) {
    const printLanguage = resolvePrintLanguage(language);
    pushToast({
      type: "error",
      title: t(printLanguage, "print.failed"),
      message: error instanceof Error ? error.message : t(printLanguage, "common.validationError"),
    });
  }
}

export async function printAccessionLabelById(appointmentId: number, language?: Language): Promise<void> {
  try {
    const appointment = await getAppointmentById(appointmentId);
    const result = await directPrint({ documentType: "ACCESSION_LABEL", appointmentId, accessionNumber: appointment.accessionNumber, appointmentSnapshot: appointment });
    if (result.success) {
      pushToast({ type: "success", title: "Label job submitted", message: `Print job sent to ${result.printerName}.` });
      return;
    }
    showDirectPrintFailure(result, null, language);
  } catch (error) {
    const printLanguage = resolvePrintLanguage(language);
    pushToast({ type: "error", title: t(printLanguage, "print.failed"), message: error instanceof Error ? error.message : t(printLanguage, "common.validationError") });
  }
}

function showDirectPrintFailure(result: Extract<DirectPrintResult, { success: false }>, browserFallback: (() => void) | null, language?: Language): void {
  const settings = loadQzPrinterSettings();
  const configurationError = result.errorCode === "PRINTER_NOT_CONFIGURED" || result.errorCode === "PRINTER_NOT_FOUND" || result.errorCode === "PAGE_SIZE_MISMATCH";
  pushToast({
    type: "error",
    title: t(resolvePrintLanguage(language), "print.failed"),
    message: result.message,
    action: configurationError || !browserFallback || !settings.browserPrintFallbackEnabled
      ? { label: "Open Printing settings", onClick: () => window.location.assign("/workstation/printing") }
      : { label: "Use browser printing", onClick: browserFallback },
  }, 10_000);
}

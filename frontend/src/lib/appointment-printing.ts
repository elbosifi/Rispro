import { getAppointmentById } from "@/lib/api-hooks";
import { type Language, t } from "@/lib/i18n";
import { printAppointmentSlip } from "@/lib/print-utils";
import { pushToast } from "@/lib/toast";
import { directPrint, directPrintIrSpecimenLabel, resolveAppointmentDocumentType } from "@/services/printing/direct-print-service";
import { loadQzPrinterSettings } from "@/services/printing/workstation-printer-settings";
import type { DirectPrintResult } from "@/types/printing";
import { resolveDirectPrintFailureAction } from "@/services/printing/direct-print-failure-action";

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
    const settings = loadQzPrinterSettings();
    const profile = settings.profiles.find((candidate) => candidate.documentType === documentType);
    if (profile && !profile.enabled) {
      if (settings.browserPrintFallbackEnabled) {
        printAppointmentSlip(appointment);
        return;
      }
      showDirectPrintFailure({ success: false, errorCode: "PRINTER_NOT_CONFIGURED", message: `${documentType === "A4_DOCUMENT" ? "A4" : "A5"} direct printing is disabled for this workstation.` }, () => printAppointmentSlip(appointment), language);
      return;
    }
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

export async function printIrSpecimenLabelById(appointmentId: number, specimenText: string, language?: Language): Promise<void> {
  try {
    const appointment = await getAppointmentById(appointmentId);
    const result = await directPrintIrSpecimenLabel(appointmentId, appointment.accessionNumber, specimenText.replace(/\s+/g, " ").trim());
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
  const action = resolveDirectPrintFailureAction(result.errorCode, browserFallback != null, settings.browserPrintFallbackEnabled);
  const toastAction = action === "OPEN_SETTINGS"
    ? { label: "Open Printing settings", onClick: () => window.location.assign("/workstation/printing") }
    : action === "BROWSER_PRINT" && browserFallback
      ? { label: "Use browser printing", onClick: browserFallback }
      : null;
  pushToast({
    type: "error",
    title: t(resolvePrintLanguage(language), "print.failed"),
    message: result.message,
    ...(toastAction ? { action: toastAction } : {}),
  }, 10_000);
}

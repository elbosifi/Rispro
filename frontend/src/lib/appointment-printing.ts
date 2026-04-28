import { getAppointmentById } from "@/lib/api-hooks";
import { type Language, t } from "@/lib/i18n";
import { printAppointmentSlip } from "@/lib/print-utils";
import { pushToast } from "@/lib/toast";

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
    printAppointmentSlip(appointment);
  } catch (error) {
    const printLanguage = resolvePrintLanguage(language);
    pushToast({
      type: "error",
      title: t(printLanguage, "print.failed"),
      message: error instanceof Error ? error.message : t(printLanguage, "common.validationError"),
    });
  }
}

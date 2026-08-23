import type { PrinterDocumentType, QzPrinterSettings } from "@/types/printing";

export function isMobileOrTabletDevice(): boolean {
  const userAgentData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (userAgentData?.mobile) return true;

  const userAgent = navigator.userAgent || "";
  return /Android|iPhone|iPad|iPod|IEMobile|Opera Mini|Mobile/i.test(userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function shouldUseBrowserPrint(settings: QzPrinterSettings, documentType: PrinterDocumentType): boolean {
  if (isMobileOrTabletDevice()) return true;
  const profile = settings.profiles?.find((item) => item.documentType === documentType);
  return profile ? !profile.enabled : false;
}

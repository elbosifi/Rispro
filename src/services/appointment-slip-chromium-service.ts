import { ChromiumPdfRenderError, renderChromiumPdf } from "./chromium-pdf-service.js";

export class AppointmentSlipRenderError extends Error {
  constructor(message: string, public readonly cause?: unknown) { super(message); this.name = "AppointmentSlipRenderError"; }
}

type BrowserLauncher = Parameters<typeof renderChromiumPdf>[1];

export async function renderAppointmentSlipPdf(renderUrl: string, launch?: BrowserLauncher): Promise<Buffer> {
  try {
    return await renderChromiumPdf({
      source: { kind: "url", url: renderUrl, readySelector: '[data-appointment-slip-document="true"]' },
      documentKind: "appointment-slip",
    }, launch);
  } catch (error) {
    if (!(error instanceof ChromiumPdfRenderError)) throw error;
    throw new AppointmentSlipRenderError("Appointment-slip PDF rendering failed.", error);
  }
}

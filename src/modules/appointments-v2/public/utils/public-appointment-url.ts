import { readPatientQrSettings } from "./patient-qr-settings.js";
import { buildPublicAppointmentUrlFromSettings } from "./public-appointment-url-core.js";

export { buildPublicAppointmentUrlFromSettings } from "./public-appointment-url-core.js";

export async function buildPublicAppointmentUrl(token: string): Promise<string> {
  const settings = await readPatientQrSettings();
  return buildPublicAppointmentUrlFromSettings(token, settings);
}

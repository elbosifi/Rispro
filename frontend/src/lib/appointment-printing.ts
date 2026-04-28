import { getAppointmentById } from "@/lib/api-hooks";
import { printAppointmentSlip } from "@/lib/print-utils";

export async function printAppointmentSlipById(appointmentId: number): Promise<void> {
  const appointment = await getAppointmentById(appointmentId);
  printAppointmentSlip(appointment);
}

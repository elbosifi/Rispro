import { HttpError } from "../../utils/http-error.js";
import { logAuditEntry } from "../../services/audit-service.js";
import { scheduleBookingWorklistDetailReplacement } from "../../services/dicom-service.js";
import { findBookingByIdForUpdate, updateBookingExamTypeOnly } from "../appointments-v2/booking/repositories/booking.repo.js";
import { findExamTypeById } from "../appointments-v2/catalog/repositories/exam-type-catalog.repo.js";
import { withTransaction } from "../appointments-v2/shared/utils/transactions.js";
import { canDoctorProtocolModality } from "./profile-repository.js";
import { cancelActiveProtocolAssignments, getProtocolingAppointmentDetail } from "./protocoling-repository.js";

export type ProtocolingExamTypeDisposition = "keep" | "clear";
export type AppliedProtocolingExamTypeDisposition = "kept" | "cleared" | "none";

interface ChangeDoctorProtocolingExamTypeInput {
  appointmentId: number;
  examTypeId: number;
  userId: number;
  protocolDisposition?: ProtocolingExamTypeDisposition;
}

interface ActiveProtocolAssignmentRow {
  id: number;
}

function auditNewValues(
  examTypeId: number,
  examTypeName: string,
  protocolDisposition: AppliedProtocolingExamTypeDisposition,
  protocolAssignmentId: number | null,
) {
  return {
    examTypeId,
    examTypeName,
    protocolDisposition,
    ...(protocolAssignmentId == null ? {} : { protocolAssignmentId }),
    source: "Doctor Protocoling Board",
  };
}

function examTypeName(examType: { name: string; nameAr: string; nameEn: string } | null): string | null {
  return examType?.name || examType?.nameEn || examType?.nameAr || null;
}

/**
 * Clinical correction for Doctor Protocoling. This deliberately does not call
 * the scheduling evaluator: the existing booking keeps its current slot and
 * all scheduling/quota allocation semantics.
 */
export async function changeDoctorProtocolingExamType(input: ChangeDoctorProtocolingExamTypeInput) {
  const changed = await withTransaction(async (client) => {
    const booking = await findBookingByIdForUpdate(client, input.appointmentId);
    if (!booking) throw new HttpError(404, "Appointment not found.");

    const examType = await findExamTypeById(client, input.examTypeId);
    if (!examType || !examType.isActive) throw new HttpError(400, "Exam type is inactive or not found.");
    if (Number(examType.modalityId) !== Number(booking.modalityId)) {
      throw new HttpError(400, "Exam type must belong to the appointment modality.");
    }
    if (!(await canDoctorProtocolModality(input.userId, Number(booking.modalityId), client))) {
      throw new HttpError(403, "Doctor is not permitted to protocol this appointment modality.");
    }

    const activeAssignmentResult = await client.query<ActiveProtocolAssignmentRow>(
      `select id
       from appointment_protocol_assignments
       where appointment_id = $1 and status <> 'CANCELLED'
       order by updated_at desc, id desc
       limit 1
       for update`,
      [input.appointmentId],
    );
    const activeAssignment = activeAssignmentResult.rows[0] ?? null;
    if (activeAssignment && input.protocolDisposition == null) {
      throw new HttpError(409, "Choose whether to keep or clear the active protocol before changing the examination type.");
    }

    const protocolDisposition: AppliedProtocolingExamTypeDisposition = activeAssignment == null
      ? "none"
      : input.protocolDisposition === "clear"
        ? "cleared"
        : "kept";
    const protocolAssignmentId = activeAssignment == null ? null : Number(activeAssignment.id);

    if (protocolDisposition === "cleared") {
      await cancelActiveProtocolAssignments(client, input.appointmentId);
    }

    await updateBookingExamTypeOnly(client, input.appointmentId, input.examTypeId, input.userId);

    // This is display metadata on the existing special-quota allocation. It
    // must follow the clinical examination without releasing or acquiring a
    // quota slot, changing its logical bucket, or changing availability.
    await client.query(
      `update appointments_v2.special_quota_consumptions
       set exam_type_id = $1, updated_at = now()
       where booking_id = $2 and released_at is null`,
      [input.examTypeId, input.appointmentId],
    );

    const previousExamTypeId = booking.examTypeId == null ? null : Number(booking.examTypeId);
    await logAuditEntry({
      entityType: "appointment",
      entityId: input.appointmentId,
      actionType: "doctor_protocoling_exam_type_changed",
      oldValues: {
        examTypeId: previousExamTypeId,
        examTypeName: previousExamTypeId == null ? null : examTypeName(await findExamTypeById(client, previousExamTypeId)),
      },
      newValues: auditNewValues(input.examTypeId, examTypeName(examType) ?? "", protocolDisposition, protocolAssignmentId),
      changedByUserId: input.userId,
    }, client);

    return {
      booking: { ...booking, examTypeId: input.examTypeId },
      protocolDisposition,
      protocolAssignmentId,
    };
  }, {
    isolationLevel: "serializable",
    operationName: "doctor_protocoling_exam_type_correction",
  });

  scheduleBookingWorklistDetailReplacement(input.appointmentId);
  const detail = await getProtocolingAppointmentDetail(input.appointmentId);
  if (!detail) throw new HttpError(404, "Appointment not found.");
  return { ...changed, detail };
}

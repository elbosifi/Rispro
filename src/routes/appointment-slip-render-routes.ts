import express, { type Request, type Response } from "express";
import { pool } from "../db/pool.js";
import { asyncRoute } from "../utils/async-route.js";
import { HttpError } from "../utils/http-error.js";
import { verifyAppointmentSlipRenderToken } from "../services/appointment-slip-render-token-service.js";
import { readAppointmentSlipSettings } from "../modules/appointments-v2/public/utils/appointment-slip-settings.js";
import { readPatientQrSettings } from "../modules/appointments-v2/public/utils/patient-qr-settings.js";
import { issuePublicCancelToken } from "../modules/appointments-v2/public/utils/public-cancel-token.js";
import { buildPublicAppointmentUrlFromSettings } from "../modules/appointments-v2/public/utils/public-appointment-url-core.js";
import { assertCompleteRegistrationListRows, contextFromRegistrationListRenderToken } from "../services/registration-list-render-context-service.js";

export const appointmentSlipRenderRouter = express.Router();

function tokenFrom(req: Request): string {
  const token = req.query.token;
  if (typeof token !== "string") throw new HttpError(401, "Appointment-slip render token is required.", { code: "APPOINTMENT_SLIP_RENDER_TOKEN_INVALID" });
  return token;
}

function safePublicAppointmentUrl(token: string | null, settings: { risproPublicBaseUrl: string }): string | null {
  if (!token) return null;
  try { return buildPublicAppointmentUrlFromSettings(token, settings); }
  catch { return null; }
}

appointmentSlipRenderRouter.get("/data", asyncRoute(async (req: Request, res: Response) => {
  const { appointmentId } = verifyAppointmentSlipRenderToken(tokenFrom(req));
  const [settings, patientQrSettings, result] = await Promise.all([
    readAppointmentSlipSettings(),
    readPatientQrSettings(),
    pool.query(`
      select b.id, b.patient_id, b.case_category, ('V2-' || lpad(b.id::text, 6, '0')) as accession_number,
             b.booking_date::text as appointment_date, b.booking_time::text as booking_time,
             (select count(*)::int from appointments_v2.bookings seq where seq.booking_date = b.booking_date and seq.id <= b.id) as daily_sequence,
             b.status, b.is_walk_in, b.notes, b.created_at, b.updated_at,
             p.arabic_full_name, p.english_full_name, p.national_id, p.mrn, p.age_years, p.demographics_estimated, p.sex, p.phone_1, p.address,
             m.name_ar as modality_name_ar, m.name_en as modality_name_en, m.code as modality_code,
             m.general_instruction_ar as modality_general_instruction_ar, m.general_instruction_en as modality_general_instruction_en,
             et.name_ar as exam_name_ar, et.name_en as exam_name_en,
             et.specific_instruction_ar as exam_specific_instruction_ar, et.specific_instruction_en as exam_specific_instruction_en,
             rp.name_ar as priority_name_ar, rp.name_en as priority_name_en
        from appointments_v2.bookings b
        join patients p on p.id = b.patient_id
        join modalities m on m.id = b.modality_id
        left join exam_types et on et.id = b.exam_type_id
        left join reporting_priorities rp on rp.id = b.reporting_priority_id
       where b.id = $1
       limit 1`, [appointmentId]),
  ]);
  const appointment = result.rows[0];
  if (!appointment) throw new HttpError(404, "Appointment not found.");
  const publicCancelToken = patientQrSettings.enabled && patientQrSettings.printQrOnAppointmentSlip
    ? await issuePublicCancelToken(appointmentId)
    : null;
  res.setHeader("Cache-Control", "no-store, private");
  res.json({
    appointment: {
      ...appointment,
      public_cancel_token: publicCancelToken,
      public_appointment_url: safePublicAppointmentUrl(publicCancelToken, patientQrSettings),
    },
    slipSettings: settings,
    patientQrSettings,
  });
}));

appointmentSlipRenderRouter.get("/registration-list/data", asyncRoute(async (req: Request, res: Response) => {
  const context = contextFromRegistrationListRenderToken(tokenFrom(req));
  const result = await pool.query(`
    select b.id, b.patient_id, b.modality_id, b.exam_type_id, b.reporting_priority_id, b.case_category,
           ('V2-' || lpad(b.id::text, 6, '0')) as accession_number,
           b.booking_date::text as appointment_date, b.booking_time::text as booking_time,
           (select count(*)::int from appointments_v2.bookings seq where seq.booking_date = b.booking_date and (seq.created_at, seq.id) <= (b.created_at, b.id)) as daily_sequence,
           b.status, b.is_walk_in, b.notes, b.created_at, b.updated_at,
           p.arabic_full_name, p.english_full_name, p.national_id, p.mrn, p.age_years, p.demographics_estimated, p.sex, p.phone_1, p.address,
           m.name_ar as modality_name_ar, m.name_en as modality_name_en, m.code as modality_code,
           m.general_instruction_ar as modality_general_instruction_ar, m.general_instruction_en as modality_general_instruction_en,
           et.name_ar as exam_name_ar, et.name_en as exam_name_en,
           et.specific_instruction_ar as exam_specific_instruction_ar, et.specific_instruction_en as exam_specific_instruction_en,
           rp.name_ar as priority_name_ar, rp.name_en as priority_name_en,
           null::int as modality_slot_number
      from unnest($1::bigint[]) with ordinality requested(id, position)
      join appointments_v2.bookings b on b.id = requested.id
      join patients p on p.id = b.patient_id
      join modalities m on m.id = b.modality_id
      left join exam_types et on et.id = b.exam_type_id
      left join reporting_priorities rp on rp.id = b.reporting_priority_id
     order by requested.position`, [context.appointmentIds]);
  const appointments = assertCompleteRegistrationListRows(context, result.rows);
  res.setHeader("Cache-Control", "no-store, private");
  res.json({ appointments, label: context.label });
}));

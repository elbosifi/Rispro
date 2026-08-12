import { pool } from "../db/pool.js";
import { getTripoliToday, normalizeDateValue } from "../utils/date.js";
import { normalizeOptionalText } from "../utils/normalize.js";
import { formatV2AccessionNumber } from "../modules/appointments-v2/shared/utils/accession.js";
import {
  buildCanonicalMwlDataset,
  renderCanonicalMwlToOrthancJson,
  type CanonicalMwlInput,
} from "./mwl-dataset-builder.js";
import { resolveOrthancSettings } from "./orthanc-settings-resolver.js";
import { buildSanteOrmO01Message, type SanteHl7BookingProjection } from "./sante-hl7-message-builder.js";
import { resolveSanteWorklistSettings } from "./sante-worklist-settings-resolver.js";
import { PROTOCOLING_MODALITY_SQL } from "./protocoling-modality.js";
import { isMwlProtocolRequirementEnabled } from "./mwl-eligibility-service.js";

export type WorklistMonitorStatus =
  | "all"
  | "failed"
  | "pending"
  | "synced"
  | "waiting_for_protocol"
  | "waiting_for_queue";

export interface WorklistMonitorQuery {
  dateFrom: string;
  dateTo: string;
  modalityId: number | null;
  status: WorklistMonitorStatus;
  q: string;
  limit: number;
}

interface WorklistMonitorDbRow {
  id: number;
  patient_id: number;
  patient_primary_id: string | null;
  mrn: string | null;
  national_id: string | null;
  phone_1: string | null;
  address: string | null;
  arabic_full_name: string;
  english_full_name: string | null;
  estimated_date_of_birth: string | null;
  sex: string | null;
  modality_id: number;
  modality_code: string;
  modality_name_en: string;
  modality_name_ar: string;
  exam_type_code: string | null;
  exam_name_en: string | null;
  exam_name_ar: string | null;
  protocol_text: string | null;
  contrast_required: boolean | null;
  contrast_phase_or_protocol: string | null;
  booking_date: string;
  booking_time: string | null;
  status: string;
  orthanc_sync_status: string | null;
  orthanc_last_attempt_at: string | null;
  orthanc_last_error: string | null;
  orthanc_outbox_id: number | null;
  orthanc_outbox_status: string | null;
  orthanc_operation: string | null;
  orthanc_history: unknown;
  sante_sync_status: string | null;
  sante_last_attempt_at: string | null;
  sante_last_error: string | null;
  sante_outbox_id: number | null;
  sante_outbox_status: string | null;
  sante_history: unknown;
  protocoling_modality_code: string | null;
  active_protocol_assignment_exists: boolean;
}

const SUPPORTED_STATUSES = new Set<WorklistMonitorStatus>(["all", "failed", "pending", "synced", "waiting_for_protocol", "waiting_for_queue"]);
const ACTIVE_WORKLIST_STATUSES = new Set(["scheduled", "arrived", "waiting"]);
const FAILURE_STATUSES = new Set(["failed", "import_failed", "pending_timeout", "retry_scheduled", "dead_letter", "nack_received", "send_failed"]);
const PENDING_STATUSES = new Set(["pending", "in_progress", "processing", "writing", "pending_import"]);
const SYNCED_STATUSES = new Set(["synced", "written", "imported_assumed", "imported_done", "completed"]);

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function normalizeWorklistMonitorQuery(raw: Record<string, unknown>, today = getTripoliToday()): WorklistMonitorQuery {
  const rawDateFrom = String(raw.dateFrom || "").trim();
  const rawDateTo = String(raw.dateTo || "").trim();
  const rawLimit = Number(raw.limit);
  const rawModalityId = Number(raw.modalityId);
  const rawStatus = String(raw.status || "all").trim() as WorklistMonitorStatus;

  return {
    dateFrom: isIsoDate(rawDateFrom) ? rawDateFrom : today,
    dateTo: isIsoDate(rawDateTo) ? rawDateTo : today,
    modalityId: Number.isInteger(rawModalityId) && rawModalityId > 0 ? rawModalityId : null,
    status: SUPPORTED_STATUSES.has(rawStatus) ? rawStatus : "all",
    q: String(raw.q || "").trim().slice(0, 80),
    limit: Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 200,
  };
}

export function computeWorklistMonitorBackendStatus(input: {
  bookingStatus: string;
  protocolingModalityCode: string | null;
  activeProtocolAssignmentExists: boolean;
  protocolRequirementEnabled: boolean;
  queueOnly: boolean;
  syncStatus: string | null;
  outboxStatus?: string | null;
}): string {
  if (input.protocolRequirementEnabled
    && ACTIVE_WORKLIST_STATUSES.has(input.bookingStatus)
    && (input.protocolingModalityCode === "CT" || input.protocolingModalityCode === "MRI")
    && !input.activeProtocolAssignmentExists) {
    return "waiting_for_protocol";
  }
  if (input.queueOnly && input.bookingStatus === "scheduled" && !input.syncStatus) return "waiting_for_queue";
  return input.syncStatus || input.outboxStatus || "not_enqueued";
}

function orthancComputedStatus(row: WorklistMonitorDbRow, queueOnly: boolean, protocolRequirementEnabled: boolean): string {
  return computeWorklistMonitorBackendStatus({
    bookingStatus: row.status,
    protocolingModalityCode: row.protocoling_modality_code,
    activeProtocolAssignmentExists: row.active_protocol_assignment_exists,
    protocolRequirementEnabled,
    queueOnly,
    syncStatus: row.orthanc_sync_status,
  });
}

function santeComputedStatus(row: WorklistMonitorDbRow, queueOnly: boolean, protocolRequirementEnabled: boolean): string {
  return computeWorklistMonitorBackendStatus({
    bookingStatus: row.status,
    protocolingModalityCode: row.protocoling_modality_code,
    activeProtocolAssignmentExists: row.active_protocol_assignment_exists,
    protocolRequirementEnabled,
    queueOnly,
    syncStatus: row.sante_sync_status,
    outboxStatus: row.sante_outbox_status,
  });
}

function rowMatchesStatus(
  row: WorklistMonitorDbRow,
  status: WorklistMonitorStatus,
  orthancQueueOnly: boolean,
  santeQueueOnly: boolean,
  protocolRequirementEnabled: boolean
): boolean {
  if (status === "all") return true;
  const orthancStatus = orthancComputedStatus(row, orthancQueueOnly, protocolRequirementEnabled);
  const santeStatus = santeComputedStatus(row, santeQueueOnly, protocolRequirementEnabled);
  if (status === "waiting_for_protocol") return orthancStatus === "waiting_for_protocol" || santeStatus === "waiting_for_protocol";
  if (status === "waiting_for_queue") return orthancStatus === "waiting_for_queue" || santeStatus === "waiting_for_queue";
  if (status === "failed") return FAILURE_STATUSES.has(orthancStatus)
    || FAILURE_STATUSES.has(santeStatus)
    || FAILURE_STATUSES.has(row.orthanc_sync_status || "")
    || FAILURE_STATUSES.has(row.sante_sync_status || "")
    || FAILURE_STATUSES.has(row.orthanc_outbox_status || "")
    || FAILURE_STATUSES.has(row.sante_outbox_status || "");
  if (status === "pending") return PENDING_STATUSES.has(orthancStatus) || PENDING_STATUSES.has(santeStatus) || PENDING_STATUSES.has(row.orthanc_outbox_status || "");
  return SYNCED_STATUSES.has(orthancStatus) || SYNCED_STATUSES.has(santeStatus);
}

function buildOrthancPreview(row: WorklistMonitorDbRow, settings: Awaited<ReturnType<typeof resolveOrthancSettings>>): unknown {
  const input: CanonicalMwlInput = {
    modalityCode: row.modality_code,
    appointmentDate: row.booking_date,
    patientPrimaryId: row.patient_primary_id,
    patientMrn: row.mrn,
    patientNationalId: row.national_id,
    patientId: row.patient_id,
    patientEnglishFullName: row.english_full_name,
    patientArabicFullName: row.arabic_full_name,
    patientBirthDate: row.estimated_date_of_birth,
    patientSex: row.sex,
    examNameEn: row.exam_name_en,
    examNameAr: row.exam_name_ar,
    modalityNameEn: row.modality_name_en,
    modalityNameAr: row.modality_name_ar,
    accessionNumber: formatV2AccessionNumber(Number(row.id)),
    requestedProcedureId: String(row.id),
    scheduledStationAeTitle: settings.worklistTarget || null,
  };
  const dataset = buildCanonicalMwlDataset(input, { mwlProfile: "minimal", compatibility: settings.mwlCompatibility });
  return renderCanonicalMwlToOrthancJson(dataset);
}

function buildSanteProjection(row: WorklistMonitorDbRow): SanteHl7BookingProjection {
  return {
    id: Number(row.id),
    patient_id: Number(row.patient_id),
    patient_primary_id: row.patient_primary_id,
    mrn: row.mrn,
    national_id: row.national_id,
    phone_1: row.phone_1,
    address: row.address,
    arabic_full_name: row.arabic_full_name,
    english_full_name: row.english_full_name,
    estimated_date_of_birth: row.estimated_date_of_birth,
    sex: row.sex,
    modality_code: row.modality_code,
    modality_name_en: row.modality_name_en,
    modality_name_ar: row.modality_name_ar,
    exam_type_code: row.exam_type_code,
    exam_name_en: row.exam_name_en,
    exam_name_ar: row.exam_name_ar,
    protocol_text: row.protocol_text,
    contrast_required: row.contrast_required,
    contrast_phase_or_protocol: row.contrast_phase_or_protocol,
    booking_date: row.booking_date,
    booking_time: row.booking_time,
    status: row.status,
  };
}

function safePreview<T>(builder: () => T): { value: T | null; error: string | null } {
  try {
    return { value: builder(), error: null };
  } catch (error) {
    return { value: null, error: (error as Error).message || "preview_failed" };
  }
}

export async function getWorklistMonitorEntries(rawQuery: Record<string, unknown>) {
  const query = normalizeWorklistMonitorQuery(rawQuery);
  const [orthancSettings, santeSettings, protocolRequirementEnabled] = await Promise.all([
    resolveOrthancSettings(),
    resolveSanteWorklistSettings(),
    isMwlProtocolRequirementEnabled(),
  ]);

  const values: unknown[] = [query.dateFrom, query.dateTo];
  const clauses = ["b.booking_date between $1::date and $2::date"];
  if (query.modalityId) {
    values.push(query.modalityId);
    clauses.push(`b.modality_id = $${values.length}::bigint`);
  }
  if (query.q) {
    values.push(`%${query.q.toLowerCase()}%`);
    clauses.push(`(
      lower('V2-' || lpad(b.id::text, 6, '0')) like $${values.length}
      or b.id::text = regexp_replace($${values.length}, '\\D', '', 'g')
      or lower(coalesce(p.identifier_value, '')) like $${values.length}
      or lower(coalesce(p.mrn, '')) like $${values.length}
      or lower(coalesce(p.national_id, '')) like $${values.length}
      or lower(coalesce(p.english_full_name, '')) like $${values.length}
      or lower(coalesce(p.arabic_full_name, '')) like $${values.length}
    )`);
  }
  values.push(query.limit);

  const { rows } = await pool.query<WorklistMonitorDbRow>(
    `
      select
        b.id,
        b.patient_id,
        p.identifier_value as patient_primary_id,
        p.mrn,
        p.national_id,
        p.phone_1,
        p.address,
        p.arabic_full_name,
        p.english_full_name,
        p.estimated_date_of_birth::text as estimated_date_of_birth,
        p.sex,
        b.modality_id,
        m.code as modality_code,
        m.name_en as modality_name_en,
        m.name_ar as modality_name_ar,
        et.code as exam_type_code,
        et.name_en as exam_name_en,
        et.name_ar as exam_name_ar,
        ap.protocol_text,
        ap.contrast_required,
        ap.contrast_phase_or_protocol,
        b.booking_date::text as booking_date,
        b.booking_time::text as booking_time,
        b.status,
        os.sync_status as orthanc_sync_status,
        os.last_attempt_at::text as orthanc_last_attempt_at,
        os.last_error as orthanc_last_error,
        oo.id as orthanc_outbox_id,
        oo.status as orthanc_outbox_status,
        oo.operation as orthanc_operation,
        coalesce(oh.history, '[]'::jsonb) as orthanc_history,
        ss.sync_status as sante_sync_status,
        ss.last_attempt_at::text as sante_last_attempt_at,
        ss.last_error as sante_last_error,
        so.id as sante_outbox_id,
        so.status as sante_outbox_status,
        coalesce(sh.history, '[]'::jsonb) as sante_history,
        protocoling_modality.modality_code as protocoling_modality_code,
        exists (
          select 1
          from appointment_protocol_assignments assignment
          where assignment.appointment_id = b.id
            and assignment.status <> 'CANCELLED'
        ) as active_protocol_assignment_exists
      from appointments_v2.bookings b
      join patients p on p.id = b.patient_id
      join modalities m on m.id = b.modality_id
      cross join lateral (
        select ${PROTOCOLING_MODALITY_SQL} as modality_code
      ) protocoling_modality
      left join exam_types et on et.id = b.exam_type_id
      left join doctor_portal.appointment_protocols ap on ap.appointment_id = b.id and ap.protocol_status = 'assigned'
      left join external_mwl_sync os on os.booking_id = b.id and os.external_system = 'orthanc'
      left join lateral (
        select id, status, operation
        from external_mwl_outbox
        where booking_id = b.id and external_system = 'orthanc'
        order by updated_at desc, id desc
        limit 1
      ) oo on true
      left join lateral (
        select jsonb_agg(jsonb_build_object(
          'id', h.id,
          'status', h.status,
          'operation', h.operation,
          'attemptCount', h.attempt_count,
          'lastError', h.last_error,
          'updatedAt', h.updated_at
        ) order by h.updated_at desc, h.id desc) as history
        from (
          select id, status, operation, attempt_count, last_error, updated_at::text as updated_at
          from external_mwl_outbox
          where booking_id = b.id and external_system = 'orthanc'
          order by updated_at desc, id desc
          limit 5
        ) h
      ) oh on true
      left join sante_worklist_sync ss on ss.booking_id = b.id
      left join lateral (
        select id, status
        from sante_hl7_outbox
        where booking_id = b.id
        order by updated_at desc, id desc
        limit 1
      ) so on true
      left join lateral (
        select jsonb_agg(jsonb_build_object(
          'id', h.id,
          'status', h.status,
          'eventType', h.event_type,
          'orderControl', h.order_control,
          'attemptCount', h.attempt_count,
          'lastError', h.last_error,
          'updatedAt', h.updated_at
        ) order by h.updated_at desc, h.id desc) as history
        from (
          select id, status, event_type, order_control, attempt_count, last_error, updated_at::text as updated_at
          from sante_hl7_outbox
          where booking_id = b.id
          order by updated_at desc, id desc
          limit 5
        ) h
      ) sh on true
      where ${clauses.join(" and ")}
      order by b.booking_date desc, b.booking_time nulls last, b.id desc
      limit $${values.length}::int
    `,
    values
  );

  const filteredRows = rows.filter((row) => rowMatchesStatus(
    row,
    query.status,
    orthancSettings.sendOnlyWhenPatientEntersQueue,
    santeSettings.sendOnlyWhenPatientEntersQueue,
    protocolRequirementEnabled
  ));

  return {
    query,
    settings: {
      orthanc: {
        enabled: orthancSettings.enabled,
        shadowMode: orthancSettings.shadowMode,
        sendOnlyWhenPatientEntersQueue: orthancSettings.sendOnlyWhenPatientEntersQueue,
        worklistTarget: orthancSettings.worklistTarget,
        compatibility: {
          specificCharacterSet: orthancSettings.mwlCompatibility.specificCharacterSet,
          patientIdSource: orthancSettings.mwlCompatibility.patientIdSource,
          patientNameSource: orthancSettings.mwlCompatibility.patientNameSource,
          procedureDescriptionSource: orthancSettings.mwlCompatibility.procedureDescriptionSource,
        },
      },
      sante: {
        enabled: santeSettings.enabled,
        mode: santeSettings.mode,
        deliveryMethod: santeSettings.deliveryMethod,
        sendOnlyWhenPatientEntersQueue: santeSettings.sendOnlyWhenPatientEntersQueue,
        expectAck: santeSettings.mllpExpectAck,
        compatibility: {
          patientIdField: santeSettings.patientIdField,
          patientNameField: santeSettings.patientNameField,
          procedureCodeField: santeSettings.procedureCodeField,
          procedureDescriptionField: santeSettings.procedureDescriptionField,
          charset: santeSettings.charset,
        },
      },
    },
    entries: filteredRows.map((row) => {
      const orthancPreview = safePreview(() => buildOrthancPreview(row, orthancSettings));
      const santePreview = safePreview(() => buildSanteOrmO01Message({
        booking: buildSanteProjection(row),
        settings: santeSettings,
        orderControl: row.status === "cancelled" || row.status === "voided" ? "CA" : "NW",
      }).message);
      return {
        bookingId: Number(row.id),
        accessionNumber: formatV2AccessionNumber(Number(row.id)),
        patientId: row.patient_primary_id || row.mrn || row.national_id || String(row.patient_id),
        patientName: normalizeOptionalText(row.english_full_name) || row.arabic_full_name,
        modality: row.modality_code,
        modalityName: row.modality_name_en || row.modality_name_ar,
        procedure: row.exam_name_en || row.exam_name_ar || row.modality_name_en || row.modality_name_ar,
        bookingDate: normalizeDateValue(row.booking_date) || row.booking_date,
        bookingTime: row.booking_time,
        queueStatus: row.status,
        orthanc: {
          status: orthancComputedStatus(row, orthancSettings.sendOnlyWhenPatientEntersQueue, protocolRequirementEnabled),
          outboxStatus: row.orthanc_outbox_status,
          outboxId: row.orthanc_outbox_id == null ? null : Number(row.orthanc_outbox_id),
          operation: row.orthanc_operation,
          lastAttemptAt: row.orthanc_last_attempt_at,
          lastError: row.orthanc_last_error || null,
          history: row.orthanc_history,
          preview: orthancPreview.value,
          previewError: orthancPreview.error,
        },
        sante: {
          status: santeComputedStatus(row, santeSettings.sendOnlyWhenPatientEntersQueue, protocolRequirementEnabled),
          outboxStatus: row.sante_outbox_status,
          outboxId: row.sante_outbox_id == null ? null : Number(row.sante_outbox_id),
          lastAttemptAt: row.sante_last_attempt_at,
          lastError: row.sante_last_error || null,
          history: row.sante_history,
          preview: santePreview.value,
          previewError: santePreview.error,
        },
      };
    }),
  };
}

type QueryExecutor = {
  query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
};

type RawRecord = Record<string, unknown>;

export interface ModalityCtProtocolPhase {
  order_index: number;
  phase_preset_name: string | null;
  custom_phase_name: string | null;
  contrast_status: string | null;
  timing_type: string | null;
  delay_seconds: number | null;
  timing_override: string | null;
  coverage: string | null;
  coverage_override: string | null;
  reconstruction_notes: string | null;
  reconstruction_override: string | null;
  instructions: string | null;
  instructions_override: string | null;
  is_required: boolean;
}

export interface ModalityMriProtocolSequence {
  order_index: number;
  scanner_id: number | null;
  scanner_name: string | null;
  sequence_preset_name: string | null;
  vendor_sequence_name: string | null;
  generic_family: string | null;
  weighting: string | null;
  default_plane: string | null;
  plane_override: string | null;
  default_coverage: string | null;
  coverage_override: string | null;
  default_b_values: string | null;
  b_values_override: string | null;
  default_dynamic_timing: string | null;
  timing_override: string | null;
  notes: string | null;
  notes_override: string | null;
  is_required: boolean;
}

export interface ModalityProtocolAssignment {
  assignment_id: number;
  appointment_id: number;
  protocol_id: number;
  protocol_version_id: number;
  protocol_name: string;
  version_number: string;
  modality: "CT" | "MRI";
  scanner_id: number | null;
  scanner_name: string | null;
  scanner_vendor: string | null;
  protocol_notes: string | null;
  contrast_notes: string | null;
  assigned_by: string | null;
  assigned_at: string | null;
  status: "ASSIGNED" | "MODIFIED";
  ct_phases: ModalityCtProtocolPhase[];
  mri_sequences: ModalityMriProtocolSequence[];
}

function textOrNull(value: unknown): string | null {
  return value == null ? null : String(value);
}

function numberOrNull(value: unknown): number | null {
  return value == null ? null : Number(value);
}

function mapAssignment(row: RawRecord): Omit<ModalityProtocolAssignment, "ct_phases" | "mri_sequences"> {
  return {
    assignment_id: Number(row.assignment_id),
    appointment_id: Number(row.appointment_id),
    protocol_id: Number(row.protocol_id),
    protocol_version_id: Number(row.protocol_version_id),
    protocol_name: String(row.protocol_name),
    version_number: String(row.version_number),
    modality: String(row.modality).toUpperCase() as "CT" | "MRI",
    scanner_id: numberOrNull(row.scanner_id),
    scanner_name: textOrNull(row.scanner_name),
    scanner_vendor: textOrNull(row.scanner_vendor),
    protocol_notes: textOrNull(row.protocol_notes),
    contrast_notes: textOrNull(row.contrast_notes),
    assigned_by: textOrNull(row.assigned_by),
    assigned_at: textOrNull(row.assigned_at),
    status: String(row.status) as "ASSIGNED" | "MODIFIED",
  };
}

function mapCtPhase(row: RawRecord): ModalityCtProtocolPhase {
  return {
    order_index: Number(row.order_index),
    phase_preset_name: textOrNull(row.phase_preset_name),
    custom_phase_name: textOrNull(row.custom_phase_name),
    contrast_status: textOrNull(row.contrast_status),
    timing_type: textOrNull(row.timing_type),
    delay_seconds: numberOrNull(row.delay_seconds),
    timing_override: textOrNull(row.timing_override),
    coverage: textOrNull(row.coverage),
    coverage_override: textOrNull(row.coverage_override),
    reconstruction_notes: textOrNull(row.reconstruction_notes),
    reconstruction_override: textOrNull(row.reconstruction_override),
    instructions: textOrNull(row.instructions),
    instructions_override: textOrNull(row.instructions_override),
    is_required: Boolean(row.is_required),
  };
}

function mapMriSequence(row: RawRecord): ModalityMriProtocolSequence {
  return {
    order_index: Number(row.order_index),
    scanner_id: numberOrNull(row.scanner_id),
    scanner_name: textOrNull(row.scanner_name),
    sequence_preset_name: textOrNull(row.sequence_preset_name),
    vendor_sequence_name: textOrNull(row.vendor_sequence_name),
    generic_family: textOrNull(row.generic_family),
    weighting: textOrNull(row.weighting),
    default_plane: textOrNull(row.default_plane),
    plane_override: textOrNull(row.plane_override),
    default_coverage: textOrNull(row.default_coverage),
    coverage_override: textOrNull(row.coverage_override),
    default_b_values: textOrNull(row.default_b_values),
    b_values_override: textOrNull(row.b_values_override),
    default_dynamic_timing: textOrNull(row.default_dynamic_timing),
    timing_override: textOrNull(row.timing_override),
    notes: textOrNull(row.notes),
    notes_override: textOrNull(row.notes_override),
    is_required: Boolean(row.is_required),
  };
}

export async function getModalityProtocolAssignment(
  appointmentId: number,
  executor?: QueryExecutor
): Promise<ModalityProtocolAssignment | null> {
  const queryExecutor = executor ?? (await import("../../../db/pool.js")).pool;
  const assignmentResult = await queryExecutor.query<RawRecord>(
    `
      select
        assignment.id as assignment_id,
        assignment.appointment_id,
        assignment.protocol_id,
        assignment.protocol_version_id,
        protocol.name as protocol_name,
        version.version_number,
        protocol.modality,
        assignment.scanner_id,
        scanner.name as scanner_name,
        scanner.vendor as scanner_vendor,
        assignment.protocol_notes,
        assignment.contrast_notes,
        coalesce(doctor.display_name, assigned_user.full_name) as assigned_by,
        assignment.assigned_at::text as assigned_at,
        assignment.status
      from appointments_v2.bookings booking
      join appointment_protocol_assignments assignment on assignment.appointment_id = booking.id
      join protocols protocol on protocol.id = assignment.protocol_id
      join protocol_versions version on version.id = assignment.protocol_version_id
      left join imaging_scanners scanner on scanner.id = assignment.scanner_id
      left join users assigned_user on assigned_user.id = assignment.assigned_by
      left join doctor_portal.doctor_profiles doctor on doctor.user_id = assigned_user.id
      where booking.id = $1
        and booking.status not in ('cancelled', 'discontinued', 'voided')
        and upper(protocol.modality) in ('CT', 'MRI')
        and assignment.status <> 'CANCELLED'
      order by assignment.updated_at desc, assignment.id desc
      limit 1
    `,
    [appointmentId]
  );
  const assignmentRow = assignmentResult.rows[0];
  if (!assignmentRow) return null;

  const assignment = mapAssignment(assignmentRow);
  const [ctRows, mriRows] = await Promise.all([
    queryExecutor.query<RawRecord>(
      `
        select
          phase.order_index,
          preset.name as phase_preset_name,
          phase.custom_phase_name,
          preset.contrast_status,
          preset.timing_type,
          preset.delay_seconds,
          phase.timing_override,
          preset.default_coverage as coverage,
          phase.coverage_override,
          preset.reconstruction_notes,
          phase.reconstruction_override,
          preset.instructions,
          phase.instructions_override,
          phase.is_required
        from protocol_ct_phases phase
        left join ct_phase_presets preset on preset.id = phase.ct_phase_preset_id
        where phase.protocol_version_id = $1
        order by phase.order_index asc, phase.id asc
      `,
      [assignment.protocol_version_id]
    ),
    queryExecutor.query<RawRecord>(
      `
        select
          sequence.order_index,
          coalesce(sequence.scanner_id, preset.scanner_id) as scanner_id,
          coalesce(sequence_scanner.name, preset_scanner.name) as scanner_name,
          preset.name as sequence_preset_name,
          preset.vendor_sequence_name,
          preset.generic_family,
          preset.weighting,
          preset.default_plane,
          sequence.plane_override,
          preset.default_coverage,
          sequence.coverage_override,
          preset.default_b_values,
          sequence.b_values_override,
          preset.default_dynamic_timing,
          sequence.timing_override,
          preset.notes,
          sequence.notes_override,
          sequence.is_required
        from protocol_mri_sequences sequence
        left join mri_sequence_presets preset on preset.id = sequence.mri_sequence_preset_id
        left join imaging_scanners sequence_scanner on sequence_scanner.id = sequence.scanner_id
        left join imaging_scanners preset_scanner on preset_scanner.id = preset.scanner_id
        where sequence.protocol_version_id = $1
        order by sequence.order_index asc, sequence.id asc
      `,
      [assignment.protocol_version_id]
    ),
  ]);

  return {
    ...assignment,
    ct_phases: ctRows.rows.map(mapCtPhase),
    mri_sequences: mriRows.rows.map(mapMriSequence),
  };
}

import fs from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import type { PoolClient } from "pg";
import { pool } from "../../db/pool.js";
import { env } from "../../config/env.js";
import { HttpError } from "../../utils/http-error.js";
import { logAuditEntry } from "../../services/audit-service.js";
import { readSonicDicomReportSettings } from "../../services/sonicdicom-report-settings.js";
import { checkSonicDicomReportStatus } from "../../services/sonicdicom-report-service.js";
import { getAuthorizedReportingBoardAppointmentRead, type Actor } from "../doctor-portal/reporting-board-service.js";
import { findViewerContext, readOhifViewerConfiguration, type ViewerLaunchSessionRecord } from "../ohif-viewer/repository.js";
import { createImagingSourceAdapter } from "../ohif-viewer/adapters.js";
import { EMPTY_SECTIONS, sections, revision, uuid, provenance, validatePng, type ReportSections } from "./reporting-validation.js";
import { imageDigest, readReportImage, storeReportImage } from "./report-image-storage-service.js";

export interface Identity { patientName: string; patientIdentifier: string; accession: string; examination: string; studyDate: string }
interface ImageRow {
  id: string; report_id: string; stored_path: string; sha256: string; byte_size: number;
  width: number; height: number; provenance: Record<string, unknown>; caption: string; position: number;
  captured_by_user_id: string; created_at: Date; removed: boolean;
}
export interface ReportRow {
  id: string; appointment_id: string; patient_id: string; primary_study_uid: string;
  imaging_source: { accessStrategy: string; sourcePacsNodeId: number | null };
  identity: Identity; status: "draft" | "final"; revision: number; sections: ReportSections;
  author_user_id: string; author_name: string; finalizer_name: string | null;
  finalized_at: Date | null; signed_snapshot: Snapshot | null; finalize_request_id: string | null;
  created_at: Date; updated_at: Date;
  report_type: string; collaboration_mode: 'independent'|'shared'; is_primary: boolean;
  last_editor_name: string|null; review_requested_at: Date|null; review_requested_by: string|null;
  preferred_reviewer_id: number|null; reviewed_by: string|null; deleted_at: Date|null;
  author_doctor_role?:string;
}
interface Snapshot { identity: Identity; sections: ReportSections; keyImages: ReturnType<typeof publicImage>[]; author: string; finalizer: string; signedAt: string }
const conflict = () => new HttpError(409, "The report changed in another editor. Your unsaved text is retained. Reload the saved report before retrying.");
function publicImage({ stored_path: _path, report_id: _report, ...safe }: ImageRow) { return safe; }
export async function images(db: Pick<PoolClient,"query">, reportId: string) {
  return (await db.query<ImageRow>("select * from native_report_key_images where report_id=$1 and removed=false order by position,id", [reportId])).rows;
}
export async function audit(db: PoolClient, actor: Actor, id: string, action: string, rev: number) {
  await logAuditEntry({ entityType: "native_report", entityId: id, actionType: action,
    newValues: { revision: rev }, changedByUserId: actor.userId }, db);
}
export async function transaction<T>(work: (db: PoolClient) => Promise<T>) {
  const db = await pool.connect();
  try { await db.query("begin"); const result = await work(db); await db.query("commit"); return result; }
  catch (error) { await db.query("rollback"); throw error; } finally { db.release(); }
}
async function access(actor: Actor, appointmentId: number) {
  const { row, me } = await getAuthorizedReportingBoardAppointmentRead(actor, appointmentId);
  if (me.profile?.userActive === false) throw new HttpError(403,"Reporting account access was revoked.");
  const configuration = await readOhifViewerConfiguration();
  const enabled = env.ohifEnabled && configuration.settings.enabled && configuration.settings.nativeReportingEnabled === true;
  const canReport = me.allowedModalities.some(p => p.active && p.canReport && Number(p.modalityId) === Number(row.modalityId));
  const assigned = Number(row.assignedDoctorId) === Number(me.profile?.id);
  const manager = me.moduleCapabilities.includes("doctor_supervisor") || me.moduleCapabilities.includes("doctor_admin");
  const canEdit = enabled && canReport && (assigned || manager) && row.appointmentStatus === "completed"
    && row.requiresReport && !row.reportingHold && !row.workflowHold && ["CT","MR","MRI"].includes(row.modalityCode.toUpperCase());
  return { row, me, configuration, enabled, canEdit, canFinalize: canEdit && me.canFinalizeReports };
}
async function context(actor: Actor, contextId: string, appointmentId?: number, db: Pick<PoolClient,"query"> = pool) {
  const session = await findViewerContext(uuid(contextId), actor.userId, db);
  if (!session || (appointmentId != null && session.appointmentId !== appointmentId)) throw new HttpError(403, "The viewer context is expired, revoked, or belongs to a different case. Reopen the case from RISpro.");
  return session;
}
function assertSource(session: ViewerLaunchSessionRecord, configuration: Awaited<ReturnType<typeof readOhifViewerConfiguration>>) {
  if(configuration.settings.accessStrategy!==session.accessStrategy || configuration.settings.selectedPacsNodeId!==session.sourcePacsNodeId)
    throw new HttpError(409,"The imaging source changed. Editing and capture stopped. Reopen the case from RISpro.");
}
async function assertMapping(db: Pick<PoolClient,"query">, session: ViewerLaunchSessionRecord, report?: ReportRow) {
  const result = await db.query<{ patient_id: string; study_instance_uid: string | null; resolved_uid: string | null; patient_dicom_id: string | null; patient_id_value: string | null }>(`
    select b.patient_id,b.study_instance_uid,coalesce(nullif(trim((select pi.value from patient_identifiers pi where pi.patient_id=p.id and pi.is_primary=true order by pi.id limit 1)),''),nullif(trim(p.identifier_value),''),nullif(trim(p.national_id),'')) as patient_dicom_id,s.study_instance_uid as resolved_uid,s.patient_id_value
    from appointments_v2.bookings b join patients p on p.id=b.patient_id
    left join study_source_resolutions s on s.appointment_id=b.id and s.source_pacs_node_id is not distinct from $2
      and s.source_kind=$3 where b.id=$1`,
  [session.appointmentId, session.sourcePacsNodeId, session.sourcePacsNodeId == null ? "authoritative_orthanc" : "pacs"]);
  const row = result.rows[0];
  if (!row || !session.patientId || Number(row.patient_id) !== session.patientId || result.rows.length !== 1 || row.resolved_uid !== session.studyInstanceUid
    || (row.study_instance_uid && row.study_instance_uid !== session.studyInstanceUid)
    || (row.patient_id_value && row.patient_dicom_id !== row.patient_id_value)
    || (report && (Number(row.patient_id) !== Number(report.patient_id) || report.primary_study_uid !== session.studyInstanceUid
      || report.imaging_source.accessStrategy !== session.accessStrategy || report.imaging_source.sourcePacsNodeId !== session.sourcePacsNodeId)))
    throw new HttpError(409, "The patient/study mapping changed or is ambiguous. Editing and capture stopped. Reopen and reconcile the case in RISpro.");
}
export async function resolveReportContext(actor: Actor, contextId: string) {
  const session = await context(actor, contextId);
  if(session.reportingStudyKey) return (await import('./workspace-viewer-service.js')).workspaceViewerContext(actor,session);
  if(session.accessStrategy==='authoritative_orthanc'&&(await (await import('./reporting-policy.js')).readReportingPolicy()).enabled) {
    const indexed=(await pool.query('select orthanc_study_id from historical_pacs_studies where study_instance_uid=$1',[session.studyInstanceUid])).rows;
    if(indexed.length===1) {
      const {getWorkspaceStudy}=await import('./workspace-report-service.js');
      await getWorkspaceStudy(actor,indexed[0].orthanc_study_id);
      const study=(await pool.query('select id from native_reporting_studies where study_instance_uid=$1 and orthanc_study_id=$2',[session.studyInstanceUid,indexed[0].orthanc_study_id])).rows;
      if(study.length===1)return (await import('./workspace-viewer-service.js')).workspaceViewerContext(actor,{...session,reportingStudyKey:study[0].id});
    }
    throw new HttpError(409,'Reconcile the study in Doctor Workspace V2 before opening the report panel.');
  }
  const a = await access(actor, session.appointmentId);
  let blockedReason: string | null = null;
  try { assertSource(session,a.configuration); await assertMapping(pool, session); } catch (e) { blockedReason = (e as Error).message; }
  return { contextId, appointmentId: session.appointmentId, primaryStudyUid: session.studyInstanceUid,
    enabled: a.enabled, canEdit: a.canEdit && !blockedReason, canFinalize: a.canFinalize && !blockedReason, blockedReason,
    identity: { ...identity(a.row), studyDate: session.studyDate || a.row.bookingDate }, report: await getReport(actor, session.appointmentId) };
}
function identity(row: Awaited<ReturnType<typeof access>>["row"]): Identity {
  return { patientName: row.patientEnglishName || row.patientArabicName || "", patientIdentifier: row.patientMrn || row.patientDicomId || "",
    accession: row.accessionNumber, examination: row.examTypeName || row.modalityName, studyDate: row.bookingDate };
}
export interface ReportResponseCache {images:Awaited<ReturnType<typeof images>>;addenda:{id:string;author:string;signedAt:Date|string;text:string}[]}
export async function response(db: Pick<PoolClient,"query">, report: ReportRow,loaded?:ReportResponseCache) {
  const snapshot = report.signed_snapshot;
  return { id: Number(report.id), appointmentId: report.appointment_id == null ? null : Number(report.appointment_id), revision: report.revision, status: report.status,
    identity: snapshot?.identity ?? report.identity, sections: snapshot?.sections ?? report.sections,
    author: report.author_name, finalizer: report.finalizer_name, finalizedAt: report.finalized_at,
    keyImages: snapshot?.keyImages ?? (loaded?.images ?? await images(db, report.id)).map(publicImage), updatedAt: report.updated_at,
    addenda: loaded?.addenda ?? (await db.query("select id,actor_name as author,created_at as \"signedAt\",snapshot->>'text' as text from native_report_versions where report_id=$1 and kind='addendum' order by id", [report.id])).rows };
}
export async function getReport(actor: Actor, appointmentId: number) {
  await access(actor, appointmentId);
  const report = (await pool.query<ReportRow>("select * from native_reports where appointment_id=$1 and deleted_at is null order by (status='final' and is_primary) desc,legacy_primary desc,id limit 1", [appointmentId])).rows[0];
  if (report) await logAuditEntry({entityType:"native_report",entityId:report.id,actionType:"native_report_read",newValues:{revision:report.revision},changedByUserId:actor.userId});
  return report ? response(pool, report) : null;
}
export async function createReport(actor: Actor, contextId: string, appointmentId: number) {
  if((await (await import('./reporting-policy.js')).readReportingPolicy()).enabled) throw new HttpError(409,'Choose a report explicitly in Doctor Workspace V2 or the updated OHIF report selector.');
  const a = await access(actor, appointmentId);
  if (!a.canEdit) throw new HttpError(403, "Native report creation requires an enabled integration and reporting permission for this assigned case.");
  const session = await context(actor, contextId, appointmentId);
  assertSource(session,a.configuration);
  // An existing report is always retrieved, never duplicated or reattached.
  const existing = (await pool.query<ReportRow>("select * from native_reports where appointment_id=$1 and deleted_at is null order by (status='final' and is_primary) desc,legacy_primary desc,id limit 1", [appointmentId])).rows[0];
  if (existing) { await assertMapping(pool, session, existing); return response(pool, existing); }
  const sonic = await readSonicDicomReportSettings();
  if (sonic.sonicDicomReportsEnabled) {
    const external = await checkSonicDicomReportStatus({ bookingId: appointmentId, accessionNumber: a.row.accessionNumber,
      studyInstanceUid: session.studyInstanceUid, requiresReport: true, status: a.row.appointmentStatus });
    if (!["no_report","study_not_found"].includes(external.state)) throw new HttpError(409, "External reporting ownership exists or cannot be verified. Native reporting cannot take over this case.");
  }
  return transaction(async db => {
    await db.query("select id from appointments_v2.bookings where id=$1 for update", [appointmentId]);
    const currentAccess=await access(actor,appointmentId);
    if (!currentAccess.canEdit) throw new HttpError(403,"Reporting access changed before report creation.");
    assertSource(session,currentAccess.configuration);
    await assertMapping(db, session);
    const currentSonic = await readSonicDicomReportSettings();
    if (currentSonic.sonicDicomReportsEnabled !== sonic.sonicDicomReportsEnabled)
      throw new HttpError(409, "External reporting configuration changed. Reopen the case before creating a report.");
    // Worklist reads enqueue an untouched 'unavailable' placeholder. It carries
    // no ownership evidence when that integration is disabled. Any attempted
    // check, retained source/history or external document still fails closed.
    const legacy = await db.query(`select 1 from doctor_portal.reporting_board_manual_final_overrides where appointment_id=$1 and cleared_at is null
      union all select 1 from doctor_portal.reporting_board_sonicdicom_cache where appointment_id=$1 and (
        sonicdicom_latest_document_id is not null or (
          report_status not in ('no_report','study_not_found') and not (
            $2::boolean and report_status='unavailable' and source is null
            and last_attempt_at is null and last_success_at is null and failure_count=0 and last_error is null
            and status_changed_at is null and report_final_at is null
            and sonicdicom_finalized_by_account is null and finalized_by_doctor_id is null
          )
        )
      )`, [appointmentId, !currentSonic.sonicDicomReportsEnabled]);
    if (legacy.rows.length) throw new HttpError(409, "This case has external reporting ownership, unverifiable legacy status, or a manual final override.");
    const r = (await db.query<ReportRow>(`insert into native_reports(appointment_id,patient_id,primary_study_uid,imaging_source,identity,sections,author_user_id,author_name)
      values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(appointment_id) where legacy_primary and deleted_at is null do nothing returning *`,
    [appointmentId, a.row.patientId, session.studyInstanceUid, JSON.stringify({ accessStrategy: session.accessStrategy, sourcePacsNodeId: session.sourcePacsNodeId }),
      JSON.stringify({ ...identity(a.row), studyDate: session.studyDate || a.row.bookingDate }), JSON.stringify(EMPTY_SECTIONS), actor.userId, a.me.profile!.displayName])).rows[0];
    const report = r ?? (await db.query<ReportRow>("select * from native_reports where appointment_id=$1 and legacy_primary and deleted_at is null", [appointmentId])).rows[0];
    await assertMapping(db, session, report);
    if (r) { await history(db, report, actor, a.me.profile!.displayName, "draft"); await audit(db, actor, report.id, "native_report_created", report.revision); }
    return response(db, report);
  });
}
export async function history(db: PoolClient, report: ReportRow, actor: Actor, name: string, kind: "draft" | "final", requestId?:string) {
  await db.query(`insert into native_report_versions(report_id,revision,kind,snapshot,actor_user_id,actor_name,request_id)
    values($1,$2,$3,$4,$5,$6,$7)`, [report.id, report.revision, kind, JSON.stringify(report.signed_snapshot ?? { identity: report.identity, sections: report.sections, keyImages: (await images(db, report.id)).map(publicImage) }), actor.userId, name,requestId??null]);
  await db.query('insert into native_report_contributors(report_id,user_id,display_name) values($1,$2,$3) on conflict do nothing',[report.id,actor.userId,name]);
}
async function locked(actor: Actor, contextId: string, appointmentId: number, expected: unknown, sign: boolean,
  work: (db: PoolClient, report: ReportRow, a: Pick<Awaited<ReturnType<typeof access>>,'me'|'configuration'> & {row:Pick<Awaited<ReturnType<typeof access>>['row'],'patientDicomId'>}, session: ViewerLaunchSessionRecord) => Promise<unknown>, allowFinal = false, retryId?: string, selectedReportId?:number) {
  if(selectedReportId) {
    const {withWorkspaceReport,canEditWorkspaceReport,workspaceReportResponse}=await import('./workspace-report-service.js');
    return withWorkspaceReport(actor,selectedReportId,expected,async(db,report,a,study)=>{
      if(!canEditWorkspaceReport(a,report))throw new HttpError(403,'The selected report is not editable.');
      const session=await context(actor,contextId,undefined,db),configuration=await readOhifViewerConfiguration();
      assertSource(session,configuration);
      if(session.studyInstanceUid!==report.primary_study_uid||session.reportingStudyKey&&session.reportingStudyKey!==study.id)throw new HttpError(403,'The selected report is outside this viewer context.');
      await work(db,report,{me:a.me,configuration,row:{patientDicomId:a.study.patient_id}},session);
      const updated=(await db.query<ReportRow>('select * from native_reports where id=$1',[report.id])).rows[0];
      return workspaceReportResponse(db,updated,a,study.orthanc_study_id);
    },retryId);
  }
  if((await (await import('./reporting-policy.js')).readReportingPolicy()).enabled)throw new HttpError(409,'Use report-specific Doctor Workspace V2 actions so current reporting policies are enforced.');
  const expectedRevision = revision(expected);
  const a = await access(actor, appointmentId);
  if (sign ? !a.canFinalize : !a.canEdit) throw new HttpError(403, sign ? "You do not have report finalization permission for this case." : "You do not have report editing permission for this case.");
  return transaction(async db => {
    await db.query("select id from appointments_v2.bookings where id=$1 for update",[appointmentId]);
    const currentAccess=await access(actor,appointmentId);
    if(sign?!currentAccess.canFinalize:!currentAccess.canEdit)throw new HttpError(403,"Reporting access changed before this operation.");
    const session = await context(actor, contextId, appointmentId, db);
    assertSource(session,currentAccess.configuration);
    const report = (await db.query<ReportRow>("select * from native_reports where appointment_id=$1 and legacy_primary and deleted_at is null for update", [appointmentId])).rows[0];
    if (!report) throw new HttpError(404, "Create a RISpro report explicitly before editing.");
    if((await db.query('select 1 from native_report_study_links where report_id=$1',[report.id])).rowCount &&
      ((await (await import('./reporting-policy.js')).readReportingPolicy(db)).enabled || 'archiveKey' in report.imaging_source))
      throw new HttpError(409,'Use report-specific Doctor Workspace V2 actions for this report.');
    await assertMapping(db, session, report);
    const retry = retryId && (report.finalize_request_id === retryId || (await db.query("select 1 from native_report_key_images where id=$1 and report_id=$2",[retryId,report.id])).rows.length > 0);
    if (!retry && report.revision !== expectedRevision) throw conflict();
    if (!retry && report.status === "final" && !allowFinal) throw new HttpError(409, "The report is signed. Add a signed text addendum for corrections.");
    return work(db, report, currentAccess, session);
  });
}
export async function saveDraft(actor: Actor, contextId: string, appointmentId: number, body: Record<string, unknown>) {
  const text = sections(body.sections);
  return locked(actor, contextId, appointmentId, body.expectedRevision, false, async (db, report, a) => {
    if (JSON.stringify(sections(report.sections)) === JSON.stringify(text)) return response(db, report);
    const saved = (await db.query<ReportRow>("update native_reports set sections=$2,revision=revision+1,updated_at=now() where id=$1 returning *", [report.id, JSON.stringify(text)])).rows[0];
    await history(db, saved, actor, a.me.profile!.displayName, "draft");
    await audit(db, actor, report.id, "native_report_saved", saved.revision);
    return response(db, saved);
  });
}
export async function finalizeReport(actor: Actor, contextId: string, appointmentId: number, body: Record<string, unknown>) {
  const requestId = uuid(body.requestId);
  // A retry must still satisfy current access/context checks, but may carry the pre-sign revision.
  const current = await getReport(actor, appointmentId);
  const prior = (await pool.query<ReportRow>("select * from native_reports where appointment_id=$1 and legacy_primary and deleted_at is null", [appointmentId])).rows[0];
  const expected = prior?.finalize_request_id === requestId ? current?.revision : body.expectedRevision;
  return locked(actor, contextId, appointmentId, expected, true, async (db, report, a) => {
    if (report.status === "final") {
      if (report.finalize_request_id === requestId) return response(db, report);
      throw new HttpError(409, "This report is already signed.");
    }
    if (body.confirmed !== true || !report.sections.findings.trim() || !report.sections.impression.trim()) throw new HttpError(400, "Confirm the patient/examination and complete Findings and Impression before signing.");
    const selected = await images(db, report.id);
    for (const image of selected) await readReportImage(image);
    const signedAt = new Date().toISOString();
    const snapshot: Snapshot = { identity: report.identity, sections: report.sections, keyImages: selected.map(publicImage), author: report.author_name, finalizer: a.me.profile!.displayName, signedAt };
    const saved = (await db.query<ReportRow>(`update native_reports set status='final',revision=revision+1,
      finalized_by_user_id=$2,finalized_by_doctor_id=$3,finalizer_name=$4,finalized_at=$5,signed_snapshot=$6,finalize_request_id=$7,updated_at=now() where id=$1 returning *`,
    [report.id, actor.userId, a.me.profile!.id, snapshot.finalizer, signedAt, JSON.stringify(snapshot), requestId])).rows[0];
    await history(db, saved, actor, snapshot.finalizer, "final");
    await audit(db, actor, report.id, "native_report_finalized", saved.revision);
    return response(db, saved);
  }, true, requestId);
}
export async function addAddendum(actor: Actor, contextId: string, appointmentId: number, body: Record<string, unknown>) {
  const requestId = uuid(body.requestId);
  const text = String(body.text ?? "").trim();
  if (!text || text.length > 100000 || body.confirmed !== true) throw new HttpError(400, "Confirm and enter the text addendum.");
  return locked(actor, contextId, appointmentId, body.expectedRevision, true, async (db, report, a) => {
    if (report.status !== "final") throw new HttpError(409, "Only signed reports accept addenda.");
    const retry = (await db.query("select report_id,snapshot from native_report_versions where request_id=$1", [requestId])).rows[0];
    if (retry && (Number(retry.report_id) !== Number(report.id) || retry.snapshot.text !== text)) throw new HttpError(409, "The addendum request identifier was already used.");
    if (!retry) {
      await db.query(`insert into native_report_versions(report_id,kind,snapshot,actor_user_id,actor_name,request_id,created_at) values($1,'addendum',$2,$3,$4,$5,clock_timestamp())`, [report.id, JSON.stringify({ text }), actor.userId, a.me.profile!.displayName, requestId]);
      await audit(db, actor, report.id, "native_report_addendum_signed", report.revision);
    }
    return response(db, report);
  }, true);
}
export async function getReportHistory(actor: Actor, appointmentId: number) {
  await access(actor, appointmentId);
  return (await pool.query(`select v.id,v.revision,v.kind,v.snapshot,v.actor_name as author,v.created_at as "createdAt"
    from native_report_versions v join native_reports r on r.id=v.report_id where r.appointment_id=$1 order by v.id`, [appointmentId])).rows;
}

export async function uploadKeyImage(actor: Actor, contextId: string, appointmentId: number, body: Record<string, unknown>, bytes: Buffer, selectedReportId?:number) {
  const requestId = uuid(body.requestId);
  const source = provenance(body.provenance);
  const dimensions = await validatePng(bytes);
  let staged: { storedPath: string; absolutePath: string } | null = null;
  return locked(actor, contextId, appointmentId, body.expectedRevision, false, async (db, report, a, session) => {
    const retry = (await db.query<ImageRow>("select * from native_report_key_images where id=$1", [requestId])).rows[0];
    if (retry) {
      if (Number(retry.report_id) !== Number(report.id) || retry.sha256 !== imageDigest(bytes)
        || !isDeepStrictEqual(provenance(retry.provenance), source)) throw new HttpError(409, "The capture identifier was already used for another image.");
      return response(db, report);
    }
    if (!session.permittedStudyUids.includes(source.studyInstanceUid)) throw new HttpError(403, "This image is outside the authorized primary/prior studies.");
    if ((await images(db, report.id)).length >= 24) throw new HttpError(400, "A v1 report supports up to 24 key images.");
    // Verify provenance with the already authorized source. Never trust browser demographic data.
    const adapter = await createImagingSourceAdapter(a.configuration);
    const metadata = await adapter.getStudyMetadata(source.studyInstanceUid);
    const tag = (item: Record<string, { Value?: unknown[] }>, key: string) => item[key]?.Value?.[0];
    const candidates = (Array.isArray(metadata) ? metadata : []).filter(item => tag(item, "0020000D") === source.studyInstanceUid && tag(item, "0020000E") === source.seriesInstanceUid);
    if (!candidates.length || candidates.some(item => String(tag(item, "00100020") || "") !== a.row.patientDicomId)) throw new HttpError(409, "The captured series cannot be verified as belonging to this patient.");
    const frame = candidates.find(item => tag(item,"00080018") === source.sopInstanceUid);
    if (source.viewportType === "stack" && (!frame || Number(source.frameNumber) > Number(tag(frame,"00280008") || 1))) throw new HttpError(400, "The source SOP/frame does not exist in this series.");
    const stored = await storeReportImage(bytes);
    staged = stored;
    try {
      const durable = { ...source, imagingSource: report.imaging_source, sourceStudyDate: String(tag(candidates[0],"00080020") || ""),
        sourceSeriesDescription: String(tag(candidates[0],"0008103E") || ""), prior: !session.currentStudyUids.includes(source.studyInstanceUid),
        capturedByUserId: actor.userId, capturedAt: new Date().toISOString() };
      await db.query(`insert into native_report_key_images(id,report_id,stored_path,sha256,byte_size,width,height,provenance,position,captured_by_user_id)
        values($1,$2,$3,$4,$5,$6,$7,$8,(select coalesce(max(position),0)+1 from native_report_key_images where report_id=$2),$9)`,
      [requestId, report.id, stored.storedPath, stored.sha256, bytes.length, dimensions.width, dimensions.height, JSON.stringify(durable), actor.userId]);
      const saved = (await db.query<ReportRow>("update native_reports set revision=revision+1,updated_at=now() where id=$1 returning *", [report.id])).rows[0];
      await history(db, saved, actor, a.me.profile!.displayName, "draft");
      await audit(db, actor, report.id, "native_report_image_added", saved.revision);
      return await response(db, saved);
    } catch (error) { await fs.unlink(stored.absolutePath).catch(() => undefined); throw error; }
  }, false, requestId,selectedReportId).catch(async error => {
    if (staged) {
      // Resolve an uncertain COMMIT before deleting bytes; never delete a referenced asset.
      const file: { storedPath: string; absolutePath: string } = staged;
      const reference = await pool.query("select 1 from native_report_key_images where stored_path=$1",[file.storedPath]).catch(()=>null);
      if (reference && !reference.rows.length) await fs.unlink(file.absolutePath).catch(()=>undefined);
    }
    throw error;
  });
}
export async function updateKeyImages(actor: Actor, contextId: string, appointmentId: number, body: Record<string, unknown>, selectedReportId?:number) {
  return locked(actor, contextId, appointmentId, body.expectedRevision, false, async (db, report, a) => {
    const selected = body.images as { id: string; caption: string }[];
    const current = await images(db, report.id);
    if (!Array.isArray(selected) || selected.length > current.length || new Set(selected.map(i=>i.id)).size !== selected.length
      || selected.some(i=>!current.some(c=>c.id===i.id) || typeof i.caption !== "string" || i.caption.length>2000)) throw new HttpError(400, "Invalid key-image selection.");
    if (JSON.stringify(selected) === JSON.stringify(current.map(i=>({id:i.id,caption:i.caption})))) return response(db,report);
    await db.query("update native_report_key_images set removed=true where report_id=$1 and removed=false", [report.id]);
    for (let index=0;index<selected.length;index++) await db.query("update native_report_key_images set removed=false,position=$3,caption=$4 where report_id=$1 and id=$2", [report.id,selected[index].id,index+1,selected[index].caption]);
    const saved = (await db.query<ReportRow>("update native_reports set revision=revision+1,updated_at=now() where id=$1 returning *", [report.id])).rows[0];
    await history(db,saved,actor,a.me.profile!.displayName,"draft");
    await audit(db,actor,report.id,"native_report_images_updated",saved.revision);
    return response(db,saved);
  },false,undefined,selectedReportId);
}
export async function getKeyImage(actor: Actor, appointmentId: number, imageId: string) {
  await access(actor,appointmentId);
  const image = (await pool.query<ImageRow>(`select i.* from native_report_key_images i join native_reports r on r.id=i.report_id
    where r.appointment_id=$1 and i.id=$2 and i.removed=false`,[appointmentId,uuid(imageId)])).rows[0];
  if (!image) throw new HttpError(404,"Report image not found.");
  return readReportImage(image);
}

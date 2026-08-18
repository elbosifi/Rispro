import { createHash } from "node:crypto";
import sharp from "sharp";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { logAuditEntry } from "./audit-service.js";
import { createAuthoritativeOrthancClient, type OrthancPatientIdentitySnapshot } from "./authoritative-orthanc-service.js";
import { createClinicalDocumentSecondaryCapture } from "./clinical-document-dicom.js";
import { upsertHistoricalPacsStudies } from "./historical-pacs-index-service.js";
import type { UserId } from "../types/http.js";

export type PatientIdentityReconciliationOperation = "reconcile" | "reverse";
export type PatientIdentityReconciliationStatus = "queued" | "processing" | "completed" | "failed";
export interface PatientIdentityReconciliationJob {
  id: number; operation_type: PatientIdentityReconciliationOperation; patient_id: number; study_instance_uid: string; accession_number: string | null; study_date: string | null;
  orthanc_study_id_before: string | null; orthanc_study_id_after: string | null; old_patient_id: string | null; new_patient_id: string | null;
  original_other_patient_ids: Array<Record<string, unknown>> | null; result_other_patient_ids: Array<Record<string, unknown>> | null;
  original_patient_name: string | null; original_patient_birth_date: string | null; original_patient_sex: string | null;
  original_series_instance_uids: string[] | null; original_sop_instance_uids: string[] | null; status: PatientIdentityReconciliationStatus; stage: string;
  orthanc_job_id: string | null; requested_by_user_id: number; requested_at: string; started_at: string | null; completed_at: string | null;
  reverses_job_id: number | null; reversed_by_job_id: number | null; failure_code: string | null; failure_details: Record<string, unknown> | null;
  processing_attempt_count: number; lease_owner: string | null; lease_expires_at: string | null; last_heartbeat_at: string | null; operator_name?: string | null;
}

const clean = (value: unknown) => String(value ?? "").trim();
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
type PatientIdentityStudyFingerprint = { orthancStudyId: string; studyInstanceUid: string | null; accessionNumber: string | null; patientId: string | null; patientName: string | null; patientBirthDate: string | null; patientSex: string | null; studyDate: string | null; otherPatientIdsSequence: Array<Record<string, unknown>> };
const sequencePatientId = (item: Record<string, unknown>) => {const raw=item.PatientID??item["00100020"]??item["0010,0020"]??item["0010-0020"];return clean(typeof raw==="object"&&raw?((raw as Record<string,unknown>).Value??(raw as Record<string,unknown>).value):raw);};
export function appendHistoricalPatientId(sequence: Array<Record<string, unknown>>, patientId: string): Array<Record<string, unknown>> {
  const result = sequence.map((item) => structuredClone(item));
  if (!result.some((item) => sequencePatientId(item) === patientId)) result.push({ PatientID: patientId });
  return result;
}

function errorCode(error: unknown): string { return clean((error as { details?: { code?: unknown } })?.details?.code) || "PATIENT_IDENTITY_RECONCILIATION_ORTHANC_FAILED"; }
async function audit(job: PatientIdentityReconciliationJob, actionType: string, outcome: string, code?: string) {
  await logAuditEntry({ entityType: "patient_identity_reconciliation", entityId: job.id, actionType, oldValues: null, newValues: { outcome, operation: job.operation_type, studyInstanceUid: job.study_instance_uid, code: code || null }, changedByUserId: job.requested_by_user_id });
}

export async function requirePatientIdentityReconciliationAccess(userId: UserId, role: string): Promise<void> {
  if (role === "supervisor" || role === "super_admin") return;
  const result = await pool.query<{ can_supervise: boolean }>("select can_supervise from doctor_portal.doctor_profiles where user_id=$1 and active=true", [userId]);
  if (!result.rows[0]?.can_supervise) throw new HttpError(403, "Patient Identity Reconciliation permission is required.", { code: "PATIENT_IDENTITY_RECONCILIATION_FORBIDDEN" });
}

export async function requestPatientIdentityReconciliation(input: { patientId: number; studyInstanceUid: string; accessionNumber?: string | null; requestedByUserId: UserId }): Promise<PatientIdentityReconciliationJob> {
  const uid = clean(input.studyInstanceUid); if (!uid) throw new HttpError(400, "StudyInstanceUID is required.");
  try {
    const result = await pool.query<PatientIdentityReconciliationJob>(`insert into patient_identity_reconciliation_jobs(operation_type,patient_id,study_instance_uid,accession_number,requested_by_user_id) values('reconcile',$1,$2,nullif($3,''),$4) returning *`, [input.patientId, uid, clean(input.accessionNumber), input.requestedByUserId]);
    await audit(result.rows[0]!, "patient_identity_reconciliation_requested", "queued"); return result.rows[0]!;
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new HttpError(409, "A Patient Identity Reconciliation is already active for this study.", { code: "PATIENT_IDENTITY_RECONCILIATION_CONFLICT" });
    throw error;
  }
}

export async function requestPatientIdentityReconciliationReversal(jobId: number, requestedByUserId: UserId): Promise<PatientIdentityReconciliationJob> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const original = (await client.query<PatientIdentityReconciliationJob>("select * from patient_identity_reconciliation_jobs where id=$1 for update", [jobId])).rows[0];
    if (!original || original.operation_type !== "reconcile" || original.status !== "completed" || original.reversed_by_job_id) throw new HttpError(409, "Manual review required: this reconciliation is not the latest effective operation.", { code: "PATIENT_IDENTITY_RECONCILIATION_MANUAL_REVIEW_REQUIRED" });
    const newer = await client.query("select 1 from patient_identity_reconciliation_jobs where study_instance_uid=$1 and status='completed' and id>$2 limit 1", [original.study_instance_uid, original.id]);
    if (newer.rowCount) throw new HttpError(409, "Manual review required: a newer reconciliation exists.", { code: "PATIENT_IDENTITY_RECONCILIATION_MANUAL_REVIEW_REQUIRED" });
    const reversal = (await client.query<PatientIdentityReconciliationJob>(`insert into patient_identity_reconciliation_jobs(operation_type,patient_id,study_instance_uid,accession_number,requested_by_user_id,reverses_job_id) values('reverse',$1,$2,$3,$4,$5) returning *`, [original.patient_id, original.study_instance_uid, original.accession_number, requestedByUserId, original.id])).rows[0]!;
    await client.query("commit"); await audit(reversal, "patient_identity_reconciliation_reversal_requested", "queued"); return reversal;
  } catch (error) { await client.query("rollback"); if ((error as { code?: string }).code === "23505") throw new HttpError(409, "A Patient Identity Reconciliation is already active for this study.", { code: "PATIENT_IDENTITY_RECONCILIATION_CONFLICT" }); throw error; } finally { client.release(); }
}

export async function claimNextPatientIdentityReconciliationJob(owner: string, leaseSeconds = 120): Promise<PatientIdentityReconciliationJob | null> {
  const result = await pool.query<PatientIdentityReconciliationJob>(`with candidate as (select id from patient_identity_reconciliation_jobs where status='queued' or (status='processing' and lease_expires_at<now()) order by requested_at,id for update skip locked limit 1) update patient_identity_reconciliation_jobs j set status='processing',stage=case when j.operation_type='reverse' then 'verifying_reversal' else 'locating_study' end,started_at=coalesce(started_at,now()),processing_attempt_count=processing_attempt_count+1,lease_owner=$1,lease_expires_at=now()+($2::int*interval '1 second'),last_heartbeat_at=now(),updated_at=now() from candidate where j.id=candidate.id returning j.*`, [owner, leaseSeconds]);
  return result.rows[0] || null;
}
async function heartbeat(id: number, owner: string, stage: string, leaseSeconds: number) { const result = await pool.query("update patient_identity_reconciliation_jobs set stage=$3,lease_expires_at=now()+($4::int*interval '1 second'),last_heartbeat_at=now(),updated_at=now() where id=$1 and lease_owner=$2 and status='processing'", [id, owner, stage, leaseSeconds]); if (!result.rowCount) throw new HttpError(409, "Reconciliation worker lease was lost."); }
async function patient(job: PatientIdentityReconciliationJob) { const row = (await pool.query<{ patient_id:string|null; english_full_name:string|null; arabic_full_name:string|null; estimated_date_of_birth:string|null }>(`select coalesce(nullif(trim(pi.value),''),nullif(trim(p.identifier_value),''),nullif(trim(p.national_id),'')) patient_id,p.english_full_name,p.arabic_full_name,p.estimated_date_of_birth::text from patients p left join lateral(select value from patient_identifiers where patient_id=p.id and is_primary=true order by id limit 1) pi on true where p.id=$1`, [job.patient_id])).rows[0]; if (!row) throw new HttpError(404,"Patient not found."); const patientId=clean(row.patient_id); if(!patientId) throw new HttpError(409,"The selected RISpro patient has no primary Patient ID.",{code:"PATIENT_IDENTITY_RECONCILIATION_PRIMARY_PATIENT_ID_UNAVAILABLE"}); return { patientId, name: clean(row.english_full_name || row.arabic_full_name) || "RISpro Patient", birthDate: row.estimated_date_of_birth }; }
async function operatorName(userId:number){ return (await pool.query<{full_name:string}>("select full_name from users where id=$1",[userId])).rows[0]?.full_name || "RISpro user"; }
async function waitJob(client: Awaited<ReturnType<typeof createAuthoritativeOrthancClient>>, jobId: string | null, job: PatientIdentityReconciliationJob, owner:string, leaseSeconds:number) {
  if (!jobId) return;
  const deadline=Date.now()+300000;
  while(Date.now()<deadline){ const state=clean((await client.getJob(jobId)).State).toLowerCase(); if(["success","completed"].includes(state)) return; if(["failure","failed"].includes(state)) throw new HttpError(502,"Authoritative Orthanc modification failed.",{code:"PATIENT_IDENTITY_RECONCILIATION_ORTHANC_FAILED"}); await heartbeat(job.id,owner,"waiting_for_orthanc",leaseSeconds); await new Promise((resolve)=>setTimeout(resolve,1000)); }
  throw new HttpError(504,"Authoritative Orthanc modification did not complete in time.",{code:"PATIENT_IDENTITY_RECONCILIATION_ORTHANC_FAILED"});
}
function verify(before: PatientIdentityStudyFingerprint, after: PatientIdentityStudyFingerprint, patientId: string, expectedSequence: Array<Record<string,unknown>>) {
  if (after.patientId !== patientId || !equal(after.otherPatientIdsSequence, expectedSequence) || before.patientName !== after.patientName || before.patientBirthDate !== after.patientBirthDate || before.patientSex !== after.patientSex || before.studyInstanceUid !== after.studyInstanceUid || before.accessionNumber !== after.accessionNumber) throw new HttpError(502,"Patient Identity Reconciliation verification failed.",{code:"PATIENT_IDENTITY_RECONCILIATION_VERIFICATION_FAILED"});
}
function auditUid(jobId:number,kind:"series"|"instance"){const bytes=createHash("sha256").update(`rispro-patient-identity-reconciliation:${jobId}:${kind}`).digest().subarray(0,16);return `2.25.${BigInt(`0x${bytes.toString("hex")}`).toString(10)}`;}
function persistedSnapshot(job:PatientIdentityReconciliationJob):PatientIdentityStudyFingerprint|null {
  if(!job.orthanc_study_id_before||job.original_other_patient_ids==null)return null;
  return {orthancStudyId:job.orthanc_study_id_before,studyInstanceUid:job.study_instance_uid,accessionNumber:job.accession_number,patientId:job.old_patient_id,patientName:job.original_patient_name,patientBirthDate:job.original_patient_birth_date,patientSex:job.original_patient_sex,studyDate:job.study_date,otherPatientIdsSequence:job.original_other_patient_ids};
}
async function targetSnapshot(client: Awaited<ReturnType<typeof createAuthoritativeOrthancClient>>, uid:string, patientId:string){ const matches=(await client.listPatientIdentityReconciliationStudies(uid)).filter((study)=>study.patientId===patientId); if(matches.length!==1) throw new HttpError(409,"Manual review required: resulting study identity is ambiguous.",{code:"PATIENT_IDENTITY_RECONCILIATION_MANUAL_REVIEW_REQUIRED"}); return matches[0]!; }
function escapeXml(value:string){return value.replace(/[<>&'\"]/g,(char)=>({"<":"&lt;",">":"&gt;","&":"&amp;","'":"&apos;",'"':"&quot;"}[char]!));}
async function auditSc(job:PatientIdentityReconciliationJob, study:OrthancPatientIdentitySnapshot, oldId:string,newId:string,operator:string, reversed=false){
  const lines=reversed?["PATIENT IDENTITY RECONCILIATION REVERSAL",`Reconciliation ${job.reverses_job_id} reversed by job ${job.id}`,`Restored Patient ID: ${newId}`,`Reversed by: ${operator}`,`Date/time: ${new Date().toISOString()}`]:["PATIENT IDENTITY RECONCILIATION",`Original Patient ID: ${oldId}`,`Current Patient ID: ${newId}`,"Historical patient demographics were intentionally","preserved and were not modified.",`Reconciled by: ${operator}`,`Date/time: ${new Date().toISOString()}`,`RISpro reconciliation ID: ${job.id}`];
  const svg=`<svg width="1200" height="800" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><g fill="black" font-family="sans-serif" font-size="32">${lines.map((line,index)=>`<text x="70" y="${90+index*70}">${escapeXml(line)}</text>`).join("")}</g></svg>`;
  const {data,info}=await sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer({resolveWithObject:true});
  return createClinicalDocumentSecondaryCapture(data,info.height,info.width,{studyInstanceUid:study.studyInstanceUid!,seriesInstanceUid:auditUid(job.id,"series"),sopInstanceUid:auditUid(job.id,"instance"),patientId:newId,patientName:study.patientName||"UNKNOWN",patientBirthDate:study.patientBirthDate,patientSex:study.patientSex,accessionNumber:study.accessionNumber||"UNKNOWN",modality:study.modalitiesInStudy[0]||"CT",instanceNumber:1});
}

export async function processClaimedPatientIdentityReconciliationJob(input:{job:PatientIdentityReconciliationJob;leaseOwner:string;leaseSeconds:number}):Promise<void>{
  const {job,leaseOwner,leaseSeconds}=input; const client=await createAuthoritativeOrthancClient();
  try {
    await audit(job,job.operation_type==="reverse"?"patient_identity_reconciliation_reversal_started":"patient_identity_reconciliation_started","processing");
    const original=job.operation_type==="reverse"?(await pool.query<PatientIdentityReconciliationJob>("select * from patient_identity_reconciliation_jobs where id=$1",[job.reverses_job_id])).rows[0]:null;
    const savedBefore=persistedSnapshot(job);
    const target=clean(job.new_patient_id)||(job.operation_type==="reverse"?clean(original?.old_patient_id):(await patient(job)).patientId);
    const expectedCurrent=job.operation_type==="reverse"?clean(original?.new_patient_id):null;
    let candidates=await client.listPatientIdentityReconciliationStudies(job.study_instance_uid);
    const targetMatches=savedBefore?candidates.filter((item)=>item.patientId===target):[];
    let before=savedBefore||(job.operation_type==="reverse"?candidates.filter((item)=>item.patientId===expectedCurrent)[0]:candidates.length===1?candidates[0]:null);
    if(!before) throw new HttpError(409,"Manual review required: study identity is ambiguous.",{code:"PATIENT_IDENTITY_RECONCILIATION_MANUAL_REVIEW_REQUIRED"});
    if(!clean(before.patientId))throw new HttpError(409,"Manual review required: the historical study has no Patient ID.",{code:"PATIENT_IDENTITY_RECONCILIATION_MANUAL_REVIEW_REQUIRED"});
    if(job.accession_number&&clean(before.accessionNumber)!==clean(job.accession_number))throw new HttpError(409,"Manual review required: the study accession no longer matches.",{code:"PATIENT_IDENTITY_RECONCILIATION_MANUAL_REVIEW_REQUIRED"});
    const sequence=savedBefore?(job.result_other_patient_ids||[]):job.operation_type==="reverse"?(original!.original_other_patient_ids||[]):appendHistoricalPatientId(before.otherPatientIdsSequence,before.patientId||"");
    if(!savedBefore){
      if(job.operation_type==="reverse" && (!original || !equal(before.otherPatientIdsSequence,original.result_other_patient_ids))) throw new HttpError(409,"Manual review required: study state changed after reconciliation.",{code:"PATIENT_IDENTITY_RECONCILIATION_MANUAL_REVIEW_REQUIRED"});
      if(before.patientId===target) throw new HttpError(409,"Study already uses the target Patient ID.",{code:"PATIENT_IDENTITY_RECONCILIATION_ALREADY_CURRENT"});
      await heartbeat(job.id,leaseOwner,"snapshotting",leaseSeconds);
      await pool.query(`update patient_identity_reconciliation_jobs set orthanc_study_id_before=$2,old_patient_id=$3,new_patient_id=$4,original_other_patient_ids=$5,result_other_patient_ids=$6,original_patient_name=$7,original_patient_birth_date=$8,original_patient_sex=$9,accession_number=coalesce(accession_number,$10),study_date=$11,updated_at=now() where id=$1 and lease_owner=$12 and status='processing'`,[job.id,before.orthancStudyId,before.patientId,target,JSON.stringify(before.otherPatientIdsSequence),JSON.stringify(sequence),before.patientName,before.patientBirthDate,before.patientSex,before.accessionNumber,before.studyDate,leaseOwner]);
    }
    if(targetMatches.length===0){
      if(savedBefore&&job.orthanc_job_id){await waitJob(client,job.orthanc_job_id,job,leaseOwner,leaseSeconds);candidates=await client.listPatientIdentityReconciliationStudies(job.study_instance_uid);}
      if(!candidates.some((item)=>item.patientId===target)){
        const sources=candidates.filter((item)=>item.patientId===before!.patientId);if(sources.length!==1)throw new HttpError(409,"Manual review required: source study state is ambiguous.",{code:"PATIENT_IDENTITY_RECONCILIATION_MANUAL_REVIEW_REQUIRED"});
        if(savedBefore)verify(before,sources[0]!,before.patientId||"",before.otherPatientIdsSequence);
        await client.markPatientIdentityReconciliationSourceNoRoute(sources[0]!.orthancStudyId);
        await heartbeat(job.id,leaseOwner,job.operation_type==="reverse"?"restoring_identity":"modifying",leaseSeconds);
        const started=await client.startPatientIdentityReconciliation({orthancStudyId:sources[0]!.orthancStudyId,patientId:target,otherPatientIdsSequence:sequence});
        await pool.query("update patient_identity_reconciliation_jobs set orthanc_job_id=$2,stage='waiting_for_orthanc',updated_at=now() where id=$1 and lease_owner=$3 and status='processing'",[job.id,started.jobId,leaseOwner]);
        await waitJob(client,started.jobId,job,leaseOwner,leaseSeconds);
      }
    }
    await heartbeat(job.id,leaseOwner,"verifying",leaseSeconds);
    const after=await targetSnapshot(client,job.study_instance_uid,target);
    const existingAudit=await client.findInstanceBySopInstanceUid(auditUid(job.id,"instance"));
    verify(before,after,target,sequence);
    await client.markPatientIdentityReconciliationResourceNoRoute(after.orthancStudyId);
    await upsertHistoricalPacsStudies([after]);
    await heartbeat(job.id,leaseOwner,"creating_audit_sc",leaseSeconds);
    if(existingAudit&&existingAudit.studyInstanceUid!==job.study_instance_uid)throw new HttpError(409,"Manual review required: reconciliation audit identity is ambiguous.",{code:"PATIENT_IDENTITY_RECONCILIATION_MANUAL_REVIEW_REQUIRED"});
    if(!existingAudit){const operator=await operatorName(job.requested_by_user_id);const bytes=await auditSc(job,after,before.patientId||"",target,operator,job.operation_type==="reverse");const uploaded=await client.uploadPatientIdentityReconciliationAudit(bytes,job.study_instance_uid);if(uploaded.seriesInstanceUid!==auditUid(job.id,"series")||uploaded.sopInstanceUid!==auditUid(job.id,"instance"))throw new HttpError(502,"Patient Identity Reconciliation audit verification failed.",{code:"PATIENT_IDENTITY_RECONCILIATION_VERIFICATION_FAILED"});}
    const db=await pool.connect(); try { await db.query("begin"); const completed=await db.query("update patient_identity_reconciliation_jobs set status='completed',stage='completed',orthanc_study_id_after=$2,completed_at=now(),lease_owner=null,lease_expires_at=null,updated_at=now() where id=$1 and lease_owner=$3 and status='processing'",[job.id,after.orthancStudyId,leaseOwner]); if(!completed.rowCount)throw new HttpError(409,"Reconciliation worker lease was lost."); if(original) await db.query("update patient_identity_reconciliation_jobs set reversed_by_job_id=$2,updated_at=now() where id=$1 and reversed_by_job_id is null",[original.id,job.id]); await db.query("commit"); } catch(error){await db.query("rollback");throw error;} finally {db.release();}
    await audit(job,job.operation_type==="reverse"?"patient_identity_reconciliation_reversal_completed":"patient_identity_reconciliation_completed","completed");
  } catch(error){ const code=errorCode(error); const failed=await pool.query("update patient_identity_reconciliation_jobs set status='failed',stage='failed',failure_code=$2,failure_details=$3,completed_at=now(),lease_owner=null,lease_expires_at=null,updated_at=now() where id=$1 and lease_owner=$4 and status='processing'",[job.id,code,JSON.stringify({code}),leaseOwner]); if(failed.rowCount)await audit(job,job.operation_type==="reverse"?"patient_identity_reconciliation_reversal_failed":"patient_identity_reconciliation_failed","failed",code).catch(()=>undefined); throw error; }
}

export async function listPatientIdentityReconciliationJobs(input:{search?:string;patientId?:number;limit?:number;offset?:number}={}) { const params:unknown[]=[]; const clauses:string[]=[]; if(input.patientId){params.push(input.patientId);clauses.push(`j.patient_id=$${params.length}`);} const search=clean(input.search); if(search){params.push(`%${search}%`);clauses.push(`(j.old_patient_id ilike $${params.length} or j.new_patient_id ilike $${params.length} or j.accession_number ilike $${params.length} or j.study_instance_uid ilike $${params.length})`);} const limit=Math.min(100,Math.max(1,input.limit||25)),offset=Math.max(0,input.offset||0);params.push(limit,offset); const where=clauses.length?`where ${clauses.join(" and ")}`:""; const rows=await pool.query<PatientIdentityReconciliationJob>(`select j.*,u.full_name operator_name from patient_identity_reconciliation_jobs j left join users u on u.id=j.requested_by_user_id ${where} order by j.requested_at desc,j.id desc limit $${params.length-1} offset $${params.length}`,params); const count=await pool.query<{count:string}>(`select count(*)::text count from patient_identity_reconciliation_jobs j ${where}`,params.slice(0,-2)); return {jobs:rows.rows,total:Number(count.rows[0]?.count||0)}; }
export async function getPatientIdentityReconciliationForStudies(studyInstanceUids:string[]){if(!studyInstanceUids.length)return [];return (await pool.query<PatientIdentityReconciliationJob>("select * from patient_identity_reconciliation_jobs where study_instance_uid=any($1::text[]) order by id desc",[studyInstanceUids])).rows;}
export const __patientIdentityReconciliationTestables={appendHistoricalPatientId,verify,auditUid,persistedSnapshot,patient};

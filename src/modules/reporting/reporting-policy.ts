import type { PoolClient } from 'pg';
import { pool } from '../../db/pool.js';
import { HttpError } from '../../utils/http-error.js';
import { logAuditEntry } from '../../services/audit-service.js';
import type { Actor } from '../doctor-portal/reporting-board-service.js';

export const REPORT_TYPES = ['primary','second_opinion','additional_interpretation','peer_review'] as const;
export interface ReportingPolicy {
  enabled: boolean; version: number;
  creation: 'assigned'|'assigned_permission'|'accessible';
  collaboration: 'independent'|'shared'|'both';
  review: 'none'|'optional'|'mandatory'; mandatoryReviewRoles: string[];
  reviewEligibility: 'authorized'|'designated'|'open';
  signing: 'permission'|'qualified'|'review';
  additional: 'typed'|'unrestricted'|'addenda'; allowedTypes: string[];
  deletion: 'creator'|'supervisor'|'disabled'; restoreRevisions: boolean;
}
export const DEFAULT_REPORTING_POLICY: ReportingPolicy = {
  enabled:false,version:1,creation:'accessible',collaboration:'both',review:'optional',
  mandatoryReviewRoles:['resident','senior_house_officer'],reviewEligibility:'open',signing:'permission',
  additional:'typed',allowedTypes:[...REPORT_TYPES],deletion:'creator',restoreRevisions:true,
};
export const REPORTING_PRESETS = {
  open: DEFAULT_REPORTING_POLICY,
  teaching: {...DEFAULT_REPORTING_POLICY,review:'mandatory',reviewEligibility:'designated',signing:'review'},
  assigned: {...DEFAULT_REPORTING_POLICY,creation:'assigned',collaboration:'independent'},
};
export function validateReportingPolicy(input: unknown): ReportingPolicy {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400,'Invalid reporting policy.');
  const p = input as ReportingPolicy;
  const options = {creation:['assigned','assigned_permission','accessible'],collaboration:['independent','shared','both'],review:['none','optional','mandatory'],reviewEligibility:['authorized','designated','open'],signing:['permission','qualified','review'],additional:['typed','unrestricted','addenda'],deletion:['creator','supervisor','disabled']};
  for (const [key,values] of Object.entries(options)) if (!values.includes(String(p[key as keyof ReportingPolicy]))) throw new HttpError(400,`Invalid policy option: ${key}.`);
  if (!Number.isSafeInteger(p.version)||p.version<1||typeof p.enabled!=='boolean' || typeof p.restoreRevisions!=='boolean' || !Array.isArray(p.allowedTypes) || !p.allowedTypes.length || p.allowedTypes.some(t=>!REPORT_TYPES.includes(t as typeof REPORT_TYPES[number]))
    || !Array.isArray(p.mandatoryReviewRoles) || p.mandatoryReviewRoles.some(r=>!['consultant','specialist','resident','senior_house_officer'].includes(r))) throw new HttpError(400,'Invalid reporting policy values.');
  return {enabled:p.enabled,version:Number(p.version),creation:p.creation,collaboration:p.collaboration,review:p.review,mandatoryReviewRoles:[...new Set(p.mandatoryReviewRoles)],reviewEligibility:p.reviewEligibility,signing:p.signing,additional:p.additional,allowedTypes:[...new Set(p.allowedTypes)],deletion:p.deletion,restoreRevisions:p.restoreRevisions};
}
export async function readReportingPolicy(db: Pick<PoolClient,'query'> = pool, lock:boolean|'share'=false): Promise<ReportingPolicy> {
  const row=(await db.query("select setting_value from system_settings where category='doctor_workspace' and setting_key='reporting_policy'"+(lock==='share'?' for share':lock?' for update':''))).rows[0];
  return validateReportingPolicy(row?.setting_value ?? DEFAULT_REPORTING_POLICY);
}
export async function updateReportingPolicy(actor: Actor,input: unknown) {
  if (!['supervisor','super_admin'].includes(actor.appRole)) throw new HttpError(403,'Settings administration permission is required.');
  const next=validateReportingPolicy(input),db=await pool.connect();
  try {await db.query('begin');const prior=await readReportingPolicy(db,true);
    if(next.version!==prior.version) throw new HttpError(409,'Reporting policies changed. Reload settings.');
    next.version=prior.version+1;
    await db.query("update system_settings set setting_value=$1,updated_at=now(),updated_by_user_id=$2 where category='doctor_workspace' and setting_key='reporting_policy'",[JSON.stringify(next),actor.userId]);
    await logAuditEntry({entityType:'reporting_policy',entityId:null,actionType:'reporting_policy_changed',oldValues:prior,newValues:next,changedByUserId:actor.userId},db);
    await db.query('commit');return next;
  }catch(e){await db.query('rollback');throw e;}finally{db.release();}
}

import {pool} from '../../db/pool.js';
import {env} from '../../config/env.js';
import {HttpError} from '../../utils/http-error.js';
import {readOhifViewerConfiguration,createViewerLaunchSession,type ViewerLaunchSessionRecord} from '../ohif-viewer/repository.js';
import {createLaunchToken,selectPatientHistory} from '../ohif-viewer/validation.js';
import {createImagingSourceAdapter} from '../ohif-viewer/adapters.js';
import type {Actor} from '../doctor-portal/reporting-board-service.js';
import {getWorkspaceReport,getWorkspaceStudy,workspaceStudyRegistry} from './workspace-report-service.js';
import {transaction} from './reporting-service.js';
import {requireStudy,verifyLiveStudy,modality,archiveStatus} from './workspace-study-service.js';

export async function authorizeWorkspaceViewer(actor:Actor,session:ViewerLaunchSessionRecord,requestedUids:string[] = []) {
  const linked=(await pool.query('select * from native_reporting_studies where id=$1',[session.reportingStudyKey])).rows[0];
  if(!linked||linked.study_instance_uid!==session.studyInstanceUid)throw new HttpError(403,'Viewer study association changed.');
  const a=await requireStudy(actor,linked.orthanc_study_id,pool,false,'view');
  const config=await readOhifViewerConfiguration();
  if(a.freshness.archiveKey!==linked.source_archive_key||a.study.study_instance_uid!==session.studyInstanceUid||a.study.patient_id!==linked.identity.patientIdentifier||(a.study.accession_number||'')!==linked.identity.accession||session.accessStrategy!=='authoritative_orthanc'||config.settings.accessStrategy!=='authoritative_orthanc')throw new HttpError(403,'Viewer archive source or study identity changed.');
  for(const uid of new Set(requestedUids.filter(uid=>uid!==session.studyInstanceUid&&session.permittedStudyUids.includes(uid)))) {
    const rows=(await pool.query('select orthanc_study_id from historical_pacs_studies where study_instance_uid=$1',[uid])).rows;
    if(rows.length!==1)throw new HttpError(403,'Viewer prior study identity is missing or ambiguous.');
    const prior=await requireStudy(actor,rows[0].orthanc_study_id,pool,false,'view');
    if(prior.study.patient_id!==a.study.patient_id||prior.freshness.archiveKey!==a.freshness.archiveKey)throw new HttpError(403,'Viewer prior patient or archive identity changed.');
  }
  return a;
}
export async function launchWorkspaceImages(actor:Actor,id:number) {
  const report=await getWorkspaceReport(actor,id);
  return launchWorkspaceStudyImages(actor,report.studyKey,id);
}
export async function launchWorkspaceStudyImages(actor:Actor,key:string,reportId?:number) {
  const a=await requireStudy(actor,key,pool,false,'view'),configuration=await readOhifViewerConfiguration();
  if(!a.policy.enabled)throw new HttpError(404,'Doctor Workspace V2 is disabled.');
  if(!env.ohifEnabled||!configuration.settings.enabled||configuration.settings.accessStrategy!=='authoritative_orthanc')throw new HttpError(409,'Enable the existing authoritative Orthanc OHIF integration to view images.');
  const remote=await verifyLiveStudy(a.study);
  const allowed=new Set(a.me.allowedModalities.filter(p=>p.active&&p.canReport).map(p=>modality(p.modalityCode||'')));
  const remoteCodes=remote.modalitiesInStudy.map(modality).filter(c=>!['SR','PR','SEG','KO','DOC'].includes(c));
  if(!remoteCodes.length||remoteCodes.some(c=>!allowed.has(c)))throw new HttpError(403,'Reporting permission is required for every diagnostic modality in the live study.');
  let permittedStudyUids=[a.study.study_instance_uid];
  if(configuration.settings.allowPriorStudies) {
    // History is optional. A failed/partial QIDO search cannot invalidate the
    // independently verified primary; conflicting primary evidence still blocks.
    const candidates=await (async()=>{try{return await (await createImagingSourceAdapter(configuration)).searchStudiesByPatient(a.study.patient_id);}catch{return [];}})();
    const primary=candidates.filter(s=>s.studyInstanceUid===a.study.study_instance_uid);
    if(primary.length>1||primary.some(s=>s.patientId!==a.study.patient_id || s.accessionNumber&&s.accessionNumber!==a.study.accession_number))throw new HttpError(409,'Primary study identity is ambiguous or conflicting in the archive.');
    const history=primary.length===1?selectPatientHistory(candidates,primary[0],a.study.patient_id).filter(s=>{
      const codes=s.modality.split(/[\\, /]+/).map(modality).filter(c=>c&&!['SR','PR','SEG','KO','DOC'].includes(c));
      return codes.length>0&&codes.every(c=>allowed.has(c))&&candidates.filter(c=>c.studyInstanceUid===s.studyInstanceUid).length===1;
    }):[];
    const verified=await Promise.all(history.map(async prior=>{
      try {
        const rows=(await pool.query('select orthanc_study_id from historical_pacs_studies where study_instance_uid=$1',[prior.studyInstanceUid])).rows;
        if(rows.length!==1)return null;
        const p=await requireStudy(actor,rows[0].orthanc_study_id,pool,false,'view');
        if(p.study.patient_id!==a.study.patient_id||p.freshness.archiveKey!==a.freshness.archiveKey)return null;
        await verifyLiveStudy(p.study);return p.study.study_instance_uid;
      } catch{return null;}
    }));
    permittedStudyUids=[...new Set([a.study.study_instance_uid,...verified.filter((uid):uid is string=>uid!==null)])];
  }
  const source=await archiveStatus();
  if(!source.available||source.archiveKey!==a.freshness.archiveKey)throw new HttpError(409,'Viewer archive source changed. Retry after reconciliation.');
  const {token,tokenHash}=createLaunchToken();
  await transaction(async db=>{
    // This records only the verified study/session identity. Viewing never creates
    // or adopts a report, and a failed session insert rolls the identity back.
    const registry=await workspaceStudyRegistry(db,a,false);
    await createViewerLaunchSession({userId:actor.userId,appointmentId:a.appointment?Number(a.appointment.id):null,sourcePacsNodeId:null,accessStrategy:'authoritative_orthanc',currentStudyUid:a.study.study_instance_uid,
      permittedStudyUids,tokenHash,expiresAt:new Date(Date.now()+configuration.settings.launchTokenTtlSeconds*1000),studyDate:a.study.study_date||'',reportingStudyKey:registry.id,reportId},db);
  });
  return {status:'ready',launchUrl:'/api/ohif/launch/'+encodeURIComponent(token),openMode:configuration.settings.openMode};
}
export async function workspaceViewerContext(actor:Actor,session:ViewerLaunchSessionRecord) {
  const a=await authorizeWorkspaceViewer(actor,session),study=await getWorkspaceStudy(actor,a.study.orthanc_study_id);
  const report=study.reports.find(r=>Number(r.id)===session.reportId)||study.reports.find(r=>!r.deletedAt)||null;
  return {v2:true,contextId:session.reportContextId,appointmentId:report?.appointmentId??null,studyKey:a.study.orthanc_study_id,primaryStudyUid:session.studyInstanceUid,
    signerUserId:Number(actor.userId),
    enabled:study.policy.enabled,canEdit:report?.canEdit??study.canCreate,canFinalize:report?.canFinalize??false,finalizeReasons:report?.finalizeReasons??[],blockedReason:report?.blockedReason??study.blockedReason,identity:study.identity,report,reports:study.reports.filter(r=>!r.deletedAt),policy:study.policy};
}

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

export async function authorizeWorkspaceViewer(actor:Actor,session:ViewerLaunchSessionRecord) {
  const linked=(await pool.query('select * from native_reporting_studies where id=$1',[session.reportingStudyKey])).rows[0];
  if(!linked||linked.study_instance_uid!==session.studyInstanceUid)throw new HttpError(403,'Viewer study association changed.');
  const a=await requireStudy(actor,linked.orthanc_study_id);
  const config=await readOhifViewerConfiguration();
  if(a.freshness.archiveKey!==linked.source_archive_key||a.study.study_instance_uid!==session.studyInstanceUid||a.study.patient_id!==linked.identity.patientIdentifier||session.accessStrategy!=='authoritative_orthanc'||config.settings.accessStrategy!=='authoritative_orthanc')throw new HttpError(403,'Viewer archive source or study identity changed.');
  return a;
}
export async function launchWorkspaceImages(actor:Actor,id:number) {
  const report=await getWorkspaceReport(actor,id);
  return launchWorkspaceStudyImages(actor,report.studyKey,id);
}
export async function launchWorkspaceStudyImages(actor:Actor,key:string,reportId?:number) {
  const a=await requireStudy(actor,key),configuration=await readOhifViewerConfiguration();
  if(!a.policy.enabled)throw new HttpError(404,'Doctor Workspace V2 is disabled.');
  if(!env.ohifEnabled||!configuration.settings.enabled||configuration.settings.accessStrategy!=='authoritative_orthanc')throw new HttpError(409,'Enable the existing authoritative Orthanc OHIF integration to view images.');
  const remote=await verifyLiveStudy(a.study);
  const allowed=new Set(a.me.allowedModalities.filter(p=>p.active&&p.canReport).map(p=>modality(p.modalityCode||'')));
  const remoteCodes=remote.modalitiesInStudy.map(modality).filter(c=>!['SR','PR','SEG','KO','DOC'].includes(c));
  if(!remoteCodes.length||remoteCodes.some(c=>!allowed.has(c)))throw new HttpError(403,'Reporting permission is required for every diagnostic modality in the live study.');
  let permittedStudyUids=[a.study.study_instance_uid];
  if(configuration.settings.allowPriorStudies) {
    const adapter=await createImagingSourceAdapter(configuration),candidates=await adapter.searchStudiesByPatient(a.study.patient_id);
    const primary=candidates.filter(s=>s.studyInstanceUid===a.study.study_instance_uid&&s.patientId===a.study.patient_id);
    if(primary.length!==1)throw new HttpError(409,'Primary study identity cannot be verified for patient-history authorization.');
    const history=selectPatientHistory(candidates,primary[0],a.study.patient_id).filter(s=>{
      const codes=s.modality.split(/[\\, /]+/).map(modality).filter(c=>c&&!['SR','PR','SEG','KO','DOC'].includes(c));
      return codes.length>0&&codes.every(c=>allowed.has(c));
    });
    permittedStudyUids=[...new Set([a.study.study_instance_uid,...history.map(s=>s.studyInstanceUid)])];
  }
  if((await archiveStatus()).archiveKey!==a.freshness.archiveKey)throw new HttpError(409,'Viewer archive source changed. Retry after reconciliation.');
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
    enabled:study.policy.enabled,canEdit:report?.canEdit??study.canCreate,canFinalize:report?.canFinalize??false,blockedReason:study.blockedReason,identity:study.identity,report,reports:study.reports.filter(r=>!r.deletedAt),policy:study.policy};
}

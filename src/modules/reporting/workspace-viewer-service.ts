import {pool} from '../../db/pool.js';
import {env} from '../../config/env.js';
import {HttpError} from '../../utils/http-error.js';
import {readOhifViewerConfiguration,createViewerLaunchSession,type ViewerLaunchSessionRecord} from '../ohif-viewer/repository.js';
import {createLaunchToken,selectPatientHistory} from '../ohif-viewer/validation.js';
import {createImagingSourceAdapter} from '../ohif-viewer/adapters.js';
import type {Actor} from '../doctor-portal/reporting-board-service.js';
import {getWorkspaceReport,getWorkspaceStudy} from './workspace-report-service.js';
import {requireStudy,verifyLiveStudy} from './workspace-study-service.js';

export async function authorizeWorkspaceViewer(actor:Actor,session:ViewerLaunchSessionRecord) {
  const linked=(await pool.query('select * from native_reporting_studies where id=$1',[session.reportingStudyKey])).rows[0];
  if(!linked||linked.study_instance_uid!==session.studyInstanceUid)throw new HttpError(403,'Viewer study association changed.');
  const a=await requireStudy(actor,linked.orthanc_study_id);
  const config=await readOhifViewerConfiguration();
  if(a.freshness.archiveKey!==linked.source_archive_key||session.accessStrategy!=='authoritative_orthanc'||config.settings.accessStrategy!=='authoritative_orthanc')throw new HttpError(403,'Viewer archive source changed.');
  return a;
}
export async function launchWorkspaceImages(actor:Actor,id:number) {
  const report=await getWorkspaceReport(actor,id),a=await requireStudy(actor,report.studyKey),configuration=await readOhifViewerConfiguration();
  if(!env.ohifEnabled||!configuration.settings.enabled||configuration.settings.accessStrategy!=='authoritative_orthanc')throw new HttpError(409,'Enable the existing authoritative Orthanc OHIF integration to view images.');
  await verifyLiveStudy(a.study);
  let permittedStudyUids=[a.study.study_instance_uid];
  if(configuration.settings.allowPriorStudies) {
    const adapter=await createImagingSourceAdapter(configuration),candidates=await adapter.searchStudiesByPatient(a.study.patient_id);
    const primary=candidates.filter(s=>s.studyInstanceUid===a.study.study_instance_uid&&s.patientId===a.study.patient_id);
    if(primary.length!==1)throw new HttpError(409,'Primary study identity cannot be verified for patient-history authorization.');
    permittedStudyUids=[...new Set([a.study.study_instance_uid,...selectPatientHistory(candidates,primary[0],a.study.patient_id).map(s=>s.studyInstanceUid)])];
  }
  const registry=(await pool.query('select study_id from native_report_study_links where report_id=$1',[id])).rows[0];
  const {token,tokenHash}=createLaunchToken();
  await createViewerLaunchSession({userId:actor.userId,appointmentId:report.appointmentId,sourcePacsNodeId:null,accessStrategy:'authoritative_orthanc',currentStudyUid:a.study.study_instance_uid,
    permittedStudyUids,tokenHash,expiresAt:new Date(Date.now()+configuration.settings.launchTokenTtlSeconds*1000),studyDate:a.study.study_date||'',reportingStudyKey:registry.study_id,reportId:id});
  return {status:'ready',launchUrl:'/api/ohif/launch/'+encodeURIComponent(token),openMode:configuration.settings.openMode};
}
export async function workspaceViewerContext(actor:Actor,session:ViewerLaunchSessionRecord) {
  const a=await authorizeWorkspaceViewer(actor,session),study=await getWorkspaceStudy(actor,a.study.orthanc_study_id);
  const report=study.reports.find(r=>Number(r.id)===session.reportId)||study.reports.find(r=>!r.deletedAt)||null;
  return {v2:true,contextId:session.reportContextId,appointmentId:report?.appointmentId??null,studyKey:a.study.orthanc_study_id,primaryStudyUid:session.studyInstanceUid,
    signerUserId:Number(actor.userId),
    enabled:study.policy.enabled,canEdit:report?.canEdit??study.canCreate,canFinalize:report?.canFinalize??false,blockedReason:study.blockedReason,identity:study.identity,report,reports:study.reports.filter(r=>!r.deletedAt),policy:study.policy};
}

import {api} from './api-client';
import type {QueryClient} from '@tanstack/react-query';
export type ReportSections=Record<'clinicalHistory'|'comparison'|'technique'|'findings'|'impression',string>;
export const REPORT_FIELDS:Record<keyof ReportSections,string>={clinicalHistory:'Clinical History',comparison:'Comparison',technique:'Technique',findings:'Findings',impression:'Impression'};
export interface ReportingPolicy {
  enabled:boolean;version:number;creation:'assigned'|'assigned_permission'|'accessible';collaboration:'independent'|'shared'|'both';
  review:'none'|'optional'|'mandatory';mandatoryReviewRoles:string[];reviewEligibility:'authorized'|'designated'|'open';
  signing:'permission'|'qualified'|'review';additional:'typed'|'unrestricted'|'addenda';allowedTypes:string[];deletion:'creator'|'supervisor'|'disabled';restoreRevisions:boolean;
}
export interface ReportIdentity {patientName:string;patientIdentifier:string;accession:string;examination:string;studyDate:string}
export interface WorkspaceReport {
  id:number;appointmentId:number|null;studyKey:string;revision:number;status:'draft'|'in_review'|'final';sections:ReportSections;identity:ReportIdentity;
  author:string;creatorId:number;contributors:{userId:number;name:string}[];lastEditor:string;finalizer:string|null;finalizedAt:string|null;
  reportType:string;mode:'shared'|'independent';isPrimary:boolean;createdAt:string;updatedAt:string;deletedAt:string|null;
  canEdit:boolean;canFinalize:boolean;canReview:boolean;canDelete:boolean;canRecover:boolean;canRestoreRevision:boolean;
  reviewRequestedBy:number|null;reviewRequestedAt:string|null;preferredReviewerId:number|null;
  blockedReason?:string|null;
  reviewEnabled?:boolean;
  keyImages:{id:string;caption:string;provenance:{sourceSeriesDescription:string;sourceStudyDate:string;prior:boolean}}[];
  addenda:{id:string;text:string;author:string;signedAt:string}[];
}
export interface Freshness {status:string;lastSuccessAt:string|null;error:string|null}
export interface StudyReports {studyKey:string;identity:ReportIdentity;studyUid:string;reports:WorkspaceReport[];policy:ReportingPolicy;freshness:Freshness;canCreate:boolean;blockedReason:string|null;primaryReportId:number|null}
export interface StudyListRow {
  orthanc_study_id:string;study_instance_uid:string;patient_id:string;patient_name_raw:string;accession_number:string;study_description:string;
  modalities_in_study:string[];study_date:string;series_count:number;reporting_status:string;external_reporting_status:string;report_count:number;assigned_doctor:string|null;
  reports:{id:number;author:string;signer:string|null;status:string}[];
}
export interface ReportingAppointment {
  appointmentId:number;patientId:number;patientEnglishName:string;patientArabicName:string;patientIdentifier:string|null;patientMrn:string;
  appointmentNumber:string;examTypeName:string|null;modalityName:string;modalityCode:string;appointmentDate:string;appointmentStatus:string;
  assignedDoctorName:string|null;studyKey:string|null;reportingStatus:string|null;externalReportingStatus:string;
}
export interface CataloguePage {studies:StudyListRow[];total:number;limit:number;offset:number;freshness:Freshness;modalities:string[]}
export interface AppointmentPage {appointments:ReportingAppointment[];total:number;limit:number;offset:number;freshness:Freshness;modalities:string[]}
export const reportingListCache={staleTime:60_000,gcTime:15*60_000,refetchOnWindowFocus:false};
// DICOM DA is a calendar date, never a UTC timestamp. Validate before formatting
// so partial/invalid metadata cannot roll into a different month or day.
export function formatStudyDate(value:string|null|undefined) {
  const match=/^(\d{4})-?(\d{2})-?(\d{2})$/.exec(value?.trim()||'');
  if(!match)return '—';
  const [,y,m,d]=match,year=Number(y),month=Number(m),day=Number(d);
  const leap=year%4===0&&(year%100!==0||year%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  if(!year||month<1||month>12||day<1||day>days[month-1])return '—';
  return `${day} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][month-1]} ${y}`;
}
export function refreshReportingQueries(client:QueryClient,report:WorkspaceReport) {
  const previous=client.getQueryData<WorkspaceReport>(['workspace-report',String(report.id)]);
  const membershipChanged=!previous||previous.status!==report.status||previous.deletedAt!==report.deletedAt||previous.isPrimary!==report.isPrimary
    ||previous.contributors.map(c=>c.userId).join(',')!==report.contributors.map(c=>c.userId).join(',');
  client.setQueryData(['workspace-report',String(report.id)],report);
  void client.invalidateQueries({queryKey:['reporting-study',report.studyKey]});
  void client.invalidateQueries({predicate:q=>{
    const name=q.queryKey[0];
    if(name==='reporting-catalogue') {
      const params=new URLSearchParams(String(q.queryKey[1]));
      // Changed lifecycle/contributors can move a study into a filtered page and
      // change its total. Ordinary text saves refresh only pages showing it.
      const status=params.get('status')||'all';
      return membershipChanged&&!['all','unknown','external_draft','external_final'].includes(status)||Boolean((q.state.data as CataloguePage|undefined)?.studies.some(s=>s.orthanc_study_id===report.studyKey));
    }
    if(name==='reporting-appointments'||name==='assigned-reporting-work')return membershipChanged&&report.appointmentId!==null;
    return name==='doctor-home-v2'&&membershipChanged;
  }});
}
export const workspaceBase='/native-reporting/workspace';
export const reportBase=(id:number|string)=>'/native-reporting/reports/'+id;
export const post=<T>(path:string,body:unknown)=>api<T>(path,{method:'POST',body:JSON.stringify(body)});
export const reportTypes:Record<string,string>={primary:'Primary Interpretation',second_opinion:'Second Opinion',additional_interpretation:'Additional Interpretation',peer_review:'Peer Review'};
export function requestId() {const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
export function reportingReturn(value:string|null) {return value&&/^\/doctor\/(reporting|my-work)(\?|$)/.test(value)?value:'/doctor/reporting';}
export type ReportingPreferences={status:string;modality:string;template:string;compact:boolean;dashboardDays:number};
const defaults:ReportingPreferences={status:'all',modality:'',template:'blank',compact:false,dashboardDays:7};
export function loadReportingPreferences(userId:number|undefined):ReportingPreferences {
  try{return {...defaults,...JSON.parse(localStorage.getItem('rispro.reporting.preferences.'+userId)||'{}')};}catch{return defaults;}
}
export function saveReportingPreferences(userId:number|undefined,p:ReportingPreferences) {localStorage.setItem('rispro.reporting.preferences.'+userId,JSON.stringify(p));}

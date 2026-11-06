import {Router,type Request,type Response,type NextFunction} from 'express';
import path from 'node:path';
import {requireAuth} from '../../middleware/auth.js';
import {requirePageAccess} from '../../middleware/page-access.js';
import {asyncRoute} from '../../utils/async-route.js';
import {HttpError} from '../../utils/http-error.js';
import {pool} from '../../db/pool.js';
import {logAuditEntry} from '../../services/audit-service.js';
import {buildNativeReportHtml} from '../../services/generated-print-html-service.js';
import {checkSonicDicomReportStatus,buildSonicDicomReportBrowserUrl} from '../../services/sonicdicom-report-service.js';
import {receptionReportContext,receptionSignedReport} from './reception-report-service.js';
import {readReportImage} from './report-image-storage-service.js';
import {canRoleAccessPage,readPageVisibilityMatrix} from '../../services/page-visibility-settings-service.js';

export const receptionReportRouter=Router();
receptionReportRouter.use(requireAuth,(req:Request,res:Response,next:NextFunction)=>{
  res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(!['receptionist','supervisor','super_admin'].includes(req.user!.role))return next(new HttpError(403,'Reception report access is required.'));
  next();
},requirePageAccess('registrations'));
function appointmentId(req:Request) {const id=Number(req.params.appointmentId);if(!Number.isSafeInteger(id)||id<1)throw new HttpError(400,'Invalid appointment identifier.');return id;}
async function staffStatus(id:number) {
  let current=await receptionReportContext(id);
  if(current.lookup.status==='voided')throw new HttpError(404,'Report unavailable for a voided appointment.');
  if(current.status.source==='rispro')return current.status;
  const external=current.lookup.requiresReport&&current.lookup.status==='completed'?await checkSonicDicomReportStatus(current.lookup,{useCache:false}):null;
  // A native workflow may have started while the external service was reading.
  current=await receptionReportContext(id);
  if(current.status.source==='rispro')return current.status;
  return {...current.status,state:current.status.source==='manual'?'final':external?.state||current.status.state,
    source:current.status.source==='manual'?'manual' as const:external?'sonicdicom' as const:current.status.source,
    canViewReport:Boolean(external?.state==='final'&&external.canViewReport)};
}
receptionReportRouter.get('/:appointmentId/report-status',asyncRoute(async(req,res)=>{
  const status=await staffStatus(appointmentId(req));
  const message=status.source==='rispro'?(status.canViewReport?'Signed native primary report available.':'No signed native primary report is available. The native workflow supersedes external status.'):
    status.canViewReport?'Final external report available.':status.source==='manual'?'Marked final manually; no final electronic document is available.':'No final report is available.';
  const canPrintReport=status.canViewReport&&canRoleAccessPage('print',req.user!.role,await readPageVisibilityMatrix());
  res.json({...status,canPrintReport,enabled:true,message,checkButtonLabel:'Check report status',viewButtonLabel:'Open final report'});
}));
async function open(req:Request,res:Response,printing:boolean) {
  const id=appointmentId(req),status=await staffStatus(id);
  if(!status.canViewReport)throw new HttpError(404,'No final report is available.');
  if(status.source!=='rispro') {
    const current=await receptionReportContext(id);if(current.status.source==='rispro')throw new HttpError(409,'Report source changed. Refresh report status.');
    const url=await buildSonicDicomReportBrowserUrl(current.lookup,req.hostname);
    await logAuditEntry({entityType:'appointment',entityId:id,actionType:printing?'reception_report_print_requested':'reception_report_opened',newValues:{source:status.source},changedByUserId:req.user!.sub});
    res.redirect(url);return;
  }
  const report=await receptionSignedReport(id),base='/api/v2/read/appointments/'+id+'/report';
  await logAuditEntry({entityType:'native_report',entityId:report.id!,actionType:printing?'native_report_reception_print_requested':'native_report_reception_opened',newValues:{appointmentId:id},changedByUserId:req.user!.sub});
  res.type('html').send(buildNativeReportHtml(report,{imageUrl:image=>base+'/'+report.id+'/images/'+encodeURIComponent(image),fontBaseUrl:base+'/fonts',...(printing?{printScriptUrl:'/reception-report-print.js'}:{})}));
}
receptionReportRouter.get('/:appointmentId/report',asyncRoute(async(req,res)=>open(req,res,false)));
receptionReportRouter.get('/:appointmentId/report/print',requirePageAccess('print'),asyncRoute(async(req,res)=>open(req,res,true)));
receptionReportRouter.get('/:appointmentId/report/fonts/:weight',asyncRoute(async(req,res)=>{
  appointmentId(req);if(!['regular','bold'].includes(String(req.params.weight)))throw new HttpError(404,'Font not found.');
  res.sendFile(path.resolve('frontend/src/assets/fonts',req.params.weight==='bold'?'NotoNaskhArabic-Bold.ttf':'NotoNaskhArabic-Regular.ttf'));
}));
receptionReportRouter.get('/:appointmentId/report/:reportId/images/:imageId',asyncRoute(async(req,res)=>{
  const report=await receptionSignedReport(appointmentId(req)),imageId=String(req.params.imageId);
  if(String(report.id)!==req.params.reportId||!report.keyImages.some(image=>image.id===imageId))throw new HttpError(404,'Signed key image not found.');
  const image=(await pool.query('select * from native_report_key_images where report_id=$1 and id=$2 and removed=false',[report.id,imageId])).rows[0];
  if(!image)throw new HttpError(404,'Signed key image not found.');
  res.type('image/png').send(await readReportImage(image));
}));

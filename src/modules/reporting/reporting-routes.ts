import express, { type Request } from "express";
import { requireAuth,requireSupervisor,requireRecentSupervisorReauth } from "../../middleware/auth.js";
import type { AuthenticatedUserContext } from "../../types/http.js";
import { HttpError } from "../../utils/http-error.js";
import { asyncRoute } from "../../utils/async-route.js";
import { asUnknownRecord } from "../../utils/records.js";
import { buildNativeReportHtml } from "../../services/generated-print-html-service.js";
import { resolveReportContext, getReport, createReport, saveDraft, finalizeReport, addAddendum, getReportHistory, uploadKeyImage, updateKeyImages, getKeyImage } from "./reporting-service.js";
import { readReportingPolicy,updateReportingPolicy,REPORTING_PRESETS } from './reporting-policy.js';
import { listWorkspaceStudies,archiveStatus } from './workspace-study-service.js';
import { getDoctorReportingAppointments } from '../doctor-portal/cases-service.js';
import { doctorDashboard,assignedWork } from './workspace-dashboard-service.js';
import { getMyPublishedRosterForDoctor } from '../doctor-portal/roster-service.js';
import { launchWorkspaceImages,launchWorkspaceStudyImages } from './workspace-viewer-service.js';
import { readReportImage } from './report-image-storage-service.js';
import { pool } from '../../db/pool.js';
import { getWorkspaceStudy,getWorkspaceReport,createWorkspaceReport,saveWorkspaceDraft,finalizeWorkspaceReport,reviewWorkspaceReport,deleteWorkspaceDraft,workspaceHistory,restoreWorkspaceRevision,addWorkspaceAddendum,workspaceReviewers } from './workspace-report-service.js';

export const nativeReportingRouter = express.Router();
nativeReportingRouter.use(requireAuth, (req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (!["GET","HEAD"].includes(req.method)) {
    let sameOrigin=true;
    const publicHost=req.app.get('trust proxy') ? req.get('x-forwarded-host')?.split(',')[0].trim() || req.get('host') : req.get('host');
    try {if(req.get("origin"))sameOrigin=new URL(req.get("origin")!).host===publicHost;}catch{sameOrigin=false;}
    if(req.get("sec-fetch-site")==="cross-site" || !sameOrigin)return next(new HttpError(403,"Same-origin reporting request required."));
  }
  next();
});
function actor(req: Request) {
  const user = (req as Request & { user: AuthenticatedUserContext }).user;
  return { userId: user.sub, appRole: user.role };
}
function id(req: Request) {
  const value = Number(req.params.appointmentId);
  if (!Number.isSafeInteger(value) || value < 1) throw new HttpError(400,"Invalid appointment identifier.");
  return value;
}
const context = (req: Request) => String(req.get("X-RISpro-Viewer-Context") || "");
function reportId(req:Request) {const n=Number(req.params.reportId);if(!Number.isSafeInteger(n)||n<1)throw new HttpError(400,'Invalid report identifier.');return n;}
nativeReportingRouter.get('/workspace/config',asyncRoute(async(_req,res)=>{const p=await readReportingPolicy();res.json({enabled:p.enabled});}));
nativeReportingRouter.get('/workspace/policies',requireSupervisor,asyncRoute(async(_req,res)=>res.json({policy:await readReportingPolicy(),presets:REPORTING_PRESETS})));
nativeReportingRouter.put('/workspace/policies',requireSupervisor,requireRecentSupervisorReauth,asyncRoute(async(req,res)=>res.json({policy:await updateReportingPolicy(actor(req),req.body)})));
nativeReportingRouter.get('/workspace/studies',asyncRoute(async(req,res)=>res.json(await listWorkspaceStudies(actor(req),req.query))));
nativeReportingRouter.get('/workspace/appointments',asyncRoute(async(req,res)=>{
  if(!(await readReportingPolicy()).enabled)throw new HttpError(404,'Doctor Workspace V2 is disabled.');
  const freshness=await archiveStatus();
  res.json({...await getDoctorReportingAppointments(actor(req),req.query,freshness.available?freshness.archiveKey:null),freshness});
}));
nativeReportingRouter.get('/workspace/my-work',asyncRoute(async(req,res)=>res.json(await assignedWork(actor(req),req.query))));
nativeReportingRouter.get('/workspace/dashboard',asyncRoute(async(req,res)=>res.json(await doctorDashboard(actor(req),req.query.days))));
nativeReportingRouter.get('/workspace/schedule',asyncRoute(async(req,res)=>res.json(await getMyPublishedRosterForDoctor(actor(req),req.query.week?String(req.query.week):null))));
nativeReportingRouter.get('/workspace/studies/:studyKey',asyncRoute(async(req,res)=>res.json(await getWorkspaceStudy(actor(req),String(req.params.studyKey)))));
nativeReportingRouter.post('/workspace/studies/:studyKey/images-launch',asyncRoute(async(req,res)=>res.json(await launchWorkspaceStudyImages(actor(req),String(req.params.studyKey)))));
nativeReportingRouter.post('/workspace/studies/:studyKey/reports',asyncRoute(async(req,res)=>res.status(201).json(await createWorkspaceReport(actor(req),String(req.params.studyKey),asUnknownRecord(req.body)))));
nativeReportingRouter.get('/reports/:reportId',asyncRoute(async(req,res)=>res.json(await getWorkspaceReport(actor(req),reportId(req)))));
nativeReportingRouter.put('/reports/:reportId/draft',asyncRoute(async(req,res)=>res.json(await saveWorkspaceDraft(actor(req),reportId(req),asUnknownRecord(req.body)))));
nativeReportingRouter.post('/reports/:reportId/finalize',asyncRoute(async(req,res)=>res.json(await finalizeWorkspaceReport(actor(req),reportId(req),asUnknownRecord(req.body)))));
nativeReportingRouter.post('/reports/:reportId/review',asyncRoute(async(req,res)=>res.json(await reviewWorkspaceReport(actor(req),reportId(req),asUnknownRecord(req.body)))));
nativeReportingRouter.post('/reports/:reportId/delete',asyncRoute(async(req,res)=>res.json(await deleteWorkspaceDraft(actor(req),reportId(req),asUnknownRecord(req.body)))));
nativeReportingRouter.post('/reports/:reportId/recover',asyncRoute(async(req,res)=>res.json(await deleteWorkspaceDraft(actor(req),reportId(req),asUnknownRecord(req.body),true))));
nativeReportingRouter.get('/reports/:reportId/history',asyncRoute(async(req,res)=>res.json(await workspaceHistory(actor(req),reportId(req)))));
nativeReportingRouter.get('/reports/:reportId/reviewers',asyncRoute(async(req,res)=>res.json({reviewers:await workspaceReviewers(actor(req),reportId(req))})));
nativeReportingRouter.post('/reports/:reportId/restore-revision',asyncRoute(async(req,res)=>res.json(await restoreWorkspaceRevision(actor(req),reportId(req),asUnknownRecord(req.body)))));
nativeReportingRouter.post('/reports/:reportId/addenda',asyncRoute(async(req,res)=>res.json(await addWorkspaceAddendum(actor(req),reportId(req),asUnknownRecord(req.body)))));
nativeReportingRouter.get('/reports/:reportId/print',asyncRoute(async(req,res)=>res.type('html').send(buildNativeReportHtml(await getWorkspaceReport(actor(req),reportId(req))))));
nativeReportingRouter.post('/reports/:reportId/images-launch',asyncRoute(async(req,res)=>res.json(await launchWorkspaceImages(actor(req),reportId(req)))));
nativeReportingRouter.get('/reports/:reportId/images/:imageId',asyncRoute(async(req,res)=>{
  const report=await getWorkspaceReport(actor(req),reportId(req));
  if(!report.keyImages.some(i=>i.id===String(req.params.imageId)))throw new HttpError(404,'Key image not found.');
  const image=(await pool.query('select * from native_report_key_images where report_id=$1 and id=$2 and removed=false',[report.id,String(req.params.imageId)])).rows[0];
  res.type('image/png').send(await readReportImage(image));
}));
nativeReportingRouter.put('/reports/:reportId/images',asyncRoute(async(req,res)=>res.json(await updateKeyImages(actor(req),context(req),0,asUnknownRecord(req.body),reportId(req)))));
nativeReportingRouter.post('/reports/:reportId/images',express.raw({type:'image/png',limit:'12mb'}),asyncRoute(async(req,res)=>{
  let metadata:Record<string,unknown>;try{metadata=JSON.parse(decodeURIComponent(req.get('X-RISpro-Capture')||''));}catch{throw new HttpError(400,'Capture metadata is required.');}
  if(!Buffer.isBuffer(req.body))throw new HttpError(400,'PNG bytes required.');
  res.json(await uploadKeyImage(actor(req),context(req),0,metadata,req.body,reportId(req)));
}));
nativeReportingRouter.get("/contexts/:contextId", asyncRoute(async (req,res) => {
  res.json(await resolveReportContext(actor(req),String(req.params.contextId)));
}));
nativeReportingRouter.get("/appointments/:appointmentId",asyncRoute(async(req,res)=> { res.json({ report: await getReport(actor(req),id(req)) }); }));
nativeReportingRouter.post("/appointments/:appointmentId",asyncRoute(async(req,res)=> { res.json(await createReport(actor(req),context(req),id(req))); }));
nativeReportingRouter.put("/appointments/:appointmentId/draft",asyncRoute(async(req,res)=> { res.json(await saveDraft(actor(req),context(req),id(req),asUnknownRecord(req.body))); }));
nativeReportingRouter.post("/appointments/:appointmentId/finalize",asyncRoute(async(req,res)=> { res.json(await finalizeReport(actor(req),context(req),id(req),asUnknownRecord(req.body))); }));
nativeReportingRouter.post("/appointments/:appointmentId/addenda",asyncRoute(async(req,res)=> { res.json(await addAddendum(actor(req),context(req),id(req),asUnknownRecord(req.body))); }));
nativeReportingRouter.get("/appointments/:appointmentId/history",asyncRoute(async(req,res)=> { res.json(await getReportHistory(actor(req),id(req))); }));
nativeReportingRouter.post("/appointments/:appointmentId/images",express.raw({type:"image/png",limit:"12mb"}),asyncRoute(async(req,res)=> {
  let metadata: Record<string,unknown>;
  try { metadata = JSON.parse(decodeURIComponent(req.get("X-RISpro-Capture") || "")); }
  catch { throw new HttpError(400,"Capture metadata is required."); }
  if (!Buffer.isBuffer(req.body)) throw new HttpError(400,"PNG bytes are required.");
  res.json(await uploadKeyImage(actor(req),context(req),id(req),metadata,req.body));
}));
nativeReportingRouter.put("/appointments/:appointmentId/images",asyncRoute(async(req,res)=> { res.json(await updateKeyImages(actor(req),context(req),id(req),asUnknownRecord(req.body))); }));
nativeReportingRouter.get("/appointments/:appointmentId/images/:imageId",asyncRoute(async(req,res)=> {
  res.type("image/png").send(await getKeyImage(actor(req),id(req),String(req.params.imageId)));
}));
nativeReportingRouter.get("/appointments/:appointmentId/print",asyncRoute(async(req,res)=> {
  const report = await getReport(actor(req),id(req));
  if (!report) throw new HttpError(404,"Native report not found.");
  res.type("html").send(buildNativeReportHtml(report));
}));

import express, { type Request } from "express";
import { requireAuth } from "../../middleware/auth.js";
import type { AuthenticatedUserContext } from "../../types/http.js";
import { HttpError } from "../../utils/http-error.js";
import { asyncRoute } from "../../utils/async-route.js";
import { asUnknownRecord } from "../../utils/records.js";
import { buildNativeReportHtml } from "../../services/generated-print-html-service.js";
import { resolveReportContext, getReport, createReport, saveDraft, finalizeReport, addAddendum, getReportHistory, uploadKeyImage, updateKeyImages, getKeyImage } from "./reporting-service.js";

export const nativeReportingRouter = express.Router();
nativeReportingRouter.use(requireAuth, (req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (!["GET","HEAD"].includes(req.method)) {
    let sameOrigin=true;
    try {if(req.get("origin"))sameOrigin=new URL(req.get("origin")!).host===req.get("host");}catch{sameOrigin=false;}
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

import express, { type Request, type Response } from "express";
import crypto from "crypto";
import { requireAnyRole, requireAuth, requireRecentSupervisorReauth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { HttpError } from "../utils/http-error.js";
import { enqueueEmail, recentEmailHistory } from "../services/email-outbox-service.js";
import { getEmailSettings, mergeEmailTestConfiguration, saveEmailSettings, type EmailSettingsInput } from "../services/email-settings-service.js";
import { verifyEmailConfiguration } from "../services/email-service.js";
import { getEmailNotificationRule, listEmailNotificationRules, setEmailNotificationRule, setEmailNotificationTemplate } from "../services/email-notification-rules-service.js";
import { logAuditEntry } from "../services/audit-service.js";

export const emailSettingsRouter=express.Router();
emailSettingsRouter.use(requireAuth,requireAnyRole(["super_admin"]));
function body(req:Request):EmailSettingsInput { const v=(req.body||{}) as Record<string,unknown>; return {enabled:Boolean(v.enabled),senderName:String(v.senderName||""),senderEmail:String(v.senderEmail||""),replyToEmail:String(v.replyToEmail||""),smtpHost:String(v.smtpHost||""),smtpPort:Number(v.smtpPort),securityMode:v.securityMode as "tls"|"starttls",smtpUsername:String(v.smtpUsername||""),connectionTimeoutSeconds:Number(v.connectionTimeoutSeconds),password:typeof v.password==="string"?v.password:""}; }
emailSettingsRouter.get("",asyncRoute(async(_req:Request,res:Response)=>res.json({settings:await getEmailSettings()})));
emailSettingsRouter.get("/history",asyncRoute(async(req:Request,res:Response)=>res.json({history:await recentEmailHistory(Number(req.query.limit)||20)})));
emailSettingsRouter.get("/rules",asyncRoute(async(_req:Request,res:Response)=>res.json({rules:await listEmailNotificationRules()})));
emailSettingsRouter.use(requireRecentSupervisorReauth);
emailSettingsRouter.put("/rules/:eventType",asyncRoute(async(req:Request,res:Response)=>{const enabled=(req.body||{}).enabled;if(typeof enabled!=="boolean")throw new HttpError(400,"enabled must be a boolean.");const eventType=String(req.params.eventType);const previous=await getEmailNotificationRule(eventType);const rule=await setEmailNotificationRule(eventType,enabled,req.user!.sub);await logAuditEntry({entityType:"email_notification_rule",entityId:null,actionType:"email_notification_rule_updated",oldValues:{eventType:previous.eventType,enabled:previous.enabled},newValues:{eventType:rule.eventType,enabled:rule.enabled},changedByUserId:req.user!.sub});res.json({rule});}));
emailSettingsRouter.put("/rules/:eventType/template",asyncRoute(async(req:Request,res:Response)=>{const eventType=String(req.params.eventType);const previous=await getEmailNotificationRule(eventType);const rule=await setEmailNotificationTemplate(eventType,{subjectTemplate:req.body?.subjectTemplate,textBodyTemplate:req.body?.textBodyTemplate},req.user!.sub);await logAuditEntry({entityType:"email_notification_rule",entityId:null,actionType:"email_notification_template_updated",oldValues:{eventType:previous.eventType},newValues:{eventType:rule.eventType},changedByUserId:req.user!.sub});res.json({rule});}));
emailSettingsRouter.put("",asyncRoute(async(req:Request,res:Response)=>res.json({settings:await saveEmailSettings(body(req),req.user!.sub)})));
emailSettingsRouter.post("/test-connection",asyncRoute(async(req:Request,res:Response)=>{await verifyEmailConfiguration(await mergeEmailTestConfiguration(body(req)));res.json({ok:true});}));
emailSettingsRouter.post("/test-email",asyncRoute(async(req:Request,res:Response)=>{const recipient=String((req.body||{}).recipient||"").trim();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient))throw new HttpError(400,"A valid recipient email is required.");const settings=await getEmailSettings();if(!settings.passwordConfigured)throw new HttpError(400,"Save SMTP credentials before sending a test email.");const outbox=await enqueueEmail({eventType:"system_test",recipientEmail:recipient,subject:"RISpro outbound email test",textBody:"This is a RISpro outbound email test.",idempotencyKey:`system_test:${crypto.randomUUID()}`,createdByUserId:req.user!.sub});res.status(202).json({outboxId:outbox.id,status:outbox.status});}));

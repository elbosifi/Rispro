import type { PoolClient } from 'pg';
import { pool } from '../../db/pool.js';
import { HttpError } from '../../utils/http-error.js';
import { logAuditEntry } from '../../services/audit-service.js';
import type { Actor } from '../doctor-portal/reporting-board-service.js';
import { reportingDoctor } from './workspace-study-service.js';
import { transaction } from './reporting-service.js';
import { EMPTY_SECTIONS, SECTION_NAMES, sections as validateSections, type ReportSections } from './reporting-validation.js';

export const REPORT_TEMPLATES = {
  blank:{name:'Blank narrative',sections:EMPTY_SECTIONS},
  structured:{name:'Structured narrative',sections:{...EMPTY_SECTIONS,technique:'{{technique}}',findings:'{{findings}}',impression:'{{impression}}'}},
} satisfies Record<string,{name:string;sections:ReportSections}>;

const MAX_TEMPLATE_NAME_LENGTH = 100;
const MAX_TEMPLATE_SECTION_LENGTH = 20_000;
const MAX_TEMPLATE_TOTAL_LENGTH = 50_000;
const TEMPLATE_INPUT_FIELDS = new Set(['name','sections']);

interface TemplateRow {
  id: string | number;
  owner_user_id: string | number;
  name: string;
  sections: unknown;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface PersonalReportingTemplate {
  id: number;
  name: string;
  sections: ReportSections;
  createdAt: string;
  updatedAt: string;
}

function templateId(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400,'Invalid reporting template identifier.');
  return id;
}

function normalizeSections(value: unknown): ReportSections {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400,'Template sections are required.');
  const input = value as Record<string,unknown>;
  if (Object.keys(input).length !== SECTION_NAMES.length || Object.keys(input).some(key=>!SECTION_NAMES.includes(key as typeof SECTION_NAMES[number]))) {
    throw new HttpError(400,'Templates may contain only the five reusable report sections.');
  }
  const result = validateSections(input);
  const lengths = Object.values(result).map(text=>text.length);
  if (lengths.some(length=>length>MAX_TEMPLATE_SECTION_LENGTH) || lengths.reduce((total,length)=>total+length,0)>MAX_TEMPLATE_TOTAL_LENGTH) {
    throw new HttpError(400,'Reporting template content exceeds the size limit.');
  }
  if (Object.values(result).every(text=>!text.trim())) throw new HttpError(400,'Add reusable report text to at least one section.');
  return result;
}

function templateInput(value: unknown): {name:string;sections:ReportSections} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400,'Reporting template details are required.');
  const input=value as Record<string,unknown>;
  if (Object.keys(input).some(key=>!TEMPLATE_INPUT_FIELDS.has(key))) throw new HttpError(400,'Templates accept only a name and reusable report sections.');
  if (typeof input.name!=='string') throw new HttpError(400,'Template name is required.');
  const name=input.name.trim();
  if (!name || name.length>MAX_TEMPLATE_NAME_LENGTH) throw new HttpError(400,`Template names must contain 1 to ${MAX_TEMPLATE_NAME_LENGTH} characters.`);
  return {name,sections:normalizeSections(input.sections)};
}

function toTemplate(row: TemplateRow): PersonalReportingTemplate {
  return {id:Number(row.id),name:row.name,sections:normalizeSections(row.sections),createdAt:new Date(row.created_at).toISOString(),updatedAt:new Date(row.updated_at).toISOString()};
}

function duplicateName(error: unknown): never {
  if (error && typeof error==='object' && 'code' in error && error.code==='23505') throw new HttpError(409,'A reporting template with this name already exists.');
  throw error;
}

async function ownerUserId(actor: Actor): Promise<number> {
  const me=await reportingDoctor(actor);
  const id=Number(me.profile?.userId);
  if (!Number.isSafeInteger(id)||id<1) throw new HttpError(403,'An active reporting doctor profile is required.');
  return id;
}

export async function listWorkspaceTemplates(actor: Actor) {
  const ownerId=await ownerUserId(actor);
  const rows=(await pool.query<TemplateRow>('select id,owner_user_id,name,sections,created_at,updated_at from native_reporting_templates where owner_user_id=$1 order by lower(name),id',[ownerId])).rows;
  return {
    builtins:Object.entries(REPORT_TEMPLATES).map(([id,template])=>({id,name:template.name})),
    templates:rows.map(row=>({id:Number(row.id),name:row.name,createdAt:new Date(row.created_at).toISOString(),updatedAt:new Date(row.updated_at).toISOString()})),
  };
}

export async function getWorkspaceTemplate(actor: Actor,id: unknown): Promise<PersonalReportingTemplate> {
  const ownerId=await ownerUserId(actor),key=templateId(id);
  const row=(await pool.query<TemplateRow>('select id,owner_user_id,name,sections,created_at,updated_at from native_reporting_templates where id=$1 and owner_user_id=$2',[key,ownerId])).rows[0];
  if (!row) throw new HttpError(404,'Reporting template not found.');
  return toTemplate(row);
}

export async function createWorkspaceTemplate(actor: Actor,input: unknown): Promise<PersonalReportingTemplate> {
  const ownerId=await ownerUserId(actor),value=templateInput(input);
  try {
    return await transaction(async db=>{
      const row=(await db.query<TemplateRow>(`insert into native_reporting_templates(owner_user_id,name,sections) values($1,$2,$3) returning id,owner_user_id,name,sections,created_at,updated_at`,[ownerId,value.name,JSON.stringify(value.sections)])).rows[0];
      await logAuditEntry({entityType:'native_reporting_template',entityId:String(row.id),actionType:'native_reporting_template_created',newValues:{ownerUserId:ownerId},changedByUserId:actor.userId},db);
      return toTemplate(row);
    });
  } catch(error) { return duplicateName(error); }
}

export async function updateWorkspaceTemplate(actor: Actor,id: unknown,input: unknown): Promise<PersonalReportingTemplate> {
  const ownerId=await ownerUserId(actor),key=templateId(id),value=templateInput(input);
  try {
    return await transaction(async db=>{
      const row=(await db.query<TemplateRow>(`update native_reporting_templates set name=$3,sections=$4,updated_at=now() where id=$1 and owner_user_id=$2 returning id,owner_user_id,name,sections,created_at,updated_at`,[key,ownerId,value.name,JSON.stringify(value.sections)])).rows[0];
      if (!row) throw new HttpError(404,'Reporting template not found.');
      await logAuditEntry({entityType:'native_reporting_template',entityId:String(row.id),actionType:'native_reporting_template_updated',newValues:{ownerUserId:ownerId},changedByUserId:actor.userId},db);
      return toTemplate(row);
    });
  } catch(error) { return duplicateName(error); }
}

export async function deleteWorkspaceTemplate(actor: Actor,id: unknown): Promise<void> {
  const ownerId=await ownerUserId(actor),key=templateId(id);
  await transaction(async db=>{
    const deleted=(await db.query('delete from native_reporting_templates where id=$1 and owner_user_id=$2 returning id',[key,ownerId])).rows[0];
    if (!deleted) throw new HttpError(404,'Reporting template not found.');
    await logAuditEntry({entityType:'native_reporting_template',entityId:String(deleted.id),actionType:'native_reporting_template_deleted',newValues:{ownerUserId:ownerId},changedByUserId:actor.userId},db);
  });
}

export async function personalTemplateSections(db: Pick<PoolClient,'query'>,ownerId: number,id: unknown): Promise<ReportSections> {
  const key=templateId(id);
  const row=(await db.query<{sections:unknown}>('select sections from native_reporting_templates where id=$1 and owner_user_id=$2',[key,ownerId])).rows[0];
  if (!row) throw new HttpError(404,'Reporting template not found.');
  return normalizeSections(row.sections);
}

export function templateSections(id:unknown): ReportSections {
  const key=String(id||'blank');
  if (!(key in REPORT_TEMPLATES)) throw new HttpError(400,'Unknown report template.');
  return {...REPORT_TEMPLATES[key as keyof typeof REPORT_TEMPLATES].sections};
}

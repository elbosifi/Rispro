import { pool } from "../../db/pool.js";
import { logAuditEntry } from "../../services/audit-service.js";
import type { DbExecutor } from "../../types/db.js";
import { HttpError } from "../../utils/http-error.js";
import { SOP_SECTION_DEFINITIONS, type SopSectionKey } from "./constants.js";
import { findSop, findSopByCode, findSopVersion, insertSop, updateSopDraft } from "./sop-repository.js";
import { requireSopManagement } from "./sop-service.js";
import { normalizeSopCategory, normalizeSopCode, normalizeSopDate, normalizeSopVersion, requiredText, validateSopDocument } from "./sop-validation.js";
import type { JsonRecord, SopDocument, SopSummary, SopVersion } from "./types.js";

export const SOP_JSON_FORMAT = "rispro-sop" as const;
export const SOP_JSON_FORMAT_VERSION = 1 as const;
export const SOP_JSON_EXAMPLE_FILENAME = "RISpro-SOP-JSON-V1-Example.json";
const MAX_SOP_JSON_BYTES = 2 * 1024 * 1024;

export interface SopJsonInterchangeV1 {
  format: typeof SOP_JSON_FORMAT;
  formatVersion: typeof SOP_JSON_FORMAT_VERSION;
  sop: { code: string; title: string; category: string; version: string; effectiveDate: string | null; changeSummary: string; document: SopDocument };
}

export interface SopJsonSectionPreview {
  sectionKey: SopSectionKey;
  sectionTitle: string;
  action: "changed" | "unchanged" | "invalid";
  errors: string[];
  currentText: string | null;
  importedText: string | null;
}

export interface SopJsonInspect {
  format: "json";
  formatVersion: number | null;
  metadata: { sopCode: string | null; title: string | null; category: string | null; sourceVersion: string | null; effectiveDate: string | null; changeSummary: string | null };
  sectionCount: number;
  structuralErrors: string[];
}

export interface SopJsonPreview {
  format: "json";
  formatVersion: number | null;
  mode: "create" | "draft_update";
  metadata: SopJsonInspect["metadata"];
  targetVersion: string | null;
  targetUpdatedAt: string | null;
  sections: SopJsonSectionPreview[];
  effectiveDate: { current: string | null; imported: string | null; changed: boolean };
  changeSummary: { current: string | null; imported: string | null; changed: boolean };
  errors: string[];
  canConfirm: boolean;
}

export interface SopJsonConfirmResult { sop: SopSummary; version: SopVersion; summary: { importType: "create" | "draft_update"; changedSectionKeys: SopSectionKey[]; sourceVersion: string; targetVersion: string; }; }
type ImportInput = { fileContentBase64: string; fileName?: string | null };
type ParsedJson = { formatVersion: number | null; metadata: SopJsonInspect["metadata"]; document: SopDocument | null; errors: string[] };

function record(value: unknown): JsonRecord | null { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null; }
function text(value: unknown): string { if (typeof value === "string") return value; if (Array.isArray(value)) return value.map(text).join(" "); const item = record(value); return item ? `${text(item.text)} ${text(item.content)}`.trim() : ""; }
function timestamp(value: unknown): string { const date = value instanceof Date ? value : new Date(String(value ?? "")); return Number.isNaN(date.getTime()) ? String(value ?? "") : date.toISOString(); }
function positiveId(value: unknown, field: string): number { const parsed = Number(value); if (!Number.isInteger(parsed) || parsed <= 0) throw new HttpError(400, `${field} must be a positive integer.`); return parsed; }
function safeFilenamePart(value: string): string { return value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "sop"; }

function decodeInput(input: ImportInput): unknown {
  if (input.fileName && !input.fileName.toLowerCase().endsWith(".json")) throw new HttpError(400, "SOP import accepts JSON files only.");
  const encoded = String(input.fileContentBase64 ?? "").trim();
  if (!encoded) throw new HttpError(400, "fileContentBase64 is required.");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) throw new HttpError(400, "SOP JSON content is not valid base64.");
  const buffer = Buffer.from(encoded, "base64");
  if (!buffer.length) throw new HttpError(400, "SOP JSON file is empty.");
  if (buffer.length > MAX_SOP_JSON_BYTES) throw new HttpError(413, "SOP JSON file exceeds the 2 MB limit.");
  let source: string;
  try { source = new TextDecoder("utf-8", { fatal: true }).decode(buffer); } catch { throw new HttpError(400, "SOP JSON file must be UTF-8."); }
  try { return JSON.parse(source); } catch { throw new HttpError(400, "SOP JSON file is not valid JSON."); }
}

function parseJson(input: ImportInput): ParsedJson {
  const wrapper = record(decodeInput(input));
  if (!wrapper || wrapper.format !== SOP_JSON_FORMAT) throw new HttpError(400, "File is not a RISpro SOP JSON document.");
  if (wrapper.formatVersion !== SOP_JSON_FORMAT_VERSION) throw new HttpError(400, `Unsupported RISpro SOP JSON format version '${String(wrapper.formatVersion ?? "")}'. Expected version 1.`);
  const sop = record(wrapper.sop);
  if (!sop) throw new HttpError(400, "RISpro SOP JSON must contain a sop object.");
  const metadata = { sopCode: typeof sop.code === "string" ? sop.code : null, title: typeof sop.title === "string" ? sop.title : null, category: typeof sop.category === "string" ? sop.category : null, sourceVersion: typeof sop.version === "string" ? sop.version : null, effectiveDate: typeof sop.effectiveDate === "string" ? sop.effectiveDate : null, changeSummary: typeof sop.changeSummary === "string" ? sop.changeSummary : null };
  const errors: string[] = [];
  let document: SopDocument | null = null;
  try { requiredText(sop.code, "SOP code"); normalizeSopCode(sop.code); } catch (error) { errors.push(error instanceof Error ? error.message : "SOP code is invalid."); }
  try { requiredText(sop.title, "Title"); } catch (error) { errors.push(error instanceof Error ? error.message : "Title is required."); }
  try { normalizeSopCategory(sop.category); } catch (error) { errors.push(error instanceof Error ? error.message : "Category is invalid."); }
  try { normalizeSopVersion(sop.version); } catch (error) { errors.push(error instanceof Error ? error.message : "Version is invalid."); }
  try { if (typeof sop.effectiveDate !== "string") throw new HttpError(400, "Effective date is required."); normalizeSopDate(sop.effectiveDate); } catch (error) { errors.push(error instanceof Error ? error.message : "Effective date is invalid."); }
  try { requiredText(sop.changeSummary, "Change summary"); } catch (error) { errors.push(error instanceof Error ? error.message : "Change summary is required."); }
  try { document = validateSopDocument(sop.document, true); } catch (error) { errors.push(error instanceof Error ? error.message : "SOP document is invalid."); }
  return { formatVersion: SOP_JSON_FORMAT_VERSION, metadata, document, errors: [...new Set(errors)] };
}

function canonical(parsed: ParsedJson): SopJsonInterchangeV1 {
  if (parsed.errors.length || !parsed.document) throw new HttpError(400, "SOP JSON import has validation errors.", { errors: parsed.errors });
  return { format: SOP_JSON_FORMAT, formatVersion: SOP_JSON_FORMAT_VERSION, sop: { code: normalizeSopCode(parsed.metadata.sopCode), title: requiredText(parsed.metadata.title, "Title"), category: normalizeSopCategory(parsed.metadata.category), version: normalizeSopVersion(parsed.metadata.sourceVersion), effectiveDate: normalizeSopDate(parsed.metadata.effectiveDate), changeSummary: requiredText(parsed.metadata.changeSummary, "Change summary"), document: parsed.document } };
}

function sectionPreviews(parsed: ParsedJson, current?: SopVersion): SopJsonSectionPreview[] {
  return SOP_SECTION_DEFINITIONS.map((definition, index) => {
    const imported = parsed.document?.sections[index];
    const currentSection = current?.contentJson.sections[index];
    const errors = parsed.errors.length ? parsed.errors : imported ? [] : [`Section '${definition.key}' is missing.`];
    const importedText = imported ? text(imported.content) : null;
    const currentText = currentSection ? text(currentSection.content) : null;
    return { sectionKey: definition.key, sectionTitle: definition.title, errors, currentText, importedText, action: errors.length ? "invalid" : currentSection && JSON.stringify(currentSection.content) === JSON.stringify(imported!.content) ? "unchanged" : "changed" };
  });
}

function preview(parsed: ParsedJson, mode: "create" | "draft_update", target?: { sop: SopSummary; version: SopVersion }): SopJsonPreview {
  const code = parsed.metadata.sopCode;
  const errors = [...parsed.errors];
  if (mode === "create" && !parsed.errors.length) {
    const imported = canonical(parsed);
    if (imported.sop.version !== "1.0") errors.push("New SOP JSON imports must use version 1.0.");
  }
  if (target && !parsed.errors.length && normalizeSopCode(code) !== target.sop.code) errors.push("SOP code does not match this SOP.");
  const sections = sectionPreviews({ ...parsed, errors }, target?.version);
  return { format: "json", formatVersion: parsed.formatVersion, mode, metadata: parsed.metadata, targetVersion: target?.version.version ?? null, targetUpdatedAt: target ? timestamp(target.version.updatedAt) : null, sections, effectiveDate: { current: target?.version.effectiveDate ?? null, imported: parsed.metadata.effectiveDate, changed: target ? target.version.effectiveDate !== parsed.metadata.effectiveDate : true }, changeSummary: { current: target?.version.changeSummary ?? null, imported: parsed.metadata.changeSummary, changed: target ? target.version.changeSummary !== parsed.metadata.changeSummary : true }, errors: [...new Set(errors)], canConfirm: errors.length === 0 && sections.every((section) => section.action !== "invalid") };
}

async function loadDraft(sopIdValue: unknown, versionValue: unknown, executor: DbExecutor = pool): Promise<{ sop: SopSummary; version: SopVersion }> {
  const sopId = positiveId(sopIdValue, "sopId"); const version = normalizeSopVersion(versionValue);
  const sop = await findSop(sopId, executor); if (!sop) throw new HttpError(404, "SOP not found.");
  if (sop.status === "archived") throw new HttpError(409, "Only editable draft versions can accept imports.");
  const draft = await findSopVersion(sopId, version, true, executor);
  if (!draft || draft.status !== "draft") throw new HttpError(409, "Only editable draft versions can accept imports.");
  return { sop, version: draft };
}

export function serializeSopJson(sop: SopSummary, version: SopVersion): Buffer {
  const payload: SopJsonInterchangeV1 = { format: SOP_JSON_FORMAT, formatVersion: SOP_JSON_FORMAT_VERSION, sop: { code: sop.code, title: sop.title, category: sop.category, version: version.version, effectiveDate: version.effectiveDate, changeSummary: version.changeSummary, document: validateSopDocument(version.contentJson) } };
  return serializeSopJsonPayload(payload);
}

function serializeSopJsonPayload(payload: SopJsonInterchangeV1): Buffer {
  return Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function exampleParagraph(value: string, dir: "auto" | "ltr" | "rtl" = "auto"): JsonRecord {
  return { type: "paragraph", attrs: { dir }, content: [{ type: "text", text: value }] };
}

function exampleSectionContent(key: SopSectionKey): JsonRecord {
  switch (key) {
    case "purpose": return { type: "doc", content: [exampleParagraph("Verify patient identity and complete MRI safety screening before scanning.", "ltr"), exampleParagraph("يجب التحقق من هوية المريض وإكمال فحص السلامة قبل التصوير بالرنين المغناطيسي.", "rtl")] };
    case "scope": return { type: "doc", content: [exampleParagraph("Applies to all staff involved in MRI patient preparation and scanning.")] };
    case "responsibilities": return { type: "doc", content: [{ type: "bulletList", attrs: { dir: "ltr" }, content: [{ type: "listItem", attrs: { dir: "auto" }, content: [exampleParagraph("Confirm two patient identifiers.")] }, { type: "listItem", attrs: { dir: "auto" }, content: [exampleParagraph("Escalate any safety concern before the scan.")] }] }] };
    case "definitions": return { type: "doc", content: [exampleParagraph("MRI: magnetic resonance imaging.")] };
    case "safety": return { type: "doc", content: [exampleParagraph("Do not proceed until the MRI screening form is complete and reviewed.")] };
    case "procedure": return { type: "doc", content: [{ type: "orderedList", attrs: { dir: "ltr", start: 1 }, content: [{ type: "listItem", attrs: { dir: "auto" }, content: [exampleParagraph("Verify the patient using two identifiers.")] }, { type: "listItem", attrs: { dir: "auto" }, content: [exampleParagraph("Review the MRI safety screening responses.")] }, { type: "listItem", attrs: { dir: "auto" }, content: [exampleParagraph("Document clearance before the examination begins.")] }] }] };
    case "documentation": return { type: "doc", content: [exampleParagraph("Record patient identity verification and completed MRI safety screening in the RIS workflow.")] };
    case "references": return { type: "doc", content: [exampleParagraph("Local MRI safety policy and current MRI screening form.")] };
  }
}

export function buildSopJsonExample(): SopJsonInterchangeV1 {
  const document = validateSopDocument({
    type: "sop",
    version: 1,
    sections: SOP_SECTION_DEFINITIONS.map((section) => ({ ...section, content: exampleSectionContent(section.key) })),
  }, true);
  return {
    format: SOP_JSON_FORMAT,
    formatVersion: SOP_JSON_FORMAT_VERSION,
    sop: {
      code: "RAD-MRI-001",
      title: "MRI Patient Identification and Safety Screening",
      category: "MRI",
      version: "1.0",
      effectiveDate: "2026-10-01",
      changeSummary: "Initial issue",
      document,
    },
  };
}

export function exportSopJsonExample(): { buffer: Buffer; filename: string } {
  return { buffer: serializeSopJsonPayload(buildSopJsonExample()), filename: SOP_JSON_EXAMPLE_FILENAME };
}

export async function exportSopVersionJson(sopIdValue: unknown, versionValue: unknown, role: string | undefined): Promise<{ buffer: Buffer; filename: string }> {
  const sopId = positiveId(sopIdValue, "sopId"); const versionValueNormalized = normalizeSopVersion(versionValue); const sop = await findSop(sopId);
  if (!sop) throw new HttpError(404, "SOP not found."); if (!role) throw new HttpError(401, "Authentication required.");
  const management = role === "supervisor" || role === "super_admin"; const version = await findSopVersion(sopId, versionValueNormalized, management);
  if (!version || (!management && sop.status !== "published")) throw new HttpError(404, "SOP version not found.");
  return { buffer: serializeSopJson(sop, version), filename: `${safeFilenamePart(sop.code)}-v${safeFilenamePart(version.version)}.json` };
}

async function newImportPreview(input: ImportInput): Promise<SopJsonPreview> { const parsed = parseJson(input); const result = preview(parsed, "create"); if (result.canConfirm && await findSopByCode(normalizeSopCode(parsed.metadata.sopCode))) { result.errors.push(`An SOP with code ${normalizeSopCode(parsed.metadata.sopCode)} already exists.`); result.canConfirm = false; result.sections = result.sections.map((section) => ({ ...section, action: "invalid", errors: [...section.errors, "SOP code already exists."] })); } return result; }
export async function inspectNewSopJsonImport(input: ImportInput, role: string | undefined): Promise<SopJsonInspect> { requireSopManagement(role); const parsed = parseJson(input); const result = await newImportPreview(input); return { format: "json", formatVersion: parsed.formatVersion, metadata: parsed.metadata, sectionCount: parsed.document?.sections.length ?? 0, structuralErrors: result.errors }; }
export async function previewNewSopJsonImport(input: ImportInput, role: string | undefined): Promise<SopJsonPreview> { requireSopManagement(role); return newImportPreview(input); }
export async function confirmNewSopJsonImport(input: ImportInput, actorUserIdValue: unknown, role: string | undefined): Promise<SopJsonConfirmResult> {
  requireSopManagement(role); const actorUserId = positiveId(actorUserIdValue, "acting user"); const parsed = parseJson(input); const plan = preview(parsed, "create"); if (!plan.canConfirm) throw new HttpError(400, "SOP JSON import has validation errors.", plan); const imported = canonical(parsed);
  const client = await pool.connect(); try { await client.query("begin"); if (await findSopByCode(imported.sop.code, client)) throw new HttpError(409, `An SOP with code ${imported.sop.code} already exists.`); const result = await insertSop({ ...imported.sop, contentJson: imported.sop.document, actorUserId }, client); await logAuditEntry({ entityType: "sop", entityId: result.sop.id, actionType: "sop_json_imported", newValues: { sop_id: result.sop.id, sop_code: result.sop.code, version: result.version.version, format_version: SOP_JSON_FORMAT_VERSION, import_type: "create" }, changedByUserId: actorUserId }, client); await client.query("commit"); return { ...result, summary: { importType: "create", changedSectionKeys: SOP_SECTION_DEFINITIONS.map((section) => section.key), sourceVersion: imported.sop.version, targetVersion: result.version.version } }; } catch (error) { await client.query("rollback").catch(() => undefined); throw error; } finally { client.release(); }
}

export async function inspectDraftSopJsonImport(sopId: unknown, version: unknown, input: ImportInput, role: string | undefined): Promise<SopJsonInspect> { requireSopManagement(role); const target = await loadDraft(sopId, version); const parsed = parseJson(input); return { format: "json", formatVersion: parsed.formatVersion, metadata: parsed.metadata, sectionCount: parsed.document?.sections.length ?? 0, structuralErrors: preview(parsed, "draft_update", target).errors }; }
export async function previewDraftSopJsonImport(sopId: unknown, version: unknown, input: ImportInput, role: string | undefined): Promise<SopJsonPreview> { requireSopManagement(role); return preview(parseJson(input), "draft_update", await loadDraft(sopId, version)); }
export async function confirmDraftSopJsonImport(sopIdValue: unknown, versionValue: unknown, input: ImportInput & { expectedDraftUpdatedAt?: string | null }, actorUserIdValue: unknown, role: string | undefined): Promise<SopJsonConfirmResult> {
  requireSopManagement(role); const actorUserId = positiveId(actorUserIdValue, "acting user"); const expected = String(input.expectedDraftUpdatedAt ?? "").trim(); if (!expected) throw new HttpError(400, "expectedDraftUpdatedAt is required."); const parsed = parseJson(input);
  const client = await pool.connect(); try { await client.query("begin"); const sopId = positiveId(sopIdValue, "sopId"); await client.query("select id from sops where id=$1 for update", [sopId]); const target = await loadDraft(sopId, versionValue, client); if (timestamp(target.version.updatedAt) !== timestamp(expected)) throw new HttpError(409, "SOP draft changed after preview. Preview the import again."); const plan = preview(parsed, "draft_update", target); if (!plan.canConfirm) throw new HttpError(400, "SOP JSON import has validation errors.", plan); const imported = canonical(parsed); const changedSectionKeys = plan.sections.filter((section) => section.action === "changed").map((section) => section.sectionKey); const changed = changedSectionKeys.length > 0 || plan.effectiveDate.changed || plan.changeSummary.changed || target.sop.title !== imported.sop.title || target.sop.category !== imported.sop.category; const result = changed ? await updateSopDraft({ sopId, version: target.version.version, title: imported.sop.title, category: imported.sop.category, contentJson: imported.sop.document, changeSummary: imported.sop.changeSummary, effectiveDate: imported.sop.effectiveDate, actorUserId }, client) : { sop: target.sop, version: target.version }; await logAuditEntry({ entityType: "sop", entityId: sopId, actionType: "sop_json_imported", newValues: { sop_id: sopId, sop_code: target.sop.code, format_version: SOP_JSON_FORMAT_VERSION, import_type: "draft_update", changed_section_keys: changedSectionKeys, source_version: imported.sop.version, target_version: target.version.version }, changedByUserId: actorUserId }, client); await client.query("commit"); return { ...result, summary: { importType: "draft_update", changedSectionKeys, sourceVersion: imported.sop.version, targetVersion: target.version.version } }; } catch (error) { await client.query("rollback").catch(() => undefined); throw error; } finally { client.release(); }
}

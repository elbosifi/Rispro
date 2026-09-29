import { pool } from "../../db/pool.js";
import { logAuditEntry } from "../../services/audit-service.js";
import type { DbExecutor } from "../../types/db.js";
import { HttpError } from "../../utils/http-error.js";
import { SOP_SECTION_DEFINITIONS, type SopSectionKey } from "./constants.js";
import { findSop, findSopByCode, findSopVersion, insertSop, updateSopDraft } from "./sop-repository.js";
import { requireSopManagement } from "./sop-service.js";
import { normalizeSopCategory, normalizeSopCode, normalizeSopDate, normalizeSopVersion, requiredText, validateSopReviewDate, validateSopDocument } from "./sop-validation.js";
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

export interface SopJsonExampleConfig {
  code: string;
  title: string;
  category: string;
  version: string;
  effectiveDate: string;
  changeSummary: string;
  document: SopDocument;
}

export interface SopJsonExampleConfigResult {
  config: SopJsonExampleConfig;
  source: "custom" | "default";
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

function exampleParagraph(value: string, dir: "ltr" | "rtl"): JsonRecord {
  return { type: "paragraph", attrs: { dir }, content: [{ type: "text", text: value }] };
}

function exampleBilingualParagraph(arabic: string, english: string): JsonRecord[] {
  return [exampleParagraph(arabic, "rtl"), exampleParagraph(english, "ltr")];
}

function exampleBilingualList(arabicItems: string[], englishItems: string[], ordered = false): JsonRecord[] {
  const makeList = (items: string[], dir: "rtl" | "ltr"): JsonRecord => ({
    type: ordered ? "orderedList" : "bulletList",
    attrs: { dir, ...(ordered ? { start: 1 } : {}) },
    content: items.map((item) => ({
      type: "listItem",
      attrs: { dir },
      content: [exampleParagraph(item, dir)],
    })),
  });
  return [makeList(arabicItems, "rtl"), makeList(englishItems, "ltr")];
}

function exampleSectionContent(key: SopSectionKey): JsonRecord {
  switch (key) {
    case "purpose": return { type: "doc", content: exampleBilingualParagraph("يهدف هذا الإجراء إلى التحقق من هوية المريض وإتمام فحص سلامة الرنين المغناطيسي قبل الفحص.", "This procedure ensures patient identity is verified and MRI safety screening is completed before scanning.") };
    case "scope": return { type: "doc", content: exampleBilingualParagraph("يطبق هذا الإجراء على العاملين المشاركين في تجهيز مرضى الرنين المغناطيسي وفحصهم.", "This procedure applies to staff involved in MRI patient preparation and scanning.") };
    case "responsibilities": return { type: "doc", content: exampleBilingualList(["التحقق من معرفين للمريض.", "مراجعة إجابات فحص السلامة.", "إبلاغ مسؤول الرنين المغناطيسي عن أي مخاوف قبل بدء الفحص."], ["Confirm two patient identifiers.", "Review the safety screening responses.", "Escalate any concern to the MRI lead before scanning."]) };
    case "definitions": return { type: "doc", content: exampleBilingualParagraph("التصوير بالرنين المغناطيسي: تصوير تشخيصي يستخدم مجالاً مغناطيسياً وموجات راديوية.", "MRI: magnetic resonance imaging, a diagnostic technique using a magnetic field and radio waves.") };
    case "safety": return { type: "doc", content: exampleBilingualList(["لا تبدأ الفحص قبل استكمال نموذج السلامة ومراجعته.", "أبعد الأجسام المعدنية غير المصرح بها عن غرفة الفحص.", "أوقف الإجراء وصعّد أي إجابة أو حالة غير واضحة."], ["Do not scan until the safety form is complete and reviewed.", "Keep non-approved metal objects outside the scan room.", "Pause and escalate any unclear response or condition."]) };
    case "procedure": return { type: "doc", content: exampleBilingualList(["طابق هوية المريض باستخدام معرفين.", "راجع إجابات فحص السلامة مع المريض.", "وثق اكتمال التحقق والموافقة قبل بدء الفحص."], ["Match the patient using two identifiers.", "Review the safety screening responses with the patient.", "Document completion and clearance before scanning."], true) };
    case "documentation": return { type: "doc", content: exampleBilingualParagraph("سجل التحقق من الهوية وإكمال فحص السلامة في سير عمل نظام المعلومات الإشعاعية.", "Record identity verification and completed safety screening in the RIS workflow.") };
    case "references": return { type: "doc", content: exampleBilingualList(["سياسة السلامة المحلية للتصوير بالرنين المغناطيسي.", "نموذج فحص سلامة الرنين المغناطيسي المعتمد."], ["Local MRI safety policy.", "Current approved MRI safety screening form."]) };
  }
}

export function buildDefaultSopJsonExample(): SopJsonExampleConfig {
  const document = validateSopDocument({
    type: "sop",
    version: 1,
    sections: SOP_SECTION_DEFINITIONS.map((section) => ({ ...section, content: exampleSectionContent(section.key) })),
  }, true);
  return {
    code: "RAD-MRI-001",
    title: "MRI Patient Identification and Safety Screening",
    category: "MRI",
    version: "1.0",
    effectiveDate: "2026-10-01",
    changeSummary: "Initial issue",
    document,
  };
}

export function buildSopJsonExample(config: SopJsonExampleConfig = buildDefaultSopJsonExample()): SopJsonInterchangeV1 {
  return {
    format: SOP_JSON_FORMAT,
    formatVersion: SOP_JSON_FORMAT_VERSION,
    sop: { ...config, document: validateSopDocument(config.document, true) },
  };
}

const SOP_JSON_EXAMPLE_CATEGORY = "sops";
const SOP_JSON_EXAMPLE_SETTING_KEY = "json_example_v1";
const SOP_JSON_EXAMPLE_CONFIG_KEYS = ["code", "title", "category", "version", "effectiveDate", "changeSummary", "document"] as const;

function settingObject(value: unknown): JsonRecord | null {
  if (typeof value === "string") {
    try { return record(JSON.parse(value)); } catch { return null; }
  }
  return record(value);
}

export function validateSopJsonExampleConfig(value: unknown): SopJsonExampleConfig {
  const input = settingObject(value);
  if (!input || Object.keys(input).length !== SOP_JSON_EXAMPLE_CONFIG_KEYS.length || Object.keys(input).some((key) => !(SOP_JSON_EXAMPLE_CONFIG_KEYS as readonly string[]).includes(key))) {
    throw new HttpError(400, "JSON example must contain only the editable SOP metadata and document fields.");
  }
  const effectiveDate = normalizeSopDate(input.effectiveDate, "Effective date");
  if (effectiveDate === null || typeof input.effectiveDate !== "string") throw new HttpError(400, "Effective date is required.");
  if (new Date(`${effectiveDate}T00:00:00.000Z`).toISOString().slice(0, 10) !== effectiveDate) throw new HttpError(400, "Effective date must be a valid calendar date in YYYY-MM-DD format.");
  return {
    code: normalizeSopCode(input.code),
    title: requiredText(input.title, "Title"),
    category: normalizeSopCategory(input.category),
    version: normalizeSopVersion(input.version),
    effectiveDate,
    changeSummary: requiredText(input.changeSummary, "Change summary"),
    document: validateSopDocument(input.document, true),
  };
}

function exampleMetadata(value: unknown): JsonRecord {
  const input = settingObject(value);
  if (!input) return {};
  const metadata: JsonRecord = {};
  for (const key of ["code", "title", "category", "version", "effectiveDate"] as const) {
    if (typeof input[key] === "string") metadata[key] = input[key];
  }
  return metadata;
}

async function readSopJsonExampleSetting(executor: DbExecutor): Promise<unknown | null> {
  const result = await executor.query<{ setting_value: unknown }>(
    "select setting_value from system_settings where category = $1 and setting_key = $2 limit 1",
    [SOP_JSON_EXAMPLE_CATEGORY, SOP_JSON_EXAMPLE_SETTING_KEY],
  );
  return result.rows[0]?.setting_value ?? null;
}

export async function getSopJsonExampleConfig(role: string | undefined): Promise<SopJsonExampleConfigResult> {
  requireSopManagement(role);
  const saved = await readSopJsonExampleSetting(pool);
  return saved === null
    ? { config: buildDefaultSopJsonExample(), source: "default" }
    : { config: validateSopJsonExampleConfig(saved), source: "custom" };
}

function positiveActorId(value: unknown): number {
  const actorUserId = Number(value);
  if (!Number.isInteger(actorUserId) || actorUserId <= 0) throw new HttpError(400, "acting user must be a positive integer.");
  return actorUserId;
}

export async function updateSopJsonExampleConfig(value: unknown, actorUserIdValue: unknown, role: string | undefined): Promise<SopJsonExampleConfigResult> {
  requireSopManagement(role);
  const actorUserId = positiveActorId(actorUserIdValue);
  const config = validateSopJsonExampleConfig(value);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const previousValue = await readSopJsonExampleSetting(client);
    await client.query(
      `insert into system_settings (category, setting_key, setting_value, updated_by_user_id)
       values ($1, $2, $3::jsonb, $4)
       on conflict (category, setting_key)
       do update set setting_value = excluded.setting_value, updated_by_user_id = excluded.updated_by_user_id, updated_at = now()`,
      [SOP_JSON_EXAMPLE_CATEGORY, SOP_JSON_EXAMPLE_SETTING_KEY, JSON.stringify(config), actorUserId],
    );
    await logAuditEntry({ entityType: "sop_json_example", actionType: "sop_json_example_updated", oldValues: exampleMetadata(previousValue ?? buildDefaultSopJsonExample()), newValues: exampleMetadata(config), changedByUserId: actorUserId }, client);
    await client.query("commit");
    return { config, source: "custom" };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function resetSopJsonExampleConfig(actorUserIdValue: unknown, role: string | undefined): Promise<SopJsonExampleConfigResult> {
  requireSopManagement(role);
  const actorUserId = positiveActorId(actorUserIdValue);
  const defaultConfig = buildDefaultSopJsonExample();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const previousValue = await readSopJsonExampleSetting(client);
    await client.query(
      "delete from system_settings where category = $1 and setting_key = $2",
      [SOP_JSON_EXAMPLE_CATEGORY, SOP_JSON_EXAMPLE_SETTING_KEY],
    );
    await logAuditEntry({ entityType: "sop_json_example", actionType: "sop_json_example_reset", oldValues: exampleMetadata(previousValue ?? defaultConfig), newValues: exampleMetadata(defaultConfig), changedByUserId: actorUserId }, client);
    await client.query("commit");
    return { config: defaultConfig, source: "default" };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function exportSopJsonExample(): Promise<{ buffer: Buffer; filename: string }> {
  const saved = await readSopJsonExampleSetting(pool);
  const config = saved === null ? buildDefaultSopJsonExample() : validateSopJsonExampleConfig(saved);
  return { buffer: serializeSopJsonPayload(buildSopJsonExample(config)), filename: SOP_JSON_EXAMPLE_FILENAME };
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
  const client = await pool.connect(); try { await client.query("begin"); const sopId = positiveId(sopIdValue, "sopId"); await client.query("select id from sops where id=$1 for update", [sopId]); const target = await loadDraft(sopId, versionValue, client); if (timestamp(target.version.updatedAt) !== timestamp(expected)) throw new HttpError(409, "SOP draft changed after preview. Preview the import again."); const plan = preview(parsed, "draft_update", target); if (!plan.canConfirm) throw new HttpError(400, "SOP JSON import has validation errors.", plan); const imported = canonical(parsed); validateSopReviewDate(imported.sop.effectiveDate, target.version.nextReviewDate); const changedSectionKeys = plan.sections.filter((section) => section.action === "changed").map((section) => section.sectionKey); const changed = changedSectionKeys.length > 0 || plan.effectiveDate.changed || plan.changeSummary.changed || target.sop.title !== imported.sop.title || target.sop.category !== imported.sop.category; const result = changed ? await updateSopDraft({ sopId, version: target.version.version, title: imported.sop.title, category: imported.sop.category, contentJson: imported.sop.document, changeSummary: imported.sop.changeSummary, effectiveDate: imported.sop.effectiveDate, actorUserId }, client) : { sop: target.sop, version: target.version }; await logAuditEntry({ entityType: "sop", entityId: sopId, actionType: "sop_json_imported", newValues: { sop_id: sopId, sop_code: target.sop.code, format_version: SOP_JSON_FORMAT_VERSION, import_type: "draft_update", changed_section_keys: changedSectionKeys, source_version: imported.sop.version, target_version: target.version.version }, changedByUserId: actorUserId }, client); await client.query("commit"); return { ...result, summary: { importType: "draft_update", changedSectionKeys, sourceVersion: imported.sop.version, targetVersion: target.version.version } }; } catch (error) { await client.query("rollback").catch(() => undefined); throw error; } finally { client.release(); }
}

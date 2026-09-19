import { pool } from "../../db/pool.js";
import { logAuditEntry } from "../../services/audit-service.js";
import { buildWorkbookBuffer, parseWorksheet, readWorkbookFromBase64, type ParsedWorksheet } from "../../services/workbook-service.js";
import type { DbExecutor } from "../../types/db.js";
import { HttpError } from "../../utils/http-error.js";
import { SOP_SECTION_DEFINITIONS, type SopSectionKey } from "./constants.js";
import { requireSopManagement } from "./sop-service.js";
import { findSop, findSopVersion, updateSopDraft } from "./sop-repository.js";
import { normalizeSopCategory, normalizeSopCode, normalizeSopDate, normalizeSopVersion, validateSopDocument } from "./sop-validation.js";
import type { JsonRecord, SopDocument, SopSectionDocument, SopSummary, SopVersion } from "./types.js";

export const SOP_XLSX_SHEET = "SOP";
export const SOP_XLSX_FORMAT_VERSION = "1";
export const SOP_XLSX_COLUMNS = [
  "format_version",
  "sop_code",
  "title",
  "category",
  "source_version",
  "effective_date",
  "change_summary",
  "order",
  "section_key",
  "section_title",
  "required",
  "content",
] as const;
const MAX_XLSX_BYTES = 5 * 1024 * 1024;
const SOP_IDENTITY_COLUMNS = ["format_version", "sop_code", "title", "category", "source_version", "effective_date", "change_summary"] as const;
type SopXlsxColumn = (typeof SOP_XLSX_COLUMNS)[number];
type SopIdentityColumn = (typeof SOP_IDENTITY_COLUMNS)[number];
type ImportInput = { fileContentBase64: string; fileName?: string | null };

export interface SopXlsxSectionPreview {
  sectionKey: SopSectionKey;
  sectionTitle: string;
  action: "changed" | "unchanged" | "invalid";
  errors: string[];
  currentText: string;
  importedText: string;
}

export interface SopXlsxPreview {
  format: "xlsx";
  formatVersion: string | null;
  sheetName: string;
  columns: string[];
  missingColumns: string[];
  sectionCount: number;
  sopCode: string | null;
  title: string | null;
  category: string | null;
  sourceVersion: string | null;
  targetVersion: string;
  targetUpdatedAt: string;
  sections: SopXlsxSectionPreview[];
  effectiveDate: { current: string | null; imported: string | null; changed: boolean };
  changeSummary: { current: string; imported: string; changed: boolean };
  errors: string[];
  canConfirm: boolean;
}

export interface SopXlsxInspect {
  format: "xlsx";
  formatVersion: string | null;
  sheetName: string;
  columns: string[];
  missingColumns: string[];
  sectionCount: number;
  metadata: {
    sopCode: string | null;
    title: string | null;
    category: string | null;
    sourceVersion: string | null;
    effectiveDate: string | null;
    changeSummary: string | null;
  };
  structuralErrors: string[];
}

export interface SopXlsxConfirmResult {
  sop: SopSummary;
  version: SopVersion;
  summary: {
    changedSectionKeys: SopSectionKey[];
    effectiveDateChanged: boolean;
    changeSummaryChanged: boolean;
    sourceVersion: string;
    targetVersion: string;
  };
}

interface ParsedSopRow {
  rowNumber: number;
  values: Record<string, string>;
  sectionKey: string;
  sectionTitle: string;
  required: boolean | null;
  order: number | null;
  content: string;
  errors: string[];
}

interface ParsedSopWorkbook {
  columns: string[];
  rows: ParsedSopRow[];
  formatVersion: string | null;
  metadata: Record<SopIdentityColumn, string | null>;
  structuralErrors: string[];
  metadataErrors: string[];
}

interface SopImportTarget {
  sop: SopSummary;
  version: SopVersion;
}

interface SopImportPlan {
  parsed: ParsedSopWorkbook;
  preview: SopXlsxPreview;
  importedContent: Map<SopSectionKey, JsonRecord>;
}

function stringValue(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/[ \t]+$/g, "")).join("\n").replace(/^\n+|\n+$/g, "");
}

function canonicalTimestamp(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? String(value ?? "") : date.toISOString();
}

export function normalizeSopXlsxText(value: string): string {
  return normalizeText(String(value ?? ""));
}

function nodeText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const node = value as { type?: unknown; text?: unknown; content?: unknown };
  if (node.type === "hardBreak") return "\n";
  if (node.type === "tableRow") {
    return Array.isArray(node.content) ? node.content.map(nodeText).join("\t") : "";
  }
  if (node.type === "table") {
    return Array.isArray(node.content) ? node.content.map(nodeText).join("\n") : "";
  }
  return `${typeof node.text === "string" ? node.text : ""}${Array.isArray(node.content) ? node.content.map(nodeText).join("") : ""}`;
}

function listItemText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const node = value as { content?: unknown };
  return Array.isArray(node.content) ? node.content.map(nodeText).join("").trim() : "";
}

export function sopSectionContentToPlainText(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  const document = content as { content?: unknown };
  if (!Array.isArray(document.content)) return normalizeSopXlsxText(nodeText(content));
  const lines: string[] = [];
  for (const node of document.content) {
    if (!node || typeof node !== "object") continue;
    const typed = node as { type?: unknown; content?: unknown };
    if (typed.type === "bulletList" || typed.type === "orderedList") {
      const items = Array.isArray(typed.content) ? typed.content : [];
      items.forEach((item, index) => {
        const prefix = typed.type === "bulletList" ? "- " : `${index + 1}. `;
        lines.push(prefix + listItemText(item));
      });
      continue;
    }
    if (typed.type === "table") {
      const tableText = nodeText(node);
      if (tableText) lines.push(tableText);
      continue;
    }
    lines.push(nodeText(node).replace(/\n+$/g, ""));
  }
  return normalizeSopXlsxText(lines.join("\n"));
}

function paragraph(text: string): JsonRecord {
  const result: JsonRecord = { type: "paragraph", attrs: { dir: "auto" } };
  if (text) result.content = [{ type: "text", text }];
  return result;
}

function listItem(text: string): JsonRecord {
  return { type: "listItem", attrs: { dir: "auto" }, content: [paragraph(text)] };
}

export function sopPlainTextToContent(text: string): JsonRecord {
  const lines = normalizeSopXlsxText(text).split("\n");
  const content: JsonRecord[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line) {
      index += 1;
      continue;
    }
    const bullet = line.match(/^\s*(?:- |\* |• )(.*)$/);
    if (bullet) {
      const items: JsonRecord[] = [];
      while (index < lines.length) {
        const item = (lines[index] ?? "").match(/^\s*(?:- |\* |• )(.*)$/);
        if (!item) break;
        items.push(listItem(item[1] ?? ""));
        index += 1;
      }
      content.push({ type: "bulletList", attrs: { dir: "auto" }, content: items });
      continue;
    }
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ordered) {
      const items: JsonRecord[] = [];
      while (index < lines.length) {
        const item = (lines[index] ?? "").match(/^\s*\d+[.)]\s+(.*)$/);
        if (!item) break;
        items.push(listItem(item[1] ?? ""));
        index += 1;
      }
      content.push({ type: "orderedList", attrs: { dir: "auto", start: 1 }, content: items });
      continue;
    }
    content.push(paragraph(line));
    index += 1;
  }
  return { type: "doc", content: content.length ? content : [paragraph("")] };
}

function safeFilenamePart(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "sop";
}

function positiveId(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new HttpError(400, `${field} must be a positive integer.`);
  return parsed;
}

function checkFileInput(input: ImportInput): Buffer {
  if (input.fileName && !input.fileName.toLowerCase().endsWith(".xlsx")) throw new HttpError(400, "SOP import accepts XLSX files only.");
  const encoded = String(input.fileContentBase64 ?? "").trim();
  if (!encoded) throw new HttpError(400, "fileContentBase64 is required.");
  let buffer: Buffer;
  try {
    buffer = Buffer.from(encoded, "base64");
  } catch {
    throw new HttpError(400, "Workbook content is not valid base64.");
  }
  if (!buffer.length) throw new HttpError(400, "Workbook content is empty.");
  if (buffer.length > MAX_XLSX_BYTES) throw new HttpError(413, "SOP workbook exceeds the 5 MB limit.");
  return buffer;
}

async function readSopWorkbook(input: ImportInput): Promise<{ XLSX: typeof import("xlsx"); workbook: import("xlsx").WorkBook; parsed: ParsedSopWorkbook }> {
  checkFileInput(input);
  let workbookResult: Awaited<ReturnType<typeof readWorkbookFromBase64>>;
  try {
    workbookResult = await readWorkbookFromBase64(input.fileContentBase64);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Workbook could not be read as a valid XLSX file.");
  }
  const { XLSX, workbook, sheetNames } = workbookResult;
  if (!sheetNames.includes(SOP_XLSX_SHEET)) {
    return { XLSX, workbook, parsed: emptyParsedWorkbook([], ["Worksheet 'SOP' is required."]) };
  }
  try {
    const worksheet = workbook.Sheets[SOP_XLSX_SHEET];
    if (!worksheet) return { XLSX, workbook, parsed: emptyParsedWorkbook([], ["Worksheet 'SOP' is not readable."]) };
    return { XLSX, workbook, parsed: parseSopWorksheet(parseWorksheet(XLSX, worksheet, SOP_XLSX_SHEET)) };
  } catch {
    throw new HttpError(400, "Worksheet 'SOP' could not be read as valid SOP data.");
  }
}

function emptyParsedWorkbook(columns: string[], structuralErrors: string[]): ParsedSopWorkbook {
  return {
    columns,
    rows: [],
    formatVersion: null,
    metadata: { format_version: null, sop_code: null, title: null, category: null, source_version: null, effective_date: null, change_summary: null },
    structuralErrors,
    metadataErrors: [],
  };
}

function missingColumns(columns: string[]): string[] {
  return SOP_XLSX_COLUMNS.filter((column) => !columns.includes(column));
}

function parseBoolean(value: string): boolean | null {
  if (["true", "yes", "1"].includes(value.toLowerCase())) return true;
  if (["false", "no", "0"].includes(value.toLowerCase())) return false;
  return null;
}

function parseInteger(value: string): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function parseSopWorksheet(worksheet: ParsedWorksheet): ParsedSopWorkbook {
  const columns = worksheet.headers.map(stringValue);
  const structuralErrors = missingColumns(columns).map((column) => `SOP worksheet is missing required column '${column}'.`);
  if (worksheet.rows.length !== SOP_SECTION_DEFINITIONS.length) structuralErrors.push(`SOP worksheet must contain exactly eight section rows; found ${worksheet.rows.length}.`);
  const metadata: Record<SopIdentityColumn, string | null> = { format_version: null, sop_code: null, title: null, category: null, source_version: null, effective_date: null, change_summary: null };
  const metadataErrors: string[] = [];
  const firstRows = new Map<SopIdentityColumn, { value: string; rowNumber: number }>();
  for (const source of worksheet.rows) {
    for (const field of SOP_IDENTITY_COLUMNS) {
      const value = stringValue(source.values[field]);
      if (!value) continue;
      const existing = firstRows.get(field);
      if (existing && existing.value !== value) metadataErrors.push(`Conflicting ${field} values on rows ${existing.rowNumber} and ${source.rowNumber}.`);
      else if (!existing) firstRows.set(field, { value, rowNumber: source.rowNumber });
    }
  }
  for (const field of SOP_IDENTITY_COLUMNS) metadata[field] = firstRows.get(field)?.value ?? null;
  const formatVersion = metadata.format_version;
  if (!formatVersion) metadataErrors.push("format_version is required.");
  else if (formatVersion !== SOP_XLSX_FORMAT_VERSION) metadataErrors.push(`Unsupported workbook format version '${formatVersion}'. Expected ${SOP_XLSX_FORMAT_VERSION}.`);
  for (const field of ["sop_code", "title", "category", "source_version"] as const) if (!metadata[field]) metadataErrors.push(`${field} is required.`);
  const rows: ParsedSopRow[] = worksheet.rows.map((source) => {
    const values = Object.fromEntries(Object.entries(source.values).map(([key, value]) => [stringValue(key), stringValue(value)]));
    const errors: string[] = [];
    const orderText = values.order ?? "";
    const order = parseInteger(orderText);
    const requiredText = values.required ?? "";
    const required = parseBoolean(requiredText);
    const row: ParsedSopRow = {
      rowNumber: source.rowNumber,
      values,
      sectionKey: values.section_key ?? "",
      sectionTitle: values.section_title ?? "",
      required,
      order,
      content: values.content ?? "",
      errors,
    };
    if (!orderText || order === null) errors.push("order must be an integer.");
    if (!row.sectionKey) errors.push("section_key is required.");
    if (!row.sectionTitle) errors.push("section_title is required.");
    if (!requiredText || required === null) errors.push("required must be true or false.");
    return row;
  });
  const seenKeys = new Set<string>();
  rows.forEach((row, index) => {
    const definition = SOP_SECTION_DEFINITIONS[index];
    if (row.sectionKey && seenKeys.has(row.sectionKey)) row.errors.push(`Duplicate section_key '${row.sectionKey}'.`);
    if (row.sectionKey) seenKeys.add(row.sectionKey);
    if (definition && row.order !== index + 1) row.errors.push(`Canonical section order must be ${index + 1}.`);
    if (definition && row.sectionKey !== definition.key) row.errors.push(`Expected section_key '${definition.key}'.`);
    if (definition && row.sectionTitle !== definition.title) row.errors.push(`Expected section_title '${definition.title}'.`);
    if (definition && row.required !== definition.required) row.errors.push(`Section '${definition.key}' required must be ${definition.required}.`);
    if (definition?.required && !normalizeSopXlsxText(row.content)) row.errors.push(`Required section '${definition.key}' cannot be blank.`);
  });
  for (const definition of SOP_SECTION_DEFINITIONS) if (!seenKeys.has(definition.key)) structuralErrors.push(`Required canonical section '${definition.key}' is missing.`);
  const unknownKeys = [...seenKeys].filter((key) => !(SOP_SECTION_DEFINITIONS as readonly { key: string }[]).some((definition) => definition.key === key));
  unknownKeys.forEach((key) => structuralErrors.push(`Unknown section_key '${key}'.`));
  return { columns, rows, formatVersion, metadata, structuralErrors, metadataErrors: [...new Set(metadataErrors)] };
}

function normalizeIdentityMetadata(parsed: ParsedSopWorkbook, target: SopSummary): { errors: string[]; sourceVersion: string; effectiveDate: string | null; changeSummary: string } {
  const errors = [...parsed.structuralErrors, ...parsed.metadataErrors];
  let sourceVersion = parsed.metadata.source_version ?? "";
  if (sourceVersion) {
    try { sourceVersion = normalizeSopVersion(sourceVersion); } catch { errors.push("source_version must use the form 1.0."); }
  }
  if (parsed.metadata.sop_code) {
    try {
      if (normalizeSopCode(parsed.metadata.sop_code) !== target.code) errors.push("SOP code does not match this SOP.");
    } catch { errors.push("sop_code is invalid."); }
  }
  if (parsed.metadata.title && parsed.metadata.title !== target.title) errors.push("Title does not match this SOP.");
  if (parsed.metadata.category) {
    try {
      if (normalizeSopCategory(parsed.metadata.category) !== target.category) errors.push("Category does not match this SOP.");
    } catch { errors.push("category is invalid."); }
  }
  let effectiveDate: string | null = null;
  if (parsed.metadata.effective_date) {
    try { effectiveDate = normalizeSopDate(parsed.metadata.effective_date); } catch { errors.push("effective_date must use YYYY-MM-DD."); }
  }
  return { errors: [...new Set(errors)], sourceVersion, effectiveDate, changeSummary: parsed.metadata.change_summary ?? "" };
}

function sectionRow(parsed: ParsedSopWorkbook, key: SopSectionKey): ParsedSopRow | undefined {
  return parsed.rows.find((row) => row.sectionKey === key);
}

function buildPlan(parsed: ParsedSopWorkbook, target: SopImportTarget): SopImportPlan {
  const metadata = normalizeIdentityMetadata(parsed, target.sop);
  const importedContent = new Map<SopSectionKey, JsonRecord>();
  const sections: SopXlsxSectionPreview[] = target.version.contentJson.sections.map((section: SopSectionDocument) => {
    const row = sectionRow(parsed, section.key);
    const currentText = sopSectionContentToPlainText(section.content);
    const importedText = normalizeSopXlsxText(row?.content ?? "");
    const errors = row?.errors ? [...row.errors] : [`Section '${section.key}' is missing from the workbook.`];
    const action: SopXlsxSectionPreview["action"] = errors.length || metadata.errors.length ? "invalid" : normalizeSopXlsxText(currentText) === importedText ? "unchanged" : "changed";
    if (action === "changed") importedContent.set(section.key, sopPlainTextToContent(importedText));
    return { sectionKey: section.key, sectionTitle: section.title, action, errors, currentText, importedText };
  });
  const currentDate = target.version.effectiveDate;
  const effectiveDateChanged = currentDate !== metadata.effectiveDate;
  const changeSummaryChanged = target.version.changeSummary !== metadata.changeSummary;
  const errors = [...new Set(metadata.errors)];
  return {
    parsed,
    importedContent,
    preview: {
      format: "xlsx",
      formatVersion: parsed.formatVersion,
      sheetName: SOP_XLSX_SHEET,
      columns: parsed.columns,
      missingColumns: missingColumns(parsed.columns),
      sectionCount: parsed.rows.length,
      sopCode: parsed.metadata.sop_code,
      title: parsed.metadata.title,
      category: parsed.metadata.category,
      sourceVersion: metadata.sourceVersion || parsed.metadata.source_version,
      targetVersion: target.version.version,
      targetUpdatedAt: canonicalTimestamp(target.version.updatedAt),
      sections,
      effectiveDate: { current: currentDate, imported: metadata.effectiveDate, changed: effectiveDateChanged },
      changeSummary: { current: target.version.changeSummary, imported: metadata.changeSummary, changed: changeSummaryChanged },
      errors,
      canConfirm: errors.length === 0 && sections.every((section) => section.action !== "invalid"),
    },
  };
}

async function loadImportTarget(sopIdValue: unknown, versionValue: unknown, executor: DbExecutor = pool): Promise<SopImportTarget> {
  const sopId = positiveId(sopIdValue, "sopId");
  const version = normalizeSopVersion(versionValue);
  const sop = await findSop(sopId, executor);
  if (!sop) throw new HttpError(404, "SOP not found.");
  if (sop.status === "archived") throw new HttpError(409, "Archived SOPs cannot accept Excel imports.");
  const draft = await findSopVersion(sopId, version, true, executor);
  if (!draft || draft.status !== "draft") throw new HttpError(409, "Excel imports can only target an editable draft version. Create a new revision first.");
  return { sop, version: draft };
}

export async function exportSopVersionXlsx(sopIdValue: unknown, versionValue: unknown, role: string | undefined): Promise<{ buffer: Buffer; filename: string }> {
  const sopId = positiveId(sopIdValue, "sopId");
  const version = normalizeSopVersion(versionValue);
  const sop = await findSop(sopId);
  if (!sop) throw new HttpError(404, "SOP not found.");
  const source = await (async () => {
    if (!role) throw new HttpError(401, "Authentication required.");
    const management = role === "supervisor" || role === "super_admin";
    const found = await findSopVersion(sopId, version, management);
    if (!found) throw new HttpError(404, "SOP version not found.");
    if (!management && sop.status !== "published") throw new HttpError(404, "SOP version not found.");
    return found;
  })();
  const rows = source.contentJson.sections.map((section, index) => ({
    format_version: index === 0 ? SOP_XLSX_FORMAT_VERSION : "",
    sop_code: index === 0 ? sop.code : "",
    title: index === 0 ? sop.title : "",
    category: index === 0 ? sop.category : "",
    source_version: index === 0 ? source.version : "",
    effective_date: index === 0 ? source.effectiveDate ?? "" : "",
    change_summary: index === 0 ? source.changeSummary : "",
    order: index + 1,
    section_key: section.key,
    section_title: section.title,
    required: section.required,
    content: sopSectionContentToPlainText(section.content),
  }));
  return {
    buffer: await buildWorkbookBuffer([{ name: SOP_XLSX_SHEET, headers: [...SOP_XLSX_COLUMNS], rows }]),
    filename: `${safeFilenamePart(sop.code)}-v${safeFilenamePart(source.version)}.xlsx`,
  };
}

export async function inspectSopXlsxImport(sopIdValue: unknown, versionValue: unknown, input: ImportInput, role: string | undefined): Promise<SopXlsxInspect> {
  requireSopManagement(role);
  const target = await loadImportTarget(sopIdValue, versionValue);
  const { parsed } = await readSopWorkbook(input);
  const identity = normalizeIdentityMetadata(parsed, target.sop);
  return {
    format: "xlsx",
    formatVersion: parsed.formatVersion,
    sheetName: SOP_XLSX_SHEET,
    columns: parsed.columns,
    missingColumns: missingColumns(parsed.columns),
    sectionCount: parsed.rows.length,
    metadata: {
      sopCode: parsed.metadata.sop_code,
      title: parsed.metadata.title,
      category: parsed.metadata.category,
      sourceVersion: parsed.metadata.source_version,
      effectiveDate: parsed.metadata.effective_date,
      changeSummary: parsed.metadata.change_summary,
    },
    structuralErrors: [...new Set([...identity.errors])],
  };
}

export async function previewSopXlsxImport(sopIdValue: unknown, versionValue: unknown, input: ImportInput, role: string | undefined): Promise<SopXlsxPreview> {
  requireSopManagement(role);
  const target = await loadImportTarget(sopIdValue, versionValue);
  const { parsed } = await readSopWorkbook(input);
  return buildPlan(parsed, target).preview;
}

export async function confirmSopXlsxImport(
  sopIdValue: unknown,
  versionValue: unknown,
  input: ImportInput & { expectedDraftUpdatedAt?: string | null },
  actorUserIdValue: unknown,
  role: string | undefined,
): Promise<SopXlsxConfirmResult> {
  requireSopManagement(role);
  const actorUserId = positiveId(actorUserIdValue, "acting user");
  const expectedUpdatedAt = String(input.expectedDraftUpdatedAt ?? "").trim();
  if (!expectedUpdatedAt) throw new HttpError(400, "expectedDraftUpdatedAt is required.");
  const { parsed } = await readSopWorkbook(input);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const sopId = positiveId(sopIdValue, "sopId");
    await client.query("select id from sops where id=$1 for update", [sopId]);
    const target = await loadImportTarget(sopId, versionValue, client);
    if (canonicalTimestamp(target.version.updatedAt) !== canonicalTimestamp(expectedUpdatedAt)) throw new HttpError(409, "This SOP draft changed after the Excel preview. Preview the workbook again before importing.");
    const plan = buildPlan(parsed, target);
    if (!plan.preview.canConfirm) throw new HttpError(400, "SOP Excel import has validation errors.", plan.preview);
    const changedSectionKeys = plan.preview.sections.filter((section) => section.action === "changed").map((section) => section.sectionKey);
    const effectiveDate = plan.preview.effectiveDate.imported;
    const changeSummary = plan.preview.changeSummary.imported;
    const metadataChanged = plan.preview.effectiveDate.changed || plan.preview.changeSummary.changed;
    let result: { sop: SopSummary; version: SopVersion } = { sop: target.sop, version: target.version };
    if (changedSectionKeys.length || metadataChanged) {
      const contentJson: SopDocument = validateSopDocument({
        ...target.version.contentJson,
        sections: target.version.contentJson.sections.map((section) => {
          const imported = plan.importedContent.get(section.key);
          return imported ? { ...section, content: imported } : section;
        }),
      });
      result = await updateSopDraft({ sopId, version: target.version.version, title: target.sop.title, category: target.sop.category, contentJson, changeSummary, effectiveDate, actorUserId }, client);
    }
    await logAuditEntry({
      entityType: "sop",
      entityId: sopId,
      actionType: "sop_xlsx_imported",
      newValues: {
        sop_id: sopId,
        sop_code: target.sop.code,
        source_version: plan.preview.sourceVersion,
        target_version: target.version.version,
        changed_section_keys: changedSectionKeys,
        effective_date_changed: plan.preview.effectiveDate.changed,
        change_summary_changed: plan.preview.changeSummary.changed,
      },
      changedByUserId: actorUserId,
    }, client);
    await client.query("commit");
    return {
      ...result,
      summary: {
        changedSectionKeys,
        effectiveDateChanged: plan.preview.effectiveDate.changed,
        changeSummaryChanged: plan.preview.changeSummary.changed,
        sourceVersion: plan.preview.sourceVersion ?? "",
        targetVersion: target.version.version,
      },
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

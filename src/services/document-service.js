import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { getTripoliToday } from "../utils/date.js";
import { logAuditEntry } from "./audit-service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..");

function normalizePositiveInteger(value, fieldName, { required = true } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) {
      throw new HttpError(400, `${fieldName} is required.`);
    }

    return null;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, `${fieldName} must be a positive whole number.`);
  }

  return parsed;
}

function sanitizeFileName(fileName) {
  const cleaned = String(fileName || "document")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_");

  return cleaned || "document";
}

function decodeBase64File(fileContentBase64) {
  const raw = String(fileContentBase64 || "").trim();

  if (!raw) {
    throw new HttpError(400, "fileContentBase64 is required.");
  }

  const normalized = raw.includes(",") ? raw.split(",").pop() : raw;
  return Buffer.from(normalized, "base64");
}

function resolveStoredPath(storedPath) {
  const absolutePath = path.resolve(rootDir, storedPath || "");

  if (!absolutePath.startsWith(rootDir)) {
    throw new HttpError(400, "Invalid document path.");
  }

  return absolutePath;
}

async function ensureRelatedRecords(patientId, appointmentId) {
  if (!patientId && !appointmentId) {
    throw new HttpError(400, "patientId or appointmentId is required.");
  }

  if (patientId) {
    const { rowCount } = await pool.query("select 1 from patients where id = $1 limit 1", [patientId]);

    if (!rowCount) {
      throw new HttpError(404, "Patient not found.");
    }
  }

  if (appointmentId) {
    const { rowCount } = await pool.query("select 1 from appointments where id = $1 limit 1", [appointmentId]);

    if (!rowCount) {
      throw new HttpError(404, "Appointment not found.");
    }
  }
}

export async function listDocuments(filters = {}) {
  const params = [];
  const conditions = [];

  if (filters.patientId) {
    params.push(normalizePositiveInteger(filters.patientId, "patientId"));
    conditions.push(`patient_id = $${params.length}`);
  }

  if (filters.appointmentId) {
    params.push(normalizePositiveInteger(filters.appointmentId, "appointmentId"));
    conditions.push(`appointment_id = $${params.length}`);
  }

  const whereClause = conditions.length ? `where ${conditions.join(" and ")}` : "";
  const { rows } = await pool.query(
    `
      select id, patient_id, appointment_id, document_type, original_filename, stored_path, mime_type, file_size, created_at
      from documents
      ${whereClause}
      order by created_at desc
      limit 50
    `,
    params
  );

  return rows;
}

export async function getDocumentById(documentId) {
  const cleanDocumentId = normalizePositiveInteger(documentId, "documentId");
  const { rows } = await pool.query(
    `
      select id, patient_id, appointment_id, document_type, original_filename, stored_path, mime_type, file_size, created_at
      from documents
      where id = $1
      limit 1
    `,
    [cleanDocumentId]
  );

  if (!rows[0]) {
    throw new HttpError(404, "Document not found.");
  }

  return rows[0];
}

export function getDocumentAbsolutePath(document) {
  return resolveStoredPath(document.stored_path);
}

export async function uploadDocument(payload, currentUserId) {
  const patientId = normalizePositiveInteger(payload.patientId, "patientId", { required: false });
  const appointmentId = normalizePositiveInteger(payload.appointmentId, "appointmentId", { required: false });
  const documentType = String(payload.documentType || "referral_request").trim();
  const originalFilename = sanitizeFileName(payload.originalFilename || "document.bin");
  const mimeType = String(payload.mimeType || "application/octet-stream").trim();
  const fileBuffer = decodeBase64File(payload.fileContentBase64);

  if (fileBuffer.length === 0) {
    throw new HttpError(400, "Uploaded file is empty.");
  }

  await ensureRelatedRecords(patientId, appointmentId);

  const dateFolder = getTripoliToday();
  const targetDirectory = path.join(rootDir, env.uploadsDir, dateFolder);
  await fs.mkdir(targetDirectory, { recursive: true });

  const storedFileName = `${Date.now()}-${originalFilename}`;
  const absoluteStoredPath = path.join(targetDirectory, storedFileName);
  await fs.writeFile(absoluteStoredPath, fileBuffer);

  const relativeStoredPath = path.relative(rootDir, absoluteStoredPath);
  const { rows } = await pool.query(
    `
      insert into documents (
        patient_id,
        appointment_id,
        document_type,
        original_filename,
        stored_path,
        mime_type,
        file_size,
        uploaded_by_user_id
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8)
      returning id, patient_id, appointment_id, document_type, original_filename, stored_path, mime_type, file_size, created_at
    `,
    [patientId, appointmentId, documentType, originalFilename, relativeStoredPath, mimeType, fileBuffer.length, currentUserId]
  );

  await logAuditEntry({
    entityType: "document",
    entityId: rows[0].id,
    actionType: "upload",
    oldValues: null,
    newValues: rows[0],
    changedByUserId: currentUserId
  });

  return rows[0];
}

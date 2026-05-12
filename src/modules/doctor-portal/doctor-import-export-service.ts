import bcrypt from "bcryptjs";
import { pool } from "../../db/pool.js";
import { isRole } from "../../constants/roles.js";
import { HttpError } from "../../utils/http-error.js";
import type { Role } from "../../types/domain.js";
import type { UserId } from "../../types/http.js";
import { insertDoctorAuditEvent } from "./profile-repository.js";
import type { DoctorRole } from "./profile-repository.js";

const EXPORT_COLUMNS = [
  "username",
  "full_name",
  "core_role",
  "user_active",
  "doctor_profile_id",
  "doctor_profile_active",
  "doctor_role",
  "can_finalize_reports",
  "can_assign_protocols",
  "can_supervise",
  "modalities_protocol",
  "modalities_report",
  "modalities_supervise",
];

const IMPORT_COLUMNS = [
  "username",
  "full_name",
  "temporary_password",
  "core_role",
  "user_active",
  "doctor_role",
  "doctor_profile_active",
  "can_finalize_reports",
  "can_assign_protocols",
  "can_supervise",
  "modalities_protocol",
  "modalities_report",
  "modalities_supervise",
  "reset_password",
];

const DOCTOR_ROLES = new Set<DoctorRole>(["consultant", "specialist", "senior_house_officer", "resident"]);

interface ImportRow {
  rowNumber: number;
  values: Record<string, string>;
}

interface PreviewRow extends ImportRow {
  action: "create" | "update" | "invalid";
  errors: string[];
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && quoted && line[i + 1] === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseCsv(content: string): { headers: string[]; rows: ImportRow[] } {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) throw new HttpError(400, "CSV file is empty.");
  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  const rows = lines.slice(1).map((line, index) => {
    const cells = parseCsvLine(line);
    const values: Record<string, string> = {};
    headers.forEach((header, cellIndex) => {
      values[header] = cells[cellIndex] ?? "";
    });
    return { rowNumber: index + 2, values };
  });
  return { headers, rows };
}

function decodeBase64Csv(fileContentBase64: string): string {
  return Buffer.from(fileContentBase64, "base64").toString("utf8");
}

function boolValue(value: string, fallback: boolean): boolean {
  const clean = String(value ?? "").trim().toLowerCase();
  if (!clean) return fallback;
  if (["true", "1", "yes", "y"].includes(clean)) return true;
  if (["false", "0", "no", "n"].includes(clean)) return false;
  throw new Error(`Invalid boolean '${value}'.`);
}

function splitCodes(value: string): string[] {
  return String(value ?? "")
    .split(/[;,|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function modalityCodeMap() {
  const result = await pool.query<{ id: number; code: string }>(`select id, code from modalities where is_active = true`);
  return new Map(result.rows.map((row) => [String(row.code).toLowerCase(), Number(row.id)]));
}

export async function exportDoctorProfilesCsv(): Promise<{ csv: string; filename: string }> {
  const result = await pool.query<Record<string, unknown>>(
    `
      select
        u.username,
        u.full_name,
        u.role as core_role,
        u.is_active as user_active,
        dp.id as doctor_profile_id,
        dp.active as doctor_profile_active,
        dp.doctor_role,
        dp.can_finalize_reports,
        dp.can_assign_protocols,
        dp.can_supervise,
        coalesce(string_agg(distinct mp.code, ';') filter (where dmp.can_protocol and dmp.active), '') as modalities_protocol,
        coalesce(string_agg(distinct mr.code, ';') filter (where dmp.can_report and dmp.active), '') as modalities_report,
        coalesce(string_agg(distinct ms.code, ';') filter (where dmp.can_supervise and dmp.active), '') as modalities_supervise
      from doctor_portal.doctor_profiles dp
      join users u on u.id = dp.user_id
      left join doctor_portal.doctor_modality_permissions dmp on dmp.doctor_id = dp.id
      left join modalities mp on mp.id = dmp.modality_id
      left join modalities mr on mr.id = dmp.modality_id
      left join modalities ms on ms.id = dmp.modality_id
      group by u.username, u.full_name, u.role, u.is_active, dp.id
      order by dp.active desc, dp.display_name asc
    `
  );
  const csv = [EXPORT_COLUMNS.join(","), ...result.rows.map((row) => EXPORT_COLUMNS.map((column) => csvCell(row[column])).join(","))].join("\n");
  return { csv, filename: "rispro-doctors.csv" };
}

export function inspectDoctorImportCsv(fileContentBase64: string) {
  const { headers, rows } = parseCsv(decodeBase64Csv(fileContentBase64));
  return {
    columns: headers,
    requiredColumns: IMPORT_COLUMNS,
    rowCount: rows.length,
    missingColumns: IMPORT_COLUMNS.filter((column) => !headers.includes(column) && column !== "reset_password"),
  };
}

export async function previewDoctorImportCsv(fileContentBase64: string): Promise<{ rows: PreviewRow[]; canConfirm: boolean }> {
  const parsed = parseCsv(decodeBase64Csv(fileContentBase64));
  const modalityMap = await modalityCodeMap();
  const seen = new Set<string>();
  const usernames = parsed.rows.map((row) => row.values.username?.trim()).filter(Boolean);
  const existing = await pool.query<{ username: string }>(`select username from users where username = any($1::text[])`, [usernames]);
  const existingUsernames = new Set(existing.rows.map((row) => row.username));

  const rows = parsed.rows.map((row): PreviewRow => {
    const errors: string[] = [];
    const username = row.values.username?.trim();
    const coreRole = row.values.core_role?.trim();
    const doctorRole = row.values.doctor_role?.trim();
    if (!username) errors.push("username is required");
    if (username && seen.has(username.toLowerCase())) errors.push("duplicate username in workbook");
    if (username) seen.add(username.toLowerCase());
    if (!row.values.full_name?.trim()) errors.push("full_name is required");
    if (!coreRole || !isRole(coreRole)) errors.push("invalid core_role");
    if (!doctorRole || !DOCTOR_ROLES.has(doctorRole as DoctorRole)) errors.push("invalid doctor_role");
    if (!existingUsernames.has(username) && !row.values.temporary_password?.trim()) errors.push("temporary_password is required for new users");
    for (const column of ["modalities_protocol", "modalities_report", "modalities_supervise"]) {
      for (const code of splitCodes(row.values[column])) {
        if (!modalityMap.has(code.toLowerCase())) errors.push(`invalid modality '${code}' in ${column}`);
      }
    }
    try {
      ["user_active", "doctor_profile_active", "can_finalize_reports", "can_assign_protocols", "can_supervise", "reset_password"].forEach((column) => {
        if (row.values[column]) boolValue(row.values[column], false);
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "invalid boolean");
    }
    return { ...row, action: errors.length ? "invalid" : existingUsernames.has(username) ? "update" : "create", errors };
  });

  return { rows, canConfirm: rows.every((row) => row.errors.length === 0) };
}

export async function confirmDoctorImportCsv(fileContentBase64: string, actorUserId: UserId) {
  const preview = await previewDoctorImportCsv(fileContentBase64);
  if (!preview.canConfirm) throw new HttpError(400, "Doctor import has validation errors.", { rows: preview.rows });
  const modalityMap = await modalityCodeMap();
  const summary = {
    createdUsers: 0,
    updatedUsers: 0,
    createdProfiles: 0,
    updatedProfiles: 0,
    disabledProfiles: 0,
    modalityPermissionsUpdated: 0,
    skippedRows: 0,
    failedRows: [] as Array<{ rowNumber: number; reason: string }>,
  };

  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const row of preview.rows) {
      const values = row.values;
      const username = values.username.trim();
      const existing = await client.query<{ id: number }>(`select id from users where username = $1 limit 1`, [username]);
      let userId = existing.rows[0]?.id;
      const resetPassword = boolValue(values.reset_password, false);
      if (!userId) {
        const passwordHash = await bcrypt.hash(values.temporary_password, 10);
        const inserted = await client.query<{ id: number }>(
          `
            insert into users (username, full_name, password_hash, role, is_active, must_change_password)
            values ($1, $2, $3, $4, $5, true)
            returning id
          `,
          [username, values.full_name, passwordHash, values.core_role as Role, boolValue(values.user_active, true)]
        );
        userId = inserted.rows[0].id;
        summary.createdUsers += 1;
      } else {
        if (resetPassword && values.temporary_password) {
          const passwordHash = await bcrypt.hash(values.temporary_password, 10);
          await client.query(
            `update users set full_name = $2, role = $3, is_active = $4, password_hash = $5, must_change_password = true, updated_at = now() where id = $1`,
            [userId, values.full_name, values.core_role, boolValue(values.user_active, true), passwordHash]
          );
        } else {
          await client.query(
            `update users set full_name = $2, role = $3, is_active = $4, updated_at = now() where id = $1`,
            [userId, values.full_name, values.core_role, boolValue(values.user_active, true)]
          );
        }
        summary.updatedUsers += 1;
      }

      const profile = await client.query<{ id: number; active: boolean }>(`select id, active from doctor_portal.doctor_profiles where user_id = $1`, [userId]);
      let profileId = profile.rows[0]?.id;
      const profileActive = boolValue(values.doctor_profile_active, true);
      if (!profileId) {
        const inserted = await client.query<{ id: number }>(
          `
            insert into doctor_portal.doctor_profiles (
              user_id, display_name, doctor_role, active, can_finalize_reports, can_assign_protocols, can_supervise
            )
            values ($1, $2, $3, $4, $5, $6, $7)
            returning id
          `,
          [
            userId,
            values.full_name,
            values.doctor_role,
            profileActive,
            boolValue(values.can_finalize_reports, false),
            boolValue(values.can_assign_protocols, false),
            boolValue(values.can_supervise, false),
          ]
        );
        profileId = inserted.rows[0].id;
        summary.createdProfiles += 1;
      } else {
        await client.query(
          `
            update doctor_portal.doctor_profiles
            set display_name = $2, doctor_role = $3, active = $4,
                can_finalize_reports = $5, can_assign_protocols = $6, can_supervise = $7, updated_at = now()
            where id = $1
          `,
          [
            profileId,
            values.full_name,
            values.doctor_role,
            profileActive,
            boolValue(values.can_finalize_reports, false),
            boolValue(values.can_assign_protocols, false),
            boolValue(values.can_supervise, false),
          ]
        );
        summary.updatedProfiles += 1;
        if (!profileActive && profile.rows[0].active) summary.disabledProfiles += 1;
      }

      const modalityPermissions = new Map<number, { canProtocol: boolean; canReport: boolean; canSupervise: boolean }>();
      for (const [column, key] of [
        ["modalities_protocol", "canProtocol"],
        ["modalities_report", "canReport"],
        ["modalities_supervise", "canSupervise"],
      ] as const) {
        for (const code of splitCodes(values[column])) {
          const modalityId = modalityMap.get(code.toLowerCase())!;
          const current = modalityPermissions.get(modalityId) ?? { canProtocol: false, canReport: false, canSupervise: false };
          current[key] = true;
          modalityPermissions.set(modalityId, current);
        }
      }
      for (const [modalityId, permission] of modalityPermissions) {
        await client.query(
          `
            insert into doctor_portal.doctor_modality_permissions (doctor_id, modality_id, can_protocol, can_report, can_supervise, active)
            values ($1, $2, $3, $4, $5, true)
            on conflict (doctor_id, modality_id)
            do update set can_protocol = excluded.can_protocol, can_report = excluded.can_report,
              can_supervise = excluded.can_supervise, active = true, updated_at = now()
          `,
          [profileId, modalityId, permission.canProtocol, permission.canReport, permission.canSupervise]
        );
        summary.modalityPermissionsUpdated += 1;
      }
    }
    await insertDoctorAuditEvent(client, {
      actorUserId,
      actorDoctorId: null,
      eventType: "doctor_import_confirmed",
      targetType: "doctor_import",
      targetId: null,
      metadata: summary,
      reason: null,
    });
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  return summary;
}

export function doctorImportTemplateCsv(): string {
  return IMPORT_COLUMNS.join(",") + "\n";
}

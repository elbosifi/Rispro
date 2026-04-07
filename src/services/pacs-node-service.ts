import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { requireRow } from "../utils/records.js";
import { normalizeOptionalText, normalizePositiveInteger } from "../utils/normalize.js";
import { logAuditEntry } from "./audit-service.js";
import type { UserId, UnknownRecord } from "../types/http.js";
import type { DbNumeric } from "../types/db.js";

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

export interface PacsNodeRow {
  id: number;
  name: string;
  host: string;
  port: DbNumeric;
  called_ae_title: string;
  calling_ae_title: string;
  timeout_seconds: DbNumeric;
  is_active: boolean;
  is_default: boolean;
  created_by_user_id: number | null;
  updated_by_user_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface PacsNodeListRow extends PacsNodeRow {
  last_tested_at: string | null;
  last_test_status: string | null;
}

export interface PacsNodeCreatePayload {
  name?: unknown;
  host?: unknown;
  port?: unknown;
  calledAeTitle?: unknown;
  callingAeTitle?: unknown;
  timeoutSeconds?: unknown;
  isActive?: unknown;
  isDefault?: unknown;
}

export interface PacsNodeUpdatePayload extends PacsNodeCreatePayload {}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function listPacsNodes({ includeInactive = false }: { includeInactive?: boolean } = {}): Promise<PacsNodeListRow[]> {
  const params: unknown[] = [];
  let whereSql = "";

  if (!includeInactive) {
    whereSql = "where pacs_nodes.is_active = true";
  }

  const { rows } = await pool.query(
    `
      select
        pacs_nodes.*,
        null::timestamptz as last_tested_at,
        null::text as last_test_status
      from pacs_nodes
      ${whereSql}
      order by pacs_nodes.is_default desc, pacs_nodes.name asc
    `,
    params
  );

  return rows as PacsNodeListRow[];
}

export async function getPacsNode(nodeId: number | string): Promise<PacsNodeRow> {
  const cleanId = normalizePositiveInteger(nodeId, "nodeId");
  const { rows } = await pool.query(
    `
      select *
      from pacs_nodes
      where id = $1
      limit 1
    `,
    [cleanId]
  );

  return requireRow(rows[0] as PacsNodeRow | undefined, "PACS node not found.");
}

export async function getDefaultPacsNode(): Promise<PacsNodeRow | null> {
  const { rows } = await pool.query(
    `
      select *
      from pacs_nodes
      where is_default = true
        and is_active = true
      limit 1
    `
  );

  return (rows[0] as PacsNodeRow) || null;
}

export async function createPacsNode(
  payload: UnknownRecord,
  currentUserId: UserId
): Promise<PacsNodeRow> {
  const name = normalizeOptionalText(payload.name);
  const host = normalizeOptionalText(payload.host);
  const port = normalizePositiveInteger(payload.port, "port");
  const calledAeTitle = normalizeOptionalText(payload.calledAeTitle)?.toUpperCase() || "PACS";
  const callingAeTitle = normalizeOptionalText(payload.callingAeTitle)?.toUpperCase() || "RISPRO";
  const timeoutSeconds = normalizePositiveInteger(payload.timeoutSeconds, "timeoutSeconds") || 10;
  const isActive = String(payload.isActive ?? "enabled").trim().toLowerCase() !== "disabled";
  const isDefault = String(payload.isDefault ?? "disabled").trim().toLowerCase() !== "disabled";

  if (!name) {
    throw new HttpError(400, "PACS node name is required.");
  }

  if (!host) {
    throw new HttpError(400, "PACS node host is required.");
  }

  const client = await pool.connect();

  try {
    await client.query("begin");

    // If this is the first node or marked as default, unset other defaults
    if (isDefault) {
      await client.query("update pacs_nodes set is_default = false");
    }

    const { rows } = await client.query(
      `
        insert into pacs_nodes (
          name,
          host,
          port,
          called_ae_title,
          calling_ae_title,
          timeout_seconds,
          is_active,
          is_default,
          created_by_user_id,
          updated_by_user_id
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
        returning *
      `,
      [name, host, port, calledAeTitle, callingAeTitle, timeoutSeconds, isActive, isDefault, currentUserId]
    );

    const createdNode = requireRow(rows[0] as PacsNodeRow | undefined, "Failed to create PACS node.");

    await logAuditEntry(
      {
        entityType: "pacs_node",
        entityId: createdNode.id,
        actionType: "create",
        oldValues: null,
        newValues: createdNode,
        changedByUserId: currentUserId
      },
      client
    );

    await client.query("commit");
    return createdNode;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function updatePacsNode(
  nodeId: number | string,
  payload: UnknownRecord,
  currentUserId: UserId
): Promise<PacsNodeRow> {
  const cleanId = normalizePositiveInteger(nodeId, "nodeId");
  const name = normalizeOptionalText(payload.name);
  const host = normalizeOptionalText(payload.host);
  const port = payload.port !== undefined ? normalizePositiveInteger(payload.port, "port") : undefined;
  const calledAeTitle = payload.calledAeTitle !== undefined ? normalizeOptionalText(payload.calledAeTitle)?.toUpperCase() : undefined;
  const callingAeTitle = payload.callingAeTitle !== undefined ? normalizeOptionalText(payload.callingAeTitle)?.toUpperCase() : undefined;
  const timeoutSeconds = payload.timeoutSeconds !== undefined ? normalizePositiveInteger(payload.timeoutSeconds, "timeoutSeconds") : undefined;
  const isActive = payload.isActive !== undefined ? String(payload.isActive).trim().toLowerCase() !== "disabled" : undefined;
  const isDefault = payload.isDefault !== undefined ? String(payload.isDefault).trim().toLowerCase() !== "disabled" : undefined;

  const client = await pool.connect();

  try {
    await client.query("begin");

    const existingResult = await client.query(
      `select * from pacs_nodes where id = $1 limit 1`,
      [cleanId]
    );

    const existing = existingResult.rows[0] as PacsNodeRow | undefined;

    if (!existing) {
      throw new HttpError(404, "PACS node not found.");
    }

    // If setting as default, unset others
    if (isDefault === true) {
      await client.query("update pacs_nodes set is_default = false");
    }

    const { rows } = await client.query(
      `
        update pacs_nodes
        set
          name = coalesce($2, name),
          host = coalesce($3, host),
          port = coalesce($4, port),
          called_ae_title = coalesce($5, called_ae_title),
          calling_ae_title = coalesce($6, calling_ae_title),
          timeout_seconds = coalesce($7, timeout_seconds),
          is_active = coalesce($8, is_active),
          is_default = coalesce($9, is_default),
          updated_by_user_id = $10,
          updated_at = now()
        where id = $1
        returning *
      `,
      [
        cleanId,
        name,
        host,
        port,
        calledAeTitle,
        callingAeTitle,
        timeoutSeconds,
        isActive,
        isDefault,
        currentUserId
      ]
    );

    const updatedNode = requireRow(rows[0] as PacsNodeRow | undefined, "Failed to update PACS node.");

    await logAuditEntry(
      {
        entityType: "pacs_node",
        entityId: cleanId,
        actionType: "update",
        oldValues: existing,
        newValues: updatedNode,
        changedByUserId: currentUserId
      },
      client
    );

    await client.query("commit");
    return updatedNode;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function deletePacsNode(
  nodeId: number | string,
  currentUserId: UserId
): Promise<{ ok: boolean }> {
  const cleanId = normalizePositiveInteger(nodeId, "nodeId");

  const client = await pool.connect();

  try {
    await client.query("begin");

    const existingResult = await client.query(
      `select * from pacs_nodes where id = $1 limit 1`,
      [cleanId]
    );

    const existing = existingResult.rows[0] as PacsNodeRow | undefined;

    if (!existing) {
      throw new HttpError(404, "PACS node not found.");
    }

    await client.query("delete from pacs_nodes where id = $1", [cleanId]);

    // If we deleted the default, set another active node as default
    if (existing.is_default) {
      await client.query(
        `
          update pacs_nodes
          set is_default = true
          where id = (
            select id from pacs_nodes where is_active = true order by name asc limit 1
          )
        `
      );
    }

    await logAuditEntry(
      {
        entityType: "pacs_node",
        entityId: cleanId,
        actionType: "delete",
        oldValues: existing,
        newValues: null,
        changedByUserId: currentUserId
      },
      client
    );

    await client.query("commit");
    return { ok: true };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

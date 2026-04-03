// @ts-check

import express from "express";
import { requireAuth, requireRecentSupervisorReauth, requireSupervisor } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { getTripoliToday } from "../utils/date.js";
import { exportAuditEntriesCsv, listAuditEntries, listAuditFilterOptions, logAuditEntry } from "../services/audit-service.js";

/**
 * @typedef {object} AuditRequest
 * @property {Record<string, unknown>} [query]
 * @property {{ sub: number | string, role: string }} user
 */

export const auditRouter = express.Router();

auditRouter.use(requireAuth, requireSupervisor, requireRecentSupervisorReauth);

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
function asOptionalString(value) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  return String(value);
}

/**
 * @param {unknown} value
 * @returns {number | string | undefined}
 */
function asOptionalNumberOrString(value) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  if (typeof value === "number") {
    return value;
  }

  return String(value);
}

auditRouter.get(
  "/export",
  asyncRoute(async (req, res) => {
    const request = /** @type {AuditRequest} */ (req);
    const query = /** @type {Record<string, unknown>} */ (request.query || {});
    const csv = await exportAuditEntriesCsv({
      limit: asOptionalNumberOrString(query.limit),
      entityType: asOptionalString(query.entityType),
      actionType: asOptionalString(query.actionType),
      changedByUserId: asOptionalNumberOrString(query.changedByUserId),
      dateFrom: asOptionalString(query.dateFrom),
      dateTo: asOptionalString(query.dateTo)
    });

    await logAuditEntry({
      entityType: "audit_log",
      actionType: "export",
      oldValues: null,
      newValues: {
        filters: {
          entityType: asOptionalString(query.entityType) || "",
          actionType: asOptionalString(query.actionType) || "",
          changedByUserId: asOptionalString(query.changedByUserId) || "",
          dateFrom: asOptionalString(query.dateFrom) || "",
          dateTo: asOptionalString(query.dateTo) || ""
        }
      },
      changedByUserId: request.user.sub
    });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="rispro-audit-${getTripoliToday()}.csv"`);
    res.send(csv);
  })
);

auditRouter.get(
  "/",
  asyncRoute(async (req, res) => {
    const request = /** @type {AuditRequest} */ (req);
    const query = /** @type {Record<string, unknown>} */ (request.query || {});
    const [entries, meta] = await Promise.all([
      listAuditEntries({
        limit: asOptionalNumberOrString(query.limit),
        entityType: asOptionalString(query.entityType),
        actionType: asOptionalString(query.actionType),
        changedByUserId: asOptionalNumberOrString(query.changedByUserId),
        dateFrom: asOptionalString(query.dateFrom),
        dateTo: asOptionalString(query.dateTo)
      }),
      listAuditFilterOptions()
    ]);
    res.json({ entries, meta });
  })
);

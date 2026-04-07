import express, { Request, Response } from "express";
import { requireAuth, requireRecentSupervisorReauth, requireSupervisor } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { getTripoliToday } from "../utils/date.js";
import { asOptionalString, asOptionalUserId } from "../utils/request-coercion.js";
import { asUnknownRecord } from "../utils/records.js";
import { exportAuditEntriesCsv, listAuditEntries, listAuditFilterOptions, logAuditEntry } from "../services/audit-service.js";
import type { UserId } from "../types/http.js";

export const auditRouter = express.Router();

auditRouter.use(requireAuth, requireSupervisor, requireRecentSupervisorReauth);

auditRouter.get(
  "/export",
  asyncRoute(async (req: Request, res: Response) => {
    const query = asUnknownRecord(req.query);
    const csv = await exportAuditEntriesCsv({
      limit: asOptionalUserId(query.limit),
      entityType: asOptionalString(query.entityType),
      actionType: asOptionalString(query.actionType),
      changedByUserId: asOptionalUserId(query.changedByUserId),
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
      changedByUserId: req.user!.sub as UserId
    });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="rispro-audit-${getTripoliToday()}.csv"`);
    res.send(csv);
  })
);

auditRouter.get(
  "/",
  asyncRoute(async (req: Request, res: Response) => {
    const query = asUnknownRecord(req.query);
    const [entries, meta] = await Promise.all([
      listAuditEntries({
        limit: asOptionalUserId(query.limit),
        entityType: asOptionalString(query.entityType),
        actionType: asOptionalString(query.actionType),
        changedByUserId: asOptionalUserId(query.changedByUserId),
        dateFrom: asOptionalString(query.dateFrom),
        dateTo: asOptionalString(query.dateTo)
      }),
      listAuditFilterOptions()
    ]);
    res.json({ entries, meta });
  })
);

import express, { Request, Response } from "express";
import { requireAuth, requireRecentSupervisorReauth, requireSupervisor } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { getTripoliToday } from "../utils/date.js";
import { asOptionalString, asOptionalUserId } from "../utils/request-coercion.js";
import { asUnknownRecord } from "../utils/records.js";
import { listAuditPage, logAuditEntry, streamAuditEntriesCsv } from "../services/audit-service.js";
import type { UserId } from "../types/http.js";

export const auditRouter = express.Router();

auditRouter.use(requireAuth, requireSupervisor, requireRecentSupervisorReauth);

auditRouter.get(
  "/export",
  asyncRoute(async (req: Request, res: Response) => {
    const query = asUnknownRecord(req.query);
    const filters = {
      limit: asOptionalUserId(query.limit),
      entityType: asOptionalString(query.entityType),
      actionType: asOptionalString(query.actionType),
      changedByUserId: asOptionalUserId(query.changedByUserId),
      dateFrom: asOptionalString(query.dateFrom),
      dateTo: asOptionalString(query.dateTo),
      category: asOptionalString(query.category),
      search: asOptionalString(query.search),
      outcome: asOptionalString(query.outcome)
    };

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="rispro-audit-${getTripoliToday()}.csv"`);
    await streamAuditEntriesCsv(filters, (chunk) => { res.write(chunk); });

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
          dateTo: asOptionalString(query.dateTo) || "",
          category: asOptionalString(query.category) || "",
          search: asOptionalString(query.search) || "",
          outcome: asOptionalString(query.outcome) || ""
        }
      },
      changedByUserId: req.user!.sub as UserId
    });

    res.end();
  })
);

auditRouter.get(
  "/",
  asyncRoute(async (req: Request, res: Response) => {
    const query = asUnknownRecord(req.query);
    res.json(await listAuditPage({
      page: asOptionalString(query.page),
      pageSize: asOptionalString(query.pageSize),
      entityType: asOptionalString(query.entityType),
      actionType: asOptionalString(query.actionType),
      changedByUserId: asOptionalUserId(query.changedByUserId),
      dateFrom: asOptionalString(query.dateFrom),
      dateTo: asOptionalString(query.dateTo),
      category: asOptionalString(query.category),
      search: asOptionalString(query.search),
      outcome: asOptionalString(query.outcome)
    }));
  })
);

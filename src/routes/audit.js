import express from "express";
import { requireAuth, requireRecentSupervisorReauth, requireSupervisor } from "../middleware/auth.js";
import { exportAuditEntriesCsv, listAuditEntries, listAuditFilterOptions, logAuditEntry } from "../services/audit-service.js";

export const auditRouter = express.Router();

auditRouter.use(requireAuth, requireSupervisor, requireRecentSupervisorReauth);

auditRouter.get("/export", async (req, res, next) => {
  try {
    const csv = await exportAuditEntriesCsv({
      limit: req.query.limit,
      entityType: req.query.entityType,
      actionType: req.query.actionType,
      changedByUserId: req.query.changedByUserId,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo
    });

    await logAuditEntry({
      entityType: "audit_log",
      actionType: "export",
      oldValues: null,
      newValues: {
        filters: {
          entityType: req.query.entityType || "",
          actionType: req.query.actionType || "",
          changedByUserId: req.query.changedByUserId || "",
          dateFrom: req.query.dateFrom || "",
          dateTo: req.query.dateTo || ""
        }
      },
      changedByUserId: req.user.sub
    });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="rispro-audit-${new Date().toISOString().slice(0, 10)}.csv"`
    );
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

auditRouter.get("/", async (req, res, next) => {
  try {
    const [entries, meta] = await Promise.all([
      listAuditEntries({
        limit: req.query.limit,
        entityType: req.query.entityType,
        actionType: req.query.actionType,
        changedByUserId: req.query.changedByUserId,
        dateFrom: req.query.dateFrom,
        dateTo: req.query.dateTo
      }),
      listAuditFilterOptions()
    ]);
    res.json({ entries, meta });
  } catch (error) {
    next(error);
  }
});

import express, { type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { asUnknownRecord } from "../utils/records.js";
import { getQzCertificate, signQzRequest } from "../services/qz-signing-service.js";
import { logAuditEntry } from "../services/audit-service.js";

export const printingRouter = express.Router();
printingRouter.use(requireAuth);

printingRouter.get("/qz-certificate", (_req: Request, res: Response) => {
  res.type("text/plain").send(getQzCertificate());
});

printingRouter.post("/qz-sign", (req: Request, res: Response) => {
  const body = asUnknownRecord(req.body);
  res.json({ signature: signQzRequest(body.request) });
});

printingRouter.post(
  "/audit",
  asyncRoute(async (req: Request, res: Response) => {
    const body = asUnknownRecord(req.body);
    const appointmentId = Number(body.appointmentId);
    const success = body.success === true;
    await logAuditEntry({
      entityType: "print_job",
      entityId: Number.isSafeInteger(appointmentId) && appointmentId > 0 ? appointmentId : null,
      actionType: success ? "print_job_submitted" : "print_job_failed",
      changedByUserId: req.user!.sub,
      newValues: {
        outcome: success ? "successful" : "failed",
        workstationId: String(body.workstationId || "").slice(0, 100),
        documentType: String(body.documentType || "").slice(0, 50),
        documentId: body.documentId == null ? null : String(body.documentId).slice(0, 100),
        appointmentId: body.appointmentId ?? null,
        accessionNumber: body.accessionNumber == null ? null : String(body.accessionNumber).slice(0, 100),
        printerName: body.printerName == null ? null : String(body.printerName).slice(0, 255),
        paperWidthMm: body.paperWidthMm ?? null,
        paperHeightMm: body.paperHeightMm ?? null,
        failureCode: body.failureCode == null ? null : String(body.failureCode).slice(0, 80),
      },
    });
    res.status(201).json({ ok: true });
  })
);


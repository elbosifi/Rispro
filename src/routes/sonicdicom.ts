import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { buildSonicDicomStaffViewerUrl } from "../services/sonicdicom-report-service.js";
import { readSonicDicomReportSettings } from "../services/sonicdicom-report-settings.js";
import { asyncRoute } from "../utils/async-route.js";
import { HttpError } from "../utils/http-error.js";

export const sonicDicomRouter = Router();

sonicDicomRouter.use(requireAuth);
sonicDicomRouter.get(
  "/open",
  asyncRoute(async (req: Request, res: Response) => {
    const target = String(req.query.target || "");
    if (target !== "study" && target !== "patient") {
      throw new HttpError(400, "SonicDICOM target must be study or patient.");
    }
    const value = String(req.query.value || "").trim();
    if (!value) throw new HttpError(400, "SonicDICOM viewer identifier is required.");
    const redirectUrl = buildSonicDicomStaffViewerUrl({
      settings: await readSonicDicomReportSettings(),
      requestHostname: req.hostname,
      target: target === "study" ? "studyViewer" : "patientList",
      value,
    });
    res.redirect(302, redirectUrl);
  })
);

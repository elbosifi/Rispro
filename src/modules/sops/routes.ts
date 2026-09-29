import express, { type Request, type Response } from "express";
import { requireAnyRole, requireAuth } from "../../middleware/auth.js";
import { chromiumRenderConcurrencyLimiter } from "../../middleware/chromium-render-concurrency.js";
import { asyncRoute } from "../../utils/async-route.js";
import { asUnknownRecord } from "../../utils/records.js";
import { HttpError } from "../../utils/http-error.js";
import { confirmSopXlsxImport, exportSopVersionXlsx, inspectSopXlsxImport, previewSopXlsxImport } from "./sop-import-export-service.js";
import { confirmDraftSopJsonImport, confirmNewSopJsonImport, exportSopJsonExample, exportSopVersionJson, getSopJsonExampleConfig, inspectDraftSopJsonImport, inspectNewSopJsonImport, previewDraftSopJsonImport, previewNewSopJsonImport, resetSopJsonExampleConfig, updateSopJsonExampleConfig } from "./sop-json-import-export-service.js";
import { archiveSopForUser, createSop, createSopRevisionForUser, getSopDetailForUser, getSopMeta, getSopPrintDocumentForUser, getSopVersionForUser, listSops, publishSopVersionForUser, reviewSopNoChangesForUser, updateSopDraftForUser, updateSopOwnerForUser, validateSopFilters } from "./sop-service.js";
import { ChromiumPdfRenderError, renderChromiumPdf } from "../../services/chromium-pdf-service.js";
import { buildSopPdfFooterTemplate, buildSopPrintHtml } from "./sop-print-service.js";

export const sopsRouter = express.Router();
const MANAGEMENT = ["supervisor", "super_admin"] as const;
sopsRouter.use(requireAuth);

sopsRouter.get("/meta", asyncRoute(async (req: Request, res: Response) => { res.json(await getSopMeta(req.user?.role)); }));
sopsRouter.get("/", asyncRoute(async (req: Request, res: Response) => { res.json({ sops: await listSops(validateSopFilters(req.query), req.user?.role) }); }));
sopsRouter.get("/import/json/example/config", requireAnyRole([...MANAGEMENT]), asyncRoute(async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store, private");
  res.json(await getSopJsonExampleConfig(req.user?.role));
}));
sopsRouter.put("/import/json/example/config", requireAnyRole([...MANAGEMENT]), asyncRoute(async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store, private");
  res.json(await updateSopJsonExampleConfig(asUnknownRecord(req.body), req.user!.sub, req.user?.role));
}));
sopsRouter.post("/import/json/example/reset", requireAnyRole([...MANAGEMENT]), asyncRoute(async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store, private");
  res.json(await resetSopJsonExampleConfig(req.user!.sub, req.user?.role));
}));
sopsRouter.get("/import/json/example", requireAnyRole([...MANAGEMENT]), asyncRoute(async (_req: Request, res: Response) => {
  const payload = await exportSopJsonExample();
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${payload.filename}"`);
  res.setHeader("Cache-Control", "no-store, private");
  res.send(payload.buffer);
}));
sopsRouter.get("/:id/versions/:version/export.xlsx", asyncRoute(async (req: Request, res: Response) => {
  const payload = await exportSopVersionXlsx(req.params.id, req.params.version, req.user?.role);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${payload.filename}"`);
  res.send(payload.buffer);
}));
sopsRouter.get("/:id/versions/:version/export.json", asyncRoute(async (req: Request, res: Response) => {
  const payload = await exportSopVersionJson(req.params.id, req.params.version, req.user?.role);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${payload.filename}"`);
  res.send(payload.buffer);
}));
sopsRouter.get("/:id/versions/:version/print", asyncRoute(async (req: Request, res: Response) => {
  const document = await getSopPrintDocumentForUser(req.params.id, req.params.version, req.user?.role);
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(buildSopPrintHtml({ ...document, generatedAt: new Date() }));
}));
sopsRouter.get("/:id/versions/:version/pdf", chromiumRenderConcurrencyLimiter, asyncRoute(async (req: Request, res: Response) => {
  const document = await getSopPrintDocumentForUser(req.params.id, req.params.version, req.user?.role);
  const html = buildSopPrintHtml({ ...document, generatedAt: new Date() });
  let pdf: Buffer;
  try {
    pdf = await renderChromiumPdf({
      source: { kind: "html", html },
      documentKind: "sop",
      pdfOptions: {
        displayHeaderFooter: true,
        margin: { top: "14mm", right: "13mm", bottom: "18mm", left: "13mm" },
        headerTemplate: "<div></div>",
        footerTemplate: buildSopPdfFooterTemplate(document.sop.code, document.version.version),
      },
    });
  } catch (error) {
    if (error instanceof ChromiumPdfRenderError) throw new HttpError(502, "SOP PDF rendering failed.", { code: "SOP_PDF_RENDER_FAILED" });
    throw error;
  }
  if (pdf.length < 5 || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") throw new HttpError(502, "Chromium returned an invalid SOP PDF.", { code: "SOP_PDF_RENDER_FAILED" });
  const safeCode = document.sop.code.replace(/[^A-Za-z0-9._-]+/g, "-");
  const safeVersion = document.version.version.replace(/[^A-Za-z0-9._-]+/g, "-");
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Content-Disposition", `attachment; filename="${safeCode}-v${safeVersion}.pdf"`);
  res.setHeader("Content-Type", "application/pdf");
  res.send(pdf);
}));
sopsRouter.get("/:id/versions/:version", asyncRoute(async (req: Request, res: Response) => { res.json({ version: await getSopVersionForUser(req.params.id, req.params.version, req.user?.role) }); }));
sopsRouter.get("/:id", asyncRoute(async (req: Request, res: Response) => { res.json(await getSopDetailForUser(req.params.id, req.user?.role)); }));
sopsRouter.post("/", requireAnyRole([...MANAGEMENT]), asyncRoute(async (req: Request, res: Response) => { res.status(201).json(await createSop(asUnknownRecord(req.body), req.user!.sub, req.user?.role)); }));
sopsRouter.post("/import/json/inspect", requireAnyRole([...MANAGEMENT]), asyncRoute(async (req: Request, res: Response) => { res.json(await inspectNewSopJsonImport(asUnknownRecord(req.body) as { fileContentBase64: string; fileName?: string | null }, req.user?.role)); }));
sopsRouter.post("/import/json/preview", requireAnyRole([...MANAGEMENT]), asyncRoute(async (req: Request, res: Response) => { res.json(await previewNewSopJsonImport(asUnknownRecord(req.body) as { fileContentBase64: string; fileName?: string | null }, req.user?.role)); }));
sopsRouter.post("/import/json/confirm", requireAnyRole([...MANAGEMENT]), asyncRoute(async (req: Request, res: Response) => { res.status(201).json(await confirmNewSopJsonImport(asUnknownRecord(req.body) as { fileContentBase64: string; fileName?: string | null }, req.user!.sub, req.user?.role)); }));
sopsRouter.patch("/:id/versions/:version", requireAnyRole([...MANAGEMENT]), asyncRoute(async (req: Request, res: Response) => { res.json(await updateSopDraftForUser(req.params.id, req.params.version, asUnknownRecord(req.body), req.user!.sub, req.user?.role)); }));
sopsRouter.post("/:id/versions/:version/import/inspect", requireAnyRole([...MANAGEMENT]), asyncRoute(async (req: Request, res: Response) => {
  res.json(await inspectSopXlsxImport(req.params.id, req.params.version, asUnknownRecord(req.body) as { fileContentBase64: string; fileName?: string | null }, req.user?.role));
}));
sopsRouter.post("/:id/versions/:version/import/preview", requireAnyRole([...MANAGEMENT]), asyncRoute(async (req: Request, res: Response) => {
  res.json(await previewSopXlsxImport(req.params.id, req.params.version, asUnknownRecord(req.body) as { fileContentBase64: string; fileName?: string | null }, req.user?.role));
}));
sopsRouter.post("/:id/versions/:version/import/confirm", requireAnyRole([...MANAGEMENT]), asyncRoute(async (req: Request, res: Response) => {
  res.json(await confirmSopXlsxImport(req.params.id, req.params.version, asUnknownRecord(req.body) as { fileContentBase64: string; fileName?: string | null; expectedDraftUpdatedAt?: string | null }, req.user!.sub, req.user?.role));
}));
sopsRouter.post("/:id/versions/:version/import/json/inspect", requireAnyRole([...MANAGEMENT]), asyncRoute(async (req: Request, res: Response) => { res.json(await inspectDraftSopJsonImport(req.params.id, req.params.version, asUnknownRecord(req.body) as { fileContentBase64: string; fileName?: string | null }, req.user?.role)); }));
sopsRouter.post("/:id/versions/:version/import/json/preview", requireAnyRole([...MANAGEMENT]), asyncRoute(async (req: Request, res: Response) => { res.json(await previewDraftSopJsonImport(req.params.id, req.params.version, asUnknownRecord(req.body) as { fileContentBase64: string; fileName?: string | null }, req.user?.role)); }));
sopsRouter.post("/:id/versions/:version/import/json/confirm", requireAnyRole([...MANAGEMENT]), asyncRoute(async (req: Request, res: Response) => { res.json(await confirmDraftSopJsonImport(req.params.id, req.params.version, asUnknownRecord(req.body) as { fileContentBase64: string; fileName?: string | null; expectedDraftUpdatedAt?: string | null }, req.user!.sub, req.user?.role)); }));
sopsRouter.post("/:id/revisions", requireAnyRole([...MANAGEMENT]), asyncRoute(async (req: Request, res: Response) => { res.status(201).json({ version: await createSopRevisionForUser(req.params.id, asUnknownRecord(req.body), req.user!.sub, req.user?.role) }); }));
sopsRouter.post("/:id/versions/:version/publish", requireAnyRole([...MANAGEMENT]), asyncRoute(async (req: Request, res: Response) => { res.json(await publishSopVersionForUser(req.params.id, req.params.version, req.user!.sub, req.user?.role)); }));
sopsRouter.post("/:id/archive", requireAnyRole([...MANAGEMENT]), asyncRoute(async (req: Request, res: Response) => { res.json({ sop: await archiveSopForUser(req.params.id, req.user!.sub, req.user?.role) }); }));
sopsRouter.patch("/:id/owner", requireAnyRole([...MANAGEMENT]), asyncRoute(async (req: Request, res: Response) => {
  res.json({ sop: await updateSopOwnerForUser(req.params.id, asUnknownRecord(req.body), req.user!.sub, req.user?.role) });
}));
sopsRouter.post("/:id/versions/:version/review-no-changes", requireAnyRole([...MANAGEMENT]), asyncRoute(async (req: Request, res: Response) => {
  res.json(await reviewSopNoChangesForUser(req.params.id, req.params.version, req.user!.sub, req.user?.role));
}));

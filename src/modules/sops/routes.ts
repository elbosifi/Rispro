import express, { type Request, type Response } from "express";
import { requireAnyRole, requireAuth } from "../../middleware/auth.js";
import { asyncRoute } from "../../utils/async-route.js";
import { asUnknownRecord } from "../../utils/records.js";
import { archiveSopForUser, createSop, createSopRevisionForUser, getSopDetailForUser, getSopVersionForUser, listSops, publishSopVersionForUser, SOP_META, updateSopDraftForUser, validateSopFilters } from "./sop-service.js";

export const sopsRouter = express.Router();
const MANAGEMENT = ["supervisor", "super_admin"] as const;
sopsRouter.use(requireAuth);

sopsRouter.get("/meta", asyncRoute(async (_req: Request, res: Response) => { res.json(SOP_META); }));
sopsRouter.get("/", asyncRoute(async (req: Request, res: Response) => { res.json({ sops: await listSops(validateSopFilters(req.query), req.user?.role) }); }));
sopsRouter.get("/:id/versions/:version", asyncRoute(async (req: Request, res: Response) => { res.json({ version: await getSopVersionForUser(req.params.id, req.params.version, req.user?.role) }); }));
sopsRouter.get("/:id", asyncRoute(async (req: Request, res: Response) => { res.json(await getSopDetailForUser(req.params.id, req.user?.role)); }));
sopsRouter.post("/", requireAnyRole([...MANAGEMENT]), asyncRoute(async (req: Request, res: Response) => { res.status(201).json(await createSop(asUnknownRecord(req.body), req.user!.sub, req.user?.role)); }));
sopsRouter.patch("/:id/versions/:version", requireAnyRole([...MANAGEMENT]), asyncRoute(async (req: Request, res: Response) => { res.json(await updateSopDraftForUser(req.params.id, req.params.version, asUnknownRecord(req.body), req.user!.sub, req.user?.role)); }));
sopsRouter.post("/:id/revisions", requireAnyRole([...MANAGEMENT]), asyncRoute(async (req: Request, res: Response) => { res.status(201).json({ version: await createSopRevisionForUser(req.params.id, asUnknownRecord(req.body), req.user!.sub, req.user?.role) }); }));
sopsRouter.post("/:id/versions/:version/publish", requireAnyRole([...MANAGEMENT]), asyncRoute(async (req: Request, res: Response) => { res.json(await publishSopVersionForUser(req.params.id, req.params.version, req.user!.sub, req.user?.role)); }));
sopsRouter.post("/:id/archive", requireAnyRole([...MANAGEMENT]), asyncRoute(async (req: Request, res: Response) => { res.json({ sop: await archiveSopForUser(req.params.id, req.user!.sub, req.user?.role) }); }));

import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../../../middleware/auth.js";
import { requirePageAccess } from "../../../../middleware/page-access.js";
import { asyncRoute } from "../../../../utils/async-route.js";
import type { AuthenticatedUserContext } from "../../../../types/http.js";
import { withTransaction } from "../../shared/utils/transactions.js";
import { complementaryRecallReceptionSummary, complementaryRecallUnseenCount, getComplementaryRecall, getComplementaryRecallBookingContext, listComplementaryRecalls, markComplementaryRecallSeen, markComplementaryRecallsSeen, withdrawComplementaryRecall } from "../../recall/complementary-recall.service.js";
import { HttpError } from "../../../../utils/http-error.js";

interface RecallRequest extends Request { user?: AuthenticatedUserContext; }
function id(value: unknown): number { const parsed = Number(value); if (!Number.isInteger(parsed) || parsed <= 0) throw new HttpError(400, "Invalid complementary recall request ID."); return parsed; }

export const complementaryRecallRouter = Router();
complementaryRecallRouter.use(requireAuth, requirePageAccess("recall.requests"));
complementaryRecallRouter.get("/", asyncRoute(async (_req: RecallRequest, res: Response) => res.json({ recalls: await listComplementaryRecalls() })));
complementaryRecallRouter.get("/reception-summary", asyncRoute(async (_req: RecallRequest, res: Response) => res.json(await complementaryRecallReceptionSummary())));
complementaryRecallRouter.get("/unseen-count", asyncRoute(async (_req: RecallRequest, res: Response) => res.json({ count: await complementaryRecallUnseenCount() })));
complementaryRecallRouter.get("/:id", asyncRoute(async (req: RecallRequest, res: Response) => { const recall = await getComplementaryRecall(id(req.params.id)); if (!recall) throw new HttpError(404, "Complementary recall request not found."); res.json({ recall }); }));
complementaryRecallRouter.get("/:id/booking-context", asyncRoute(async (req: RecallRequest, res: Response) => { const recall = await getComplementaryRecallBookingContext(id(req.params.id)); if (!recall) throw new HttpError(404, "Complementary recall booking context not found."); res.json({ recall }); }));
complementaryRecallRouter.post("/mark-seen", asyncRoute(async (req: RecallRequest, res: Response) => { const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : []; await withTransaction((client) => markComplementaryRecallsSeen(client, ids, Number(req.user!.sub))); res.status(204).end(); }));
complementaryRecallRouter.post("/:id/mark-seen", asyncRoute(async (req: RecallRequest, res: Response) => { await withTransaction((client) => markComplementaryRecallSeen(client, id(req.params.id), Number(req.user!.sub))); res.status(204).end(); }));
complementaryRecallRouter.post("/:id/withdraw", asyncRoute(async (req: RecallRequest, res: Response) => { if (!["supervisor", "super_admin"].includes(req.user!.role)) throw new HttpError(403, "Only supervisors may withdraw additional imaging requests."); const recall = await withTransaction((client) => withdrawComplementaryRecall(client, id(req.params.id), Number(req.user!.sub))); res.json({ recall }); }));

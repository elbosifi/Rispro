import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../../../middleware/auth.js";
import { requirePageAccess } from "../../../../middleware/page-access.js";
import { asyncRoute } from "../../../../utils/async-route.js";
import type { AuthenticatedUserContext } from "../../../../types/http.js";
import { withTransaction } from "../../shared/utils/transactions.js";
import { complementaryRecallUnseenCount, getComplementaryRecall, getComplementaryRecallBookingContext, listComplementaryRecalls, markComplementaryRecallSeen } from "../../recall/complementary-recall.service.js";
import { HttpError } from "../../../../utils/http-error.js";

interface RecallRequest extends Request { user?: AuthenticatedUserContext; }
function id(value: unknown): number { const parsed = Number(value); if (!Number.isInteger(parsed) || parsed <= 0) throw new HttpError(400, "Invalid complementary recall request ID."); return parsed; }

export const complementaryRecallRouter = Router();
complementaryRecallRouter.use(requireAuth, requirePageAccess("recall.requests"));
complementaryRecallRouter.get("/", asyncRoute(async (_req: RecallRequest, res: Response) => res.json({ recalls: await listComplementaryRecalls() })));
complementaryRecallRouter.get("/unseen-count", asyncRoute(async (_req: RecallRequest, res: Response) => res.json({ count: await complementaryRecallUnseenCount() })));
complementaryRecallRouter.get("/:id", asyncRoute(async (req: RecallRequest, res: Response) => { const recall = await getComplementaryRecall(id(req.params.id)); if (!recall) throw new HttpError(404, "Complementary recall request not found."); res.json({ recall }); }));
complementaryRecallRouter.get("/:id/booking-context", asyncRoute(async (req: RecallRequest, res: Response) => { const recall = await getComplementaryRecallBookingContext(id(req.params.id)); if (!recall) throw new HttpError(404, "Complementary recall booking context not found."); res.json({ recall }); }));
complementaryRecallRouter.post("/:id/mark-seen", asyncRoute(async (req: RecallRequest, res: Response) => { await withTransaction((client) => markComplementaryRecallSeen(client, id(req.params.id), Number(req.user!.sub))); res.status(204).end(); }));

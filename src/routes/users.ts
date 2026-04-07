import express, { Request, Response } from "express";
import { requireAuth, requireRecentSupervisorReauth, requireSupervisor } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { asOptionalBoolean, asString } from "../utils/request-coercion.js";
import { asUnknownRecord } from "../utils/records.js";
import { createUser, deleteUser, listUsers } from "../services/user-service.js";

export const usersRouter = express.Router();

usersRouter.use(requireAuth, requireSupervisor, requireRecentSupervisorReauth);

usersRouter.get(
  "/",
  asyncRoute(async (_req: Request, res: Response) => {
    const users = await listUsers();
    res.json({ users });
  })
);

usersRouter.post(
  "/",
  asyncRoute(async (req: Request, res: Response) => {
    const body = asUnknownRecord(req.body);
    const user = await createUser(
      {
        username: asString(body.username),
        fullName: asString(body.fullName),
        password: asString(body.password),
        role: asString(body.role),
        isActive: asOptionalBoolean(body.isActive)
      },
      req.user!.sub
    );
    res.status(201).json({ user });
  })
);

usersRouter.delete(
  "/:userId",
  asyncRoute(async (req: Request, res: Response) => {
    const user = await deleteUser(asString(req.params.userId), req.user!.sub);
    res.json({ user });
  })
);

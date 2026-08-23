import express, { Request, Response } from "express";
import { requireAuth, requireRecentSupervisorReauth, requireSupervisor } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { asOptionalBoolean, asString } from "../utils/request-coercion.js";
import { asUnknownRecord } from "../utils/records.js";
import {
  createUser,
  deleteUser,
  listUsers,
  resetUserTemporaryPassword,
  updateUserIdentity,
  updateUserActiveState,
  updateUserPassword,
  updateUserSchedulingOverridePermission
} from "../services/user-service.js";

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
        isActive: asOptionalBoolean(body.isActive),
        canRequestSchedulingOverride: asOptionalBoolean(body.canRequestSchedulingOverride)
      },
      { userId: req.user!.sub, role: req.user!.role }
    );
    res.status(201).json({ user });
  })
);

usersRouter.delete(
  "/:userId",
  asyncRoute(async (req: Request, res: Response) => {
    const user = await deleteUser(asString(req.params.userId), { userId: req.user!.sub, role: req.user!.role });
    res.json({ user });
  })
);

usersRouter.put(
  "/:userId/scheduling-override-permission",
  asyncRoute(async (req: Request, res: Response) => {
    const body = asUnknownRecord(req.body);
    const user = await updateUserSchedulingOverridePermission(
      asString(req.params.userId),
      asOptionalBoolean(body.canRequestSchedulingOverride) === true,
      { userId: req.user!.sub, role: req.user!.role }
    );
    res.json({ user });
  })
);

usersRouter.put(
  "/:userId/identity",
  asyncRoute(async (req: Request, res: Response) => {
    const body = asUnknownRecord(req.body);
    const user = await updateUserIdentity(
      asString(req.params.userId),
      { username: asString(body.username), fullName: asString(body.fullName) },
      { userId: req.user!.sub, role: req.user!.role }
    );
    res.json({ user });
  })
);

usersRouter.put(
  "/:userId/password",
  asyncRoute(async (req: Request, res: Response) => {
    const body = asUnknownRecord(req.body);
    const user = await updateUserPassword(asString(req.params.userId), asString(body.password), req.user!.sub);
    res.json({ user });
  })
);

usersRouter.post(
  "/:userId/temporary-password",
  asyncRoute(async (req: Request, res: Response) => {
    const body = asUnknownRecord(req.body);
    const user = await resetUserTemporaryPassword(asString(req.params.userId), asString(body.password), req.user!.sub);
    res.json({ user });
  })
);

usersRouter.put(
  "/:userId/active",
  asyncRoute(async (req: Request, res: Response) => {
    const body = asUnknownRecord(req.body);
    const isActive = asOptionalBoolean(body.isActive);
    if (typeof body.isActive !== "boolean" || isActive === undefined) {
      res.status(400).json({ message: "isActive must be a boolean." });
      return;
    }
    const user = await updateUserActiveState(asString(req.params.userId), isActive, {
      userId: req.user!.sub,
      role: req.user!.role
    });
    res.json({ user });
  })
);

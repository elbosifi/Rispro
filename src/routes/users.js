import express from "express";
import { requireAuth, requireRecentSupervisorReauth, requireSupervisor } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { createUser, listUsers } from "../services/user-service.js";

export const usersRouter = express.Router();

usersRouter.use(requireAuth, requireSupervisor, requireRecentSupervisorReauth);

usersRouter.get(
  "/",
  asyncRoute(async (_req, res) => {
    const users = await listUsers();
    res.json({ users });
  })
);

usersRouter.post(
  "/",
  asyncRoute(async (req, res) => {
    const user = await createUser(req.body || {}, req.user.sub);
    res.status(201).json({ user });
  })
);

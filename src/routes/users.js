// @ts-check

import express from "express";
import { requireAuth, requireRecentSupervisorReauth, requireSupervisor } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { createUser, deleteUser, listUsers } from "../services/user-service.js";

/**
 * @typedef {object} UsersRequest
 * @property {{ sub: number | string, role: string }} [user]
 * @property {Record<string, unknown>} [body]
 * @property {{ userId?: string }} [params]
 */

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
    const request = /** @type {UsersRequest} */ (req);
    const user = await createUser(request.body || {}, request.user.sub);
    res.status(201).json({ user });
  })
);

usersRouter.delete(
  "/:userId",
  asyncRoute(async (req, res) => {
    const request = /** @type {UsersRequest} */ (req);
    const user = await deleteUser(request.params.userId, request.user.sub);
    res.json({ user });
  })
);

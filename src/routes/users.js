// @ts-check

import express from "express";
import { requireAuth, requireRecentSupervisorReauth, requireSupervisor } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { asOptionalBoolean, asString } from "../utils/request-coercion.js";
import { asUnknownRecord } from "../utils/records.js";
import { createUser, deleteUser, listUsers } from "../services/user-service.js";

/** @typedef {import("../types/http.js").AuthenticatedUserContext} AuthenticatedUserContext */
/** @typedef {import("../types/http.js").UnknownRecord} UnknownRecord */

/**
 * @typedef {object} UsersRequest
 * @property {AuthenticatedUserContext} user
 * @property {UnknownRecord} [body]
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
    const body = asUnknownRecord(request.body);
    const user = await createUser(
      {
        username: asString(body.username),
        fullName: asString(body.fullName),
        password: asString(body.password),
        role: asString(body.role),
        isActive: asOptionalBoolean(body.isActive)
      },
      request.user.sub
    );
    res.status(201).json({ user });
  })
);

usersRouter.delete(
  "/:userId",
  asyncRoute(async (req, res) => {
    const request = /** @type {UsersRequest} */ (req);
    const user = await deleteUser(asString(request.params?.userId), request.user.sub);
    res.json({ user });
  })
);

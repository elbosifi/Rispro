import express from "express";
import { requireAuth, requireSupervisor } from "../middleware/auth.js";
import { createUser, listUsers } from "../services/user-service.js";

export const usersRouter = express.Router();

usersRouter.use(requireAuth, requireSupervisor);

usersRouter.get("/", async (_req, res, next) => {
  try {
    const users = await listUsers();
    res.json({ users });
  } catch (error) {
    next(error);
  }
});

usersRouter.post("/", async (req, res, next) => {
  try {
    const user = await createUser(req.body || {});
    res.status(201).json({ user });
  } catch (error) {
    next(error);
  }
});

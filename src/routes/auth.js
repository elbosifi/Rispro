import express from "express";
import {
  authenticateUser,
  buildSessionToken,
  clearSessionCookie,
  writeSessionCookie
} from "../services/auth-service.js";
import { requireAuth } from "../middleware/auth.js";

export const authRouter = express.Router();

authRouter.post("/login", async (req, res, next) => {
  try {
    const { username = "", password = "" } = req.body || {};
    const user = await authenticateUser(username, password);
    const token = buildSessionToken(user);
    writeSessionCookie(res, token);

    res.json({
      user: {
        id: user.id,
        username: user.username,
        fullName: user.full_name,
        role: user.role
      }
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/logout", (_req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

authRouter.post("/re-auth", requireAuth, async (req, res, next) => {
  try {
    const { password = "" } = req.body || {};
    const user = await authenticateUser(req.user.username, password);

    res.json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.full_name,
        role: user.role
      }
    });
  } catch (error) {
    next(error);
  }
});

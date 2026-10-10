import { asyncRouter } from "../async-router.js";
import { Router } from "express";
import { z } from "zod";
import type { AppServices } from "../app.js";
import { appAuth, business } from "../../db/schema.js";
import crypto from "node:crypto";
import {
  clearSessionCookie,
  getAuthRow,
  hashPassword,
  isConfigured,
  setSessionCookie,
  verifyPassword,
  verifySessionToken,
} from "../auth.js";

export function authRouter(services: AppServices): Router {
  const router = asyncRouter();
  const { db } = services;

  router.get("/status", (req, res) => {
    const configured = isConfigured(db);
    const auth = getAuthRow(db);
    const token = req.cookies?.["starlly_session"];
    let authenticated = false;
    if (auth && token) {
      authenticated = verifySessionToken(token, auth.sessionSecret);
    }
    res.json({ configured, authenticated });
  });

  router.post("/setup", (req, res) => {
    if (isConfigured(db)) {
      res.status(403).json({ error: "already_configured" });
      return;
    }
    const parsed = z.object({ password: z.string().min(8) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "validation", details: parsed.error.flatten() });
      return;
    }
    const { salt, hash } = hashPassword(parsed.data.password);
    const now = new Date().toISOString();
    db.insert(appAuth)
      .values({
        id: 1,
        passwordHash: hash,
        passwordSalt: salt,
        sessionSecret: crypto.randomBytes(32).toString("hex"),
        createdAt: now,
      })
      .run();
    // Ensure the single business row exists.
    db.insert(business)
      .values({ id: 1, createdAt: now, updatedAt: now })
      .onConflictDoNothing()
      .run();
    setSessionCookie(res, db);
    res.json({ ok: true });
  });

  router.post("/login", (req, res) => {
    const auth = getAuthRow(db);
    if (!auth) {
      res.status(400).json({ error: "not_configured" });
      return;
    }
    const parsed = z.object({ password: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success || !verifyPassword(parsed.data.password ?? "", auth.passwordSalt, auth.passwordHash)) {
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }
    setSessionCookie(res, db);
    res.json({ ok: true });
  });

  router.post("/logout", (req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  return router;
}

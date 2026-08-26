import express from "express";
import crypto from "node:crypto";
import { db } from "../db/index.js";
import { config, ROLES, ROLE_LABELS } from "../config.js";
import { asyncHandler, requireAuth, httpError } from "../middleware.js";
import * as v from "../validate.js";
import {
  hashPassword,
  checkPassword,
  signToken,
  setAuthCookie,
  clearAuthCookie,
  publicUser,
  createResetToken,
  consumeResetToken,
  markResetUsed,
} from "../auth.js";

const router = express.Router();

const findByEmail = db.prepare("SELECT * FROM users WHERE email = ?");
const findByGoogleId = db.prepare("SELECT * FROM users WHERE google_id = ?");
const findById = db.prepare("SELECT * FROM users WHERE id = ?");

// Tells the front end which sign-in options are switched on.
router.get("/config", (_req, res) => {
  res.json({
    googleEnabled: config.google.enabled,
    roles: ROLES.map((value) => ({ value, label: ROLE_LABELS[value] })),
    companyName: config.companyName,
  });
});

// There is no public sign-up. This is an internal tool: HR creates
// every account from the Team page. See routes/team.routes.js.

// --- Sign in ---------------------------------------------------------
router.post(
  "/signin",
  asyncHandler(async (req, res) => {
    const emailValue = v.email(req.body.email);
    const supplied = typeof req.body.password === "string" ? req.body.password : "";
    if (!supplied) throw httpError(400, "Password is required.");

    const user = findByEmail.get(emailValue);
    // Same message either way so the form cannot be used to discover
    // which email addresses are registered.
    const ok = user && (await checkPassword(supplied, user.password_hash));
    if (!ok) {
      if (user && !user.password_hash) {
        throw httpError(401, "This account uses Google sign-in. Use the Google button instead.");
      }
      throw httpError(401, "Invalid email or password.");
    }

    setAuthCookie(res, signToken(user));
    res.json({ user: publicUser(user) });
  })
);

// --- Sign out --------------------------------------------------------
router.post("/signout", (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

// --- Who am I --------------------------------------------------------
router.get("/me", (req, res) => {
  res.json({ user: req.user ?? null });
});

// --- Change my password (while signed in) ----------------------------
router.post(
  "/change-password",
  requireAuth,
  asyncHandler(async (req, res) => {
    const row = findById.get(req.user.id);
    const current = typeof req.body.currentPassword === "string" ? req.body.currentPassword : "";

    if (row.password_hash && !(await checkPassword(current, row.password_hash))) {
      throw httpError(400, "Your current password is not correct.");
    }
    const next = v.password(req.body.newPassword, { field: "New password" });

    db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(
      await hashPassword(next),
      req.user.id
    );
    res.json({ ok: true });
  })
);

// --- Forgot password -------------------------------------------------
// Always answers 200 so the form cannot be used to discover which
// emails are registered. In development we also hand back the link,
// because this project has no mail server configured.
router.post(
  "/forgot-password",
  asyncHandler(async (req, res) => {
    const emailValue = v.email(req.body.email);
    const user = findByEmail.get(emailValue);

    const payload = {
      message: "If that email is registered, a password reset link has been created.",
    };

    if (user) {
      const token = createResetToken(user.id);
      const link = config.clientUrl + "/reset-password?token=" + token;
      console.log("\n[password reset] " + user.email + "\n[password reset] " + link + "\n");
      if (!config.isProduction) {
        payload.devResetUrl = link; // shown on screen so the flow can be demonstrated
      }
    }

    res.json(payload);
  })
);

// --- Reset password with a token -------------------------------------
router.post(
  "/reset-password",
  asyncHandler(async (req, res) => {
    const token = v.str(req.body.token, { field: "Reset token", required: true, max: 200 });
    const next = v.password(req.body.password, { field: "New password" });

    const result = consumeResetToken(token);
    if (result.error) throw httpError(400, result.error);

    db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(
      await hashPassword(next),
      result.userId
    );
    markResetUsed(result.resetId);

    res.json({ ok: true, message: "Password updated. You can sign in now." });
  })
);

// =====================================================================
// Google sign-in ("log in with your Gmail account") - OAuth 2.0 code
// flow. Only active when GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are
// set in .env; otherwise the button is hidden and email + password
// sign-in is used instead.
// =====================================================================
const OAUTH_STATE_COOKIE = "hiretrack_oauth_state";

router.get("/google", (req, res) => {
  if (!config.google.enabled) {
    throw httpError(503, "Google sign-in is not configured on this server.");
  }
  const state = crypto.randomBytes(16).toString("hex");
  res.cookie(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProduction,
    maxAge: 10 * 60 * 1000,
    path: "/",
  });

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", config.google.clientId);
  url.searchParams.set("redirect_uri", config.google.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");
  res.redirect(url.toString());
});

router.get(
  "/google/callback",
  asyncHandler(async (req, res) => {
    if (!config.google.enabled) throw httpError(503, "Google sign-in is not configured.");

    const { code, state } = req.query;
    const expected = req.cookies?.[OAUTH_STATE_COOKIE];
    res.clearCookie(OAUTH_STATE_COOKIE, { path: "/" });

    // The state check stops someone replaying a login callback at us.
    if (!code || !state || !expected || state !== expected) {
      return res.redirect(config.clientUrl + "/signin?error=google_state");
    }

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: String(code),
        client_id: config.google.clientId,
        client_secret: config.google.clientSecret,
        redirect_uri: config.google.redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      console.error("[google] token exchange failed", await tokenRes.text());
      return res.redirect(config.clientUrl + "/signin?error=google_token");
    }

    const tokenJson = await tokenRes.json();
    const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: "Bearer " + tokenJson.access_token },
    });

    if (!profileRes.ok) {
      return res.redirect(config.clientUrl + "/signin?error=google_profile");
    }

    const profile = await profileRes.json();
    if (!profile.email) return res.redirect(config.clientUrl + "/signin?error=google_email");

    const emailValue = String(profile.email).toLowerCase();
    let user = findByGoogleId.get(profile.id) || findByEmail.get(emailValue);

    if (user) {
      // Link the Google identity to the account that already exists.
      db.prepare(
        "UPDATE users SET google_id = ?, avatar_url = COALESCE(?, avatar_url), updated_at = datetime('now') WHERE id = ?"
      ).run(profile.id, profile.picture || null, user.id);
      user = findById.get(user.id);
    } else {
      // No account with that address. We do not create one: staff
      // accounts come from HR, so an unknown Google account is turned
      // away rather than silently let in.
      return res.redirect(config.clientUrl + "/signin?error=google_unknown");
    }

    setAuthCookie(res, signToken(user));
    res.redirect(config.clientUrl + "/jobs");
  })
);

export default router;

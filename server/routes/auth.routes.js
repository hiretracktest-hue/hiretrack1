import express from "express";
import crypto from "node:crypto";
import { one, many, run } from "../../database/index.js";
import { config, ROLES, ROLE_LABELS } from "../config.js";
import { asyncHandler, requireAuth, httpError } from "../middleware.js";
import * as v from "../validate.js";
import * as audit from "../audit.js";
import { sendMail, deliveryAddress } from "../mail.js";
import { passwordResetEmail } from "../mail-templates.js";
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

const findByEmail = (email) => one("SELECT * FROM users WHERE email = $1", [email]);
const findById = (id) => one("SELECT * FROM users WHERE id = $1", [id]);

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

    const user = await findByEmail(emailValue);
    // Same message either way so the form cannot be used to discover
    // which email addresses are registered.
    const ok = user && user.is_active && (await checkPassword(supplied, user.password_hash));
    if (!ok) {
      if (user && user.is_active && !user.password_hash) {
        throw httpError(401, "This account uses Google sign-in. Use the Google button instead.");
      }
      // A failed attempt is worth recording too - a run of them
      // against one address is what an attack looks like.
      await audit.record(audit.ACTIONS.SIGN_IN_FAILED, {
        actorEmail: emailValue,
        detail: user ? "wrong password" : "no such account",
        req,
      });
      throw httpError(401, "Invalid email or password.");
    }

    await audit.record(audit.ACTIONS.SIGN_IN, { actor: user, req });
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
    const row = await findById(req.user.id);
    const current = typeof req.body.currentPassword === "string" ? req.body.currentPassword : "";

    if (row.password_hash && !(await checkPassword(current, row.password_hash))) {
      throw httpError(400, "Your current password is not correct.");
    }
    const next = v.password(req.body.newPassword, { field: "New password" });

    await run("UPDATE users SET password_hash = $1 WHERE id = $2", [
      await hashPassword(next),
      req.user.id,
    ]);
    await audit.record(audit.ACTIONS.PASSWORD_CHANGED, {
      actor: row,
      detail: "from their profile",
      req,
    });
    res.json({ ok: true });
  })
);

// --- Forgot password -------------------------------------------------
// Emails a one-time link, valid for an hour. Always answers 200 with the
// same message, so the form cannot be used to discover which emails are
// registered.
router.post(
  "/forgot-password",
  asyncHandler(async (req, res) => {
    const emailValue = v.email(req.body.email);
    const typed = String(emailValue).toLowerCase();
    const { inbox } = config.staffMail;

    // Whose password can this reset? The account that signs in with this
    // address, and any account whose real email it is. The company inbox
    // is not an account itself, but mail for staff addresses with no real
    // email of their own comes to it - so typing it offers a reset link
    // for each of those accounts, and whoever reads it picks one.
    const same = (a, b) => String(a || "").toLowerCase() === b;
    const everyone = await many("SELECT * FROM users WHERE is_active ORDER BY id");
    let accounts = everyone.filter((u) => same(u.email, typed) || same(u.contact_email, typed));
    if (!accounts.length && inbox && typed === inbox) {
      accounts = everyone.filter((u) => same(deliveryAddress(u), inbox));
    }

    // The same answer whatever happened, so this form cannot be used to
    // find out which addresses have accounts.
    const payload = {
      message:
        "If that email belongs to an account, a reset link is on its way. Check the inbox - the link expires in 1 hour.",
    };

    // Each link goes where that person's email really goes - the real
    // email on their account, else the company inbox for a staff address,
    // else the address itself. Accounts that share an inbox share one
    // email, with a link for each.
    const byInbox = new Map();
    for (const account of accounts) {
      const to = String(deliveryAddress(account));
      byInbox.set(to, [...(byInbox.get(to) || []), account]);
    }

    let devLink = "";
    for (const [to, group] of byInbox) {
      const links = [];
      for (const account of group) {
        const token = await createResetToken(account.id);
        links.push({
          name: account.name,
          email: account.email,
          roleLabel: ROLE_LABELS[account.role] || account.role,
          link: config.clientUrl + "/reset-password?token=" + token,
        });
        await audit.record(audit.ACTIONS.PASSWORD_RESET_REQUESTED, {
          actor: account,
          detail: group.length > 1 ? "requested from a shared inbox" : "",
          req,
        });
      }

      const result = await sendMail({
        to,
        name: group.length > 1 ? config.companyName : group[0].name,
        ...passwordResetEmail({ accounts: links }),
      });
      console.log(
        "[password reset] for " +
          links.map((l) => l.email).join(", ") +
          ": " +
          (result.sent ? "sent" : "NOT sent (" + result.reason + ")")
      );

      // Working on a laptop with no mail set up, or with mail refusing:
      // show the link on screen so the flow can still be tried. Never on
      // the live site - there the email is the only way to the link.
      if (!config.isProduction && !result.sent && !devLink) devLink = links[0].link;
    }
    if (devLink) payload.devResetUrl = devLink;

    res.json(payload);
  })
);

// --- Reset password with a token -------------------------------------
router.post(
  "/reset-password",
  asyncHandler(async (req, res) => {
    const token = v.str(req.body.token, { field: "Reset token", required: true, max: 200 });
    const next = v.password(req.body.password, { field: "New password" });

    const result = await consumeResetToken(token);
    if (result.error) throw httpError(400, result.error);

    await run("UPDATE users SET password_hash = $1 WHERE id = $2", [
      await hashPassword(next),
      result.userId,
    ]);
    await markResetUsed(result.resetId);
    await audit.record(audit.ACTIONS.PASSWORD_CHANGED, {
      actor: await findById(result.userId),
      detail: "with an emailed reset link",
      req,
    });

    res.json({ ok: true, message: "Password updated. You can sign in now." });
  })
);

// =====================================================================
// Google sign-in - OAuth 2.0 code flow. Only active when
// GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set in .env.
//
// It LINKS to an account that already exists; it never creates one,
// because HR controls who gets in.
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

    if (!profileRes.ok) return res.redirect(config.clientUrl + "/signin?error=google_profile");

    const profile = await profileRes.json();
    if (!profile.email) return res.redirect(config.clientUrl + "/signin?error=google_email");

    const emailValue = String(profile.email).toLowerCase();
    const existing =
      (await one("SELECT * FROM users WHERE google_id = $1", [profile.id])) ||
      (await findByEmail(emailValue));

    if (!existing || !existing.is_active) {
      // No account with that address. We do not create one: staff
      // accounts come from HR, so an unknown Google account is turned
      // away rather than silently let in.
      return res.redirect(config.clientUrl + "/signin?error=google_unknown");
    }

    await run(
      "UPDATE users SET google_id = $1, avatar_url = COALESCE($2, avatar_url) WHERE id = $3",
      [profile.id, profile.picture || null, existing.id]
    );

    const user = await findById(existing.id);
    setAuthCookie(res, signToken(user));
    res.redirect(config.clientUrl + "/dashboard");
  })
);

export default router;

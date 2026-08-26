import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { config, permissionsFor, ROLE_LABELS } from "./config.js";
import { one, run } from "../database/index.js";

export const COOKIE_NAME = "hiretrack_token";

export function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

export function checkPassword(plain, hash) {
  if (!hash) return Promise.resolve(false); // Google-only account
  return bcrypt.compare(plain, hash);
}

export function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch {
    return null;
  }
}

// httpOnly means JavaScript in the browser cannot read the cookie,
// which protects the session from XSS.
export function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProduction,
    maxAge: config.jwtExpiresIn * 1000,
    path: "/",
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProduction,
    path: "/",
  });
}

export function findUserById(id) {
  return one(
    "SELECT id, name, email, role, job_title, avatar_url, google_id, created_at " +
      "FROM users WHERE id = $1 AND is_active",
    [id]
  );
}

export function publicUser(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    role: row.role,
    roleLabel: ROLE_LABELS[row.role] || row.role,
    jobTitle: row.job_title || "",
    // The front end uses this to decide which buttons to show. The API
    // checks the same rules again on every request, so hiding a button
    // is convenience, not security.
    permissions: permissionsFor(row),
    avatarUrl: row.avatar_url || null,
    signedInWithGoogle: Boolean(row.google_id),
    createdAt: row.created_at,
  };
}

// --- password reset tokens -----------------------------------------
// The raw token goes to the user; only its SHA-256 hash is stored, so a
// leaked database still cannot be used to reset anyone's password.
export async function createResetToken(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

  await run(
    "INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
    [userId, tokenHash, expiresAt]
  );

  return token;
}

export async function consumeResetToken(token) {
  const tokenHash = crypto.createHash("sha256").update(String(token)).digest("hex");
  const row = await one("SELECT * FROM password_resets WHERE token_hash = $1", [tokenHash]);

  if (!row) return { error: "This reset link is not valid." };
  if (row.used_at) return { error: "This reset link has already been used." };
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { error: "This reset link has expired. Please request a new one." };
  }
  return { resetId: row.id, userId: row.user_id };
}

export function markResetUsed(resetId) {
  return run("UPDATE password_resets SET used_at = NOW() WHERE id = $1", [resetId]);
}

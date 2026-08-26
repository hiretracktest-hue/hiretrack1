import { COOKIE_NAME, verifyToken, findUserById, publicUser } from "./auth.js";
import { can, ROLE_LABELS } from "./config.js";

/**
 * Reads the login cookie and attaches req.user when it is valid.
 * Never rejects - use requireAuth for routes that must be protected.
 *
 * This is async because the user is fetched from PostgreSQL; any error
 * is passed to next() rather than left as an unhandled rejection.
 */
export async function attachUser(req, _res, next) {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (token) {
      const payload = verifyToken(token);
      if (payload?.sub) {
        req.user = publicUser(await findUserById(payload.sub));
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "You need to sign in to do that." });
  }
  next();
}

/**
 * Guards a route with one named permission from config.js. The message
 * names the role, because "you cannot do that" with no reason is the
 * most annoying error a system can give you.
 */
export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "You need to sign in to do that." });
    }
    if (!can(req.user, permission)) {
      const label = ROLE_LABELS[req.user.role] || req.user.role;
      return res.status(403).json({
        error: "Your role (" + label + ") does not have permission to do that.",
      });
    }
    next();
  };
}

// Wraps an async route handler so a thrown error reaches the error
// handler instead of hanging the request.
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function notFound(_req, res) {
  res.status(404).json({ error: "Endpoint not found." });
}

export function errorHandler(err, _req, res, _next) {
  // Multer and PostgreSQL errors carry codes we can turn into friendly
  // messages instead of a bare 500.
  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ error: "That file is too large. The limit is 5 MB." });
  }
  // 23505 = unique_violation, 23503 = foreign_key_violation,
  // 23514 = check_violation, 22P02 = invalid_text_representation
  if (err?.code === "23505") {
    return res.status(409).json({ error: "That record already exists." });
  }
  if (err?.code === "23503") {
    return res.status(400).json({ error: "That refers to something which does not exist." });
  }
  if (err?.code === "23514" || err?.code === "22P02") {
    return res.status(400).json({ error: "One of the values sent is not valid." });
  }
  if (err?.code === "ECONNREFUSED" || err?.code === "ENOTFOUND") {
    return res.status(503).json({
      error: "Cannot reach the database. Check DATABASE_URL in your .env file.",
    });
  }
  if (err?.status && err?.expose) {
    return res.status(err.status).json({ error: err.message });
  }

  console.error("[error]", err);
  if (err?.sql) console.error("[error] while running:", err.sql.slice(0, 300));
  res.status(500).json({ error: "Something went wrong on our side. Please try again." });
}

// Throw this from a route to return a specific status + message.
export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  err.expose = true;
  return err;
}

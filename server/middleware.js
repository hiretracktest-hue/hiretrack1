import { COOKIE_NAME, verifyToken, findUserById, publicUser } from "./auth.js";

// Reads the login cookie and attaches req.user when it is valid.
// Never rejects - use requireAuth for routes that must be protected.
export function attachUser(req, _res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    const payload = verifyToken(token);
    if (payload?.sub) {
      req.user = publicUser(findUserById(payload.sub));
    }
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "You need to sign in to do that." });
  }
  next();
}

// Only the four group members (developer, scrum master, business
// analyst, QA) run the hiring process. A client signing in from outside
// can apply and watch their own application, nothing else.
export function requireStaff(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "You need to sign in to do that." });
  }
  if (!req.user.isStaff) {
    return res.status(403).json({ error: "Only the hiring team can do that." });
  }
  next();
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
  // Multer and SQLite errors carry codes we can turn into friendly messages.
  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ error: "That file is too large. The limit is 5 MB." });
  }
  if (err?.code === "SQLITE_CONSTRAINT_UNIQUE") {
    return res.status(409).json({ error: "That record already exists." });
  }
  if (err?.status && err?.expose) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error("[error]", err);
  res.status(500).json({ error: "Something went wrong on our side. Please try again." });
}

// Throw this from a route to return a specific status + message.
export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  err.expose = true;
  return err;
}

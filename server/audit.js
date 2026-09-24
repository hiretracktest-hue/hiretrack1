import { run, many, one } from "../database/index.js";

/**
 * AUD-01 - the audit trail.
 *
 * "As an authorised user, I want a system audit log so that
 *  security-sensitive actions within HireTrack can be traced back to
 *  the user who performed them."
 *
 * Only security-sensitive actions are recorded: signing in, creating or
 * changing an account, changing a role, and deleting a candidate or a
 * position. Logging every page view as well would bury those entries in
 * noise and make the log useless for the one job it has.
 *
 * A failure to write the log must never fail the action it describes.
 * Refusing a sign-in because an audit row could not be inserted would
 * turn a logging problem into an outage, so every call here swallows
 * its own errors and reports them to the console instead.
 */

export const ACTIONS = {
  SIGN_IN: "user.signed_in",
  SIGN_IN_FAILED: "user.sign_in_failed",
  USER_CREATED: "user.created",
  USER_ROLE_CHANGED: "user.role_changed",
  USER_DEACTIVATED: "user.deactivated",
  USER_REACTIVATED: "user.reactivated",
  PASSWORD_CHANGED: "user.password_changed",
  PASSWORD_RESET_REQUESTED: "user.password_reset_requested",
  CONTACT_EMAIL_CHANGED: "user.contact_email_changed",
  CANDIDATE_DELETED: "candidate.deleted",
  JOB_DELETED: "job.deleted",
  CV_DOWNLOADED: "candidate.cv_downloaded",
  // Taking a copy of the log out of the system is itself worth a line
  // in the log.
  AUDIT_EXPORTED: "audit.exported",
};

/**
 * The caller's address, for the log only.
 *
 * Behind a host's proxy the socket address is the proxy, not the
 * visitor, so x-forwarded-for is what matters - app.js sets
 * trust proxy in production, which is what makes req.ip honour it.
 */
function addressOf(req) {
  if (!req) return "";
  return String(req.ip || req.socket?.remoteAddress || "").replace("::ffff:", "");
}

/**
 * Record one action.
 *
 * `actor` is the user who did it. For a failed sign-in there is no
 * signed-in user, so pass whatever identifies the attempt - the email
 * that was tried - and leave the id null.
 */
export async function record(
  action,
  { actor = null, actorEmail = "", subjectType = "", subjectId = null, detail = "", req = null } = {}
) {
  try {
    await run(
      "INSERT INTO audit_log (action, actor_id, actor_email, actor_name, subject_type, " +
        "subject_id, detail, ip) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [
        action,
        actor?.id ?? null,
        actor?.email || actorEmail || "",
        actor?.name || "",
        subjectType,
        subjectId,
        detail,
        addressOf(req),
      ]
    );
  } catch (err) {
    console.error("[audit] could not record " + action + ": " + err.message);
  }
}

/** The log, newest first, for whoever is allowed to read it. */
export async function list({ limit = 100, action = "", actorId = null } = {}) {
  const where = [];
  const params = [];

  if (action) {
    params.push(action);
    where.push("a.action = $" + params.length);
  }
  if (actorId) {
    params.push(actorId);
    where.push("a.actor_id = $" + params.length);
  }

  params.push(Math.min(Number(limit) || 100, 500));

  const rows = await many(
    "SELECT a.*, u.name AS current_name FROM audit_log a " +
      "LEFT JOIN users u ON u.id = a.actor_id " +
      (where.length ? "WHERE " + where.join(" AND ") + " " : "") +
      "ORDER BY a.created_at DESC LIMIT $" + params.length,
    params
  );

  return rows.map((row) => ({
    id: Number(row.id),
    action: row.action,
    // The name as it is now if the account still exists, then the copy
    // taken at the time, then the address that was used. A failed
    // sign-in has no account behind it at all, so the attempted address
    // is the only identity there is - and calling that "(deleted
    // account)" would be actively misleading.
    actorName:
      row.current_name || row.actor_name || row.actor_email || "(unknown)",
    actorEmail: row.actor_email,
    subjectType: row.subject_type,
    subjectId: row.subject_id ? Number(row.subject_id) : null,
    detail: row.detail,
    ip: row.ip,
    createdAt: row.created_at,
  }));
}

/** How many of each action, for the summary line above the log. */
export async function counts() {
  const rows = await many(
    "SELECT action, COUNT(*)::int AS total FROM audit_log GROUP BY action ORDER BY total DESC"
  );
  const total = await one("SELECT COUNT(*)::int AS total FROM audit_log");
  return { total: total.total, byAction: rows };
}

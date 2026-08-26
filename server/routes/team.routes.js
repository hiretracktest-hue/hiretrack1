import express from "express";
import { db } from "../db/index.js";
import { config, ROLES, ROLE_LABELS, ROLE_DESCRIPTIONS, PERMISSIONS } from "../config.js";
import { asyncHandler, requireAuth, requirePermission, httpError } from "../middleware.js";
import * as v from "../validate.js";
import { publicUser, hashPassword } from "../auth.js";

/**
 * The people who log in: HR, hiring managers, interviewers and
 * management. Accounts are created here by HR - there is no public
 * sign-up, because this is an internal system.
 */
const router = express.Router();

const memberRow = (row) => ({
  ...publicUser(row),
  roleLabel: ROLE_LABELS[row.role] || row.role,
  roleDescription: ROLE_DESCRIPTIONS[row.role] || "",
  isActive: Boolean(row.is_active),
  positionsOpened: row.positions_opened ?? 0,
  interviewsBooked: row.interviews_booked ?? 0,
  feedbackGiven: row.feedback_given ?? 0,
});

const LIST_SQL =
  "SELECT u.*, " +
  "(SELECT COUNT(*) FROM jobs j WHERE j.created_by = u.id) AS positions_opened, " +
  "(SELECT COUNT(*) FROM interviews i WHERE i.interviewer_id = u.id) AS interviews_booked, " +
  "(SELECT COUNT(*) FROM feedback f WHERE f.author_id = u.id) AS feedback_given " +
  "FROM users u ";

// --- Who logs in, and what can each role do ----------------------------
router.get(
  "/",
  requirePermission("team:view"),
  asyncHandler(async (_req, res) => {
    const rows = db.prepare(LIST_SQL + "ORDER BY u.is_active DESC, u.name ASC").all();

    res.json({
      roles: ROLES.map((value) => ({
        value,
        label: ROLE_LABELS[value],
        description: ROLE_DESCRIPTIONS[value],
      })),
      permissionMatrix: PERMISSIONS,
      members: rows.map(memberRow),
    });
  })
);

// --- Interviewers, for the "who is running this interview?" picker -----
router.get(
  "/interviewers",
  requirePermission("interview:view"),
  asyncHandler(async (_req, res) => {
    const rows = db
      .prepare(
        "SELECT id, name, email, role FROM users WHERE is_active = 1 " +
          "AND role IN ('hr','hiring_manager','interviewer') ORDER BY name ASC"
      )
      .all();
    res.json({
      interviewers: rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        roleLabel: ROLE_LABELS[row.role],
      })),
    });
  })
);

// --- Update my own profile (name and job title only) -------------------
router.patch(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    // Nobody changes their own role here - not an interviewer promoting
    // themselves to HR. Only HR can set a role.
    if (req.body.role !== undefined) {
      throw httpError(403, "Ask HR to change your role.");
    }

    const fields = [];
    const params = [];
    if (req.body.name !== undefined) {
      fields.push("name = ?");
      params.push(v.str(req.body.name, { field: "Full name", required: true, max: 120, min: 2 }));
    }
    if (req.body.jobTitle !== undefined) {
      fields.push("job_title = ?");
      params.push(v.str(req.body.jobTitle, { field: "Job title", max: 120 }));
    }
    if (!fields.length) throw httpError(400, "Nothing to update.");

    params.push(req.user.id);
    db.prepare(
      "UPDATE users SET " + fields.join(", ") + ", updated_at = datetime('now') WHERE id = ?"
    ).run(...params);

    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    res.json({ user: publicUser(row) });
  })
);

// --- HR creates a staff account ----------------------------------------
router.post(
  "/members",
  requirePermission("team:manage"),
  asyncHandler(async (req, res) => {
    const name = v.str(req.body.name, { field: "Full name", required: true, max: 120, min: 2 });
    const emailValue = v.email(req.body.email);
    const role = v.oneOf(req.body.role, ROLES, { field: "Role" });
    const jobTitle = v.str(req.body.jobTitle, { field: "Job title", max: 120 });
    const pw = v.password(req.body.password);

    if (db.prepare("SELECT id FROM users WHERE email = ?").get(emailValue)) {
      throw httpError(409, "An account with this email already exists.");
    }

    const info = db
      .prepare(
        "INSERT INTO users (name, email, password_hash, role, job_title) VALUES (?, ?, ?, ?, ?)"
      )
      .run(name, emailValue, await hashPassword(pw), role, jobTitle);

    const row = db.prepare(LIST_SQL + "WHERE u.id = ?").get(info.lastInsertRowid);
    res.status(201).json({ member: memberRow(row) });
  })
);

// --- HR changes a role, or deactivates an account ----------------------
router.patch(
  "/members/:id",
  requirePermission("team:manage"),
  asyncHandler(async (req, res) => {
    const id = v.id(req.params.id, { field: "user id" });
    const target = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    if (!target) throw httpError(404, "That person does not exist.");

    const fields = [];
    const params = [];

    if (req.body.role !== undefined) {
      const role = v.oneOf(req.body.role, ROLES, { field: "Role" });
      // Never leave the system with no HR account - nobody could then
      // open a position or create an account again.
      if (target.role === "hr" && role !== "hr") {
        const hrCount = db
          .prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'hr' AND is_active = 1")
          .get().total;
        if (hrCount <= 1) throw httpError(400, "There has to be at least one active HR account.");
      }
      fields.push("role = ?");
      params.push(role);
    }

    if (req.body.isActive !== undefined) {
      const active = req.body.isActive ? 1 : 0;
      if (!active && target.id === req.user.id) {
        throw httpError(400, "You cannot deactivate your own account.");
      }
      if (!active && target.role === "hr") {
        const hrCount = db
          .prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'hr' AND is_active = 1")
          .get().total;
        if (hrCount <= 1) throw httpError(400, "There has to be at least one active HR account.");
      }
      fields.push("is_active = ?");
      params.push(active);
    }

    if (!fields.length) throw httpError(400, "Nothing to update.");

    params.push(id);
    db.prepare(
      "UPDATE users SET " + fields.join(", ") + ", updated_at = datetime('now') WHERE id = ?"
    ).run(...params);

    const row = db.prepare(LIST_SQL + "WHERE u.id = ?").get(id);
    res.json({ member: memberRow(row) });
  })
);

// --- Dashboard numbers --------------------------------------------------
router.get(
  "/stats",
  requireAuth,
  asyncHandler(async (req, res) => {
    const one = (sql, ...params) => db.prepare(sql).get(...params).value;

    res.json({
      openPositions: one("SELECT COUNT(*) AS value FROM jobs WHERE status = 'ACTIVE'"),
      closedPositions: one("SELECT COUNT(*) AS value FROM jobs WHERE status = 'CLOSED'"),
      totalCandidates: one("SELECT COUNT(*) AS value FROM candidates"),
      activeCandidates: one("SELECT COUNT(*) AS value FROM candidates WHERE outcome = 'ACTIVE'"),
      onHold: one("SELECT COUNT(*) AS value FROM candidates WHERE outcome = 'ON_HOLD'"),
      hired: one("SELECT COUNT(*) AS value FROM candidates WHERE outcome = 'HIRED'"),
      rejected: one("SELECT COUNT(*) AS value FROM candidates WHERE outcome = 'REJECTED'"),
      cvsOnFile: one("SELECT COUNT(*) AS value FROM candidates WHERE cv_stored_name IS NOT NULL"),
      awaitingScreening: one(
        "SELECT COUNT(*) AS value FROM candidates WHERE cv_band = 'UNRATED' AND cv_stored_name IS NOT NULL"
      ),
      upcomingInterviews: one(
        "SELECT COUNT(*) AS value FROM interviews WHERE datetime(scheduled_at) >= datetime('now')"
      ),
      myUpcomingInterviews: one(
        "SELECT COUNT(*) AS value FROM interviews WHERE interviewer_id = ? " +
          "AND datetime(scheduled_at) >= datetime('now')",
        req.user.id
      ),
      myOutstandingFeedback: one(
        "SELECT COUNT(*) AS value FROM interviews i WHERE i.interviewer_id = ? " +
          "AND datetime(i.scheduled_at) < datetime('now') " +
          "AND NOT EXISTS (SELECT 1 FROM feedback f WHERE f.candidate_id = i.candidate_id " +
          "  AND f.stage = i.stage AND f.author_id = i.interviewer_id)",
        req.user.id
      ),
      feedbackSubmitted: one("SELECT COUNT(*) AS value FROM feedback"),
      teamMembers: one("SELECT COUNT(*) AS value FROM users WHERE is_active = 1"),
      pendingEmails: one(
        "SELECT COUNT(*) AS value FROM notifications WHERE channel = 'EMAIL' AND sent_at IS NULL"
      ),
      googleEnabled: config.google.enabled,
    });
  })
);

export default router;

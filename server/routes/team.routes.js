import express from "express";
import { one, many, run } from "../../database/index.js";
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
  roleDescription: ROLE_DESCRIPTIONS[row.role] || "",
  isActive: Boolean(row.is_active),
  positionsOpened: Number(row.positions_opened ?? 0),
  interviewsBooked: Number(row.interviews_booked ?? 0),
  feedbackGiven: Number(row.feedback_given ?? 0),
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
    const rows = await many(LIST_SQL + "ORDER BY u.is_active DESC, u.name ASC");

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
    const rows = await many(
      "SELECT id, name, email, role FROM users WHERE is_active " +
        "AND role IN ('hr', 'hiring_manager', 'interviewer') ORDER BY name ASC"
    );
    res.json({
      interviewers: rows.map((row) => ({
        id: Number(row.id),
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

    const sets = [];
    const params = [];
    const push = (column, value) => {
      params.push(value);
      sets.push(column + " = $" + params.length);
    };

    if (req.body.name !== undefined) {
      push("name", v.str(req.body.name, { field: "Full name", required: true, max: 120, min: 2 }));
    }
    if (req.body.jobTitle !== undefined) {
      push("job_title", v.str(req.body.jobTitle, { field: "Job title", max: 120 }));
    }
    if (!sets.length) throw httpError(400, "Nothing to update.");

    params.push(req.user.id);
    await run("UPDATE users SET " + sets.join(", ") + " WHERE id = $" + params.length, params);

    const row = await one("SELECT * FROM users WHERE id = $1", [req.user.id]);
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

    if (await one("SELECT id FROM users WHERE email = $1", [emailValue])) {
      throw httpError(409, "An account with this email already exists.");
    }

    const created = await one(
      "INSERT INTO users (name, email, password_hash, role, job_title) " +
        "VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [name, emailValue, await hashPassword(pw), role, jobTitle]
    );

    const row = await one(LIST_SQL + "WHERE u.id = $1", [created.id]);
    res.status(201).json({ member: memberRow(row) });
  })
);

// --- HR changes a role, or deactivates an account ----------------------
router.patch(
  "/members/:id",
  requirePermission("team:manage"),
  asyncHandler(async (req, res) => {
    const id = v.id(req.params.id, { field: "user id" });
    const target = await one("SELECT * FROM users WHERE id = $1", [id]);
    if (!target) throw httpError(404, "That person does not exist.");

    const sets = [];
    const params = [];
    const push = (column, value) => {
      params.push(value);
      sets.push(column + " = $" + params.length);
    };

    const countActiveHr = async () => {
      const { count } = await one(
        "SELECT COUNT(*)::int AS count FROM users WHERE role = 'hr' AND is_active"
      );
      return count;
    };

    if (req.body.role !== undefined) {
      const role = v.oneOf(req.body.role, ROLES, { field: "Role" });
      // Never leave the system with no HR account - nobody could then
      // open a position or create an account again.
      if (target.role === "hr" && role !== "hr" && (await countActiveHr()) <= 1) {
        throw httpError(400, "There has to be at least one active HR account.");
      }
      push("role", role);
    }

    if (req.body.isActive !== undefined) {
      const active = Boolean(req.body.isActive);
      if (!active && Number(target.id) === req.user.id) {
        throw httpError(400, "You cannot deactivate your own account.");
      }
      if (!active && target.role === "hr" && (await countActiveHr()) <= 1) {
        throw httpError(400, "There has to be at least one active HR account.");
      }
      push("is_active", active);
    }

    if (!sets.length) throw httpError(400, "Nothing to update.");

    params.push(id);
    await run("UPDATE users SET " + sets.join(", ") + " WHERE id = $" + params.length, params);

    const row = await one(LIST_SQL + "WHERE u.id = $1", [id]);
    res.json({ member: memberRow(row) });
  })
);

// --- Dashboard numbers --------------------------------------------------
router.get(
  "/stats",
  requireAuth,
  asyncHandler(async (req, res) => {
    const row = await one(
      `SELECT
        (SELECT COUNT(*) FROM jobs WHERE status = 'ACTIVE')                 AS open_positions,
        (SELECT COUNT(*) FROM jobs WHERE status = 'CLOSED')                 AS closed_positions,
        (SELECT COUNT(*) FROM candidates)                                   AS total_candidates,
        (SELECT COUNT(*) FROM candidates WHERE outcome = 'ACTIVE')          AS active_candidates,
        (SELECT COUNT(*) FROM candidates WHERE outcome = 'ON_HOLD')         AS on_hold,
        (SELECT COUNT(*) FROM candidates WHERE outcome = 'HIRED')           AS hired,
        (SELECT COUNT(*) FROM candidates WHERE outcome = 'REJECTED')        AS rejected,
        (SELECT COUNT(*) FROM candidates WHERE cv_stored_name IS NOT NULL)  AS cvs_on_file,
        (SELECT COUNT(*) FROM candidates
          WHERE cv_band = 'UNRATED' AND cv_stored_name IS NOT NULL)         AS awaiting_screening,
        (SELECT COUNT(*) FROM interviews WHERE scheduled_at >= NOW())       AS upcoming_interviews,
        (SELECT COUNT(*) FROM interviews
          WHERE interviewer_id = $1 AND scheduled_at >= NOW())              AS my_upcoming_interviews,
        (SELECT COUNT(*) FROM interviews i
          WHERE i.interviewer_id = $1 AND i.scheduled_at < NOW()
            AND NOT EXISTS (SELECT 1 FROM feedback f WHERE f.candidate_id = i.candidate_id
                              AND f.stage = i.stage AND f.author_id = i.interviewer_id))
                                                                            AS my_outstanding_feedback,
        (SELECT COUNT(*) FROM feedback)                                     AS feedback_submitted,
        (SELECT COUNT(*) FROM users WHERE is_active)                        AS team_members,
        (SELECT COUNT(*) FROM notifications
          WHERE channel = 'EMAIL' AND sent_at IS NULL)                      AS pending_emails`,
      [req.user.id]
    );

    res.json({
      openPositions: Number(row.open_positions),
      closedPositions: Number(row.closed_positions),
      totalCandidates: Number(row.total_candidates),
      activeCandidates: Number(row.active_candidates),
      onHold: Number(row.on_hold),
      hired: Number(row.hired),
      rejected: Number(row.rejected),
      cvsOnFile: Number(row.cvs_on_file),
      awaitingScreening: Number(row.awaiting_screening),
      upcomingInterviews: Number(row.upcoming_interviews),
      myUpcomingInterviews: Number(row.my_upcoming_interviews),
      myOutstandingFeedback: Number(row.my_outstanding_feedback),
      feedbackSubmitted: Number(row.feedback_submitted),
      teamMembers: Number(row.team_members),
      pendingEmails: Number(row.pending_emails),
      googleEnabled: config.google.enabled,
      mailEnabled: config.smtp.enabled,
    });
  })
);

export default router;

import express from "express";
import { db } from "../db/index.js";
import { config, TEAM_ROLES, CLIENT_ROLE, ROLE_LABELS } from "../config.js";
import { asyncHandler, requireAuth, requireStaff, httpError } from "../middleware.js";
import * as v from "../validate.js";
import { publicUser } from "../auth.js";

const router = express.Router();

// --- The project team --------------------------------------------------
// Our group is four people - Developer, Scrum Master, Business Analyst
// and QA. The role is a label for the report; everyone has exactly the
// same permissions in the system.
router.get(
  "/",
  requireStaff,
  asyncHandler(async (_req, res) => {
    const rows = db
      .prepare(
        "SELECT u.id, u.name, u.email, u.role, u.avatar_url, u.google_id, u.created_at, " +
          "(SELECT COUNT(*) FROM jobs j WHERE j.created_by = u.id) AS jobs_created " +
          "FROM users u WHERE u.role != 'client' ORDER BY u.name ASC"
      )
      .all();

    res.json({
      roles: TEAM_ROLES.map((value) => ({ value, label: ROLE_LABELS[value] })),
      members: rows.map((row) => ({
        ...publicUser(row),
        roleLabel: ROLE_LABELS[row.role] || row.role,
        jobsCreated: row.jobs_created,
      })),
    });
  })
);

// --- Update my own profile ---------------------------------------------
router.patch(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const fields = [];
    const params = [];

    if (req.body.name !== undefined) {
      fields.push("name = ?");
      params.push(v.str(req.body.name, { field: "Full name", required: true, max: 120, min: 2 }));
    }
    if (req.body.role !== undefined) {
      fields.push("role = ?");
      // Nobody can promote themselves from client to staff, or demote
      // themselves out of the team, through this endpoint.
      const allowed = req.user.isStaff ? TEAM_ROLES : [CLIENT_ROLE];
      params.push(v.oneOf(req.body.role, allowed, { field: "Role" }));
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

// --- Dashboard numbers --------------------------------------------------
router.get(
  "/stats",
  requireStaff,
  asyncHandler(async (_req, res) => {
    const one = (sql, ...params) => db.prepare(sql).get(...params).value;

    res.json({
      openVacancies: one("SELECT COUNT(*) AS value FROM jobs WHERE status = 'ACTIVE'"),
      closedVacancies: one("SELECT COUNT(*) AS value FROM jobs WHERE status = 'CLOSED'"),
      totalApplications: one("SELECT COUNT(*) AS value FROM applications"),
      activeCandidates: one("SELECT COUNT(*) AS value FROM applications WHERE outcome = 'ACTIVE'"),
      hired: one("SELECT COUNT(*) AS value FROM applications WHERE outcome = 'HIRED'"),
      rejected: one("SELECT COUNT(*) AS value FROM applications WHERE outcome = 'REJECTED'"),
      cvsOnFile: one("SELECT COUNT(*) AS value FROM applications WHERE cv_stored_name IS NOT NULL"),
      upcomingInterviews: one(
        "SELECT COUNT(*) AS value FROM interviews WHERE datetime(scheduled_at) >= datetime('now')"
      ),
      teamMembers: one("SELECT COUNT(*) AS value FROM users WHERE role != 'client'"),
      clients: one("SELECT COUNT(*) AS value FROM users WHERE role = 'client'"),
      cvsAwaitingReview: one(
        "SELECT COUNT(*) AS value FROM applications WHERE cv_stored_name IS NOT NULL AND cv_status = 'PENDING'"
      ),
      feedbackLeft: one("SELECT COUNT(*) AS value FROM feedback"),
      googleEnabled: config.google.enabled,
    });
  })
);

export default router;

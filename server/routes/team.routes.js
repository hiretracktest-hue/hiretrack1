import express from "express";
import { db } from "../db/index.js";
import { config, STAFF_ROLES, ROLE_CANDIDATE, ROLE_LABELS, ROLE_DESCRIPTIONS, PERMISSIONS } from "../config.js";
import { asyncHandler, requireAuth, requirePermission, httpError } from "../middleware.js";
import { hashPassword } from "../auth.js";
import * as v from "../validate.js";
import { publicUser } from "../auth.js";

const router = express.Router();

// --- The project team --------------------------------------------------
// Our group is four people - Developer, Scrum Master, Business Analyst
// and QA. The role is a label for the report; everyone has exactly the
// same permissions in the system.
router.get(
  "/",
  requirePermission("team:view"),
  asyncHandler(async (_req, res) => {
    const rows = db
      .prepare(
        "SELECT u.id, u.name, u.email, u.role, u.avatar_url, u.google_id, u.created_at, " +
          "(SELECT COUNT(*) FROM jobs j WHERE j.created_by = u.id) AS jobs_created " +
          "FROM users u WHERE u.role != 'candidate' ORDER BY u.name ASC"
      )
      .all();

    res.json({
      roles: STAFF_ROLES.map((value) => ({
        value,
        label: ROLE_LABELS[value],
        description: ROLE_DESCRIPTIONS[value],
      })),
      permissionMatrix: Object.fromEntries(
        Object.entries(PERMISSIONS).map(([key, roles]) => [key, roles])
      ),
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
    // Nobody changes their own role here - not a candidate promoting
    // themselves to staff, and not an interviewer promoting themselves
    // to HR. Only HR can set someone's role, from the team page.
    if (req.body.role !== undefined) {
      throw httpError(403, "Ask HR to change your role.");
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
  requirePermission("stats:view"),
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
      teamMembers: one("SELECT COUNT(*) AS value FROM users WHERE role != 'candidate'"),
      candidateAccounts: one("SELECT COUNT(*) AS value FROM users WHERE role = 'candidate'"),
      cvsHigh: one("SELECT COUNT(*) AS value FROM applications WHERE cv_band = 'HIGH'"),
      cvsUnrated: one(
        "SELECT COUNT(*) AS value FROM applications WHERE cv_band = 'UNRATED' AND cv_stored_name IS NOT NULL"
      ),
      cvsAwaitingReview: one(
        "SELECT COUNT(*) AS value FROM applications WHERE cv_stored_name IS NOT NULL AND cv_status = 'PENDING'"
      ),
      feedbackLeft: one("SELECT COUNT(*) AS value FROM feedback"),
      googleEnabled: config.google.enabled,
    });
  })
);

// =====================================================================
// Staff accounts. In a real company nobody signs themselves up as HR,
// so these two routes are HR-only: HR creates the accounts and HR sets
// the roles.
// =====================================================================
router.post(
  "/members",
  requirePermission("vacancy:create"), // HR only - same role gate
  asyncHandler(async (req, res) => {
    const name = v.str(req.body.name, { field: "Full name", required: true, max: 120, min: 2 });
    const emailValue = v.email(req.body.email);
    const role = v.oneOf(req.body.role, STAFF_ROLES, { field: "Role" });
    const pw = v.password(req.body.password);

    if (db.prepare("SELECT id FROM users WHERE email = ?").get(emailValue)) {
      throw httpError(409, "An account with this email already exists.");
    }

    const info = db
      .prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)")
      .run(name, emailValue, await hashPassword(pw), role);

    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
    res.status(201).json({ member: { ...publicUser(row), roleLabel: ROLE_LABELS[row.role] } });
  })
);

router.patch(
  "/members/:id",
  requirePermission("vacancy:create"), // HR only
  asyncHandler(async (req, res) => {
    const id = v.id(req.params.id, { field: "user id" });
    const target = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    if (!target) throw httpError(404, "That person does not exist.");
    if (target.role === ROLE_CANDIDATE) {
      throw httpError(400, "That account is a candidate, not a member of the hiring team.");
    }

    const role = v.oneOf(req.body.role, STAFF_ROLES, { field: "Role" });

    // Do not let the last HR account demote itself and lock everyone out
    // of vacancy management.
    if (target.role === "hr" && role !== "hr") {
      const hrCount = db.prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'hr'").get().total;
      if (hrCount <= 1) throw httpError(400, "There has to be at least one HR account.");
    }

    db.prepare("UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?").run(role, id);
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    res.json({ member: { ...publicUser(row), roleLabel: ROLE_LABELS[row.role] } });
  })
);

export default router;

import path from "node:path";
import express from "express";
import { db } from "../db/index.js";
import { asyncHandler, requireAuth, httpError } from "../middleware.js";
import * as v from "../validate.js";
import { stagesFor } from "./jobs.routes.js";
import { UPLOAD_DIR, uploadCv, deleteStoredFile, safeFilename } from "../upload.js";

const router = express.Router();

const OUTCOMES = ["ACTIVE", "ON_HOLD", "HIRED", "REJECTED"];

const selectOne = db.prepare(
  "SELECT a.*, j.title AS job_title, j.status AS job_status, j.department AS job_department, " +
    "j.location AS job_location, u.name AS applied_by_name " +
    "FROM applications a " +
    "JOIN jobs j ON j.id = a.job_id " +
    "LEFT JOIN users u ON u.id = a.user_id " +
    "WHERE a.id = ?"
);

function toJson(row) {
  if (!row) return null;
  return {
    id: row.id,
    jobId: row.job_id,
    jobTitle: row.job_title,
    jobStatus: row.job_status,
    jobDepartment: row.job_department,
    jobLocation: row.job_location,
    userId: row.user_id,
    appliedByName: row.applied_by_name ?? null,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    source: row.source,
    coverNote: row.cover_note,
    notes: row.notes,
    currentStage: row.current_stage,
    outcome: row.outcome,
    cv: row.cv_filename
      ? {
          filename: row.cv_filename,
          mime: row.cv_mime,
          size: row.cv_size,
          uploadedAt: row.cv_uploaded_at,
        }
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function loadOr404(id) {
  const row = selectOne.get(id);
  if (!row) throw httpError(404, "That application does not exist.");
  return row;
}

// --- List applications ------------------------------------------------
// Every signed-in team member sees every application (all four roles are
// on the same access level). "mine=1" narrows it to your own.
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const where = [];
    const params = [];

    if (req.query.job) {
      where.push("a.job_id = ?");
      params.push(v.id(req.query.job, { field: "vacancy id" }));
    }
    if (req.query.outcome) {
      where.push("a.outcome = ?");
      params.push(v.oneOf(String(req.query.outcome), OUTCOMES, { field: "Outcome" }));
    }
    if (req.query.stage) {
      where.push("a.current_stage = ?");
      params.push(String(req.query.stage));
    }
    if (req.query.mine === "1") {
      where.push("a.user_id = ?");
      params.push(req.user.id);
    }
    const search = String(req.query.q || "").trim();
    if (search) {
      where.push("(a.full_name LIKE ? OR a.email LIKE ?)");
      const like = "%" + search + "%";
      params.push(like, like);
    }

    const sql =
      "SELECT a.*, j.title AS job_title, j.status AS job_status, j.department AS job_department, " +
      "j.location AS job_location, u.name AS applied_by_name " +
      "FROM applications a " +
      "JOIN jobs j ON j.id = a.job_id " +
      "LEFT JOIN users u ON u.id = a.user_id " +
      (where.length ? "WHERE " + where.join(" AND ") + " " : "") +
      "ORDER BY datetime(a.created_at) DESC";

    const rows = db.prepare(sql).all(...params);
    res.json({ applications: rows.map(toJson) });
  })
);

// --- One application (with its pipeline and interviews) ---------------
router.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = v.id(req.params.id, { field: "application id" });
    const row = loadOr404(id);
    const stages = stagesFor(row.job_id);
    const interviews = db
      .prepare(
        "SELECT i.*, u.name AS created_by_name FROM interviews i " +
          "LEFT JOIN users u ON u.id = i.created_by " +
          "WHERE i.application_id = ? ORDER BY datetime(i.scheduled_at) ASC"
      )
      .all(id)
      .map((iv) => ({
        id: iv.id,
        stage: iv.stage,
        scheduledAt: iv.scheduled_at,
        interviewerName: iv.interviewer_name,
        interviewerEmail: iv.interviewer_email,
        notes: iv.notes,
        createdByName: iv.created_by_name,
      }));

    const application = toJson(row);
    const index = stages.indexOf(application.currentStage);
    application.stages = stages;
    application.nextStage = index >= 0 && index < stages.length - 1 ? stages[index + 1] : null;

    res.json({ application, interviews });
  })
);

// --- Apply to a vacancy -----------------------------------------------
router.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const jobId = v.id(req.body.jobId, { field: "vacancy id" });
    const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
    if (!job) throw httpError(404, "That vacancy does not exist.");
    if (job.status !== "ACTIVE") throw httpError(400, "This vacancy is closed for applications.");

    const stages = stagesFor(jobId);
    if (!stages.length) {
      throw httpError(400, "This vacancy has no interview stages set up yet.");
    }

    const fullName = v.str(req.body.fullName, {
      field: "Full name",
      required: true,
      max: 120,
      min: 2,
    });
    const emailValue = v.email(req.body.email);
    const phone = v.str(req.body.phone, { field: "Phone", max: 40 });
    const source = v.str(req.body.source, { field: "Source", max: 80 });
    const coverNote = v.str(req.body.coverNote, { field: "Cover note", max: 2000 });

    const duplicate = db
      .prepare("SELECT id FROM applications WHERE job_id = ? AND email = ?")
      .get(jobId, emailValue);
    if (duplicate) {
      throw httpError(409, "There is already an application for this vacancy with that email.");
    }

    const info = db
      .prepare(
        "INSERT INTO applications (job_id, user_id, full_name, email, phone, source, cover_note, current_stage) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(jobId, req.user.id, fullName, emailValue, phone, source, coverNote, stages[0]);

    res.status(201).json({ application: toJson(selectOne.get(info.lastInsertRowid)) });
  })
);

// --- Edit details / stage / outcome -----------------------------------
router.patch(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = v.id(req.params.id, { field: "application id" });
    const existing = loadOr404(id);

    const fields = [];
    const params = [];
    const push = (column, value) => {
      fields.push(column + " = ?");
      params.push(value);
    };

    if (req.body.fullName !== undefined) {
      push("full_name", v.str(req.body.fullName, { field: "Full name", required: true, max: 120 }));
    }
    if (req.body.email !== undefined) push("email", v.email(req.body.email));
    if (req.body.phone !== undefined) {
      push("phone", v.str(req.body.phone, { field: "Phone", max: 40 }));
    }
    if (req.body.source !== undefined) {
      push("source", v.str(req.body.source, { field: "Source", max: 80 }));
    }
    if (req.body.coverNote !== undefined) {
      push("cover_note", v.str(req.body.coverNote, { field: "Cover note", max: 2000 }));
    }
    if (req.body.notes !== undefined) {
      push("notes", v.str(req.body.notes, { field: "Notes", max: 2000 }));
    }
    if (req.body.outcome !== undefined) {
      push("outcome", v.oneOf(req.body.outcome, OUTCOMES, { field: "Outcome" }));
    }
    if (req.body.currentStage !== undefined) {
      // A candidate can only sit on a stage this vacancy actually has.
      const stages = stagesFor(existing.job_id);
      push("current_stage", v.oneOf(req.body.currentStage, stages, { field: "Stage" }));
    }

    if (!fields.length) throw httpError(400, "Nothing to update.");

    params.push(id);
    try {
      db.prepare(
        "UPDATE applications SET " + fields.join(", ") + ", updated_at = datetime('now') WHERE id = ?"
      ).run(...params);
    } catch (err) {
      if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
        throw httpError(409, "Another application for this vacancy already uses that email.");
      }
      throw err;
    }

    res.json({ application: toJson(selectOne.get(id)) });
  })
);

// --- Move to the next stage in the pipeline ---------------------------
router.post(
  "/:id/advance",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = v.id(req.params.id, { field: "application id" });
    const existing = loadOr404(id);

    const stages = stagesFor(existing.job_id);
    const index = stages.indexOf(existing.current_stage);
    if (index === -1) throw httpError(400, "This candidate's stage is no longer in the pipeline.");
    if (index >= stages.length - 1) {
      throw httpError(400, "This candidate is already at the final stage.");
    }

    db.prepare(
      "UPDATE applications SET current_stage = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(stages[index + 1], id);

    res.json({ application: toJson(selectOne.get(id)), stages });
  })
);

// --- Upload or replace the CV -----------------------------------------
router.post(
  "/:id/cv",
  requireAuth,
  (req, res, next) => uploadCv(req, res, (err) => (err ? next(err) : next())),
  asyncHandler(async (req, res) => {
    const id = v.id(req.params.id, { field: "application id" });
    const existing = selectOne.get(id);

    if (!existing) {
      deleteStoredFile(req.file?.filename); // do not leave an orphan file behind
      throw httpError(404, "That application does not exist.");
    }
    if (!req.file) throw httpError(400, "Choose a CV file to upload.");

    const previous = existing.cv_stored_name;

    db.prepare(
      "UPDATE applications SET cv_filename = ?, cv_stored_name = ?, cv_mime = ?, cv_size = ?, " +
        "cv_uploaded_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
    ).run(
      safeFilename(req.file.originalname),
      req.file.filename,
      req.file.mimetype,
      req.file.size,
      id
    );

    deleteStoredFile(previous);
    res.json({ application: toJson(selectOne.get(id)) });
  })
);

// --- Download the CV ---------------------------------------------------
router.get(
  "/:id/cv",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = v.id(req.params.id, { field: "application id" });
    const row = loadOr404(id);
    if (!row.cv_stored_name) throw httpError(404, "No CV has been uploaded yet.");

    const filePath = path.join(UPLOAD_DIR, path.basename(row.cv_stored_name));
    res.download(filePath, safeFilename(row.cv_filename), (err) => {
      if (err && !res.headersSent) {
        res.status(404).json({ error: "The stored CV file is missing from the server." });
      }
    });
  })
);

// --- Remove the CV -----------------------------------------------------
router.delete(
  "/:id/cv",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = v.id(req.params.id, { field: "application id" });
    const row = loadOr404(id);
    if (!row.cv_stored_name) throw httpError(404, "No CV has been uploaded yet.");

    db.prepare(
      "UPDATE applications SET cv_filename = NULL, cv_stored_name = NULL, cv_mime = NULL, " +
        "cv_size = NULL, cv_uploaded_at = NULL, updated_at = datetime('now') WHERE id = ?"
    ).run(id);
    deleteStoredFile(row.cv_stored_name);

    res.json({ application: toJson(selectOne.get(id)) });
  })
);

// --- Withdraw / delete an application ----------------------------------
router.delete(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = v.id(req.params.id, { field: "application id" });
    const row = loadOr404(id);

    db.prepare("DELETE FROM applications WHERE id = ?").run(id);
    deleteStoredFile(row.cv_stored_name);
    res.json({ ok: true });
  })
);

export default router;

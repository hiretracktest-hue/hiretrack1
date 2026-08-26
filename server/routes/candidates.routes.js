import path from "node:path";
import express from "express";
import { db } from "../db/index.js";
import { config, can } from "../config.js";
import { asyncHandler, requirePermission, httpError } from "../middleware.js";
import * as v from "../validate.js";
import { stagesFor } from "./jobs.routes.js";
import { UPLOAD_DIR, uploadCv, deleteStoredFile, safeFilename } from "../upload.js";

/**
 * Candidates. HR adds them against a position and uploads their CV;
 * they are then tracked through that position's interview stages to
 * hired, rejected or on hold.
 */
const router = express.Router();

const OUTCOMES = ["ACTIVE", "ON_HOLD", "HIRED", "REJECTED"];
// Screening bands. One advert can return hundreds of CVs, so each is
// banded once and the list is then filtered rather than re-read.
const CV_BANDS = ["UNRATED", "HIGH", "MEDIUM", "LOW"];
const BAND_ORDER =
  "CASE c.cv_band WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 WHEN 'LOW' THEN 2 ELSE 3 END";

const SELECT_COLUMNS =
  "SELECT c.*, j.title AS job_title, j.status AS job_status, j.department AS job_department, " +
  "j.location AS job_location, a.name AS added_by_name, b.name AS banded_by_name, " +
  "(SELECT COUNT(*) FROM feedback f WHERE f.candidate_id = c.id) AS feedback_count, " +
  "(SELECT ROUND(AVG(f.rating), 1) FROM feedback f WHERE f.candidate_id = c.id) AS average_rating, " +
  "(SELECT COUNT(*) FROM feedback f WHERE f.candidate_id = c.id AND f.stage = c.current_stage) " +
  "  AS stage_feedback_count " +
  "FROM candidates c " +
  "JOIN jobs j ON j.id = c.job_id " +
  "LEFT JOIN users a ON a.id = c.added_by " +
  "LEFT JOIN users b ON b.id = c.cv_banded_by ";

const selectOne = db.prepare(SELECT_COLUMNS + "WHERE c.id = ?");

function toJson(row) {
  if (!row) return null;
  return {
    id: row.id,
    jobId: row.job_id,
    jobTitle: row.job_title,
    jobStatus: row.job_status,
    jobDepartment: row.job_department,
    jobLocation: row.job_location,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    source: row.source,
    notes: row.notes,
    currentStage: row.current_stage,
    outcome: row.outcome,
    cvBand: row.cv_band,
    cvBandNote: row.cv_band_note,
    bandedByName: row.banded_by_name ?? null,
    cvBandedAt: row.cv_banded_at,
    addedByName: row.added_by_name ?? null,
    feedbackCount: row.feedback_count ?? 0,
    averageRating: row.average_rating ?? null,
    stageFeedbackCount: row.stage_feedback_count ?? 0,
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
  if (!row) throw httpError(404, "That candidate does not exist.");
  return row;
}

// --- List candidates ---------------------------------------------------
router.get(
  "/",
  requirePermission("candidate:view"),
  asyncHandler(async (req, res) => {
    const where = [];
    const params = [];

    if (req.query.job) {
      where.push("c.job_id = ?");
      params.push(v.id(req.query.job, { field: "position id" }));
    }
    if (req.query.outcome) {
      where.push("c.outcome = ?");
      params.push(v.oneOf(String(req.query.outcome), OUTCOMES, { field: "Outcome" }));
    }
    if (req.query.cvBand) {
      where.push("c.cv_band = ?");
      params.push(v.oneOf(String(req.query.cvBand), CV_BANDS, { field: "CV band" }));
    }
    if (req.query.stage) {
      where.push("c.current_stage = ?");
      params.push(String(req.query.stage));
    }
    if (req.query.hasCv === "1") where.push("c.cv_stored_name IS NOT NULL");
    if (req.query.hasCv === "0") where.push("c.cv_stored_name IS NULL");

    const search = String(req.query.q || "").trim();
    if (search) {
      where.push("(c.full_name LIKE ? OR c.email LIKE ?)");
      const like = "%" + search + "%";
      params.push(like, like);
    }

    // An interviewer only needs the people they are actually meeting.
    if (req.query.mine === "1") {
      where.push("EXISTS (SELECT 1 FROM interviews i WHERE i.candidate_id = c.id AND i.interviewer_id = ?)");
      params.push(req.user.id);
    }

    const SORTS = {
      newest: "datetime(c.created_at) DESC",
      oldest: "datetime(c.created_at) ASC",
      band: BAND_ORDER + " ASC, datetime(c.created_at) DESC",
      rating: "average_rating IS NULL, average_rating DESC",
      name: "c.full_name COLLATE NOCASE ASC",
    };
    const sort = SORTS[String(req.query.sort || "")] || SORTS.newest;

    const whereSql = where.length ? "WHERE " + where.join(" AND ") + " " : "";
    const rows = db.prepare(SELECT_COLUMNS + whereSql + "ORDER BY " + sort).all(...params);

    // Band totals for the whole position, not just the filtered view, so
    // HR can see how much screening is left.
    const scope = [];
    const scopeParams = [];
    if (req.query.job) {
      scope.push("job_id = ?");
      scopeParams.push(v.id(req.query.job, { field: "position id" }));
    }
    const counts = db
      .prepare(
        "SELECT cv_band, COUNT(*) AS total FROM candidates " +
          (scope.length ? "WHERE " + scope.join(" AND ") + " " : "") +
          "GROUP BY cv_band"
      )
      .all(...scopeParams);

    const bandCounts = Object.fromEntries(CV_BANDS.map((band) => [band, 0]));
    for (const row of counts) bandCounts[row.cv_band] = row.total;

    res.json({
      candidates: rows.map(toJson),
      bandCounts,
      total: Object.values(bandCounts).reduce((a, b) => a + b, 0),
    });
  })
);

// --- One candidate, with their pipeline, interviews and feedback ------
router.get(
  "/:id",
  requirePermission("candidate:view"),
  asyncHandler(async (req, res) => {
    const id = v.id(req.params.id, { field: "candidate id" });
    const row = loadOr404(id);
    const stages = stagesFor(row.job_id);

    const candidate = toJson(row);
    const index = stages.indexOf(candidate.currentStage);
    candidate.stages = stages;
    candidate.nextStage = index >= 0 && index < stages.length - 1 ? stages[index + 1] : null;

    const interviews = db
      .prepare(
        "SELECT i.*, u.name AS created_by_name FROM interviews i " +
          "LEFT JOIN users u ON u.id = i.created_by " +
          "WHERE i.candidate_id = ? ORDER BY datetime(i.scheduled_at) ASC"
      )
      .all(id)
      .map((iv) => ({
        id: iv.id,
        stage: iv.stage,
        scheduledAt: iv.scheduled_at,
        interviewerId: iv.interviewer_id,
        interviewerName: iv.interviewer_name,
        interviewerEmail: iv.interviewer_email,
        location: iv.location,
        notes: iv.notes,
        createdByName: iv.created_by_name,
      }));

    const feedback = db
      .prepare(
        "SELECT f.*, u.name AS author_name, u.role AS author_role FROM feedback f " +
          "LEFT JOIN users u ON u.id = f.author_id " +
          "WHERE f.candidate_id = ? ORDER BY datetime(f.created_at) DESC"
      )
      .all(id)
      .map((f) => ({
        id: f.id,
        stage: f.stage,
        rating: f.rating,
        recommendation: f.recommendation,
        strengths: f.strengths,
        concerns: f.concerns,
        comment: f.comment,
        authorId: f.author_id,
        authorName: f.author_name,
        authorRole: f.author_role,
        createdAt: f.created_at,
      }));

    res.json({ candidate, interviews, feedback });
  })
);

// --- HR adds a candidate ----------------------------------------------
router.post(
  "/",
  requirePermission("candidate:add"),
  asyncHandler(async (req, res) => {
    const jobId = v.id(req.body.jobId, { field: "position id" });
    const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
    if (!job) throw httpError(404, "That position does not exist.");
    if (job.status !== "ACTIVE") throw httpError(400, "That position is closed.");

    const stages = stagesFor(jobId);
    if (!stages.length) throw httpError(400, "This position has no interview stages set up yet.");

    const fullName = v.str(req.body.fullName, {
      field: "Full name",
      required: true,
      max: 120,
      min: 2,
    });
    const emailValue = v.email(req.body.email);
    const phone = v.str(req.body.phone, { field: "Phone", max: 40 });
    const source = v.str(req.body.source, { field: "Source", max: 80 });
    const notes = v.str(req.body.notes, { field: "Notes", max: 2000 });

    const duplicate = db
      .prepare("SELECT id FROM candidates WHERE job_id = ? AND email = ?")
      .get(jobId, emailValue);
    if (duplicate) {
      throw httpError(409, "This person has already been added to this position.");
    }

    const info = db
      .prepare(
        "INSERT INTO candidates (job_id, full_name, email, phone, source, notes, current_stage, added_by) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(jobId, fullName, emailValue, phone, source, notes, stages[0], req.user.id);

    res.status(201).json({ candidate: toJson(selectOne.get(info.lastInsertRowid)) });
  })
);

// --- Edit details ------------------------------------------------------
router.patch(
  "/:id",
  requirePermission("candidate:view"),
  asyncHandler(async (req, res) => {
    const id = v.id(req.params.id, { field: "candidate id" });
    const existing = loadOr404(id);

    const fields = [];
    const params = [];
    const push = (column, value) => {
      fields.push(column + " = ?");
      params.push(value);
    };

    const wantsEdit =
      req.body.fullName !== undefined ||
      req.body.email !== undefined ||
      req.body.phone !== undefined ||
      req.body.source !== undefined ||
      req.body.notes !== undefined;

    if (wantsEdit) {
      if (!can(req.user, "candidate:edit")) {
        throw httpError(403, "Your role cannot edit a candidate's details.");
      }
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
      if (req.body.notes !== undefined) {
        push("notes", v.str(req.body.notes, { field: "Notes", max: 2000 }));
      }
    }

    if (req.body.outcome !== undefined) {
      if (!can(req.user, "candidate:outcome")) {
        throw httpError(403, "Your role cannot record an outcome.");
      }
      push("outcome", v.oneOf(req.body.outcome, OUTCOMES, { field: "Outcome" }));
    }

    if (req.body.currentStage !== undefined) {
      if (!can(req.user, "candidate:advance")) {
        throw httpError(403, "Your role cannot change a candidate's stage.");
      }
      const stages = stagesFor(existing.job_id);
      push("current_stage", v.oneOf(req.body.currentStage, stages, { field: "Stage" }));
    }

    if (!fields.length) throw httpError(400, "Nothing to update.");

    params.push(id);
    try {
      db.prepare(
        "UPDATE candidates SET " + fields.join(", ") + ", updated_at = datetime('now') WHERE id = ?"
      ).run(...params);
    } catch (err) {
      if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
        throw httpError(409, "Another candidate for this position already uses that email.");
      }
      throw err;
    }

    res.json({ candidate: toJson(selectOne.get(id)) });
  })
);

// --- Band a CV: HIGH / MEDIUM / LOW ------------------------------------
router.post(
  "/:id/band",
  requirePermission("candidate:band"),
  asyncHandler(async (req, res) => {
    const id = v.id(req.params.id, { field: "candidate id" });
    loadOr404(id);

    const band = v.oneOf(req.body.band, CV_BANDS, { field: "CV band" });
    const note = v.str(req.body.note, { field: "Note", max: 300 });

    db.prepare(
      "UPDATE candidates SET cv_band = ?, cv_band_note = ?, cv_banded_by = ?, " +
        "cv_banded_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
    ).run(band, note, band === "UNRATED" ? null : req.user.id, id);

    res.json({ candidate: toJson(selectOne.get(id)) });
  })
);

// --- Band several at once ----------------------------------------------
router.post(
  "/band/bulk",
  requirePermission("candidate:band"),
  asyncHandler(async (req, res) => {
    const band = v.oneOf(req.body.band, CV_BANDS, { field: "CV band" });
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    if (!ids.length) throw httpError(400, "Choose at least one candidate.");
    if (ids.length > 200) throw httpError(400, "Band at most 200 candidates at a time.");

    const clean = ids.map((id) => v.id(id, { field: "candidate id" }));
    const update = db.prepare(
      "UPDATE candidates SET cv_band = ?, cv_banded_by = ?, cv_banded_at = datetime('now'), " +
        "updated_at = datetime('now') WHERE id = ?"
    );
    const bandedBy = band === "UNRATED" ? null : req.user.id;

    const run = db.transaction(() => {
      let changed = 0;
      for (const id of clean) changed += update.run(band, bandedBy, id).changes;
      return changed;
    });

    res.json({ updated: run(), band });
  })
);

// --- Move to the next stage --------------------------------------------
router.post(
  "/:id/advance",
  requirePermission("candidate:advance"),
  asyncHandler(async (req, res) => {
    const id = v.id(req.params.id, { field: "candidate id" });
    const existing = loadOr404(id);

    const stages = stagesFor(existing.job_id);
    const index = stages.indexOf(existing.current_stage);
    if (index === -1) throw httpError(400, "This candidate's stage is no longer in the pipeline.");
    if (index >= stages.length - 1) {
      throw httpError(400, "This candidate is already at the final stage.");
    }

    // "Should a candidate be blocked from advancing until the current
    // stage's feedback is in?" - yes. The first stage is exempt because
    // nobody has interviewed them yet when they have only just applied.
    if (config.requireFeedbackToAdvance && index > 0) {
      const given = db
        .prepare("SELECT COUNT(*) AS total FROM feedback WHERE candidate_id = ? AND stage = ?")
        .get(id, existing.current_stage).total;

      if (given === 0) {
        throw httpError(
          400,
          'Feedback for "' +
            existing.current_stage +
            '" has to be submitted before this candidate can move to "' +
            stages[index + 1] +
            '".'
        );
      }
    }

    db.prepare(
      "UPDATE candidates SET current_stage = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(stages[index + 1], id);

    res.json({ candidate: toJson(selectOne.get(id)), stages });
  })
);

// --- Upload or replace the CV ------------------------------------------
router.post(
  "/:id/cv",
  requirePermission("candidate:uploadCv"),
  (req, res, next) => uploadCv(req, res, (err) => (err ? next(err) : next())),
  asyncHandler(async (req, res) => {
    const id = v.id(req.params.id, { field: "candidate id" });
    const existing = selectOne.get(id);

    if (!existing) {
      deleteStoredFile(req.file?.filename); // do not leave an orphan behind
      throw httpError(404, "That candidate does not exist.");
    }
    if (!req.file) throw httpError(400, "Choose a CV file to upload.");

    const previous = existing.cv_stored_name;

    db.prepare(
      "UPDATE candidates SET cv_filename = ?, cv_stored_name = ?, cv_mime = ?, cv_size = ?, " +
        "cv_uploaded_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
    ).run(
      safeFilename(req.file.originalname),
      req.file.filename,
      req.file.mimetype,
      req.file.size,
      id
    );

    deleteStoredFile(previous);
    res.json({ candidate: toJson(selectOne.get(id)) });
  })
);

// --- Download the CV ---------------------------------------------------
router.get(
  "/:id/cv",
  requirePermission("candidate:view"),
  asyncHandler(async (req, res) => {
    const id = v.id(req.params.id, { field: "candidate id" });
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
  requirePermission("candidate:uploadCv"),
  asyncHandler(async (req, res) => {
    const id = v.id(req.params.id, { field: "candidate id" });
    const row = loadOr404(id);
    if (!row.cv_stored_name) throw httpError(404, "No CV has been uploaded yet.");

    db.prepare(
      "UPDATE candidates SET cv_filename = NULL, cv_stored_name = NULL, cv_mime = NULL, " +
        "cv_size = NULL, cv_uploaded_at = NULL, updated_at = datetime('now') WHERE id = ?"
    ).run(id);
    deleteStoredFile(row.cv_stored_name);

    res.json({ candidate: toJson(selectOne.get(id)) });
  })
);

// --- Delete a candidate -------------------------------------------------
router.delete(
  "/:id",
  requirePermission("candidate:delete"),
  asyncHandler(async (req, res) => {
    const id = v.id(req.params.id, { field: "candidate id" });
    const row = loadOr404(id);

    db.prepare("DELETE FROM candidates WHERE id = ?").run(id);
    deleteStoredFile(row.cv_stored_name);
    res.json({ ok: true });
  })
);

export default router;

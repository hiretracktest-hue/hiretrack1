import path from "node:path";
import express from "express";
import { db } from "../db/index.js";
import { asyncHandler, requireAuth, requireStaff, httpError } from "../middleware.js";
import * as v from "../validate.js";
import { stagesFor } from "./jobs.routes.js";
import { UPLOAD_DIR, uploadCv, deleteStoredFile, safeFilename } from "../upload.js";

const router = express.Router();

const OUTCOMES = ["ACTIVE", "ON_HOLD", "HIRED", "REJECTED"];
const CV_STATUSES = ["PENDING", "ACCEPTED", "REJECTED"];

// What a client is told while they wait. The hiring team's internal
// wording (stages, ON_HOLD) is deliberately not shown to them.
const CLIENT_STATUS = {
  PENDING: {
    label: "Under review",
    detail: "Your CV has been received and is waiting to be reviewed by the hiring team.",
  },
  ACCEPTED: {
    label: "CV accepted",
    detail: "Good news - your CV passed the review and you have moved into the interview process.",
  },
  REJECTED: {
    label: "Not successful",
    detail: "Thank you for applying. On this occasion your application was not taken forward.",
  },
  NO_CV: {
    label: "CV needed",
    detail: "Upload your CV so the hiring team can review your application.",
  },
};

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
    cvStatus: row.cv_status,
    clientStatus: clientStatusFor(row),
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

function clientStatusFor(row) {
  if (row.outcome === "HIRED") {
    return { key: "HIRED", label: "Offer made", detail: "Congratulations - you have been hired." };
  }
  if (row.outcome === "REJECTED" || row.cv_status === "REJECTED") {
    return { key: "REJECTED", ...CLIENT_STATUS.REJECTED };
  }
  if (!row.cv_stored_name) return { key: "NO_CV", ...CLIENT_STATUS.NO_CV };
  return { key: row.cv_status, ...CLIENT_STATUS[row.cv_status] };
}

/**
 * A client may only ever touch their own application. Staff may touch
 * any of them. Returns the row or throws.
 */
function loadFor(req, id) {
  const row = selectOne.get(id);
  if (!row) throw httpError(404, "That application does not exist.");
  if (!req.user.isStaff && row.user_id !== req.user.id) {
    // 404 rather than 403 so a client cannot even confirm it exists.
    throw httpError(404, "That application does not exist.");
  }
  return row;
}

// --- List applications ------------------------------------------------
// Staff see every application. A client only ever gets their own rows,
// whatever query string they send.
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const where = [];
    const params = [];

    if (!req.user.isStaff) {
      where.push("a.user_id = ?");
      params.push(req.user.id);
    } else {
      if (req.query.outcome) {
        where.push("a.outcome = ?");
        params.push(v.oneOf(String(req.query.outcome), OUTCOMES, { field: "Outcome" }));
      }
      if (req.query.cvStatus) {
        where.push("a.cv_status = ?");
        params.push(v.oneOf(String(req.query.cvStatus), CV_STATUSES, { field: "CV status" }));
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
    }

    if (req.query.job) {
      where.push("a.job_id = ?");
      params.push(v.id(req.query.job, { field: "vacancy id" }));
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

// --- One application (with its pipeline, interviews and feedback) -----
router.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = v.id(req.params.id, { field: "application id" });
    const row = loadFor(req, id);
    const stages = stagesFor(row.job_id);

    const application = toJson(row);
    const index = stages.indexOf(application.currentStage);
    application.stages = stages;
    application.nextStage = index >= 0 && index < stages.length - 1 ? stages[index + 1] : null;

    // A client does not see the pipeline, internal notes or feedback -
    // only their own details and where their application stands.
    if (!req.user.isStaff) {
      delete application.notes;
      delete application.stages;
      delete application.nextStage;
      delete application.currentStage;
      delete application.outcome;
      return res.json({ application, interviews: [], feedback: [] });
    }

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

    const feedback = db
      .prepare(
        "SELECT f.*, u.name AS author_name, u.role AS author_role FROM feedback f " +
          "LEFT JOIN users u ON u.id = f.author_id " +
          "WHERE f.application_id = ? ORDER BY datetime(f.created_at) DESC"
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

    res.json({ application, interviews, feedback });
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

    // A client always applies as themselves; only staff can enter an
    // application on someone else's behalf.
    const fullName = req.user.isStaff
      ? v.str(req.body.fullName, { field: "Full name", required: true, max: 120, min: 2 })
      : req.user.name;
    const emailValue = req.user.isStaff ? v.email(req.body.email) : req.user.email;

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
    const existing = loadFor(req, id);

    const fields = [];
    const params = [];
    const push = (column, value) => {
      fields.push(column + " = ?");
      params.push(value);
    };

    // Anyone who owns the record can fix their own contact details.
    if (req.body.phone !== undefined) {
      push("phone", v.str(req.body.phone, { field: "Phone", max: 40 }));
    }
    if (req.body.coverNote !== undefined) {
      push("cover_note", v.str(req.body.coverNote, { field: "Cover note", max: 2000 }));
    }
    if (req.user.isStaff) {
      if (req.body.fullName !== undefined) {
        push(
          "full_name",
          v.str(req.body.fullName, { field: "Full name", required: true, max: 120 })
        );
      }
      if (req.body.email !== undefined) push("email", v.email(req.body.email));
      if (req.body.source !== undefined) {
        push("source", v.str(req.body.source, { field: "Source", max: 80 }));
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

// --- Review the CV: accept or reject ----------------------------------
// This is what turns a client's "Under review" into "CV accepted" or
// "Not successful".
router.post(
  "/:id/cv-review",
  requireStaff,
  asyncHandler(async (req, res) => {
    const id = v.id(req.params.id, { field: "application id" });
    const existing = loadFor(req, id);
    if (!existing.cv_stored_name) {
      throw httpError(400, "This candidate has not uploaded a CV yet.");
    }

    const status = v.oneOf(req.body.status, CV_STATUSES, { field: "CV status" });

    // Rejecting the CV rejects the application; accepting a rejected one
    // puts them back in the running.
    const fields = ["cv_status = ?"];
    const params = [status];
    if (status === "REJECTED") {
      fields.push("outcome = 'REJECTED'");
    } else if (status === "ACCEPTED" && existing.outcome === "REJECTED") {
      fields.push("outcome = 'ACTIVE'");
    }
    params.push(id);

    db.prepare(
      "UPDATE applications SET " + fields.join(", ") + ", updated_at = datetime('now') WHERE id = ?"
    ).run(...params);

    res.json({ application: toJson(selectOne.get(id)) });
  })
);

// --- Move to the next stage in the pipeline ---------------------------
router.post(
  "/:id/advance",
  requireStaff,
  asyncHandler(async (req, res) => {
    const id = v.id(req.params.id, { field: "application id" });
    const existing = loadFor(req, id);

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

    if (!existing || (!req.user.isStaff && existing.user_id !== req.user.id)) {
      deleteStoredFile(req.file?.filename); // do not leave an orphan file behind
      throw httpError(404, "That application does not exist.");
    }
    if (!req.file) throw httpError(400, "Choose a CV file to upload.");

    const previous = existing.cv_stored_name;

    // A replaced CV goes back to "under review" - the team has not seen
    // this new one yet.
    db.prepare(
      "UPDATE applications SET cv_filename = ?, cv_stored_name = ?, cv_mime = ?, cv_size = ?, " +
        "cv_status = 'PENDING', cv_uploaded_at = datetime('now'), updated_at = datetime('now') " +
        "WHERE id = ?"
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
    const row = loadFor(req, id);
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
    const row = loadFor(req, id);
    if (!row.cv_stored_name) throw httpError(404, "No CV has been uploaded yet.");

    db.prepare(
      "UPDATE applications SET cv_filename = NULL, cv_stored_name = NULL, cv_mime = NULL, " +
        "cv_size = NULL, cv_uploaded_at = NULL, cv_status = 'PENDING', " +
        "updated_at = datetime('now') WHERE id = ?"
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
    const row = loadFor(req, id);

    db.prepare("DELETE FROM applications WHERE id = ?").run(id);
    deleteStoredFile(row.cv_stored_name);
    res.json({ ok: true });
  })
);

export default router;

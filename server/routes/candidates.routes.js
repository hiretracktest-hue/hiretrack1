import express from "express";
import { one, many, run } from "../../database/index.js";
import { config, can } from "../config.js";
import { asyncHandler, requirePermission, httpError } from "../middleware.js";
import * as v from "../validate.js";
import { stagesFor } from "./jobs.routes.js";
import { uploadCv, safeFilename } from "../upload.js";
import { putCv, getCv, removeCv } from "../storage.js";
import { notifyCandidateAdded } from "../notify.js";
import { notifyOutcome } from "../notify.js";

/**
 * Candidates. HR adds them against a position and uploads their CV;
 * they are then tracked through that position's interview stages to
 * hired, rejected or on hold.
 */
const router = express.Router();

const OUTCOMES = ["ACTIVE", "ON_HOLD", "HIRED", "REJECTED"];
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

const num = (value) => (value === null || value === undefined ? null : Number(value));

function toJson(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    jobId: Number(row.job_id),
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
    feedbackCount: Number(row.feedback_count ?? 0),
    averageRating: num(row.average_rating),
    stageFeedbackCount: Number(row.stage_feedback_count ?? 0),
    cv: row.cv_filename
      ? {
          filename: row.cv_filename,
          storage: row.cv_storage || "local",
          mime: row.cv_mime,
          size: num(row.cv_size),
          uploadedAt: row.cv_uploaded_at,
        }
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadOr404(id) {
  const row = await one(SELECT_COLUMNS + "WHERE c.id = $1", [id]);
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
    const add = (clause, value) => {
      params.push(value);
      where.push(clause.replace("$?", "$" + params.length));
    };

    if (req.query.job) add("c.job_id = $?", v.id(req.query.job, { field: "position id" }));
    if (req.query.outcome) {
      add("c.outcome = $?", v.oneOf(String(req.query.outcome), OUTCOMES, { field: "Outcome" }));
    }
    if (req.query.cvBand) {
      add("c.cv_band = $?", v.oneOf(String(req.query.cvBand), CV_BANDS, { field: "CV band" }));
    }
    if (req.query.stage) add("c.current_stage = $?", String(req.query.stage));
    if (req.query.hasCv === "1") where.push("c.cv_stored_name IS NOT NULL");
    if (req.query.hasCv === "0") where.push("c.cv_stored_name IS NULL");

    const search = String(req.query.q || "").trim();
    if (search) {
      params.push("%" + search + "%");
      const n = params.length;
      where.push("(c.full_name ILIKE $" + n + " OR c.email::text ILIKE $" + n + ")");
    }

    // An interviewer only needs the people they are actually meeting.
    if (req.query.mine === "1") {
      add(
        "EXISTS (SELECT 1 FROM interviews i WHERE i.candidate_id = c.id AND i.interviewer_id = $?)",
        req.user.id
      );
    }

    const SORTS = {
      newest: "c.created_at DESC",
      oldest: "c.created_at ASC",
      band: BAND_ORDER + " ASC, c.created_at DESC",
      rating: "average_rating DESC NULLS LAST",
      name: "c.full_name ASC",
    };
    const sort = SORTS[String(req.query.sort || "")] || SORTS.newest;

    const whereSql = where.length ? "WHERE " + where.join(" AND ") + " " : "";
    const rows = await many(SELECT_COLUMNS + whereSql + "ORDER BY " + sort, params);

    // Band totals for the whole position, not just the filtered view, so
    // HR can see how much screening is left.
    const scopeParams = [];
    let scopeSql = "";
    if (req.query.job) {
      scopeParams.push(v.id(req.query.job, { field: "position id" }));
      scopeSql = "WHERE job_id = $1 ";
    }
    const counts = await many(
      "SELECT cv_band, COUNT(*)::int AS total FROM candidates " + scopeSql + "GROUP BY cv_band",
      scopeParams
    );

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
    const row = await loadOr404(id);
    const stages = await stagesFor(row.job_id);

    const candidate = toJson(row);
    const index = stages.indexOf(candidate.currentStage);
    candidate.stages = stages;
    candidate.nextStage = index >= 0 && index < stages.length - 1 ? stages[index + 1] : null;

    const interviews = (
      await many(
        "SELECT i.*, u.name AS created_by_name FROM interviews i " +
          "LEFT JOIN users u ON u.id = i.created_by " +
          "WHERE i.candidate_id = $1 ORDER BY i.scheduled_at ASC",
        [id]
      )
    ).map((iv) => ({
      id: Number(iv.id),
      stage: iv.stage,
      scheduledAt: iv.scheduled_at,
      interviewerId: num(iv.interviewer_id),
      interviewerName: iv.interviewer_name,
      interviewerEmail: iv.interviewer_email,
      location: iv.location,
      notes: iv.notes,
      createdByName: iv.created_by_name,
    }));

    const feedback = (
      await many(
        "SELECT f.*, u.name AS author_name, u.role AS author_role FROM feedback f " +
          "LEFT JOIN users u ON u.id = f.author_id " +
          "WHERE f.candidate_id = $1 ORDER BY f.created_at DESC",
        [id]
      )
    ).map((f) => ({
      id: Number(f.id),
      stage: f.stage,
      rating: f.rating,
      recommendation: f.recommendation,
      strengths: f.strengths,
      concerns: f.concerns,
      comment: f.comment,
      authorId: num(f.author_id),
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
    const job = await one("SELECT * FROM jobs WHERE id = $1", [jobId]);
    if (!job) throw httpError(404, "That position does not exist.");
    if (job.status !== "ACTIVE") throw httpError(400, "That position is closed.");

    const stages = await stagesFor(jobId);
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

    const duplicate = await one(
      "SELECT id FROM candidates WHERE job_id = $1 AND email = $2",
      [jobId, emailValue]
    );
    if (duplicate) {
      throw httpError(409, "This person has already been added to this position.");
    }

    const created = await one(
      "INSERT INTO candidates (job_id, full_name, email, phone, source, notes, current_stage, added_by) " +
        "VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
      [jobId, fullName, emailValue, phone, source, notes, stages[0], req.user.id]
    );

    const candidate = await loadOr404(created.id);

    // Tell them we have their application. Opt-out rather than opt-in:
    // somebody who applied should hear back, and the case for silence is
    // the unusual one - a name copied off a CV pile who has not actually
    // applied yet. Pass notify: false for that.
    let email = { attempted: false, sent: false, reason: null };
    if (req.body.notify !== false) {
      const outcome = await notifyCandidateAdded({ candidate, job, addedBy: req.user });
      email = { attempted: true, sent: outcome.sent, reason: outcome.reason || null };
    }

    // The front end says what actually happened, not what was asked for.
    res.status(201).json({ candidate: toJson(candidate), email });
  })
);

// --- Edit details / stage / outcome -------------------------------------
router.patch(
  "/:id",
  requirePermission("candidate:view"),
  asyncHandler(async (req, res) => {
    const id = v.id(req.params.id, { field: "candidate id" });
    const existing = await loadOr404(id);

    const sets = [];
    const params = [];
    const push = (column, value) => {
      params.push(value);
      sets.push(column + " = $" + params.length);
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

    let newOutcome = null;
    if (req.body.outcome !== undefined) {
      if (!can(req.user, "candidate:outcome")) {
        throw httpError(403, "Your role cannot record an outcome.");
      }
      newOutcome = v.oneOf(req.body.outcome, OUTCOMES, { field: "Outcome" });
      push("outcome", newOutcome);
    }

    if (req.body.currentStage !== undefined) {
      if (!can(req.user, "candidate:advance")) {
        throw httpError(403, "Your role cannot change a candidate's stage.");
      }
      const stages = await stagesFor(existing.job_id);
      const wanted = v.oneOf(req.body.currentStage, stages, { field: "Stage" });

      // Moving a candidate FORWARD has to go through /advance, which is
      // where the "no advancing until this stage's feedback is in" rule
      // lives. Without this check the rule could simply be skipped by
      // patching the stage directly. Moving them back is allowed - that
      // is how a mistake gets corrected.
      if (stages.indexOf(wanted) > stages.indexOf(existing.current_stage)) {
        throw httpError(
          400,
          "Use the Move to next stage button - it checks that this stage's feedback is in."
        );
      }
      push("current_stage", wanted);
    }

    if (!sets.length) throw httpError(400, "Nothing to update.");

    params.push(id);
    try {
      await run(
        "UPDATE candidates SET " + sets.join(", ") + " WHERE id = $" + params.length,
        params
      );
    } catch (err) {
      if (err.code === "23505") {
        throw httpError(409, "Another candidate for this position already uses that email.");
      }
      throw err;
    }

    // A final decision is news the candidate has to be given. They have
    // no account here, so the letter goes into the outbox for HR to send
    // - the same route the interview invitation takes.
    if (newOutcome && newOutcome !== existing.outcome) {
      const job = await one("SELECT * FROM jobs WHERE id = $1", [existing.job_id]);
      await notifyOutcome({
        candidate: existing,
        job,
        outcome: newOutcome,
        decidedBy: req.user,
      });
    }

    res.json({ candidate: toJson(await loadOr404(id)) });
  })
);

// --- Band a CV: HIGH / MEDIUM / LOW ------------------------------------
router.post(
  "/:id/band",
  requirePermission("candidate:band"),
  asyncHandler(async (req, res) => {
    const id = v.id(req.params.id, { field: "candidate id" });
    await loadOr404(id);

    const band = v.oneOf(req.body.band, CV_BANDS, { field: "CV band" });
    const note = v.str(req.body.note, { field: "Note", max: 300 });

    // Setting it back to UNRATED means "this still needs screening", so
    // the whole screening record is cleared rather than left behind with
    // a date and a note that no longer describe anything.
    const clearing = band === "UNRATED";
    await run(
      "UPDATE candidates SET cv_band = $1, cv_band_note = $2, cv_banded_by = $3, " +
        "cv_banded_at = CASE WHEN $4 THEN NOW() ELSE NULL END WHERE id = $5",
      [band, clearing ? "" : note, clearing ? null : req.user.id, !clearing, id]
    );

    res.json({ candidate: toJson(await loadOr404(id)) });
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
    const bandedBy = band === "UNRATED" ? null : req.user.id;

    // = ANY($4) takes the whole list as one parameter, so this is a
    // single round trip and still fully parameterised.
    // The note is cleared too: it was written about the old band, so
    // leaving it would put "strong React portfolio" next to a LOW band.
    const updated = await run(
      "UPDATE candidates SET cv_band = $1, cv_band_note = '', cv_banded_by = $2, " +
        "cv_banded_at = CASE WHEN $3 THEN NOW() ELSE NULL END " +
        "WHERE id = ANY($4::bigint[])",
      [band, bandedBy, band !== "UNRATED", clean]
    );

    res.json({ updated, band });
  })
);

// --- Move to the next stage --------------------------------------------
router.post(
  "/:id/advance",
  requirePermission("candidate:advance"),
  asyncHandler(async (req, res) => {
    const id = v.id(req.params.id, { field: "candidate id" });
    const existing = await loadOr404(id);

    const stages = await stagesFor(existing.job_id);
    const index = stages.indexOf(existing.current_stage);
    if (index === -1) throw httpError(400, "This candidate's stage is no longer in the pipeline.");
    if (index >= stages.length - 1) {
      throw httpError(400, "This candidate is already at the final stage.");
    }

    // "Should a candidate be blocked from advancing until the current
    // stage's feedback is in?" - yes. The first stage is exempt because
    // nobody has interviewed them yet when they have only just been added.
    if (config.requireFeedbackToAdvance && index > 0) {
      const { count } = await one(
        "SELECT COUNT(*)::int AS count FROM feedback WHERE candidate_id = $1 AND stage = $2",
        [id, existing.current_stage]
      );

      if (count === 0) {
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

    await run("UPDATE candidates SET current_stage = $1 WHERE id = $2", [stages[index + 1], id]);
    res.json({ candidate: toJson(await loadOr404(id)), stages });
  })
);

// --- Upload or replace the CV ------------------------------------------
router.post(
  "/:id/cv",
  requirePermission("candidate:uploadCv"),
  (req, res, next) => uploadCv(req, res, (err) => (err ? next(err) : next())),
  asyncHandler(async (req, res) => {
    const id = v.id(req.params.id, { field: "candidate id" });
    const existing = await one("SELECT * FROM candidates WHERE id = $1", [id]);

    // Nothing has been stored yet, so there is no orphan to clean up -
    // the file is still only in memory at this point.
    if (!existing) throw httpError(404, "That candidate does not exist.");
    if (!req.file) throw httpError(400, "Choose a CV file to upload.");

    const previous = { name: existing.cv_stored_name, storage: existing.cv_storage };
    const stored = await putCv(req.file);

    await run(
      "UPDATE candidates SET cv_filename = $1, cv_stored_name = $2, cv_mime = $3, cv_size = $4, " +
        "cv_storage = $5, cv_uploaded_at = NOW() WHERE id = $6",
      [
        safeFilename(req.file.originalname),
        stored.storedName,
        req.file.mimetype,
        req.file.size,
        stored.storage,
        id,
      ]
    );

    // Only once the new one is safely written.
    await removeCv(previous.name, previous.storage);
    res.json({ candidate: toJson(await loadOr404(id)) });
  })
);

// --- Download the CV ---------------------------------------------------
router.get(
  "/:id/cv",
  requirePermission("candidate:view"),
  asyncHandler(async (req, res) => {
    const id = v.id(req.params.id, { field: "candidate id" });
    const row = await loadOr404(id);
    if (!row.cv_stored_name) throw httpError(404, "No CV has been uploaded yet.");

    const filename = safeFilename(row.cv_filename);
    const found = await getCv(row.cv_stored_name, row.cv_storage, filename);

    // A bucket CV is handed over as a signed URL that expires in a
    // minute. The bucket is private, so this is the only way in, and the
    // link is not worth passing on to anybody. The URL carries a
    // download flag, so Supabase serves it as an attachment too.
    if (found.kind === "supabase") return res.redirect(found.url);

    // Any file type is accepted, so a CV could be an .html or an .svg.
    // Both of those would run scripts if a browser rendered them, and
    // rendering one on this origin would be an XSS hole straight through
    // the app. res.download() sets Content-Disposition: attachment, and
    // nosniff stops the browser second-guessing the type - together that
    // means a stored file is never executed, only saved.
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.download(found.path, filename, (err) => {
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
    const row = await loadOr404(id);
    if (!row.cv_stored_name) throw httpError(404, "No CV has been uploaded yet.");

    await run(
      "UPDATE candidates SET cv_filename = NULL, cv_stored_name = NULL, cv_mime = NULL, " +
        "cv_size = NULL, cv_storage = NULL, cv_uploaded_at = NULL WHERE id = $1",
      [id]
    );
    await removeCv(row.cv_stored_name, row.cv_storage);

    res.json({ candidate: toJson(await loadOr404(id)) });
  })
);

// --- Delete a candidate -------------------------------------------------
router.delete(
  "/:id",
  requirePermission("candidate:delete"),
  asyncHandler(async (req, res) => {
    const id = v.id(req.params.id, { field: "candidate id" });
    const row = await loadOr404(id);

    await run("DELETE FROM candidates WHERE id = $1", [id]);
    await removeCv(row.cv_stored_name, row.cv_storage);
    res.json({ ok: true });
  })
);

export default router;

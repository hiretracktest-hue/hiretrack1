import express from "express";
import { one, many, run } from "../../database/index.js";
import { asyncHandler, requirePermission, httpError } from "../middleware.js";
import * as v from "../validate.js";
import { stagesFor } from "./jobs.routes.js";

/**
 * "How do interviewers give feedback so candidates can be compared
 * fairly, side by side?"
 *
 * Everyone scores out of 5 and picks from the same recommendations, and
 * a UNIQUE constraint means one person leaves one score per stage. That
 * is what makes the comparison table meaningful.
 */
const router = express.Router();

const RECOMMENDATIONS = ["ADVANCE", "HOLD", "REJECT"];
const num = (value) => (value === null || value === undefined ? null : Number(value));

function toJson(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    candidateId: Number(row.candidate_id),
    candidateName: row.candidate_name ?? null,
    stage: row.stage,
    rating: row.rating,
    recommendation: row.recommendation,
    strengths: row.strengths,
    concerns: row.concerns,
    comment: row.comment,
    authorId: num(row.author_id),
    authorName: row.author_name ?? null,
    authorRole: row.author_role ?? null,
    createdAt: row.created_at,
  };
}

const BASE_SELECT =
  "SELECT f.*, a.full_name AS candidate_name, u.name AS author_name, u.role AS author_role " +
  "FROM feedback f " +
  "JOIN candidates a ON a.id = f.candidate_id " +
  "LEFT JOIN users u ON u.id = f.author_id ";

// --- List feedback ------------------------------------------------------
router.get(
  "/",
  requirePermission("feedback:view"),
  asyncHandler(async (req, res) => {
    const where = [];
    const params = [];

    if (req.query.candidate) {
      params.push(v.id(req.query.candidate, { field: "candidate id" }));
      where.push("f.candidate_id = $" + params.length);
    }
    if (req.query.mine === "1") {
      params.push(req.user.id);
      where.push("f.author_id = $" + params.length);
    }

    const rows = await many(
      BASE_SELECT +
        (where.length ? "WHERE " + where.join(" AND ") + " " : "") +
        "ORDER BY f.created_at DESC",
      params
    );

    res.json({ feedback: rows.map(toJson) });
  })
);

// --- Leave (or update) my feedback for one stage ------------------------
router.post(
  "/",
  requirePermission("feedback:write"),
  asyncHandler(async (req, res) => {
    const candidateId = v.id(req.body.candidateId, { field: "candidate id" });
    const candidate = await one("SELECT * FROM candidates WHERE id = $1", [candidateId]);
    if (!candidate) throw httpError(404, "That candidate does not exist.");

    const stages = await stagesFor(candidate.job_id);
    const stage = v.oneOf(req.body.stage, stages, {
      field: "Stage",
      fallback: candidate.current_stage,
    });

    const rating = Number(req.body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw httpError(400, "Give a rating from 1 to 5.");
    }

    const recommendation = v.oneOf(req.body.recommendation, RECOMMENDATIONS, {
      field: "Recommendation",
      fallback: "ADVANCE",
    });
    const strengths = v.str(req.body.strengths, { field: "Strengths", max: 1000 });
    const concerns = v.str(req.body.concerns, { field: "Concerns", max: 1000 });
    const comment = v.str(req.body.comment, { field: "Comment", max: 2000 });

    // One interviewer, one verdict per stage: writing again replaces it.
    await run(
      "INSERT INTO feedback (candidate_id, author_id, stage, rating, recommendation, strengths, concerns, comment) " +
        "VALUES ($1, $2, $3, $4, $5, $6, $7, $8) " +
        "ON CONFLICT (candidate_id, stage, author_id) DO UPDATE SET " +
        "rating = EXCLUDED.rating, recommendation = EXCLUDED.recommendation, " +
        "strengths = EXCLUDED.strengths, concerns = EXCLUDED.concerns, " +
        "comment = EXCLUDED.comment, created_at = NOW()",
      [candidateId, req.user.id, stage, rating, recommendation, strengths, concerns, comment]
    );

    const row = await one(
      BASE_SELECT + "WHERE f.candidate_id = $1 AND f.stage = $2 AND f.author_id = $3",
      [candidateId, stage, req.user.id]
    );

    res.status(201).json({ feedback: toJson(row) });
  })
);

// --- Delete my own feedback ---------------------------------------------
router.delete(
  "/:id",
  requirePermission("feedback:write"),
  asyncHandler(async (req, res) => {
    const id = v.id(req.params.id, { field: "feedback id" });
    const row = await one("SELECT * FROM feedback WHERE id = $1", [id]);
    if (!row) throw httpError(404, "That feedback does not exist.");
    if (Number(row.author_id) !== req.user.id) {
      throw httpError(403, "You can only delete feedback that you wrote.");
    }

    await run("DELETE FROM feedback WHERE id = $1", [id]);
    res.json({ ok: true });
  })
);

// --- Compare every candidate for one position, side by side -------------
router.get(
  "/compare/:jobId",
  requirePermission("candidate:compare"),
  asyncHandler(async (req, res) => {
    const jobId = v.id(req.params.jobId, { field: "position id" });
    const job = await one("SELECT * FROM jobs WHERE id = $1", [jobId]);
    if (!job) throw httpError(404, "That position does not exist.");

    const stages = await stagesFor(jobId);

    // FILTER (WHERE …) is the PostgreSQL way of counting a subset inside
    // an aggregate - clearer than SUM(CASE WHEN … THEN 1 ELSE 0 END).
    const rows = await many(
      "SELECT c.id, c.full_name, c.email, c.current_stage, c.outcome, c.cv_band, " +
        "(c.cv_stored_name IS NOT NULL) AS has_cv, " +
        "COUNT(f.id)::int AS feedback_count, " +
        "ROUND(AVG(f.rating), 1) AS average_rating, " +
        "COUNT(f.id) FILTER (WHERE f.recommendation = 'ADVANCE')::int AS advance_votes, " +
        "COUNT(f.id) FILTER (WHERE f.recommendation = 'HOLD')::int    AS hold_votes, " +
        "COUNT(f.id) FILTER (WHERE f.recommendation = 'REJECT')::int  AS reject_votes " +
        "FROM candidates c " +
        "LEFT JOIN feedback f ON f.candidate_id = c.id " +
        "WHERE c.job_id = $1 " +
        "GROUP BY c.id " +
        "ORDER BY AVG(f.rating) DESC NULLS LAST, c.full_name ASC",
      [jobId]
    );

    // Per-stage average for each candidate, so the table can show how
    // someone did at "Screening" versus "Technical Interview".
    const perStage = await many(
      "SELECT candidate_id, stage, ROUND(AVG(rating), 1) AS average_rating, COUNT(*)::int AS count " +
        "FROM feedback WHERE candidate_id IN (SELECT id FROM candidates WHERE job_id = $1) " +
        "GROUP BY candidate_id, stage",
      [jobId]
    );

    const candidates = rows.map((row) => ({
      id: Number(row.id),
      fullName: row.full_name,
      email: row.email,
      currentStage: row.current_stage,
      outcome: row.outcome,
      cvBand: row.cv_band,
      hasCv: Boolean(row.has_cv),
      feedbackCount: row.feedback_count,
      averageRating: num(row.average_rating),
      votes: {
        advance: row.advance_votes || 0,
        hold: row.hold_votes || 0,
        reject: row.reject_votes || 0,
      },
      stageRatings: Object.fromEntries(
        perStage
          .filter((entry) => Number(entry.candidate_id) === Number(row.id))
          .map((entry) => [entry.stage, { average: num(entry.average_rating), count: entry.count }])
      ),
    }));

    res.json({
      job: { id: Number(job.id), title: job.title, status: job.status },
      stages,
      candidates,
    });
  })
);

export default router;

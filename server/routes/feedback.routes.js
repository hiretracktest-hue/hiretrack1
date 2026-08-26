import express from "express";
import { db } from "../db/index.js";
import { asyncHandler, requirePermission, httpError } from "../middleware.js";
import * as v from "../validate.js";
import { stagesFor } from "./jobs.routes.js";

/**
 * Scenario 1: "interviewers log in to leave feedback at their stage, and
 * candidates can be compared fairly". Everyone scores out of 5 and gives
 * the same recommendation options, which is what makes the comparison
 * table meaningful.
 */
const router = express.Router();

const RECOMMENDATIONS = ["ADVANCE", "HOLD", "REJECT"];

function toJson(row) {
  if (!row) return null;
  return {
    id: row.id,
    candidateId: row.candidate_id,
    candidateName: row.candidate_name ?? null,
    stage: row.stage,
    rating: row.rating,
    recommendation: row.recommendation,
    strengths: row.strengths,
    concerns: row.concerns,
    comment: row.comment,
    authorId: row.author_id,
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
      where.push("f.candidate_id = ?");
      params.push(v.id(req.query.candidate, { field: "candidate id" }));
    }
    if (req.query.mine === "1") {
      where.push("f.author_id = ?");
      params.push(req.user.id);
    }

    const rows = db
      .prepare(
        BASE_SELECT +
          (where.length ? "WHERE " + where.join(" AND ") + " " : "") +
          "ORDER BY datetime(f.created_at) DESC"
      )
      .all(...params);

    res.json({ feedback: rows.map(toJson) });
  })
);

// --- Leave (or update) my feedback for one stage ------------------------
router.post(
  "/",
  requirePermission("feedback:write"),
  asyncHandler(async (req, res) => {
    const candidateId = v.id(req.body.candidateId, { field: "candidate id" });
    const candidate = db
      .prepare("SELECT * FROM candidates WHERE id = ?")
      .get(candidateId);
    if (!candidate) throw httpError(404, "That candidate does not exist.");

    const stages = stagesFor(candidate.job_id);
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
    db.prepare(
      "INSERT INTO feedback (candidate_id, author_id, stage, rating, recommendation, strengths, concerns, comment) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT (candidate_id, stage, author_id) DO UPDATE SET " +
        "rating = excluded.rating, recommendation = excluded.recommendation, " +
        "strengths = excluded.strengths, concerns = excluded.concerns, " +
        "comment = excluded.comment, created_at = datetime('now')"
    ).run(
      candidateId,
      req.user.id,
      stage,
      rating,
      recommendation,
      strengths,
      concerns,
      comment
    );

    const row = db
      .prepare(BASE_SELECT + "WHERE f.candidate_id = ? AND f.stage = ? AND f.author_id = ?")
      .get(candidateId, stage, req.user.id);

    res.status(201).json({ feedback: toJson(row) });
  })
);

// --- Delete my own feedback ---------------------------------------------
router.delete(
  "/:id",
  requirePermission("feedback:write"),
  asyncHandler(async (req, res) => {
    const id = v.id(req.params.id, { field: "feedback id" });
    const row = db.prepare("SELECT * FROM feedback WHERE id = ?").get(id);
    if (!row) throw httpError(404, "That feedback does not exist.");
    if (row.author_id !== req.user.id) {
      throw httpError(403, "You can only delete feedback that you wrote.");
    }

    db.prepare("DELETE FROM feedback WHERE id = ?").run(id);
    res.json({ ok: true });
  })
);

// --- Compare every candidate for one vacancy, side by side --------------
router.get(
  "/compare/:jobId",
  requirePermission("candidate:compare"),
  asyncHandler(async (req, res) => {
    const jobId = v.id(req.params.jobId, { field: "position id" });
    const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
    if (!job) throw httpError(404, "That position does not exist.");

    const stages = stagesFor(jobId);

    const rows = db
      .prepare(
        "SELECT a.id, a.full_name, a.email, a.current_stage, a.outcome, a.cv_band, " +
          "a.cv_stored_name IS NOT NULL AS has_cv, " +
          "COUNT(f.id) AS feedback_count, " +
          "ROUND(AVG(f.rating), 1) AS average_rating, " +
          "SUM(CASE WHEN f.recommendation = 'ADVANCE' THEN 1 ELSE 0 END) AS advance_votes, " +
          "SUM(CASE WHEN f.recommendation = 'HOLD'    THEN 1 ELSE 0 END) AS hold_votes, " +
          "SUM(CASE WHEN f.recommendation = 'REJECT'  THEN 1 ELSE 0 END) AS reject_votes " +
          "FROM candidates a " +
          "LEFT JOIN feedback f ON f.candidate_id = a.id " +
          "WHERE a.job_id = ? " +
          "GROUP BY a.id " +
          "ORDER BY average_rating DESC NULLS LAST, a.full_name ASC"
      )
      .all(jobId);

    // Per-stage average for each candidate, so the table can show how
    // someone did at "Screening" versus "Technical Interview".
    const perStage = db
      .prepare(
        "SELECT candidate_id, stage, ROUND(AVG(rating), 1) AS average_rating, COUNT(*) AS count " +
          "FROM feedback WHERE candidate_id IN (SELECT id FROM candidates WHERE job_id = ?) " +
          "GROUP BY candidate_id, stage"
      )
      .all(jobId);

    const candidates = rows.map((row) => ({
      id: row.id,
      fullName: row.full_name,
      email: row.email,
      currentStage: row.current_stage,
      outcome: row.outcome,
      cvBand: row.cv_band,
      hasCv: Boolean(row.has_cv),
      feedbackCount: row.feedback_count,
      averageRating: row.average_rating,
      votes: {
        advance: row.advance_votes || 0,
        hold: row.hold_votes || 0,
        reject: row.reject_votes || 0,
      },
      stageRatings: Object.fromEntries(
        perStage
          .filter((entry) => entry.candidate_id === row.id)
          .map((entry) => [entry.stage, { average: entry.average_rating, count: entry.count }])
      ),
    }));

    res.json({ job: { id: job.id, title: job.title, status: job.status }, stages, candidates });
  })
);

export default router;

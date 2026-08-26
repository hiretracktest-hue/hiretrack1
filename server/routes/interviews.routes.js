import express from "express";
import { db } from "../db/index.js";
import { asyncHandler, requirePermission, httpError } from "../middleware.js";
import * as v from "../validate.js";
import { stagesFor } from "./jobs.routes.js";
import { notifyInterviewScheduled, notifyInterviewCancelled } from "../notify.js";

const router = express.Router();

function toJson(row) {
  if (!row) return null;
  return {
    id: row.id,
    candidateId: row.candidate_id,
    candidateName: row.candidate_name ?? null,
    candidateEmail: row.candidate_email ?? null,
    jobTitle: row.job_title ?? null,
    stage: row.stage,
    scheduledAt: row.scheduled_at,
    interviewerId: row.interviewer_id,
    interviewerName: row.interviewer_name,
    interviewerEmail: row.interviewer_email,
    location: row.location,
    notes: row.notes,
    createdByName: row.created_by_name ?? null,
    createdAt: row.created_at,
    // Has this interviewer left their feedback yet? This is what turns
    // the interview list into a to-do list.
    feedbackGiven: Boolean(row.feedback_given),
  };
}

const BASE_SELECT =
  "SELECT i.*, c.full_name AS candidate_name, c.email AS candidate_email, j.title AS job_title, " +
  "u.name AS created_by_name, " +
  "(SELECT COUNT(*) FROM feedback f WHERE f.candidate_id = i.candidate_id " +
  "  AND f.stage = i.stage AND f.author_id = i.interviewer_id) AS feedback_given " +
  "FROM interviews i " +
  "JOIN candidates c ON c.id = i.candidate_id " +
  "JOIN jobs j ON j.id = c.job_id " +
  "LEFT JOIN users u ON u.id = i.created_by ";

// --- List interviews ---------------------------------------------------
router.get(
  "/",
  requirePermission("interview:view"),
  asyncHandler(async (req, res) => {
    const where = [];
    const params = [];

    if (req.query.candidate) {
      where.push("i.candidate_id = ?");
      params.push(v.id(req.query.candidate, { field: "candidate id" }));
    }
    if (req.query.upcoming === "1") {
      where.push("datetime(i.scheduled_at) >= datetime('now')");
    }
    // An interviewer's own schedule.
    if (req.query.mine === "1") {
      where.push("i.interviewer_id = ?");
      params.push(req.user.id);
    }

    const rows = db
      .prepare(
        BASE_SELECT +
          (where.length ? "WHERE " + where.join(" AND ") + " " : "") +
          "ORDER BY datetime(i.scheduled_at) ASC"
      )
      .all(...params);

    res.json({ interviews: rows.map(toJson) });
  })
);

// --- Schedule an interview ---------------------------------------------
router.post(
  "/",
  requirePermission("interview:schedule"),
  asyncHandler(async (req, res) => {
    const candidateId = v.id(req.body.candidateId, { field: "candidate id" });
    const candidate = db.prepare("SELECT * FROM candidates WHERE id = ?").get(candidateId);
    if (!candidate) throw httpError(404, "That candidate does not exist.");

    const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(candidate.job_id);
    const stages = stagesFor(candidate.job_id);
    const stage = v.oneOf(req.body.stage, stages, {
      field: "Stage",
      fallback: candidate.current_stage,
    });

    const scheduledAt = v.str(req.body.scheduledAt, {
      field: "Date and time",
      required: true,
      max: 40,
    });
    const when = new Date(scheduledAt);
    if (Number.isNaN(when.getTime())) throw httpError(400, "Enter a valid date and time.");

    // The interviewer is picked from the staff list, so the notification
    // has somewhere to go and the feedback can be attributed.
    let interviewerId = null;
    let interviewerName = v.str(req.body.interviewerName, { field: "Interviewer", max: 120 });
    let interviewerEmail = req.body.interviewerEmail
      ? v.email(req.body.interviewerEmail, { field: "Interviewer email" })
      : "";

    if (req.body.interviewerId) {
      interviewerId = v.id(req.body.interviewerId, { field: "interviewer" });
      const person = db
        .prepare("SELECT id, name, email FROM users WHERE id = ? AND is_active = 1")
        .get(interviewerId);
      if (!person) throw httpError(404, "That interviewer does not exist.");
      interviewerName = person.name;
      interviewerEmail = person.email;
    }

    const location = v.str(req.body.location, { field: "Location", max: 200 });
    const notes = v.str(req.body.notes, { field: "Notes", max: 1000 });

    const info = db
      .prepare(
        "INSERT INTO interviews (candidate_id, stage, scheduled_at, interviewer_id, " +
          "interviewer_name, interviewer_email, location, notes, created_by) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        candidateId,
        stage,
        when.toISOString(),
        interviewerId,
        interviewerName,
        interviewerEmail,
        location,
        notes,
        req.user.id
      );

    const interview = db.prepare("SELECT * FROM interviews WHERE id = ?").get(info.lastInsertRowid);

    // Tell the interviewer in the app, and write the candidate's email
    // into the outbox.
    notifyInterviewScheduled({ interview, candidate, job, bookedBy: req.user });

    const row = db.prepare(BASE_SELECT + "WHERE i.id = ?").get(info.lastInsertRowid);
    res.status(201).json({ interview: toJson(row) });
  })
);

// --- Cancel an interview -----------------------------------------------
router.delete(
  "/:id",
  requirePermission("interview:schedule"),
  asyncHandler(async (req, res) => {
    const id = v.id(req.params.id, { field: "interview id" });
    const interview = db.prepare("SELECT * FROM interviews WHERE id = ?").get(id);
    if (!interview) throw httpError(404, "That interview does not exist.");

    const candidate = db
      .prepare("SELECT * FROM candidates WHERE id = ?")
      .get(interview.candidate_id);
    const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(candidate.job_id);

    notifyInterviewCancelled({ interview, candidate, job, cancelledBy: req.user });
    db.prepare("DELETE FROM interviews WHERE id = ?").run(id);

    res.json({ ok: true });
  })
);

export default router;

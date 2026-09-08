import express from "express";
import { one, many, run } from "../../database/index.js";
import { asyncHandler, requirePermission, httpError } from "../middleware.js";
import * as v from "../validate.js";
import { stagesFor } from "./jobs.routes.js";
import {
  notifyInterviewScheduled,
  notifyInterviewCancelled,
  notifyInterviewResponse,
} from "../notify.js";

const router = express.Router();

const num = (value) => (value === null || value === undefined ? null : Number(value));

const RESPONSES = ["PENDING", "ACCEPTED", "DECLINED"];

function toJson(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    candidateId: Number(row.candidate_id),
    candidateName: row.candidate_name ?? null,
    candidateEmail: row.candidate_email ?? null,
    jobTitle: row.job_title ?? null,
    stage: row.stage,
    scheduledAt: row.scheduled_at,
    interviewerId: num(row.interviewer_id),
    interviewerName: row.interviewer_name,
    interviewerEmail: row.interviewer_email,
    location: row.location,
    notes: row.notes,
    createdByName: row.created_by_name ?? null,
    createdAt: row.created_at,
    // Has the interviewer said yes? PENDING / ACCEPTED / DECLINED.
    response: row.response,
    responseNote: row.response_note,
    respondedAt: row.responded_at,
    // Has this interviewer left their feedback yet? This is what turns
    // the interview list into a to-do list.
    feedbackGiven: Number(row.feedback_given ?? 0) > 0,
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
      params.push(v.id(req.query.candidate, { field: "candidate id" }));
      where.push("i.candidate_id = $" + params.length);
    }
    if (req.query.upcoming === "1") {
      where.push("i.scheduled_at >= NOW()");
    }
    if (req.query.response) {
      params.push(
        v.oneOf(String(req.query.response), RESPONSES, { field: "Response" })
      );
      where.push("i.response = $" + params.length);
    }
    // An interviewer's own schedule.
    if (req.query.mine === "1") {
      params.push(req.user.id);
      where.push("i.interviewer_id = $" + params.length);
    }

    const rows = await many(
      BASE_SELECT +
        (where.length ? "WHERE " + where.join(" AND ") + " " : "") +
        "ORDER BY i.scheduled_at ASC",
      params
    );

    res.json({ interviews: rows.map(toJson) });
  })
);

// --- Schedule an interview ---------------------------------------------
router.post(
  "/",
  requirePermission("interview:schedule"),
  asyncHandler(async (req, res) => {
    const candidateId = v.id(req.body.candidateId, { field: "candidate id" });
    const candidate = await one("SELECT * FROM candidates WHERE id = $1", [candidateId]);
    if (!candidate) throw httpError(404, "That candidate does not exist.");

    const job = await one("SELECT * FROM jobs WHERE id = $1", [candidate.job_id]);
    const stages = await stagesFor(candidate.job_id);
    const stage = v.oneOf(req.body.stage, stages, {
      field: "Stage",
      fallback: candidate.current_stage,
    });

    // Missing, unreal and already-past dates each get their own message.
    const when = v.futureDateTime(req.body.scheduledAt, { field: "Date and time" });

    // The interviewer has to be somebody with an account: they are the
    // one who gets notified, and whose name the feedback is filed under.
    // Booking a slot with nobody running it just loses the candidate.
    if (!req.body.interviewerId) {
      throw httpError(400, "Choose the interviewer who will run this interview.");
    }

    const interviewerId = v.id(req.body.interviewerId, { field: "interviewer" });
    const person = await one(
      "SELECT id, name, email FROM users WHERE id = $1 AND is_active",
      [interviewerId]
    );
    if (!person) throw httpError(404, "That interviewer does not exist, or their account is closed.");
    const interviewerName = person.name;
    const interviewerEmail = person.email;

    // Two interviews for the same candidate at the same moment is
    // always a mistake - usually a double-submitted form.
    const clash = await one(
      "SELECT id FROM interviews WHERE candidate_id = $1 AND scheduled_at = $2",
      [candidateId, when.toISOString()]
    );
    if (clash) {
      throw httpError(409, "This candidate already has an interview booked at that exact time.");
    }

    const location = v.str(req.body.location, { field: "Location", max: 200 });
    const notes = v.str(req.body.notes, { field: "Notes", max: 1000 });

    const created = await one(
      "INSERT INTO interviews (candidate_id, stage, scheduled_at, interviewer_id, " +
        "interviewer_name, interviewer_email, location, notes, created_by) " +
        "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id",
      [
        candidateId,
        stage,
        when.toISOString(),
        interviewerId,
        interviewerName,
        interviewerEmail,
        location,
        notes,
        req.user.id,
      ]
    );

    // Booking is now the only place an interviewer is chosen, so it is
    // also what records who owns this candidate. That is what puts them
    // under "Only mine" on the interviewer's Candidates page, and it
    // used to depend on a second dropdown that no longer exists.
    // Only the first booking claims them - a later panel interview does
    // not quietly hand the candidate to somebody else.
    await run(
      "UPDATE candidates SET assigned_interviewer_id = $1, assigned_at = NOW(), " +
        "assigned_by = $2 WHERE id = $3 AND assigned_interviewer_id IS NULL",
      [interviewerId, req.user.id, candidateId]
    );

    const interview = await one("SELECT * FROM interviews WHERE id = $1", [created.id]);

    // Tell the interviewer in the app and by email, and send the
    // candidate their invitation. This is the candidate's first
    // message from us - being added does not email anybody - so the
    // screen needs to know whether it really went.
    const posted = await notifyInterviewScheduled({
      interview,
      candidate,
      job,
      bookedBy: req.user,
    });

    const row = await one(BASE_SELECT + "WHERE i.id = $1", [created.id]);
    res.status(201).json({
      interview: toJson(row),
      email: {
        to: candidate.email,
        sent: Boolean(posted?.sent),
        reason: posted?.reason || null,
      },
    });
  })
);

// --- The interviewer accepts or declines --------------------------------
//
// "How are candidates and interviewers told about a scheduled
// interview?" only answers half of it. Being told is not the same as
// agreeing to come, and a booking nobody answered is the thing that
// quietly derails a hiring process. So the interviewer answers here,
// and everyone who depends on that answer is told - see notify.js.
router.post(
  "/:id/respond",
  requirePermission("interview:view"),
  asyncHandler(async (req, res) => {
    const id = v.id(req.params.id, { field: "interview id" });
    const interview = await one("SELECT * FROM interviews WHERE id = $1", [id]);
    if (!interview) throw httpError(404, "That interview does not exist.");

    // Only the person actually being asked can answer. HR cannot accept
    // on somebody's behalf - that would defeat the point of asking.
    if (Number(interview.interviewer_id) !== req.user.id) {
      throw httpError(403, "Only the interviewer booked for this can answer it.");
    }

    const response = v.oneOf(req.body.response, ["ACCEPTED", "DECLINED"], {
      field: "Response",
    });
    const note = v.str(req.body.note, { field: "Note", max: 300 });

    if (interview.response === response) {
      throw httpError(400, "You have already " + response.toLowerCase() + " this interview.");
    }

    await run(
      "UPDATE interviews SET response = $1, response_note = $2, responded_at = NOW() WHERE id = $3",
      [response, note, id]
    );

    const updated = await one("SELECT * FROM interviews WHERE id = $1", [id]);
    const candidate = await one("SELECT * FROM candidates WHERE id = $1", [interview.candidate_id]);
    const job = await one("SELECT * FROM jobs WHERE id = $1", [candidate.job_id]);

    await notifyInterviewResponse({
      interview: updated,
      candidate,
      job,
      responder: req.user,
      accepted: response === "ACCEPTED",
    });

    const row = await one(BASE_SELECT + "WHERE i.id = $1", [id]);
    res.json({ interview: toJson(row) });
  })
);

// --- Cancel an interview -----------------------------------------------
router.delete(
  "/:id",
  requirePermission("interview:schedule"),
  asyncHandler(async (req, res) => {
    const id = v.id(req.params.id, { field: "interview id" });
    const interview = await one("SELECT * FROM interviews WHERE id = $1", [id]);
    if (!interview) throw httpError(404, "That interview does not exist.");

    const candidate = await one("SELECT * FROM candidates WHERE id = $1", [interview.candidate_id]);
    const job = await one("SELECT * FROM jobs WHERE id = $1", [candidate.job_id]);

    await notifyInterviewCancelled({ interview, candidate, job, cancelledBy: req.user });
    await run("DELETE FROM interviews WHERE id = $1", [id]);

    res.json({ ok: true });
  })
);

export default router;

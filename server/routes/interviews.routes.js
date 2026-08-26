import express from "express";
import { db } from "../db/index.js";
import { asyncHandler, requireStaff, httpError } from "../middleware.js";
import * as v from "../validate.js";
import { stagesFor } from "./jobs.routes.js";

const router = express.Router();

function toJson(row) {
  if (!row) return null;
  return {
    id: row.id,
    applicationId: row.application_id,
    candidateName: row.candidate_name ?? null,
    jobTitle: row.job_title ?? null,
    stage: row.stage,
    scheduledAt: row.scheduled_at,
    interviewerName: row.interviewer_name,
    interviewerEmail: row.interviewer_email,
    notes: row.notes,
    createdByName: row.created_by_name ?? null,
    createdAt: row.created_at,
  };
}

const BASE_SELECT =
  "SELECT i.*, a.full_name AS candidate_name, j.title AS job_title, u.name AS created_by_name " +
  "FROM interviews i " +
  "JOIN applications a ON a.id = i.application_id " +
  "JOIN jobs j ON j.id = a.job_id " +
  "LEFT JOIN users u ON u.id = i.created_by ";

// --- Upcoming interviews (optionally for one application) -------------
router.get(
  "/",
  requireStaff,
  asyncHandler(async (req, res) => {
    const where = [];
    const params = [];

    if (req.query.application) {
      where.push("i.application_id = ?");
      params.push(v.id(req.query.application, { field: "application id" }));
    }
    if (req.query.upcoming === "1") {
      where.push("datetime(i.scheduled_at) >= datetime('now')");
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

// --- Schedule an interview --------------------------------------------
router.post(
  "/",
  requireStaff,
  asyncHandler(async (req, res) => {
    const applicationId = v.id(req.body.applicationId, { field: "application id" });
    const application = db
      .prepare("SELECT * FROM applications WHERE id = ?")
      .get(applicationId);
    if (!application) throw httpError(404, "That application does not exist.");

    const stages = stagesFor(application.job_id);
    const stage = v.oneOf(req.body.stage, stages, {
      field: "Stage",
      fallback: application.current_stage,
    });

    const scheduledAt = v.str(req.body.scheduledAt, {
      field: "Date and time",
      required: true,
      max: 40,
    });
    const when = new Date(scheduledAt);
    if (Number.isNaN(when.getTime())) throw httpError(400, "Enter a valid date and time.");

    const interviewerName = v.str(req.body.interviewerName, { field: "Interviewer", max: 120 });
    const interviewerEmail = req.body.interviewerEmail
      ? v.email(req.body.interviewerEmail, { field: "Interviewer email" })
      : "";
    const notes = v.str(req.body.notes, { field: "Notes", max: 1000 });

    const info = db
      .prepare(
        "INSERT INTO interviews (application_id, stage, scheduled_at, interviewer_name, interviewer_email, notes, created_by) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        applicationId,
        stage,
        when.toISOString(),
        interviewerName,
        interviewerEmail,
        notes,
        req.user.id
      );

    const row = db.prepare(BASE_SELECT + "WHERE i.id = ?").get(info.lastInsertRowid);
    res.status(201).json({ interview: toJson(row) });
  })
);

// --- Cancel an interview -----------------------------------------------
router.delete(
  "/:id",
  requireStaff,
  asyncHandler(async (req, res) => {
    const id = v.id(req.params.id, { field: "interview id" });
    const info = db.prepare("DELETE FROM interviews WHERE id = ?").run(id);
    if (!info.changes) throw httpError(404, "That interview does not exist.");
    res.json({ ok: true });
  })
);

export default router;

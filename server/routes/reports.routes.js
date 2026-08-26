import express from "express";
import { db } from "../db/index.js";
import { asyncHandler, requirePermission } from "../middleware.js";

/**
 * "What reports would management want to export?"
 *
 * Management gets oversight without being able to change anything:
 * how many positions are open, how the pipeline is filling, how long
 * hiring is taking, and which stage people drop out at. Every report
 * can be downloaded as CSV so it can go into a slide or a spreadsheet.
 */
const router = express.Router();

const one = (sql, ...params) => db.prepare(sql).get(...params);
const all = (sql, ...params) => db.prepare(sql).all(...params);

function buildReport() {
  const summary = {
    openPositions: one("SELECT COUNT(*) AS v FROM jobs WHERE status = 'ACTIVE'").v,
    closedPositions: one("SELECT COUNT(*) AS v FROM jobs WHERE status = 'CLOSED'").v,
    totalCandidates: one("SELECT COUNT(*) AS v FROM candidates").v,
    activeCandidates: one("SELECT COUNT(*) AS v FROM candidates WHERE outcome = 'ACTIVE'").v,
    onHold: one("SELECT COUNT(*) AS v FROM candidates WHERE outcome = 'ON_HOLD'").v,
    hired: one("SELECT COUNT(*) AS v FROM candidates WHERE outcome = 'HIRED'").v,
    rejected: one("SELECT COUNT(*) AS v FROM candidates WHERE outcome = 'REJECTED'").v,
    cvsOnFile: one("SELECT COUNT(*) AS v FROM candidates WHERE cv_stored_name IS NOT NULL").v,
    awaitingScreening: one(
      "SELECT COUNT(*) AS v FROM candidates WHERE cv_band = 'UNRATED' AND cv_stored_name IS NOT NULL"
    ).v,
    interviewsScheduled: one("SELECT COUNT(*) AS v FROM interviews").v,
    upcomingInterviews: one(
      "SELECT COUNT(*) AS v FROM interviews WHERE datetime(scheduled_at) >= datetime('now')"
    ).v,
    feedbackSubmitted: one("SELECT COUNT(*) AS v FROM feedback").v,
    // Average days from being added to reaching a final outcome.
    averageDaysToDecision:
      one(
        "SELECT ROUND(AVG(julianday(updated_at) - julianday(created_at)), 1) AS v " +
          "FROM candidates WHERE outcome IN ('HIRED','REJECTED')"
      ).v ?? null,
  };

  // Per position: how many people, where they are, and the outcome split.
  // Each figure is its own subquery. Joining candidates and feedback in
  // one query would count a candidate once per piece of feedback they
  // have, which silently inflates every total.
  const positions = all(
    "SELECT j.id, j.title, j.department, j.status, j.created_at, " +
      "(SELECT COUNT(*) FROM candidates c WHERE c.job_id = j.id) AS candidates, " +
      "(SELECT COUNT(*) FROM candidates c WHERE c.job_id = j.id AND c.outcome = 'ACTIVE') AS active, " +
      "(SELECT COUNT(*) FROM candidates c WHERE c.job_id = j.id AND c.outcome = 'ON_HOLD') AS on_hold, " +
      "(SELECT COUNT(*) FROM candidates c WHERE c.job_id = j.id AND c.outcome = 'HIRED') AS hired, " +
      "(SELECT COUNT(*) FROM candidates c WHERE c.job_id = j.id AND c.outcome = 'REJECTED') AS rejected, " +
      "(SELECT COUNT(*) FROM candidates c WHERE c.job_id = j.id AND c.cv_band = 'HIGH') AS high_band, " +
      "(SELECT ROUND(AVG(f.rating), 1) FROM feedback f " +
      "   JOIN candidates c ON c.id = f.candidate_id WHERE c.job_id = j.id) AS average_rating " +
      "FROM jobs j ORDER BY j.status ASC, j.title ASC"
  ).map((row) => ({
    id: row.id,
    title: row.title,
    department: row.department,
    status: row.status,
    openedOn: row.created_at,
    candidates: row.candidates,
    active: row.active || 0,
    onHold: row.on_hold || 0,
    hired: row.hired || 0,
    rejected: row.rejected || 0,
    highBand: row.high_band || 0,
    averageRating: row.average_rating,
  }));

  // Where candidates are sitting - this is the drop-off view.
  const byStage = all(
    "SELECT j.title AS job_title, c.current_stage, COUNT(*) AS total " +
      "FROM candidates c JOIN jobs j ON j.id = c.job_id " +
      "WHERE c.outcome IN ('ACTIVE','ON_HOLD') " +
      "GROUP BY j.title, c.current_stage ORDER BY j.title, total DESC"
  ).map((row) => ({ jobTitle: row.job_title, stage: row.current_stage, total: row.total }));

  const byBand = all(
    "SELECT cv_band, COUNT(*) AS total FROM candidates GROUP BY cv_band"
  ).map((row) => ({ band: row.cv_band, total: row.total }));

  // Are interviewers actually leaving their feedback?
  const interviewerActivity = all(
    "SELECT u.name, u.role, " +
      "(SELECT COUNT(*) FROM interviews i WHERE i.interviewer_id = u.id) AS interviews, " +
      "(SELECT COUNT(*) FROM feedback f WHERE f.author_id = u.id) AS feedback, " +
      "(SELECT ROUND(AVG(f.rating), 1) FROM feedback f WHERE f.author_id = u.id) AS average_score " +
      "FROM users u WHERE u.is_active = 1 ORDER BY u.name"
  )
    .filter((row) => row.interviews > 0 || row.feedback > 0)
    .map((row) => ({
      name: row.name,
      role: row.role,
      interviews: row.interviews,
      feedback: row.feedback,
      averageScore: row.average_score,
      outstanding: Math.max(0, row.interviews - row.feedback),
    }));

  return { summary, positions, byStage, byBand, interviewerActivity };
}

router.get(
  "/",
  requirePermission("report:view"),
  asyncHandler(async (_req, res) => {
    res.json(buildReport());
  })
);

// --- CSV export ---------------------------------------------------------
function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  // Escape quotes and wrap anything containing a comma, quote or newline.
  return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function toCsv(headers, rows) {
  return [headers.join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\r\n");
}

router.get(
  "/export.csv",
  requirePermission("report:export"),
  asyncHandler(async (req, res) => {
    const which = String(req.query.report || "positions");
    const report = buildReport();
    let filename = "hiretrack-report.csv";
    let csv = "";

    if (which === "candidates") {
      filename = "hiretrack-candidates.csv";
      const rows = all(
        "SELECT c.full_name, c.email, c.phone, j.title AS job_title, j.department, " +
          "c.current_stage, c.outcome, c.cv_band, c.source, c.created_at, " +
          "(SELECT ROUND(AVG(f.rating), 1) FROM feedback f WHERE f.candidate_id = c.id) AS average_rating " +
          "FROM candidates c JOIN jobs j ON j.id = c.job_id ORDER BY j.title, c.full_name"
      );
      csv = toCsv(
        ["Name", "Email", "Phone", "Position", "Department", "Stage", "Outcome", "CV band", "Source", "Average score", "Added on"],
        rows.map((r) => [
          r.full_name, r.email, r.phone, r.job_title, r.department,
          r.current_stage, r.outcome, r.cv_band, r.source, r.average_rating ?? "", r.created_at,
        ])
      );
    } else if (which === "stages") {
      filename = "hiretrack-pipeline.csv";
      csv = toCsv(
        ["Position", "Stage", "Candidates"],
        report.byStage.map((r) => [r.jobTitle, r.stage, r.total])
      );
    } else if (which === "interviewers") {
      filename = "hiretrack-interviewer-activity.csv";
      csv = toCsv(
        ["Name", "Role", "Interviews", "Feedback given", "Outstanding", "Average score"],
        report.interviewerActivity.map((r) => [
          r.name, r.role, r.interviews, r.feedback, r.outstanding, r.averageScore ?? "",
        ])
      );
    } else {
      filename = "hiretrack-positions.csv";
      csv = toCsv(
        ["Position", "Department", "Status", "Opened on", "Candidates", "Active", "On hold", "Hired", "Rejected", "High band", "Average score"],
        report.positions.map((r) => [
          r.title, r.department, r.status, r.openedOn, r.candidates,
          r.active, r.onHold, r.hired, r.rejected, r.highBand, r.averageRating ?? "",
        ])
      );
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="' + filename + '"');
    // A BOM so Excel opens UTF-8 correctly.
    res.send("﻿" + csv);
  })
);

export default router;

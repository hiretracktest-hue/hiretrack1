import express from "express";
import { one, many } from "../../database/index.js";
import { asyncHandler, requirePermission } from "../middleware.js";

/**
 * "What reports would management want to export?"
 *
 * Oversight without edit rights: how many positions are open, how the
 * pipeline is filling, how long hiring is taking, and where candidates
 * drop out. Every table downloads as CSV.
 */
const router = express.Router();

const num = (value) => (value === null || value === undefined ? null : Number(value));

async function buildReport() {
  const summaryRow = await one(`
    SELECT
      (SELECT COUNT(*) FROM jobs WHERE status = 'ACTIVE')                    AS open_positions,
      (SELECT COUNT(*) FROM jobs WHERE status = 'CLOSED')                    AS closed_positions,
      (SELECT COUNT(*) FROM candidates)                                      AS total_candidates,
      (SELECT COUNT(*) FROM candidates WHERE outcome = 'ACTIVE')             AS active_candidates,
      (SELECT COUNT(*) FROM candidates WHERE outcome = 'ON_HOLD')            AS on_hold,
      (SELECT COUNT(*) FROM candidates WHERE outcome = 'HIRED')              AS hired,
      (SELECT COUNT(*) FROM candidates WHERE outcome = 'REJECTED')           AS rejected,
      (SELECT COUNT(*) FROM candidates WHERE cv_stored_name IS NOT NULL)     AS cvs_on_file,
      (SELECT COUNT(*) FROM candidates
        WHERE cv_band = 'UNRATED' AND cv_stored_name IS NOT NULL)            AS awaiting_screening,
      (SELECT COUNT(*) FROM interviews)                                      AS interviews_scheduled,
      (SELECT COUNT(*) FROM interviews WHERE scheduled_at >= NOW())          AS upcoming_interviews,
      (SELECT COUNT(*) FROM feedback)                                        AS feedback_submitted,
      -- EXTRACT(EPOCH …) gives seconds; divide to get days.
      (SELECT ROUND(AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 86400)::numeric, 1)
         FROM candidates WHERE outcome IN ('HIRED', 'REJECTED'))             AS average_days_to_decision
  `);

  const summary = {
    openPositions: Number(summaryRow.open_positions),
    closedPositions: Number(summaryRow.closed_positions),
    totalCandidates: Number(summaryRow.total_candidates),
    activeCandidates: Number(summaryRow.active_candidates),
    onHold: Number(summaryRow.on_hold),
    hired: Number(summaryRow.hired),
    rejected: Number(summaryRow.rejected),
    cvsOnFile: Number(summaryRow.cvs_on_file),
    awaitingScreening: Number(summaryRow.awaiting_screening),
    interviewsScheduled: Number(summaryRow.interviews_scheduled),
    upcomingInterviews: Number(summaryRow.upcoming_interviews),
    feedbackSubmitted: Number(summaryRow.feedback_submitted),
    averageDaysToDecision: num(summaryRow.average_days_to_decision),
  };

  // Each figure is its own subquery. Joining candidates to feedback in
  // one query would count a candidate once per review they have, which
  // silently inflates every total.
  const positions = (
    await many(`
      SELECT j.id, j.title, j.department, j.status, j.created_at,
        (SELECT COUNT(*) FROM candidates c WHERE c.job_id = j.id)                              AS candidates,
        (SELECT COUNT(*) FROM candidates c WHERE c.job_id = j.id AND c.outcome = 'ACTIVE')     AS active,
        (SELECT COUNT(*) FROM candidates c WHERE c.job_id = j.id AND c.outcome = 'ON_HOLD')    AS on_hold,
        (SELECT COUNT(*) FROM candidates c WHERE c.job_id = j.id AND c.outcome = 'HIRED')      AS hired,
        (SELECT COUNT(*) FROM candidates c WHERE c.job_id = j.id AND c.outcome = 'REJECTED')   AS rejected,
        (SELECT COUNT(*) FROM candidates c WHERE c.job_id = j.id AND c.cv_band = 'HIGH')       AS high_band,
        (SELECT ROUND(AVG(f.rating), 1) FROM feedback f
           JOIN candidates c ON c.id = f.candidate_id WHERE c.job_id = j.id)                   AS average_rating
      FROM jobs j
      ORDER BY j.status ASC, j.title ASC
    `)
  ).map((row) => ({
    id: Number(row.id),
    title: row.title,
    department: row.department,
    status: row.status,
    openedOn: row.created_at,
    candidates: Number(row.candidates),
    active: Number(row.active),
    onHold: Number(row.on_hold),
    hired: Number(row.hired),
    rejected: Number(row.rejected),
    highBand: Number(row.high_band),
    averageRating: num(row.average_rating),
  }));

  // Where candidates are sitting - this is the drop-off view.
  const byStage = (
    await many(`
      SELECT j.title AS job_title, c.current_stage, COUNT(*)::int AS total
      FROM candidates c JOIN jobs j ON j.id = c.job_id
      WHERE c.outcome IN ('ACTIVE', 'ON_HOLD')
      GROUP BY j.title, c.current_stage
      ORDER BY j.title, total DESC
    `)
  ).map((row) => ({ jobTitle: row.job_title, stage: row.current_stage, total: row.total }));

  const byBand = (
    await many("SELECT cv_band, COUNT(*)::int AS total FROM candidates GROUP BY cv_band")
  ).map((row) => ({ band: row.cv_band, total: row.total }));

  // Are interviewers actually leaving their feedback?
  const interviewerActivity = (
    await many(`
      SELECT u.name, u.role,
        (SELECT COUNT(*)::int FROM interviews i WHERE i.interviewer_id = u.id) AS interviews,
        (SELECT COUNT(*)::int FROM feedback f WHERE f.author_id = u.id)        AS feedback,
        (SELECT ROUND(AVG(f.rating), 1) FROM feedback f WHERE f.author_id = u.id) AS average_score
      FROM users u WHERE u.is_active ORDER BY u.name
    `)
  )
    .filter((row) => row.interviews > 0 || row.feedback > 0)
    .map((row) => ({
      name: row.name,
      role: row.role,
      interviews: row.interviews,
      feedback: row.feedback,
      averageScore: num(row.average_score),
      outstanding: Math.max(0, row.interviews - row.feedback),
    }));

  return { summary, positions, byStage, byBand, interviewerActivity };
}

router.get(
  "/",
  requirePermission("report:view"),
  asyncHandler(async (_req, res) => {
    res.json(await buildReport());
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
    const report = await buildReport();
    let filename = "hiretrack-positions.csv";
    let csv = "";

    if (which === "candidates") {
      filename = "hiretrack-candidates.csv";
      const rows = await many(`
        SELECT c.full_name, c.email, c.phone, j.title AS job_title, j.department,
               c.current_stage, c.outcome, c.cv_band, c.source, c.created_at,
               (SELECT ROUND(AVG(f.rating), 1) FROM feedback f WHERE f.candidate_id = c.id) AS average_rating
        FROM candidates c JOIN jobs j ON j.id = c.job_id
        ORDER BY j.title, c.full_name
      `);
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

import express from "express";
import { db } from "../db/index.js";
import { asyncHandler, httpError } from "../middleware.js";
import { stagesFor } from "./jobs.routes.js";

/**
 * The only routes in the system that need no account at all.
 *
 * HR posts a vacancy, copies its share link, and drops it into WhatsApp,
 * LinkedIn, Facebook or an email. Anyone who opens that link can read
 * the advert. Applying still requires signing in, so every CV that
 * arrives is attached to a real, verified account.
 */
const router = express.Router();

router.get(
  "/jobs/:token",
  asyncHandler(async (req, res) => {
    const token = String(req.params.token || "").trim();
    if (!token || token.length > 64) throw httpError(404, "That job link is not valid.");

    const row = db
      .prepare(
        "SELECT j.*, u.name AS created_by_name FROM jobs j " +
          "LEFT JOIN users u ON u.id = j.created_by WHERE j.public_token = ?"
      )
      .get(token);

    if (!row) throw httpError(404, "That job link is not valid or has been withdrawn.");

    // A closed vacancy still renders, so a shared link never dead-ends -
    // it just cannot be applied to any more.
    const stages = stagesFor(row.id);
    const applicantCount = db
      .prepare("SELECT COUNT(*) AS total FROM applications WHERE job_id = ?")
      .get(row.id).total;

    // Deliberately narrow: no internal notes, no applicant details, no
    // stage pipeline. Only what belongs in a public job advert.
    res.json({
      job: {
        id: row.id,
        publicToken: row.public_token,
        title: row.title,
        department: row.department,
        location: row.location,
        employmentType: row.employment_type,
        description: row.description,
        salaryRange: row.salary_range,
        closingDate: row.closing_date,
        status: row.status,
        postedBy: row.created_by_name,
        postedOn: row.created_at,
        stageCount: stages.length,
        applicantCount,
        openForApplications: row.status === "ACTIVE",
      },
      // Set when the reader is already signed in, so the page can say
      // "you already applied" instead of offering the button again.
      alreadyApplied: req.user
        ? Boolean(
            db
              .prepare("SELECT id FROM applications WHERE job_id = ? AND user_id = ?")
              .get(row.id, req.user.id)
          )
        : false,
      signedIn: Boolean(req.user),
    });
  })
);

/** Every open vacancy, for a public "careers" listing. */
router.get(
  "/jobs",
  asyncHandler(async (_req, res) => {
    const rows = db
      .prepare(
        "SELECT id, public_token, title, department, location, employment_type, salary_range, " +
          "description, created_at FROM jobs WHERE status = 'ACTIVE' ORDER BY datetime(created_at) DESC"
      )
      .all();

    res.json({
      jobs: rows.map((row) => ({
        id: row.id,
        publicToken: row.public_token,
        title: row.title,
        department: row.department,
        location: row.location,
        employmentType: row.employment_type,
        salaryRange: row.salary_range,
        description: row.description,
        postedOn: row.created_at,
      })),
    });
  })
);

export default router;

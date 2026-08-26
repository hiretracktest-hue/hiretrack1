import crypto from "node:crypto";
import express from "express";
import { db } from "../db/index.js";
import { config } from "../config.js";
import { asyncHandler, requireStaff, requirePermission, httpError } from "../middleware.js";
import * as v from "../validate.js";

const router = express.Router();

export const DEFAULT_STAGES = ["Applied", "Screening", "Interview", "Offer", "Hired"];
const EMPLOYMENT_TYPES = ["Full-time", "Part-time", "Contract", "Internship"];

const selectStages = db.prepare(
  "SELECT name FROM job_stages WHERE job_id = ? ORDER BY position ASC"
);
const selectJob = db.prepare("SELECT * FROM jobs WHERE id = ?");
const countApplicants = db.prepare(
  "SELECT COUNT(*) AS total FROM applications WHERE job_id = ?"
);

export function stagesFor(jobId) {
  return selectStages.all(jobId).map((row) => row.name);
}

/** Short, unguessable slug for the public share link. */
function newPublicToken() {
  return crypto.randomBytes(9).toString("base64url"); // 12 url-safe characters
}

/** The link HR copies into WhatsApp, LinkedIn or an email. */
export function shareUrlFor(token) {
  return config.clientUrl + "/job/" + token;
}

// Replaces the whole pipeline for a vacancy in one transaction, so the
// table can never be left half-updated if something fails.
const replaceStages = db.transaction((jobId, stages) => {
  db.prepare("DELETE FROM job_stages WHERE job_id = ?").run(jobId);
  const insert = db.prepare("INSERT INTO job_stages (job_id, name, position) VALUES (?, ?, ?)");
  stages.forEach((name, index) => insert.run(jobId, name, index));
});

export function jobToJson(row, { includeStages = true } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    department: row.department,
    location: row.location,
    employmentType: row.employment_type,
    description: row.description,
    salaryRange: row.salary_range,
    closingDate: row.closing_date,
    status: row.status,
    publicToken: row.public_token,
    shareUrl: row.public_token ? shareUrlFor(row.public_token) : null,
    createdBy: row.created_by,
    createdByName: row.created_by_name ?? null,
    applicantCount: row.applicant_count ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    stages: includeStages ? stagesFor(row.id) : undefined,
  };
}

// --- List vacancies ---------------------------------------------------
// Anyone can browse open vacancies. Signed-in team members also see
// closed ones and the applicant counts.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const status = req.query.status ? String(req.query.status).toUpperCase() : "";
    const search = String(req.query.q || "").trim();

    const where = [];
    const params = [];

    if (!req.user) {
      where.push("j.status = 'ACTIVE'");
    } else if (status === "ACTIVE" || status === "CLOSED") {
      where.push("j.status = ?");
      params.push(status);
    }

    if (search) {
      where.push("(j.title LIKE ? OR j.department LIKE ? OR j.location LIKE ?)");
      const like = "%" + search + "%";
      params.push(like, like, like);
    }

    const sql =
      "SELECT j.*, u.name AS created_by_name, " +
      "(SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id) AS applicant_count " +
      "FROM jobs j LEFT JOIN users u ON u.id = j.created_by " +
      (where.length ? "WHERE " + where.join(" AND ") + " " : "") +
      "ORDER BY j.status ASC, datetime(j.created_at) DESC";

    const rows = db.prepare(sql).all(...params);
    res.json({ jobs: rows.map((row) => jobToJson(row)) });
  })
);

// --- One vacancy ------------------------------------------------------
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const jobId = v.id(req.params.id, { field: "vacancy id" });
    const row = db
      .prepare(
        "SELECT j.*, u.name AS created_by_name FROM jobs j LEFT JOIN users u ON u.id = j.created_by WHERE j.id = ?"
      )
      .get(jobId);

    if (!row) throw httpError(404, "That vacancy does not exist.");
    if (!req.user && row.status !== "ACTIVE") {
      throw httpError(404, "That vacancy does not exist.");
    }

    const job = jobToJson(row);
    job.applicantCount = countApplicants.get(jobId).total;
    res.json({ job });
  })
);

// --- Create -----------------------------------------------------------
router.post(
  "/",
  requirePermission("vacancy:create"),
  asyncHandler(async (req, res) => {
    const title = v.str(req.body.title, { field: "Job title", required: true, max: 120 });
    const department = v.str(req.body.department, { field: "Department", max: 80 });
    const location = v.str(req.body.location, { field: "Location", max: 120 });
    const employmentType = v.oneOf(req.body.employmentType, EMPLOYMENT_TYPES, {
      field: "Employment type",
      fallback: "Full-time",
    });
    const description = v.str(req.body.description, { field: "Description", max: 5000 });
    const salaryRange = v.str(req.body.salaryRange, { field: "Salary range", max: 80 });
    const closingDate = v.str(req.body.closingDate, { field: "Closing date", max: 30 }) || null;
    const stages = v.stageList(req.body.stages, { fallback: DEFAULT_STAGES });

    const created = db.transaction(() => {
      const info = db
        .prepare(
          "INSERT INTO jobs (title, department, location, employment_type, description, salary_range, closing_date, created_by, public_token) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .run(
          title,
          department,
          location,
          employmentType,
          description,
          salaryRange,
          closingDate,
          req.user.id,
          newPublicToken()
        );
      const jobId = Number(info.lastInsertRowid);
      replaceStages(jobId, stages);
      return jobId;
    })();

    res.status(201).json({ job: jobToJson(selectJob.get(created)) });
  })
);

// --- Update / close / reopen -----------------------------------------
router.patch(
  "/:id",
  requirePermission("vacancy:edit"),
  asyncHandler(async (req, res) => {
    const jobId = v.id(req.params.id, { field: "vacancy id" });
    const existing = selectJob.get(jobId);
    if (!existing) throw httpError(404, "That vacancy does not exist.");

    const fields = [];
    const params = [];

    const push = (column, value) => {
      fields.push(column + " = ?");
      params.push(value);
    };

    if (req.body.title !== undefined) {
      push("title", v.str(req.body.title, { field: "Job title", required: true, max: 120 }));
    }
    if (req.body.department !== undefined) {
      push("department", v.str(req.body.department, { field: "Department", max: 80 }));
    }
    if (req.body.location !== undefined) {
      push("location", v.str(req.body.location, { field: "Location", max: 120 }));
    }
    if (req.body.employmentType !== undefined) {
      push(
        "employment_type",
        v.oneOf(req.body.employmentType, EMPLOYMENT_TYPES, { field: "Employment type" })
      );
    }
    if (req.body.description !== undefined) {
      push("description", v.str(req.body.description, { field: "Description", max: 5000 }));
    }
    if (req.body.salaryRange !== undefined) {
      push("salary_range", v.str(req.body.salaryRange, { field: "Salary range", max: 80 }));
    }
    if (req.body.closingDate !== undefined) {
      push("closing_date", v.str(req.body.closingDate, { field: "Closing date", max: 30 }) || null);
    }
    if (req.body.status !== undefined) {
      push("status", v.oneOf(req.body.status, ["ACTIVE", "CLOSED"], { field: "Status" }));
    }

    const stages = v.stageList(req.body.stages, { fallback: undefined });

    // A stage that candidates are currently sitting on cannot be deleted,
    // otherwise their current_stage would point at nothing.
    if (stages) {
      const inUse = db
        .prepare("SELECT DISTINCT current_stage FROM applications WHERE job_id = ?")
        .all(jobId)
        .map((row) => row.current_stage);
      const orphaned = inUse.filter((stage) => !stages.includes(stage));
      if (orphaned.length) {
        throw httpError(
          400,
          "Cannot remove these stages while candidates are still on them: " + orphaned.join(", ")
        );
      }
    }

    db.transaction(() => {
      if (fields.length) {
        params.push(jobId);
        db.prepare(
          "UPDATE jobs SET " + fields.join(", ") + ", updated_at = datetime('now') WHERE id = ?"
        ).run(...params);
      }
      if (stages) replaceStages(jobId, stages);
    })();

    res.json({ job: jobToJson(selectJob.get(jobId)) });
  })
);

// --- Delete -----------------------------------------------------------
router.delete(
  "/:id",
  requirePermission("vacancy:delete"),
  asyncHandler(async (req, res) => {
    const jobId = v.id(req.params.id, { field: "vacancy id" });
    const existing = selectJob.get(jobId);
    if (!existing) throw httpError(404, "That vacancy does not exist.");

    const applicants = countApplicants.get(jobId).total;
    if (applicants > 0) {
      throw httpError(
        400,
        "This vacancy has " + applicants + " application(s). Close it instead of deleting it."
      );
    }

    db.prepare("DELETE FROM jobs WHERE id = ?").run(jobId);
    res.json({ ok: true });
  })
);

// --- Regenerate the public link ----------------------------------------
// Used when a link has been shared too widely and HR wants the old one
// to stop working.
router.post(
  "/:id/share/regenerate",
  requirePermission("vacancy:share"),
  asyncHandler(async (req, res) => {
    const jobId = v.id(req.params.id, { field: "vacancy id" });
    if (!selectJob.get(jobId)) throw httpError(404, "That vacancy does not exist.");

    const token = newPublicToken();
    db.prepare("UPDATE jobs SET public_token = ?, updated_at = datetime('now') WHERE id = ?").run(
      token,
      jobId
    );

    res.json({ job: jobToJson(selectJob.get(jobId)) });
  })
);

export default router;

/**
 * Seed script - creates the four group accounts plus some example
 * vacancies and candidates so the app is not empty on first run.
 *
 *   npm run seed          add anything that is missing (safe to re-run)
 *   npm run seed:reset    wipe every table first, then seed again
 *
 * TODO for the group: change the names, emails and the demo password
 * below to your own before you hand this in.
 */
import bcrypt from "bcryptjs";
import { db, DB_PATH } from "./db/index.js";

const RESET = process.argv.includes("--reset");
const DEMO_PASSWORD = "Password123";

// Our group. Replace the example.com addresses with each person's real
// email before the demo - Ahmed's is already correct.
const TEAM = [
  { name: "Isuru", email: "isuru@example.com", role: "developer" },
  { name: "Fazl", email: "fazl@example.com", role: "scrum_master" },
  { name: "Thariq", email: "thariq@example.com", role: "business_analyst" },
  { name: "Ahmed Asmi", email: "ahmed.asmi369@gmail.com", role: "qa" },
];

const JOBS = [
  {
    title: "Junior Software Engineer",
    department: "Engineering",
    location: "Colombo, Sri Lanka",
    employmentType: "Full-time",
    salaryRange: "LKR 120,000 - 160,000",
    description:
      "Work with our product team on a React and Node.js codebase. Fresh graduates welcome.",
    stages: ["Applied", "Screening", "Technical Interview", "Final Interview", "Offer"],
  },
  {
    title: "QA Engineer",
    department: "Quality Assurance",
    location: "Colombo, Sri Lanka (Hybrid)",
    employmentType: "Full-time",
    salaryRange: "LKR 130,000 - 170,000",
    description: "Manual and automated testing for our web platform. Experience with Cypress is a plus.",
    stages: ["Applied", "Screening", "Test Task", "Interview", "Offer"],
  },
  {
    title: "Business Analyst Intern",
    department: "Product",
    location: "Remote",
    employmentType: "Internship",
    salaryRange: "LKR 40,000 stipend",
    description: "Six month internship supporting requirements gathering and user story writing.",
    stages: ["Applied", "Screening", "Interview", "Offer"],
  },
];

const CANDIDATES = [
  {
    job: "Junior Software Engineer",
    fullName: "Maya Fernando",
    email: "maya.fernando@example.com",
    phone: "+94 77 123 4567",
    source: "LinkedIn",
    stage: "Technical Interview",
    outcome: "ACTIVE",
    coverNote: "Final year IT undergraduate, built three React projects.",
  },
  {
    job: "Junior Software Engineer",
    fullName: "Dinuka Perera",
    email: "dinuka.perera@example.com",
    phone: "+94 71 998 2211",
    source: "University career fair",
    stage: "Screening",
    outcome: "ON_HOLD",
    coverNote: "Strong Java background, learning JavaScript.",
  },
  {
    job: "QA Engineer",
    fullName: "Nimasha Silva",
    email: "nimasha.silva@example.com",
    phone: "+94 76 445 0091",
    source: "Referral",
    stage: "Interview",
    outcome: "ACTIVE",
    coverNote: "Two years of manual testing, ISTQB certified.",
  },
  {
    job: "Business Analyst Intern",
    fullName: "Rashmi Jayawardena",
    email: "rashmi.j@example.com",
    phone: "+94 70 332 7788",
    source: "Job board",
    stage: "Applied",
    outcome: "ACTIVE",
    coverNote: "Second year business information systems student.",
  },
];

function reset() {
  db.exec(
    "PRAGMA foreign_keys = OFF;" +
      "DELETE FROM interviews;" +
      "DELETE FROM applications;" +
      "DELETE FROM job_stages;" +
      "DELETE FROM jobs;" +
      "DELETE FROM password_resets;" +
      "DELETE FROM users;" +
      "DELETE FROM sqlite_sequence;" +
      "PRAGMA foreign_keys = ON;"
  );
  console.log("  cleared every table");
}

function seedTeam() {
  const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);
  const insert = db.prepare(
    "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)"
  );
  const find = db.prepare("SELECT id FROM users WHERE email = ?");

  const ids = {};
  for (const member of TEAM) {
    const existing = find.get(member.email);
    if (existing) {
      ids[member.role] = existing.id;
      console.log("  user exists   " + member.email);
      continue;
    }
    const info = insert.run(member.name, member.email, hash, member.role);
    ids[member.role] = Number(info.lastInsertRowid);
    console.log("  user created  " + member.email + "  (" + member.role + ")");
  }
  return ids;
}

function seedJobs(ownerId) {
  const insertJob = db.prepare(
    "INSERT INTO jobs (title, department, location, employment_type, description, salary_range, created_by) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  const insertStage = db.prepare(
    "INSERT INTO job_stages (job_id, name, position) VALUES (?, ?, ?)"
  );
  const findJob = db.prepare("SELECT id FROM jobs WHERE title = ?");

  const ids = {};
  for (const job of JOBS) {
    const existing = findJob.get(job.title);
    if (existing) {
      ids[job.title] = existing.id;
      console.log("  job exists    " + job.title);
      continue;
    }
    const info = insertJob.run(
      job.title,
      job.department,
      job.location,
      job.employmentType,
      job.description,
      job.salaryRange,
      ownerId
    );
    const jobId = Number(info.lastInsertRowid);
    job.stages.forEach((name, index) => insertStage.run(jobId, name, index));
    ids[job.title] = jobId;
    console.log("  job created   " + job.title + "  (" + job.stages.length + " stages)");
  }
  return ids;
}

function seedCandidates(jobIds, applicantId) {
  const insert = db.prepare(
    "INSERT INTO applications (job_id, user_id, full_name, email, phone, source, cover_note, current_stage, outcome) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const find = db.prepare("SELECT id FROM applications WHERE job_id = ? AND email = ?");

  for (const candidate of CANDIDATES) {
    const jobId = jobIds[candidate.job];
    if (!jobId) continue;
    if (find.get(jobId, candidate.email)) {
      console.log("  candidate ex. " + candidate.fullName);
      continue;
    }
    insert.run(
      jobId,
      applicantId,
      candidate.fullName,
      candidate.email,
      candidate.phone,
      candidate.source,
      candidate.coverNote,
      candidate.stage,
      candidate.outcome
    );
    console.log("  candidate     " + candidate.fullName + " -> " + candidate.job);
  }
}

function seedInterview(jobIds) {
  const application = db
    .prepare("SELECT id, current_stage FROM applications WHERE email = ?")
    .get("maya.fernando@example.com");
  if (!application) return;

  const already = db
    .prepare("SELECT id FROM interviews WHERE application_id = ?")
    .get(application.id);
  if (already) return;

  const inThreeDays = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    "INSERT INTO interviews (application_id, stage, scheduled_at, interviewer_name, interviewer_email, notes) " +
      "VALUES (?, ?, ?, ?, ?, ?)"
  ).run(
    application.id,
    application.current_stage,
    inThreeDays,
    "Ahmed Asmi",
    "ahmed.asmi369@gmail.com",
    "Pair programming exercise, 45 minutes."
  );
  console.log("  interview     scheduled for Maya Fernando");
}

console.log("\nSeeding " + DB_PATH + "\n");
if (RESET) reset();

db.transaction(() => {
  const userIds = seedTeam();
  const ownerId = userIds.developer ?? userIds.scrum_master;
  const jobIds = seedJobs(ownerId);
  seedCandidates(jobIds, ownerId);
  seedInterview(jobIds);
})();

console.log("\nDone. Sign in with any of these accounts:");
for (const member of TEAM) {
  console.log("  " + member.email.padEnd(34) + DEMO_PASSWORD);
}
console.log("");

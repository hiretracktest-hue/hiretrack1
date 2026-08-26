/**
 * Seed script - creates the hiring team accounts, some candidates and a
 * few example vacancies so the app is not empty on first run.
 *
 *   npm run seed          add anything that is missing (safe to re-run)
 *   npm run seed:reset    wipe every table first, then seed again
 *
 * TODO for the group: change the names, emails and the demo password
 * below to your own before you hand this in.
 */
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { db, DB_PATH } from "./db/index.js";

const RESET = process.argv.includes("--reset");

// The demo password for every seeded account. It is deliberately short
// and easy to type for the presentation. The sign-up form still enforces
// the proper rules (8+ characters with a letter and a number) - these
// rows are written straight into the database, so they skip it.
const DEMO_PASSWORD = "123";

// Our group. The role is the job they do INSIDE the system, and the
// roles carry different permissions (see server/config.js).
//   hr             - full access, opens vacancies, runs the pipeline
//   hiring_manager - works with candidates, cannot open a vacancy
//   interviewer    - sees candidates, leaves feedback only
const TEAM = [
  { name: "Isuru", email: "isuru@gmail.com", role: "hr" },
  { name: "Ahmed", email: "ahmed@gmail.com", role: "hr" },
  { name: "Fazl", email: "fazl@gmail.com", role: "hiring_manager" },
  { name: "Thariq", email: "thariq@gmail.com", role: "interviewer" },
];

// The personas from the project plan, so the document and the running
// system line up. Sign in as these to demonstrate each access level.
const PERSONAS = [
  { name: "Kevin Fernando", email: "kevin.fernando@gmail.com", role: "hr" },
  { name: "Arosh Perera", email: "arosh.perera@gmail.com", role: "hiring_manager" },
  { name: "Sara Salgadu", email: "sara.salgadu@gmail.com", role: "interviewer" },
];

// Candidates who applied through a shared job link.
const CANDIDATE_ACCOUNTS = [
  { name: "Maya Fernando", email: "maya.fernando@gmail.com" },
  { name: "Dinuka Perera", email: "dinuka.perera@gmail.com" },
  { name: "Nimasha Silva", email: "nimasha.silva@gmail.com" },
  { name: "Rashmi Jayawardena", email: "rashmi.jayawardena@gmail.com" },
  { name: "Tharindu Bandara", email: "tharindu.bandara@gmail.com" },
  { name: "Ishara Wickrama", email: "ishara.wickrama@gmail.com" },
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
    description:
      "Manual and automated testing for our web platform. Experience with Cypress is a plus.",
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
    email: "maya.fernando@gmail.com",
    phone: "+94 77 123 4567",
    source: "Shared link - LinkedIn",
    stage: "Technical Interview",
    outcome: "ACTIVE",
    cvStatus: "ACCEPTED",
    cvBand: "HIGH",
    coverNote: "Final year IT undergraduate, built three React projects.",
  },
  {
    job: "Junior Software Engineer",
    fullName: "Dinuka Perera",
    email: "dinuka.perera@gmail.com",
    phone: "+94 71 998 2211",
    source: "Shared link - WhatsApp",
    stage: "Screening",
    outcome: "ON_HOLD",
    cvStatus: "ACCEPTED",
    cvBand: "MEDIUM",
    coverNote: "Strong Java background, learning JavaScript.",
  },
  {
    job: "Junior Software Engineer",
    fullName: "Tharindu Bandara",
    email: "tharindu.bandara@gmail.com",
    phone: "+94 76 220 1188",
    source: "Shared link - Facebook",
    stage: "Applied",
    outcome: "ACTIVE",
    cvStatus: "PENDING",
    cvBand: "UNRATED",
    coverNote: "Two years of PHP experience, looking to move into JavaScript.",
  },
  {
    job: "Junior Software Engineer",
    fullName: "Ishara Wickrama",
    email: "ishara.wickrama@gmail.com",
    phone: "+94 70 771 3344",
    source: "Shared link - WhatsApp",
    stage: "Applied",
    outcome: "ACTIVE",
    cvStatus: "PENDING",
    cvBand: "LOW",
    coverNote: "Recent graduate, no professional experience yet.",
  },
  {
    job: "QA Engineer",
    fullName: "Nimasha Silva",
    email: "nimasha.silva@gmail.com",
    phone: "+94 76 445 0091",
    source: "Referral",
    stage: "Interview",
    outcome: "ACTIVE",
    cvStatus: "ACCEPTED",
    cvBand: "HIGH",
    coverNote: "Two years of manual testing, ISTQB certified.",
  },
  {
    job: "Business Analyst Intern",
    fullName: "Rashmi Jayawardena",
    email: "rashmi.jayawardena@gmail.com",
    phone: "+94 70 332 7788",
    source: "Shared link - LinkedIn",
    stage: "Applied",
    outcome: "ACTIVE",
    cvStatus: "PENDING",
    cvBand: "UNRATED",
    coverNote: "Second year business information systems student.",
  },
];

const publicToken = () => crypto.randomBytes(9).toString("base64url");

function reset() {
  db.exec(
    "PRAGMA foreign_keys = OFF;" +
      "DELETE FROM feedback;" +
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

function seedUsers(people, label) {
  const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);
  const insert = db.prepare(
    "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)"
  );
  const find = db.prepare("SELECT id, role FROM users WHERE email = ?");

  const ids = {};
  for (const person of people) {
    const existing = find.get(person.email);
    if (existing) {
      ids[person.email] = existing.id;
      continue;
    }
    const role = person.role || "candidate";
    ids[person.email] = Number(insert.run(person.name, person.email, hash, role).lastInsertRowid);
    console.log("  " + label.padEnd(12) + person.email.padEnd(32) + role);
  }
  return ids;
}

function seedJobs(ownerId) {
  const insertJob = db.prepare(
    "INSERT INTO jobs (title, department, location, employment_type, description, salary_range, created_by, public_token) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
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
      continue;
    }
    const info = insertJob.run(
      job.title,
      job.department,
      job.location,
      job.employmentType,
      job.description,
      job.salaryRange,
      ownerId,
      publicToken()
    );
    const jobId = Number(info.lastInsertRowid);
    job.stages.forEach((name, index) => insertStage.run(jobId, name, index));
    ids[job.title] = jobId;
    console.log("  vacancy     " + job.title + "  (" + job.stages.length + " stages)");
  }
  return ids;
}

function seedCandidates(jobIds, userIds, bandedById) {
  const insert = db.prepare(
    "INSERT INTO applications (job_id, user_id, full_name, email, phone, source, cover_note, " +
      "current_stage, outcome, cv_status, cv_band, cv_banded_by, cv_banded_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const find = db.prepare("SELECT id FROM applications WHERE job_id = ? AND email = ?");

  for (const candidate of CANDIDATES) {
    const jobId = jobIds[candidate.job];
    if (!jobId || find.get(jobId, candidate.email)) continue;

    const banded = candidate.cvBand !== "UNRATED";
    insert.run(
      jobId,
      userIds[candidate.email] ?? null,
      candidate.fullName,
      candidate.email,
      candidate.phone,
      candidate.source,
      candidate.coverNote,
      candidate.stage,
      candidate.outcome,
      candidate.cvStatus,
      candidate.cvBand,
      banded ? bandedById : null,
      banded ? new Date().toISOString().slice(0, 19).replace("T", " ") : null
    );
    console.log("  candidate   " + candidate.fullName.padEnd(22) + candidate.cvBand);
  }
}

function seedInterview(interviewerId) {
  const application = db
    .prepare("SELECT id, current_stage FROM applications WHERE email = ?")
    .get("maya.fernando@gmail.com");
  if (!application) return;
  if (db.prepare("SELECT id FROM interviews WHERE application_id = ?").get(application.id)) return;

  const inThreeDays = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    "INSERT INTO interviews (application_id, stage, scheduled_at, interviewer_name, interviewer_email, notes, created_by) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(
    application.id,
    application.current_stage,
    inThreeDays,
    "Thariq",
    "thariq@gmail.com",
    "Pair programming exercise, 45 minutes.",
    interviewerId
  );
  console.log("  interview   scheduled for Maya Fernando");
}

function seedFeedback(userIds) {
  const application = db
    .prepare("SELECT id FROM applications WHERE email = ?")
    .get("maya.fernando@gmail.com");
  if (!application) return;
  if (db.prepare("SELECT id FROM feedback WHERE application_id = ?").get(application.id)) return;

  const insert = db.prepare(
    "INSERT INTO feedback (application_id, author_id, stage, rating, recommendation, strengths, concerns, comment) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );

  insert.run(
    application.id,
    userIds["thariq@gmail.com"],
    "Screening",
    4,
    "ADVANCE",
    "Solid JavaScript, explained her projects clearly.",
    "Has not used SQL much.",
    "Happy to move her to the technical round."
  );
  insert.run(
    application.id,
    userIds["isuru@gmail.com"],
    "Screening",
    5,
    "ADVANCE",
    "Asked good questions about how we test.",
    "",
    "Strong communicator."
  );
  console.log("  feedback    2 entries for Maya Fernando");
}

console.log("\nSeeding " + DB_PATH + "\n");
if (RESET) reset();

db.transaction(() => {
  const teamIds = seedUsers(TEAM, "team");
  const personaIds = seedUsers(PERSONAS, "persona");
  const candidateIds = seedUsers(CANDIDATE_ACCOUNTS, "candidate");
  const userIds = { ...teamIds, ...personaIds, ...candidateIds };

  const hrId = teamIds["isuru@gmail.com"];
  const jobIds = seedJobs(hrId);
  seedCandidates(jobIds, userIds, hrId);
  seedInterview(userIds["thariq@gmail.com"]);
  seedFeedback(userIds);
})();

const shareLinks = db.prepare("SELECT title, public_token FROM jobs ORDER BY id").all();

console.log("\nDone. Every account below uses the password: " + DEMO_PASSWORD + "\n");
console.log("  THE HIRING TEAM");
for (const member of [...TEAM, ...PERSONAS]) {
  console.log("    " + member.email.padEnd(30) + member.role);
}
console.log("");
console.log("  CANDIDATES - apply and follow their own application only");
for (const person of CANDIDATE_ACCOUNTS) {
  console.log("    " + person.email.padEnd(30) + person.name);
}
console.log("");
console.log("  PUBLIC JOB LINKS - these are what HR shares on WhatsApp / LinkedIn");
for (const job of shareLinks) {
  console.log("    " + job.title.padEnd(26) + "http://localhost:5173/job/" + job.public_token);
}
console.log("");

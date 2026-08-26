/**
 * Seed script - creates the staff accounts, some open positions and a
 * few candidates so the app is not empty on first run.
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

// The demo password for every seeded account. It is deliberately short
// and easy to type for the presentation. Accounts created through the
// Team page still enforce the proper rules (8+ characters with a letter
// and a number) - these rows are written straight into the database.
const DEMO_PASSWORD = "123";

// Our group. Each of us takes one of the four roles so that every access
// level can be demonstrated in the viva.
const TEAM = [
  { name: "Isuru", email: "isuru@gmail.com", role: "hr", jobTitle: "Talent Acquisition Lead" },
  { name: "Fazl", email: "fazl@gmail.com", role: "hiring_manager", jobTitle: "Engineering Manager" },
  { name: "Thariq", email: "thariq@gmail.com", role: "interviewer", jobTitle: "Senior Engineer" },
  { name: "Ahmed", email: "ahmed@gmail.com", role: "management", jobTitle: "Head of Operations" },
];

// The personas from the project plan, so the document and the running
// system line up.
const PERSONAS = [
  { name: "Kevin Fernando", email: "kevin.fernando@gmail.com", role: "hr", jobTitle: "HR Manager" },
  { name: "Arosh Perera", email: "arosh.perera@gmail.com", role: "hiring_manager", jobTitle: "Hiring Manager" },
  { name: "Sara Salgadu", email: "sara.salgadu@gmail.com", role: "interviewer", jobTitle: "Senior Software Engineer" },
  { name: "Thusitha Samarasinghe", email: "thusitha.s@gmail.com", role: "management", jobTitle: "Operations Manager" },
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
    source: "LinkedIn",
    stage: "Technical Interview",
    outcome: "ACTIVE",
    cvBand: "HIGH",
    notes: "Final year IT undergraduate, built three React projects.",
  },
  {
    job: "Junior Software Engineer",
    fullName: "Dinuka Perera",
    email: "dinuka.perera@gmail.com",
    phone: "+94 71 998 2211",
    source: "University career fair",
    stage: "Screening",
    outcome: "ON_HOLD",
    cvBand: "MEDIUM",
    notes: "Strong Java background, learning JavaScript.",
  },
  {
    job: "Junior Software Engineer",
    fullName: "Tharindu Bandara",
    email: "tharindu.bandara@gmail.com",
    phone: "+94 76 220 1188",
    source: "Email application",
    stage: "Applied",
    outcome: "ACTIVE",
    cvBand: "UNRATED",
    notes: "Two years of PHP experience, moving into JavaScript.",
  },
  {
    job: "Junior Software Engineer",
    fullName: "Ishara Wickrama",
    email: "ishara.wickrama@gmail.com",
    phone: "+94 70 771 3344",
    source: "Job board",
    stage: "Applied",
    outcome: "ACTIVE",
    cvBand: "LOW",
    notes: "Recent graduate, no professional experience yet.",
  },
  {
    job: "QA Engineer",
    fullName: "Nimasha Silva",
    email: "nimasha.silva@gmail.com",
    phone: "+94 76 445 0091",
    source: "Referral",
    stage: "Interview",
    outcome: "ACTIVE",
    cvBand: "HIGH",
    notes: "Two years of manual testing, ISTQB certified.",
  },
  {
    job: "Business Analyst Intern",
    fullName: "Rashmi Jayawardena",
    email: "rashmi.jayawardena@gmail.com",
    phone: "+94 70 332 7788",
    source: "University career fair",
    stage: "Applied",
    outcome: "ACTIVE",
    cvBand: "UNRATED",
    notes: "Second year business information systems student.",
  },
];

function reset() {
  db.exec(
    "PRAGMA foreign_keys = OFF;" +
      "DELETE FROM notifications;" +
      "DELETE FROM feedback;" +
      "DELETE FROM interviews;" +
      "DELETE FROM candidates;" +
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
    "INSERT INTO users (name, email, password_hash, role, job_title) VALUES (?, ?, ?, ?, ?)"
  );
  const find = db.prepare("SELECT id FROM users WHERE email = ?");

  const ids = {};
  for (const person of people) {
    const existing = find.get(person.email);
    if (existing) {
      ids[person.email] = existing.id;
      continue;
    }
    ids[person.email] = Number(
      insert.run(person.name, person.email, hash, person.role, person.jobTitle || "").lastInsertRowid
    );
    console.log("  " + label.padEnd(10) + person.email.padEnd(30) + person.role);
  }
  return ids;
}

function seedJobs(hrId, managerId) {
  const insertJob = db.prepare(
    "INSERT INTO jobs (title, department, location, employment_type, description, salary_range, " +
      "hiring_manager, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
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
      managerId,
      hrId
    );
    const jobId = Number(info.lastInsertRowid);
    job.stages.forEach((name, index) => insertStage.run(jobId, name, index));
    ids[job.title] = jobId;
    console.log("  position  " + job.title + "  (" + job.stages.length + " stages)");
  }
  return ids;
}

function seedCandidates(jobIds, hrId) {
  const insert = db.prepare(
    "INSERT INTO candidates (job_id, full_name, email, phone, source, notes, current_stage, " +
      "outcome, cv_band, cv_banded_by, cv_banded_at, added_by) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const find = db.prepare("SELECT id FROM candidates WHERE job_id = ? AND email = ?");
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");

  for (const candidate of CANDIDATES) {
    const jobId = jobIds[candidate.job];
    if (!jobId || find.get(jobId, candidate.email)) continue;

    const banded = candidate.cvBand !== "UNRATED";
    insert.run(
      jobId,
      candidate.fullName,
      candidate.email,
      candidate.phone,
      candidate.source,
      candidate.notes,
      candidate.stage,
      candidate.outcome,
      candidate.cvBand,
      banded ? hrId : null,
      banded ? now : null,
      hrId
    );
    console.log("  candidate " + candidate.fullName.padEnd(22) + candidate.cvBand);
  }
}

function seedInterviewAndFeedback(userIds) {
  const candidate = db
    .prepare("SELECT * FROM candidates WHERE email = ?")
    .get("maya.fernando@gmail.com");
  if (!candidate) return;
  if (db.prepare("SELECT id FROM interviews WHERE candidate_id = ?").get(candidate.id)) return;

  const interviewerId = userIds["thariq@gmail.com"];
  const inThreeDays = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

  db.prepare(
    "INSERT INTO interviews (candidate_id, stage, scheduled_at, interviewer_id, interviewer_name, " +
      "interviewer_email, location, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    candidate.id,
    candidate.current_stage,
    inThreeDays,
    interviewerId,
    "Thariq",
    "thariq@gmail.com",
    "Meeting room 2 / Google Meet",
    "Pair programming exercise, 45 minutes.",
    userIds["isuru@gmail.com"]
  );
  console.log("  interview scheduled for Maya Fernando");

  const insertFeedback = db.prepare(
    "INSERT INTO feedback (candidate_id, author_id, stage, rating, recommendation, strengths, " +
      "concerns, comment) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  insertFeedback.run(
    candidate.id,
    interviewerId,
    "Screening",
    4,
    "ADVANCE",
    "Solid JavaScript, explained her projects clearly.",
    "Has not used SQL much.",
    "Happy to move her to the technical round."
  );
  insertFeedback.run(
    candidate.id,
    userIds["fazl@gmail.com"],
    "Screening",
    5,
    "ADVANCE",
    "Asked good questions about how we test.",
    "",
    "Strong communicator."
  );
  console.log("  feedback  2 entries for Maya Fernando");
}

console.log("\nSeeding " + DB_PATH + "\n");
if (RESET) reset();

db.transaction(() => {
  const teamIds = seedUsers(TEAM, "team");
  const personaIds = seedUsers(PERSONAS, "persona");
  const userIds = { ...teamIds, ...personaIds };

  const jobIds = seedJobs(teamIds["isuru@gmail.com"], teamIds["fazl@gmail.com"]);
  seedCandidates(jobIds, teamIds["isuru@gmail.com"]);
  seedInterviewAndFeedback(userIds);
})();

console.log("\nDone. Every account below uses the password: " + DEMO_PASSWORD + "\n");
console.log("  WHO LOGS IN                                   WHAT THEY CAN DO");
const WHAT = {
  hr: "Everything: open positions, add candidates, screen CVs, run the process",
  hiring_manager: "Candidates, comparison and the hire decision. No position control",
  interviewer: "Sees their candidates, leaves feedback at their stage",
  management: "Oversight: sees everything, changes nothing, exports reports",
};
for (const member of [...TEAM, ...PERSONAS]) {
  console.log("    " + member.email.padEnd(30) + (WHAT[member.role] || member.role));
}
console.log("");
console.log("  Candidates do NOT log in - HR adds them and uploads their CV.");
console.log("");

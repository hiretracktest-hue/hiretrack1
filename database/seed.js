/**
 * Seed script - creates the staff accounts, some open positions and a
 * few candidates so the app is not empty on first run.
 *
 *   npm run seed          add anything that is missing (safe to re-run)
 *   npm run seed:reset    empty every table first, then seed again
 *
 * The four demo logins it creates are listed in TEAM below and printed
 * again when the script finishes.
 */
import bcrypt from "bcryptjs";
import { one, run, transaction, closePool } from "./index.js";

const RESET = process.argv.includes("--reset");

// The four demo accounts, one per role, so every access level can be
// shown in the viva. Each has its own password rather than one shared
// one, so a marker can see the roles really are separate logins.
//
// These rows are written straight into the database, which is why the
// short passwords below are accepted. Accounts created through the Team
// page still go through the proper rule (8+ characters, a letter and a
// number) - see server/validate.js.
const TEAM = [
  {
    name: "Nimali Wijesinghe",
    email: "hr@hiretrack.test",
    password: "hr12345",
    role: "hr",
    jobTitle: "HR Manager",
  },
  {
    name: "Chathura Rajapaksha",
    email: "hiringmanager@hiretrack.test",
    password: "hm12345",
    role: "hiring_manager",
    jobTitle: "Engineering / Hiring Manager",
  },
  {
    name: "Sanduni Ekanayake",
    email: "int@hiretrack.test",
    password: "int12345",
    role: "interviewer",
    jobTitle: "Senior Software Engineer",
  },
  {
    name: "Mahesh Gunawardena",
    email: "manag@hiretrack.test",
    password: "manag12345",
    role: "management",
    jobTitle: "Operations Manager",
  },
];

// The addresses the rest of this script refers to, in one place, so a
// change up there does not have to be chased through the file.
const HR = "hr@hiretrack.test";
const HIRING_MANAGER = "hiringmanager@hiretrack.test";
const INTERVIEWER = "int@hiretrack.test";

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
    fullName: "Dilshan Herath",
    email: "dilshan.herath@gmail.com",
    phone: "+94 77 123 4567",
    source: "LinkedIn",
    stage: "Technical Interview",
    outcome: "ACTIVE",
    cvBand: "HIGH",
    notes: "Final year IT undergraduate, built three React projects.",
  },
  {
    job: "Junior Software Engineer",
    fullName: "Tharushi Weerasekara",
    email: "tharushi.weerasekara@gmail.com",
    phone: "+94 71 998 2211",
    source: "University career fair",
    stage: "Screening",
    outcome: "ON_HOLD",
    cvBand: "MEDIUM",
    notes: "Strong Java background, learning JavaScript.",
  },
  {
    job: "Junior Software Engineer",
    fullName: "Kasun Bandara",
    email: "kasun.bandara@gmail.com",
    phone: "+94 76 220 1188",
    source: "Email application",
    stage: "Applied",
    outcome: "ACTIVE",
    cvBand: "UNRATED",
    notes: "Two years of PHP experience, moving into JavaScript.",
  },
  {
    job: "Junior Software Engineer",
    fullName: "Amaya Dissanayake",
    email: "amaya.dissanayake@gmail.com",
    phone: "+94 70 771 3344",
    source: "Job board",
    stage: "Applied",
    outcome: "ACTIVE",
    cvBand: "LOW",
    notes: "Recent graduate, no professional experience yet.",
  },
  {
    job: "QA Engineer",
    fullName: "Sachini Rathnayake",
    email: "sachini.rathnayake@gmail.com",
    phone: "+94 76 445 0091",
    source: "Referral",
    stage: "Interview",
    outcome: "ACTIVE",
    cvBand: "HIGH",
    notes: "Two years of manual testing, ISTQB certified.",
  },
  {
    job: "Business Analyst Intern",
    fullName: "Nuwan Karunaratne",
    email: "nuwan.karunaratne@gmail.com",
    phone: "+94 70 332 7788",
    source: "University career fair",
    stage: "Applied",
    outcome: "ACTIVE",
    cvBand: "UNRATED",
    notes: "Second year business information systems student.",
  },
];

async function reset() {
  // TRUNCATE ... RESTART IDENTITY empties the tables and resets the id
  // counters; CASCADE follows the foreign keys for us.
  await run(
    "TRUNCATE notifications, feedback, interviews, candidates, job_stages, jobs, " +
      "password_resets, users RESTART IDENTITY CASCADE"
  );
  console.log("  emptied every table");
}

async function seedUsers(people) {
  const ids = {};

  for (const person of people) {
    // Each account has its own password, so it is hashed per person.
    const hash = bcrypt.hashSync(person.password, 10);

    const existing = await one("SELECT id FROM users WHERE email = $1", [person.email]);
    if (existing) {
      // Re-running the seed should still leave a working login, in case
      // the password was changed while testing.
      await run("UPDATE users SET password_hash = $1, is_active = TRUE WHERE id = $2", [
        hash,
        existing.id,
      ]);
      ids[person.email] = Number(existing.id);
      console.log("  account   " + person.email.padEnd(30) + person.role + "  (password reset)");
      continue;
    }

    const created = await one(
      "INSERT INTO users (name, email, password_hash, role, job_title) " +
        "VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [person.name, person.email, hash, person.role, person.jobTitle || ""]
    );
    ids[person.email] = Number(created.id);
    console.log("  account   " + person.email.padEnd(30) + person.role);
  }
  return ids;
}

async function seedJobs(hrId, managerId) {
  const ids = {};

  for (const job of JOBS) {
    const existing = await one("SELECT id FROM jobs WHERE title = $1", [job.title]);
    if (existing) {
      ids[job.title] = Number(existing.id);
      continue;
    }

    const created = await one(
      "INSERT INTO jobs (title, department, location, employment_type, description, " +
        "salary_range, hiring_manager, created_by) " +
        "VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
      [
        job.title,
        job.department,
        job.location,
        job.employmentType,
        job.description,
        job.salaryRange,
        managerId,
        hrId,
      ]
    );

    const jobId = Number(created.id);
    for (const [index, name] of job.stages.entries()) {
      await run("INSERT INTO job_stages (job_id, name, position) VALUES ($1, $2, $3)", [
        jobId,
        name,
        index,
      ]);
    }
    ids[job.title] = jobId;
    console.log("  position  " + job.title + "  (" + job.stages.length + " stages)");
  }
  return ids;
}

async function seedCandidates(jobIds, hrId) {
  for (const candidate of CANDIDATES) {
    const jobId = jobIds[candidate.job];
    if (!jobId) continue;

    const existing = await one("SELECT id FROM candidates WHERE job_id = $1 AND email = $2", [
      jobId,
      candidate.email,
    ]);
    if (existing) continue;

    const banded = candidate.cvBand !== "UNRATED";
    await run(
      "INSERT INTO candidates (job_id, full_name, email, phone, source, notes, current_stage, " +
        "outcome, cv_band, cv_banded_by, cv_banded_at, added_by) " +
        "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
      [
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
        banded ? new Date().toISOString() : null,
        hrId,
      ]
    );
    console.log("  candidate " + candidate.fullName.padEnd(22) + candidate.cvBand);
  }
}

async function seedInterviewAndFeedback(userIds) {
  const candidate = await one("SELECT * FROM candidates WHERE email = $1", [
    "dilshan.herath@gmail.com",
  ]);
  if (!candidate) return;
  if (await one("SELECT id FROM interviews WHERE candidate_id = $1", [candidate.id])) return;

  const interviewerId = userIds[INTERVIEWER];
  const inThreeDays = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

  await run(
    "INSERT INTO interviews (candidate_id, stage, scheduled_at, interviewer_id, interviewer_name, " +
      "interviewer_email, location, notes, created_by) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    [
      candidate.id,
      candidate.current_stage,
      inThreeDays,
      interviewerId,
      "Sanduni Ekanayake",
      INTERVIEWER,
      "Meeting room 2 / Google Meet",
      "Pair programming exercise, 45 minutes.",
      userIds[HR],
    ]
  );
  console.log("  interview scheduled for Dilshan Herath");

  const feedback = [
    [
      interviewerId,
      "Screening",
      4,
      "ADVANCE",
      "Solid JavaScript, explained his projects clearly.",
      "Has not used SQL much.",
      "Happy to move him to the technical round.",
    ],
    [
      userIds[HIRING_MANAGER],
      "Screening",
      5,
      "ADVANCE",
      "Asked good questions about how we test.",
      "",
      "Strong communicator.",
    ],
  ];

  for (const [authorId, stage, rating, recommendation, strengths, concerns, comment] of feedback) {
    await run(
      "INSERT INTO feedback (candidate_id, author_id, stage, rating, recommendation, strengths, " +
        "concerns, comment) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [candidate.id, authorId, stage, rating, recommendation, strengths, concerns, comment]
    );
  }
  console.log("  feedback  2 entries for Dilshan Herath");
}

async function main() {
  const info = await one("SELECT current_database() AS db");
  console.log("\nSeeding " + info.db + "\n");

  if (RESET) await reset();

  // Everything in one transaction: either the whole demo data set is
  // created or none of it is.
  await transaction(async () => {
    const userIds = await seedUsers(TEAM);

    const jobIds = await seedJobs(userIds[HR], userIds[HIRING_MANAGER]);
    await seedCandidates(jobIds, userIds[HR]);
    await seedInterviewAndFeedback(userIds);
  });

  const WHAT = {
    hr: "Everything: open positions, add candidates, screen CVs, run the process",
    hiring_manager: "Candidates, comparison and the hire decision. No position control",
    interviewer: "Sees their candidates, leaves feedback at their stage",
    management: "Oversight: sees everything, changes nothing, exports reports",
  };

  console.log("\nDone. Sign in with any of these:\n");
  console.log("  EMAIL                          PASSWORD      WHAT THEY CAN DO");
  for (const member of TEAM) {
    console.log("  " + member.email.padEnd(31) + member.password.padEnd(14) + WHAT[member.role]);
  }
  console.log("");
  console.log("  Candidates do NOT log in - HR adds them and uploads their CV.");
  console.log("");
}

main()
  .catch((err) => {
    console.error("\n  Seeding failed: " + err.message);
    if (err.sql) console.error("  While running:\n" + err.sql.slice(0, 300));
    process.exitCode = 1;
  })
  .finally(closePool);

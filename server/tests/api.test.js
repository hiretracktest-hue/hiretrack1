/**
 * Automated API tests - run them with:  npm test
 *
 * These run against the real PostgreSQL database in Supabase, but inside
 * their OWN throw-away schema which is created at the start and dropped
 * at the end. Your real tables are never touched.
 *
 * Needs DATABASE_URL in .env (see database/README.md). Set
 * TEST_DATABASE_URL if you would rather point the tests somewhere else.
 *
 * The suites follow the questions in the brief:
 *   - stages set per position
 *   - blocked from advancing until the current stage's feedback is in
 *   - feedback that allows a fair side-by-side comparison
 *   - candidates and interviewers told about a scheduled interview
 *   - who logs in, and what each role can see and do
 *   - reports management can export
 */
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import pg from "pg";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_FILE = path.join(__dirname, "..", "..", "database", "schema.sql");

// Run against the SESSION pooler (port 5432), not the transaction
// pooler (6543). In transaction mode the pooler hands the same backend
// to different clients, so the SET search_path below leaks out of the
// test run and into the live app - which is exactly what happened the
// first time these tests were run against Supabase.
const CONNECTION = (process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "").replace(
  ":6543/",
  ":5432/"
);
if (!CONNECTION) {
  console.error(
    "\n  DATABASE_URL is not set, so the tests cannot run.\n" +
      "  Copy .env.example to .env and paste your Supabase connection string in.\n" +
      "  Walkthrough: database/README.md\n"
  );
  process.exit(1);
}

// A schema name unique to this run, so two people can run the tests at
// the same time against the same database without colliding.
const TEST_SCHEMA = "hiretrack_test_" + Date.now() + "_" + process.pid;
process.env.DATABASE_URL = CONNECTION;
process.env.DATABASE_SCHEMA = TEST_SCHEMA;
process.env.JWT_SECRET = "test-secret-not-used-anywhere-else";
process.env.NODE_ENV = "test";

// Whatever is in .env, the tests get no mail provider and no Storage
// bucket. Without this, `npm test` would fire real messages at real
// addresses through a real account, and write throw-away CVs into the
// production bucket. Both must be off before config.js is imported,
// because it reads the environment once at module load.
delete process.env.RESEND_API_KEY;
delete process.env.RESEND_FROM_EMAIL;
delete process.env.SMTP_HOST;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const TEST_UPLOADS = path.join(os.tmpdir(), "hiretrack-test-uploads-" + Date.now());
fs.mkdirSync(TEST_UPLOADS, { recursive: true });
process.env.UPLOAD_DIR = TEST_UPLOADS;

// Build the test schema BEFORE the app imports its own pool.
const admin = new pg.Client({
  connectionString: CONNECTION,
  ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
});
await admin.connect();
await admin.query('CREATE SCHEMA "' + TEST_SCHEMA + '"');

// public has to be on the path as well: Supabase keeps the citext
// extension there, and an extension is one per database - it cannot be
// installed again inside the test schema. Tables still land in the test
// schema because it comes first.
await admin.query('SET search_path TO "' + TEST_SCHEMA + '", public');

// The DROP statements at the top of schema.sql exist so `npm run
// db:migrate` can be re-run. Here they are dangerous: the test schema is
// brand new, so an unqualified DROP would fall through to public and
// delete the real tables. Nothing needs dropping in a schema created a
// moment ago, so they are stripped out.
const schemaSql = fs
  .readFileSync(SCHEMA_FILE, "utf8")
  .replace(/^DROP\s+(TABLE|TYPE)\s+IF\s+EXISTS[^;]*;/gim, "");
await admin.query(schemaSql);

const { createApp } = await import("../app.js");
const { inviteToken } = await import("../mail.js");
const { one, many, run, closePool } = await import("../../database/index.js");

let server;
let baseUrl;
let cookie = "";

async function call(method, path, body, isForm = false) {
  const options = { method, headers: {} };
  if (cookie) options.headers.Cookie = cookie;

  if (body !== undefined) {
    if (isForm) {
      options.body = body;
    } else {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }
  }

  const response = await fetch(baseUrl + path, options);
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { status: response.status, data, headers: response.headers };
}

/** There is no public sign-up, so accounts are inserted the way the
 *  seed script does. */
async function makeUser(name, email, role) {
  await run("INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)", [
    name,
    email,
    bcrypt.hashSync("Password123", 10),
    role,
  ]);
}

async function signIn(email, password = "Password123") {
  cookie = "";
  const result = await call("POST", "/api/auth/signin", { email, password });
  assert.equal(result.status, 200, "could not sign in as " + email);
}

async function userId(email) {
  const row = await one("SELECT id FROM users WHERE email = $1", [email]);
  return Number(row.id);
}

before(async () => {
  const app = createApp({ log: false });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = "http://127.0.0.1:" + server.address().port;

  await makeUser("Test HR", "hr@example.com", "hr");
  await makeUser("Test Manager", "manager@example.com", "hiring_manager");
  await makeUser("Test Interviewer", "interviewer@example.com", "interviewer");
  await makeUser("Test Management", "management@example.com", "management");
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await closePool();
  // Remove the whole test schema - nothing is left behind in Supabase.
  await admin.query('DROP SCHEMA IF EXISTS "' + TEST_SCHEMA + '" CASCADE');
  await admin.end();
  fs.promises.rm(TEST_UPLOADS, { recursive: true, force: true }).catch(() => {});
});

describe("health and sign-in", () => {
  test("the API is up and talking to PostgreSQL", async () => {
    const { status, data } = await call("GET", "/api/health");
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.match(data.server, /PostgreSQL/);
  });

  test("there is no public sign-up route", async () => {
    const { status } = await call("POST", "/api/auth/signup", {
      name: "Outsider",
      email: "outsider@example.com",
      password: "Password123",
    });
    assert.equal(status, 404, "candidates do not get accounts");
  });

  test("a wrong password is rejected", async () => {
    cookie = "";
    const { status } = await call("POST", "/api/auth/signin", {
      email: "hr@example.com",
      password: "WrongPassword1",
    });
    assert.equal(status, 401);
  });

  test("/me returns the user with their permissions", async () => {
    await signIn("hr@example.com");
    const { data } = await call("GET", "/api/auth/me");
    assert.equal(data.user.roleLabel, "HR Recruiter");
    assert.equal(data.user.permissions["position:create"], true);
    assert.equal(data.user.permissions["report:export"], true);
  });

  test("email matching is case-insensitive (citext)", async () => {
    cookie = "";
    const { status } = await call("POST", "/api/auth/signin", {
      email: "HR@Example.com",
      password: "Password123",
    });
    assert.equal(status, 200);
  });

  test("forgot password never reveals whether an email exists", async () => {
    const known = await call("POST", "/api/auth/forgot-password", { email: "hr@example.com" });
    const unknown = await call("POST", "/api/auth/forgot-password", { email: "nobody@example.com" });
    assert.equal(known.data.message, unknown.data.message);
  });

  test("a reset token works once and only once", async () => {
    const { data } = await call("POST", "/api/auth/forgot-password", {
      email: "management@example.com",
    });
    const token = new URL(data.devResetUrl).searchParams.get("token");
    assert.equal(
      (await call("POST", "/api/auth/reset-password", { token, password: "Password456" })).status,
      200
    );
    assert.equal(
      (await call("POST", "/api/auth/reset-password", { token, password: "Password789" })).status,
      400
    );
  });
});

describe("positions and per-position interview stages", () => {
  test("HR opens a position with its own stages", async () => {
    await signIn("hr@example.com");
    const { status, data } = await call("POST", "/api/jobs", {
      title: "Junior Developer",
      department: "Engineering",
      stages: ["Applied", "Interview", "Offer"],
    });
    assert.equal(status, 201);
    assert.deepEqual(data.job.stages, ["Applied", "Interview", "Offer"]);
  });

  test("a second position can have a completely different process", async () => {
    const { data } = await call("POST", "/api/jobs", {
      title: "QA Engineer",
      stages: ["Applied", "Test Task", "Panel", "Offer"],
    });
    assert.deepEqual(data.job.stages, ["Applied", "Test Task", "Panel", "Offer"]);
  });

  test("a position must have a title", async () => {
    assert.equal((await call("POST", "/api/jobs", { title: "   " })).status, 400);
  });

  test("an invalid employment type is refused by the ENUM", async () => {
    const { status } = await call("POST", "/api/jobs", {
      title: "Bad type",
      employmentType: "Whenever",
    });
    assert.equal(status, 400);
  });
});

describe("HR adds candidates", () => {
  let jobId;

  test("HR adds a candidate, who starts at the first stage", async () => {
    jobId = Number((await one("SELECT id FROM jobs WHERE title = $1", ["Junior Developer"])).id);

    const { status, data } = await call("POST", "/api/candidates", {
      jobId,
      fullName: "Maya Fernando",
      email: "maya@example.com",
      phone: "0771234567",
      source: "LinkedIn",
    });
    assert.equal(status, 201);
    assert.equal(data.candidate.currentStage, "Applied");
    assert.equal(data.candidate.cvBand, "UNRATED");
    assert.equal(data.candidate.addedByName, "Test HR");
  });

  test("the same person cannot be added twice to one position", async () => {
    const { status } = await call("POST", "/api/candidates", {
      jobId,
      fullName: "Maya Again",
      email: "MAYA@example.com", // citext: the same address
    });
    assert.equal(status, 409);
  });

  test("a CV can be any kind of file", async () => {
    // A CV arrives as whatever the candidate happened to send. HR should
    // not have to convert a scan or an ODT before it can be filed.
    const id = Number((await one("SELECT id FROM candidates WHERE email = $1", ["maya@example.com"])).id);

    const kinds = [
      ["maya.pdf", "%PDF-1.4 cv", "application/pdf"],
      ["notes.txt", "plain notes", "text/plain"],
      ["portfolio.zip", "PK\u0003\u0004", "application/zip"],
      ["scan.png", "\u0089PNG", "image/png"],
    ];

    for (const [name, body, type] of kinds) {
      const form = new FormData();
      form.append("cv", new Blob([body], { type }), name);
      const upload = await call("POST", "/api/candidates/" + id + "/cv", form, true);
      assert.equal(upload.status, 200, name + " should be accepted");
      assert.equal(upload.data.candidate.cv.filename, name);
    }

    // Uploading again replaces what was there - a candidate has one CV.
    const finalForm = new FormData();
    finalForm.append("cv", new Blob(["%PDF-1.4 cv"], { type: "application/pdf" }), "maya.pdf");
    await call("POST", "/api/candidates/" + id + "/cv", finalForm, true);
  });

  test("a CV is always served as a download, never rendered", async () => {
    // This is what makes accepting any file type safe. An .html or .svg
    // CV would run its own scripts if a browser rendered it, and
    // rendering one on this origin would be XSS straight through the
    // app. It must come back as an attachment every time.
    const id = Number((await one("SELECT id FROM candidates WHERE email = $1", ["maya@example.com"])).id);

    const nasty = new FormData();
    nasty.append(
      "cv",
      new Blob(["<script>alert(1)</script>"], { type: "text/html" }),
      "cv.html"
    );
    assert.equal((await call("POST", "/api/candidates/" + id + "/cv", nasty, true)).status, 200);

    const response = await fetch(baseUrl + "/api/candidates/" + id + "/cv", {
      headers: { Cookie: cookie },
    });
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("content-disposition") || "",
      /^attachment/,
      "must be an attachment, not inline"
    );
    assert.match(response.headers.get("content-disposition") || "", /cv\.html/);
    assert.equal(
      response.headers.get("x-content-type-options"),
      "nosniff",
      "the browser must not second-guess the type"
    );

    // Put a normal CV back for the tests that follow.
    const restore = new FormData();
    restore.append("cv", new Blob(["%PDF-1.4 cv"], { type: "application/pdf" }), "maya.pdf");
    await call("POST", "/api/candidates/" + id + "/cv", restore, true);

    const again = await fetch(baseUrl + "/api/candidates/" + id + "/cv", {
      headers: { Cookie: cookie },
    });
    assert.match(again.headers.get("content-disposition") || "", /maya\.pdf/);
  });

  test("an invalid id returns a clear 400, not a crash", async () => {
    assert.equal((await call("GET", "/api/candidates/not-a-number")).status, 400);
  });
});

describe("CV screening bands", () => {
  let mayaId;

  test("HR bands a CV", async () => {
    mayaId = Number((await one("SELECT id FROM candidates WHERE email = $1", ["maya@example.com"])).id);
    const { status, data } = await call("POST", "/api/candidates/" + mayaId + "/band", {
      band: "HIGH",
      note: "Strong match",
    });
    assert.equal(status, 200);
    assert.equal(data.candidate.cvBand, "HIGH");
    assert.equal(data.candidate.bandedByName, "Test HR");
  });

  test("an invalid band is refused", async () => {
    assert.equal(
      (await call("POST", "/api/candidates/" + mayaId + "/band", { band: "AMAZING" })).status,
      400
    );
  });

  test("the list filters by band and reports the totals", async () => {
    const all = await call("GET", "/api/candidates");
    assert.equal(all.data.bandCounts.HIGH, 1);

    const high = await call("GET", "/api/candidates?cvBand=HIGH");
    assert.equal(high.data.candidates.length, 1);
    assert.equal((await call("GET", "/api/candidates?cvBand=LOW")).data.candidates.length, 0);
  });

  test("bulk banding screens several at once", async () => {
    const { status, data } = await call("POST", "/api/candidates/band/bulk", {
      ids: [mayaId],
      band: "MEDIUM",
    });
    assert.equal(status, 200);
    assert.equal(data.updated, 1);
    await call("POST", "/api/candidates/" + mayaId + "/band", { band: "HIGH" });
  });

  test("an interviewer cannot band a CV", async () => {
    await signIn("interviewer@example.com");
    assert.equal(
      (await call("POST", "/api/candidates/" + mayaId + "/band", { band: "LOW" })).status,
      403
    );
  });
});

describe("no advancing without feedback", () => {
  let mayaId;

  test("the first stage is exempt - nobody has interviewed them yet", async () => {
    mayaId = Number((await one("SELECT id FROM candidates WHERE email = $1", ["maya@example.com"])).id);
    await signIn("hr@example.com");
    const { status, data } = await call("POST", "/api/candidates/" + mayaId + "/advance");
    assert.equal(status, 200);
    assert.equal(data.candidate.currentStage, "Interview");
  });

  test("advancing past a stage with no feedback is blocked", async () => {
    const { status, data } = await call("POST", "/api/candidates/" + mayaId + "/advance");
    assert.equal(status, 400);
    assert.match(data.error, /Feedback for "Interview"/);
  });

  test("the gate cannot be side-stepped by patching the stage directly", async () => {
    // /advance refuses without feedback, so PATCH must refuse too -
    // otherwise the rule is one HTTP request away from being skipped.
    const jobId = Number((await one("SELECT job_id FROM candidates WHERE id = $1", [mayaId])).job_id);
    const stages = (
      await many("SELECT name FROM job_stages WHERE job_id = $1 ORDER BY position", [jobId])
    ).map((row) => row.name);

    const forward = await call("PATCH", "/api/candidates/" + mayaId, {
      currentStage: stages[stages.length - 1],
    });
    assert.equal(forward.status, 400);
    assert.match(forward.data.error, /Move to next stage/);

    const unchanged = await call("GET", "/api/candidates/" + mayaId);
    assert.equal(unchanged.data.candidate.currentStage, "Interview");
  });

  test("moving a candidate back a stage is still allowed - that is how a mistake is fixed", async () => {
    assert.equal(
      (await call("PATCH", "/api/candidates/" + mayaId, { currentStage: "Applied" })).status,
      200
    );
    // Put her back where the rest of this suite expects her. Feedback is
    // not in yet for "Applied", but the first stage is exempt.
    assert.equal((await call("POST", "/api/candidates/" + mayaId + "/advance")).status, 200);
  });

  test("once feedback is in, the candidate moves on", async () => {
    await signIn("interviewer@example.com");
    const feedback = await call("POST", "/api/feedback", {
      candidateId: mayaId,
      stage: "Interview",
      rating: 4,
      recommendation: "ADVANCE",
      strengths: "Explained her projects clearly.",
    });
    assert.equal(feedback.status, 201);

    await signIn("hr@example.com");
    const { status, data } = await call("POST", "/api/candidates/" + mayaId + "/advance");
    assert.equal(status, 200);
    assert.equal(data.candidate.currentStage, "Offer");
  });

  test("a candidate at the last stage cannot be advanced again", async () => {
    assert.equal((await call("POST", "/api/candidates/" + mayaId + "/advance")).status, 400);
  });
});

describe("fair side-by-side comparison", () => {
  let mayaId;
  let jobId;

  test("a rating outside 1-5 is refused", async () => {
    mayaId = Number((await one("SELECT id FROM candidates WHERE email = $1", ["maya@example.com"])).id);
    jobId = Number((await one("SELECT job_id FROM candidates WHERE id = $1", [mayaId])).job_id);

    assert.equal(
      (await call("POST", "/api/feedback", { candidateId: mayaId, stage: "Interview", rating: 9 }))
        .status,
      400
    );
  });

  test("writing again replaces my score instead of stacking a second one", async () => {
    await signIn("interviewer@example.com");
    await call("POST", "/api/feedback", {
      candidateId: mayaId,
      stage: "Interview",
      rating: 2,
      recommendation: "HOLD",
    });
    const { data } = await call("GET", "/api/feedback?candidate=" + mayaId + "&mine=1");
    assert.equal(data.feedback.length, 1);
    assert.equal(data.feedback[0].rating, 2);
  });

  test("the comparison table ranks candidates by average score", async () => {
    await signIn("manager@example.com");
    const { status, data } = await call("GET", "/api/feedback/compare/" + jobId);
    assert.equal(status, 200);
    assert.ok(data.stages.includes("Interview"));
    const maya = data.candidates.find((c) => c.id === mayaId);
    assert.equal(maya.averageRating, 2);
    assert.equal(maya.votes.hold, 1);
  });

  test("an interviewer cannot open the comparison", async () => {
    await signIn("interviewer@example.com");
    assert.equal((await call("GET", "/api/feedback/compare/" + jobId)).status, 403);
  });
});

describe("telling candidates and interviewers about an interview", () => {
  let interviewId;
  let mayaId;

  test("booking an interview notifies the interviewer in the app", async () => {
    mayaId = Number((await one("SELECT id FROM candidates WHERE email = $1", ["maya@example.com"])).id);
    await signIn("hr@example.com");

    const { status, data } = await call("POST", "/api/interviews", {
      candidateId: mayaId,
      stage: "Interview",
      scheduledAt: "2027-01-15T10:30",
      interviewerId: await userId("interviewer@example.com"),
      location: "Meeting room 2",
    });
    assert.equal(status, 201);
    assert.equal(data.interview.interviewerName, "Test Interviewer");
    interviewId = data.interview.id;

    await signIn("interviewer@example.com");
    const notes = await call("GET", "/api/notifications");
    assert.equal(notes.data.unread, 1);
    assert.match(notes.data.notifications[0].subject, /Please confirm/);
    assert.equal(notes.data.notifications[0].kind, "interview.booked");
  });

  test("the candidate's invitation email is written to the outbox", async () => {
    await signIn("hr@example.com");
    const { data } = await call("GET", "/api/notifications/outbox?pending=1");
    const invite = data.messages.find((m) => m.recipientEmail === "maya@example.com");
    assert.ok(invite, "an email is prepared for the candidate");
    assert.match(invite.subject, /Interview invitation/);
    assert.match(invite.body, /Meeting room 2/);
    assert.equal(invite.sentAt, null, "nothing is pretended to have been sent");
  });

  test("HR can mark an email as sent", async () => {
    const { data } = await call("GET", "/api/notifications/outbox?pending=1");
    const first = data.messages[0];
    assert.equal((await call("POST", "/api/notifications/outbox/" + first.id + "/sent")).status, 200);

    const after = await call("GET", "/api/notifications/outbox?pending=1");
    assert.ok(!after.data.messages.some((m) => m.id === first.id));
  });

  test("an interviewer can mark their notification read", async () => {
    await signIn("interviewer@example.com");
    const { data } = await call("GET", "/api/notifications");
    assert.equal(
      (await call("POST", "/api/notifications/" + data.notifications[0].id + "/read")).status,
      200
    );
    assert.equal((await call("GET", "/api/notifications")).data.unread, 0);
  });

  test("an interviewer cannot read the candidate outbox", async () => {
    assert.equal((await call("GET", "/api/notifications/outbox")).status, 403);
  });

  test("cancelling an interview emails the candidate too", async () => {
    await signIn("hr@example.com");
    assert.equal((await call("DELETE", "/api/interviews/" + interviewId)).status, 200);
    const { data } = await call("GET", "/api/notifications/outbox?pending=1");
    assert.ok(data.messages.some((m) => /rescheduling/i.test(m.subject)));
  });

  test("an invalid date is refused", async () => {
    const { status } = await call("POST", "/api/interviews", {
      candidateId: mayaId,
      stage: "Interview",
      scheduledAt: "the day after tomorrow",
    });
    assert.equal(status, 400);
  });
});

describe("the interviewer answers the booking", () => {
  let interviewId;
  let nimashaId;
  let jobId;

  const inbox = async (email, password = "Password123") => {
    await signIn(email, password);
    const { data } = await call("GET", "/api/notifications");
    return data.notifications;
  };

  test("a fresh booking starts as PENDING", async () => {
    jobId = Number((await one("SELECT id FROM jobs WHERE title = $1", ["Junior Developer"])).id);
    await signIn("hr@example.com");

    const added = await call("POST", "/api/candidates", {
      jobId,
      fullName: "Nimasha Silva",
      email: "nimasha@example.com",
    });
    nimashaId = added.data.candidate.id;

    const { status, data } = await call("POST", "/api/interviews", {
      candidateId: nimashaId,
      stage: "Applied",
      scheduledAt: "2027-03-02T09:00",
      interviewerId: await userId("interviewer@example.com"),
      location: "Room 4",
    });
    assert.equal(status, 201);
    assert.equal(data.interview.response, "PENDING", "nobody has agreed to anything yet");
    interviewId = data.interview.id;
  });

  test("HR cannot accept on the interviewer's behalf", async () => {
    // Otherwise asking would be pointless - HR could just answer for them.
    const { status } = await call("POST", "/api/interviews/" + interviewId + "/respond", {
      response: "ACCEPTED",
    });
    assert.equal(status, 403);
  });

  test("the interviewer accepts, and it is recorded", async () => {
    await signIn("interviewer@example.com");
    const { status, data } = await call("POST", "/api/interviews/" + interviewId + "/respond", {
      response: "ACCEPTED",
      note: "Happy to take this one.",
    });
    assert.equal(status, 200);
    assert.equal(data.interview.response, "ACCEPTED");
    assert.equal(data.interview.responseNote, "Happy to take this one.");
    assert.ok(data.interview.respondedAt, "the time of the answer is kept");
  });

  test("answering twice the same way is refused", async () => {
    const { status } = await call("POST", "/api/interviews/" + interviewId + "/respond", {
      response: "ACCEPTED",
    });
    assert.equal(status, 400);
  });

  test("accepting tells each role something different", async () => {
    // This is the point of the whole feature: one event, four audiences,
    // and nobody gets a message that is not theirs.
    const mine = (notes) => notes.filter((n) => n.kind === "interview.accepted");

    const interviewer = mine(await inbox("interviewer@example.com"));
    assert.ok(
      interviewer.some((n) => /^You accepted/.test(n.subject)),
      "the interviewer gets their own confirmation"
    );

    const hr = mine(await inbox("hr@example.com"));
    assert.ok(
      hr.some((n) => /Test Interviewer accepted/.test(n.subject)),
      "HR booked it, so HR hears back"
    );

    const manager = mine(await inbox("manager@example.com"));
    assert.ok(
      manager.some((n) => /Interview confirmed/.test(n.subject)),
      "the hiring manager is told the position is moving"
    );

    const management = mine(await inbox("management@example.com", "Password456"));
    assert.equal(management.length, 0, "management watches hires, not calendar admin");
  });

  test("the candidate's confirmation letter is written", async () => {
    await signIn("hr@example.com");
    const { data } = await call("GET", "/api/notifications/outbox?candidate=" + nimashaId);
    const confirmation = data.messages.find((m) => m.kind === "interview.confirmed");
    assert.ok(confirmation, "the candidate is told it is going ahead");
    assert.equal(confirmation.recipientEmail, "nimasha@example.com");
    assert.equal(confirmation.sentAt, null);
  });

  test("declining reaches HR with the reason, and nobody else", async () => {
    await signIn("hr@example.com");
    const booked = await call("POST", "/api/interviews", {
      candidateId: nimashaId,
      stage: "Applied",
      scheduledAt: "2027-04-02T09:00",
      interviewerId: await userId("interviewer@example.com"),
    });

    await signIn("interviewer@example.com");
    assert.equal(
      (await call("POST", "/api/interviews/" + booked.data.interview.id + "/respond", {
        response: "DECLINED",
        note: "I am on leave that week.",
      })).status,
      200
    );

    const hr = (await inbox("hr@example.com")).filter((n) => n.kind === "interview.declined");
    assert.equal(hr.length, 1, "HR is the one who has to rebook");
    assert.match(hr[0].subject, /Action needed/);
    assert.match(hr[0].body, /on leave that week/, "the reason travels with it");

    const manager = (await inbox("manager@example.com")).filter(
      (n) => n.kind === "interview.declined"
    );
    assert.equal(manager.length, 0, "a declined booking is not the manager's problem yet");
  });

  test("feedback tells HR and the hiring manager, but not its own author", async () => {
    await signIn("interviewer@example.com");
    assert.equal(
      (await call("POST", "/api/feedback", {
        candidateId: nimashaId,
        stage: "Applied",
        rating: 4,
        recommendation: "ADVANCE",
        strengths: "Clear communicator.",
      })).status,
      201
    );

    const kind = (notes) => notes.filter((n) => n.kind === "feedback.submitted");
    assert.ok(kind(await inbox("hr@example.com")).length > 0, "HR runs the process");
    assert.ok(kind(await inbox("manager@example.com")).length > 0, "the manager makes the call");
    assert.equal(
      kind(await inbox("interviewer@example.com")).length,
      0,
      "being told what you just did yourself is noise"
    );
  });
});

describe("answering the invitation from the email link", () => {
  let interviewId;
  let token;
  let candidateId;

  test("HR books an interview and a link is minted for it", async () => {
    const jobId = Number((await one("SELECT id FROM jobs WHERE title = $1", ["Junior Developer"])).id);
    await signIn("hr@example.com");

    const added = await call("POST", "/api/candidates", {
      jobId,
      fullName: "Ishara Wickrama",
      email: "ishara@example.com",
    });
    candidateId = added.data.candidate.id;

    const booked = await call("POST", "/api/interviews", {
      candidateId,
      stage: "Applied",
      scheduledAt: "2027-06-01T10:00",
      interviewerId: await userId("interviewer@example.com"),
      location: "Room 9",
    });
    assert.equal(booked.status, 201);
    interviewId = booked.data.interview.id;

    const row = await one("SELECT * FROM interviews WHERE id = $1", [interviewId]);
    token = inviteToken(row);
    assert.ok(token.length > 100);
  });

  test("the link works with no sign-in at all", async () => {
    // An interviewer reading their email is not signed in. If this
    // needed a session the whole feature would be pointless.
    cookie = "";
    const { status, data } = await call("GET", "/api/invites/" + token);
    assert.equal(status, 200);
    assert.equal(data.invite.candidateName, "Ishara Wickrama");
    assert.equal(data.invite.response, "PENDING");
  });

  test("the link hands over nothing beyond this one booking", async () => {
    cookie = "";
    const { data } = await call("GET", "/api/invites/" + token);
    const keys = Object.keys(data.invite);
    // Enough to decide whether you can take it, and no more. The
    // candidate's contact details and CV stay behind the login.
    for (const leaked of ["candidateEmail", "email", "phone", "cv", "notes_internal"]) {
      assert.ok(!keys.includes(leaked), leaked + " must not be exposed by a token");
    }
  });

  test("a forged or expired token is refused", async () => {
    cookie = "";
    assert.equal((await call("GET", "/api/invites/not-a-real-token")).status, 400);
    assert.equal((await call("GET", "/api/invites/" + token + "x")).status, 400);
  });

  test("a sign-in token cannot be used as an invitation", async () => {
    // Both are signed with the same secret, so they are only kept apart
    // by the purpose claim. If that ever broke, a session token would
    // become a skeleton key - hence this test.
    await signIn("interviewer@example.com");
    const session = cookie.split("=")[1];
    cookie = "";
    assert.equal((await call("GET", "/api/invites/" + session)).status, 400);
  });

  test("accepting through the link records it and tells HR", async () => {
    cookie = "";
    const { status, data } = await call("POST", "/api/invites/" + token + "/respond", {
      response: "ACCEPTED",
      note: "See you there.",
    });
    assert.equal(status, 200);
    assert.equal(data.invite.response, "ACCEPTED");

    // Same fan-out as answering inside the app - where the answer came
    // from makes no difference to who needs to know.
    await signIn("hr@example.com");
    const notes = await call("GET", "/api/notifications");
    assert.ok(
      notes.data.notifications.some(
        (n) => n.kind === "interview.accepted" && /Ishara Wickrama/.test(n.subject)
      ),
      "HR hears back"
    );
  });

  test("the same link cannot be used to answer twice", async () => {
    cookie = "";
    const { status } = await call("POST", "/api/invites/" + token + "/respond", {
      response: "ACCEPTED",
    });
    assert.equal(status, 400);
  });

  test("the link dies if the booking is handed to somebody else", async () => {
    await run("UPDATE interviews SET interviewer_id = $1 WHERE id = $2", [
      await userId("hr@example.com"),
      interviewId,
    ]);
    cookie = "";
    assert.equal((await call("GET", "/api/invites/" + token)).status, 403);
  });

  test("with no mail provider, sending from the outbox is refused rather than faked", async () => {
    // The tests deliberately run with no mail provider (see the top of
    // this file). Nothing may be marked sent when nothing was reached.
    await signIn("hr@example.com");
    const { data } = await call("GET", "/api/notifications/outbox?pending=1");
    const message = data.messages[0];
    const { status, data: body } = await call(
      "POST",
      "/api/notifications/outbox/" + message.id + "/send"
    );
    assert.equal(status, 400);
    assert.match(body.error, /No mail provider is configured/);

    const after = await one("SELECT sent_at FROM notifications WHERE id = $1", [message.id]);
    assert.equal(after.sent_at, null, "it must not look delivered");
  });
});

describe("who logs in, and what each role can do", () => {
  let jobId;
  let mayaId;

  test("only HR opens, edits or deletes a position", async () => {
    jobId = Number((await one("SELECT id FROM jobs WHERE title = $1", ["Junior Developer"])).id);

    for (const [email, password] of [
      ["manager@example.com", "Password123"],
      ["interviewer@example.com", "Password123"],
      ["management@example.com", "Password456"],
    ]) {
      await signIn(email, password);
      assert.equal((await call("POST", "/api/jobs", { title: "Nope" })).status, 403, email);
      assert.equal((await call("PATCH", "/api/jobs/" + jobId, { title: "Nope" })).status, 403, email);
      assert.equal((await call("DELETE", "/api/jobs/" + jobId)).status, 403, email);
    }
  });

  test("only HR adds candidates", async () => {
    await signIn("manager@example.com");
    assert.equal(
      (await call("POST", "/api/candidates", { jobId, fullName: "X Y", email: "xy@example.com" }))
        .status,
      403
    );
  });

  test("the hiring manager can band, advance and record an outcome", async () => {
    mayaId = Number((await one("SELECT id FROM candidates WHERE email = $1", ["maya@example.com"])).id);
    assert.equal(
      (await call("POST", "/api/candidates/" + mayaId + "/band", { band: "LOW" })).status,
      200
    );
    assert.equal(
      (await call("PATCH", "/api/candidates/" + mayaId, { outcome: "HIRED" })).status,
      200
    );
  });

  test("recording HIRED writes the offer letter to the candidate's outbox", async () => {
    // The candidate has no account here, so a decision has to reach them
    // the same way an interview invitation does.
    const { data } = await call("GET", "/api/notifications/outbox?candidate=" + mayaId);
    const offer = data.messages.find((m) => /^Offer - /.test(m.subject));
    assert.ok(offer, "an offer letter is prepared");
    assert.equal(offer.recipientEmail, "maya@example.com");
    assert.equal(offer.sentAt, null, "nothing is pretended to have been sent");
  });

  test("management sees everything and changes nothing", async () => {
    await signIn("management@example.com", "Password456");
    assert.equal((await call("GET", "/api/candidates")).status, 200);
    assert.equal((await call("GET", "/api/jobs")).status, 200);
    assert.equal((await call("GET", "/api/feedback/compare/" + jobId)).status, 200);
    assert.equal((await call("GET", "/api/reports")).status, 200);

    assert.equal(
      (await call("POST", "/api/candidates/" + mayaId + "/band", { band: "HIGH" })).status,
      403
    );
    assert.equal((await call("POST", "/api/candidates/" + mayaId + "/advance")).status, 403);
    assert.equal(
      (await call("PATCH", "/api/candidates/" + mayaId, { outcome: "HIRED" })).status,
      403
    );
    assert.equal(
      (await call("POST", "/api/feedback", { candidateId: mayaId, stage: "Applied", rating: 5 }))
        .status,
      403
    );
  });

  test("nobody can promote themselves", async () => {
    await signIn("interviewer@example.com");
    assert.equal((await call("PATCH", "/api/team/me", { role: "hr" })).status, 403);
  });

  test("HR creates an account and changes a role; others cannot", async () => {
    await signIn("hr@example.com");
    const created = await call("POST", "/api/team/members", {
      name: "New Person",
      email: "new.person@example.com",
      role: "interviewer",
      password: "Password123",
    });
    assert.equal(created.status, 201);

    const promoted = await call("PATCH", "/api/team/members/" + created.data.member.id, {
      role: "hiring_manager",
    });
    assert.equal(promoted.data.member.role, "hiring_manager");

    await signIn("manager@example.com");
    assert.equal(
      (
        await call("POST", "/api/team/members", {
          name: "Nope",
          email: "nope@example.com",
          role: "hr",
          password: "Password123",
        })
      ).status,
      403
    );
  });

  test("the last HR account cannot demote itself", async () => {
    await signIn("hr@example.com");
    const { status, data } = await call("PATCH", "/api/team/members/" + (await userId("hr@example.com")), {
      role: "interviewer",
    });
    assert.equal(status, 400);
    assert.match(data.error, /at least one active HR/);
  });
});

describe("reports management can export", () => {
  test("the report adds up and does not double-count", async () => {
    await signIn("management@example.com", "Password456");
    const { data } = await call("GET", "/api/reports");

    const { count } = await one("SELECT COUNT(*)::int AS count FROM candidates");
    assert.equal(data.summary.totalCandidates, count);

    const jobId = Number((await one("SELECT id FROM jobs WHERE title = $1", ["Junior Developer"])).id);
    const position = data.positions.find((row) => row.id === jobId);
    const actual = await one("SELECT COUNT(*)::int AS count FROM candidates WHERE job_id = $1", [jobId]);
    assert.equal(position.candidates, actual.count, "feedback rows must not inflate the count");
  });

  test("CSV export downloads with the right headers", async () => {
    const response = await fetch(baseUrl + "/api/reports/export.csv?report=positions", {
      headers: { Cookie: cookie },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/csv/);
    assert.match(response.headers.get("content-disposition"), /hiretrack-positions\.csv/);
    assert.match(await response.text(), /Position,Department,Status/);
  });

  test("every export variant works", async () => {
    for (const report of ["candidates", "stages", "interviewers"]) {
      assert.equal((await call("GET", "/api/reports/export.csv?report=" + report)).status, 200, report);
    }
  });

  test("an interviewer cannot see or export reports", async () => {
    await signIn("interviewer@example.com");
    assert.equal((await call("GET", "/api/reports")).status, 403);
    assert.equal((await call("GET", "/api/reports/export.csv")).status, 403);
  });
});

describe("the database enforces its own rules", () => {
  test("a rating outside 1-5 is refused by the CHECK constraint", async () => {
    await assert.rejects(
      () =>
        run(
          "INSERT INTO feedback (candidate_id, author_id, stage, rating) " +
            "VALUES ((SELECT id FROM candidates LIMIT 1), (SELECT id FROM users LIMIT 1), 'X', 99)"
        ),
      /check constraint/i
    );
  });

  test("an invalid role is refused by the ENUM type", async () => {
    await assert.rejects(
      () =>
        run("INSERT INTO users (name, email, role) VALUES ($1, $2, $3)", [
          "Bad Role",
          "bad.role@example.com",
          "supervillain",
        ]),
      /invalid input value for enum/i
    );
  });

  test("deleting a position cascades to its candidates", async () => {
    const job = await one(
      "INSERT INTO jobs (title, created_by) VALUES ($1, (SELECT id FROM users LIMIT 1)) RETURNING id",
      ["Cascade test"]
    );
    await run(
      "INSERT INTO candidates (job_id, full_name, email, current_stage) VALUES ($1, $2, $3, $4)",
      [job.id, "Cascade Person", "cascade@example.com", "Applied"]
    );

    await run("DELETE FROM jobs WHERE id = $1", [job.id]);
    const left = await many("SELECT id FROM candidates WHERE job_id = $1", [job.id]);
    assert.equal(left.length, 0);
  });

  test("updated_at is maintained by the trigger, not by the query", async () => {
    const before = await one("SELECT id, updated_at FROM users WHERE email = $1", ["hr@example.com"]);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await run("UPDATE users SET job_title = $1 WHERE id = $2", ["Changed", before.id]);
    const after = await one("SELECT updated_at FROM users WHERE id = $1", [before.id]);
    assert.ok(
      new Date(after.updated_at) > new Date(before.updated_at),
      "the trigger moved updated_at forward"
    );
  });
});

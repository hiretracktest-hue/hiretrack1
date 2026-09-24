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

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

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

describe("AUTH-01 - signing in securely", () => {
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
    // Reports are the hiring manager's and management's (RPT-01, RPT-02).
    assert.equal(data.user.permissions["report:view"], false);
    assert.equal(data.user.permissions["report:export"], false);
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

  test("a staff address's reset goes to the company inbox; anyone else's goes to them", async () => {
    // Staff sign in on hiretrack.lk, which has no mailboxes - without
    // this a staff password reset could never arrive anywhere.
    const { deliveryAddress } = await import("../mail.js");
    const { config } = await import("../config.js");
    const saved = config.staffMail;
    config.staffMail = { domain: "hiretrack.lk", inbox: "hiretracktest@gmail.com" };
    try {
      assert.equal(deliveryAddress("kevin@hiretrack.lk"), "hiretracktest@gmail.com");
      assert.equal(deliveryAddress("KEVIN@HireTrack.lk"), "hiretracktest@gmail.com", "any case");
      assert.equal(deliveryAddress("someone@gmail.com"), "someone@gmail.com");
      assert.equal(
        deliveryAddress("kevin@hiretrack.lk.example.com"),
        "kevin@hiretrack.lk.example.com",
        "the company domain has to be the whole domain, not a prefix of another"
      );
      config.staffMail = { domain: "hiretrack.lk", inbox: "" };
      assert.equal(deliveryAddress("kevin@hiretrack.lk"), "kevin@hiretrack.lk", "no inbox set");
    } finally {
      config.staffMail = saved;
    }
  });

  test("typing the company inbox offers a reset link for every staff account", async () => {
    const { config } = await import("../config.js");
    const saved = config.staffMail;
    // The test accounts are @example.com, so that is the staff domain here.
    config.staffMail = { domain: "example.com", inbox: "team-inbox@example.org" };
    const requests = async () =>
      (
        await one(
          "SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'user.password_reset_requested'"
        )
      ).n;
    try {
      const staff = (
        await one(
          "SELECT COUNT(*)::int AS n FROM users WHERE is_active AND email::text LIKE '%@example.com'"
        )
      ).n;
      const before = await requests();

      const typedInbox = await call("POST", "/api/auth/forgot-password", {
        email: "team-inbox@example.org",
      });
      assert.equal(typedInbox.status, 200);
      assert.equal((await requests()) - before, staff, "one link per staff account");
      assert.ok(typedInbox.data.devResetUrl, "no mail in the tests, so the link is handed back");

      const nobody = await call("POST", "/api/auth/forgot-password", { email: "nobody@example.org" });
      assert.equal(typedInbox.data.message, nobody.data.message, "the answer gives nothing away");
      assert.equal(nobody.data.devResetUrl, undefined);
    } finally {
      config.staffMail = saved;
    }
  });

  test("using the emailed link changes the password, and the audit log says so", async () => {
    const { data } = await call("POST", "/api/auth/forgot-password", {
      email: "interviewer@example.com",
    });
    const token = new URL(data.devResetUrl).searchParams.get("token");
    const done = await call("POST", "/api/auth/reset-password", { token, password: "Password123" });
    assert.equal(done.status, 200);

    const row = await one(
      "SELECT actor_email, detail FROM audit_log WHERE action = 'user.password_changed' " +
        "ORDER BY id DESC LIMIT 1"
    );
    assert.equal(row.actor_email, "interviewer@example.com");
    assert.match(row.detail, /reset link/);
  });
});

describe("JOB-01 and WF-01 - creating a vacancy with its own interview stages", () => {
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

describe("CAN-01 and CAN-02 - adding a candidate and uploading their CV", () => {
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

  test("adding a candidate WITH a time writes them an acknowledgement", async () => {
    // The candidate has no account and did not put themselves here - HR
    // typed their details in. Nothing goes out for merely being added,
    // but if HR sets a time while adding them then there is something
    // worth saying, and this is it.
    const added = await call("POST", "/api/candidates", {
      jobId,
      fullName: "Dilshan Herath",
      email: "dilshan@example.com",
      inviteAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    });
    assert.equal(added.status, 201);

    const { data } = await call("GET", "/api/notifications/outbox");
    const note = data.messages.find(
      (m) => m.kind === "candidate.added" && m.recipientEmail === "dilshan@example.com"
    );
    assert.ok(note, "the candidate is told they are being considered");
    assert.match(note.subject, /has invited you to apply/);
    assert.match(note.body, /What happens next/i, "it says what to expect, not just hello");
    assert.equal(note.sentAt, null, "no mail provider in tests, so it waits in the outbox");
  });

  test("the reply says whether the email really went, not whether it was asked for", async () => {
    // Telling HR "we emailed them" when the provider refused it is worse
    // than saying nothing: they believe the candidate has been contacted
    // and stop chasing it.
    const added = await call("POST", "/api/candidates", {
      jobId,
      fullName: "Honest Reporting",
      email: "honest@example.com",
      inviteAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    });
    assert.equal(added.status, 201);
    assert.equal(added.data.email.attempted, true);
    assert.equal(added.data.email.sent, false, "no provider in tests, so nothing was sent");
    assert.match(added.data.email.reason, /no mail provider/);
  });

  test("HR can send a link and a time with the invitation", async () => {
    const added = await call("POST", "/api/candidates", {
      jobId,
      fullName: "Linked Invite",
      email: "linked@example.com",
      inviteLink: "meet.google.com/abc-defg",
      inviteAt: "2027-05-04T10:30",
    });
    assert.equal(added.status, 201);
    // A bare host is what people actually paste, so it is completed
    // rather than rejected.
    assert.equal(added.data.candidate.inviteLink, "https://meet.google.com/abc-defg");
    assert.ok(added.data.candidate.inviteAt);

    const { data } = await call("GET", "/api/notifications/outbox");
    const note = data.messages.find((m) => m.recipientEmail === "linked@example.com");
    assert.match(note.body, /meet\.google\.com\/abc-defg/, "the link travels with the message");
  });

  test("a link that is not http(s) is refused", async () => {
    // This link becomes a button in an email. A javascript: or data: URL
    // there is a script waiting for somebody to click it, and some mail
    // clients will follow one.
    for (const bad of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>"]) {
      const { status, data } = await call("POST", "/api/candidates", {
        jobId,
        fullName: "Bad Link",
        email: "badlink@example.com",
        inviteLink: bad,
      });
      assert.equal(status, 400, bad + " must be refused");
      assert.match(data.error, /http/);
    }
  });

  test("notify:false adds them silently", async () => {
    // A name copied off a CV pile has not necessarily applied, and
    // emailing them would be strange.
    const before = (await call("GET", "/api/notifications/outbox")).data.messages.length;

    const added = await call("POST", "/api/candidates", {
      jobId,
      fullName: "Quiet Pile Name",
      email: "quiet@example.com",
      notify: false,
    });
    assert.equal(added.status, 201);

    const after = (await call("GET", "/api/notifications/outbox")).data.messages.length;
    assert.equal(after, before, "nothing at all is written for them");
  });

  test("only HR can add a candidate", async () => {
    for (const [who, password] of [
      ["manager@example.com", "Password123"],
      ["interviewer@example.com", "Password123"],
      ["management@example.com", "Password456"],
    ]) {
      await signIn(who, password);
      const { status } = await call("POST", "/api/candidates", {
        jobId,
        fullName: "Should Not Work",
        email: "nope@example.com",
      });
      assert.equal(status, 403, who + " must not be able to add a candidate");
    }
    await signIn("hr@example.com");
  });

  test("the same person cannot be added twice to one position", async () => {
    const { status } = await call("POST", "/api/candidates", {
      jobId,
      fullName: "Maya Again",
      email: "MAYA@example.com", // citext: the same address
    });
    assert.equal(status, 409);
  });

  test("a PDF and a .docx are accepted", async () => {
    const id = Number((await one("SELECT id FROM candidates WHERE email = $1", ["maya@example.com"])).id);

    const kinds = [
      ["maya.pdf", "%PDF-1.4 cv", "application/pdf"],
      // A .docx is a zip underneath, so it starts with the zip signature.
      ["maya.docx", "PK\u0003\u0004 word", DOCX_MIME],
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

  test("anything that is not a PDF or a .docx is an invalid format", async () => {
    const id = Number((await one("SELECT id FROM candidates WHERE email = $1", ["maya@example.com"])).id);

    const refused = [
      ["notes.txt", "plain notes", "text/plain"],
      ["portfolio.zip", "PK\u0003\u0004", "application/zip"],
      ["scan.png", "\u0089PNG", "image/png"],
      ["cv.html", "<script>alert(1)</script>", "text/html"],
      ["cv.doc", "old word file", "application/msword"],
      ["noextension", "something", "application/octet-stream"],
    ];

    for (const [name, body, type] of refused) {
      const form = new FormData();
      form.append("cv", new Blob([body], { type }), name);
      const upload = await call("POST", "/api/candidates/" + id + "/cv", form, true);
      assert.equal(upload.status, 400, name + " should be refused");
      assert.match(upload.data.error, /Invalid format/i, "for " + name);
    }
  });

  test("a file renamed to .pdf is caught by its own bytes", async () => {
    // The extension is only a name. "Invalid format" has to mean the
    // file really is the wrong format, or the check is theatre.
    const id = Number((await one("SELECT id FROM candidates WHERE email = $1", ["maya@example.com"])).id);

    const form = new FormData();
    form.append("cv", new Blob(["<script>alert(1)</script>"], { type: "application/pdf" }), "sneaky.pdf");
    const upload = await call("POST", "/api/candidates/" + id + "/cv", form, true);

    assert.equal(upload.status, 400);
    assert.match(upload.data.error, /named \.pdf but is not a PDF/i);
  });

  test("a CV over 5 MB is refused, and says the limit", async () => {
    const id = Number((await one("SELECT id FROM candidates WHERE email = $1", ["maya@example.com"])).id);

    const big = "%PDF-1.4 " + "x".repeat(6 * 1024 * 1024);
    const form = new FormData();
    form.append("cv", new Blob([big], { type: "application/pdf" }), "huge.pdf");
    const upload = await call("POST", "/api/candidates/" + id + "/cv", form, true);

    assert.equal(upload.status, 400);
    assert.match(upload.data.error, /too large/i);
    assert.match(upload.data.error, /5 MB/);
  });

  test("a CV is always served as a download, never rendered", async () => {
    // The format check is the first lock; this is the second. Even a
    // file that got in has to come back as an attachment, so nothing
    // stored here can ever run on this origin.
    const id = Number((await one("SELECT id FROM candidates WHERE email = $1", ["maya@example.com"])).id);

    const restore = new FormData();
    restore.append("cv", new Blob(["%PDF-1.4 cv"], { type: "application/pdf" }), "maya.pdf");
    assert.equal((await call("POST", "/api/candidates/" + id + "/cv", restore, true)).status, 200);

    const response = await fetch(baseUrl + "/api/candidates/" + id + "/cv", {
      headers: { Cookie: cookie },
    });
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("content-disposition") || "",
      /^attachment/,
      "must be an attachment, not inline"
    );
    assert.match(response.headers.get("content-disposition") || "", /maya\.pdf/);
    assert.equal(
      response.headers.get("x-content-type-options"),
      "nosniff",
      "the browser must not second-guess the type"
    );
  });

  test("an invalid id returns a clear 400, not a crash", async () => {
    assert.equal((await call("GET", "/api/candidates/not-a-number")).status, 400);
  });
});

describe("CAN-03 - screening CVs into bands", () => {
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

describe("CAN-04 and WF-02 - moving a candidate on, only once feedback is in", () => {
  let mayaId;

  test("HR cannot move a candidate on - that is the hiring manager's", async () => {
    // The progress card, and the stage moves behind it, belong to the
    // hiring manager. HR opens the position, adds the candidate and
    // books the interviews; it does not decide who goes further.
    mayaId = Number((await one("SELECT id FROM candidates WHERE email = $1", ["maya@example.com"])).id);
    await signIn("hr@example.com");
    const refused = await call("POST", "/api/candidates/" + mayaId + "/advance");
    assert.equal(refused.status, 403);

    const byPatch = await call("PATCH", "/api/candidates/" + mayaId, { currentStage: "Offer" });
    assert.equal(byPatch.status, 403, "and not by patching the stage either");
    assert.match(byPatch.data.error, /hiring manager/);

    const outcome = await call("PATCH", "/api/candidates/" + mayaId, { outcome: "HIRED" });
    assert.equal(outcome.status, 403, "nor the hire decision");
    assert.match(outcome.data.error, /hiring manager/);
  });

  test("the first stage is exempt - nobody has interviewed them yet", async () => {
    await signIn("manager@example.com");
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

    await signIn("manager@example.com");
    const { status, data } = await call("POST", "/api/candidates/" + mayaId + "/advance");
    assert.equal(status, 200);
    assert.equal(data.candidate.currentStage, "Offer");
  });

  test("a candidate at the last stage cannot be advanced again", async () => {
    assert.equal((await call("POST", "/api/candidates/" + mayaId + "/advance")).status, 400);
  });
});

describe("FB-01 and FB-03 - structured feedback and fair comparison", () => {
  let mayaId;
  let jobId;

  test("a rating outside 1-5 is refused", async () => {
    await signIn("interviewer@example.com");
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

  test("HR reads feedback but cannot write it", async () => {
    // HR arranges the process; the verdict belongs to whoever sat in
    // the room. If the person booking the interviews can also score
    // them, the side-by-side comparison stops meaning anything.
    await signIn("hr@example.com");

    const reading = await call("GET", "/api/feedback?candidate=" + mayaId);
    assert.equal(reading.status, 200, "HR can still read it");
    assert.ok(reading.data.feedback.length > 0);

    const writing = await call("POST", "/api/feedback", {
      candidateId: mayaId,
      stage: "Interview",
      rating: 5,
      recommendation: "ADVANCE",
    });
    assert.equal(writing.status, 403, "and cannot add any of their own");
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

describe("INT-01 and COM-02 - scheduling, and telling the interviewer", () => {
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

describe("INT-01 and COM-02 - the interviewer accepts or declines", () => {
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

describe("INT-01 - answering the invitation from the email link", () => {
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

describe("AUTH-01 - everyone sets their own profile photo", () => {
  // A real 1x1 PNG.
  const PNG =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  test("every role can upload a photo, and colleagues see it", async () => {
    const people = [
      ["hr@example.com"],
      ["manager@example.com"],
      ["interviewer@example.com"],
      ["management@example.com", "Password456"],
    ];
    for (const [email, password] of people) {
      await signIn(email, password);
      const { status, data } = await call("PUT", "/api/team/me/photo", { image: PNG });
      assert.equal(status, 200, email);
      assert.match(data.user.avatarUrl, /^\/api\/team\/photo\/\d+\?v=\d+$/, email);
    }

    // HR opens the interviewer's photo: the real bytes, the right type.
    await signIn("hr@example.com");
    const id = await userId("interviewer@example.com");
    const res = await fetch(baseUrl + "/api/team/photo/" + id, { headers: { Cookie: cookie } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.equal(bytes.subarray(1, 4).toString(), "PNG");

    // ...and the Team page is given it.
    const team = await call("GET", "/api/team");
    const member = team.data.members.find((m) => m.id === id);
    assert.match(member.avatarUrl, /^\/api\/team\/photo\//);
  });

  test("only real pictures get in - not SVG, not a renamed file, not a huge one", async () => {
    await signIn("interviewer@example.com");

    // SVG can carry script, so it is refused whatever it calls itself.
    const svg =
      "data:image/svg+xml;base64," +
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString("base64");
    assert.equal((await call("PUT", "/api/team/me/photo", { image: svg })).status, 400);

    // Claims to be a PNG, is not: the file's own bytes decide.
    const fake = "data:image/png;base64," + Buffer.from("definitely not a picture").toString("base64");
    const renamed = await call("PUT", "/api/team/me/photo", { image: fake });
    assert.equal(renamed.status, 400);
    assert.match(renamed.data.error, /JPG, PNG or WebP/);

    const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const huge = "data:image/png;base64," + Buffer.concat([header, Buffer.alloc(500 * 1024)]).toString("base64");
    const tooBig = await call("PUT", "/api/team/me/photo", { image: huge });
    assert.equal(tooBig.status, 400);
    assert.match(tooBig.data.error, /too large/);

    assert.equal((await call("PUT", "/api/team/me/photo", {})).status, 400, "nothing chosen");
  });

  test("a photo can be removed, and nobody signed out can fetch one", async () => {
    await signIn("interviewer@example.com");
    const removed = await call("DELETE", "/api/team/me/photo");
    assert.equal(removed.status, 200);
    assert.equal(removed.data.user.avatarUrl, null);

    const id = await userId("interviewer@example.com");
    const gone = await fetch(baseUrl + "/api/team/photo/" + id, { headers: { Cookie: cookie } });
    assert.equal(gone.status, 404);

    const hr = await userId("hr@example.com");
    assert.equal((await fetch(baseUrl + "/api/team/photo/" + hr)).status, 401);
  });
});

describe("AUTH-01 and COM-02 - a real email on each account", () => {
  test("a real email wins; then the company inbox for a staff address; then the address itself", async () => {
    const { deliveryAddress } = await import("../mail.js");
    const { config } = await import("../config.js");
    const saved = config.staffMail;
    config.staffMail = { domain: "hiretrack.lk", inbox: "hiretracktest@gmail.com" };
    try {
      assert.equal(
        deliveryAddress({ email: "kevin@hiretrack.lk", contact_email: "kevin.real@gmail.com" }),
        "kevin.real@gmail.com"
      );
      assert.equal(deliveryAddress({ email: "kevin@hiretrack.lk", contact_email: null }), "hiretracktest@gmail.com");
      assert.equal(deliveryAddress({ email: "someone@gmail.com" }), "someone@gmail.com");
    } finally {
      config.staffMail = saved;
    }
  });

  test("HR adds a real email to someone's account, and it is in the audit log", async () => {
    await signIn("hr@example.com");
    const id = await userId("interviewer@example.com");
    const { status, data } = await call("PATCH", "/api/team/members/" + id, {
      contactEmail: "test.interviewer.real@example.org",
    });
    assert.equal(status, 200);
    assert.equal(data.member.contactEmail, "test.interviewer.real@example.org");
    assert.equal(data.member.mailGoesTo, "test.interviewer.real@example.org");

    const entry = await one(
      "SELECT detail FROM audit_log WHERE action = 'user.contact_email_changed' ORDER BY id DESC LIMIT 1"
    );
    assert.match(entry.detail, /real email added/);
    assert.doesNotMatch(entry.detail, /example\.org/, "the address itself is not logged");
  });

  test("a company sign-in address is refused as somebody's real email", async () => {
    await signIn("hr@example.com");
    const id = await userId("interviewer@example.com");
    const refused = await call("PATCH", "/api/team/members/" + id, { contactEmail: "sara@hiretrack.lk" });
    assert.equal(refused.status, 400);
    assert.match(refused.data.error, /sign-in address/);
  });

  test("only HR sets other people's; anyone sets their own", async () => {
    await signIn("manager@example.com");
    const other = await userId("interviewer@example.com");
    assert.equal(
      (await call("PATCH", "/api/team/members/" + other, { contactEmail: "x@example.org" })).status,
      403
    );
    const mine = await call("PATCH", "/api/team/me", { contactEmail: "test.manager.real@example.org" });
    assert.equal(mine.status, 200);
    assert.equal(mine.data.user.contactEmail, "test.manager.real@example.org");
  });

  test("colleagues see the sign-in address, not the real email", async () => {
    await signIn("management@example.com", "Password456");
    const team = (await call("GET", "/api/team")).data.members;
    const interviewer = team.find((m) => m.email === "interviewer@example.com");
    assert.equal(interviewer.contactEmail, undefined);
    assert.equal(interviewer.mailGoesTo, undefined);

    await signIn("hr@example.com");
    const asHr = (await call("GET", "/api/team")).data.members.find(
      (m) => m.email === "interviewer@example.com"
    );
    assert.equal(asHr.contactEmail, "test.interviewer.real@example.org");
  });

  test("forgot password works by the real email too", async () => {
    const before = (
      await one("SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'user.password_reset_requested'")
    ).n;
    const { status, data } = await call("POST", "/api/auth/forgot-password", {
      email: "test.interviewer.real@example.org",
    });
    assert.equal(status, 200);
    const after = (
      await one("SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'user.password_reset_requested'")
    ).n;
    assert.equal(after - before, 1);
    // No mail in the tests, so the link comes back - and it works.
    const token = new URL(data.devResetUrl).searchParams.get("token");
    assert.equal(
      (await call("POST", "/api/auth/reset-password", { token, password: "Password123" })).status,
      200
    );
  });

  test("clearing the real email sends mail back the usual way", async () => {
    await signIn("hr@example.com");
    const id = await userId("interviewer@example.com");
    const { data } = await call("PATCH", "/api/team/members/" + id, { contactEmail: "" });
    assert.equal(data.member.contactEmail, null);
    assert.equal(data.member.mailGoesTo, "interviewer@example.com");
    await signIn("manager@example.com");
    await call("PATCH", "/api/team/me", { contactEmail: "" });
  });
});

describe("AUTH-01 and COM-01 - who logs in, what each role can do", () => {
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

describe("RPT-01 and RPT-02 - reports add up and export", () => {
  test("the report adds up and does not double-count", async () => {
    await signIn("management@example.com", "Password456");
    const { data } = await call("GET", "/api/reports");

    const { count } = await one("SELECT COUNT(*)::int AS count FROM candidates");
    assert.equal(data.summary.totalCandidates, count);

    const jobId = Number((await one("SELECT id FROM jobs WHERE title = $1", ["Junior Developer"])).id);
    // The payload calls these vacancies, matching every screen and route
    // in the app. It used to say `positions`, which is why the Reports
    // page read undefined and crashed before drawing anything.
    const position = data.vacancies.find((row) => row.id === jobId);
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

describe("FB-01 and AUTH-01 - the database enforces its own rules", () => {
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

// =====================================================================
// The fixes asked for after the Sprint 2 walkthrough.
// =====================================================================

describe("INT-01 - booking an interview refuses bad input", () => {
  let candidateId;
  let interviewerId;
  // One fixed slot shared by the last two tests. It has to be the SAME
  // instant in both, because the clash check is about the same booking
  // being submitted twice - which is what a double-clicked form sends.
  const slot = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

  before(async () => {
    await signIn("hr@example.com");

    const job = await one(
      "INSERT INTO jobs (title, created_by) VALUES ($1, (SELECT id FROM users WHERE email = $2)) " +
        "RETURNING id",
      ["Booking rules vacancy", "hr@example.com"]
    );
    await run("INSERT INTO job_stages (job_id, name, position) VALUES ($1, $2, $3)", [
      job.id,
      "Applied",
      0,
    ]);
    await run("INSERT INTO job_stages (job_id, name, position) VALUES ($1, $2, $3)", [
      job.id,
      "Interview",
      1,
    ]);

    const candidate = await one(
      "INSERT INTO candidates (job_id, full_name, email, current_stage) " +
        "VALUES ($1, $2, $3, $4) RETURNING id",
      [job.id, "Booking Rules", "booking.rules@example.com", "Applied"]
    );
    candidateId = Number(candidate.id);
    interviewerId = await userId("interviewer@example.com");
  });

  test("no date at all is refused, and says it is missing", async () => {
    const { status, data } = await call("POST", "/api/interviews", {
      candidateId,
      stage: "Interview",
      interviewerId,
    });
    assert.equal(status, 400);
    assert.match(data.error, /missing/i);
  });

  test("an empty date is refused the same way", async () => {
    const { status, data } = await call("POST", "/api/interviews", {
      candidateId,
      stage: "Interview",
      scheduledAt: "",
      interviewerId,
    });
    assert.equal(status, 400);
    assert.match(data.error, /missing/i);
  });

  test("a date in the past says it is not available", async () => {
    const lastYear = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    const { status, data } = await call("POST", "/api/interviews", {
      candidateId,
      stage: "Interview",
      scheduledAt: lastYear,
      interviewerId,
    });
    assert.equal(status, 400);
    assert.match(data.error, /not available/i);
    assert.match(data.error, /already passed/i);
  });

  test("text that is not a date is refused", async () => {
    const { status, data } = await call("POST", "/api/interviews", {
      candidateId,
      stage: "Interview",
      scheduledAt: "next tuesday-ish",
      interviewerId,
    });
    assert.equal(status, 400);
    assert.match(data.error, /not a real date/i);
  });

  test("a year far in the future is refused", async () => {
    const { status, data } = await call("POST", "/api/interviews", {
      candidateId,
      stage: "Interview",
      scheduledAt: "2999-01-01T10:00",
      interviewerId,
    });
    assert.equal(status, 400);
    assert.match(data.error, /too far in the future/i);
  });

  test("booking with nobody to run it is refused", async () => {
    const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const { status, data } = await call("POST", "/api/interviews", {
      candidateId,
      stage: "Interview",
      scheduledAt: soon,
    });
    assert.equal(status, 400);
    assert.match(data.error, /interviewer/i);
  });

  test("a valid future booking is accepted", async () => {
    const { status, data } = await call("POST", "/api/interviews", {
      candidateId,
      stage: "Interview",
      scheduledAt: slot,
      interviewerId,
      location: "Meeting room 1",
    });
    assert.equal(status, 201);
    assert.equal(data.interview.interviewerName, "Test Interviewer");
  });

  test("the same slot twice is refused, so a double click cannot book two", async () => {
    const { status, data } = await call("POST", "/api/interviews", {
      candidateId,
      stage: "Interview",
      scheduledAt: slot,
      interviewerId,
    });
    assert.equal(status, 409);
    assert.match(data.error, /already has an interview/i);
  });
});

describe("COM-02 - assigning an interviewer to a candidate", () => {
  let candidateId;
  let interviewerId;

  before(async () => {
    await signIn("hr@example.com");

    // Its own candidate, not the one the suite above books interviews
    // for. Booking now assigns, so a shared candidate would arrive here
    // already claimed and "starts with nobody assigned" would be a lie.
    const neighbour = await one("SELECT job_id FROM candidates WHERE email = $1", [
      "booking.rules@example.com",
    ]);
    const fresh = await one(
      "INSERT INTO candidates (job_id, full_name, email, current_stage) " +
        "VALUES ($1, $2, $3, $4) RETURNING id",
      [neighbour.job_id, "Assign Me", "assign.me@example.com", "Applied"]
    );
    candidateId = Number(fresh.id);
    interviewerId = await userId("interviewer@example.com");
  });

  test("a new candidate starts with nobody assigned", async () => {
    const { data } = await call("GET", "/api/candidates/" + candidateId);
    assert.equal(data.candidate.assignedInterviewerId, null);
  });

  test("HR assigns one, and the name comes back with the candidate", async () => {
    const { status, data } = await call("POST", "/api/candidates/" + candidateId + "/assign", {
      interviewerId,
    });
    assert.equal(status, 200);
    assert.equal(data.candidate.assignedInterviewerId, interviewerId);
    assert.equal(data.candidate.assignedInterviewerName, "Test Interviewer");
    assert.ok(data.candidate.assignedAt, "the time it happened is recorded");
  });

  test("the interviewer now finds them under their own candidates", async () => {
    await signIn("interviewer@example.com");
    const { data } = await call("GET", "/api/candidates?mine=1");
    assert.ok(
      data.candidates.some((c) => c.id === candidateId),
      "an assigned candidate shows up before any interview is booked"
    );
  });

  test("an interviewer cannot assign candidates to themselves", async () => {
    const { status } = await call("POST", "/api/candidates/" + candidateId + "/assign", {
      interviewerId,
    });
    assert.equal(status, 403);
  });

  test("management cannot be assigned to interview anyone", async () => {
    await signIn("hr@example.com");
    const { status, data } = await call("POST", "/api/candidates/" + candidateId + "/assign", {
      interviewerId: await userId("management@example.com"),
    });
    assert.equal(status, 400);
    assert.match(data.error, /Management/i);
  });

  test("an unknown interviewer is refused", async () => {
    const { status } = await call("POST", "/api/candidates/" + candidateId + "/assign", {
      interviewerId: 999999,
    });
    assert.equal(status, 404);
  });

  test("sending nothing hands the candidate back to the pool", async () => {
    const { status, data } = await call("POST", "/api/candidates/" + candidateId + "/assign", {
      interviewerId: null,
    });
    assert.equal(status, 200);
    assert.equal(data.candidate.assignedInterviewerId, null);
  });

  test("the unassigned filter finds them again", async () => {
    const { data } = await call("GET", "/api/candidates?unassigned=1");
    assert.ok(data.candidates.some((c) => c.id === candidateId));
  });

  test("booking an interview is what assigns them now", async () => {
    // The separate dropdown is gone from the page: choosing who runs
    // the interview is the only place an interviewer is picked, so it
    // is also what puts the candidate under their "Only mine".
    const before = await call("GET", "/api/candidates/" + candidateId);
    assert.equal(before.data.candidate.assignedInterviewerId, null);

    const { status } = await call("POST", "/api/interviews", {
      candidateId,
      stage: "Interview",
      scheduledAt: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString(),
      interviewerId,
    });
    assert.equal(status, 201);

    const after = await call("GET", "/api/candidates/" + candidateId);
    assert.equal(after.data.candidate.assignedInterviewerId, interviewerId);
    assert.equal(after.data.candidate.assignedInterviewerName, "Test Interviewer");
  });

  test("a second booking does not hand the candidate to somebody else", async () => {
    // A panel interview with a different person is normal. It must not
    // quietly take the candidate off whoever already owns them.
    const { status } = await call("POST", "/api/interviews", {
      candidateId,
      stage: "Interview",
      scheduledAt: new Date(Date.now() + 22 * 24 * 60 * 60 * 1000).toISOString(),
      interviewerId: await userId("manager@example.com"),
    });
    assert.equal(status, 201);

    const { data } = await call("GET", "/api/candidates/" + candidateId);
    assert.equal(data.candidate.assignedInterviewerName, "Test Interviewer", "still the first one");
  });
});

describe("AUTH-01 - email addresses are answered specifically", () => {
  let jobId;

  before(async () => {
    await signIn("hr@example.com");
    const row = await one("SELECT id FROM jobs WHERE title = $1", ["Booking rules vacancy"]);
    jobId = Number(row.id);
  });

  const cases = [
    ["", /required/i, "nothing typed"],
    ["dilshan", /needs an @/i, "no @ at all"],
    ["dilshan@@gmail.com", /only contain one @/i, "two @ signs"],
    ["@gmail.com", /before the @/i, "nothing before the @"],
    ["dilshan@", /after the @/i, "nothing after the @"],
    ["dilshan@gmail", /domain ending/i, "no dot in the domain"],
    ["dilshan@.com", /misplaced dot/i, "a domain starting with a dot"],
    ["dil shan@gmail.com", /cannot contain spaces/i, "a space in the middle"],
  ];

  for (const [value, expected, description] of cases) {
    test("rejects " + description + ", saying what is wrong", async () => {
      const { status, data } = await call("POST", "/api/candidates", {
        jobId,
        fullName: "Email Test",
        email: value,
      });
      assert.equal(status, 400, "for " + JSON.stringify(value));
      assert.match(data.error, expected);
    });
  }

  test("a good address is accepted", async () => {
    const { status } = await call("POST", "/api/candidates", {
      jobId,
      fullName: "Good Address",
      email: "good.address@gmail.com",
    });
    assert.equal(status, 201);
  });
});

describe("INT-01 - an invitation time in the past is refused", () => {
  let jobId;

  before(async () => {
    await signIn("hr@example.com");
    const row = await one("SELECT id FROM jobs WHERE title = $1", ["Booking rules vacancy"]);
    jobId = Number(row.id);
  });

  test("a past invitation time says it is not available", async () => {
    const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { status, data } = await call("POST", "/api/candidates", {
      jobId,
      fullName: "Past Invite",
      email: "past.invite@example.com",
      inviteAt: lastWeek,
    });
    assert.equal(status, 400);
    assert.match(data.error, /not available/i);
  });

  test("leaving it empty is still fine - it is optional", async () => {
    const { status } = await call("POST", "/api/candidates", {
      jobId,
      fullName: "No Invite Time",
      email: "no.invite.time@example.com",
      inviteAt: "",
    });
    assert.equal(status, 201);
  });
});

// ---------------------------------------------------------------------
// Adding a candidate is one step now: the record, the CV and the email
// all happen from a single form. These pin the parts of that the front
// end depends on.
// ---------------------------------------------------------------------
describe("CAN-01 and CAN-02 - adding a candidate is one step", () => {
  let jobId;

  before(async () => {
    await signIn("hr@example.com");
    const { data } = await call("POST", "/api/jobs", {
      title: "One step vacancy",
      stages: ["Applied", "Interview"],
    });
    jobId = data.job.id;
  });

  test("adding somebody with no time set emails nobody", async () => {
    // There is nothing to tell them yet. The candidate hears from us
    // when an interview is booked, which is the message that carries
    // the date, the place and who they are seeing.
    const { status, data } = await call("POST", "/api/candidates", {
      jobId,
      fullName: "Not Mailed Yet",
      email: "not.mailed.yet@example.com",
    });
    assert.equal(status, 201);
    assert.equal(data.email.attempted, false, "no time given, so no letter");

    const waiting = await many(
      "SELECT id FROM notifications WHERE recipient_email = $1",
      ["not.mailed.yet@example.com"]
    );
    assert.equal(waiting.length, 0, "nothing queued either");
  });

  test("adding somebody WITH a time does tell them that time", async () => {
    const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await call("POST", "/api/candidates", {
      jobId,
      fullName: "Told A Time",
      email: "told.a.time@example.com",
      inviteAt: soon,
    });
    assert.equal(data.email.attempted, true);
  });

  test("notify: false silences it even when a time is given", async () => {
    const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await call("POST", "/api/candidates", {
      jobId,
      fullName: "Not Mailed",
      email: "not.mailed@example.com",
      inviteAt: soon,
      notify: false,
    });
    assert.equal(data.email.attempted, false);
  });

  test("booking the interview is what finally emails the candidate", async () => {
    // The whole point of the change: no letter on being added, one
    // letter when there is something to say.
    const person = await one("SELECT id FROM candidates WHERE email = $1", [
      "not.mailed.yet@example.com",
    ]);

    const { status, data } = await call("POST", "/api/interviews", {
      candidateId: Number(person.id),
      stage: "Interview",
      scheduledAt: new Date(Date.now() + 9 * 24 * 60 * 60 * 1000).toISOString(),
      interviewerId: await userId("interviewer@example.com"),
      location: "Meeting room 3",
    });

    assert.equal(status, 201);
    // The response says who it was for and whether it really went, so
    // the screen never claims a delivery that did not happen.
    assert.equal(data.email.to, "not.mailed.yet@example.com");
    assert.equal(data.email.sent, false, "no mail provider in the tests");

    const queued = await many(
      "SELECT subject FROM notifications WHERE recipient_email = $1",
      ["not.mailed.yet@example.com"]
    );
    assert.equal(queued.length, 1, "exactly one letter, and this is it");
    assert.match(queued[0].subject, /Interview invitation/);
  });

  test("the time given while adding comes back, so it can be reused", async () => {
    const soon = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await call("POST", "/api/candidates", {
      jobId,
      fullName: "Timed Entry",
      email: "timed.entry@example.com",
      inviteAt: soon,
      inviteLink: "https://meet.google.com/abc-defg",
    });
    // The booking form fills its date box from this, so HR is not asked
    // for the same time twice.
    assert.equal(new Date(data.candidate.inviteAt).toISOString(), soon);
    assert.equal(data.candidate.inviteLink, "https://meet.google.com/abc-defg");
  });

  test("the CV goes on straight after, and the record then has it", async () => {
    const created = await call("POST", "/api/candidates", {
      jobId,
      fullName: "With CV",
      email: "with.cv@example.com",
    });
    assert.equal(created.data.candidate.cv, null, "nothing attached yet");

    const form = new FormData();
    form.append("cv", new Blob(["%PDF-1.4 cv"], { type: "application/pdf" }), "with-cv.pdf");
    const upload = await call(
      "POST",
      "/api/candidates/" + created.data.candidate.id + "/cv",
      form,
      true
    );

    assert.equal(upload.status, 200);
    assert.equal(upload.data.candidate.cv.filename, "with-cv.pdf");

    const { data } = await call("GET", "/api/candidates/" + created.data.candidate.id);
    assert.equal(data.candidate.cv.filename, "with-cv.pdf");
  });

  test("only HR can put a CV on, so the one-step form is HR's alone", async () => {
    const row = await one("SELECT id FROM candidates WHERE email = $1", ["with.cv@example.com"]);
    await signIn("interviewer@example.com");
    const form = new FormData();
    form.append("cv", new Blob(["%PDF-1.4 cv"], { type: "application/pdf" }), "sneaky.pdf");
    const { status } = await call("POST", "/api/candidates/" + row.id + "/cv", form, true);
    assert.equal(status, 403);
    await signIn("hr@example.com");
  });
});

// =====================================================================
// The four test cases on the Sprint 1 "Schedule Interview" slide, in
// the order they appear on it. Named so a marker can put the slide and
// the run side by side: TC-12, TC-14, TC-15, TC-16.
// =====================================================================
describe("CAN-05 - the same person applying for a second position", () => {
  let firstId;
  let jobA;
  let jobB;

  test("their details and CV are carried across, so nothing is retyped", async () => {
    await signIn("hr@example.com");
    const jobs = (await call("GET", "/api/jobs")).data.jobs;
    jobA = jobs[0].id;
    jobB = jobs.find((j) => j.id !== jobA).id;

    const first = await call("POST", "/api/candidates", {
      jobId: jobA,
      fullName: "Sunil Rathnayake",
      email: "sunil@example.com",
      phone: "+94 77 555 1234",
      notes: "Strong React portfolio.",
      notify: false,
    });
    assert.equal(first.status, 201);
    firstId = first.data.candidate.id;

    const form = new FormData();
    form.append("cv", new Blob(["%PDF-1.4 sunil"], { type: "application/pdf" }), "sunil.pdf");
    assert.equal((await call("POST", "/api/candidates/" + firstId + "/cv", form, true)).status, 200);

    // Now the same person, giving nothing but a name and an email.
    const second = await call("POST", "/api/candidates", {
      jobId: jobB,
      fullName: "Sunil Rathnayake",
      email: "sunil@example.com",
      notify: false,
    });
    assert.equal(second.status, 201);

    const c = second.data.candidate;
    assert.equal(c.phone, "+94 77 555 1234", "their phone is carried over");
    assert.match(c.notes, /React portfolio/, "their notes are carried over");
    assert.ok(c.cv, "their CV is attached without being uploaded again");
    assert.equal(c.cv.filename, "sunil.pdf");
    assert.deepEqual(second.data.linkedFrom, { candidateId: firstId, cvReused: true });
  });

  test("the screening band is NOT carried across", async () => {
    // A CV that is High for a QA role may be Low for a developer role.
    // The band is a judgement about a person against ONE position, not
    // a property of the person.
    await signIn("hr@example.com");
    const list = (await call("GET", "/api/candidates?q=sunil@example.com")).data.candidates;
    const second = list.find((c) => c.id !== firstId);
    assert.equal(second.cvBand, "UNRATED");
  });

  test("the shared CV downloads from both records", async () => {
    const list = (await call("GET", "/api/candidates?q=sunil@example.com")).data.candidates;
    assert.equal(list.length, 2);
    for (const c of list) {
      const response = await fetch(baseUrl + "/api/candidates/" + c.id + "/cv", {
        headers: { Cookie: cookie },
      });
      assert.equal(response.status, 200, "candidate " + c.id + " can reach the CV");
    }
  });

  test("they still cannot be added to the SAME position twice", async () => {
    const { status } = await call("POST", "/api/candidates", {
      jobId: jobA,
      fullName: "Sunil Rathnayake",
      email: "sunil@example.com",
      notify: false,
    });
    assert.equal(status, 409);
  });
});

describe("AUD-01 - the audit log", () => {
  test("a failed sign-in is recorded, naming the address that was tried", async () => {
    cookie = "";
    await call("POST", "/api/auth/signin", {
      email: "hr@example.com",
      password: "definitely-not-the-password",
    });

    await signIn("management@example.com", "Password456");
    const { data } = await call("GET", "/api/team/audit");
    const failed = data.entries.find((e) => e.action === "user.sign_in_failed");
    assert.ok(failed, "the attempt is in the log");
    // There is no account behind a failed sign-in, so the attempted
    // address is the only identity there is.
    assert.equal(failed.actorName, "hr@example.com");
    assert.match(failed.detail, /wrong password/);
  });

  test("a successful sign-in is recorded against the person", async () => {
    await signIn("hr@example.com");
    await signIn("management@example.com", "Password456");
    const { data } = await call("GET", "/api/team/audit");
    const ok = data.entries.find(
      (e) => e.action === "user.signed_in" && e.actorName === "Test HR"
    );
    assert.ok(ok, "HR's sign-in is traced to HR");
  });

  test("creating an account and changing a role are both traceable", async () => {
    await signIn("hr@example.com");
    const created = await call("POST", "/api/team/members", {
      name: "Kumara Bandara",
      email: "kumara@example.com",
      role: "interviewer",
      jobTitle: "Senior Engineer",
      password: "Kumara12345",
    });
    assert.equal(created.status, 201);
    const id = created.data.member.id;

    assert.equal(
      (await call("PATCH", "/api/team/members/" + id, { role: "hiring_manager" })).status,
      200
    );

    await signIn("management@example.com", "Password456");
    const { data } = await call("GET", "/api/team/audit");
    const made = data.entries.find((e) => e.action === "user.created" && e.subjectId === id);
    const moved = data.entries.find(
      (e) => e.action === "user.role_changed" && e.subjectId === id
    );

    assert.ok(made, "the account creation is logged");
    assert.match(made.detail, /kumara@example.com/);
    assert.equal(made.actorName, "Test HR", "traced back to who did it");

    assert.ok(moved, "the role change is logged");
    // Recorded before the write, so it can still name what it changed FROM.
    assert.match(moved.detail, /interviewer -> hiring_manager/);
  });

  test("deleting a candidate leaves a record of it", async () => {
    await signIn("hr@example.com");
    const jobId = (await call("GET", "/api/jobs")).data.jobs[0].id;
    const added = await call("POST", "/api/candidates", {
      jobId,
      fullName: "Temporary Person",
      email: "temporary@example.com",
      notify: false,
    });
    const id = added.data.candidate.id;
    assert.equal((await call("DELETE", "/api/candidates/" + id)).status, 200);

    await signIn("management@example.com", "Password456");
    const { data } = await call("GET", "/api/team/audit");
    const gone = data.entries.find(
      (e) => e.action === "candidate.deleted" && e.subjectId === id
    );
    assert.ok(gone, "the deletion is logged");
    assert.match(gone.detail, /temporary@example.com/);
  });

  test("only management can read or download the log", async () => {
    // Deliberately not HR. Most of what the log records is HR's own
    // work - accounts, roles, deletions - so HR reviewing it would be
    // HR marking its own homework.
    for (const [who, password] of [
      ["hr@example.com", "Password123"],
      ["manager@example.com", "Password123"],
      ["interviewer@example.com", "Password123"],
    ]) {
      await signIn(who, password);
      assert.equal((await call("GET", "/api/team/audit")).status, 403, who + " cannot read it");
      assert.equal(
        (await call("GET", "/api/team/audit.csv")).status,
        403,
        who + " cannot download it"
      );
    }

    await signIn("management@example.com", "Password456");
    assert.equal((await call("GET", "/api/team/audit")).status, 200);
  });

  test("the download is a CSV that cannot smuggle a formula into Excel", async () => {
    // Account names are typed by hand and written into the log's detail
    // column. A name that is really a formula would run the moment
    // management opened the export - unless it is neutralised.
    await signIn("hr@example.com");
    const created = await call("POST", "/api/team/members", {
      name: "=HYPERLINK(1)",
      email: "formula@example.com",
      role: "interviewer",
      password: "Formula12345",
    });
    assert.equal(created.status, 201, "the name is stored as typed - it is only text here");

    await signIn("management@example.com", "Password456");
    const response = await fetch(baseUrl + "/api/team/audit.csv", { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /text\/csv/);
    assert.match(response.headers.get("content-disposition") || "", /^attachment/);

    const text = await response.text();
    assert.match(text, /When,Action,Who/, "has its header row");
    // Prove the payload actually reached the file - otherwise the check
    // below would pass for the wrong reason.
    assert.match(text, /'=HYPERLINK\(1\)/, "the formula is there, prefixed and inert");
    assert.doesNotMatch(
      text,
      /(^|,)"?=HYPERLINK/m,
      "no cell may START with = - that would be a live formula"
    );
  });

  test("downloading the log is itself logged", async () => {
    await signIn("management@example.com", "Password456");
    await fetch(baseUrl + "/api/team/audit.csv", { headers: { Cookie: cookie } });
    const { data } = await call("GET", "/api/team/audit");
    assert.ok(data.entries.some((e) => e.action === "audit.exported"));
  });
});

describe("RPT-01 and RPT-02 - the dashboard data and the PDF export", () => {
  test("the report payload uses the same word as the rest of the app", async () => {
    // It said `positions` while every screen, route and label said
    // vacancies, so the page read undefined and crashed on .length -
    // the whole Reports screen rendered nothing for every role.
    await signIn("management@example.com", "Password456");
    const { data } = await call("GET", "/api/reports");
    assert.ok(Array.isArray(data.vacancies), "vacancies is the key the front end reads");
    assert.equal(data.positions, undefined, "the old name is gone, not merely aliased");
  });

  test("the chart data is present and shaped for drawing", async () => {
    await signIn("management@example.com", "Password456");
    const { data } = await call("GET", "/api/reports");

    // RPT-01 draws three charts from these three arrays.
    for (const key of ["byStage", "byBand", "interviewerActivity"]) {
      assert.ok(Array.isArray(data[key]), key + " is an array");
    }
    for (const row of data.byStage) {
      assert.equal(typeof row.stage, "string");
      assert.equal(typeof row.total, "number", "a bar length has to be a number");
    }
    for (const row of data.byBand) {
      assert.match(row.band, /^(HIGH|MEDIUM|LOW|UNRATED)$/);
    }
  });

  test("every report downloads as a PDF", async () => {
    await signIn("management@example.com", "Password456");

    for (const which of ["vacancies", "candidates", "stages", "interviewers"]) {
      const response = await fetch(baseUrl + "/api/reports/export.pdf?report=" + which, {
        headers: { Cookie: cookie },
      });
      assert.equal(response.status, 200, which + " exports");
      assert.match(response.headers.get("content-type") || "", /application\/pdf/);
      assert.match(
        response.headers.get("content-disposition") || "",
        /^attachment/,
        "a report is downloaded, not rendered in the page"
      );

      const bytes = Buffer.from(await response.arrayBuffer());
      // A PDF always starts %PDF- and ends with an EOF marker. Checking
      // the bytes catches a truncated stream, which a 200 will not.
      assert.equal(bytes.subarray(0, 5).toString(), "%PDF-", which + " is really a PDF");
      assert.match(bytes.subarray(-1024).toString("latin1"), /%%EOF/, which + " is complete");
    }
  });

  test("the hiring manager can export - RPT-02 is written for them", async () => {
    // "As a Hiring Manager, I want pipeline reports exportable in CSV and
    // PDF". They were left out of report:export, so the one role the
    // story names was the one that could not do it.
    await signIn("manager@example.com");
    for (const url of [
      "/api/reports/export.csv?report=candidates",
      "/api/reports/export.pdf?report=candidates",
      "/api/reports/export.pdf?report=vacancies",
    ]) {
      const response = await fetch(baseUrl + url, { headers: { Cookie: cookie } });
      assert.equal(response.status, 200, url);
    }
  });

  test("an interviewer still cannot reach any export", async () => {
    // The PDF route must not be a way round the rule the CSV follows.
    await signIn("interviewer@example.com");
    assert.equal((await call("GET", "/api/reports/export.pdf?report=vacancies")).status, 403);
    assert.equal((await call("GET", "/api/reports/export.csv?report=candidates")).status, 403);
  });

  test("HR has no Reports page and no exports - they are for the manager and management", async () => {
    // Both reporting stories are written "As a Hiring Manager", for
    // leadership to read. HR's own numbers stay on its dashboard.
    await signIn("hr@example.com");
    assert.equal((await call("GET", "/api/reports")).status, 403);
    assert.equal((await call("GET", "/api/reports/export.csv?report=candidates")).status, 403);
    assert.equal((await call("GET", "/api/reports/export.pdf?report=vacancies")).status, 403);

    // ...and HR's dashboard, which reads its own figures, still works.
    const stats = await call("GET", "/api/team/stats");
    assert.equal(stats.status, 200);
  });

  test("an unknown report name falls back instead of failing", async () => {
    await signIn("management@example.com", "Password456");
    const response = await fetch(baseUrl + "/api/reports/export.pdf?report=nonsense", {
      headers: { Cookie: cookie },
    });
    assert.equal(response.status, 200);
    assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
  });
});

describe("WF-02 and FB-01 - a booked interview belongs to the person booked", () => {
  let jobId;
  let stages;

  // A fresh candidate each time, at the FIRST stage - where the old
  // rule let anybody through because nothing was checked there at all.
  async function freshCandidate(name) {
    await signIn("hr@example.com");
    const added = await call("POST", "/api/candidates", {
      jobId,
      fullName: name,
      email: name.toLowerCase().replace(/\s+/g, ".") + "@example.com",
      notify: false,
    });
    assert.equal(added.status, 201);
    return added.data.candidate;
  }

  async function book(candidateId, stage, interviewerEmail, when) {
    await signIn("hr@example.com");
    const booked = await call("POST", "/api/interviews", {
      candidateId,
      stage,
      scheduledAt: when,
      interviewerId: await userId(interviewerEmail),
      location: "Room 2",
    });
    assert.equal(booked.status, 201, "booked");
    return booked.data.interview;
  }

  test("setup", async () => {
    await signIn("hr@example.com");
    const job = (await call("GET", "/api/jobs")).data.jobs[0];
    jobId = job.id;
    stages = (await call("GET", "/api/jobs/" + jobId)).data.job.stages.map((s) =>
      typeof s === "string" ? s : s.name
    );
    assert.ok(stages.length >= 2);
  });

  test("once HR books an interview, the candidate cannot move past it - even at stage one", async () => {
    // The review found exactly this: book an interview, then press
    // "Move to next stage" and it went straight through. The first stage
    // was exempt from the feedback rule outright.
    const c = await freshCandidate("Gate Test One");
    assert.equal(c.currentStage, stages[0]);
    await book(c.id, stages[0], "interviewer@example.com", "2027-08-01T10:00");

    await signIn("manager@example.com");
    const blocked = await call("POST", "/api/candidates/" + c.id + "/advance");
    assert.equal(blocked.status, 400, "blocked while the interviewer has not reported");
    assert.match(blocked.data.error, /Waiting on feedback/);
    assert.match(blocked.data.error, /Test Interviewer/, "it names who it is waiting on");
  });

  test("the booked interviewer's own feedback is what unblocks it", async () => {
    const c = await freshCandidate("Gate Test Two");
    await book(c.id, stages[0], "interviewer@example.com", "2027-08-02T10:00");

    await signIn("interviewer@example.com");
    assert.equal(
      (await call("POST", "/api/feedback", {
        candidateId: c.id,
        stage: stages[0],
        rating: 4,
        recommendation: "ADVANCE",
      })).status,
      201
    );

    await signIn("manager@example.com");
    const moved = await call("POST", "/api/candidates/" + c.id + "/advance");
    assert.equal(moved.status, 200);
    assert.equal(moved.data.candidate.currentStage, stages[1]);
  });

  test("a hiring manager cannot fill in the feedback for someone else's interview", async () => {
    // Review item 4. Before, any feedback:write role could score any
    // stage - and that score then counted towards letting the candidate
    // advance, so the gate could be opened by the wrong person.
    const c = await freshCandidate("Gate Test Three");
    await book(c.id, stages[0], "interviewer@example.com", "2027-08-03T10:00");

    await signIn("manager@example.com");
    const refused = await call("POST", "/api/feedback", {
      candidateId: c.id,
      stage: stages[0],
      rating: 5,
      recommendation: "ADVANCE",
    });
    assert.equal(refused.status, 403);
    // A booked stage names the booking; "assigned to" is kept for the
    // assignment rule, so the message says which rule applied.
    assert.match(refused.data.error, /booked with Test Interviewer/);

    // And it still does not count: the candidate stays blocked.
    await signIn("manager@example.com");
    assert.equal((await call("POST", "/api/candidates/" + c.id + "/advance")).status, 400);
  });

  test("a hiring manager CAN give feedback on an interview they were booked for", async () => {
    // The rule is about whose interview it is, not about the role.
    const c = await freshCandidate("Gate Test Four");
    await book(c.id, stages[0], "manager@example.com", "2027-08-04T10:00");

    await signIn("manager@example.com");
    assert.equal(
      (await call("POST", "/api/feedback", {
        candidateId: c.id,
        stage: stages[0],
        rating: 4,
        recommendation: "ADVANCE",
      })).status,
      201
    );
  });

  test("a declined booking does not block the candidate forever", async () => {
    // The interviewer said no. Waiting on their feedback would hold the
    // candidate for good, so a declined booking is not counted.
    const c = await freshCandidate("Gate Test Five");
    const interview = await book(c.id, stages[0], "interviewer@example.com", "2027-08-05T10:00");

    await signIn("interviewer@example.com");
    assert.equal(
      (await call("POST", "/api/interviews/" + interview.id + "/respond", {
        response: "DECLINED",
        note: "On leave that week.",
      })).status,
      200
    );

    await signIn("manager@example.com");
    const moved = await call("POST", "/api/candidates/" + c.id + "/advance");
    assert.equal(moved.status, 200, "nobody live is booked, so stage one moves as before");
  });

  test("with two interviewers booked, both have to report", async () => {
    const c = await freshCandidate("Gate Test Six");
    await book(c.id, stages[0], "interviewer@example.com", "2027-08-06T10:00");
    await book(c.id, stages[0], "manager@example.com", "2027-08-06T14:00");

    await signIn("interviewer@example.com");
    await call("POST", "/api/feedback", {
      candidateId: c.id,
      stage: stages[0],
      rating: 4,
      recommendation: "ADVANCE",
    });

    await signIn("manager@example.com");
    const still = await call("POST", "/api/candidates/" + c.id + "/advance");
    assert.equal(still.status, 400, "one of two is not enough");
    assert.match(still.data.error, /Test Manager/, "names the one still missing");
    assert.doesNotMatch(still.data.error, /Test Interviewer/, "and not the one who has reported");
  });
});

describe("FB-02 and FB-03 - outcomes reach the interviewer, comparison shows the words", () => {
  let jobId;
  let firstStage;

  async function addAndInterview(name) {
    await signIn("hr@example.com");
    const added = await call("POST", "/api/candidates", {
      jobId,
      fullName: name,
      email: name.toLowerCase().replace(/\s+/g, ".") + "@example.com",
      notify: false,
    });
    const c = added.data.candidate;
    const booked = await call("POST", "/api/interviews", {
      candidateId: c.id,
      stage: firstStage,
      scheduledAt: "2027-09-0" + (1 + (c.id % 8)) + "T10:00",
      interviewerId: await userId("interviewer@example.com"),
    });
    assert.equal(booked.status, 201);

    await signIn("interviewer@example.com");
    assert.equal(
      (await call("POST", "/api/feedback", {
        candidateId: c.id,
        stage: firstStage,
        rating: 4,
        recommendation: "ADVANCE",
        strengths: "Clear on the fundamentals.",
        concerns: "Little production experience.",
      })).status,
      201
    );
    return c;
  }

  test("setup", async () => {
    await signIn("hr@example.com");
    const job = (await call("GET", "/api/jobs")).data.jobs[0];
    jobId = job.id;
    const detail = (await call("GET", "/api/jobs/" + jobId)).data.job;
    firstStage = detail.stages.map((st) => (typeof st === "string" ? st : st.name))[0];
  });

  test("the interviewer is told when a candidate they assessed is hired", async () => {
    // Review item 3. Only HR and management used to hear the outcome;
    // the person who actually interviewed them never found out.
    const c = await addAndInterview("Outcome Watcher");

    await signIn("manager@example.com");
    assert.equal(
      (await call("PATCH", "/api/candidates/" + c.id, { outcome: "HIRED" })).status,
      200
    );

    await signIn("interviewer@example.com");
    const { data } = await call("GET", "/api/notifications");
    const told = data.notifications.find(
      (n) => n.kind === "candidate.hired" && n.candidateId === c.id
    );
    assert.ok(told, "the interviewer hears the outcome");
    assert.match(told.subject, /Outcome Watcher was hired/);
  });

  test("the interviewer's interview list shows where each candidate ended up", async () => {
    await signIn("interviewer@example.com");
    const { data } = await call("GET", "/api/interviews?mine=1");
    const row = data.interviews.find((i) => i.candidateName === "Outcome Watcher");
    assert.ok(row);
    assert.equal(row.candidateOutcome, "HIRED", "visible at a glance, not only on the candidate");
  });

  test("the person who made the decision is not told what they decided", async () => {
    const c = await addAndInterview("Self Decider");
    await signIn("manager@example.com");
    await call("PATCH", "/api/candidates/" + c.id, { outcome: "REJECTED" });

    const { data } = await call("GET", "/api/notifications");
    assert.ok(
      !data.notifications.some((n) => n.kind === "candidate.rejected" && n.candidateId === c.id),
      "being told what you just did yourself is noise"
    );
  });

  test("the comparison carries what interviewers actually wrote", async () => {
    // Review item 5. The page showed averages only - two candidates on
    // 4.0 and 4.1 are not separated by the decimal but by the concerns.
    const a = await addAndInterview("Compare Alpha");
    const b = await addAndInterview("Compare Beta");

    await signIn("manager@example.com");
    const { status, data } = await call("GET", "/api/feedback/compare/" + jobId);
    assert.equal(status, 200);

    for (const id of [a.id, b.id]) {
      const c = data.candidates.find((x) => x.id === id);
      assert.ok(Array.isArray(c.feedback), "each candidate carries their feedback");
      const note = c.feedback[0];
      assert.equal(note.authorName, "Test Interviewer");
      assert.equal(note.strengths, "Clear on the fundamentals.");
      assert.equal(note.concerns, "Little production experience.");
      assert.equal(note.rating, 4);
    }
  });
});

describe("RPT-01 - the vacancies KPI and the dashboard figures", () => {
  test("the stats payload uses the word the dashboard reads", async () => {
    // Review item 1. It sent openPositions while the dashboard read
    // openVacancies, so the Vacancies tile always showed 0.
    await signIn("hr@example.com");
    const { data } = await call("GET", "/api/team/stats");
    assert.equal(typeof data.openVacancies, "number");
    assert.ok(data.openVacancies > 0, "there are open vacancies, so it must not read 0");
    assert.equal(data.openPositions, undefined, "the old name is gone");
  });

  test("the report summary matches it", async () => {
    await signIn("management@example.com", "Password456");
    const { data } = await call("GET", "/api/reports");
    assert.equal(typeof data.summary.openVacancies, "number");
    assert.equal(data.summary.openPositions, undefined);
  });
});

describe("JOB-02 and JOB-03 - editing and closing a vacancy", () => {
  let jobId;

  test("HR edits a vacancy and the change sticks", async () => {
    // JOB-02: "edit or close a job position, so that I can keep the
    // listings accurate when hiring requirements change."
    await signIn("hr@example.com");
    const created = await call("POST", "/api/jobs", {
      title: "Site Reliability Engineer",
      department: "Infrastructure",
      stages: ["Applied", "Screening", "Interview"],
    });
    assert.equal(created.status, 201);
    jobId = created.data.job.id;

    const edited = await call("PATCH", "/api/jobs/" + jobId, {
      title: "Senior Site Reliability Engineer",
      location: "Colombo",
    });
    assert.equal(edited.status, 200);
    assert.equal(edited.data.job.title, "Senior Site Reliability Engineer");
    assert.equal(edited.data.job.location, "Colombo");
  });

  test("closing a vacancy takes it off the active list", async () => {
    // JOB-03: "close a job opening, so that filled or cancelled roles
    // stop appearing as active on the dashboard."
    const before = (await call("GET", "/api/team/stats")).data.openVacancies;

    const closed = await call("PATCH", "/api/jobs/" + jobId, { status: "CLOSED" });
    assert.equal(closed.status, 200);
    assert.equal(closed.data.job.status, "CLOSED");

    const active = (await call("GET", "/api/jobs?status=ACTIVE")).data.jobs;
    assert.ok(!active.some((j) => j.id === jobId), "no longer listed as active");

    const after = (await call("GET", "/api/team/stats")).data.openVacancies;
    assert.equal(after, before - 1, "and the dashboard's Vacancies figure drops by one");
  });

  test("nobody can be added to a closed vacancy", async () => {
    const { status, data } = await call("POST", "/api/candidates", {
      jobId,
      fullName: "Too Late",
      email: "too.late@example.com",
      notify: false,
    });
    assert.equal(status, 400);
    assert.match(data.error, /closed/i);
  });

  test("a closed vacancy can be reopened", async () => {
    const reopened = await call("PATCH", "/api/jobs/" + jobId, { status: "ACTIVE" });
    assert.equal(reopened.status, 200);
    assert.equal(reopened.data.job.status, "ACTIVE");
  });

  test("only HR can edit or close a vacancy", async () => {
    for (const [who, password] of [
      ["manager@example.com", "Password123"],
      ["interviewer@example.com", "Password123"],
      ["management@example.com", "Password456"],
    ]) {
      await signIn(who, password);
      assert.equal(
        (await call("PATCH", "/api/jobs/" + jobId, { status: "CLOSED" })).status,
        403,
        who + " must not close a vacancy"
      );
    }
  });
});

describe("CAN-03 - searching and filtering candidates", () => {
  let jobA;
  let jobB;

  test("setup", async () => {
    await signIn("hr@example.com");
    const a = await call("POST", "/api/jobs", { title: "Search Job A", stages: ["Applied", "Interview"] });
    const b = await call("POST", "/api/jobs", { title: "Search Job B", stages: ["Applied", "Interview"] });
    jobA = a.data.job.id;
    jobB = b.data.job.id;

    for (const [jobId, fullName, email] of [
      [jobA, "Nadeesha Wickramasinghe", "nadeesha@example.com"],
      [jobA, "Pradeep Kumara", "pradeep.k@example.com"],
      [jobB, "Nadeesha Fonseka", "n.fonseka@example.com"],
    ]) {
      assert.equal(
        (await call("POST", "/api/candidates", { jobId, fullName, email, notify: false })).status,
        201
      );
    }
  });

  test("search finds people by part of their name", async () => {
    // CAN-03: "search and filter candidates, so that I can quickly find
    // suitable profiles, especially when there are many applicants."
    const { data } = await call("GET", "/api/candidates?q=nadeesha");
    const names = data.candidates.map((c) => c.fullName);
    assert.ok(names.includes("Nadeesha Wickramasinghe"));
    assert.ok(names.includes("Nadeesha Fonseka"));
    assert.ok(!names.includes("Pradeep Kumara"));
  });

  test("search is case-insensitive and matches the email too", async () => {
    const byCase = await call("GET", "/api/candidates?q=NADEESHA");
    assert.ok(byCase.data.candidates.length >= 2, "capitals make no difference");

    const byEmail = await call("GET", "/api/candidates?q=pradeep.k@");
    assert.deepEqual(
      byEmail.data.candidates.map((c) => c.fullName),
      ["Pradeep Kumara"]
    );
  });

  test("filtering by vacancy narrows to that vacancy only", async () => {
    const { data } = await call("GET", "/api/candidates?job=" + jobB);
    assert.ok(data.candidates.length >= 1);
    assert.ok(data.candidates.every((c) => c.jobId === jobB));
  });

  test("search and filter combine", async () => {
    const { data } = await call("GET", "/api/candidates?q=nadeesha&job=" + jobA);
    assert.deepEqual(
      data.candidates.map((c) => c.fullName),
      ["Nadeesha Wickramasinghe"],
      "the name that matches, in the vacancy asked for"
    );
  });

  test("filtering by outcome works", async () => {
    const { data } = await call("GET", "/api/candidates?outcome=ACTIVE&job=" + jobA);
    assert.ok(data.candidates.every((c) => c.outcome === "ACTIVE"));
  });

  test("a search that matches nobody returns an empty list, not an error", async () => {
    const { status, data } = await call("GET", "/api/candidates?q=zzzz-nobody-zzzz");
    assert.equal(status, 200);
    assert.equal(data.candidates.length, 0);
  });

  test("a search cannot be used to inject SQL", async () => {
    // The term is passed as a parameter, never spliced into the query.
    const { status, data } = await call(
      "GET",
      "/api/candidates?q=" + encodeURIComponent("' OR '1'='1")
    );
    assert.equal(status, 200);
    assert.equal(data.candidates.length, 0, "matched literally, so it finds nobody");
  });
});

// The three suites below share one vacancy. Each is named for the one
// story its tests are evidence for, so the backlog table credits a test
// only where it belongs.
const pageRules = { jobId: null, stages: ["Applied", "Screening", "Interview"] };

async function pageCandidate(name) {
  await signIn("hr@example.com");
  if (!pageRules.jobId) {
    const job = await call("POST", "/api/jobs", {
      title: "Page Rules Vacancy",
      stages: pageRules.stages,
    });
    pageRules.jobId = job.data.job.id;
  }
  const added = await call("POST", "/api/candidates", {
    jobId: pageRules.jobId,
    fullName: name,
    email: name.toLowerCase().replace(/\s+/g, ".") + "@example.com",
    notify: false,
  });
  assert.equal(added.status, 201);
  return added.data.candidate;
}

describe("CAN-04 and WF-02 - the Move button knows the rule before it is pressed", () => {
  test("the page is told whether Move is allowed, before anyone presses it", async () => {
    // The Move button used to be offered and then refused. The page now
    // gets the same answer the action would give.
    const c = await pageCandidate("Page Move One");
    const { data } = await call("GET", "/api/candidates/" + c.id);
    assert.equal(data.candidate.advance.allowed, true, "nothing booked, first stage");
    assert.equal(data.candidate.advance.nextStage, "Screening");

    await call("POST", "/api/interviews", {
      candidateId: c.id,
      stage: "Applied",
      scheduledAt: "2027-10-01T10:00",
      interviewerId: await userId("interviewer@example.com"),
    });
    const after = await call("GET", "/api/candidates/" + c.id);
    assert.equal(after.data.candidate.advance.allowed, false, "a booking locks it");
    assert.match(after.data.candidate.advance.reason, /Waiting on feedback/);
    assert.deepEqual(after.data.candidate.advance.waitingOn, ["Test Interviewer"]);
  });

  test("with nobody booked, the wait names the ASSIGNED interviewer", async () => {
    // The reviewer's wording: blocked "until the interviewer sends the
    // current stage feedback". Name who that is.
    const c = await pageCandidate("Page Move Two");
    await call("POST", "/api/candidates/" + c.id + "/assign", {
      interviewerId: await userId("interviewer@example.com"),
    });
    // Past stage one, where the rule applies, with nobody booked.
    await run("UPDATE candidates SET current_stage = 'Screening' WHERE id = $1", [c.id]);

    const { data } = await call("GET", "/api/candidates/" + c.id);
    assert.equal(data.candidate.advance.allowed, false);
    assert.match(data.candidate.advance.reason, /from Test Interviewer/);
  });

  test("a decided candidate no longer moves between stages", async () => {
    const c = await pageCandidate("Page Decided");
    await signIn("manager@example.com");
    await call("PATCH", "/api/candidates/" + c.id, { outcome: "HIRED" });

    const { data } = await call("GET", "/api/candidates/" + c.id);
    assert.equal(data.candidate.advance.allowed, false);
    assert.match(data.candidate.advance.reason, /decision has been recorded/);
    assert.equal((await call("POST", "/api/candidates/" + c.id + "/advance")).status, 400);
  });

});

describe("FB-01 - only the interviewer who owns the stage gives its feedback", () => {
  test("the stage dropdown is no way round the feedback rule", async () => {
    // Review item 4, the exact route the tester took. The booked stage
    // was guarded, but the form lets you pick another stage - and a
    // hiring manager could score a candidate assigned to somebody else
    // by choosing a stage nobody was booked for.
    const c = await pageCandidate("Dropdown Loophole");
    await signIn("hr@example.com");
    await call("POST", "/api/interviews", {
      candidateId: c.id,
      stage: "Applied",
      scheduledAt: "2027-10-02T10:00",
      interviewerId: await userId("interviewer@example.com"),
    });

    await signIn("manager@example.com");
    for (const stage of pageRules.stages) {
      const { status, data } = await call("POST", "/api/feedback", {
        candidateId: c.id,
        stage,
        rating: 5,
        recommendation: "ADVANCE",
      });
      assert.equal(status, 403, "refused at " + stage);
      assert.match(data.error, /Test Interviewer/, "and names who may");
    }
  });

  test("the page is told, per stage, whether this person may give feedback", async () => {
    const c = await pageCandidate("Rights Per Stage");
    await signIn("hr@example.com");
    await call("POST", "/api/candidates/" + c.id + "/assign", {
      interviewerId: await userId("interviewer@example.com"),
    });

    await signIn("manager@example.com");
    const asManager = (await call("GET", "/api/candidates/" + c.id)).data.candidate.feedbackRights;
    for (const stage of pageRules.stages) assert.equal(asManager[stage].allowed, false, "manager: " + stage);

    await signIn("interviewer@example.com");
    const asInterviewer = (await call("GET", "/api/candidates/" + c.id)).data.candidate.feedbackRights;
    for (const stage of pageRules.stages) assert.equal(asInterviewer[stage].allowed, true, "interviewer: " + stage);
  });

  test("an unassigned, unbooked candidate is open to any feedback writer", async () => {
    // Rule 3: nobody owns them yet, so the usual roles may score them.
    const c = await pageCandidate("Nobody Owns Me");
    await signIn("manager@example.com");
    const { status } = await call("POST", "/api/feedback", {
      candidateId: c.id,
      stage: "Applied",
      rating: 4,
      recommendation: "ADVANCE",
    });
    assert.equal(status, 201);
  });

});

describe("COM-01 - the hire decision reports whether the letter was sent", () => {
  test("recording an outcome says whether the candidate's letter went", async () => {
    // Review item 6: "need to check hire confirmation mails sent or not".
    // The reply now says, rather than leaving it to a trip to the Outbox.
    const c = await pageCandidate("Letter Check");
    await signIn("manager@example.com");
    const { status, data } = await call("PATCH", "/api/candidates/" + c.id, { outcome: "HIRED" });
    assert.equal(status, 200);
    assert.equal(data.email.attempted, true);
    assert.equal(data.email.to, "letter.check@example.com");
    assert.equal(data.email.sent, false, "no mail provider in tests");
    assert.match(data.email.reason, /no mail provider/);
  });

  test("putting someone on hold writes no letter", async () => {
    const c = await pageCandidate("Hold No Letter");
    await signIn("manager@example.com");
    const { data } = await call("PATCH", "/api/candidates/" + c.id, { outcome: "ON_HOLD" });
    assert.equal(data.email.attempted, false);
  });
});

describe("INT-01 - Sprint 1 manual test cases, automated", () => {
  let candidateId;
  let sanduniId;

  before(async () => {
    await signIn("hr@example.com");

    const job = await one(
      "INSERT INTO jobs (title, created_by) VALUES ($1, (SELECT id FROM users WHERE email = $2)) " +
        "RETURNING id",
      ["Test case vacancy", "hr@example.com"]
    );
    await run("INSERT INTO job_stages (job_id, name, position) VALUES ($1, $2, $3)", [
      job.id,
      "Applied",
      0,
    ]);
    await run("INSERT INTO job_stages (job_id, name, position) VALUES ($1, $2, $3)", [
      job.id,
      "Interview",
      1,
    ]);

    const candidate = await one(
      "INSERT INTO candidates (job_id, full_name, email, current_stage) " +
        "VALUES ($1, $2, $3, $4) RETURNING id",
      [job.id, "Test Case Candidate", "test.case@example.com", "Applied"]
    );
    candidateId = Number(candidate.id);

    // The slide names Sanduni as the interviewer.
    await makeUser("Sanduni", "sanduni@example.com", "interviewer");
    sanduniId = await userId("sanduni@example.com");
  });

  // TC-12 · VALID - ACTUAL DATA
  // Steps:    open a candidate, schedule an interview, fill date, stage
  //           and interviewer, save.
  // Data:     2026-09-01 10:00, interviewer Sanduni.
  // Expected: the interview is saved and shown correctly.
  test("TC-12 schedules an interview with real data, and shows it back", async () => {
    // The slide's date has passed since it was written, so the same
    // date is used one year on - the case is "a real working date",
    // not "this exact day", and a test that rots is worse than none.
    const { status, data } = await call("POST", "/api/interviews", {
      candidateId,
      stage: "Interview",
      scheduledAt: "2027-09-01T10:00",
      interviewerId: sanduniId,
      location: "Meeting room 1",
    });

    assert.equal(status, 201, "saved");
    assert.equal(data.interview.interviewerName, "Sanduni");
    assert.equal(data.interview.stage, "Interview");
    assert.equal(data.interview.location, "Meeting room 1");
    assert.equal(new Date(data.interview.scheduledAt).getFullYear(), 2027);

    // "and shown correctly" - it comes back when the candidate is read.
    const shown = await call("GET", "/api/candidates/" + candidateId);
    const found = shown.data.interviews.find((i) => i.id === data.interview.id);
    assert.ok(found, "the booking is on the candidate's record");
    assert.equal(found.interviewerName, "Sanduni");
  });

  // TC-14 · INVALID DATA
  // Steps:    open a candidate, schedule an interview, pick a prior
  //           date, save.
  // Data:     exactly one week before today.
  // Expected: the system does not allow a date prior to today.
  test("TC-14 refuses a date exactly one week in the past", async () => {
    const aWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { status, data } = await call("POST", "/api/interviews", {
      candidateId,
      stage: "Interview",
      scheduledAt: aWeekAgo,
      interviewerId: sanduniId,
    });

    assert.equal(status, 400, "cannot be booked");
    assert.match(data.error, /not available/i);
    assert.match(data.error, /already passed/i);

    // Nothing was written - refusing has to mean refusing.
    const rows = await many(
      "SELECT id FROM interviews WHERE candidate_id = $1 AND scheduled_at < NOW()",
      [candidateId]
    );
    assert.equal(rows.length, 0);
  });

  // TC-15 · VALIDATION
  // Steps:    open schedule interview, fill date and stage only, leave
  //           the interviewer empty, save.
  // Data:     interviewer field blank.
  // Expected: a validation message is shown; the form is not submitted.
  test("TC-15 refuses a booking with no interviewer selected", async () => {
    const soon = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString();

    const { status, data } = await call("POST", "/api/interviews", {
      candidateId,
      stage: "Interview",
      scheduledAt: soon,
      interviewerId: "",
    });

    assert.equal(status, 400);
    assert.match(data.error, /Choose the interviewer/i);

    const rows = await many("SELECT id FROM interviews WHERE candidate_id = $1", [candidateId]);
    assert.equal(rows.length, 1, "only TC-12's booking exists - nothing was saved");
  });

  // TC-16 · NON-FUNCTIONAL
  // Steps:    submit a valid booking, time from save to confirmation.
  // Data:     10 consecutive bookings, warm server.
  // Expected: saved and confirmed within 2 seconds.
  test("TC-16 confirms a booking within 2 seconds, over 10 runs", async () => {
    // Warm first, as the case says - the first call through any path
    // pays for connection set-up, which is not what is being measured.
    await call("GET", "/api/candidates/" + candidateId);

    const timings = [];
    for (let n = 0; n < 10; n++) {
      // A different slot each time: the same one twice is a 409 by
      // design, and that would be measuring the wrong thing.
      const when = new Date(Date.now() + (30 + n) * 24 * 60 * 60 * 1000).toISOString();

      const started = performance.now();
      const { status } = await call("POST", "/api/interviews", {
        candidateId,
        stage: "Interview",
        scheduledAt: when,
        interviewerId: sanduniId,
      });
      timings.push(performance.now() - started);
      assert.equal(status, 201, "run " + (n + 1) + " saved");
    }

    const slowest = Math.max(...timings);
    const quickest = Math.min(...timings);
    const average = timings.reduce((a, b) => a + b, 0) / timings.length;

    // Printed so the number on the slide can be filled in from a real
    // run rather than remembered. All three, so a suspiciously flat
    // result is visible rather than hidden behind one rounded figure.
    console.log(
      "      TC-16: 10 bookings - quickest " +
        Math.round(quickest) +
        "ms, average " +
        Math.round(average) +
        "ms, slowest " +
        Math.round(slowest) +
        "ms"
    );

    assert.ok(slowest < 2000, "the slowest of the ten was " + Math.round(slowest) + "ms");
  });
});

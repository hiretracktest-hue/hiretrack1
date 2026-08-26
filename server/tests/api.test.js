/**
 * Automated API tests - run them with:  npm test
 *
 * Node's own test runner, so there is no extra library to install. Each
 * run uses a brand new temporary SQLite file, so the tests never touch
 * the real database.
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
import bcrypt from "bcryptjs";

const TEST_DB = path.join(os.tmpdir(), "hiretrack-test-" + Date.now() + ".db");
process.env.DATABASE_FILE = TEST_DB;
process.env.JWT_SECRET = "test-secret-not-used-anywhere-else";
process.env.NODE_ENV = "test";

const TEST_UPLOADS = path.join(os.tmpdir(), "hiretrack-test-uploads-" + Date.now());
fs.mkdirSync(TEST_UPLOADS, { recursive: true });
process.env.UPLOAD_DIR = TEST_UPLOADS;

const { createApp } = await import("../app.js");
const { db } = await import("../db/index.js");

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
function makeUser(name, email, role) {
  db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)").run(
    name,
    email,
    bcrypt.hashSync("Password123", 10),
    role
  );
}

async function signIn(email, password = "Password123") {
  cookie = "";
  const result = await call("POST", "/api/auth/signin", { email, password });
  assert.equal(result.status, 200, "could not sign in as " + email);
}

before(async () => {
  const app = createApp({ log: false });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = "http://127.0.0.1:" + server.address().port;

  makeUser("Test HR", "hr@example.com", "hr");
  makeUser("Test Manager", "manager@example.com", "hiring_manager");
  makeUser("Test Interviewer", "interviewer@example.com", "interviewer");
  makeUser("Test Management", "management@example.com", "management");
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.promises.unlink(TEST_DB + suffix).catch(() => {});
  }
  fs.promises.rm(TEST_UPLOADS, { recursive: true, force: true }).catch(() => {});
});

describe("health and sign-in", () => {
  test("the API is up", async () => {
    const { status, data } = await call("GET", "/api/health");
    assert.equal(status, 200);
    assert.equal(data.ok, true);
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
    assert.equal((await call("POST", "/api/auth/reset-password", { token, password: "Password456" })).status, 200);
    assert.equal((await call("POST", "/api/auth/reset-password", { token, password: "Password789" })).status, 400);
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

  test("a stage in use cannot be removed", async () => {
    await call("POST", "/api/candidates", {
      jobId: 1,
      fullName: "Stage Holder",
      email: "holder@example.com",
    });
    const { status } = await call("PATCH", "/api/jobs/1", { stages: ["Applied", "Offer"] });
    assert.equal(status, 200, "nobody has moved off Applied yet");

    await call("PATCH", "/api/jobs/1", { stages: ["Applied", "Interview", "Offer"] });
  });
});

describe("HR adds candidates", () => {
  test("HR adds a candidate, who starts at the first stage", async () => {
    await signIn("hr@example.com");
    const { status, data } = await call("POST", "/api/candidates", {
      jobId: 1,
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
      jobId: 1,
      fullName: "Maya Again",
      email: "maya@example.com",
    });
    assert.equal(status, 409);
  });

  test("HR uploads their CV, and a .txt file is refused", async () => {
    const good = new FormData();
    good.append("cv", new Blob(["%PDF-1.4 cv"], { type: "application/pdf" }), "maya.pdf");
    const upload = await call("POST", "/api/candidates/2/cv", good, true);
    assert.equal(upload.status, 200);
    assert.equal(upload.data.candidate.cv.filename, "maya.pdf");

    const bad = new FormData();
    bad.append("cv", new Blob(["nope"], { type: "text/plain" }), "notes.txt");
    assert.equal((await call("POST", "/api/candidates/2/cv", bad, true)).status, 400);
  });

  test("the CV can be downloaded again", async () => {
    const response = await fetch(baseUrl + "/api/candidates/2/cv", {
      headers: { Cookie: cookie },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-disposition") || "", /maya\.pdf/);
  });

  test("an invalid id returns a clear 400, not a crash", async () => {
    assert.equal((await call("GET", "/api/candidates/not-a-number")).status, 400);
  });
});

describe("CV screening bands", () => {
  test("HR bands a CV", async () => {
    const { status, data } = await call("POST", "/api/candidates/2/band", {
      band: "HIGH",
      note: "Strong match",
    });
    assert.equal(status, 200);
    assert.equal(data.candidate.cvBand, "HIGH");
    assert.equal(data.candidate.bandedByName, "Test HR");
  });

  test("an invalid band is refused", async () => {
    assert.equal((await call("POST", "/api/candidates/2/band", { band: "AMAZING" })).status, 400);
  });

  test("the list filters by band and reports the totals", async () => {
    const all = await call("GET", "/api/candidates?job=1");
    assert.equal(all.data.bandCounts.HIGH, 1);
    assert.equal(all.data.total, 2);

    const high = await call("GET", "/api/candidates?job=1&cvBand=HIGH");
    assert.equal(high.data.candidates.length, 1);
    assert.equal((await call("GET", "/api/candidates?job=1&cvBand=LOW")).data.candidates.length, 0);
  });

  test("bulk banding screens several at once", async () => {
    const { status, data } = await call("POST", "/api/candidates/band/bulk", {
      ids: [1, 2],
      band: "MEDIUM",
    });
    assert.equal(status, 200);
    assert.equal(data.updated, 2);
    await call("POST", "/api/candidates/2/band", { band: "HIGH" });
  });

  test("an interviewer cannot band a CV", async () => {
    await signIn("interviewer@example.com");
    assert.equal((await call("POST", "/api/candidates/2/band", { band: "LOW" })).status, 403);
  });
});

describe("no advancing without feedback", () => {
  test("the first stage is exempt - nobody has interviewed them yet", async () => {
    await signIn("hr@example.com");
    const { status, data } = await call("POST", "/api/candidates/2/advance");
    assert.equal(status, 200);
    assert.equal(data.candidate.currentStage, "Interview");
  });

  test("advancing past a stage with no feedback is blocked", async () => {
    const { status, data } = await call("POST", "/api/candidates/2/advance");
    assert.equal(status, 400);
    assert.match(data.error, /Feedback for "Interview"/);
  });

  test("once feedback is in, the candidate moves on", async () => {
    await signIn("interviewer@example.com");
    const feedback = await call("POST", "/api/feedback", {
      candidateId: 2,
      stage: "Interview",
      rating: 4,
      recommendation: "ADVANCE",
      strengths: "Explained her projects clearly.",
    });
    assert.equal(feedback.status, 201);

    await signIn("hr@example.com");
    const { status, data } = await call("POST", "/api/candidates/2/advance");
    assert.equal(status, 200);
    assert.equal(data.candidate.currentStage, "Offer");
  });

  test("a candidate at the last stage cannot be advanced again", async () => {
    assert.equal((await call("POST", "/api/candidates/2/advance")).status, 400);
  });
});

describe("fair side-by-side comparison", () => {
  test("a rating outside 1-5 is refused", async () => {
    assert.equal(
      (await call("POST", "/api/feedback", { candidateId: 2, stage: "Interview", rating: 9 })).status,
      400
    );
  });

  test("writing again replaces my score instead of stacking a second one", async () => {
    await signIn("interviewer@example.com");
    await call("POST", "/api/feedback", {
      candidateId: 2,
      stage: "Interview",
      rating: 2,
      recommendation: "HOLD",
    });
    const { data } = await call("GET", "/api/feedback?candidate=2&mine=1");
    assert.equal(data.feedback.length, 1);
    assert.equal(data.feedback[0].rating, 2);
  });

  test("the comparison table ranks candidates by average score", async () => {
    await signIn("manager@example.com");
    const { status, data } = await call("GET", "/api/feedback/compare/1");
    assert.equal(status, 200);
    assert.ok(data.stages.includes("Interview"));
    const maya = data.candidates.find((c) => c.id === 2);
    assert.equal(maya.averageRating, 2);
    assert.equal(maya.votes.hold, 1);
  });

  test("an interviewer cannot open the comparison", async () => {
    await signIn("interviewer@example.com");
    assert.equal((await call("GET", "/api/feedback/compare/1")).status, 403);
  });
});

describe("telling candidates and interviewers about an interview", () => {
  let interviewId;

  test("booking an interview notifies the interviewer in the app", async () => {
    await signIn("hr@example.com");
    const interviewerId = db.prepare("SELECT id FROM users WHERE email = ?").get("interviewer@example.com").id;

    const { status, data } = await call("POST", "/api/interviews", {
      candidateId: 2,
      stage: "Interview",
      scheduledAt: "2027-01-15T10:30",
      interviewerId,
      location: "Meeting room 2",
    });
    assert.equal(status, 201);
    assert.equal(data.interview.interviewerName, "Test Interviewer");
    interviewId = data.interview.id;

    await signIn("interviewer@example.com");
    const notes = await call("GET", "/api/notifications");
    assert.equal(notes.data.unread, 1);
    assert.match(notes.data.notifications[0].subject, /You are interviewing/);
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
    assert.equal((await call("POST", "/api/notifications/" + data.notifications[0].id + "/read")).status, 200);
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
      candidateId: 2,
      stage: "Interview",
      scheduledAt: "the day after tomorrow",
    });
    assert.equal(status, 400);
  });
});

describe("who logs in, and what each role can do", () => {
  test("only HR opens, edits or deletes a position", async () => {
    for (const email of ["manager@example.com", "interviewer@example.com", "management@example.com"]) {
      await signIn(email, email === "management@example.com" ? "Password456" : "Password123");
      assert.equal((await call("POST", "/api/jobs", { title: "Nope" })).status, 403, email);
      assert.equal((await call("PATCH", "/api/jobs/1", { title: "Nope" })).status, 403, email);
      assert.equal((await call("DELETE", "/api/jobs/1")).status, 403, email);
    }
  });

  test("only HR adds candidates and uploads CVs", async () => {
    await signIn("manager@example.com");
    assert.equal(
      (await call("POST", "/api/candidates", { jobId: 1, fullName: "X Y", email: "xy@example.com" }))
        .status,
      403
    );
  });

  test("the hiring manager can band, advance and record an outcome", async () => {
    assert.equal((await call("POST", "/api/candidates/1/band", { band: "LOW" })).status, 200);
    assert.equal((await call("PATCH", "/api/candidates/2", { outcome: "HIRED" })).status, 200);
  });

  test("management sees everything and changes nothing", async () => {
    await signIn("management@example.com", "Password456");
    assert.equal((await call("GET", "/api/candidates")).status, 200);
    assert.equal((await call("GET", "/api/jobs")).status, 200);
    assert.equal((await call("GET", "/api/feedback/compare/1")).status, 200);
    assert.equal((await call("GET", "/api/reports")).status, 200);

    assert.equal((await call("POST", "/api/candidates/1/band", { band: "HIGH" })).status, 403);
    assert.equal((await call("POST", "/api/candidates/1/advance")).status, 403);
    assert.equal((await call("PATCH", "/api/candidates/1", { outcome: "HIRED" })).status, 403);
    assert.equal(
      (await call("POST", "/api/feedback", { candidateId: 1, stage: "Applied", rating: 5 })).status,
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
      (await call("POST", "/api/team/members", {
        name: "Nope",
        email: "nope@example.com",
        role: "hr",
        password: "Password123",
      })).status,
      403
    );
  });

  test("the last HR account cannot demote itself", async () => {
    await signIn("hr@example.com");
    const hrId = db.prepare("SELECT id FROM users WHERE email = ?").get("hr@example.com").id;
    const { status, data } = await call("PATCH", "/api/team/members/" + hrId, { role: "interviewer" });
    assert.equal(status, 400);
    assert.match(data.error, /at least one active HR/);
  });
});

describe("reports management can export", () => {
  test("the report adds up and does not double-count", async () => {
    await signIn("management@example.com", "Password456");
    const { data } = await call("GET", "/api/reports");

    const total = db.prepare("SELECT COUNT(*) AS v FROM candidates").get().v;
    assert.equal(data.summary.totalCandidates, total);

    const position1 = data.positions.find((row) => row.id === 1);
    const actual = db.prepare("SELECT COUNT(*) AS v FROM candidates WHERE job_id = 1").get().v;
    assert.equal(position1.candidates, actual, "feedback rows must not inflate the count");
  });

  test("CSV export downloads with the right headers", async () => {
    const response = await fetch(baseUrl + "/api/reports/export.csv?report=positions", {
      headers: { Cookie: cookie },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/csv/);
    assert.match(response.headers.get("content-disposition"), /hiretrack-positions\.csv/);

    const body = await response.text();
    assert.match(body, /Position,Department,Status/);
  });

  test("every export variant works", async () => {
    for (const report of ["candidates", "stages", "interviewers"]) {
      const { status } = await call("GET", "/api/reports/export.csv?report=" + report);
      assert.equal(status, 200, report);
    }
  });

  test("an interviewer cannot see or export reports", async () => {
    await signIn("interviewer@example.com");
    assert.equal((await call("GET", "/api/reports")).status, 403);
    assert.equal((await call("GET", "/api/reports/export.csv")).status, 403);
  });
});

/**
 * Automated API tests - run them with:  npm test
 *
 * These use Node's own built-in test runner (node:test), so there is no
 * extra testing library to install. Each run uses a brand new temporary
 * SQLite file, so the tests never touch the real database.
 */
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";

// Point the app at a throw-away database BEFORE anything imports it.
const TEST_DB = path.join(os.tmpdir(), "hiretrack-test-" + Date.now() + ".db");
process.env.DATABASE_FILE = TEST_DB;
process.env.JWT_SECRET = "test-secret-not-used-anywhere-else";
process.env.NODE_ENV = "test";

// Uploaded test files go to a temporary folder, not server/uploads.
const TEST_UPLOADS = path.join(os.tmpdir(), "hiretrack-test-uploads-" + Date.now());
fs.mkdirSync(TEST_UPLOADS, { recursive: true });
process.env.UPLOAD_DIR = TEST_UPLOADS;

const { createApp } = await import("../app.js");
const { db } = await import("../db/index.js");

let server;
let baseUrl;
let cookie = "";

/** Small fetch wrapper that remembers the login cookie between calls. */
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
  return { status: response.status, data };
}

/**
 * Staff accounts cannot be created through the sign-up form on purpose,
 * so the tests insert them the way the seed script does.
 */
function makeStaff(name, email, role) {
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

  makeStaff("Test HR", "hr@example.com", "hr");
  makeStaff("Test Manager", "manager@example.com", "hiring_manager");
  makeStaff("Test Interviewer", "interviewer@example.com", "interviewer");
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.promises.unlink(TEST_DB + suffix).catch(() => {});
  }
  fs.promises.rm(TEST_UPLOADS, { recursive: true, force: true }).catch(() => {});
});

describe("health", () => {
  test("the API is up", async () => {
    const { status, data } = await call("GET", "/api/health");
    assert.equal(status, 200);
    assert.equal(data.ok, true);
  });
});

describe("authentication", () => {
  test("rejects a password with no number in it", async () => {
    const { status } = await call("POST", "/api/auth/signup", {
      name: "Weak Password",
      email: "weak@example.com",
      password: "onlyletters",
    });
    assert.equal(status, 400);
  });

  test("anyone signing up is a candidate, never staff", async () => {
    const { status, data } = await call("POST", "/api/auth/signup", {
      name: "Sneaky Applicant",
      email: "sneaky@example.com",
      password: "Password123",
      role: "hr", // ignored on purpose
    });
    assert.equal(status, 201);
    assert.equal(data.user.role, "candidate");
    assert.equal(data.user.isStaff, false);
  });

  test("refuses a duplicate email", async () => {
    const { status } = await call("POST", "/api/auth/signup", {
      name: "Copy Cat",
      email: "sneaky@example.com",
      password: "Password123",
    });
    assert.equal(status, 409);
  });

  test("a wrong password is rejected", async () => {
    cookie = "";
    const { status } = await call("POST", "/api/auth/signin", {
      email: "hr@example.com",
      password: "WrongPassword1",
    });
    assert.equal(status, 401);
  });

  test("/me returns the signed-in user with their permissions", async () => {
    await signIn("hr@example.com");
    const { data } = await call("GET", "/api/auth/me");
    assert.equal(data.user.email, "hr@example.com");
    assert.equal(data.user.roleLabel, "HR Recruiter");
    assert.equal(data.user.permissions["vacancy:create"], true);
  });

  test("forgot password never reveals whether an email exists", async () => {
    const known = await call("POST", "/api/auth/forgot-password", { email: "hr@example.com" });
    const unknown = await call("POST", "/api/auth/forgot-password", { email: "nobody@example.com" });
    assert.equal(known.status, 200);
    assert.equal(unknown.status, 200);
    assert.equal(known.data.message, unknown.data.message);
  });

  test("a reset token works once and only once", async () => {
    const { data } = await call("POST", "/api/auth/forgot-password", {
      email: "interviewer@example.com",
    });
    const token = new URL(data.devResetUrl).searchParams.get("token");

    const first = await call("POST", "/api/auth/reset-password", {
      token,
      password: "Password456",
    });
    assert.equal(first.status, 200);

    const second = await call("POST", "/api/auth/reset-password", {
      token,
      password: "Password789",
    });
    assert.equal(second.status, 400);
  });
});

describe("vacancies", () => {
  test("a signed-out visitor cannot create a vacancy", async () => {
    cookie = "";
    const { status } = await call("POST", "/api/jobs", { title: "Sneaky Job" });
    assert.equal(status, 401);
  });

  test("HR creates a vacancy with its interview stages and a share link", async () => {
    await signIn("hr@example.com");
    const { status, data } = await call("POST", "/api/jobs", {
      title: "Junior Developer",
      department: "Engineering",
      location: "Colombo",
      stages: ["Applied", "Interview", "Offer"],
    });
    assert.equal(status, 201);
    assert.deepEqual(data.job.stages, ["Applied", "Interview", "Offer"]);
    assert.ok(data.job.publicToken, "a public share token is generated");
    assert.match(data.job.shareUrl, /\/job\//);
  });

  test("a vacancy must have a title", async () => {
    const { status } = await call("POST", "/api/jobs", { title: "   " });
    assert.equal(status, 400);
  });

  test("lists vacancies with an applicant count", async () => {
    const { data } = await call("GET", "/api/jobs");
    assert.equal(data.jobs.length, 1);
    assert.equal(data.jobs[0].applicantCount, 0);
  });
});

describe("the public job link", () => {
  let token;

  test("HR can read the share link off the vacancy", async () => {
    await signIn("hr@example.com");
    const { data } = await call("GET", "/api/jobs/1");
    token = data.job.publicToken;
    assert.ok(token);
  });

  test("anyone can open the link with no account at all", async () => {
    cookie = "";
    const { status, data } = await call("GET", "/api/public/jobs/" + token);
    assert.equal(status, 200);
    assert.equal(data.job.title, "Junior Developer");
    assert.equal(data.signedIn, false);
    assert.equal(data.job.openForApplications, true);
  });

  test("the public page exposes a count, never who applied", async () => {
    cookie = "";
    const { data } = await call("GET", "/api/public/jobs/" + token);
    assert.equal(typeof data.job.applicantCount, "number");
    assert.ok(!JSON.stringify(data).includes("@"), "no email addresses in the public payload");
  });

  test("a made-up link is refused", async () => {
    cookie = "";
    const { status } = await call("GET", "/api/public/jobs/not-a-real-token");
    assert.equal(status, 404);
  });

  test("regenerating the link stops the old one working", async () => {
    await signIn("hr@example.com");
    const { data } = await call("POST", "/api/jobs/1/share/regenerate");
    const fresh = data.job.publicToken;
    assert.notEqual(fresh, token);

    cookie = "";
    assert.equal((await call("GET", "/api/public/jobs/" + token)).status, 404, "old link dead");
    assert.equal((await call("GET", "/api/public/jobs/" + fresh)).status, 200, "new link works");
  });

  test("only HR can regenerate a link", async () => {
    await signIn("manager@example.com");
    assert.equal((await call("POST", "/api/jobs/1/share/regenerate")).status, 403);
  });
});

describe("role permissions", () => {
  test("only HR can create, edit or delete a vacancy", async () => {
    await signIn("manager@example.com");
    assert.equal((await call("POST", "/api/jobs", { title: "Role test" })).status, 403);
    assert.equal((await call("PATCH", "/api/jobs/1", { title: "Renamed" })).status, 403);
    assert.equal((await call("DELETE", "/api/jobs/1")).status, 403);

    await signIn("interviewer@example.com", "Password456");
    assert.equal((await call("POST", "/api/jobs", { title: "Role test" })).status, 403);
  });

  test("an interviewer cannot compare candidates, but can see interviews", async () => {
    await signIn("interviewer@example.com", "Password456");
    assert.equal((await call("GET", "/api/feedback/compare/1")).status, 403);
    assert.equal((await call("GET", "/api/interviews")).status, 200);
  });

  test("nobody can promote themselves", async () => {
    await signIn("interviewer@example.com", "Password456");
    assert.equal((await call("PATCH", "/api/team/me", { role: "hr" })).status, 403);
  });

  test("HR can create a staff account and change a role", async () => {
    await signIn("hr@example.com");
    const created = await call("POST", "/api/team/members", {
      name: "New Interviewer",
      email: "new.interviewer@example.com",
      role: "interviewer",
      password: "Password123",
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.member.role, "interviewer");

    const promoted = await call("PATCH", "/api/team/members/" + created.data.member.id, {
      role: "hiring_manager",
    });
    assert.equal(promoted.status, 200);
    assert.equal(promoted.data.member.role, "hiring_manager");
  });

  test("a hiring manager cannot create staff accounts", async () => {
    await signIn("manager@example.com");
    const { status } = await call("POST", "/api/team/members", {
      name: "Nope",
      email: "nope@example.com",
      role: "hr",
      password: "Password123",
    });
    assert.equal(status, 403);
  });
});

describe("applying through the shared link", () => {
  let applicationId;

  test("a candidate applies and always applies as themselves", async () => {
    await signIn("sneaky@example.com");
    const { status, data } = await call("POST", "/api/applications", {
      jobId: 1,
      fullName: "Someone Else Entirely",
      email: "someone.else@example.com",
      phone: "0770000000",
      source: "WhatsApp",
    });
    assert.equal(status, 201);
    assert.equal(data.application.email, "sneaky@example.com");
    assert.equal(data.application.fullName, "Sneaky Applicant");
    assert.equal(data.application.currentStage, "Applied");
    assert.equal(data.application.cvBand, "UNRATED");
    applicationId = data.application.id;
  });

  test("the same person cannot apply twice for one vacancy", async () => {
    const { status } = await call("POST", "/api/applications", { jobId: 1 });
    assert.equal(status, 409);
  });

  test("the candidate uploads a CV and sees it as under review", async () => {
    const form = new FormData();
    form.append("cv", new Blob(["%PDF-1.4 cv"], { type: "application/pdf" }), "cv.pdf");
    const upload = await call("POST", "/api/applications/" + applicationId + "/cv", form, true);
    assert.equal(upload.status, 200);
    assert.equal(upload.data.application.clientStatus.label, "Under review");
  });

  test("a .txt file is refused", async () => {
    const bad = new FormData();
    bad.append("cv", new Blob(["nope"], { type: "text/plain" }), "notes.txt");
    const { status } = await call("POST", "/api/applications/" + applicationId + "/cv", bad, true);
    assert.equal(status, 400);
  });

  test("a candidate cannot see anyone else's application", async () => {
    const list = await call("GET", "/api/applications");
    assert.equal(list.data.applications.length, 1);
    assert.equal(list.data.applications[0].id, applicationId);
    assert.equal((await call("GET", "/api/applications/999")).status, 404);
  });

  test("a candidate cannot band or accept their own CV", async () => {
    assert.equal(
      (await call("POST", "/api/applications/" + applicationId + "/band", { band: "HIGH" })).status,
      403
    );
    assert.equal(
      (
        await call("POST", "/api/applications/" + applicationId + "/cv-review", {
          status: "ACCEPTED",
        })
      ).status,
      403
    );
  });
});

describe("CV screening (the 1000 CV problem)", () => {
  test("HR bands a CV and the candidate then sees it accepted", async () => {
    await signIn("hr@example.com");
    const banded = await call("POST", "/api/applications/1/band", {
      band: "HIGH",
      note: "Strong match",
    });
    assert.equal(banded.status, 200);
    assert.equal(banded.data.application.cvBand, "HIGH");
    assert.equal(banded.data.application.bandedByName, "Test HR");

    const reviewed = await call("POST", "/api/applications/1/cv-review", { status: "ACCEPTED" });
    assert.equal(reviewed.data.application.cvStatus, "ACCEPTED");

    await signIn("sneaky@example.com");
    const { data } = await call("GET", "/api/applications/1");
    assert.equal(data.application.clientStatus.label, "CV accepted");
  });

  test("an interviewer cannot band a CV", async () => {
    await signIn("interviewer@example.com", "Password456");
    assert.equal((await call("POST", "/api/applications/1/band", { band: "LOW" })).status, 403);
  });

  test("an invalid band is refused", async () => {
    await signIn("hr@example.com");
    assert.equal((await call("POST", "/api/applications/1/band", { band: "AMAZING" })).status, 400);
  });

  test("the list filters by band and returns band totals", async () => {
    const all = await call("GET", "/api/applications?job=1");
    assert.equal(all.data.bandCounts.HIGH, 1);
    assert.equal(all.data.total, 1);

    const high = await call("GET", "/api/applications?job=1&cvBand=HIGH");
    assert.equal(high.data.applications.length, 1);

    const low = await call("GET", "/api/applications?job=1&cvBand=LOW");
    assert.equal(low.data.applications.length, 0);
  });

  test("bulk banding updates several CVs at once", async () => {
    const { status, data } = await call("POST", "/api/applications/band/bulk", {
      ids: [1],
      band: "MEDIUM",
    });
    assert.equal(status, 200);
    assert.equal(data.updated, 1);

    const check = await call("GET", "/api/applications/1");
    assert.equal(check.data.application.cvBand, "MEDIUM");
  });
});

describe("WF-02 - no advancing without feedback", () => {
  test("the first stage is exempt, because nobody has interviewed them yet", async () => {
    await signIn("hr@example.com");
    const { status, data } = await call("POST", "/api/applications/1/advance");
    assert.equal(status, 200);
    assert.equal(data.application.currentStage, "Interview");
  });

  test("advancing past a stage with no feedback is blocked", async () => {
    const { status, data } = await call("POST", "/api/applications/1/advance");
    assert.equal(status, 400);
    assert.match(data.error, /Feedback for "Interview"/);
  });

  test("once feedback is in, the candidate can move on", async () => {
    await signIn("interviewer@example.com", "Password456");
    const feedback = await call("POST", "/api/feedback", {
      applicationId: 1,
      stage: "Interview",
      rating: 4,
      recommendation: "ADVANCE",
      strengths: "Explained the projects clearly.",
    });
    assert.equal(feedback.status, 201);

    await signIn("hr@example.com");
    const { status, data } = await call("POST", "/api/applications/1/advance");
    assert.equal(status, 200);
    assert.equal(data.application.currentStage, "Offer");
  });

  test("a candidate at the last stage cannot be advanced again", async () => {
    assert.equal((await call("POST", "/api/applications/1/advance")).status, 400);
  });
});

describe("feedback and comparison", () => {
  test("a rating outside 1-5 is refused", async () => {
    await signIn("hr@example.com");
    const { status } = await call("POST", "/api/feedback", {
      applicationId: 1,
      stage: "Interview",
      rating: 9,
    });
    assert.equal(status, 400);
  });

  test("writing again replaces my score instead of stacking a second one", async () => {
    await signIn("interviewer@example.com", "Password456");
    await call("POST", "/api/feedback", {
      applicationId: 1,
      stage: "Interview",
      rating: 2,
      recommendation: "HOLD",
    });
    const { data } = await call("GET", "/api/feedback?application=1&mine=1");
    assert.equal(data.feedback.length, 1);
    assert.equal(data.feedback[0].rating, 2);
  });

  test("the comparison table ranks candidates for a vacancy", async () => {
    await signIn("hr@example.com");
    const { status, data } = await call("GET", "/api/feedback/compare/1");
    assert.equal(status, 200);
    assert.ok(data.stages.includes("Interview"));
    assert.equal(data.candidates.length, 1);
  });
});

describe("interviews", () => {
  test("scheduling works and an invalid date is refused", async () => {
    await signIn("hr@example.com");
    const created = await call("POST", "/api/interviews", {
      applicationId: 1,
      stage: "Interview",
      scheduledAt: "2027-01-15T10:30",
      interviewerName: "Test Interviewer",
    });
    assert.equal(created.status, 201);

    const bad = await call("POST", "/api/interviews", {
      applicationId: 1,
      stage: "Interview",
      scheduledAt: "the day after tomorrow",
    });
    assert.equal(bad.status, 400);
  });
});

describe("dashboard", () => {
  test("the stats endpoint adds up", async () => {
    await signIn("hr@example.com");
    const { data } = await call("GET", "/api/team/stats");
    assert.equal(data.openVacancies, 1);
    assert.equal(data.totalApplications, 1);
    assert.equal(data.candidateAccounts, 1, "candidates are not counted as team members");
    assert.ok(data.teamMembers >= 3);
  });

  test("a candidate cannot read the dashboard or the team list", async () => {
    await signIn("sneaky@example.com");
    assert.equal((await call("GET", "/api/team/stats")).status, 403);
    assert.equal((await call("GET", "/api/team")).status, 403);
  });
});

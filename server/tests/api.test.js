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

before(async () => {
  const app = createApp({ log: false });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = "http://127.0.0.1:" + server.address().port;
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

  test("creates an account and signs the user in", async () => {
    const { status, data } = await call("POST", "/api/auth/signup", {
      name: "Test Recruiter",
      email: "recruiter@example.com",
      password: "Password123",
      role: "developer",
    });
    assert.equal(status, 201);
    assert.equal(data.user.email, "recruiter@example.com");
    assert.ok(cookie.startsWith("hiretrack_token="), "a login cookie is set");
  });

  test("refuses a duplicate email", async () => {
    const { status } = await call("POST", "/api/auth/signup", {
      name: "Copy Cat",
      email: "recruiter@example.com",
      password: "Password123",
    });
    assert.equal(status, 409);
  });

  test("/me returns the signed-in user", async () => {
    const { data } = await call("GET", "/api/auth/me");
    assert.equal(data.user.email, "recruiter@example.com");
  });

  test("a wrong password is rejected", async () => {
    const saved = cookie;
    cookie = "";
    const { status } = await call("POST", "/api/auth/signin", {
      email: "recruiter@example.com",
      password: "WrongPassword1",
    });
    assert.equal(status, 401);
    cookie = saved;
  });

  test("forgot password never reveals whether an email exists", async () => {
    const known = await call("POST", "/api/auth/forgot-password", {
      email: "recruiter@example.com",
    });
    const unknown = await call("POST", "/api/auth/forgot-password", {
      email: "nobody@example.com",
    });
    assert.equal(known.status, 200);
    assert.equal(unknown.status, 200);
    assert.equal(known.data.message, unknown.data.message);
  });

  test("a reset token works once and only once", async () => {
    const { data } = await call("POST", "/api/auth/forgot-password", {
      email: "recruiter@example.com",
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

    // Sign back in with the new password for the rest of the suite.
    const signIn = await call("POST", "/api/auth/signin", {
      email: "recruiter@example.com",
      password: "Password456",
    });
    assert.equal(signIn.status, 200);
  });
});

describe("vacancies", () => {
  test("a signed-out visitor cannot create a vacancy", async () => {
    const saved = cookie;
    cookie = "";
    const { status } = await call("POST", "/api/jobs", { title: "Sneaky Job" });
    assert.equal(status, 401);
    cookie = saved;
  });

  test("creates a vacancy with its interview stages", async () => {
    const { status, data } = await call("POST", "/api/jobs", {
      title: "Junior Developer",
      department: "Engineering",
      location: "Colombo",
      stages: ["Applied", "Interview", "Offer"],
    });
    assert.equal(status, 201);
    assert.deepEqual(data.job.stages, ["Applied", "Interview", "Offer"]);
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

describe("applications", () => {
  let applicationId;

  test("a candidate can apply and starts at the first stage", async () => {
    const { status, data } = await call("POST", "/api/applications", {
      jobId: 1,
      fullName: "Maya Fernando",
      email: "maya@example.com",
      phone: "0771234567",
    });
    assert.equal(status, 201);
    assert.equal(data.application.currentStage, "Applied");
    applicationId = data.application.id;
  });

  test("the same email cannot apply twice for one vacancy", async () => {
    const { status } = await call("POST", "/api/applications", {
      jobId: 1,
      fullName: "Maya Again",
      email: "maya@example.com",
    });
    assert.equal(status, 409);
  });

  test("moving forward follows the vacancy's pipeline", async () => {
    const first = await call("POST", "/api/applications/" + applicationId + "/advance");
    assert.equal(first.data.application.currentStage, "Interview");

    const second = await call("POST", "/api/applications/" + applicationId + "/advance");
    assert.equal(second.data.application.currentStage, "Offer");

    // "Offer" is the last stage, so a third move must be refused.
    const third = await call("POST", "/api/applications/" + applicationId + "/advance");
    assert.equal(third.status, 400);
  });

  test("a stage outside the pipeline is rejected", async () => {
    const { status } = await call("PATCH", "/api/applications/" + applicationId, {
      currentStage: "Made Up Stage",
    });
    assert.equal(status, 400);
  });

  test("the outcome is stored separately from the stage", async () => {
    const { data } = await call("PATCH", "/api/applications/" + applicationId, {
      outcome: "ON_HOLD",
    });
    assert.equal(data.application.outcome, "ON_HOLD");
    assert.equal(data.application.currentStage, "Offer");
  });

  test("uploads a CV and refuses the wrong file type", async () => {
    const good = new FormData();
    good.append("cv", new Blob(["%PDF-1.4 test"], { type: "application/pdf" }), "cv.pdf");
    const upload = await call("POST", "/api/applications/" + applicationId + "/cv", good, true);
    assert.equal(upload.status, 200);
    assert.equal(upload.data.application.cv.filename, "cv.pdf");

    const bad = new FormData();
    bad.append("cv", new Blob(["not a cv"], { type: "text/plain" }), "notes.txt");
    const rejected = await call("POST", "/api/applications/" + applicationId + "/cv", bad, true);
    assert.equal(rejected.status, 400);
  });

  test("the CV can be downloaded again", async () => {
    const response = await fetch(baseUrl + "/api/applications/" + applicationId + "/cv", {
      headers: { Cookie: cookie },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-disposition") || "", /cv\.pdf/);
  });

  test("a stage still in use cannot be deleted from the vacancy", async () => {
    const { status } = await call("PATCH", "/api/jobs/1", {
      stages: ["Applied", "Interview"], // "Offer" is where the candidate sits
    });
    assert.equal(status, 400);
  });

  test("a vacancy with applications cannot be deleted", async () => {
    const { status } = await call("DELETE", "/api/jobs/1");
    assert.equal(status, 400);
  });

  test("invalid ids return a clear 400, not a crash", async () => {
    const { status } = await call("GET", "/api/applications/not-a-number");
    assert.equal(status, 400);
  });
});

describe("interviews", () => {
  test("schedules an interview and lists it", async () => {
    const created = await call("POST", "/api/interviews", {
      applicationId: 1,
      stage: "Interview",
      scheduledAt: "2027-01-15T10:30",
      interviewerName: "Ahmed",
    });
    assert.equal(created.status, 201);

    const list = await call("GET", "/api/interviews?application=1");
    assert.equal(list.data.interviews.length, 1);
  });

  test("an invalid date is rejected", async () => {
    const { status } = await call("POST", "/api/interviews", {
      applicationId: 1,
      stage: "Interview",
      scheduledAt: "the day after tomorrow",
    });
    assert.equal(status, 400);
  });
});

describe("interviewer feedback and comparison (Scenario 1)", () => {
  test("an interviewer can score a candidate at a stage", async () => {
    const { status, data } = await call("POST", "/api/feedback", {
      applicationId: 1,
      stage: "Interview",
      rating: 4,
      recommendation: "ADVANCE",
      strengths: "Explained her projects clearly.",
      comment: "Move to the next round.",
    });
    assert.equal(status, 201);
    assert.equal(data.feedback.rating, 4);
  });

  test("a rating outside 1-5 is refused", async () => {
    const { status } = await call("POST", "/api/feedback", {
      applicationId: 1,
      stage: "Interview",
      rating: 9,
    });
    assert.equal(status, 400);
  });

  test("writing again replaces my score instead of stacking a second one", async () => {
    await call("POST", "/api/feedback", {
      applicationId: 1,
      stage: "Interview",
      rating: 2,
      recommendation: "HOLD",
    });
    const { data } = await call("GET", "/api/feedback?application=1");
    assert.equal(data.feedback.length, 1, "still one entry for this stage");
    assert.equal(data.feedback[0].rating, 2, "and it is the newer score");
  });

  test("the comparison table ranks candidates for a vacancy", async () => {
    const { status, data } = await call("GET", "/api/feedback/compare/1");
    assert.equal(status, 200);
    assert.ok(data.stages.includes("Interview"));
    const maya = data.candidates.find((candidate) => candidate.id === 1);
    assert.equal(maya.averageRating, 2);
    assert.equal(maya.votes.hold, 1);
  });
});

describe("clients can only see their own application", () => {
  let clientCookie = "";
  let staffCookie = "";
  let clientApplicationId;

  test("a client signs up and applies", async () => {
    staffCookie = cookie;
    cookie = "";

    const signUp = await call("POST", "/api/auth/signup", {
      name: "Nimal Perera",
      email: "nimal@example.com",
      password: "Password123",
      role: "client",
    });
    assert.equal(signUp.status, 201);
    assert.equal(signUp.data.user.role, "client");
    assert.equal(signUp.data.user.isStaff, false);
    clientCookie = cookie;

    const applied = await call("POST", "/api/applications", {
      jobId: 1,
      fullName: "Someone Else Entirely",
      email: "someone.else@example.com",
      phone: "0770000000",
    });
    assert.equal(applied.status, 201);
    // The client always applies as themselves, whatever they typed.
    assert.equal(applied.data.application.email, "nimal@example.com");
    assert.equal(applied.data.application.fullName, "Nimal Perera");
    clientApplicationId = applied.data.application.id;
  });

  test("a client cannot create or delete a vacancy", async () => {
    assert.equal((await call("POST", "/api/jobs", { title: "Sneaky" })).status, 403);
    assert.equal((await call("DELETE", "/api/jobs/1")).status, 403);
  });

  test("a client cannot see the team list, the stats or the interviews", async () => {
    assert.equal((await call("GET", "/api/team")).status, 403);
    assert.equal((await call("GET", "/api/team/stats")).status, 403);
    assert.equal((await call("GET", "/api/interviews")).status, 403);
    assert.equal((await call("GET", "/api/feedback?application=1")).status, 403);
  });

  test("a client's list only ever contains their own application", async () => {
    const { data } = await call("GET", "/api/applications");
    assert.equal(data.applications.length, 1);
    assert.equal(data.applications[0].id, clientApplicationId);
  });

  test("a client cannot open somebody else's application", async () => {
    const { status } = await call("GET", "/api/applications/1");
    assert.equal(status, 404, "404, not 403 - they cannot even confirm it exists");
  });

  test("a client cannot download somebody else's CV", async () => {
    assert.equal((await call("GET", "/api/applications/1/cv")).status, 404);
  });

  test("a client cannot move themselves along the pipeline", async () => {
    assert.equal(
      (await call("POST", "/api/applications/" + clientApplicationId + "/advance")).status,
      403
    );
    const patched = await call("PATCH", "/api/applications/" + clientApplicationId, {
      outcome: "HIRED",
      notes: "hire me",
    });
    // The allowed fields are ignored, so nothing is left to update.
    assert.equal(patched.status, 400);
  });

  test("a client uploads a CV and sees it as under review", async () => {
    const form = new FormData();
    form.append("cv", new Blob(["%PDF-1.4 client cv"], { type: "application/pdf" }), "nimal.pdf");
    const upload = await call(
      "POST",
      "/api/applications/" + clientApplicationId + "/cv",
      form,
      true
    );
    assert.equal(upload.status, 200);
    assert.equal(upload.data.application.cvStatus, "PENDING");
    assert.equal(upload.data.application.clientStatus.key, "PENDING");
    assert.equal(upload.data.application.clientStatus.label, "Under review");
  });

  test("a client cannot accept their own CV", async () => {
    const { status } = await call(
      "POST",
      "/api/applications/" + clientApplicationId + "/cv-review",
      { status: "ACCEPTED" }
    );
    assert.equal(status, 403);
  });

  test("staff accept the CV and the client sees the new status", async () => {
    cookie = staffCookie;
    const review = await call(
      "POST",
      "/api/applications/" + clientApplicationId + "/cv-review",
      { status: "ACCEPTED" }
    );
    assert.equal(review.status, 200);
    assert.equal(review.data.application.cvStatus, "ACCEPTED");

    cookie = clientCookie;
    const { data } = await call("GET", "/api/applications/" + clientApplicationId);
    assert.equal(data.application.clientStatus.key, "ACCEPTED");
    assert.equal(data.application.clientStatus.label, "CV accepted");
    // Internal information is stripped out of a client's copy.
    assert.equal(data.application.notes, undefined);
    assert.equal(data.application.currentStage, undefined);
    assert.equal(data.feedback.length, 0);
  });

  test("rejecting the CV rejects the application too", async () => {
    cookie = staffCookie;
    await call("POST", "/api/applications/" + clientApplicationId + "/cv-review", {
      status: "REJECTED",
    });

    cookie = clientCookie;
    const { data } = await call("GET", "/api/applications/" + clientApplicationId);
    assert.equal(data.application.clientStatus.key, "REJECTED");
    assert.equal(data.application.clientStatus.label, "Not successful");

    cookie = staffCookie;
  });
});

describe("team and access level", () => {
  test("every team role can reach the same endpoints", async () => {
    // Sign up as QA - a different role - and repeat a developer action.
    cookie = "";
    await call("POST", "/api/auth/signup", {
      name: "QA Person",
      email: "qa@example.com",
      password: "Password123",
      role: "qa",
    });

    const created = await call("POST", "/api/jobs", { title: "Created by QA" });
    assert.equal(created.status, 201, "QA can create a vacancy, same as the developer");

    const candidates = await call("GET", "/api/applications");
    assert.equal(candidates.status, 200, "QA can see every candidate");

    const team = await call("GET", "/api/team");
    assert.equal(team.status, 200, "QA can see the team page");
  });

  test("the stats endpoint adds up", async () => {
    const { data } = await call("GET", "/api/team/stats");
    assert.equal(data.openVacancies, 2);
    assert.equal(data.totalApplications, 2);
    assert.equal(data.teamMembers, 2, "the client is not counted as a team member");
    assert.equal(data.clients, 1);
  });
});

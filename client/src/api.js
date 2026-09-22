/**
 * One small wrapper around fetch() so every screen talks to the API the
 * same way: JSON in, JSON out, cookies included, and errors thrown as a
 * normal Error with the message the server sent back.
 */

async function request(path, { method = "GET", body, isForm = false } = {}) {
  const options = {
    method,
    credentials: "include", // send the httpOnly login cookie
    headers: {},
  };

  if (body !== undefined) {
    if (isForm) {
      options.body = body; // FormData sets its own Content-Type
    } else {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }
  }

  const response = await fetch("/api" + path, options);

  // 204 and empty bodies would break response.json()
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const error = new Error(data.error || "Request failed (" + response.status + ")");
    error.status = response.status;
    throw error;
  }
  return data;
}

export const api = {
  // auth
  config: () => request("/auth/config"),
  me: () => request("/auth/me"),
  signIn: (body) => request("/auth/signin", { method: "POST", body }),
  signOut: () => request("/auth/signout", { method: "POST" }),
  forgotPassword: (body) => request("/auth/forgot-password", { method: "POST", body }),
  resetPassword: (body) => request("/auth/reset-password", { method: "POST", body }),
  changePassword: (body) => request("/auth/change-password", { method: "POST", body }),

  // vacancies (open positions)
  listJobs: (params = {}) => request("/jobs" + query(params)),
  getJob: (id) => request("/jobs/" + id),
  createJob: (body) => request("/jobs", { method: "POST", body }),
  updateJob: (id, body) => request("/jobs/" + id, { method: "PATCH", body }),
  deleteJob: (id) => request("/jobs/" + id, { method: "DELETE" }),

  // candidates
  listCandidates: (params = {}) => request("/candidates" + query(params)),
  getCandidate: (id) => request("/candidates/" + id),
  addCandidate: (body) => request("/candidates", { method: "POST", body }),
  updateCandidate: (id, body) => request("/candidates/" + id, { method: "PATCH", body }),
  // Pass null to hand the candidate back to the unassigned pool.
  assignInterviewer: (id, interviewerId) =>
    request("/candidates/" + id + "/assign", {
      method: "POST",
      body: { interviewerId: interviewerId || null },
    }),
  bandCv: (id, band, note) =>
    request("/candidates/" + id + "/band", { method: "POST", body: { band, note } }),
  bandCvBulk: (ids, band) =>
    request("/candidates/band/bulk", { method: "POST", body: { ids, band } }),
  uploadCv: (id, file) => {
    const form = new FormData();
    form.append("cv", file);
    return request("/candidates/" + id + "/cv", { method: "POST", body: form, isForm: true });
  },
  deleteCv: (id) => request("/candidates/" + id + "/cv", { method: "DELETE" }),
  deleteCandidate: (id) => request("/candidates/" + id, { method: "DELETE" }),
  cvDownloadUrl: (id) => "/api/candidates/" + id + "/cv",

  // interviews
  listInterviews: (params = {}) => request("/interviews" + query(params)),
  scheduleInterview: (body) => request("/interviews", { method: "POST", body }),
  cancelInterview: (id) => request("/interviews/" + id, { method: "DELETE" }),
  // The interviewer answers a booking: ACCEPTED or DECLINED.
  respondToInterview: (id, response, note) =>
    request("/interviews/" + id + "/respond", { method: "POST", body: { response, note } }),

  // answering an interview invitation from the email link (no sign-in)
  getInvite: (token) => request("/invites/" + encodeURIComponent(token)),
  respondToInvite: (token, response, note) =>
    request("/invites/" + encodeURIComponent(token) + "/respond", {
      method: "POST",
      body: { response, note },
    }),

  // interviewer feedback and side-by-side comparison
  listFeedback: (params = {}) => request("/feedback" + query(params)),
  leaveFeedback: (body) => request("/feedback", { method: "POST", body }),
  deleteFeedback: (id) => request("/feedback/" + id, { method: "DELETE" }),
  compare: (jobId) => request("/feedback/compare/" + jobId),

  // how people are told about interviews
  notifications: () => request("/notifications"),
  markNotificationRead: (id) => request("/notifications/" + id + "/read", { method: "POST" }),
  markAllNotificationsRead: () => request("/notifications/read-all", { method: "POST" }),
  outbox: (params = {}) => request("/notifications/outbox" + query(params)),
  markEmailSent: (id) => request("/notifications/outbox/" + id + "/sent", { method: "POST" }),
  // Really send it, when a mail server is configured.
  sendEmailNow: (id) => request("/notifications/outbox/" + id + "/send", { method: "POST" }),

  // reports for management
  reports: () => request("/reports"),
  reportCsvUrl: (report) => "/api/reports/export.csv?report=" + encodeURIComponent(report),
  // RPT-02. CSV is for working with the numbers; PDF is for sending them
  // to somebody who will only read them.
  reportPdfUrl: (report) => "/api/reports/export.pdf?report=" + encodeURIComponent(report),

  // AUD-01 - management only.
  auditLog: (params = {}) => request("/team/audit?" + new URLSearchParams(params).toString()),
  auditCsvUrl: () => "/api/team/audit.csv",

  // people
  team: () => request("/team"),
  interviewers: () => request("/team/interviewers"),
  stats: () => request("/team/stats"),
  updateProfile: (body) => request("/team/me", { method: "PATCH", body }),
  addMember: (body) => request("/team/members", { method: "POST", body }),
  updateMember: (id, body) => request("/team/members/" + id, { method: "PATCH", body }),
};

function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, value);
  }
  const string = search.toString();
  return string ? "?" + string : "";
}

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
  signUp: (body) => request("/auth/signup", { method: "POST", body }),
  signOut: () => request("/auth/signout", { method: "POST" }),
  forgotPassword: (body) => request("/auth/forgot-password", { method: "POST", body }),
  resetPassword: (body) => request("/auth/reset-password", { method: "POST", body }),
  changePassword: (body) => request("/auth/change-password", { method: "POST", body }),

  // vacancies
  listJobs: (params = {}) => request("/jobs" + query(params)),
  getJob: (id) => request("/jobs/" + id),
  createJob: (body) => request("/jobs", { method: "POST", body }),
  updateJob: (id, body) => request("/jobs/" + id, { method: "PATCH", body }),
  deleteJob: (id) => request("/jobs/" + id, { method: "DELETE" }),

  // applications / candidates
  listApplications: (params = {}) => request("/applications" + query(params)),
  getApplication: (id) => request("/applications/" + id),
  apply: (body) => request("/applications", { method: "POST", body }),
  updateApplication: (id, body) => request("/applications/" + id, { method: "PATCH", body }),
  advanceApplication: (id) => request("/applications/" + id + "/advance", { method: "POST" }),
  uploadCv: (id, file) => {
    const form = new FormData();
    form.append("cv", file);
    return request("/applications/" + id + "/cv", { method: "POST", body: form, isForm: true });
  },
  deleteCv: (id) => request("/applications/" + id + "/cv", { method: "DELETE" }),
  deleteApplication: (id) => request("/applications/" + id, { method: "DELETE" }),
  cvDownloadUrl: (id) => "/api/applications/" + id + "/cv",

  // interviews
  listInterviews: (params = {}) => request("/interviews" + query(params)),
  scheduleInterview: (body) => request("/interviews", { method: "POST", body }),
  cancelInterview: (id) => request("/interviews/" + id, { method: "DELETE" }),

  // team
  team: () => request("/team"),
  stats: () => request("/team/stats"),
  updateProfile: (body) => request("/team/me", { method: "PATCH", body }),
};

function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, value);
  }
  const string = search.toString();
  return string ? "?" + string : "";
}

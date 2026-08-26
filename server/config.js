import "dotenv/config";

const isProduction = process.env.NODE_ENV === "production";

// A hard-coded fallback keeps `npm run dev` working straight after cloning,
// but a real secret is required before anyone deploys this.
const DEV_SECRET = "hiretrack-dev-secret-do-not-use-in-production";

if (isProduction && (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEV_SECRET)) {
  throw new Error("JWT_SECRET must be set to a real random value in production.");
}

if (!process.env.JWT_SECRET) {
  console.warn(
    "[config] JWT_SECRET is not set - using an insecure development secret.\n" +
      "         Copy .env.example to .env and set your own value."
  );
}

export const config = {
  isProduction,
  port: Number(process.env.PORT) || 4000,
  jwtSecret: process.env.JWT_SECRET || DEV_SECRET,
  jwtExpiresIn: Number(process.env.JWT_EXPIRES_IN) || 60 * 60 * 24 * 7, // 7 days
  clientUrl: process.env.CLIENT_URL || "http://localhost:5173",
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    redirectUri:
      process.env.GOOGLE_REDIRECT_URI || "http://localhost:4000/api/auth/google/callback",
    get enabled() {
      return Boolean(this.clientId && this.clientSecret);
    },
  },
  upload: {
    maxBytes: 5 * 1024 * 1024, // 5 MB
    allowedMime: [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    allowedExt: [".pdf", ".doc", ".docx"],
  },
  // WF-02 from the project plan: a candidate cannot be advanced until
  // feedback for their current stage has been submitted. Set
  // REQUIRE_FEEDBACK_TO_ADVANCE=false in .env to switch the gate off.
  requireFeedbackToAdvance: process.env.REQUIRE_FEEDBACK_TO_ADVANCE !== "false",
};

// =====================================================================
// Roles. These match the personas in the project plan and they carry
// genuinely different permissions - HR can do everything, a hiring
// manager slightly less, an interviewer less again.
// =====================================================================
export const ROLE_HR = "hr";
export const ROLE_HIRING_MANAGER = "hiring_manager";
export const ROLE_INTERVIEWER = "interviewer";
export const ROLE_CANDIDATE = "candidate";

export const STAFF_ROLES = [ROLE_HR, ROLE_HIRING_MANAGER, ROLE_INTERVIEWER];
export const ALL_ROLES = [...STAFF_ROLES, ROLE_CANDIDATE];

export const ROLE_LABELS = {
  hr: "HR Recruiter",
  hiring_manager: "Hiring Manager",
  interviewer: "Interviewer",
  candidate: "Candidate",
};

export const ROLE_DESCRIPTIONS = {
  hr: "Full access. Opens vacancies, shares the job link, screens CVs, runs the whole pipeline.",
  hiring_manager:
    "Works with candidates: bands CVs, moves stages, records outcomes, compares candidates and leaves feedback. Cannot create or close a vacancy.",
  interviewer:
    "Sees candidates and their CVs, and leaves interview feedback at a stage. Cannot change stages, outcomes or CV bands.",
  candidate: "Applies through a shared job link and follows their own application only.",
};

/**
 * One place that answers "is this person allowed to do this?". Every
 * route asks this rather than checking role strings of its own, so the
 * rules cannot drift apart.
 */
export const PERMISSIONS = {
  // Vacancies - only HR runs the requisition process.
  "vacancy:create": [ROLE_HR],
  "vacancy:edit": [ROLE_HR],
  "vacancy:close": [ROLE_HR],
  "vacancy:delete": [ROLE_HR],
  "vacancy:share": [ROLE_HR],

  // Candidates.
  "candidate:viewAll": [ROLE_HR, ROLE_HIRING_MANAGER, ROLE_INTERVIEWER],
  "candidate:create": [ROLE_HR],
  "candidate:edit": [ROLE_HR, ROLE_HIRING_MANAGER],
  "candidate:delete": [ROLE_HR],
  "candidate:band": [ROLE_HR, ROLE_HIRING_MANAGER],
  "candidate:reviewCv": [ROLE_HR, ROLE_HIRING_MANAGER],
  "candidate:advance": [ROLE_HR, ROLE_HIRING_MANAGER],
  "candidate:outcome": [ROLE_HR, ROLE_HIRING_MANAGER],

  // Interviews and feedback.
  "interview:schedule": [ROLE_HR, ROLE_HIRING_MANAGER],
  "interview:viewAll": [ROLE_HR, ROLE_HIRING_MANAGER, ROLE_INTERVIEWER],
  "feedback:write": [ROLE_HR, ROLE_HIRING_MANAGER, ROLE_INTERVIEWER],
  "feedback:viewAll": [ROLE_HR, ROLE_HIRING_MANAGER, ROLE_INTERVIEWER],
  "candidate:compare": [ROLE_HR, ROLE_HIRING_MANAGER],

  // People and reporting.
  "team:view": [ROLE_HR, ROLE_HIRING_MANAGER, ROLE_INTERVIEWER],
  "stats:view": [ROLE_HR, ROLE_HIRING_MANAGER, ROLE_INTERVIEWER],
};

export const isStaff = (user) => Boolean(user) && STAFF_ROLES.includes(user.role);

export function can(user, permission) {
  if (!user) return false;
  const allowed = PERMISSIONS[permission];
  if (!allowed) throw new Error("Unknown permission: " + permission);
  return allowed.includes(user.role);
}

/** The whole permission map for one role - the front end uses this to
 *  decide which buttons and menu items to render. */
export function permissionsFor(user) {
  const out = {};
  for (const key of Object.keys(PERMISSIONS)) out[key] = can(user, key);
  return out;
}

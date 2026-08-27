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

  // Supabase PostgreSQL. Project Settings -> Database -> Connection
  // string -> URI, then paste it into .env as DATABASE_URL.
  databaseUrl: process.env.DATABASE_URL || "",
  // Supabase always uses TLS. Set DATABASE_SSL=false only if you point
  // this at a plain local PostgreSQL server.
  databaseSsl: process.env.DATABASE_SSL !== "false",
  logSlowQueries: process.env.LOG_SLOW_QUERIES === "true",
  jwtSecret: process.env.JWT_SECRET || DEV_SECRET,
  jwtExpiresIn: Number(process.env.JWT_EXPIRES_IN) || 60 * 60 * 24 * 7, // 7 days
  clientUrl: process.env.CLIENT_URL || "http://localhost:5173",
  companyName: process.env.COMPANY_NAME || "Altrium",
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    redirectUri:
      process.env.GOOGLE_REDIRECT_URI || "http://localhost:4000/api/auth/google/callback",
    get enabled() {
      return Boolean(this.clientId && this.clientSecret);
    },
  },
  // Resend (https://resend.com) - an HTTP email API, no SMTP server
  // needed. Takes precedence over SMTP when both are set.
  //
  // On a free account with no verified domain, Resend will ONLY deliver
  // to the address that owns the account. Everything else comes back
  // 403. That refusal is recorded against the outbox row so HR can see
  // why a candidate never heard from us, rather than it vanishing.
  resend: {
    apiKey: process.env.RESEND_API_KEY || "",
    from: process.env.RESEND_FROM_EMAIL || "",
    get enabled() {
      return Boolean(this.apiKey && this.from);
    },
  },

  // Real email. Leave SMTP_HOST blank and nothing is sent - every
  // message still lands in the outbox for a person to send by hand,
  // which is how this project worked before mail was wired up.
  smtp: {
    host: process.env.SMTP_HOST || "",
    port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from:
      process.env.MAIL_FROM ||
      '"' + (process.env.COMPANY_NAME || "Altrium") + '" <' + (process.env.SMTP_USER || "") + ">",
    get enabled() {
      return Boolean(this.host && this.user && this.pass);
    },
  },
  // How long the accept/decline link in an interview email stays valid.
  inviteExpiresIn: Number(process.env.INVITE_EXPIRES_IN) || 60 * 60 * 24 * 30, // 30 days

  // Where candidate CVs are stored. With these set, uploads go to a
  // private Supabase Storage bucket; without them, to server/uploads as
  // before. The service role key bypasses row-level security, so it is
  // read on the server only and never reaches the browser.
  storage: {
    url: process.env.SUPABASE_URL || "",
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    bucket: process.env.SUPABASE_CV_BUCKET || "candidate-cvs",
    get enabled() {
      return Boolean(this.url && this.serviceRoleKey);
    },
  },

  upload: {
    maxBytes: Number(process.env.UPLOAD_MAX_MB || 15) * 1024 * 1024,
    // Any file type. A CV arrives as whatever the candidate happened to
    // send - a PDF, a Word file, an ODT, a scan, a zip of a portfolio -
    // and HR should not have to convert it before it can be filed.
    //
    // Accepting anything is only safe because of how it is served back:
    // always as a download, never rendered in the page. See the note on
    // the download route in candidates.routes.js.
    allowedMime: null,
    allowedExt: null,
  },
  // "Should a candidate be blocked from advancing until the current
  // stage's feedback is in?" - yes. Set this to false in .env to lift it.
  requireFeedbackToAdvance: process.env.REQUIRE_FEEDBACK_TO_ADVANCE !== "false",
};

// =====================================================================
// Who logs in, and what can each role see and do?
//
//   hr             - HR / recruiter. Opens positions, adds candidates,
//                    runs the whole process.
//   hiring_manager - Compares candidates and makes the hire decision.
//                    Does not open or close positions.
//   interviewer    - Leaves feedback at their stage. Sees candidates,
//                    changes nothing about their progress.
//   management     - Oversight. Sees everything, changes nothing,
//                    exports reports.
//
// Candidates are NOT users of this system: HR adds them.
// =====================================================================
export const ROLE_HR = "hr";
export const ROLE_HIRING_MANAGER = "hiring_manager";
export const ROLE_INTERVIEWER = "interviewer";
export const ROLE_MANAGEMENT = "management";

export const ROLES = [ROLE_HR, ROLE_HIRING_MANAGER, ROLE_INTERVIEWER, ROLE_MANAGEMENT];

export const ROLE_LABELS = {
  hr: "HR Recruiter",
  hiring_manager: "Hiring Manager",
  interviewer: "Interviewer",
  management: "Management",
};

export const ROLE_DESCRIPTIONS = {
  hr: "Opens positions, adds candidates, screens CVs, schedules interviews and runs the whole process.",
  hiring_manager:
    "Reviews candidates, compares them side by side, records the hire / reject / on-hold decision. Cannot open or close a position.",
  interviewer:
    "Sees the candidates they are interviewing and leaves structured feedback at their stage. Cannot move anyone forward.",
  management:
    "Oversight only. Sees every position, candidate and score, and exports reports. Changes nothing.",
};

/**
 * One place that answers "is this person allowed to do this?". Every
 * route asks this rather than checking role strings of its own, so the
 * rules cannot drift apart.
 */
export const PERMISSIONS = {
  // Positions
  "position:create": [ROLE_HR],
  "position:edit": [ROLE_HR],
  "position:close": [ROLE_HR],
  "position:delete": [ROLE_HR],
  "position:view": [ROLE_HR, ROLE_HIRING_MANAGER, ROLE_INTERVIEWER, ROLE_MANAGEMENT],

  // Candidates
  "candidate:view": [ROLE_HR, ROLE_HIRING_MANAGER, ROLE_INTERVIEWER, ROLE_MANAGEMENT],
  "candidate:add": [ROLE_HR],
  "candidate:edit": [ROLE_HR],
  "candidate:delete": [ROLE_HR],
  "candidate:uploadCv": [ROLE_HR],
  "candidate:band": [ROLE_HR, ROLE_HIRING_MANAGER],
  "candidate:advance": [ROLE_HR, ROLE_HIRING_MANAGER],
  "candidate:outcome": [ROLE_HR, ROLE_HIRING_MANAGER],
  "candidate:compare": [ROLE_HR, ROLE_HIRING_MANAGER, ROLE_MANAGEMENT],

  // Interviews and feedback
  "interview:schedule": [ROLE_HR, ROLE_HIRING_MANAGER],
  "interview:view": [ROLE_HR, ROLE_HIRING_MANAGER, ROLE_INTERVIEWER, ROLE_MANAGEMENT],
  "feedback:write": [ROLE_HR, ROLE_HIRING_MANAGER, ROLE_INTERVIEWER],
  "feedback:view": [ROLE_HR, ROLE_HIRING_MANAGER, ROLE_INTERVIEWER, ROLE_MANAGEMENT],

  // Notifications outbox (what would be emailed to a candidate)
  "outbox:view": [ROLE_HR, ROLE_HIRING_MANAGER],

  // People and reporting
  "team:view": [ROLE_HR, ROLE_HIRING_MANAGER, ROLE_INTERVIEWER, ROLE_MANAGEMENT],
  "team:manage": [ROLE_HR],
  "report:view": [ROLE_HR, ROLE_HIRING_MANAGER, ROLE_MANAGEMENT],
  "report:export": [ROLE_HR, ROLE_MANAGEMENT],
};

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

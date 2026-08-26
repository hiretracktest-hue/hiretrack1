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
};

// Role is a label only - every team role has identical permissions.
export const TEAM_ROLES = ["developer", "scrum_master", "business_analyst", "qa"];
export const ALL_ROLES = [...TEAM_ROLES, "applicant"];

export const ROLE_LABELS = {
  developer: "Developer",
  scrum_master: "Scrum Master",
  business_analyst: "Business Analyst",
  qa: "QA Engineer",
  applicant: "Applicant",
};

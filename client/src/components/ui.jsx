import { useState } from "react";

/** Small building blocks reused by every page. */

/**
 * One form field. Pass `error` to show what is wrong underneath it -
 * next to the input that caused it, rather than as a banner at the top
 * of the page where it is easy to miss.
 *
 * role="alert" means a screen reader announces the message when it
 * appears, instead of leaving it silent until the field is tabbed to.
 */
export function Field({ label, hint, htmlFor, error, children }) {
  return (
    <div className={"field" + (error ? " field-invalid" : "")}>
      {label && (
        <label className="field-label" htmlFor={htmlFor}>
          {label}
        </label>
      )}
      {children}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="field-hint">{hint}</p>
      )}
    </div>
  );
}

/**
 * `minLength` is opt-in on purpose. When you are CHOOSING a new password we
 * want the browser to enforce 8 characters, but when you are TYPING AN
 * EXISTING one it must accept whatever the account actually has - otherwise
 * an older or seeded password can never be entered.
 */
export function PasswordInput({
  id,
  value,
  onChange,
  placeholder,
  autoComplete,
  required = true,
  minLength,
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-wrap">
      <input
        id={id}
        className="input"
        type={visible ? "text" : "password"}
        value={value}
        onChange={onChange}
        placeholder={placeholder || (minLength ? "At least " + minLength + " characters" : "")}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
      />
      <button
        type="button"
        className="password-toggle"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? "Hide password" : "Show password"}
      >
        {visible ? "Hide" : "Show"}
      </button>
    </div>
  );
}

export function Alert({ kind = "error", children, onDismiss }) {
  if (!children) return null;
  return (
    <div className={"alert alert-" + kind} role={kind === "error" ? "alert" : "status"}>
      <div className="row-between">
        <span>{children}</span>
        {onDismiss && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onDismiss}>
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}

const OUTCOME_STYLE = {
  ACTIVE: "badge-blue",
  ON_HOLD: "badge-amber",
  HIRED: "badge-green",
  REJECTED: "badge-red",
};

export const OUTCOME_LABEL = {
  ACTIVE: "Active",
  ON_HOLD: "On hold",
  HIRED: "Hired",
  REJECTED: "Rejected",
};

export function OutcomeBadge({ outcome }) {
  return (
    <span className={"badge " + (OUTCOME_STYLE[outcome] || "badge-grey")}>
      {OUTCOME_LABEL[outcome] || outcome}
    </span>
  );
}

export function StatusBadge({ status }) {
  return (
    <span className={"badge " + (status === "ACTIVE" ? "badge-green" : "badge-grey")}>
      {status === "ACTIVE" ? "Open" : "Closed"}
    </span>
  );
}

const BAND_STYLE = {
  HIGH: "badge-green",
  MEDIUM: "badge-amber",
  LOW: "badge-red",
  UNRATED: "badge-grey",
};
export const BAND_LABEL = {
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
  UNRATED: "Not screened",
};
export const BANDS = ["HIGH", "MEDIUM", "LOW", "UNRATED"];

/** The screening band HR gives a CV so a big pile can be filtered. */
export function BandBadge({ band }) {
  return (
    <span className={"badge " + (BAND_STYLE[band] || "badge-grey")}>
      {BAND_LABEL[band] || band}
    </span>
  );
}

/** Does this candidate have a CV on file at all? */
export function CvBadge({ hasCv }) {
  return (
    <span className={"badge " + (hasCv ? "badge-blue" : "badge-grey")}>
      {hasCv ? "CV on file" : "No CV"}
    </span>
  );
}

const RECOMMENDATION_STYLE = { ADVANCE: "badge-green", HOLD: "badge-amber", REJECT: "badge-red" };
export const RECOMMENDATION_LABEL = { ADVANCE: "Advance", HOLD: "Hold", REJECT: "Reject" };

export function RecommendationBadge({ value }) {
  return (
    <span className={"badge " + (RECOMMENDATION_STYLE[value] || "badge-grey")}>
      {RECOMMENDATION_LABEL[value] || value}
    </span>
  );
}

/** Rating out of 5, drawn as stars so it reads at a glance. */
export function Stars({ value, max = 5 }) {
  if (value === null || value === undefined) return <span className="muted">—</span>;
  const rounded = Math.round(value);
  return (
    <span title={value + " out of " + max} className="stars">
      {"★".repeat(rounded)}
      <span className="stars-empty">{"★".repeat(max - rounded)}</span>{" "}
      <span className="small muted">{value}</span>
    </span>
  );
}

export function Stat({ label, value }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

export function Loading({ what = "data" }) {
  return <div className="loading">Loading {what}…</div>;
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

/** The vacancy pipeline with the candidate's current stage highlighted. */
export function Pipeline({ stages = [], currentStage }) {
  const currentIndex = stages.indexOf(currentStage);
  return (
    <div className="pipeline">
      {stages.map((stage, index) => (
        <span key={stage} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span
            className={
              "pipeline-step" +
              (index === currentIndex ? " current" : index < currentIndex ? " done" : "")
            }
          >
            {stage}
          </span>
          {index < stages.length - 1 && <span className="pipeline-arrow">›</span>}
        </span>
      ))}
    </div>
  );
}

export function formatDate(value) {
  if (!value) return "—";
  // SQLite stores "YYYY-MM-DD HH:MM:SS" in UTC; make it a real date first.
  const iso = typeof value === "string" && value.includes(" ") ? value.replace(" ", "T") + "Z" : value;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(value) {
  if (!value) return "—";
  const iso = typeof value === "string" && value.includes(" ") ? value.replace(" ", "T") + "Z" : value;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return "—";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

/**
 * A "Join" button when the interview's location is a meeting link.
 *
 * HR types wherever the interview happens into one box, and half the
 * time that is a URL - a Meet room, a Teams link. Printed as text it
 * has to be copied out by hand at the moment somebody is already late.
 *
 * Only the interviewer booked for it gets the button. HR does not need
 * to join, and giving everyone a Join makes the one person who does
 * need it hunt for theirs.
 */
export function JoinButton({ location, mine, size = "btn-sm" }) {
  if (!mine) return null;

  const raw = String(location || "").trim();
  if (!raw) return null;

  // Accept "meet.google.com/abc" as readily as the full URL - that is
  // how people paste them.
  const url = /^https?:\/\//i.test(raw) ? raw : "https://" + raw;
  try {
    // Anything that is not a real address is a room number or a floor,
    // and there is nothing to join.
    const parsed = new URL(url);
    if (!parsed.hostname.includes(".")) return null;
  } catch {
    return null;
  }

  return (
    <a
      className={"btn btn-primary " + size}
      href={url}
      target="_blank"
      rel="noreferrer noopener"
    >
      Join
    </a>
  );
}

/** What a CV has to be. Mirrors config.upload on the server - one rule,
 *  written twice, so the person is told before the upload as well as
 *  after it. The server is still the one that decides. */
export const CV_MAX_BYTES = 5 * 1024 * 1024;
export const CV_ACCEPT = ".pdf,.docx";
export const CV_HINT = "PDF or DOCX · maximum 5 MB.";

/** Says what is wrong with a chosen CV, or null when it is fine. */
export function describeCvProblem(file, { required = true } = {}) {
  if (!file) {
    return required ? "Choose their CV - it is what the shortlist is worked out from." : null;
  }

  const name = file.name || "";
  const dot = name.lastIndexOf(".");
  const ext = dot === -1 ? "" : name.slice(dot).toLowerCase();

  if (!CV_ACCEPT.split(",").includes(ext)) {
    return (
      "Invalid format: " +
      (ext || "a file with no extension") +
      " is not accepted. A CV has to be a PDF or DOCX file."
    );
  }
  if (file.size > CV_MAX_BYTES) {
    return "That file is " + formatBytes(file.size) + ". The limit is 5 MB.";
  }
  return null;
}

/**
 * Says what is wrong with an email address, or null when it is fine.
 *
 * Deliberately mirrors server/validate.js. The server is the one that
 * decides - this exists so the person is told before a round trip, and
 * gets the same wording either way.
 */
export function describeEmailProblem(value, { field = "Email address", required = true } = {}) {
  const raw = typeof value === "string" ? value.trim() : "";

  if (!raw) return required ? field + " is required." : null;
  if (raw.length > 160) return field + " is too long.";
  if (/\s/.test(raw)) return field + " cannot contain spaces.";
  if (!raw.includes("@")) return field + " needs an @ - for example name@example.com";
  if (raw.split("@").length > 2) return field + " can only contain one @.";

  const [local, domain] = raw.split("@");
  if (!local) return field + " is missing the part before the @.";
  if (!domain) return field + " is missing the part after the @ - for example gmail.com";
  if (!domain.includes(".")) return field + " needs a domain ending - for example .com or .lk";
  if (domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) {
    return field + " has a misplaced dot after the @.";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return field + " is not a valid email address.";
  return null;
}

/**
 * Says what is wrong with a date and time that has to be in the future,
 * or null when it is fine. Same three answers as the server: missing,
 * not a real date, or already past.
 */
export function describeFutureDateProblem(value, { field = "Date and time", required = true } = {}) {
  const raw = typeof value === "string" ? value.trim() : "";

  if (!raw) return required ? field + " is missing." : null;

  const when = new Date(raw);
  if (Number.isNaN(when.getTime())) {
    return "That is not a real date. Use the picker to choose one.";
  }
  // A minute of slack, so "now" is not refused by the second it takes
  // to press the button.
  if (when.getTime() < Date.now() - 60000) {
    return "That date is not available - it has already passed. Choose a future date and time.";
  }
  return null;
}

/** Now, in the format a datetime-local input wants for its `min`. */
export function nowForDateInput() {
  const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
  return now.toISOString().slice(0, 16);
}

export function initials(name = "") {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

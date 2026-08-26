import { useState } from "react";

/** Small building blocks reused by every page. */

export function Field({ label, hint, htmlFor, children }) {
  return (
    <div className="field">
      {label && (
        <label className="field-label" htmlFor={htmlFor}>
          {label}
        </label>
      )}
      {children}
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

export function PasswordInput({ id, value, onChange, placeholder, autoComplete, required = true }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-wrap">
      <input
        id={id}
        className="input"
        type={visible ? "text" : "password"}
        value={value}
        onChange={onChange}
        placeholder={placeholder || "At least 8 characters"}
        autoComplete={autoComplete}
        required={required}
        minLength={8}
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

export function initials(name = "") {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

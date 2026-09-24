import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { Alert, Empty, Loading, formatDateTime } from "../components/ui.jsx";

/**
 * AUD-01 - "As an authorised user, I want a system audit log so that
 * security-sensitive actions within HireTrack can be traced back to the
 * user who performed them."
 *
 * Management only. Most of what this records is HR's own work -
 * accounts created, roles changed, candidates deleted - so the people
 * reviewing it are deliberately not the people it describes.
 */

// Plain words for each recorded action. The raw names stay visible on
// hover, because they are what the CSV contains.
const LABEL = {
  "user.signed_in": "Signed in",
  "user.sign_in_failed": "Failed sign-in",
  "user.created": "Account created",
  "user.role_changed": "Role changed",
  "user.deactivated": "Account deactivated",
  "user.reactivated": "Account reactivated",
  "user.password_changed": "Password changed",
  "user.password_reset_requested": "Password reset requested",
  "user.contact_email_changed": "Real email changed",
  "candidate.deleted": "Candidate deleted",
  "job.deleted": "Vacancy deleted",
  "candidate.cv_downloaded": "CV downloaded",
  "audit.exported": "Audit log downloaded",
};

// Which entries deserve a second look. A failed sign-in or a deletion is
// not wrong in itself, but a run of them is what trouble looks like.
const WATCH = new Set([
  "user.sign_in_failed",
  "user.role_changed",
  "user.contact_email_changed",
  "user.deactivated",
  "candidate.deleted",
  "job.deleted",
]);

export default function AuditLog() {
  const [entries, setEntries] = useState([]);
  const [summary, setSummary] = useState(null);
  const [action, setAction] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.auditLog(action ? { action } : {});
      setEntries(result.entries);
      setSummary(result.summary);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [action]);

  useEffect(() => {
    load();
  }, [load]);

  const failedSignIns = summary?.byAction.find((r) => r.action === "user.sign_in_failed")?.total ?? 0;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Audit log</h1>
          <p className="subtitle">
            Security-sensitive actions, and who took them. Newest first.
          </p>
        </div>
        <div className="btn-row">
          <a className="btn btn-primary" href={api.auditCsvUrl()}>
            Download CSV
          </a>
        </div>
      </div>

      <Alert kind="error" onDismiss={() => setError("")}>
        {error}
      </Alert>

      {summary && (
        <div className="grid grid-4 mb-2">
          <div className="stat">
            <div className="stat-label">Entries</div>
            <div className="stat-value">{summary.total}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Failed sign-ins</div>
            <div className="stat-value">{failedSignIns}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Role changes</div>
            <div className="stat-value">
              {summary.byAction.find((r) => r.action === "user.role_changed")?.total ?? 0}
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">Deletions</div>
            <div className="stat-value">
              {summary.byAction
                .filter((r) => r.action.endsWith(".deleted"))
                .reduce((a, r) => a + r.total, 0)}
            </div>
          </div>
        </div>
      )}

      <div className="filters mb-2">
        <select
          className="select"
          value={action}
          onChange={(event) => setAction(event.target.value)}
          aria-label="Filter by action"
        >
          <option value="">Every action</option>
          {Object.entries(LABEL).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <Loading what="the audit log" />
      ) : entries.length === 0 ? (
        <div className="table-wrap">
          <Empty title="Nothing recorded yet">
            <p>Sign-ins, account changes and deletions will appear here as they happen.</p>
          </Empty>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Who</th>
                <th>Detail</th>
                <th>From</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className={WATCH.has(entry.action) ? "audit-watch" : ""}>
                  <td className="cell-sub">{formatDateTime(entry.createdAt)}</td>
                  <td>
                    <span
                      className={"badge " + (WATCH.has(entry.action) ? "badge-amber" : "badge-grey")}
                      title={entry.action}
                    >
                      {LABEL[entry.action] || entry.action}
                    </span>
                  </td>
                  <td>
                    <div className="cell-title">{entry.actorName}</div>
                    {entry.actorEmail && entry.actorEmail !== entry.actorName && (
                      <div className="cell-sub">{entry.actorEmail}</div>
                    )}
                  </td>
                  <td className="cell-sub">{entry.detail || "—"}</td>
                  <td className="cell-sub">{entry.ip || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

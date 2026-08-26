import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import {
  Alert,
  ClientStatusBadge,
  Field,
  Loading,
  formatBytes,
  formatDate,
} from "../components/ui.jsx";

const BANNER_TONE = {
  NO_CV: "",
  PENDING: "is-amber",
  ACCEPTED: "is-green",
  HIRED: "is-green",
  REJECTED: "is-red",
};

/**
 * One application, as the client who made it sees it. There is no
 * pipeline, no internal notes and no interviewer feedback here - only
 * their own details, their CV, and the answer to "has my CV been
 * accepted or rejected?".
 */
export default function MyApplicationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [application, setApplication] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [cvFile, setCvFile] = useState(null);
  const [details, setDetails] = useState({ phone: "", coverNote: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getApplication(id);
      setApplication(result.application);
      setDetails({
        phone: result.application.phone || "",
        coverNote: result.application.coverNote || "",
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(action, successMessage) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await action();
      if (result?.application) setApplication(result.application);
      if (successMessage) setMessage(successMessage);
      return result;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function uploadCv(event) {
    event.preventDefault();
    if (!cvFile) return;
    const form = event.target;
    const result = await run(
      () => api.uploadCv(id, cvFile),
      "CV uploaded. The hiring team will review it."
    );
    if (result) {
      setCvFile(null);
      form.reset();
    }
  }

  async function saveDetails(event) {
    event.preventDefault();
    await run(() => api.updateApplication(id, details), "Your details were updated.");
  }

  async function withdraw() {
    if (!window.confirm("Withdraw this application? Your CV will be deleted too.")) return;
    const result = await run(() => api.deleteApplication(id), null);
    if (result) navigate("/my-applications", { replace: true });
  }

  if (loading) return <Loading what="your application" />;
  if (!application) {
    return (
      <div className="page">
        <Alert kind="error">{error || "That application could not be found."}</Alert>
        <Link className="btn btn-secondary" to="/my-applications">
          Back to my applications
        </Link>
      </div>
    );
  }

  const status = application.clientStatus;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Link className="small" to="/my-applications">
            ← My applications
          </Link>
          <h1 className="mt-1">{application.jobTitle}</h1>
          <p className="subtitle">
            Applied on {formatDate(application.createdAt)}
            {application.jobLocation ? " · " + application.jobLocation : ""}
          </p>
        </div>
        <ClientStatusBadge status={status} />
      </div>

      <Alert kind="error" onDismiss={() => setError("")}>
        {error}
      </Alert>
      <Alert kind="success" onDismiss={() => setMessage("")}>
        {message}
      </Alert>

      <div className={"status-banner " + (BANNER_TONE[status?.key] || "")}>
        <h2>{status?.label}</h2>
        <p>{status?.detail}</p>
      </div>

      <div className="grid grid-sidebar mt-2">
        <div className="card">
          <h2>My CV</h2>

          {application.cv ? (
            <div className="mt-2">
              <div className="stack">
                <a className="cell-title" href={api.cvDownloadUrl(application.id)}>
                  {application.cv.filename}
                </a>
                <span className="cell-sub">
                  {formatBytes(application.cv.size)} · uploaded {formatDate(application.cv.uploadedAt)}
                </span>
              </div>
            </div>
          ) : (
            <p className="muted small mt-1">
              You have not uploaded a CV yet. The team cannot review your application without one.
            </p>
          )}

          <form onSubmit={uploadCv} className="mt-3">
            <Field
              label={application.cv ? "Replace my CV" : "Upload my CV"}
              htmlFor="cv"
              hint="PDF, DOC or DOCX · maximum 5 MB. Replacing it puts you back to “under review”."
            >
              <input
                id="cv"
                className="input"
                type="file"
                accept=".pdf,.doc,.docx"
                onChange={(event) => setCvFile(event.target.files?.[0] || null)}
              />
            </Field>
            <button className="btn btn-primary" disabled={busy || !cvFile}>
              {busy ? "Uploading…" : application.cv ? "Replace CV" : "Upload CV"}
            </button>
          </form>

          <hr style={{ border: "none", borderTop: "1px solid var(--line)", margin: "24px 0" }} />

          <h2>My details</h2>
          <form onSubmit={saveDetails} className="mt-2">
            <Field label="Phone number" htmlFor="phone">
              <input
                id="phone"
                className="input"
                placeholder="+94 77 123 4567"
                value={details.phone}
                onChange={(event) => setDetails((c) => ({ ...c, phone: event.target.value }))}
              />
            </Field>
            <Field label="Cover note" htmlFor="coverNote">
              <textarea
                id="coverNote"
                className="textarea"
                rows={4}
                placeholder="Why are you a good fit for this role?"
                value={details.coverNote}
                onChange={(event) => setDetails((c) => ({ ...c, coverNote: event.target.value }))}
              />
            </Field>
            <button className="btn btn-secondary" disabled={busy}>
              Save my details
            </button>
          </form>
        </div>

        <div className="card">
          <h2>Application</h2>
          <div className="detail-grid mt-2">
            <div>
              <div className="detail-label">Name</div>
              <div className="detail-value">{application.fullName}</div>
            </div>
            <div>
              <div className="detail-label">Email</div>
              <div className="detail-value small">{application.email}</div>
            </div>
            <div>
              <div className="detail-label">Vacancy</div>
              <div className="detail-value">
                <Link to={"/jobs/" + application.jobId}>{application.jobTitle}</Link>
              </div>
            </div>
            <div>
              <div className="detail-label">Last updated</div>
              <div className="detail-value small">{formatDate(application.updatedAt)}</div>
            </div>
          </div>

          <button className="btn btn-danger btn-block mt-3" onClick={withdraw} disabled={busy}>
            Withdraw my application
          </button>
        </div>
      </div>
    </div>
  );
}

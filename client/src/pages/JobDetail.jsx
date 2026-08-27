import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";
import {
  Alert,
  BandBadge,
  CvBadge,
  Empty,
  Field,
  Loading,
  OutcomeBadge,
  Pipeline,
  StatusBadge,
  formatDate,
} from "../components/ui.jsx";

/** One position: its description, its interview process, and everyone
 *  HR has added to it. */
export default function JobDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const p = user?.permissions || {};

  const [job, setJob] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const [form, setForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    source: "",
    notes: "",
    // Same rule as the Candidates page: on by default, because somebody
    // who applied should hear back.
    notify: true,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [jobResult, candidateResult] = await Promise.all([
        api.getJob(id),
        api.listCandidates({ job: id, sort: "band" }),
      ]);
      setJob(jobResult.job);
      setCandidates(candidateResult.candidates);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleStatus() {
    setBusy(true);
    setError("");
    try {
      const next = job.status === "ACTIVE" ? "CLOSED" : "ACTIVE";
      const result = await api.updateJob(id, { status: next });
      setJob(result.job);
      setMessage(next === "CLOSED" ? "Position closed." : "Position reopened.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeJob() {
    if (!window.confirm("Delete this position? This cannot be undone.")) return;
    setBusy(true);
    setError("");
    try {
      await api.deleteJob(id);
      navigate("/positions", { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function addCandidate(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api.addCandidate({ jobId: Number(id), ...form });
      // Straight to their record so the CV can be uploaded next.
      navigate("/candidates/" + result.candidate.id, {
        state: {
          justAdded: true,
          email: result.email,
          address: result.candidate.email,
        },
      });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  function update(key) {
    return (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  }

  if (loading) return <Loading what="this position" />;
  if (!job) {
    return (
      <div className="page">
        <Alert kind="error">{error || "That position could not be found."}</Alert>
        <Link className="btn btn-secondary" to="/positions">
          Back to positions
        </Link>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Link className="small" to="/positions">
            ← All positions
          </Link>
          <h1 className="mt-1">{job.title}</h1>
          <p className="subtitle">
            {[job.department, job.location, job.employmentType].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="btn-row">
          <StatusBadge status={job.status} />
          {p["candidate:compare"] && (
            <Link className="btn btn-secondary" to={"/positions/" + job.id + "/compare"}>
              Compare candidates
            </Link>
          )}
          {p["position:edit"] && (
            <Link className="btn btn-secondary" to={"/positions/" + job.id + "/edit"}>
              Edit
            </Link>
          )}
          {p["position:close"] && (
            <button className="btn btn-secondary" onClick={toggleStatus} disabled={busy}>
              {job.status === "ACTIVE" ? "Close position" : "Reopen position"}
            </button>
          )}
          {p["candidate:add"] && job.status === "ACTIVE" && (
            <button className="btn btn-primary" onClick={() => setShowAdd((c) => !c)}>
              {showAdd ? "Cancel" : "+ Add candidate"}
            </button>
          )}
        </div>
      </div>

      <Alert kind="error" onDismiss={() => setError("")}>
        {error}
      </Alert>
      <Alert kind="success" onDismiss={() => setMessage("")}>
        {message}
      </Alert>

      {showAdd && (
        <div className="card mb-2">
          <div className="card-title">
            <h2>Add a candidate</h2>
            <span className="muted small">
              They start at “{job.stages?.[0]}”. You can upload their CV on the next screen.
            </span>
          </div>

          <form onSubmit={addCandidate}>
            <div className="grid grid-2">
              <Field label="Full name" htmlFor="fullName">
                <input
                  id="fullName"
                  className="input"
                  required
                  minLength={2}
                  placeholder="Maya Fernando"
                  value={form.fullName}
                  onChange={update("fullName")}
                />
              </Field>
              <Field label="Email" htmlFor="email">
                <input
                  id="email"
                  className="input"
                  type="email"
                  required
                  placeholder="maya.fernando@gmail.com"
                  value={form.email}
                  onChange={update("email")}
                />
              </Field>
              <Field label="Phone" htmlFor="phone">
                <input
                  id="phone"
                  className="input"
                  placeholder="+94 77 123 4567"
                  value={form.phone}
                  onChange={update("phone")}
                />
              </Field>
              <Field label="Where did they come from?" htmlFor="source">
                <input
                  id="source"
                  className="input"
                  placeholder="LinkedIn, referral, email application…"
                  value={form.source}
                  onChange={update("source")}
                />
              </Field>
            </div>

            <Field label="Notes" htmlFor="notes" hint="Internal only - the candidate never sees this.">
              <textarea
                id="notes"
                className="textarea"
                rows={3}
                value={form.notes}
                onChange={update("notes")}
              />
            </Field>

            <label className="check">
              <input
                type="checkbox"
                checked={form.notify}
                onChange={(event) =>
                  setForm((current) => ({ ...current, notify: event.target.checked }))
                }
              />
              <span>
                Email them to confirm we have their application
                <span className="muted small">
                  {" "}
                  — turn this off for a name taken off a CV pile who has not applied yet.
                </span>
              </span>
            </label>

            <button className="btn btn-primary mt-2" disabled={busy}>
              {busy ? "Adding…" : "Add candidate"}
            </button>
          </form>
        </div>
      )}

      <div className="grid grid-sidebar">
        <div>
          <div className="card">
            <h2>Job description</h2>
            <p className="mt-1" style={{ whiteSpace: "pre-wrap" }}>
              {job.description || "No description was added for this position."}
            </p>

            <div className="mt-3">
              <div className="detail-label">Interview process</div>
              <p className="field-hint">
                Stages are set for this position on its own, so different roles can follow different
                processes.
              </p>
              <div className="mt-1">
                <Pipeline stages={job.stages || []} />
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-title">
              <h2>Candidates ({candidates.length})</h2>
              {p["candidate:compare"] && candidates.length > 0 && (
                <Link className="small" to={"/positions/" + job.id + "/compare"}>
                  Compare side by side
                </Link>
              )}
            </div>

            {candidates.length === 0 ? (
              <Empty title="No candidates yet">
                <p>
                  {p["candidate:add"]
                    ? "Use “Add candidate” above to put someone into this pipeline."
                    : "HR has not added anyone to this position yet."}
                </p>
              </Empty>
            ) : (
              <div className="table-wrap" style={{ border: "none", boxShadow: "none" }}>
                <table>
                  <thead>
                    <tr>
                      <th>Candidate</th>
                      <th>Stage</th>
                      <th>CV band</th>
                      <th>Outcome</th>
                      <th>CV</th>
                      <th>Added</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((candidate) => (
                      <tr key={candidate.id}>
                        <td>
                          <Link className="cell-title" to={"/candidates/" + candidate.id}>
                            {candidate.fullName}
                          </Link>
                          <div className="cell-sub">{candidate.email}</div>
                        </td>
                        <td>{candidate.currentStage}</td>
                        <td>
                          <BandBadge band={candidate.cvBand} />
                        </td>
                        <td>
                          <OutcomeBadge outcome={candidate.outcome} />
                        </td>
                        <td>
                          <CvBadge hasCv={Boolean(candidate.cv)} />
                        </td>
                        <td className="cell-sub">{formatDate(candidate.createdAt)}</td>
                        <td className="cell-right">
                          <Link
                            className="btn btn-secondary btn-sm"
                            to={"/candidates/" + candidate.id}
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <h2>Details</h2>
          <div className="detail-grid mt-2">
            <div>
              <div className="detail-label">Status</div>
              <div className="detail-value">
                <StatusBadge status={job.status} />
              </div>
            </div>
            <div>
              <div className="detail-label">Employment type</div>
              <div className="detail-value">{job.employmentType}</div>
            </div>
            <div>
              <div className="detail-label">Salary range</div>
              <div className="detail-value">{job.salaryRange || "Not published"}</div>
            </div>
            <div>
              <div className="detail-label">Closing date</div>
              <div className="detail-value">
                {job.closingDate ? formatDate(job.closingDate) : "Open until filled"}
              </div>
            </div>
            <div>
              <div className="detail-label">Hiring manager</div>
              <div className="detail-value">{job.hiringManagerName || "Not assigned"}</div>
            </div>
            <div>
              <div className="detail-label">Opened by</div>
              <div className="detail-value">
                {job.createdByName || "—"}
                <div className="cell-sub">{formatDate(job.createdAt)}</div>
              </div>
            </div>
          </div>

          {p["position:delete"] && (
            <div className="mt-3">
              <button className="btn btn-danger btn-block" onClick={removeJob} disabled={busy}>
                Delete position
              </button>
              <p className="field-hint">
                A position that already has candidates cannot be deleted — close it instead.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

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
  CV_ACCEPT,
  CV_HINT,
  describeCvProblem,
  describeEmailProblem,
  formatDate,
} from "../components/ui.jsx";

const BLANK_FORM = {
  fullName: "",
  email: "",
  phone: "",
  source: "",
  notes: "",
};

/** One vacancy: its description, its interview process, and everyone
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
  // Per-field messages for the add-candidate form.
  const [formErrors, setFormErrors] = useState({});
  const [message, setMessage] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const [form, setForm] = useState(BLANK_FORM);
  // Picked in the same form as everything else - see Candidates.jsx for
  // why the File is held apart from the rest.
  const [cvFile, setCvFile] = useState(null);
  const [cvKey, setCvKey] = useState(0);

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
      setMessage(next === "CLOSED" ? "Vacancy closed." : "Vacancy reopened.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeJob() {
    if (!window.confirm("Delete this vacancy? This cannot be undone.")) return;
    setBusy(true);
    setError("");
    try {
      await api.deleteJob(id);
      navigate("/vacancies", { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function addCandidate(event) {
    event.preventDefault();

    // Same check the server runs, so the answer arrives without a
    // round trip and says what is actually wrong with the address.
    const problems = {};
    if (!form.fullName.trim()) problems.fullName = "Enter the candidate's full name.";
    const emailProblem = describeEmailProblem(form.email);
    if (emailProblem) problems.email = emailProblem;

    // Asked for here, not on a second screen.
    const cvProblemNow = describeCvProblem(cvFile);
    if (cvProblemNow) problems.cv = cvProblemNow;

    setFormErrors(problems);
    if (Object.keys(problems).length > 0) return;

    setBusy(true);
    setError("");
    try {
      // No notify flag: the confirmation always goes out.
      const result = await api.addCandidate({ jobId: Number(id), ...form });

      // Needs the id, so it follows the record. A failure here does not
      // undo the record - it is reported instead.
      let cvProblem = "";
      try {
        await api.uploadCv(result.candidate.id, cvFile);
      } catch (err) {
        cvProblem = err.message;
      }

      const posted = result.email?.sent
        ? "their confirmation has been emailed to " + result.candidate.email + "."
        : "their confirmation is waiting in the outbox.";

      setMessage(
        cvProblem
          ? result.candidate.fullName +
              " was added and " +
              posted +
              " The CV did not upload (" +
              cvProblem +
              ") - open their page to try that part again."
          : result.candidate.fullName + " was added with their CV, and " + posted
      );

      // Stay on the vacancy. The candidate table below picks them up.
      setForm(BLANK_FORM);
      setCvFile(null);
      setCvKey((n) => n + 1);
      setFormErrors({});
      setShowAdd(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function update(key) {
    return (event) => {
      setForm((current) => ({ ...current, [key]: event.target.value }));
      // Clear the message as soon as they start fixing that field.
      setFormErrors((current) => {
        if (!current[key]) return current;
        const next = { ...current };
        delete next[key];
        return next;
      });
    };
  }

  if (loading) return <Loading what="this vacancy" />;
  if (!job) {
    return (
      <div className="page">
        <Alert kind="error">{error || "That vacancy could not be found."}</Alert>
        <Link className="btn btn-secondary" to="/vacancies">
          Back to vacancies
        </Link>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Link className="small" to="/vacancies">
            ← All vacancies
          </Link>
          <h1 className="mt-1">{job.title}</h1>
          <p className="subtitle">
            {[job.department, job.location, job.employmentType].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="btn-row">
          <StatusBadge status={job.status} />
          {p["candidate:compare"] && (
            <Link className="btn btn-secondary" to={"/vacancies/" + job.id + "/compare"}>
              Compare candidates
            </Link>
          )}
          {p["position:edit"] && (
            <Link className="btn btn-secondary" to={"/vacancies/" + job.id + "/edit"}>
              Edit
            </Link>
          )}
          {p["position:close"] && (
            <button className="btn btn-secondary" onClick={toggleStatus} disabled={busy}>
              {job.status === "ACTIVE" ? "Close vacancy" : "Reopen vacancy"}
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
              Everything in one go - their CV included. They start at “{job.stages?.[0]}” and are
              emailed as soon as you save.
            </span>
          </div>

          {/* noValidate turns the browser's own pop-up off. The inputs still
              carry min/type so the picker and keyboard behave, but the
              message the person reads is ours - "that date is not
              available" rather than "Value must be ... or later". */}
          <form onSubmit={addCandidate} noValidate>
            <div className="grid grid-2">
              <Field label="Full name" htmlFor="fullName" error={formErrors.fullName}>
                <input
                  id="fullName"
                  className={"input" + (formErrors.fullName ? " input-error" : "")}
                  minLength={2}
                  placeholder="Maya Fernando"
                  value={form.fullName}
                  onChange={update("fullName")}
                  aria-invalid={Boolean(formErrors.fullName)}
                />
              </Field>
              <Field label="Email" htmlFor="email" error={formErrors.email}>
                <input
                  id="email"
                  className={"input" + (formErrors.email ? " input-error" : "")}
                  type="email"
                  placeholder="maya.fernando@gmail.com"
                  value={form.email}
                  onChange={update("email")}
                  aria-invalid={Boolean(formErrors.email)}
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
              <Field
                label="Their CV"
                htmlFor="cv"
                hint={CV_HINT}
                error={formErrors.cv}
              >
                <input
                  id="cv"
                  key={cvKey}
                  className={"input" + (formErrors.cv ? " input-error" : "")}
                  type="file"
                  accept={CV_ACCEPT}
                  onChange={(event) => {
                    setCvFile(event.target.files?.[0] || null);
                    setFormErrors((current) => {
                      if (!current.cv) return current;
                      const next = { ...current };
                      delete next.cv;
                      return next;
                    });
                  }}
                  aria-invalid={Boolean(formErrors.cv)}
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

            <button className="btn btn-primary mt-2" disabled={busy}>
              {busy ? "Saving…" : "Save candidate"}
            </button>
          </form>
        </div>
      )}

      <div className="grid grid-sidebar">
        <div>
          <div className="card">
            <h2>Job description</h2>
            <p className="mt-1" style={{ whiteSpace: "pre-wrap" }}>
              {job.description || "No description was added for this vacancy."}
            </p>

            <div className="mt-3">
              <div className="detail-label">Interview process</div>
              <p className="field-hint">
                Stages are set for this vacancy on its own, so different roles can follow different
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
                <Link className="small" to={"/vacancies/" + job.id + "/compare"}>
                  Compare side by side
                </Link>
              )}
            </div>

            {candidates.length === 0 ? (
              <Empty title="No candidates yet">
                <p>
                  {p["candidate:add"]
                    ? "Use “Add candidate” above to put someone into this pipeline."
                    : "HR has not added anyone to this vacancy yet."}
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
                Delete vacancy
              </button>
              <p className="field-hint">
                A vacancy that already has candidates cannot be deleted — close it instead.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

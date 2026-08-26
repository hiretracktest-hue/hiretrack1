import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";
import {
  Alert,
  CvStatusBadge,
  Empty,
  Field,
  Loading,
  OutcomeBadge,
  Pipeline,
  StatusBadge,
  formatDate,
} from "../components/ui.jsx";

export default function JobDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isStaff = Boolean(user?.isStaff);

  const [job, setJob] = useState(null);
  const [applicants, setApplicants] = useState([]);
  const [myApplication, setMyApplication] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showApply, setShowApply] = useState(false);

  const [applyForm, setApplyForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    source: "",
    coverNote: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const jobResult = await api.getJob(id);
      setJob(jobResult.job);

      // Staff get the full applicant list; a client only ever gets their
      // own row back from this endpoint, which tells us if they applied.
      const applicationsResult = await api.listApplications({ job: id });
      if (isStaff) {
        setApplicants(applicationsResult.applications);
      } else {
        setMyApplication(applicationsResult.applications[0] || null);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id, isStaff]);

  useEffect(() => {
    load();
  }, [load]);

  // Pre-fill the apply form with the signed-in person's own details.
  useEffect(() => {
    if (user) {
      setApplyForm((current) => ({
        ...current,
        fullName: current.fullName || user.name || "",
        email: current.email || user.email || "",
      }));
    }
  }, [user]);

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
      navigate("/jobs", { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function submitApplication(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api.apply({ jobId: Number(id), ...applyForm });
      setShowApply(false);
      // A client goes to their own application page to upload the CV;
      // staff go to the full candidate record.
      navigate(isStaff ? "/candidates/" + result.application.id : "/my-applications/" + result.application.id);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  function updateApply(key) {
    return (event) => setApplyForm((current) => ({ ...current, [key]: event.target.value }));
  }

  if (loading) return <Loading what="this vacancy" />;
  if (!job) {
    return (
      <div className="page">
        <Alert kind="error">{error || "That vacancy could not be found."}</Alert>
        <Link className="btn btn-secondary" to="/jobs">
          Back to vacancies
        </Link>
      </div>
    );
  }

  const alreadyApplied = Boolean(myApplication);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Link className="small" to="/jobs">
            ← {isStaff ? "All vacancies" : "Open vacancies"}
          </Link>
          <h1 className="mt-1">{job.title}</h1>
          <p className="subtitle">
            {[job.department, job.location, job.employmentType].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="btn-row">
          <StatusBadge status={job.status} />
          {isStaff && (
            <>
              <Link className="btn btn-secondary" to={"/jobs/" + job.id + "/compare"}>
                Compare candidates
              </Link>
              <Link className="btn btn-secondary" to={"/jobs/" + job.id + "/edit"}>
                Edit
              </Link>
              <button className="btn btn-secondary" onClick={toggleStatus} disabled={busy}>
                {job.status === "ACTIVE" ? "Close vacancy" : "Reopen vacancy"}
              </button>
            </>
          )}
          {!alreadyApplied && (
            <button
              className="btn btn-primary"
              onClick={() => setShowApply((current) => !current)}
              disabled={job.status !== "ACTIVE"}
            >
              {showApply ? "Cancel" : isStaff ? "Add candidate" : "Apply for this job"}
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

      {alreadyApplied && (
        <div className="alert alert-info">
          <div className="row-between">
            <span>
              You applied for this job on {formatDate(myApplication.createdAt)} —{" "}
              <strong>{myApplication.clientStatus?.label}</strong>.
            </span>
            <Link className="btn btn-secondary btn-sm" to={"/my-applications/" + myApplication.id}>
              View my application
            </Link>
          </div>
        </div>
      )}

      {showApply && (
        <div className="card mb-2">
          <div className="card-title">
            <h2>{isStaff ? "Add a candidate" : "Apply for this vacancy"}</h2>
            <span className="muted small">
              {isStaff
                ? "The candidate starts at “" + job.stages?.[0] + "”."
                : "You can upload your CV on the next screen."}
            </span>
          </div>

          <form onSubmit={submitApplication}>
            <div className="grid grid-2">
              <Field label="Full name" htmlFor="fullName">
                <input
                  id="fullName"
                  className="input"
                  required
                  minLength={2}
                  value={applyForm.fullName}
                  onChange={updateApply("fullName")}
                  disabled={!isStaff}
                />
              </Field>
              <Field
                label="Email"
                htmlFor="applicantEmail"
                hint={isStaff ? undefined : "Taken from your account."}
              >
                <input
                  id="applicantEmail"
                  className="input"
                  type="email"
                  required
                  value={applyForm.email}
                  onChange={updateApply("email")}
                  disabled={!isStaff}
                />
              </Field>
              <Field label="Phone" htmlFor="phone">
                <input
                  id="phone"
                  className="input"
                  placeholder="+94 77 123 4567"
                  value={applyForm.phone}
                  onChange={updateApply("phone")}
                />
              </Field>
              <Field label="How did you hear about us?" htmlFor="source">
                <input
                  id="source"
                  className="input"
                  placeholder="LinkedIn, referral, job board…"
                  value={applyForm.source}
                  onChange={updateApply("source")}
                />
              </Field>
            </div>

            <Field label="Cover note" htmlFor="coverNote">
              <textarea
                id="coverNote"
                className="textarea"
                rows={3}
                placeholder="Why are you a good fit for this role?"
                value={applyForm.coverNote}
                onChange={updateApply("coverNote")}
              />
            </Field>

            <button className="btn btn-primary" disabled={busy}>
              {busy ? "Submitting…" : "Submit application"}
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

            {isStaff && (
              <div className="mt-3">
                <div className="detail-label">Interview pipeline</div>
                <div className="mt-1">
                  <Pipeline stages={job.stages || []} />
                </div>
              </div>
            )}
          </div>

          {isStaff && (
            <div className="card">
              <div className="card-title">
                <h2>Applicants ({applicants.length})</h2>
                <Link className="small" to={"/jobs/" + job.id + "/compare"}>
                  Compare side by side
                </Link>
              </div>

              {applicants.length === 0 ? (
                <Empty title="Nobody has applied yet">
                  <p>Applications submitted for this vacancy will be listed here.</p>
                </Empty>
              ) : (
                <div className="table-wrap" style={{ border: "none", boxShadow: "none" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Candidate</th>
                        <th>Stage</th>
                        <th>Outcome</th>
                        <th>CV</th>
                        <th>Applied</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {applicants.map((applicant) => (
                        <tr key={applicant.id}>
                          <td>
                            <Link className="cell-title" to={"/candidates/" + applicant.id}>
                              {applicant.fullName}
                            </Link>
                            <div className="cell-sub">{applicant.email}</div>
                          </td>
                          <td>{applicant.currentStage}</td>
                          <td>
                            <OutcomeBadge outcome={applicant.outcome} />
                          </td>
                          <td>
                            <CvStatusBadge
                              status={applicant.cvStatus}
                              hasCv={Boolean(applicant.cv)}
                            />
                          </td>
                          <td className="cell-sub">{formatDate(applicant.createdAt)}</td>
                          <td className="cell-right">
                            <Link
                              className="btn btn-secondary btn-sm"
                              to={"/candidates/" + applicant.id}
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
          )}
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
                {job.closingDate ? formatDate(job.closingDate) : "Open ended"}
              </div>
            </div>
            {isStaff && (
              <>
                <div>
                  <div className="detail-label">Posted by</div>
                  <div className="detail-value">{job.createdByName || "—"}</div>
                </div>
                <div>
                  <div className="detail-label">Posted on</div>
                  <div className="detail-value">{formatDate(job.createdAt)}</div>
                </div>
              </>
            )}
          </div>

          {isStaff && (
            <div className="mt-3">
              <button className="btn btn-danger btn-block" onClick={removeJob} disabled={busy}>
                Delete vacancy
              </button>
              <p className="field-hint">
                A vacancy that already has applications cannot be deleted — close it instead.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

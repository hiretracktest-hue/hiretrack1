import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";
import { Alert, Field, Loading, formatDate } from "../components/ui.jsx";

/**
 * The page a shared job link opens - WhatsApp, LinkedIn, Facebook, an
 * email, anywhere. No account is needed to READ it. Applying signs the
 * person in first, so every CV that arrives belongs to a real account.
 */
export default function PublicJob() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ phone: "", source: "", coverNote: "" });

  useEffect(() => {
    api
      .publicJob(token)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token, user]);

  /** Not signed in yet: remember this page, then come straight back. */
  function signInToApply() {
    navigate("/signin", { state: { from: "/job/" + token } });
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api.apply({ jobId: data.job.id, ...form });
      navigate("/my-applications/" + result.application.id);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (loading || authLoading) return <Loading what="this job" />;

  if (!data) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="auth-head">
            <span className="brand">
              <span className="brand-mark">HT</span>
              HireTrack
            </span>
          </div>
          <Alert kind="error">{error || "That job link is not valid."}</Alert>
          <Link className="btn btn-secondary btn-block" to="/careers">
            See all our open vacancies
          </Link>
        </div>
      </div>
    );
  }

  const { job, alreadyApplied } = data;

  return (
    <div className="public-page">
      <header className="public-bar">
        <Link to="/careers" className="brand">
          <span className="brand-mark">HT</span>
          HireTrack
        </Link>
        {user ? (
          <Link className="btn btn-secondary btn-sm" to={user.isStaff ? "/dashboard" : "/my-applications"}>
            {user.isStaff ? "Go to dashboard" : "My applications"}
          </Link>
        ) : (
          <Link className="btn btn-secondary btn-sm" to="/signin">
            Sign in
          </Link>
        )}
      </header>

      <main className="public-main">
        <div className="public-hero">
          <span className={"badge " + (job.openForApplications ? "badge-green" : "badge-grey")}>
            {job.openForApplications ? "Now hiring" : "Applications closed"}
          </span>
          <h1 className="mt-2">{job.title}</h1>
          <p className="subtitle">
            {[job.department, job.location, job.employmentType].filter(Boolean).join("  ·  ")}
          </p>
        </div>

        <Alert kind="error" onDismiss={() => setError("")}>
          {error}
        </Alert>

        <div className="grid grid-sidebar">
          <div className="card">
            <h2>About this role</h2>
            <p className="mt-2" style={{ whiteSpace: "pre-wrap" }}>
              {job.description || "No description was added for this role."}
            </p>

            {showForm && (
              <form onSubmit={submit} className="mt-3">
                <h3>Your application</h3>
                <p className="field-hint mb-2">
                  Applying as <strong>{user?.name}</strong> ({user?.email}). You upload your CV on
                  the next screen.
                </p>

                <div className="grid grid-2">
                  <Field label="Phone number" htmlFor="phone">
                    <input
                      id="phone"
                      className="input"
                      placeholder="+94 77 123 4567"
                      value={form.phone}
                      onChange={(e) => setForm((c) => ({ ...c, phone: e.target.value }))}
                    />
                  </Field>
                  <Field label="Where did you see this job?" htmlFor="source">
                    <input
                      id="source"
                      className="input"
                      placeholder="WhatsApp, LinkedIn, Facebook…"
                      value={form.source}
                      onChange={(e) => setForm((c) => ({ ...c, source: e.target.value }))}
                    />
                  </Field>
                </div>

                <Field label="Why are you a good fit?" htmlFor="coverNote">
                  <textarea
                    id="coverNote"
                    className="textarea"
                    rows={4}
                    value={form.coverNote}
                    onChange={(e) => setForm((c) => ({ ...c, coverNote: e.target.value }))}
                  />
                </Field>

                <div className="btn-row">
                  <button className="btn btn-primary" disabled={busy}>
                    {busy ? "Sending…" : "Send my application"}
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>

          <div>
            <div className="card">
              <h2>Apply</h2>

              {!job.openForApplications ? (
                <p className="muted small mt-2">
                  This vacancy is closed and is no longer accepting applications.
                </p>
              ) : alreadyApplied ? (
                <>
                  <p className="small mt-2">You have already applied for this role.</p>
                  <Link className="btn btn-secondary btn-block mt-2" to="/my-applications">
                    Track my application
                  </Link>
                </>
              ) : user && !user.isStaff ? (
                <>
                  <p className="small mt-2">Takes about a minute. You will need your CV as a PDF.</p>
                  <button
                    className="btn btn-primary btn-block mt-2"
                    onClick={() => setShowForm(true)}
                    disabled={showForm}
                  >
                    Apply for this job
                  </button>
                </>
              ) : user && user.isStaff ? (
                <p className="small mt-2">
                  You are signed in as a member of the hiring team, so this is how candidates see
                  the link you shared.
                </p>
              ) : (
                <>
                  <p className="small mt-2">
                    Sign in with your email or your Google account to apply. It takes a moment and
                    lets you track your application afterwards.
                  </p>
                  <button className="btn btn-primary btn-block mt-2" onClick={signInToApply}>
                    Sign in and apply
                  </button>
                  <Link className="btn btn-secondary btn-block mt-1" to="/signup">
                    Create an account
                  </Link>
                </>
              )}
            </div>

            <div className="card">
              <h2>Details</h2>
              <div className="detail-grid mt-2">
                <div>
                  <div className="detail-label">Salary</div>
                  <div className="detail-value">{job.salaryRange || "Not published"}</div>
                </div>
                <div>
                  <div className="detail-label">Closing date</div>
                  <div className="detail-value">
                    {job.closingDate ? formatDate(job.closingDate) : "Open until filled"}
                  </div>
                </div>
                <div>
                  <div className="detail-label">Posted</div>
                  <div className="detail-value">{formatDate(job.postedOn)}</div>
                </div>
                <div>
                  <div className="detail-label">Interview stages</div>
                  <div className="detail-value">{job.stageCount}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="footer">
        HireTrack — recruitment and hiring tracker.{" "}
        <Link to="/careers">See all open vacancies</Link>
      </footer>
    </div>
  );
}

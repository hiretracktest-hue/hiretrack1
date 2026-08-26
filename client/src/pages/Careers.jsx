import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";
import { Alert, Empty, Loading, formatDate } from "../components/ui.jsx";

/** The public careers page. No account needed. */
export default function Careers() {
  const { user } = useAuth();
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .publicJobs()
      .then((result) => setJobs(result.jobs))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

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
          <h1>Open positions</h1>
          <p className="subtitle">
            Every role we are hiring for right now. Open one to read the details and apply.
          </p>
        </div>

        <Alert kind="error" onDismiss={() => setError("")}>
          {error}
        </Alert>

        {loading ? (
          <Loading what="open positions" />
        ) : jobs.length === 0 ? (
          <div className="card">
            <Empty title="No open positions right now">
              <p>Please check back soon.</p>
            </Empty>
          </div>
        ) : (
          <div className="grid grid-2">
            {jobs.map((job) => (
              <div className="card" key={job.id}>
                <h2>{job.title}</h2>
                <div className="cell-sub">
                  {[job.department, job.location, job.employment_type || job.employmentType]
                    .filter(Boolean)
                    .join("  ·  ")}
                </div>
                <p className="small muted mt-2">
                  {job.description
                    ? job.description.slice(0, 160) + (job.description.length > 160 ? "…" : "")
                    : "No description was added for this role."}
                </p>
                <div className="row-between mt-3">
                  <span className="cell-sub">Posted {formatDate(job.postedOn)}</span>
                  <Link className="btn btn-primary btn-sm" to={"/job/" + job.publicToken}>
                    View and apply
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <footer className="footer">HireTrack — recruitment and hiring tracker.</footer>
    </div>
  );
}

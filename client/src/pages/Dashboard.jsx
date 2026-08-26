import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";
import {
  Alert,
  Empty,
  Loading,
  OutcomeBadge,
  Stat,
  StatusBadge,
  formatDateTime,
} from "../components/ui.jsx";

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [applications, setApplications] = useState([]);
  const [interviews, setInterviews] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      api.stats(),
      api.listJobs(),
      api.listApplications(),
      api.listInterviews({ upcoming: 1 }),
    ])
      .then(([statsResult, jobsResult, applicationsResult, interviewsResult]) => {
        if (cancelled) return;
        setStats(statsResult);
        setJobs(jobsResult.jobs);
        setApplications(applicationsResult.applications);
        setInterviews(interviewsResult.interviews);
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <Loading what="your dashboard" />;

  const openJobs = jobs.filter((job) => job.status === "ACTIVE").slice(0, 5);
  const recent = applications.slice(0, 6);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Hello, {user?.name?.split(" ")[0]} 👋</h1>
          <p className="subtitle">Here is where your hiring pipeline stands today.</p>
        </div>
        <div className="btn-row">
          <Link className="btn btn-secondary" to="/candidates">
            All candidates
          </Link>
          <Link className="btn btn-primary" to="/jobs/new">
            + New vacancy
          </Link>
        </div>
      </div>

      <Alert kind="error">{error}</Alert>

      <div className="grid grid-4">
        <Stat label="Open vacancies" value={stats?.openVacancies ?? 0} />
        <Stat label="Applications" value={stats?.totalApplications ?? 0} />
        <Stat label="Active candidates" value={stats?.activeCandidates ?? 0} />
        <Stat label="Upcoming interviews" value={stats?.upcomingInterviews ?? 0} />
      </div>

      <div className="grid grid-4 mt-2">
        <Stat label="Hired" value={stats?.hired ?? 0} />
        <Stat label="Rejected" value={stats?.rejected ?? 0} />
        <Stat label="CVs on file" value={stats?.cvsOnFile ?? 0} />
        <Stat label="Team members" value={stats?.teamMembers ?? 0} />
      </div>

      <div className="grid grid-sidebar mt-3">
        <div className="card">
          <div className="card-title">
            <h2>Latest applications</h2>
            <Link className="small" to="/candidates">
              View all
            </Link>
          </div>

          {recent.length === 0 ? (
            <Empty title="No applications yet">
              <p>Create a vacancy and applications will show up here.</p>
            </Empty>
          ) : (
            <ul className="list">
              {recent.map((application) => (
                <li key={application.id}>
                  <div>
                    <Link className="cell-title" to={"/candidates/" + application.id}>
                      {application.fullName}
                    </Link>
                    <div className="cell-sub">
                      {application.jobTitle} · {application.currentStage}
                    </div>
                  </div>
                  <OutcomeBadge outcome={application.outcome} />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <div className="card">
            <div className="card-title">
              <h2>Open vacancies</h2>
              <Link className="small" to="/jobs">
                View all
              </Link>
            </div>

            {openJobs.length === 0 ? (
              <p className="muted small">No open vacancies right now.</p>
            ) : (
              <ul className="list">
                {openJobs.map((job) => (
                  <li key={job.id}>
                    <div>
                      <Link className="cell-title" to={"/jobs/" + job.id}>
                        {job.title}
                      </Link>
                      <div className="cell-sub">
                        {job.applicantCount} applicant{job.applicantCount === 1 ? "" : "s"}
                      </div>
                    </div>
                    <StatusBadge status={job.status} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card">
            <div className="card-title">
              <h2>Next interviews</h2>
              <Link className="small" to="/interviews">
                View all
              </Link>
            </div>

            {interviews.length === 0 ? (
              <p className="muted small">Nothing scheduled yet.</p>
            ) : (
              <ul className="list">
                {interviews.slice(0, 4).map((interview) => (
                  <li key={interview.id}>
                    <div>
                      <Link className="cell-title" to={"/candidates/" + interview.applicationId}>
                        {interview.candidateName}
                      </Link>
                      <div className="cell-sub">
                        {interview.stage} · {formatDateTime(interview.scheduledAt)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

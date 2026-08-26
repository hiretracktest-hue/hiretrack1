import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";
import {
  Alert,
  BandBadge,
  Empty,
  Loading,
  OutcomeBadge,
  Stat,
  StatusBadge,
  formatDateTime,
} from "../components/ui.jsx";

/**
 * The "live view" the brief asks for: where every candidate is and how
 * each position is progressing. What is shown depends on the role - an
 * interviewer sees their own schedule first, HR sees the whole pipeline.
 */
export default function Dashboard() {
  const { user } = useAuth();
  const p = user?.permissions || {};

  const [stats, setStats] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [interviews, setInterviews] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const empty = { jobs: [], candidates: [], interviews: [] };

    Promise.all([
      api.stats(),
      p["position:view"] ? api.listJobs() : Promise.resolve(empty),
      p["candidate:view"] ? api.listCandidates({ sort: "newest" }) : Promise.resolve(empty),
      p["interview:view"]
        ? api.listInterviews({ upcoming: 1, ...(p["interview:schedule"] ? {} : { mine: 1 }) })
        : Promise.resolve(empty),
    ])
      .then(([statsResult, jobsResult, candidateResult, interviewResult]) => {
        if (cancelled) return;
        setStats(statsResult);
        setJobs(jobsResult.jobs || []);
        setCandidates(candidateResult.candidates || []);
        setInterviews(interviewResult.interviews || []);
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [p]);

  if (loading) return <Loading what="your dashboard" />;

  const openJobs = jobs.filter((job) => job.status === "ACTIVE").slice(0, 5);
  const isInterviewer = !p["candidate:advance"];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Hello, {user?.name?.split(" ")[0]} 👋</h1>
          <p className="subtitle">
            {user?.roleLabel}
            {user?.jobTitle ? " · " + user.jobTitle : ""} — here is where hiring stands today.
          </p>
        </div>
        <div className="btn-row">
          {p["candidate:view"] && (
            <Link className="btn btn-secondary" to="/candidates">
              All candidates
            </Link>
          )}
          {p["position:create"] && (
            <Link className="btn btn-primary" to="/positions/new">
              + Open a position
            </Link>
          )}
        </div>
      </div>

      <Alert kind="error" onDismiss={() => setError("")}>
        {error}
      </Alert>

      {/* An interviewer cares about their own work first. */}
      {isInterviewer && (
        <div className="grid grid-2 mb-2">
          <Stat label="My upcoming interviews" value={stats?.myUpcomingInterviews ?? 0} />
          <Stat label="Feedback I still owe" value={stats?.myOutstandingFeedback ?? 0} />
        </div>
      )}

      <div className="grid grid-4">
        <Stat label="Open positions" value={stats?.openPositions ?? 0} />
        <Stat label="Candidates" value={stats?.totalCandidates ?? 0} />
        <Stat label="In progress" value={stats?.activeCandidates ?? 0} />
        <Stat label="Upcoming interviews" value={stats?.upcomingInterviews ?? 0} />
      </div>

      {p["candidate:band"] && (
        <div className="grid grid-4 mt-2">
          <Stat label="CVs to screen" value={stats?.awaitingScreening ?? 0} />
          <Stat label="On hold" value={stats?.onHold ?? 0} />
          <Stat label="Hired" value={stats?.hired ?? 0} />
          <Stat label="Emails to send" value={stats?.pendingEmails ?? 0} />
        </div>
      )}

      <div className="grid grid-sidebar mt-3">
        {p["candidate:view"] && (
          <div className="card">
            <div className="card-title">
              <h2>Latest candidates</h2>
              <Link className="small" to="/candidates">
                View all
              </Link>
            </div>

            {candidates.length === 0 ? (
              <Empty title="No candidates yet">
                <p>
                  {p["candidate:add"]
                    ? "Open a position and add your first candidate."
                    : "HR has not added anyone yet."}
                </p>
              </Empty>
            ) : (
              <ul className="list">
                {candidates.slice(0, 6).map((candidate) => (
                  <li key={candidate.id}>
                    <div>
                      <Link className="cell-title" to={"/candidates/" + candidate.id}>
                        {candidate.fullName}
                      </Link>
                      <div className="cell-sub">
                        {candidate.jobTitle} · {candidate.currentStage}
                      </div>
                    </div>
                    <div className="btn-row">
                      <BandBadge band={candidate.cvBand} />
                      <OutcomeBadge outcome={candidate.outcome} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div>
          {p["position:view"] && (
            <div className="card">
              <div className="card-title">
                <h2>Open positions</h2>
                <Link className="small" to="/positions">
                  View all
                </Link>
              </div>

              {openJobs.length === 0 ? (
                <p className="muted small">No open positions right now.</p>
              ) : (
                <ul className="list">
                  {openJobs.map((job) => (
                    <li key={job.id}>
                      <div>
                        <Link className="cell-title" to={"/positions/" + job.id}>
                          {job.title}
                        </Link>
                        <div className="cell-sub">
                          {job.candidateCount} candidate{job.candidateCount === 1 ? "" : "s"}
                        </div>
                      </div>
                      <StatusBadge status={job.status} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {p["interview:view"] && (
            <div className="card">
              <div className="card-title">
                <h2>{isInterviewer ? "My next interviews" : "Next interviews"}</h2>
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
                        <Link className="cell-title" to={"/candidates/" + interview.candidateId}>
                          {interview.candidateName}
                        </Link>
                        <div className="cell-sub">
                          {interview.stage} · {formatDateTime(interview.scheduledAt)}
                        </div>
                      </div>
                      {!interview.feedbackGiven && new Date(interview.scheduledAt) < new Date() && (
                        <span className="badge badge-amber">Feedback due</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

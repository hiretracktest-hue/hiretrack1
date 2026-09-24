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
import {
  IconArrowRight,
  IconBriefcase,
  IconCalendar,
  IconCheck,
  IconClock,
  IconFile,
  IconLayers,
  IconMail,
  IconUsers,
} from "../components/icons.jsx";

/**
 * Each role opens on its own welcome: what it is here to do, and the
 * shortcuts it actually uses. Only pages the role can open are offered -
 * every shortcut is checked against the same permissions as the menu.
 */
const WELCOME = {
  hr: {
    line: "Open roles, bring candidates in, and keep every interview booked.",
    actions: [
      { to: "/vacancies/new", label: "New vacancy", need: "position:create", primary: true },
      { to: "/candidates", label: "Candidates", need: "candidate:view" },
      { to: "/interviews", label: "Interviews", need: "interview:view" },
    ],
  },
  hiring_manager: {
    line: "Read the evidence, compare candidates side by side, and make the call.",
    actions: [
      { to: "/candidates", label: "Review candidates", need: "candidate:view", primary: true },
      { to: "/reports", label: "Reports", need: "report:view" },
      { to: "/interviews", label: "Interviews", need: "interview:view" },
    ],
  },
  interviewer: {
    line: "Your interviews, and the feedback you still owe, come first.",
    actions: [
      { to: "/interviews", label: "My interviews", need: "interview:view", primary: true },
      { to: "/candidates?mine=1", label: "My candidates", need: "candidate:view" },
    ],
  },
  management: {
    line: "The whole hiring picture at a glance - every vacancy, every stage.",
    actions: [
      { to: "/reports", label: "Open reports", need: "report:view", primary: true },
      { to: "/audit", label: "Audit log", need: "audit:view" },
      { to: "/candidates", label: "Candidates", need: "candidate:view" },
    ],
  },
};

function greeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * The "live view" the brief asks for: where every candidate is and how
 * each vacancy is progressing. What is shown depends on the role - an
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
      // Only an interviewer's list is narrowed to their own bookings.
      // This used to narrow anybody who could not SCHEDULE interviews -
      // which included management, who then saw only the interviews
      // they were personally conducting. That is none, so their list was
      // always empty.
      p["interview:view"]
        ? api.listInterviews({ upcoming: 1, ...(user?.role === "interviewer" ? { mine: 1 } : {}) })
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
  // Read the role, do not infer it. This was `!p["candidate:advance"]`,
  // on the assumption that only interviewers cannot advance anyone - but
  // management cannot either. So management was treated as an
  // interviewer: shown "My next interviews", a "Feedback I still owe"
  // tile, and an interview list filtered down to their own (none).
  const isInterviewer = user?.role === "interviewer";
  const welcome = WELCOME[user?.role] || WELCOME.management;
  const shortcuts = welcome.actions.filter((action) => p[action.need]);

  return (
    <div className="page">
      <section className="hero" aria-label="Welcome">
        <div className="hero-glow" aria-hidden="true" />
        <div className="hero-body">
          <span className="hero-role">
            {user?.roleLabel}
            {user?.jobTitle ? " · " + user.jobTitle : ""}
          </span>
          <h1>
            {greeting()}, {user?.name?.split(" ")[0]}
          </h1>
          <p>{welcome.line}</p>
        </div>
        <div className="hero-side">
          <span className="hero-date">
            {new Date().toLocaleDateString(undefined, {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </span>
          <div className="hero-actions">
            {shortcuts.map((action) => (
              <Link
                key={action.to}
                className={"btn " + (action.primary ? "btn-primary" : "btn-glass")}
                to={action.to}
              >
                {action.label}
                {action.primary && <IconArrowRight size={16} />}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <Alert kind="error" onDismiss={() => setError("")}>
        {error}
      </Alert>

      {/* An interviewer cares about their own work first. */}
      {isInterviewer && (
        <div className="grid grid-2 mb-2">
          <Stat
            label="My upcoming interviews"
            value={stats?.myUpcomingInterviews ?? 0}
            icon={IconCalendar}
            tone="sky"
          />
          <Stat
            label="Feedback I still owe"
            value={stats?.myOutstandingFeedback ?? 0}
            icon={IconFile}
            tone="rose"
          />
        </div>
      )}

      <div className="grid grid-4">
        <Stat label="Vacancies" value={stats?.openVacancies ?? 0} icon={IconBriefcase} />
        <Stat label="Candidates" value={stats?.totalCandidates ?? 0} icon={IconUsers} tone="orange" />
        <Stat label="In progress" value={stats?.activeCandidates ?? 0} icon={IconLayers} tone="lime" />
        <Stat
          label="Upcoming interviews"
          value={stats?.upcomingInterviews ?? 0}
          icon={IconCalendar}
          tone="sky"
        />
      </div>

      {p["candidate:band"] && (
        <div className="grid grid-4 mt-2">
          <Stat label="CVs to screen" value={stats?.awaitingScreening ?? 0} icon={IconFile} tone="rose" />
          <Stat label="On hold" value={stats?.onHold ?? 0} icon={IconClock} tone="orange" />
          <Stat label="Hired" value={stats?.hired ?? 0} icon={IconCheck} tone="green" />
          <Stat label="Emails to send" value={stats?.pendingEmails ?? 0} icon={IconMail} tone="sky" />
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
                    ? "New vacancy and add your first candidate."
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
                <h2>Vacancies</h2>
                <Link className="small" to="/vacancies">
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
                        <Link className="cell-title" to={"/vacancies/" + job.id}>
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
                <h2>{isInterviewer ? "My next interviews" : "Interviews"}</h2>
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

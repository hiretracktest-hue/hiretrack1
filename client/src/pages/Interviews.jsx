import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";
import { Alert, Empty, Loading, formatDateTime } from "../components/ui.jsx";

/**
 * Interviews, plus the in-app notifications that tell an interviewer
 * they have been booked. An interviewer lands here to see their own
 * schedule and what feedback they still owe.
 */
export default function Interviews() {
  const { user } = useAuth();
  const canSchedule = Boolean(user?.permissions?.["interview:schedule"]);

  const [interviews, setInterviews] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const [mineOnly, setMineOnly] = useState(!canSchedule);
  const [upcomingOnly, setUpcomingOnly] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (upcomingOnly) params.upcoming = 1;
      if (mineOnly) params.mine = 1;

      const [interviewResult, notificationResult] = await Promise.all([
        api.listInterviews(params),
        api.notifications().catch(() => ({ notifications: [], unread: 0 })),
      ]);
      setInterviews(interviewResult.interviews);
      setNotifications(notificationResult.notifications);
      setUnread(notificationResult.unread);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [upcomingOnly, mineOnly]);

  useEffect(() => {
    load();
  }, [load]);

  async function dismissAll() {
    setBusy(true);
    try {
      await api.markAllNotificationsRead();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id) {
    if (!window.confirm("Cancel this interview? The candidate will be emailed.")) return;
    setBusy(true);
    setError("");
    try {
      await api.cancelInterview(id);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Interviews</h1>
          <p className="subtitle">
            {canSchedule
              ? "Everything booked, earliest first. Book an interview from a candidate's page."
              : "Your interview schedule, and the feedback you still owe."}
          </p>
        </div>
        <div className="btn-row">
          <button className="btn btn-secondary" onClick={() => setMineOnly((c) => !c)}>
            {mineOnly ? "Show everyone's" : "Show only mine"}
          </button>
          <button className="btn btn-secondary" onClick={() => setUpcomingOnly((c) => !c)}>
            {upcomingOnly ? "Include past" : "Upcoming only"}
          </button>
        </div>
      </div>

      <Alert kind="error" onDismiss={() => setError("")}>
        {error}
      </Alert>

      {/* This is how an interviewer is told they have been booked. */}
      {notifications.length > 0 && (
        <div className="card mb-2">
          <div className="card-title">
            <h2>
              Notifications{" "}
              {unread > 0 && <span className="badge badge-amber">{unread} new</span>}
            </h2>
            {unread > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={dismissAll} disabled={busy}>
                Mark all as read
              </button>
            )}
          </div>
          <ul className="list">
            {notifications.slice(0, 6).map((note) => (
              <li key={note.id}>
                <div>
                  <div className="cell-title">
                    {!note.readAt && <span className="unread-dot" />} {note.subject}
                  </div>
                  <div className="cell-sub">{note.body}</div>
                  <div className="cell-sub">{formatDateTime(note.createdAt)}</div>
                </div>
                {note.candidateId && (
                  <Link className="btn btn-secondary btn-sm" to={"/candidates/" + note.candidateId}>
                    Open
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {loading ? (
        <Loading what="interviews" />
      ) : interviews.length === 0 ? (
        <div className="table-wrap">
          <Empty title="Nothing scheduled">
            <p>
              {canSchedule
                ? "Open a candidate and use “Schedule interview” to book one."
                : "You have no interviews booked at the moment."}
            </p>
          </Empty>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Candidate</th>
                <th>Position</th>
                <th>Stage</th>
                <th>Interviewer</th>
                <th>Where</th>
                <th>Feedback</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {interviews.map((interview) => (
                <tr key={interview.id}>
                  <td className="cell-title">{formatDateTime(interview.scheduledAt)}</td>
                  <td>
                    <Link to={"/candidates/" + interview.candidateId}>
                      {interview.candidateName}
                    </Link>
                  </td>
                  <td>{interview.jobTitle}</td>
                  <td>{interview.stage}</td>
                  <td>
                    {interview.interviewerName || "—"}
                    {interview.interviewerEmail && (
                      <div className="cell-sub">{interview.interviewerEmail}</div>
                    )}
                  </td>
                  <td className="cell-sub">{interview.location || "—"}</td>
                  <td>
                    {interview.feedbackGiven ? (
                      <span className="badge badge-green">Given</span>
                    ) : (
                      <span className="badge badge-amber">Outstanding</span>
                    )}
                  </td>
                  <td className="cell-right">
                    <div className="btn-row" style={{ justifyContent: "flex-end" }}>
                      <Link
                        className="btn btn-secondary btn-sm"
                        to={"/candidates/" + interview.candidateId}
                      >
                        Open
                      </Link>
                      {canSchedule && (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => cancel(interview.id)}
                          disabled={busy}
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

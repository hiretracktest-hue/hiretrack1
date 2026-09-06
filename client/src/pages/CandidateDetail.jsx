import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";
import {
  Alert,
  CV_ACCEPT,
  CV_HINT,
  describeCvProblem,
  BAND_LABEL,
  BANDS,
  BandBadge,
  Field,
  Loading,
  OUTCOME_LABEL,
  OutcomeBadge,
  RecommendationBadge,
  Stars,
  formatBytes,
  formatDate,
  formatDateTime,
} from "../components/ui.jsx";

const OUTCOMES = ["ACTIVE", "ON_HOLD", "HIRED", "REJECTED"];
const RECOMMENDATIONS = ["ADVANCE", "HOLD", "REJECT"];

/** One candidate: their CV, where they are in the process, the feedback
 *  from each interviewer, and the interviews booked for them. */
/**
 * An API timestamp in the shape a datetime-local input needs
 * ("YYYY-MM-DDTHH:MM", local time). Anything missing, unreadable or
 * already past comes back as "" so nothing invalid is pre-filled.
 */
function forDateInput(value) {
  if (!value) return "";
  const when = new Date(value);
  if (Number.isNaN(when.getTime()) || when.getTime() < Date.now()) return "";
  const local = new Date(when.getTime() - when.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export default function CandidateDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const p = user?.permissions || {};

  const [candidate, setCandidate] = useState(null);
  const [interviews, setInterviews] = useState([]);
  const [feedback, setFeedback] = useState([]);
  const [interviewers, setInterviewers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [outcome, setOutcome] = useState("ACTIVE");
  const [cvFile, setCvFile] = useState(null);
  const [cvError, setCvError] = useState("");

  const [interviewForm, setInterviewForm] = useState({
    stage: "",
    scheduledAt: "",
    interviewerId: "",
    location: "",
    notes: "",
  });
  // Per-field messages for the booking form, so "date is missing" points
  // at the date box instead of appearing as one banner at the top.
  const [interviewErrors, setInterviewErrors] = useState({});
  const [assigning, setAssigning] = useState(false);
  // The three long forms start folded away. HR's job on this page is to
  // read the CV and screen it; booking a slot and writing feedback are
  // occasional, and leaving all three open is what made this page run
  // off the bottom of the screen.
  // Arriving straight from "Add candidate": open the booking form and
  // say so, because picking the interviewer and the time is the reason
  // we came here - and it is what finally emails the candidate.
  const location = useLocation();
  const arrivedToBook = Boolean(location.state?.bookNow);
  const [showBooking, setShowBooking] = useState(arrivedToBook);
  const [showFeedbackForm, setShowFeedbackForm] = useState(false);
  const [showCvForm, setShowCvForm] = useState(false);
  const [feedbackForm, setFeedbackForm] = useState({
    stage: "",
    rating: 4,
    recommendation: "ADVANCE",
    strengths: "",
    concerns: "",
    comment: "",
  });

  useEffect(() => {
    if (!location.state?.bookNow) return;

    const cvProblem = location.state.cvProblem;
    if (cvProblem) {
      setError(
        "They were added, but the CV did not upload (" +
          cvProblem +
          ") - use “Replace the CV” below to try that part again."
      );
    }
    setMessage("Added. Now choose who will interview them, and when - that is what emails them.");

    // Clear it so a refresh does not repeat the message.
    window.history.replaceState({}, "");
  }, [location.state]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getCandidate(id);
      setCandidate(result.candidate);
      setInterviews(result.interviews);
      setFeedback(result.feedback || []);
      setOutcome(result.candidate.outcome);
      setEditForm({
        fullName: result.candidate.fullName,
        email: result.candidate.email,
        phone: result.candidate.phone || "",
        source: result.candidate.source || "",
        notes: result.candidate.notes || "",
      });
      setInterviewForm((current) => ({
        ...current,
        stage: current.stage || result.candidate.currentStage,
        // Default the booking to whoever owns this candidate. It is the
        // right answer nearly every time, and still changeable.
        interviewerId:
          current.interviewerId || (result.candidate.assignedInterviewerId ?? "") || "",
        // HR already gave a time when they added this person, so do not
        // ask for it twice - fill it in and let them change it if the
        // plan has moved on. A time that has since passed is dropped,
        // because pre-filling a date the form will only refuse is worse
        // than leaving it empty.
        scheduledAt: current.scheduledAt || forDateInput(result.candidate.inviteAt),
      }));
      setFeedbackForm((current) => ({
        ...current,
        stage: current.stage || result.candidate.currentStage,
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api
      .interviewers()
      .then((result) => setInterviewers(result.interviewers))
      .catch(() => {});
  }, []);

  /** Every action refreshes from the server response, so what is on
   *  screen always matches what is in the database. */
  async function run(action, successMessage) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await action();
      if (result?.candidate) setCandidate((current) => ({ ...current, ...result.candidate }));
      if (successMessage) setMessage(successMessage);
      return result;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(event) {
    event.preventDefault();
    const result = await run(() => api.updateCandidate(id, editForm), "Details saved.");
    if (result) setEditing(false);
  }

  async function saveOutcome() {
    const result = await run(
      () => api.updateCandidate(id, { outcome }),
      "Outcome recorded as " + OUTCOME_LABEL[outcome] + "."
    );
    if (result) await load();
  }

  async function setBand(band) {
    await run(() => api.bandCv(id, band, ""), "CV screened as " + BAND_LABEL[band] + ".");
  }

  async function uploadCv(event) {
    event.preventDefault();
    if (!cvFile) return;

    const problem = describeCvProblem(cvFile);
    if (problem) {
      setCvError(problem);
      return;
    }
    const form = event.target;
    const result = await run(() => api.uploadCv(id, cvFile), "CV uploaded.");
    if (result) {
      setCvFile(null);
      setCvError("");
      form.reset();
      setShowCvForm(false);
    }
  }

  async function removeCv() {
    if (!window.confirm("Remove this CV?")) return;
    await run(() => api.deleteCv(id), "CV removed.");
  }

  async function submitFeedback(event) {
    event.preventDefault();
    const result = await run(
      () =>
        api.leaveFeedback({
          candidateId: Number(id),
          ...feedbackForm,
          rating: Number(feedbackForm.rating),
        }),
      "Your feedback was saved."
    );
    if (result?.feedback) {
      // One entry per person per stage: replace mine if already there.
      setFeedback((current) => [
        result.feedback,
        ...current.filter((item) => item.id !== result.feedback.id),
      ]);
      setFeedbackForm((current) => ({ ...current, strengths: "", concerns: "", comment: "" }));
      setShowFeedbackForm(false);
      await load();
    }
  }

  async function removeFeedback(feedbackId) {
    if (!window.confirm("Delete your feedback?")) return;
    const result = await run(() => api.deleteFeedback(feedbackId), "Feedback deleted.");
    if (result) setFeedback((current) => current.filter((item) => item.id !== feedbackId));
  }

  /**
   * Checks the booking form before anything is sent. The server checks
   * all of this again - this exists so the person gets the answer next
   * to the field they got wrong, instead of a round trip and a banner.
   */
  function validateInterview() {
    const problems = {};

    if (!interviewForm.scheduledAt) {
      problems.scheduledAt = "Choose the date and time of the interview.";
    } else {
      const when = new Date(interviewForm.scheduledAt);
      if (Number.isNaN(when.getTime())) {
        problems.scheduledAt = "That is not a real date. Use the picker to choose one.";
      } else if (when.getTime() < Date.now() - 60_000) {
        problems.scheduledAt =
          "That date is not available - it has already passed. Choose a future date and time.";
      }
    }

    if (!interviewForm.interviewerId) {
      problems.interviewerId = "Choose who will run this interview.";
    }

    setInterviewErrors(problems);
    return Object.keys(problems).length === 0;
  }

  async function scheduleInterview(event) {
    event.preventDefault();
    if (!validateInterview()) return;

    // The message is written after the answer comes back, not before,
    // because this is the point the candidate is actually emailed and
    // claiming a delivery that did not happen is worse than saying
    // nothing.
    const result = await run(
      () =>
        api.scheduleInterview({
          candidateId: Number(id),
          ...interviewForm,
        }),
      null
    );

    if (result?.interview) {
      const posted = result.email;
      setMessage(
        "Interview booked, and the interviewer has been asked to confirm. " +
          (posted?.sent
            ? "The invitation has been emailed to " + posted.to + "."
            : "The candidate's invitation is waiting in the Outbox" +
              (posted?.reason ? " (" + posted.reason + ")" : "") +
              ".")
      );
      setInterviews((current) =>
        [...current, result.interview].sort(
          (a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt)
        )
      );
      setInterviewForm((current) => ({ ...current, scheduledAt: "", location: "", notes: "" }));
      setInterviewErrors({});
      setShowBooking(false);
    }
  }

  /** Hand the candidate to an interviewer, or back to the pool. */
  async function assignInterviewer(interviewerId) {
    setAssigning(true);
    const chosen = interviewers.find((person) => String(person.id) === String(interviewerId));
    await run(
      () => api.assignInterviewer(id, interviewerId),
      interviewerId ? "Assigned to " + (chosen?.name || "the interviewer") + "." : "Assignment removed."
    );
    setAssigning(false);
  }

  async function cancelInterview(interviewId) {
    if (!window.confirm("Cancel this interview? The candidate will be emailed.")) return;
    const result = await run(() => api.cancelInterview(interviewId), "Interview cancelled.");
    if (result) setInterviews((current) => current.filter((i) => i.id !== interviewId));
  }

  async function removeCandidate() {
    if (!window.confirm("Delete this candidate and their CV? This cannot be undone.")) return;
    const result = await run(() => api.deleteCandidate(id), null);
    if (result) navigate("/candidates", { replace: true });
  }

  const updateEdit = (key) => (event) =>
    setEditForm((current) => ({ ...current, [key]: event.target.value }));
  const updateInterview = (key) => (event) => {
    setInterviewForm((current) => ({ ...current, [key]: event.target.value }));
    // Take the message away as soon as they start fixing it, rather than
    // leaving it there until the next submit.
    setInterviewErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  /** Now, as the value a datetime-local input expects, for its `min`. */
  function nowForInput() {
    const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000);
    return now.toISOString().slice(0, 16);
  }
  const updateFeedback = (key) => (event) =>
    setFeedbackForm((current) => ({ ...current, [key]: event.target.value }));

  if (loading) return <Loading what="this candidate" />;
  if (!candidate) {
    return (
      <div className="page">
        <Alert kind="error">{error || "That candidate could not be found."}</Alert>
        <Link className="btn btn-secondary" to="/candidates">
          Back to candidates
        </Link>
      </div>
    );
  }

  // Still needed: the feedback form asks which stage the review is for.
  const stages = candidate.stages || [];
  const averageRating = candidate.averageRating;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Link className="small" to="/candidates">
            ← All candidates
          </Link>
          <h1 className="mt-1">{candidate.fullName}</h1>
          <p className="subtitle">
            <Link to={"/vacancies/" + candidate.jobId}>{candidate.jobTitle}</Link> · added{" "}
            {formatDate(candidate.createdAt)}
            {candidate.addedByName ? " by " + candidate.addedByName : ""}
          </p>
        </div>
        <div className="btn-row">
          <BandBadge band={candidate.cvBand} />
          <OutcomeBadge outcome={candidate.outcome} />
          {p["candidate:edit"] && (
            <button className="btn btn-secondary" onClick={() => setEditing((c) => !c)}>
              {editing ? "Cancel edit" : "Edit details"}
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

      {/* The stage pipeline used to sit here: Applied > Screening >
          Interview > Offer, with a "Move to the next one" button. It is
          gone from this screen on purpose. Opening somebody's profile is
          for reading who they are, looking at their CV and putting an
          interviewer on them - not for walking them through a process.

          The stages themselves are untouched: each vacancy still defines
          its own, the candidate still sits on one, and the rule that
          feedback has to be in before anyone moves forward is still
          enforced by the API. What is left here is the one decision this
          page is actually for. */}
      {p["candidate:outcome"] && (
        <div className="card card-tight">
          <div className="row-between">
            <div className="btn-row">
              <select
                className="select"
                style={{ width: "auto" }}
                value={outcome}
                onChange={(event) => setOutcome(event.target.value)}
                aria-label="Outcome"
              >
                {OUTCOMES.map((value) => (
                  <option key={value} value={value}>
                    {OUTCOME_LABEL[value]}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-primary"
                onClick={saveOutcome}
                disabled={busy || outcome === candidate.outcome}
              >
                Record outcome
              </button>
            </div>
            <span className="muted small">
              {averageRating !== null && averageRating !== undefined
                ? "Average score " + averageRating + " / 5"
                : "No scores yet"}
            </span>
          </div>
        </div>
      )}

      <div className="grid grid-sidebar mt-2">
        <div>
          {/* ---- details ---- */}
          <div className="card">
            <h2>Candidate details</h2>

            {editing ? (
              <form onSubmit={saveEdit} className="mt-2">
                <div className="grid grid-2">
                  <Field label="Full name" htmlFor="fullName">
                    <input
                      id="fullName"
                      className="input"
                      required
                      value={editForm.fullName}
                      onChange={updateEdit("fullName")}
                    />
                  </Field>
                  <Field label="Email" htmlFor="email">
                    <input
                      id="email"
                      className="input"
                      type="email"
                      required
                      value={editForm.email}
                      onChange={updateEdit("email")}
                    />
                  </Field>
                  <Field label="Phone" htmlFor="phone">
                    <input
                      id="phone"
                      className="input"
                      value={editForm.phone}
                      onChange={updateEdit("phone")}
                    />
                  </Field>
                  <Field label="Source" htmlFor="source">
                    <input
                      id="source"
                      className="input"
                      value={editForm.source}
                      onChange={updateEdit("source")}
                    />
                  </Field>
                </div>

                <Field label="Internal notes" htmlFor="notes">
                  <textarea
                    id="notes"
                    className="textarea"
                    rows={3}
                    value={editForm.notes}
                    onChange={updateEdit("notes")}
                  />
                </Field>

                <div className="btn-row">
                  <button className="btn btn-primary" disabled={busy}>
                    Save changes
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div className="detail-grid mt-2">
                  <div>
                    <div className="detail-label">Email</div>
                    <div className="detail-value">{candidate.email}</div>
                  </div>
                  <div>
                    <div className="detail-label">Phone</div>
                    <div className="detail-value">{candidate.phone || "—"}</div>
                  </div>
                  <div>
                    <div className="detail-label">Source</div>
                    <div className="detail-value">{candidate.source || "—"}</div>
                  </div>
                  {/* What went out in their invitation, so HR can see
                      what the candidate was actually told. */}
                  {candidate.inviteAt && (
                    <div>
                      <div className="detail-label">Time we gave them</div>
                      <div className="detail-value">{formatDateTime(candidate.inviteAt)}</div>
                    </div>
                  )}
                  {candidate.inviteLink && (
                    <div>
                      <div className="detail-label">Link we sent them</div>
                      <div className="detail-value">
                        <a href={candidate.inviteLink} target="_blank" rel="noreferrer noopener">
                          {candidate.inviteLink}
                        </a>
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-3">
                  <div className="detail-label">Internal notes</div>
                  <p className="detail-value" style={{ whiteSpace: "pre-wrap" }}>
                    {candidate.notes || "—"}
                  </p>
                </div>

                {/* Who owns this candidate. They see them under “Only
                    mine” on the Candidates page straight away, before
                    any interview has been booked. */}
                <div className="mt-3">
                  <div className="detail-label">Assigned interviewer</div>
                  {p["candidate:assign"] ? (
                    <div className="btn-row mt-1">
                      <select
                        className="select"
                        style={{ width: "auto", minWidth: 240 }}
                        value={candidate.assignedInterviewerId ?? ""}
                        onChange={(event) => assignInterviewer(event.target.value)}
                        disabled={assigning || busy}
                        aria-label="Assign an interviewer to this candidate"
                      >
                        <option value="">Nobody assigned</option>
                        {interviewers.map((person) => (
                          <option key={person.id} value={person.id}>
                            {person.name} ({person.roleLabel})
                          </option>
                        ))}
                      </select>
                      {candidate.assignedInterviewerName && (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => assignInterviewer("")}
                          disabled={assigning || busy}
                        >
                          Unassign
                        </button>
                      )}
                    </div>
                  ) : (
                    <p className="detail-value">
                      {candidate.assignedInterviewerName || "Nobody yet"}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>

          {/* ---- feedback ---- */}
          <div className="card">
            <div className="card-title">
              <h2>Interview feedback</h2>
              <div className="btn-row">
                <span className="muted small">
                  {feedback.length} review{feedback.length === 1 ? "" : "s"}
                </span>
                {p["feedback:write"] && (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setShowFeedbackForm((c) => !c)}
                  >
                    {showFeedbackForm ? "Cancel" : "+ Leave feedback"}
                  </button>
                )}
              </div>
            </div>

            {feedback.length > 0 && (
              <div className="mb-2">
                {feedback.map((item) => (
                  <div className="feedback-item" key={item.id}>
                    <div className="row-between">
                      <div>
                        <strong>{item.authorName || "Unknown"}</strong>{" "}
                        <span className="small muted">· {item.stage}</span>
                      </div>
                      <div className="btn-row">
                        <Stars value={item.rating} />
                        <RecommendationBadge value={item.recommendation} />
                      </div>
                    </div>

                    {item.strengths && (
                      <p className="small mt-1">
                        <strong>Strengths:</strong> {item.strengths}
                      </p>
                    )}
                    {item.concerns && (
                      <p className="small">
                        <strong>Concerns:</strong> {item.concerns}
                      </p>
                    )}
                    {item.comment && <p className="small mt-1">{item.comment}</p>}

                    <div className="row-between mt-1">
                      <span className="cell-sub">{formatDateTime(item.createdAt)}</span>
                      {item.authorId === user?.id && (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => removeFeedback(item.id)}
                          disabled={busy}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!p["feedback:write"] && feedback.length === 0 && (
              <p className="muted small">Your role can read feedback but not write it.</p>
            )}

            {p["feedback:write"] && showFeedbackForm && (
              <form onSubmit={submitFeedback}>
                <div className="grid grid-3">
                  <Field label="Stage" htmlFor="feedbackStage">
                    <select
                      id="feedbackStage"
                      className="select"
                      value={feedbackForm.stage}
                      onChange={updateFeedback("stage")}
                    >
                      {stages.map((stage) => (
                        <option key={stage} value={stage}>
                          {stage}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Rating (1-5)" htmlFor="rating">
                    <select
                      id="rating"
                      className="select"
                      value={feedbackForm.rating}
                      onChange={updateFeedback("rating")}
                    >
                      {[1, 2, 3, 4, 5].map((value) => (
                        <option key={value} value={value}>
                          {value} / 5
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Recommendation" htmlFor="recommendation">
                    <select
                      id="recommendation"
                      className="select"
                      value={feedbackForm.recommendation}
                      onChange={updateFeedback("recommendation")}
                    >
                      {RECOMMENDATIONS.map((value) => (
                        <option key={value} value={value}>
                          {value.charAt(0) + value.slice(1).toLowerCase()}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

                <div className="grid grid-2">
                  <Field label="Strengths" htmlFor="strengths">
                    <textarea
                      id="strengths"
                      className="textarea"
                      rows={2}
                      placeholder="What went well?"
                      value={feedbackForm.strengths}
                      onChange={updateFeedback("strengths")}
                    />
                  </Field>
                  <Field label="Concerns" htmlFor="concerns">
                    <textarea
                      id="concerns"
                      className="textarea"
                      rows={2}
                      placeholder="Anything that worried you?"
                      value={feedbackForm.concerns}
                      onChange={updateFeedback("concerns")}
                    />
                  </Field>
                </div>

                <Field label="Overall comment" htmlFor="comment">
                  <textarea
                    id="comment"
                    className="textarea"
                    rows={2}
                    value={feedbackForm.comment}
                    onChange={updateFeedback("comment")}
                  />
                </Field>

                <button className="btn btn-primary" disabled={busy}>
                  Save my feedback
                </button>
                <p className="field-hint">
                  Everyone scores out of 5 with the same options, which is what makes the
                  side-by-side comparison fair. Saving again updates the score you already left.
                </p>
              </form>
            )}

            {feedback.length === 0 && !showFeedbackForm && p["feedback:write"] && (
              <p className="muted small">No reviews yet.</p>
            )}
          </div>

          {/* ---- interviews ---- */}
          <div className="card">
            <div className="card-title">
              <h2>Interviews</h2>
              <div className="btn-row">
                <span className="muted small">{interviews.length} booked</span>
                {p["interview:schedule"] && (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setShowBooking((c) => !c)}
                  >
                    {showBooking ? "Cancel" : "+ Book interview"}
                  </button>
                )}
              </div>
            </div>

            {interviews.length === 0 && !showBooking && (
              <p className="muted small">Nothing booked yet.</p>
            )}

            {interviews.length > 0 && (
              <ul className="list mb-2">
                {interviews.map((iv) => (
                  <li key={iv.id}>
                    <div>
                      <div className="cell-title">
                        {iv.stage} · {formatDateTime(iv.scheduledAt)}
                      </div>
                      <div className="cell-sub">
                        {iv.interviewerName || "Interviewer not set"}
                        {iv.location ? " · " + iv.location : ""}
                      </div>
                      {iv.notes && <div className="cell-sub">{iv.notes}</div>}
                    </div>
                    {p["interview:schedule"] && (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => cancelInterview(iv.id)}
                        disabled={busy}
                      >
                        Cancel
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {/* noValidate turns the browser's own pop-up off. The inputs still
                carry min/type so the picker and keyboard behave, but the
                message the person reads is ours - "that date is not
                available" rather than "Value must be ... or later". */}
            {p["interview:schedule"] && showBooking && (
              <form onSubmit={scheduleInterview} noValidate>
                <div className="grid grid-2">
                  <Field label="Stage" htmlFor="stage">
                    <select
                      id="stage"
                      className="select"
                      value={interviewForm.stage}
                      onChange={updateInterview("stage")}
                    >
                      {stages.map((stage) => (
                        <option key={stage} value={stage}>
                          {stage}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    label="Date and time"
                    htmlFor="scheduledAt"
                    error={interviewErrors.scheduledAt}
                  >
                    <input
                      id="scheduledAt"
                      className={"input" + (interviewErrors.scheduledAt ? " input-error" : "")}
                      type="datetime-local"
                      // Stops most past dates at the picker. It is not the
                      // safeguard - the server checks again - but it means
                      // the mistake is usually impossible to make.
                      min={nowForInput()}
                      value={interviewForm.scheduledAt}
                      onChange={updateInterview("scheduledAt")}
                      aria-invalid={Boolean(interviewErrors.scheduledAt)}
                    />
                  </Field>
                  <Field
                    label="Interviewer"
                    htmlFor="interviewerId"
                    hint={
                      interviewErrors.interviewerId
                        ? undefined
                        : "They are notified in the app straight away."
                    }
                    error={interviewErrors.interviewerId}
                  >
                    <select
                      id="interviewerId"
                      className={"select" + (interviewErrors.interviewerId ? " input-error" : "")}
                      value={interviewForm.interviewerId}
                      onChange={updateInterview("interviewerId")}
                      aria-invalid={Boolean(interviewErrors.interviewerId)}
                    >
                      <option value="">Choose an interviewer…</option>
                      {interviewers.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.name} ({person.roleLabel})
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Where" htmlFor="location">
                    <input
                      id="location"
                      className="input"
                      placeholder="Meeting room 2, or a video link"
                      value={interviewForm.location}
                      onChange={updateInterview("location")}
                    />
                  </Field>
                </div>

                <Field label="Notes for the invitation" htmlFor="interviewNotes">
                  <textarea
                    id="interviewNotes"
                    className="textarea"
                    rows={2}
                    placeholder="Format, what to prepare, who else will attend…"
                    value={interviewForm.notes}
                    onChange={updateInterview("notes")}
                  />
                </Field>

                <button className="btn btn-primary" disabled={busy}>
                  Book interview
                </button>
                <p className="field-hint">
                  Booking notifies the interviewer in the app and writes the candidate's invitation
                  email into the outbox for you to send.
                </p>
              </form>
            )}
          </div>
        </div>

        {/* ---- sidebar: CV ---- */}
        <div>
          <div className="card">
            <div className="card-title">
              <h2>CV</h2>
              <BandBadge band={candidate.cvBand} />
            </div>

            {candidate.cv ? (
              <div className="mt-2">
                <div className="stack">
                  <a className="cell-title" href={api.cvDownloadUrl(candidate.id)}>
                    {candidate.cv.filename}
                  </a>
                  <span className="cell-sub">
                    {formatBytes(candidate.cv.size)} · uploaded {formatDate(candidate.cv.uploadedAt)}
                  </span>
                </div>
                <div className="btn-row mt-2">
                  <a className="btn btn-secondary btn-sm" href={api.cvDownloadUrl(candidate.id)}>
                    Download
                  </a>
                  {p["candidate:uploadCv"] && (
                    <button className="btn btn-ghost btn-sm" onClick={removeCv} disabled={busy}>
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <p className="muted small mt-1">No CV on file yet.</p>
            )}

            {p["candidate:band"] && (
              <div className="mt-3">
                <div className="detail-label">Screening band</div>
                <p className="field-hint">
                  One quick judgement so a large pile can be filtered instead of re-read.
                </p>
                <div className="btn-row mt-1">
                  {BANDS.map((value) => (
                    <button
                      key={value}
                      className={
                        "btn btn-sm " + (candidate.cvBand === value ? "btn-primary" : "btn-secondary")
                      }
                      onClick={() => setBand(value)}
                      disabled={busy}
                    >
                      {BAND_LABEL[value]}
                    </button>
                  ))}
                </div>
                {candidate.bandedByName && (
                  <p className="field-hint">
                    Screened by {candidate.bandedByName}
                    {candidate.cvBandedAt ? " on " + formatDate(candidate.cvBandedAt) : ""}.
                  </p>
                )}
              </div>
            )}

            {/* A CV is put on when the candidate is added, so this is
                only ever a replacement - folded away unless it is
                actually missing, or asked for. */}
            {p["candidate:uploadCv"] && candidate.cv && !showCvForm && (
              <button
                className="btn btn-ghost btn-sm mt-2"
                onClick={() => setShowCvForm(true)}
              >
                Replace the CV
              </button>
            )}

            {p["candidate:uploadCv"] && (!candidate.cv || showCvForm) && (
              <form onSubmit={uploadCv} className="mt-3">
                <Field
                  label={candidate.cv ? "Replace the CV" : "Upload their CV"}
                  htmlFor="cv"
                  hint={CV_HINT}
                  error={cvError}
                >
                  <input
                    id="cv"
                    className={"input" + (cvError ? " input-error" : "")}
                    type="file"
                    accept={CV_ACCEPT}
                    onChange={(event) => {
                      const chosen = event.target.files?.[0] || null;
                      setCvFile(chosen);
                      // Say so as soon as the wrong file is picked, not
                      // after it has been sent up and refused.
                      setCvError(chosen ? describeCvProblem(chosen) || "" : "");
                    }}
                    aria-invalid={Boolean(cvError)}
                  />
                </Field>
                <button className="btn btn-primary btn-block" disabled={busy || !cvFile || Boolean(cvError)}>
                  {busy ? "Uploading…" : candidate.cv ? "Replace CV" : "Upload CV"}
                </button>
              </form>
            )}
          </div>

          {p["candidate:delete"] && (
            <button
              className="btn btn-ghost btn-sm btn-danger-text mt-2"
              onClick={removeCandidate}
              disabled={busy}
              title="Removes their record, CV, interviews and feedback."
            >
              Delete candidate
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

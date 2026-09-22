import { useState } from "react";
import { api } from "../api.js";
import { Alert } from "./ui.jsx";

/**
 * CAN-04 - "move a candidate to the next stage or reject them, so that
 * their progress reflects the real hiring decision."
 *
 * Put back after the stage and outcome controls came off the candidate
 * page on 9 September. With them gone nothing on the screens could move
 * a candidate on or record a decision - which left WF-02 with no button
 * to block, FB-02 with no decision for an interviewer to see, and
 * COM-01 with no hire to send a letter about.
 *
 * Two parts, shown only to the roles allowed to use them:
 *
 *   MOVE ON   the next stage, or - when the feedback rule says not yet -
 *             a disabled button that says exactly who it is waiting on.
 *             The reason comes from the server (candidate.advance), the
 *             same check that guards the action, so the page cannot
 *             offer a move the server would then refuse.
 *   DECISION  hire, reject, hold, or back to active. After a hire or a
 *             rejection it reports whether the candidate's letter went.
 */
export default function Progress({ candidate, permissions, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const stages = candidate.stages || [];
  const current = stages.indexOf(candidate.currentStage);
  const decided = candidate.outcome === "HIRED" || candidate.outcome === "REJECTED";
  const check = candidate.advance || {};
  const canMove = Boolean(permissions["candidate:advance"]);
  const canDecide = Boolean(permissions["candidate:outcome"]);

  async function moveOn() {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      await api.advanceCandidate(candidate.id);
      setResult({ kind: "success", text: "Moved to " + check.nextStage + "." });
      await onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function decide(outcome) {
    // A hire or a rejection writes to the candidate, so it is confirmed
    // first. Holding someone, or reopening them, is not.
    const warn = {
      HIRED: "Record " + candidate.fullName + " as HIRED? Their offer letter is sent now.",
      REJECTED: "Record " + candidate.fullName + " as REJECTED? They are told by email now.",
    }[outcome];
    if (warn && !window.confirm(warn)) return;

    setBusy(true);
    setError("");
    setResult(null);
    try {
      const reply = await api.recordOutcome(candidate.id, outcome);
      setResult(describe(outcome, reply.email));
      await onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card progress-card">
      <div className="card-title">
        <h2>Progress</h2>
        <span className="muted small">
          Stage {current + 1} of {stages.length}
        </span>
      </div>

      <ol className="stage-track" aria-label="Interview stages">
        {stages.map((stage, i) => {
          const state = decided
            ? i <= current
              ? "done"
              : "skipped"
            : i < current
              ? "done"
              : i === current
                ? "current"
                : "todo";
          return (
            <li key={stage} className={"stage-dot is-" + state}>
              <span className="stage-marker" aria-hidden="true">
                {state === "done" ? "✓" : i + 1}
              </span>
              <span className="stage-name">{stage}</span>
              {state === "current" && <span className="sr-only"> (current stage)</span>}
            </li>
          );
        })}
      </ol>

      {error && (
        <Alert kind="error" onDismiss={() => setError("")}>
          {error}
        </Alert>
      )}
      {result && (
        <Alert kind={result.kind} onDismiss={() => setResult(null)}>
          {result.text}
        </Alert>
      )}

      {/* ---- move on (WF-02) ---- */}
      {canMove && !decided && (
        <div className="progress-row">
          {check.allowed ? (
            <button className="btn btn-primary" onClick={moveOn} disabled={busy}>
              Move to {check.nextStage} →
            </button>
          ) : (
            <>
              <button className="btn btn-primary" disabled aria-describedby="why-blocked">
                {check.nextStage ? "Move to " + check.nextStage + " →" : "Final stage reached"}
              </button>
              <p id="why-blocked" className="progress-blocked">
                <span aria-hidden="true">⏳ </span>
                {check.reason}
              </p>
            </>
          )}
        </div>
      )}

      {decided && (
        <p className="progress-decided">
          A decision has been recorded, so {candidate.fullName.split(" ")[0]} no longer moves
          between stages.
        </p>
      )}

      {/* ---- decision (CAN-04) ---- */}
      {canDecide && (
        <div className="decision">
          <div className="decision-label">Decision</div>
          <div className="btn-row">
            {candidate.outcome !== "HIRED" && (
              <button className="btn btn-hire" onClick={() => decide("HIRED")} disabled={busy}>
                Hire
              </button>
            )}
            {candidate.outcome !== "REJECTED" && (
              <button className="btn btn-reject" onClick={() => decide("REJECTED")} disabled={busy}>
                Reject
              </button>
            )}
            {candidate.outcome !== "ON_HOLD" && !decided && (
              <button className="btn btn-secondary" onClick={() => decide("ON_HOLD")} disabled={busy}>
                Put on hold
              </button>
            )}
            {candidate.outcome !== "ACTIVE" && (
              <button className="btn btn-ghost" onClick={() => decide("ACTIVE")} disabled={busy}>
                Back to active
              </button>
            )}
          </div>
          <p className="field-hint">
            Hiring or rejecting emails the candidate straight away, tells HR and management, and
            tells everyone who interviewed them.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Turn the server's account of the email into one honest sentence.
 * "Recorded as hired" alone would let HR assume the candidate knows.
 */
function describe(outcome, email) {
  const label = { HIRED: "hired", REJECTED: "rejected", ON_HOLD: "on hold", ACTIVE: "active" }[
    outcome
  ];
  const base = "Recorded as " + label + ".";

  if (!email?.attempted) return { kind: "success", text: base };
  if (email.sent) {
    return {
      kind: "success",
      text:
        base +
        " The " +
        (outcome === "HIRED" ? "offer letter" : "letter") +
        " was emailed to " +
        email.to +
        ".",
    };
  }
  return {
    kind: "info",
    text:
      base +
      " The email to " +
      email.to +
      " was NOT sent: " +
      (email.reason || "no mail provider is configured") +
      " It is waiting in the Outbox, where it can be sent once that is fixed.",
  };
}

import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { Alert, Field, Loading, formatDateTime } from "../components/ui.jsx";

/**
 * Where the Accept / Decline link in an interview email lands.
 *
 * Reachable signed out - the token in the URL is the authorisation, and
 * it is good for this one booking only. The link does NOT answer
 * anything by itself: this page shows what is being asked and waits for
 * a click, so a link followed by accident (or prefetched by a mail
 * client) commits nobody to anything.
 *
 * ?reply=accept or ?reply=decline just preselects which button is
 * highlighted, matching whichever one they pressed in the email.
 */
export default function Invite() {
  const { token } = useParams();
  const [searchParams] = useSearchParams();
  const intent = searchParams.get("reply");

  const [invite, setInvite] = useState(null);
  const [note, setNote] = useState("");
  const [showDecline, setShowDecline] = useState(intent === "decline");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getInvite(token);
      setInvite(result.invite);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function answer(response) {
    setBusy(true);
    setError("");
    try {
      const result = await api.respondToInvite(token, response, note);
      setInvite(result.invite);
      setDone(response);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading what="your invitation" />;

  if (!invite) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <Head />
          <Alert kind="error">{error || "This invitation link is not valid."}</Alert>
          <p className="auth-foot">
            If you think this is a mistake, ask HR to send the invitation again.
          </p>
        </div>
      </div>
    );
  }

  const answered = invite.response !== "PENDING";
  const accepted = invite.response === "ACCEPTED";

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <Head />

        <Alert kind="error" onDismiss={() => setError("")}>
          {error}
        </Alert>

        {answered && (
          <Alert kind={accepted ? "success" : "info"}>
            {done
              ? accepted
                ? "Thank you — you are confirmed. HR has been told, and the candidate is being sent a confirmation."
                : "That is noted. HR has been told so they can arrange somebody else."
              : accepted
                ? "You already accepted this interview."
                : "You already declined this interview."}
          </Alert>
        )}

        <h1 className="invite-title">
          {answered ? "Interview details" : "Can you take this interview?"}
        </h1>

        <dl className="invite-details">
          <Row label="Candidate" value={invite.candidateName} />
          <Row label="Position" value={invite.jobTitle} />
          <Row label="Stage" value={invite.stage} />
          <Row label="Date and time" value={formatDateTime(invite.scheduledAt)} />
          <Row label="Location" value={invite.location || "To be confirmed"} />
          <Row label="Notes" value={invite.notes} />
          <Row label="Interviewer" value={invite.interviewerName} />
        </dl>

        {!answered && (
          <>
            {showDecline && (
              <Field label="Why can you not take it?" htmlFor="note">
                <textarea
                  id="note"
                  className="input"
                  rows={3}
                  placeholder="HR sees this, so they can rebook or move the time."
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </Field>
            )}

            <div className="btn-row">
              <button
                className="btn btn-primary"
                onClick={() => answer("ACCEPTED")}
                disabled={busy}
              >
                {busy ? "Saving…" : "Accept"}
              </button>
              {showDecline ? (
                <button
                  className="btn btn-secondary"
                  onClick={() => answer("DECLINED")}
                  disabled={busy}
                >
                  Confirm decline
                </button>
              ) : (
                <button
                  className="btn btn-secondary"
                  onClick={() => setShowDecline(true)}
                  disabled={busy}
                >
                  Decline
                </button>
              )}
            </div>
          </>
        )}

        <p className="auth-foot">
          {answered
            ? "You can close this page. Sign in to Altrium to leave your feedback afterwards."
            : "Nothing is recorded until you choose. Your answer goes straight to HR."}
        </p>
      </div>
    </div>
  );
}

function Head() {
  return (
    <div className="auth-head">
      <span className="brand">
        <span className="brand-mark">AL</span>
        Altrium
      </span>
    </div>
  );
}

function Row({ label, value }) {
  if (!value) return null;
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { Alert, Empty, Loading, formatDateTime } from "../components/ui.jsx";

/**
 * "How are candidates told about a scheduled interview?"
 *
 * Candidates do not have accounts here, so they are told by email. This
 * project has no mail server, so every message the system would send is
 * written to this outbox: HR reads it, sends it with one click (which
 * opens their own mail client), and marks it sent. Nothing is silently
 * dropped and nothing pretends to have been delivered.
 */
export default function Outbox() {
  const [messages, setMessages] = useState([]);
  const [pending, setPending] = useState(0);
  const [pendingOnly, setPendingOnly] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.outbox(pendingOnly ? { pending: 1 } : {});
      setMessages(result.messages);
      setPending(result.pending);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [pendingOnly]);

  useEffect(() => {
    load();
  }, [load]);

  async function markSent(id) {
    setBusy(true);
    setError("");
    try {
      await api.markEmailSent(id);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function mailtoLink(message) {
    return (
      "mailto:" +
      encodeURIComponent(message.recipientEmail) +
      "?subject=" +
      encodeURIComponent(message.subject) +
      "&body=" +
      encodeURIComponent(message.body)
    );
  }

  async function copy(message) {
    try {
      await navigator.clipboard.writeText(message.body);
    } catch {
      // Clipboard is blocked on insecure origins; the text is selectable.
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Candidate outbox</h1>
          <p className="subtitle">
            Candidates do not have accounts, so they are told by email. Every message the system
            would send is prepared here for you to send and tick off.
          </p>
        </div>
        <button className="btn btn-secondary" onClick={() => setPendingOnly((c) => !c)}>
          {pendingOnly ? "Show sent messages too" : "Show unsent only"}
        </button>
      </div>

      <Alert kind="error" onDismiss={() => setError("")}>
        {error}
      </Alert>

      {pending > 0 && (
        <Alert kind="info">
          {pending} message{pending === 1 ? "" : "s"} waiting to be sent.
        </Alert>
      )}

      {loading ? (
        <Loading what="the outbox" />
      ) : messages.length === 0 ? (
        <div className="card">
          <Empty title={pendingOnly ? "Nothing waiting to be sent" : "No messages yet"}>
            <p>
              Messages are created automatically when an interview is scheduled or cancelled, and
              when a candidate is hired or rejected.
            </p>
          </Empty>
        </div>
      ) : (
        <div>
          {messages.map((message) => (
            <div className="card" key={message.id}>
              <div className="card-title">
                <div>
                  <h2>{message.subject}</h2>
                  <div className="cell-sub">
                    To {message.recipientName} &lt;{message.recipientEmail}&gt; ·{" "}
                    {formatDateTime(message.createdAt)}
                    {message.candidateName && (
                      <>
                        {" · "}
                        <Link to={"/candidates/" + message.candidateId}>{message.candidateName}</Link>
                      </>
                    )}
                  </div>
                </div>
                {message.sentAt ? (
                  <span className="badge badge-green">Sent {formatDateTime(message.sentAt)}</span>
                ) : (
                  <span className="badge badge-amber">Not sent</span>
                )}
              </div>

              {openId === message.id ? (
                <pre className="email-body">{message.body}</pre>
              ) : (
                <p className="small muted">{message.body.split("\n")[0]}…</p>
              )}

              <div className="btn-row mt-2">
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setOpenId(openId === message.id ? null : message.id)}
                >
                  {openId === message.id ? "Hide message" : "Read message"}
                </button>
                <a className="btn btn-primary btn-sm" href={mailtoLink(message)}>
                  Open in email
                </a>
                <button className="btn btn-secondary btn-sm" onClick={() => copy(message)}>
                  Copy text
                </button>
                {!message.sentAt && (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => markSent(message.id)}
                    disabled={busy}
                  >
                    Mark as sent
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

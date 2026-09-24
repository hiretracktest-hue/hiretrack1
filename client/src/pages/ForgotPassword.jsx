import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { Alert, Field } from "../components/ui.jsx";
import AuthShell from "../components/AuthShell.jsx";
import Logo from "../components/Logo.jsx";
import { IconMail } from "../components/icons.jsx";

/**
 * "Forgot your password?" - asks for the email, and the server emails a
 * one-time link to choose a new one.
 *
 * The answer is the same whether or not the address has an account, so
 * the form cannot be used to find out who works here.
 */
export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [message, setMessage] = useState("");
  const [devLink, setDevLink] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setDevLink("");
    setBusy(true);
    try {
      const result = await api.forgotPassword({ email });
      setMessage(result.message);
      setSentTo(email);
      // Only on a computer with no email set up: the link comes back to
      // the page so the flow can still be tried. The live site never
      // does this - there the email is the only way to the link.
      if (result.devResetUrl) setDevLink(result.devResetUrl);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <AuthShell>
        <div className="auth-head">
          <span className="brand auth-brand-mobile">
            <Logo size={32} />
          </span>
          <span className="auth-sent-icon" aria-hidden="true">
            <IconMail size={26} />
          </span>
          <h1>Check your inbox</h1>
          <p>
            We sent the request for <strong>{sentTo}</strong>. {message}
          </p>
        </div>

        {devLink && (
          <div className="alert alert-info">
            <strong>No email could be sent from this computer</strong>, so here is the link:
            <div className="mt-1">
              <Link className="break" to={devLink.replace(/^https?:\/\/[^/]+/, "")}>
                {devLink}
              </Link>
            </div>
          </div>
        )}

        <button
          type="button"
          className="btn btn-secondary btn-block"
          onClick={() => {
            setSentTo("");
            setMessage("");
            setDevLink("");
          }}
        >
          Use a different email
        </button>

        <p className="auth-foot">
          Remembered it? <Link to="/signin">Back to sign in</Link>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="auth-head">
        <span className="brand auth-brand-mobile">
          <Logo size={32} />
        </span>
        <h1>Forgot your password?</h1>
        <p>Enter the email you sign in with and we will email you a link to choose a new one.</p>
      </div>

      <Alert kind="error">{error}</Alert>

      <form onSubmit={handleSubmit}>
        <Field label="Email address" htmlFor="email">
          <input
            id="email"
            className="input"
            type="email"
            required
            autoComplete="email"
            placeholder="you@hiretrack.lk"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>

        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "Sending…" : "Email me a reset link"}
        </button>
      </form>

      <p className="auth-foot">
        Remembered it? <Link to="/signin">Back to sign in</Link>
      </p>
    </AuthShell>
  );
}

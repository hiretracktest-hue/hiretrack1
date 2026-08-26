import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { Alert, Field } from "../components/ui.jsx";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [devLink, setDevLink] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    setDevLink("");
    setBusy(true);
    try {
      const result = await api.forgotPassword({ email });
      setMessage(result.message);
      // The project has no mail server, so in development the API hands
      // the link straight back and we show it here.
      if (result.devResetUrl) setDevLink(result.devResetUrl);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-head">
          <span className="brand">
            <span className="brand-mark">AL</span>
            Altrium
          </span>
          <h1>Forgot your password?</h1>
          <p>Enter your email and we will create a reset link for you.</p>
        </div>

        <Alert kind="error">{error}</Alert>
        <Alert kind="success">{message}</Alert>

        {devLink && (
          <div className="alert alert-info">
            <strong>Development mode:</strong> no email server is configured, so use this link
            directly.
            <div className="mt-1">
              <Link className="break" to={devLink.replace(window.location.origin, "")}>
                {devLink}
              </Link>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <Field label="Email address" htmlFor="email">
            <input
              id="email"
              className="input"
              type="email"
              required
              autoComplete="email"
              placeholder="you@gmail.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>

          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? "Working…" : "Send reset link"}
          </button>
        </form>

        <p className="auth-foot">
          Remembered it? <Link to="/signin">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}

import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { Alert, Field, PasswordInput } from "../components/ui.jsx";

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token") || "";

  const [form, setForm] = useState({ password: "", confirm: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function update(key) {
    return (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    if (form.password !== form.confirm) {
      setError("The two passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      await api.resetPassword({ token, password: form.password });
      navigate("/signin?reset=1", { replace: true });
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
            <span className="brand-mark">HT</span>
            HireTrack
          </span>
          <h1>Choose a new password</h1>
          <p>This link can only be used once.</p>
        </div>

        <Alert kind="error">{error}</Alert>

        {!token ? (
          <Alert kind="error">
            This page needs a reset token in the address. Please open the link from your reset email
            again.
          </Alert>
        ) : (
          <form onSubmit={handleSubmit}>
            <Field
              label="New password"
              htmlFor="password"
              hint="At least 8 characters, with one letter and one number."
            >
              <PasswordInput
                id="password"
                autoComplete="new-password"
                value={form.password}
                onChange={update("password")}
              />
            </Field>

            <Field label="Confirm new password" htmlFor="confirm">
              <PasswordInput
                id="confirm"
                autoComplete="new-password"
                placeholder="Type it again"
                value={form.confirm}
                onChange={update("confirm")}
              />
            </Field>

            <button className="btn btn-primary btn-block" disabled={busy}>
              {busy ? "Updating…" : "Update password"}
            </button>
          </form>
        )}

        <p className="auth-foot">
          <Link to="/forgot-password">Request a new link</Link> · <Link to="/signin">Sign in</Link>
        </p>
      </div>
    </div>
  );
}

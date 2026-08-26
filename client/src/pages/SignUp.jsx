import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext.jsx";
import { Alert, Field, PasswordInput } from "../components/ui.jsx";
import { GoogleMark } from "./SignIn.jsx";

export default function SignUp() {
  const { signUp, googleEnabled } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "" });
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
      await signUp({ name: form.name, email: form.email, password: form.password });
      // Everyone who signs up here is a candidate. Staff accounts are
      // created by HR from the team page.
      navigate(location.state?.from || "/careers", { replace: true });
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
          <h1>Create your account</h1>
          <p>Create an account to apply for a job and follow your application.</p>
        </div>

        <Alert kind="error">{error}</Alert>

        <form onSubmit={handleSubmit}>
          <Field label="Full name" htmlFor="name">
            <input
              id="name"
              className="input"
              required
              minLength={2}
              maxLength={120}
              autoComplete="name"
              placeholder="Ahmed Asmi"
              value={form.name}
              onChange={update("name")}
            />
          </Field>

          <Field label="Email address" htmlFor="email">
            <input
              id="email"
              className="input"
              type="email"
              required
              autoComplete="email"
              placeholder="you@gmail.com"
              value={form.email}
              onChange={update("email")}
            />
          </Field>

          <Field
            label="Password"
            htmlFor="password"
            hint="At least 8 characters, with one letter and one number."
          >
            <PasswordInput
              id="password"
              autoComplete="new-password"
              minLength={8}
              value={form.password}
              onChange={update("password")}
            />
          </Field>

          <Field label="Confirm password" htmlFor="confirm">
            <PasswordInput
              id="confirm"
              autoComplete="new-password"
              placeholder="Type it again"
              minLength={8}
              value={form.confirm}
              onChange={update("confirm")}
            />
          </Field>

          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? "Creating account…" : "Create account"}
          </button>
        </form>

        {googleEnabled && (
          <>
            <div className="divider">or</div>
            <a className="btn btn-google" href="/api/auth/google">
              <GoogleMark />
              Sign up with Google
            </a>
          </>
        )}

        <p className="auth-foot">
          Already have an account? <Link to="/signin">Sign in</Link>
        </p>
      </div>
    </div>
  );
}

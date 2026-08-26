import { useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../AuthContext.jsx";
import { Alert, Field, PasswordInput } from "../components/ui.jsx";

const GOOGLE_ERRORS = {
  google_state: "That Google sign-in attempt expired. Please try again.",
  google_token: "Google did not accept the sign-in. Please try again.",
  google_profile: "We could not read your Google profile. Please try again.",
  google_email: "Your Google account did not share an email address.",
  google_unknown: "That Google account is not registered here. Ask HR to create your account.",
};

export default function SignIn() {
  const { signIn, googleEnabled } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState(GOOGLE_ERRORS[searchParams.get("error")] || "");
  const [busy, setBusy] = useState(false);

  const justReset = searchParams.get("reset") === "1";

  function update(key) {
    return (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await signIn(form);
      navigate(location.state?.from || "/dashboard", { replace: true });
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
          <h1>Welcome back</h1>
          <p>Sign in to manage positions and candidates.</p>
        </div>

        {justReset && <Alert kind="success">Password updated. Sign in with your new password.</Alert>}
        <Alert kind="error">{error}</Alert>

        <form onSubmit={handleSubmit}>
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

          <Field label="Password" htmlFor="password">
            <PasswordInput
              id="password"
              autoComplete="current-password"
              placeholder="Your password"
              value={form.password}
              onChange={update("password")}
            />
          </Field>

          <div className="row-between mb-2">
            <span />
            <Link to="/forgot-password" className="small">
              Forgot your password?
            </Link>
          </div>

          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        {googleEnabled && (
          <>
            <div className="divider">or</div>
            {/* A normal link, not fetch(): the browser has to follow
                Google's redirect for OAuth to work. */}
            <a className="btn btn-google" href="/api/auth/google">
              <GoogleMark />
              Continue with Google
            </a>
          </>
        )}

        <div className="auth-note">
          <strong>There is no sign-up.</strong> Altrium Recruitment is an internal system. HR
          creates every account and sets what it can do, so only an email address HR
          has already added can sign in — any other address is turned away.
          <br />
          <br />
          Job candidates do not get an account. HR adds them and uploads their CV.
        </div>
      </div>
    </div>
  );
}

export function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.1-3.8 6.6-9.4 6.6-16.1z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.9 0 10.9-2 14.5-5.4l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.5-3.8-12.2-9H4.5v5.7C8.1 41.1 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.8 28.2c-.4-1.3-.7-2.7-.7-4.2s.3-2.9.7-4.2v-5.7H4.5C3 17.1 2.1 20.4 2.1 24s.9 6.9 2.4 9.9l7.3-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.8c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.2 29.9 2 24 2 15.4 2 8.1 6.9 4.5 14.1l7.3 5.7c1.7-5.2 6.5-9 12.2-9z"
      />
    </svg>
  );
}

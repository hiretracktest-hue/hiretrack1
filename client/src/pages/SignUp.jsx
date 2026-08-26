import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext.jsx";
import { Alert, Field, PasswordInput } from "../components/ui.jsx";
import { GoogleMark } from "./SignIn.jsx";

const ROLES = [
  { value: "client", label: "Client - I want to apply for a job" },
  { value: "developer", label: "Hiring team - Developer" },
  { value: "scrum_master", label: "Hiring team - Scrum Master" },
  { value: "business_analyst", label: "Hiring team - Business Analyst" },
  { value: "qa", label: "Hiring team - QA Engineer" },
];

export default function SignUp() {
  const { signUp, googleEnabled } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    confirm: "",
    role: "client",
  });
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
      await signUp({
        name: form.name,
        email: form.email,
        password: form.password,
        role: form.role,
      });
      navigate(form.role === "client" ? "/jobs" : "/dashboard", { replace: true });
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
          <p>Job applicants and the hiring team both sign up here.</p>
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
            label="I am joining as"
            htmlFor="role"
            hint="A client can apply for jobs and follow their own application. The four hiring team roles all have the same full access."
          >
            <select id="role" className="select" value={form.role} onChange={update("role")}>
              {ROLES.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Password"
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

          <Field label="Confirm password" htmlFor="confirm">
            <PasswordInput
              id="confirm"
              autoComplete="new-password"
              placeholder="Type it again"
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

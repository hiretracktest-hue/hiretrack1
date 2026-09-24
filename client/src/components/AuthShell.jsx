import { Link } from "react-router-dom";
import { IconFile, IconLayers, IconScale } from "./icons.jsx";

/**
 * The frame round every signed-out screen - sign in, forgot password,
 * choose a new password. The product on the left, the form on the right;
 * on a phone the left half steps aside and the form has the screen.
 */
export default function AuthShell({ children }) {
  const year = new Date().getFullYear();

  return (
    <div className="auth-split">
      <aside className="auth-brand">
        <div className="auth-glow" aria-hidden="true" />

        <Link to="/signin" className="brand brand-on-dark">
          <span className="brand-mark">AL</span>
          <span className="brand-text">
            <strong>Altrium</strong>
            <span>Recruitment</span>
          </span>
        </Link>

        <div className="auth-pitch">
          <span className="auth-eyebrow">Recruitment &amp; hiring</span>
          <h2>Every candidate, every interview, every decision - in one place.</h2>

          <ol className="auth-track" aria-label="A candidate's journey">
            {["Applied", "Screening", "Interview", "Offer"].map((stage, i) => (
              <li key={stage} style={{ "--i": i }}>
                <span className="auth-track-dot" />
                {stage}
              </li>
            ))}
          </ol>

          <ul className="auth-points">
            <li>
              <span className="auth-point-icon">
                <IconLayers />
              </span>
              <span>
                <strong>A pipeline for every vacancy</strong>
                Each role runs its own interview stages.
              </span>
            </li>
            <li>
              <span className="auth-point-icon">
                <IconFile />
              </span>
              <span>
                <strong>Feedback that is never lost</strong>
                A score and notes at every stage, from the people in the room.
              </span>
            </li>
            <li>
              <span className="auth-point-icon">
                <IconScale />
              </span>
              <span>
                <strong>Decisions on the evidence</strong>
                Candidates side by side, then hire.
              </span>
            </li>
          </ul>
        </div>

        <p className="auth-legal">© {year} Altrium. All rights reserved.</p>
      </aside>

      <main className="auth-main">
        <div className="auth-card">{children}</div>
        <p className="auth-legal auth-legal-mobile">© {year} Altrium. All rights reserved.</p>
      </main>
    </div>
  );
}

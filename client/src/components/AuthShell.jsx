import { Link } from "react-router-dom";
import GoldDust from "./GoldDust.jsx";
import Logo from "./Logo.jsx";
import ShakyText from "./ShakyText.jsx";

/**
 * The frame round every signed-out screen - sign in, forgot password,
 * choose a new password. Altrium on the left, the form on the right; on
 * a phone the left half steps aside and the form has the screen.
 */
export default function AuthShell({ children }) {
  const year = new Date().getFullYear();

  return (
    <div className="auth-split">
      <aside className="auth-brand">
        <div className="auth-glow" aria-hidden="true" />
        <GoldDust />

        <Link to="/signin" className="brand brand-on-dark">
          <Logo size={38} />
        </Link>

        <div className="auth-pitch">
          <span className="auth-eyebrow">For the Altrium team</span>
          <ShakyText lead="Hire with" accent="care." />
          <p className="auth-lede">
            This is where the Altrium team runs its hiring, from the first CV to the signed offer.
          </p>
          <p className="auth-note">Accounts are opened by HR. If you need one, ask them.</p>
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

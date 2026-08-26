import { NavLink, Link, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext.jsx";
import { initials } from "./ui.jsx";

const ROLE_LABELS = {
  developer: "Developer",
  scrum_master: "Scrum Master",
  business_analyst: "Business Analyst",
  qa: "QA Engineer",
  applicant: "Applicant",
};

const LINKS = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/jobs", label: "Vacancies" },
  { to: "/candidates", label: "Candidates" },
  { to: "/interviews", label: "Interviews" },
  { to: "/my-applications", label: "My applications" },
  { to: "/team", label: "Team" },
];

export default function Layout({ children }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate("/signin", { replace: true });
  }

  return (
    <div className="app">
      <header className="navbar">
        <div className="navbar-inner">
          <Link to="/dashboard" className="brand">
            <span className="brand-mark">HT</span>
            HireTrack
          </Link>

          <nav className="nav-links">
            {LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
              >
                {link.label}
              </NavLink>
            ))}
          </nav>

          <div className="nav-user">
            <Link to="/profile" className="avatar" title="Your profile">
              {user?.avatarUrl ? (
                <img className="avatar" src={user.avatarUrl} alt="" />
              ) : (
                initials(user?.name)
              )}
            </Link>
            <div className="nav-user-meta">
              <strong>{user?.name}</strong>
              <span>{ROLE_LABELS[user?.role] || user?.role}</span>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      {children}

      <footer className="footer">
        HireTrack — group project. Developer · Scrum Master · Business Analyst · QA, all with equal
        access.
      </footer>
    </div>
  );
}

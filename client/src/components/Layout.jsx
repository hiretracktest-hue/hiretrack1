import { NavLink, Link, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext.jsx";
import { initials } from "./ui.jsx";

const ROLE_LABELS = {
  developer: "Developer",
  scrum_master: "Scrum Master",
  business_analyst: "Business Analyst",
  qa: "QA Engineer",
  client: "Client",
};

// The hiring team (our four group members) run the whole process.
const STAFF_LINKS = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/jobs", label: "Vacancies" },
  { to: "/candidates", label: "Candidates" },
  { to: "/interviews", label: "Interviews" },
  { to: "/team", label: "Team" },
];

// A client from outside only gets these two.
const CLIENT_LINKS = [
  { to: "/jobs", label: "Open vacancies" },
  { to: "/my-applications", label: "My applications" },
];

export default function Layout({ children }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const links = user?.isStaff ? STAFF_LINKS : CLIENT_LINKS;

  async function handleSignOut() {
    await signOut();
    navigate("/signin", { replace: true });
  }

  return (
    <div className="app">
      <header className="navbar">
        <div className="navbar-inner">
          <Link to={user?.isStaff ? "/dashboard" : "/jobs"} className="brand">
            <span className="brand-mark">HT</span>
            HireTrack
          </Link>

          <nav className="nav-links">
            {links.map((link) => (
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
        HireTrack — group project by Isuru (Developer) · Fazl (Scrum Master) · Thariq (Business
        Analyst) · Ahmed (QA). All four have equal access.
      </footer>
    </div>
  );
}

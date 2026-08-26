import { NavLink, Link, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext.jsx";
import { initials } from "./ui.jsx";

// Menu items, each with the permission it needs. An interviewer never
// sees "Vacancies" because they cannot act on that page anyway.
const STAFF_LINKS = [
  { to: "/dashboard", label: "Dashboard", need: "stats:view" },
  { to: "/jobs", label: "Vacancies" },
  { to: "/candidates", label: "Candidates", need: "candidate:viewAll" },
  { to: "/interviews", label: "Interviews", need: "interview:viewAll" },
  { to: "/team", label: "Team", need: "team:view" },
];

// A candidate applying from outside only gets these two.
const CANDIDATE_LINKS = [
  { to: "/careers", label: "Open positions" },
  { to: "/my-applications", label: "My applications" },
];

export default function Layout({ children }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const links = (user?.isStaff ? STAFF_LINKS : CANDIDATE_LINKS).filter(
    (link) => !link.need || user?.permissions?.[link.need]
  );

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
              <span>{user?.roleLabel || user?.role}</span>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      {children}

      <footer className="footer">
        HireTrack — group project by Isuru, Fazl, Thariq and Ahmed.
      </footer>
    </div>
  );
}

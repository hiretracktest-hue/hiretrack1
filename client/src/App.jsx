import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext.jsx";
import Layout from "./components/Layout.jsx";
import { Loading } from "./components/ui.jsx";

import SignIn from "./pages/SignIn.jsx";
import SignUp from "./pages/SignUp.jsx";
import ForgotPassword from "./pages/ForgotPassword.jsx";
import ResetPassword from "./pages/ResetPassword.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Jobs from "./pages/Jobs.jsx";
import JobDetail from "./pages/JobDetail.jsx";
import JobEditor from "./pages/JobEditor.jsx";
import Compare from "./pages/Compare.jsx";
import Candidates from "./pages/Candidates.jsx";
import CandidateDetail from "./pages/CandidateDetail.jsx";
import MyApplications from "./pages/MyApplications.jsx";
import MyApplicationDetail from "./pages/MyApplicationDetail.jsx";
import Interviews from "./pages/Interviews.jsx";
import Team from "./pages/Team.jsx";
import Profile from "./pages/Profile.jsx";

/** Signed in? If not, go to /signin and remember where they were going. */
function Protected({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Loading what="HireTrack" />;
  if (!user) return <Navigate to="/signin" replace state={{ from: location.pathname }} />;
  return <Layout>{children}</Layout>;
}

/**
 * Staff-only pages. A client who types the address by hand is sent to
 * their own applications instead - the API blocks them as well, so this
 * is a convenience, not the security boundary.
 */
function StaffOnly({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Loading what="HireTrack" />;
  if (!user) return <Navigate to="/signin" replace state={{ from: location.pathname }} />;
  if (!user.isStaff) return <Navigate to="/my-applications" replace />;
  return <Layout>{children}</Layout>;
}

/** Signed-in users should not see the sign-in / sign-up screens again. */
function PublicOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading what="HireTrack" />;
  if (user) return <Navigate to={user.isStaff ? "/dashboard" : "/jobs"} replace />;
  return children;
}

/** Sends "/" to the right home page for whoever is signed in. */
function Home() {
  const { user, loading } = useAuth();
  if (loading) return <Loading what="HireTrack" />;
  if (!user) return <Navigate to="/signin" replace />;
  return <Navigate to={user.isStaff ? "/dashboard" : "/jobs"} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route
        path="/signin"
        element={
          <PublicOnly>
            <SignIn />
          </PublicOnly>
        }
      />
      <Route
        path="/signup"
        element={
          <PublicOnly>
            <SignUp />
          </PublicOnly>
        }
      />
      <Route
        path="/forgot-password"
        element={
          <PublicOnly>
            <ForgotPassword />
          </PublicOnly>
        }
      />
      {/* Reset is reachable while signed out or in - the link comes by email. */}
      <Route path="/reset-password" element={<ResetPassword />} />

      {/* --- pages both a client and the team can open ---------------- */}
      <Route
        path="/jobs"
        element={
          <Protected>
            <Jobs />
          </Protected>
        }
      />
      <Route
        path="/jobs/:id"
        element={
          <Protected>
            <JobDetail />
          </Protected>
        }
      />
      <Route
        path="/my-applications"
        element={
          <Protected>
            <MyApplications />
          </Protected>
        }
      />
      <Route
        path="/my-applications/:id"
        element={
          <Protected>
            <MyApplicationDetail />
          </Protected>
        }
      />
      <Route
        path="/profile"
        element={
          <Protected>
            <Profile />
          </Protected>
        }
      />

      {/* --- hiring team only ----------------------------------------- */}
      <Route
        path="/dashboard"
        element={
          <StaffOnly>
            <Dashboard />
          </StaffOnly>
        }
      />
      <Route
        path="/jobs/new"
        element={
          <StaffOnly>
            <JobEditor mode="create" />
          </StaffOnly>
        }
      />
      <Route
        path="/jobs/:id/edit"
        element={
          <StaffOnly>
            <JobEditor mode="edit" />
          </StaffOnly>
        }
      />
      <Route
        path="/jobs/:id/compare"
        element={
          <StaffOnly>
            <Compare />
          </StaffOnly>
        }
      />
      <Route
        path="/candidates"
        element={
          <StaffOnly>
            <Candidates />
          </StaffOnly>
        }
      />
      <Route
        path="/candidates/:id"
        element={
          <StaffOnly>
            <CandidateDetail />
          </StaffOnly>
        }
      />
      <Route
        path="/interviews"
        element={
          <StaffOnly>
            <Interviews />
          </StaffOnly>
        }
      />
      <Route
        path="/team"
        element={
          <StaffOnly>
            <Team />
          </StaffOnly>
        }
      />

      <Route path="/" element={<Home />} />
      <Route path="*" element={<Home />} />
    </Routes>
  );
}

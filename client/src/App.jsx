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
import Candidates from "./pages/Candidates.jsx";
import CandidateDetail from "./pages/CandidateDetail.jsx";
import MyApplications from "./pages/MyApplications.jsx";
import Interviews from "./pages/Interviews.jsx";
import Team from "./pages/Team.jsx";
import Profile from "./pages/Profile.jsx";

/** Sends people to /signin if they are not logged in, remembering where
 *  they wanted to go so they land there afterwards. */
function Protected({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Loading what="HireTrack" />;
  if (!user) return <Navigate to="/signin" replace state={{ from: location.pathname }} />;
  return <Layout>{children}</Layout>;
}

/** Signed-in users should not see the sign-in / sign-up screens again. */
function PublicOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading what="HireTrack" />;
  if (user) return <Navigate to="/dashboard" replace />;
  return children;
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

      <Route
        path="/dashboard"
        element={
          <Protected>
            <Dashboard />
          </Protected>
        }
      />
      <Route
        path="/jobs"
        element={
          <Protected>
            <Jobs />
          </Protected>
        }
      />
      <Route
        path="/jobs/new"
        element={
          <Protected>
            <JobEditor mode="create" />
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
        path="/jobs/:id/edit"
        element={
          <Protected>
            <JobEditor mode="edit" />
          </Protected>
        }
      />
      <Route
        path="/candidates"
        element={
          <Protected>
            <Candidates />
          </Protected>
        }
      />
      <Route
        path="/candidates/:id"
        element={
          <Protected>
            <CandidateDetail />
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
        path="/interviews"
        element={
          <Protected>
            <Interviews />
          </Protected>
        }
      />
      <Route
        path="/team"
        element={
          <Protected>
            <Team />
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

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

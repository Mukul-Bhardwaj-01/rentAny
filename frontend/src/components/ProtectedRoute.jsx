import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

// Wrap any page that requires login: <ProtectedRoute><CreateItem /></ProtectedRoute>
// Remembers the requested page so Login can send the user back to it.
export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <p className="text-center mt-10">Loading...</p>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  return children;
}

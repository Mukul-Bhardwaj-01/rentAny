import { Navigate, useLocation, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

// Admin-only pages. Hiding the page is just convenience: every admin API
// call is checked on the server (requireAdmin).
export default function AdminRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <p className="text-center mt-10">Loading...</p>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (user.role !== "ADMIN") {
    return (
      <div className="max-w-md mx-auto mt-10 text-center">
        <h2 className="text-2xl font-bold mb-2">Admins only</h2>
        <p className="text-slate-500 mb-4">You don't have access to this page.</p>
        <Link to="/" className="text-blue-600">Back to home</Link>
      </div>
    );
  }
  return children;
}

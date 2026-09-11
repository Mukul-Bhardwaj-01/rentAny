import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/");
  }

  return (
    <nav className="flex items-center justify-between px-6 py-4 bg-slate-900 text-white">
      <Link to="/" className="text-xl font-bold">RentAny</Link>
      <div className="flex items-center gap-4">
        {user ? (
          <>
            <Link to="/create-item" className="hover:underline">List an item</Link>
            <span className="text-sm text-slate-300">Hi, {user.name}</span>
            <button onClick={handleLogout} className="bg-slate-700 px-3 py-1 rounded">
              Logout
            </button>
          </>
        ) : (
          <>
            <Link to="/login" className="hover:underline">Login</Link>
            <Link to="/register" className="hover:underline">Register</Link>
          </>
        )}
      </div>
    </nav>
  );
}

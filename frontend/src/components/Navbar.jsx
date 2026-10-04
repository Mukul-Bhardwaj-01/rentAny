import { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import NotificationBell from "./NotificationBell.jsx";

const linkClass = ({ isActive }) =>
  `rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? "bg-slate-800 text-white" : "text-slate-300 hover:bg-slate-800 hover:text-white"
  }`;

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the mobile menu after navigating.
  useEffect(() => setMenuOpen(false), [location.pathname]);

  function handleLogout() {
    logout();
    navigate("/");
  }

  const links = user ? (
    <>
      <NavLink to="/create-item" className={linkClass}>List an item</NavLink>
      <NavLink to="/bookings" className={linkClass}>My bookings</NavLink>
      {user.role === "ADMIN" && <NavLink to="/admin" className={linkClass}>Admin</NavLink>}
    </>
  ) : (
    <>
      <NavLink to="/login" className={linkClass}>Log in</NavLink>
      <NavLink to="/register" className={linkClass}>Sign up</NavLink>
    </>
  );

  return (
    <nav className="sticky top-0 z-30 bg-slate-900 text-white shadow-sm">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-sm font-extrabold text-slate-900">R</span>
          RentAny
        </Link>

        {/* Desktop */}
        <div className="hidden items-center gap-1 md:flex">
          {links}
          {user && (
            <>
              <div className="mx-2"><NotificationBell /></div>
              <span className="mr-2 max-w-[10rem] truncate text-sm text-slate-400">Hi, {user.name}</span>
              <button onClick={handleLogout} className="btn-sm btn border border-slate-700 text-slate-200 hover:bg-slate-800">
                Log out
              </button>
            </>
          )}
        </div>

        {/* Mobile */}
        <div className="flex items-center gap-2 md:hidden">
          {user && <NotificationBell />}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="rounded-lg p-2 text-slate-300 hover:bg-slate-800 hover:text-white"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              {menuOpen ? <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /> : <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="flex flex-col gap-1 border-t border-slate-800 px-4 py-3 md:hidden">
          {links}
          {user && (
            <>
              <span className="px-3 pt-2 text-sm text-slate-400">Signed in as {user.name}</span>
              <button onClick={handleLogout} className="rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white">
                Log out
              </button>
            </>
          )}
        </div>
      )}
    </nav>
  );
}

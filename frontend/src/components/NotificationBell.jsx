import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { useNotifications, notificationLink } from "../hooks/useNotifications.js";
import { timeAgo } from "../utils/format.js";

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 0 0-4-5.7V5a2 2 0 1 0-4 0v.3A6 6 0 0 0 6 11v3.2a2 2 0 0 1-.6 1.4L4 17h5m6 0v1a3 3 0 1 1-6 0v-1m6 0H9" />
    </svg>
  );
}

// Navbar bell with unread badge, dropdown panel and new-notification toasts.
export default function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { notifications, unreadCount, error, toasts, dismissToast, refresh, markRead, markAllRead } =
    useNotifications(user);
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);

  // Close the panel on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle() {
    if (!open) refresh(); // show the latest when opening
    setOpen(!open);
  }

  function openNotification(n) {
    markRead(n);
    setOpen(false);
    const link = notificationLink(n);
    if (link) navigate(link);
  }

  return (
    <>
      <div className="relative" ref={panelRef}>
        <button
          onClick={toggle}
          className="relative p-1 rounded hover:bg-slate-700"
          aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
          aria-expanded={open}
        >
          <BellIcon />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-red-600 text-white text-xs font-bold flex items-center justify-center">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white text-slate-900 rounded-lg shadow-lg border z-50">
            <div className="flex items-center justify-between px-4 py-2 border-b">
              <span className="font-semibold">Notifications</span>
              <button
                onClick={markAllRead}
                disabled={unreadCount === 0}
                className="text-sm text-blue-600 disabled:text-slate-400"
              >
                Mark all as read
              </button>
            </div>

            {error && <p className="px-4 py-2 text-sm text-red-600">{error}</p>}

            {notifications.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-500 text-center">No notifications yet.</p>
            ) : (
              <ul className="max-h-96 overflow-y-auto divide-y">
                {notifications.map((n) => (
                  <li key={n.id}>
                    <button
                      onClick={() => openNotification(n)}
                      className={`w-full text-left px-4 py-3 hover:bg-slate-100 flex gap-2 ${n.readAt ? "" : "bg-blue-50"}`}
                    >
                      <span
                        className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${n.readAt ? "bg-transparent" : "bg-blue-600"}`}
                        aria-label={n.readAt ? undefined : "Unread"}
                      />
                      <span className="min-w-0">
                        <span className={`block text-sm ${n.readAt ? "" : "font-semibold"}`}>{n.title}</span>
                        <span className="block text-sm text-slate-600">{n.message}</span>
                        <span className="block text-xs text-slate-400 mt-1">{timeAgo(n.createdAt)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Toasts for notifications that arrive while the app is open. */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.key} role="status" className="bg-slate-900 text-white rounded-lg shadow-lg p-3 flex gap-2 items-start">
            <button
              className="flex-1 text-left"
              onClick={() => {
                dismissToast(t.key);
                if (t.notification) openNotification(t.notification);
                else setOpen(true);
              }}
            >
              <span className="block font-semibold text-sm">{t.title}</span>
              <span className="block text-sm text-slate-300">{t.message}</span>
            </button>
            <button onClick={() => dismissToast(t.key)} className="text-slate-400 hover:text-white" aria-label="Dismiss">
              ×
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

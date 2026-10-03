// Polls the current user's notifications, tracks the unread count and
// raises toasts for notifications that arrive while the app is open.
import { useCallback, useEffect, useRef, useState } from "react";
import api, { getErrorMessage } from "../api/axios.js";

const POLL_MS = 10000;
const TOAST_MS = 6000;
// More new notifications than this at once become a single summary toast.
const MAX_TOASTS_AT_ONCE = 3;

// Where clicking a notification should take the user, if anywhere. The server
// says which side of the booking the reader is on (some events, like
// payments and deposits, notify both sides).
export function notificationLink(n) {
  if (!n.bookingId) return null;
  const as = n.bookingRole === "owner" ? "owner" : "renter";
  return `/bookings?as=${as}&booking=${n.bookingId}`;
}

export function useNotifications(user) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState("");
  const [toasts, setToasts] = useState([]);

  // Highest notification id already seen. null until the first load, so
  // notifications that existed before the app was opened never toast.
  const lastSeenId = useRef(null);
  const inFlight = useRef(false);
  // Bumped on login/logout so late responses for a previous user are ignored.
  const session = useRef(0);
  const toastTimers = useRef([]);

  const dismissToast = useCallback((key) => {
    setToasts((list) => list.filter((t) => t.key !== key));
  }, []);

  const showToasts = useCallback(
    (fresh) => {
      const newToasts =
        fresh.length > MAX_TOASTS_AT_ONCE
          ? [{ key: `summary-${fresh[0].id}`, title: `${fresh.length} new notifications`, message: "Open the bell to see them." }]
          : fresh.map((n) => ({ key: `n-${n.id}`, title: n.title, message: n.message, notification: n }));
      setToasts((list) => [...list, ...newToasts]);
      for (const t of newToasts) {
        toastTimers.current.push(setTimeout(() => dismissToast(t.key), TOAST_MS));
      }
    },
    [dismissToast]
  );

  const refresh = useCallback(async () => {
    if (inFlight.current) return; // never stack requests if the API is slow
    inFlight.current = true;
    const mySession = session.current;
    try {
      const res = await api.get("/notifications", { params: { limit: 20 } });
      if (mySession !== session.current) return;
      const list = res.data.notifications;
      const maxId = list.reduce((max, n) => Math.max(max, n.id), 0);

      if (lastSeenId.current === null) {
        lastSeenId.current = maxId;
      } else {
        const fresh = list.filter((n) => n.id > lastSeenId.current && !n.readAt);
        lastSeenId.current = Math.max(lastSeenId.current, maxId);
        if (fresh.length > 0) {
          showToasts(fresh);
          // Lets open pages (e.g. My bookings) refresh themselves.
          window.dispatchEvent(new Event("notifications:new"));
        }
      }

      setNotifications(list);
      setUnreadCount(res.data.unreadCount);
      setError("");
    } catch (err) {
      // Keep showing what we had; the next poll will try again.
      if (mySession === session.current) setError(getErrorMessage(err, "Could not load notifications"));
    } finally {
      inFlight.current = false;
    }
  }, [showToasts]);

  // Poll only while logged in and while the tab is visible.
  useEffect(() => {
    session.current += 1;
    lastSeenId.current = null;
    inFlight.current = false; // a previous user's request must not block this one
    setNotifications([]);
    setUnreadCount(0);
    setError("");
    setToasts([]);
    if (!user) return;

    refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      toastTimers.current.forEach(clearTimeout);
      toastTimers.current = [];
    };
  }, [user?.id, refresh]);

  async function markRead(n) {
    if (n.readAt) return;
    // Optimistic update so the UI responds immediately.
    setNotifications((list) => list.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
    setUnreadCount((c) => Math.max(0, c - 1));
    try {
      const res = await api.patch(`/notifications/${n.id}/read`);
      setUnreadCount(res.data.unreadCount);
    } catch {
      refresh(); // fall back to the server's view
    }
  }

  async function markAllRead() {
    setNotifications((list) => list.map((x) => (x.readAt ? x : { ...x, readAt: new Date().toISOString() })));
    setUnreadCount(0);
    try {
      await api.patch("/notifications/read-all");
    } catch (err) {
      setError(getErrorMessage(err, "Could not mark notifications as read"));
      refresh();
    }
  }

  return { notifications, unreadCount, error, toasts, dismissToast, refresh, markRead, markAllRead };
}

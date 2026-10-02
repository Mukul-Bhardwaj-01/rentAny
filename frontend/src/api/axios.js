// Single axios instance for the whole app. Automatically attaches the
// saved JWT (if any) to every outgoing request.
import axios from "axios";

const api = axios.create({
  // Set VITE_API_URL in frontend/.env for other environments (e.g. Vercel).
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:5000/api",
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// A 401 on a request that carried a token means the session expired or is
// invalid; AuthContext listens for this event and logs the user out. A 401
// without a token (e.g. wrong password on login) is left to the page.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && err.config?.headers?.Authorization) {
      window.dispatchEvent(new Event("auth:logout"));
    }
    return Promise.reject(err);
  }
);

// Turns any request error into a message that can be shown to the user.
export function getErrorMessage(err, fallback = "Something went wrong") {
  if (!err.response) return "Cannot reach the server. Please check your connection and try again.";
  return err.response.data?.message || fallback;
}

// Per-field validation messages from the API ({ field: message }), if any.
export function getFieldErrors(err) {
  return err.response?.data?.errors || {};
}

export default api;

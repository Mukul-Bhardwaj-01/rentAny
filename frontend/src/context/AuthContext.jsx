// Keeps track of the logged-in user and exposes login/logout to any
// component via useAuth(), backed by a token saved in localStorage.
import { createContext, useContext, useEffect, useState } from "react";
import api from "../api/axios.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .get("/auth/me")
      .then((res) => setUser(res.data))
      .catch((err) => {
        // Only a rejected token ends the session; if the server is just
        // unreachable, keep the token so the user stays logged in on retry.
        if (err.response?.status === 401) localStorage.removeItem("token");
      })
      .finally(() => setLoading(false));
  }, []);

  // Any authenticated request that comes back 401 logs the user out.
  useEffect(() => {
    window.addEventListener("auth:logout", logout);
    return () => window.removeEventListener("auth:logout", logout);
  }, []);

  function login(token, userData) {
    localStorage.setItem("token", token);
    setUser(userData);
  }

  function logout() {
    localStorage.removeItem("token");
    setUser(null);
  }

  // After the profile is edited (e.g. a new name), so the navbar updates too.
  function updateUser(changes) {
    setUser((u) => (u ? { ...u, ...changes } : u));
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

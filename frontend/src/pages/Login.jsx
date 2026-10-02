import { useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import api, { getErrorMessage, getFieldErrors } from "../api/axios.js";
import { useAuth } from "../context/AuthContext.jsx";
import FieldError from "../components/FieldError.jsx";

export default function Login() {
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setFieldErrors({});
    setSubmitting(true);
    try {
      const res = await api.post("/auth/login", form);
      login(res.data.token, res.data.user);
      // Return to the protected page that sent the user here, if any.
      navigate(location.state?.from || "/", { replace: true });
    } catch (err) {
      setError(getErrorMessage(err, "Login failed"));
      setFieldErrors(getFieldErrors(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-md mx-auto mt-10 p-6 border rounded-lg">
      <h2 className="text-2xl font-bold mb-4">Login</h2>
      {error && <p className="text-red-600 mb-3">{error}</p>}
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input className="border p-2 rounded" placeholder="Email" type="email" required maxLength={254}
          value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <FieldError message={fieldErrors.email} />
        <input className="border p-2 rounded" placeholder="Password" type="password" required
          value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <FieldError message={fieldErrors.password} />
        <button className="bg-slate-900 text-white py-2 rounded disabled:opacity-50" disabled={submitting}>
          {submitting ? "Logging in..." : "Login"}
        </button>
      </form>
      <p className="mt-3 text-sm">
        No account yet? <Link to="/register" className="text-blue-600">Register</Link>
      </p>
    </div>
  );
}

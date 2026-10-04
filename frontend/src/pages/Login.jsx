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
    <div className="card mx-4 my-10 p-6 sm:mx-auto sm:my-16 sm:max-w-md sm:p-8">
      <h2 className="page-title">Welcome back</h2>
      <p className="mt-1 mb-6 text-sm text-slate-500">Log in to rent or list items.</p>
      {error && <p className="alert-error mb-4">{error}</p>}
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input className="input" placeholder="Email" type="email" required maxLength={254}
          value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <FieldError message={fieldErrors.email} />
        <input className="input" placeholder="Password" type="password" required
          value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <FieldError message={fieldErrors.password} />
        <button className="btn-primary w-full py-2.5" disabled={submitting}>
          {submitting ? "Logging in..." : "Login"}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-600">
        No account yet? <Link to="/register" className="link">Register</Link>
      </p>
    </div>
  );
}

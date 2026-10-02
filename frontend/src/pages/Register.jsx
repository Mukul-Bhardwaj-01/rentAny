import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import api, { getErrorMessage, getFieldErrors } from "../api/axios.js";
import { useAuth } from "../context/AuthContext.jsx";
import FieldError from "../components/FieldError.jsx";

export default function Register() {
  const [form, setForm] = useState({ name: "", email: "", password: "", phone: "" });
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setFieldErrors({});
    setSubmitting(true);
    try {
      const res = await api.post("/auth/register", form);
      login(res.data.token, res.data.user);
      navigate("/");
    } catch (err) {
      setError(getErrorMessage(err, "Registration failed"));
      setFieldErrors(getFieldErrors(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-md mx-auto mt-10 p-6 border rounded-lg">
      <h2 className="text-2xl font-bold mb-4">Create an account</h2>
      {error && <p className="text-red-600 mb-3">{error}</p>}
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input className="border p-2 rounded" placeholder="Full name" required minLength={2} maxLength={50}
          value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <FieldError message={fieldErrors.name} />
        <input className="border p-2 rounded" placeholder="Email" type="email" required maxLength={254}
          value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <FieldError message={fieldErrors.email} />
        <input className="border p-2 rounded" placeholder="Phone (optional)" type="tel" maxLength={20}
          value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <FieldError message={fieldErrors.phone} />
        <input className="border p-2 rounded" placeholder="Password (min 8 characters)" type="password" required minLength={8}
          value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <FieldError message={fieldErrors.password} />
        <button className="bg-slate-900 text-white py-2 rounded disabled:opacity-50" disabled={submitting}>
          {submitting ? "Creating account..." : "Register"}
        </button>
      </form>
      <p className="mt-3 text-sm">
        Already have an account? <Link to="/login" className="text-blue-600">Login</Link>
      </p>
    </div>
  );
}

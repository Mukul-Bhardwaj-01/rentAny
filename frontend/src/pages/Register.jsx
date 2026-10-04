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
    <div className="card mx-4 my-10 p-6 sm:mx-auto sm:my-16 sm:max-w-md sm:p-8">
      <h2 className="page-title">Create an account</h2>
      <p className="mt-1 mb-6 text-sm text-slate-500">Rent what you need, or earn from what you own.</p>
      {error && <p className="alert-error mb-4">{error}</p>}
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input className="input" placeholder="Full name" required minLength={2} maxLength={50}
          value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <FieldError message={fieldErrors.name} />
        <input className="input" placeholder="Email" type="email" required maxLength={254}
          value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <FieldError message={fieldErrors.email} />
        <input className="input" placeholder="Phone number * (e.g. 9876543210)" type="tel" required maxLength={20}
          pattern="\+?[\d\s\-]{10,20}" title="10–15 digits, optionally starting with +"
          value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <p className="text-xs text-slate-500 -mt-2">
          Required. Shared with the other person only once a booking is confirmed.
        </p>
        <FieldError message={fieldErrors.phone} />
        <input className="input" placeholder="Password (min 8 characters)" type="password" required minLength={8}
          value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <FieldError message={fieldErrors.password} />
        <button className="btn-primary w-full py-2.5" disabled={submitting}>
          {submitting ? "Creating account..." : "Register"}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-600">
        Already have an account? <Link to="/login" className="link">Login</Link>
      </p>
    </div>
  );
}

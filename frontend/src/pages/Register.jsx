import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import api from "../api/axios.js";
import { useAuth } from "../context/AuthContext.jsx";

export default function Register() {
  const [form, setForm] = useState({ name: "", email: "", password: "", phone: "" });
  const [error, setError] = useState("");
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    try {
      const res = await api.post("/auth/register", form);
      login(res.data.token, res.data.user);
      navigate("/");
    } catch (err) {
      setError(err.response?.data?.message || "Registration failed");
    }
  }

  return (
    <div className="max-w-md mx-auto mt-10 p-6 border rounded-lg">
      <h2 className="text-2xl font-bold mb-4">Create an account</h2>
      {error && <p className="text-red-600 mb-3">{error}</p>}
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input className="border p-2 rounded" placeholder="Full name" required
          value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className="border p-2 rounded" placeholder="Email" type="email" required
          value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <input className="border p-2 rounded" placeholder="Phone (optional)"
          value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <input className="border p-2 rounded" placeholder="Password" type="password" required
          value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <button className="bg-slate-900 text-white py-2 rounded">Register</button>
      </form>
      <p className="mt-3 text-sm">
        Already have an account? <Link to="/login" className="text-blue-600">Login</Link>
      </p>
    </div>
  );
}

import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="max-w-md mx-auto mt-10 text-center">
      <h2 className="text-2xl font-bold mb-2">Page not found</h2>
      <p className="text-slate-500 mb-4">The page you are looking for does not exist.</p>
      <Link to="/" className="text-blue-600">Back to home</Link>
    </div>
  );
}

import { Link } from "react-router-dom";
import { EmptyState } from "../components/ui.jsx";

export default function NotFound() {
  return (
    <div className="page-narrow">
      <EmptyState
        icon="🧭"
        title="Page not found"
        message="The page you are looking for does not exist or has moved."
        action={<Link to="/" className="btn-primary">Back to home</Link>}
      />
    </div>
  );
}

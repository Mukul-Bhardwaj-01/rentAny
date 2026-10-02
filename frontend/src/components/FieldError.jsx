// Small red message under a form field, shown only when there is an error.
export default function FieldError({ message }) {
  if (!message) return null;
  return <p className="text-sm text-red-600 -mt-2">{message}</p>;
}

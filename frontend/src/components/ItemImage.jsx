const PLACEHOLDER = "https://placehold.co/400x250?text=No+Image";

// Item photo that falls back to a placeholder if missing or broken.
export default function ItemImage({ src, alt, className }) {
  return (
    <img
      src={src || PLACEHOLDER}
      alt={alt}
      className={className}
      onError={(e) => {
        // Fall back once if the stored image URL is broken.
        if (e.currentTarget.src !== PLACEHOLDER) e.currentTarget.src = PLACEHOLDER;
      }}
    />
  );
}

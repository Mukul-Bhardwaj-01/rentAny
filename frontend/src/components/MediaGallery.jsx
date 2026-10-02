import { useEffect, useState } from "react";
import ItemImage from "./ItemImage.jsx";

function MediaView({ media, alt, className, onImageClick }) {
  if (media.type === "VIDEO") {
    // key: a fresh element per video so switching doesn't keep playing the old one
    return <video key={media.url} src={media.url} controls preload="metadata" className={`${className} bg-black`} />;
  }
  return (
    <button type="button" onClick={onImageClick} className="block w-full cursor-zoom-in" aria-label="View larger">
      <ItemImage src={media.url} alt={alt} className={className} />
    </button>
  );
}

// Photo/video gallery with thumbnails and a full-screen lightbox for images.
export default function MediaGallery({ media, title }) {
  const [index, setIndex] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const count = media.length;
  const current = media[Math.min(index, count - 1)];

  const go = (step) => setIndex((i) => (i + step + count) % count);

  // Keyboard controls while the lightbox is open.
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e) => {
      if (e.key === "Escape") setLightbox(false);
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lightbox, count]);

  if (count === 0) {
    return <ItemImage alt={title} className="w-full h-72 object-cover rounded-lg" />;
  }

  const arrow = "absolute top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white w-9 h-9 rounded-full text-xl leading-9";

  return (
    <div>
      <div className="relative">
        <MediaView
          media={current}
          alt={title}
          className="w-full h-72 object-cover rounded-lg"
          onImageClick={() => setLightbox(true)}
        />
        {count > 1 && (
          <>
            <button type="button" onClick={() => go(-1)} className={`${arrow} left-2`} aria-label="Previous">‹</button>
            <button type="button" onClick={() => go(1)} className={`${arrow} right-2`} aria-label="Next">›</button>
            <span className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded">
              {index + 1} / {count}
            </span>
          </>
        )}
      </div>

      {count > 1 && (
        <ul className="flex gap-2 mt-2 overflow-x-auto pb-1">
          {media.map((m, i) => (
            <li key={m.id ?? i} className="shrink-0">
              <button
                type="button"
                onClick={() => setIndex(i)}
                className={`relative block rounded overflow-hidden border-2 ${i === index ? "border-slate-900" : "border-transparent"}`}
                aria-label={`Show ${m.type === "VIDEO" ? "video" : "photo"} ${i + 1}`}
              >
                {m.type === "VIDEO" ? (
                  <>
                    <video src={m.url} preload="metadata" muted className="w-16 h-12 object-cover bg-black" />
                    <span className="absolute inset-0 flex items-center justify-center text-white text-lg">▶</span>
                  </>
                ) : (
                  <ItemImage src={m.url} alt="" className="w-16 h-12 object-cover" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`${title} media`}
          onClick={() => setLightbox(false)}
        >
          <div className="relative max-w-5xl w-full" onClick={(e) => e.stopPropagation()}>
            {current.type === "VIDEO" ? (
              <video key={current.url} src={current.url} controls autoPlay className="max-h-[85vh] w-full" />
            ) : (
              <img src={current.url} alt={title} className="max-h-[85vh] w-full object-contain" />
            )}
            {count > 1 && (
              <>
                <button type="button" onClick={() => go(-1)} className={`${arrow} -left-2 md:-left-12`} aria-label="Previous">‹</button>
                <button type="button" onClick={() => go(1)} className={`${arrow} -right-2 md:-right-12`} aria-label="Next">›</button>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => setLightbox(false)}
            className="absolute top-4 right-4 text-white text-3xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

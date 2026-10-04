// Interactive map of an item's location plus a "Get directions" link.
// Uses Google Maps' keyless embed and Maps URLs with the item's existing
// free-text location, so no API key or extra dependency is needed. The pin
// is wherever Google places that text (approximate for area-level names).
export default function LocationMap({ location, title }) {
  if (!location?.trim()) return null;
  const q = encodeURIComponent(location.trim());
  const embedUrl = `https://www.google.com/maps?q=${q}&z=13&output=embed`;
  // Opens Google Maps navigation (app on phones, website elsewhere) from the
  // viewer's current location to the listing.
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${q}`;

  return (
    <section className="mt-6">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 className="text-lg font-semibold">Location</h2>
        <a
          href={directionsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm bg-slate-900 text-white px-3 py-1.5 rounded hover:bg-slate-700"
        >
          Get directions ↗
        </a>
      </div>
      <p className="text-sm text-slate-600 mb-2">📍 {location}</p>
      <div className="w-full aspect-[4/3] sm:aspect-video rounded-lg overflow-hidden border bg-slate-100">
        <iframe
          title={`Map showing ${title || "the item"} in ${location}`}
          src={embedUrl}
          className="w-full h-full border-0"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          allowFullScreen
        />
      </div>
      <p className="text-xs text-slate-400 mt-1">Approximate area. Confirm the exact pickup point with the owner after booking.</p>
    </section>
  );
}

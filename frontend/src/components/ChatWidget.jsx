import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import api, { getErrorMessage } from "../api/axios.js";
import { useAuth } from "../context/AuthContext.jsx";
import ItemImage from "./ItemImage.jsx";
import { RatingBadge } from "./StarRating.jsx";
import { formatPrice } from "../utils/format.js";

const SUGGESTIONS = [
  "I'm hosting a birthday party for 30 people",
  "Weekend camping trip for four",
  "Things for a photography shoot",
  "Movie night at home",
];
const HISTORY_SENT = 10; // the backend accepts at most 10 earlier messages

// Floating rental assistant. Answers come from our backend (Grok on the
// server, grounded in the live catalog); recommendations are real listings.
export default function ChatWidget() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]); // { role, content, recommendations?, fallback? }
  const [input, setInput] = useState("");
  const [budget, setBudget] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending, open]);

  // A different (or no) user starts a fresh conversation.
  useEffect(() => {
    setMessages([]);
    setError("");
  }, [user?.id]);

  async function send(text) {
    const message = text.trim();
    if (!message || sending) return;
    setError("");
    const history = messages.slice(-HISTORY_SENT).map(({ role, content }) => ({ role, content }));
    setMessages((m) => [...m, { role: "user", content: message }]);
    setInput("");
    setSending(true);
    try {
      const res = await api.post("/chat", {
        message,
        history,
        ...(budget ? { filters: { maxPricePerHour: budget } } : {}),
      });
      setMessages((m) => [
        ...m,
        { role: "assistant", content: res.data.reply, recommendations: res.data.recommendations, fallback: res.data.fallback },
      ]);
    } catch (err) {
      setError(getErrorMessage(err, "The assistant couldn't answer. Please try again."));
      // Let the user resend what they typed.
      setMessages((m) => m.slice(0, -1));
      setInput(message);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {open && (
        <div
          className="fixed z-40 bottom-20 left-4 right-4 sm:right-auto sm:w-96 h-[70vh] max-h-[600px] bg-white border rounded-lg shadow-xl flex flex-col"
          role="dialog"
          aria-label="RentAny assistant"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b bg-slate-900 text-white rounded-t-lg">
            <div>
              <p className="font-semibold">RentAny assistant</p>
              <p className="text-xs text-slate-300">Tell me your occasion, I'll find listings</p>
            </div>
            <button onClick={() => setOpen(false)} className="text-2xl leading-none text-slate-300 hover:text-white" aria-label="Close">×</button>
          </div>

          {!user ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-sm text-slate-600">
              <p>Log in to get rental suggestions for your occasion.</p>
              <Link to="/login" onClick={() => setOpen(false)} className="mt-3 text-blue-600">Log in</Link>
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto p-3 space-y-3 text-sm" aria-live="polite">
                {messages.length === 0 && (
                  <div className="text-slate-600">
                    <p>Hi {user.name}! What are you planning? I'll suggest items you can rent right now.</p>
                    <div className="flex flex-wrap gap-2 mt-3">
                      {SUGGESTIONS.map((s) => (
                        <button key={s} onClick={() => send(s)} className="border rounded-full px-3 py-1 text-xs hover:bg-slate-100">
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map((m, i) => (
                  <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
                    <div className={`rounded-lg px-3 py-2 max-w-[90%] whitespace-pre-line ${m.role === "user" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-800"}`}>
                      {m.content}
                    </div>
                    {m.recommendations?.length > 0 && (
                      <ul className="mt-2 space-y-2">
                        {m.recommendations.map(({ item, reason }) => (
                          <li key={item.id}>
                            <Link to={`/items/${item.id}`} onClick={() => setOpen(false)} className="flex gap-2 border rounded-lg p-2 hover:bg-slate-50">
                              <ItemImage src={item.imageUrl} alt={item.title} className="w-14 h-14 object-cover rounded shrink-0" />
                              <span className="min-w-0">
                                <span className="block font-medium truncate">{item.title}</span>
                                <span className="block text-xs text-slate-600">
                                  ₹{formatPrice(item.pricePerHour)}/hr · {item.location}
                                  {Number(item.securityDeposit) > 0 && ` · ₹${formatPrice(item.securityDeposit)} deposit`}
                                </span>
                                <RatingBadge sum={(item.rating.average || 0) * item.rating.count} count={item.rating.count} />
                                {reason && <span className="block text-xs text-slate-500 mt-0.5">{reason}</span>}
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
                {sending && <p className="text-slate-400">Thinking…</p>}
                <div ref={endRef} />
              </div>

              {error && <p className="px-3 text-xs text-red-600">{error}</p>}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  send(input);
                }}
                className="border-t p-2 space-y-2"
              >
                <div className="flex gap-2">
                  <input
                    className="border rounded px-2 py-1.5 flex-1 text-sm"
                    placeholder="e.g. Need a projector for Saturday"
                    maxLength={1000}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    disabled={sending}
                    aria-label="Message"
                  />
                  <button disabled={sending || !input.trim()} className="bg-slate-900 text-white px-3 rounded text-sm disabled:opacity-50">
                    Send
                  </button>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-500">
                  Max budget ₹/hour (optional)
                  <input
                    type="number"
                    min="1"
                    step="1"
                    className="border rounded px-2 py-0.5 w-24"
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                  />
                </label>
              </form>
            </>
          )}
        </div>
      )}

      <button
        onClick={() => setOpen(!open)}
        className="fixed z-40 bottom-4 left-4 bg-slate-900 text-white rounded-full shadow-lg px-4 py-3 text-sm font-medium hover:bg-slate-700"
        aria-expanded={open}
      >
        {open ? "Close assistant" : "💬 Ask RentAny"}
      </button>
    </>
  );
}

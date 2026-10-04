# rentAny

**rentAny** is a peer-to-peer rental marketplace where people list everyday items (speakers, projectors, cameras, tools…) and others rent them **by the hour** — with booking requests, online payment, a refundable security deposit, reviews, maps and an AI rental assistant.

Minor project · 7th semester, B.E. Computer Science & Engineering · UIET, Panjab University · Session July–December 2026

### Team

| Name | Roll no. |
|---|---|
| Mukul Bhardwaj | UE233066 |
| Prashant Yadav | UE233075 |
| Pratham Mahajan | UE233076 |

The original plan is in [`rentAny workflow.pdf`](rentAny%20workflow.pdf); the updated plan, progress and Gantt chart up to the final evaluation are in [`docs/rentAny-workflow-v2.md`](docs/rentAny-workflow-v2.md).

---

## Features (current build)

**Accounts**
- Register / log in with JWT authentication; passwords hashed with bcrypt.
- Phone number required at sign-up; shared between renter and owner only once a booking is paid.
- Roles: `USER` and `ADMIN`.
- **Profile dashboard**: account details (editable name and phone), ratings as owner and renter, all of the user's listings and every rental they have taken.

**Listings**
- Create listings with title, description, category, hourly price, location and a refundable security deposit (₹0 – ₹50,000).
- Up to 10 photos/videos per listing (8 images, 2 videos), uploaded **directly from the browser to Cloudinary** with server-signed upload tickets; the server verifies every upload before attaching it.
- Item page with media gallery and lightbox, location map with **Get directions**, owner rating and reviews.
- Home page search, sorting (newest, price, rating) and filters (category, price range, area).
- Owners can **edit** every detail of a listing, **pause** it (hidden from search, no new requests) or **delete** it. Deleting is a soft delete: the listing disappears everywhere, open requests are declined with a notification, and past bookings, payments and reviews stay intact. It is refused while a booking is accepted, paid or in progress.

**Bookings**
- Hourly booking requests (1–72 h, up to 30 days ahead) with live availability.
- Owner accepts or rejects; overlapping requests are auto-rejected.
- **Double booking is impossible**: enforced by a PostgreSQL exclusion constraint, not only by application code.
- Full lifecycle: requested → accepted → paid/confirmed → handed over → returned, with cancellation and automatic expiry.

**Payments & security deposit** (Razorpay, test mode)
- Fixed ₹49 platform fee; amounts snapshotted on the booking so later price changes never affect it.
- Server-created orders, signature check **and** server-side verification with Razorpay; signed webhooks; reconciliation if the browser callback is lost.
- Cancellation refunds per a versioned policy (owner cancels → full refund; renter ≥ 24 h before → rental + deposit; < 24 h → 50 % rental + deposit).
- Deposit held after return for a 48-hour claim window; owner can claim (damage, late return, missing parts), renter accepts or disputes, admin resolves; the rest is refunded automatically.
- Idempotent, append-only payment audit log; safe refund retries.

**Reviews & ratings**
- After a completed rental: renter rates the owner and item, owner rates the renter (1–5 stars + optional comment, one each per booking).
- Average ratings shown on listings, item pages and bookings.

**Notifications**
- In-app notification bell with unread count and pop-up toasts for every important booking, payment, refund, claim and review event.

**AI rental assistant**
- Chat widget that suggests listings for an occasion, need or budget, using an LLM through the backend (key never exposed to the browser).
- Recommendations are **grounded in the live catalog**: the AI can only pick from real, available listings chosen by the server, and every pick is re-checked. Falls back to catalog search if the AI is unavailable.

**Admin panel**
- Review and resolve deposit disputes; overview of users, listings, bookings and refunds needing attention (with retry).

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, React Router, Tailwind CSS |
| Backend | Node.js, Express |
| Database | PostgreSQL with Prisma ORM |
| Auth | JWT, bcrypt |
| Media | Cloudinary (signed direct uploads) |
| Payments | Razorpay Standard Checkout (test mode) |
| AI assistant | Grok (xAI) or Groq — any OpenAI-compatible chat API |
| Maps | Google Maps embed + directions links |
| Tests | Node.js built-in test runner (`node:test`) |

```
rentAny/
  backend/    Express API, Prisma schema & migrations, tests
  frontend/   React app (Vite + Tailwind)
  docs/       Updated workflow and plan
```

---

## Running the project locally

### Prerequisites
- Node.js 18+ (developed on Node 22)
- PostgreSQL 14+ with an empty database (e.g. `CREATE DATABASE rentany;`)
- Free accounts: Cloudinary, Razorpay (**test mode**), and optionally an AI API key (xAI Grok or Groq)

### Backend
```
cd backend
npm install
cp .env.example .env      # then fill in the values below
npx prisma migrate deploy  # creates all tables and constraints
npm run dev                # http://localhost:5000  (health: /api/health)
```

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `JWT_SECRET` | yes | Any long random string |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | yes | Media uploads |
| `CLIENT_URL` | no | Frontend origin(s) allowed by CORS (default `http://localhost:5173`) |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | for payments | **Test-mode** keys (`rzp_test_…`); live keys are refused |
| `RAZORPAY_WEBHOOK_SECRET` | for webhooks | Same secret as configured on the Razorpay webhook |
| `CRON_SECRET` | for the scheduled sweep | Protects `/api/internal/payments/sweep` |
| `GROK_API_KEY` | for the AI assistant | xAI or Groq key; without it the assistant uses catalog search |
| `GROK_API_URL`, `GROK_MODEL` | no | Defaults: `https://api.x.ai/v1`, `grok-3-mini`. For Groq use `https://api.groq.com/openai/v1` and a Groq model name |

Never commit `backend/.env` (it is git-ignored).

### Frontend
```
cd frontend
npm install
npm run dev                # http://localhost:5173
```
Optional `frontend/.env`: `VITE_API_URL` (default `http://localhost:5000/api`).

### Making a user an admin
```sql
UPDATE "User" SET role = 'ADMIN' WHERE email = 'someone@example.com';
```
(or edit the user in `npx prisma studio`), then log in again.

### Tests
```
cd backend
npm test
```
124 automated API tests cover authentication, listings and media, bookings and concurrency, notifications, payments and refunds (with a fake Razorpay), deposit claims, reviews, the AI assistant (with a fake AI) and the admin API. They run against the database in `DATABASE_URL` and clean up after themselves.

---

## Project timeline (actual)

| Period | Work completed |
|---|---|
| Aug 2026 | Requirement analysis and system design; project workflow and Gantt chart prepared |
| 4–13 Sep 2026 | Repository set up; React + Express skeleton; PostgreSQL + Prisma; registration/login (JWT, bcrypt); item listings with Cloudinary image upload; search |
| 2 Oct 2026 | Validation and error handling across the API; CORS and configuration checks; booking module (requests, accept/reject, availability, overlap prevention, expiry); required phone numbers; persistent notifications with live updates |
| 3 Oct 2026 | Multiple photos/videos per listing; secure direct-to-Cloudinary uploads |
| 4 Oct 2026 | Razorpay payments and refundable security deposits with dispute handling; reviews and ratings; AI rental assistant; item maps and directions; Home filters and sorting; admin panel; UI/UX polish; profile dashboard with listing edit, pause and delete |

Compared with the original Gantt chart, the planned scope (booking, payments & deposit, admin & disputes) is implemented ahead of schedule; the remaining time is for hardening, deployment and new features (below).

## Future scope (towards the final evaluation)

- **Deployment** on Vercel with a hosted PostgreSQL database, and end-to-end verification of Razorpay webhooks.
- **Public profiles and earnings**: public profile pages with reviews, and an earnings history for owners.
- **Location upgrade**: coordinates for listings and a true "nearest to me" sort.
- **AI assistant improvements**: better prompts, saved conversations, multi-item plans for an occasion.
- **Trust & safety**: photo evidence for deposit claims, reporting listings, email notifications.
- **Owner payouts** (Razorpay Route) — currently out of scope in test mode.
- Wider testing (browser/E2E), accessibility and performance work, final report and demonstration.

---

## Security notes
- Secrets live only in `backend/.env` (never in the frontend or the repository).
- Payment results, prices and uploads are always verified on the server; the browser is never trusted.
- Contact details are shared only between the two parties of a paid booking.

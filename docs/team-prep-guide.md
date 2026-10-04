# rentAny — Team Prep Guide for the Mid-Term Evaluation

For: Mukul, Prashant and Pratham. Read it before the evaluation so that each of us can explain the system, run the demo and answer questions.

---

## 1. The project in 30 seconds

> rentAny is a peer-to-peer rental marketplace where people rent everyday items **by the hour**. Owners list items with photos, price, deposit and location. Renters search, send a booking request, and pay online once the owner accepts. A refundable security deposit protects the owner, and reviews build trust. An AI assistant suggests real listings for an occasion. An admin resolves deposit disputes.

**Stack:** React + Vite + Tailwind (frontend) · Node.js + Express (backend) · PostgreSQL + Prisma (database) · Cloudinary (media) · Razorpay test mode (payments) · LLM API (assistant) · Google Maps (location).

---

## 2. How the system fits together

```
Browser (React)  ──HTTP/JSON──▶  Express API  ──Prisma──▶  PostgreSQL
      │                             │
      │ direct upload (signed)      ├──▶ Razorpay (orders, payments, refunds, webhooks)
      └──────────▶ Cloudinary ◀─────┤      (verify uploads)
                                    └──▶ LLM API (AI assistant)
```

- The **frontend** only displays data and collects input. It never decides prices, payment status or availability.
- The **backend** checks everything: logins (JWT), input validation, prices, payments and permissions.
- The **database** enforces the most important rule itself: two confirmed bookings of the same item can never overlap.

---

## 3. Module explanations (learn all of them, even the ones you didn't present)

### 3.1 Login and accounts
- Passwords are hashed with **bcrypt**, so the database never stores the real password.
- After login the server issues a **JWT token**. The browser sends it with every request, and the server checks it.
- Phone numbers are required at sign-up but shown to the other person only after the booking is paid, for privacy.

### 3.2 Listings and media
- An owner creates a listing with a title, category, hourly price, deposit and location.
- Each listing can have up to 8 photos and 2 videos (10 in total).
- **Direct upload:** the server gives the browser a signed "upload ticket". The browser uploads the file straight to Cloudinary, so large videos never pass through our server. The server then checks with Cloudinary that the file really exists before attaching it to the listing.

### 3.3 Booking flow
```
PENDING → ACCEPTED → CONFIRMED (paid) → ACTIVE (handed over) → COMPLETED (returned)
   └→ REJECTED / CANCELLED / EXPIRED
```
- A renter requests 1–72 hours, up to 30 days ahead.
- When the owner accepts one request, overlapping pending requests are rejected automatically.
- **Double-booking protection:** PostgreSQL has an *exclusion constraint* that rejects any two active bookings of the same item whose time ranges overlap. Even if two requests arrive at the same millisecond, the database blocks the second one.

### 3.4 Payments and security deposit
- Total paid = hourly price × hours + **₹49 platform fee** + **deposit**.
- The server creates a Razorpay **order**; the renter pays in the Razorpay popup.
- **Verification:** the server checks Razorpay's signature (HMAC) *and* fetches the payment from Razorpay itself. The browser's word is never trusted.
- **Webhooks:** Razorpay also notifies our server directly, so a payment still counts if the user closes the browser.
- **Cancellation policy:** if the owner cancels, the renter gets a full refund. If the renter cancels at least 24 hours before, they get the rental and deposit back; under 24 hours, 50% of the rental plus the deposit.
- **Deposit:** after the item is returned, the owner has 48 hours to claim damages. The renter can accept or dispute a claim, and an admin decides disputes. The rest of the deposit is refunded automatically.
- Every payment event is written to an **append-only audit log**.

### 3.5 Reviews and notifications
- After a completed rental, the renter rates the owner and the item, and the owner rates the renter. Each person leaves one review per booking.
- Notifications are stored in the database. The bell checks for new ones every 10 seconds and shows pop-ups.

### 3.6 AI assistant
- The user describes a need ("birthday party at home, budget ₹1000").
- The **server** first picks real, available listings from the database, then asks the LLM to choose and explain from that list only.
- Every ID the AI returns is checked again, so it cannot invent items. If the AI is down, the assistant falls back to normal keyword search.
- The API key stays on the server and is never sent to the browser.

### 3.7 Maps, filters, admin
- The item page shows a Google Maps embed of the listing's area and a **Get directions** button.
- The Home page offers search, category, price-range and area filters, and sorting.
- The admin panel lets an admin resolve deposit disputes, see platform totals and retry failed refunds.

### 3.8 Testing
- There are 116 automated backend tests (`cd backend && npm test`). They cover bookings under concurrency, payment and refund edge cases (with a fake Razorpay), the AI assistant (with a fake AI) and the admin API.

---

## 4. Demo plan (about 10 minutes)

Before the evaluation, have two accounts logged in (owner and renter, in two browsers) and an admin account. Seed 6–10 good-looking listings with photos.

| # | Step | Presenter |
|---|---|---|
| 1 | Intro, problem statement, architecture diagram | Pratham |
| 2 | Home page: search, filters, item page, gallery, map | Pratham |
| 3 | Owner creates a listing with photos/video | Mukul |
| 4 | Renter books → owner accepts → renter pays (Razorpay test card) | Mukul |
| 5 | Notifications appear; phone numbers revealed after payment | Mukul |
| 6 | AI assistant: "Planning a house party for 20 people" | Prashant |
| 7 | Handover → return → deposit claim → dispute → admin resolves | Prashant / Mukul |
| 8 | Reviews after completion | Pratham |
| 9 | Run the test suite; future scope and Gantt chart | Mukul / Pratham |

Keep a backup screen recording of the full flow in case the internet or Razorpay is slow.

---

## 5. Likely viva questions

| Question | Short answer |
|---|---|
| How do you prevent double booking? | With a PostgreSQL exclusion constraint on (item, time range) for active bookings. Accepting a booking also locks the item row. |
| How do you know a payment is real? | We verify Razorpay's HMAC signature and fetch the payment from Razorpay on the server. Webhooks are signature-checked too. |
| What if the user closes the tab after paying? | The Razorpay webhook and a scheduled reconciliation sweep still confirm the booking. |
| What if a refund is triggered twice? | Refunds carry idempotency keys and a send lock, so a refund is never sent twice. |
| Why JWT? | It is stateless: the server verifies a signed token instead of storing sessions. |
| Why upload directly to Cloudinary? | Large videos skip our server; signed tickets plus server verification keep it secure. |
| Can the AI recommend fake items? | No. It only chooses from server-selected listings, and every pick is re-validated. |
| Why PostgreSQL over MongoDB? | Bookings and payments need transactions, relations and constraints. |
| How is the deposit handled? | It is collected with the payment and held during a 48-hour claim window after return. The owner claims, the renter accepts or disputes, and an admin resolves; the rest is refunded. |
| What's left for the final evaluation? | Deployment, profiles and listing management, nearest-to-me search, AI improvements, trust features and the final report (see the workflow v2). |
| How did you use AI tools? | See section 7. |

---

## 6. Work ownership until the final evaluation

These are real assignments for the remaining phase. Each person owns their part, builds it and presents it at the final evaluation.

**Prashant Yadav: AI assistant**
- Study `backend/src/utils/chatAssistant.js` and `grok.js` and be able to explain the grounding and fallback.
- Set up and test the Groq key, and tune the prompts.
- Build the AI improvements: multi-item plans for an occasion, saved conversations, and a small set of test questions to measure answer quality.

**Pratham Mahajan: product quality, data and documentation**
- Create the demo data: realistic listings with good photos across categories.
- Write a manual QA checklist covering every flow in section 4, run it before each evaluation and log bugs as GitHub issues.
- Write the user guide, take screenshots, record the backup demo video, and lead the final report write-up.
- Start with small frontend tasks (text, layout, empty states), with Mukul reviewing.

**Mukul Bhardwaj: integration, deployment and payments**
- Deploy the app (Vercel plus hosted PostgreSQL) and verify Razorpay webhooks end to end.
- Build profiles and listing management, and the nearest-to-me search.
- Review everyone's pull requests and keep the Gantt chart up to date.

Pull requests and commits should come from the person doing the work, so the Git history reflects the final phase accurately.

---

## 7. Honesty about how the project was built

Much of the code so far was written with an AI coding assistant (Claude), directed by the team. We made the product decisions (booking rules, cancellation policy, deposit limits, fees and features), reviewed the designs, and tested the results.

- **Check the department's or guide's policy on AI tools** before the evaluation.
- If asked, answer plainly. For example: *"We used an AI coding assistant to help implement the code. We designed the features and rules, reviewed and tested everything, and we can explain how each part works."*
- Being open about this, and actually understanding the code, is far safer than claiming otherwise. Examiners usually test understanding with follow-up questions, and that is what this guide prepares you for.

# RentAny — Mid-Term Build

This covers the phases due by end of September per the project Gantt chart:
Requirement Analysis, Frontend Development, Backend & API Development,
Database Integration, and Authentication & Image Upload.

**Not included yet (later phases, Oct–Nov):** booking/payment/security
deposit, admin panel, maps, AI chatbot, ratings.

## What's built

- User registration & login (JWT + bcrypt password hashing)
- Owners can list an item with title, description, category, price/hour,
  location and an image (uploaded to Cloudinary)
- Anyone can browse and search listings on the home page
- Protected route so only logged-in users can create a listing

## Folder structure

```
rentAny/
  backend/     Node.js + Express + Prisma + PostgreSQL API
  frontend/    React + Vite + Tailwind CSS
```

## 1. Install prerequisites

You need these installed on your machine:

1. **Node.js** (v18 or later) — https://nodejs.org
2. **PostgreSQL** (v14 or later) — https://www.postgresql.org/download/
   - After installing, create a database. Easiest way, in a terminal:
     ```
     psql -U postgres
     CREATE DATABASE rentany;
     \q
     ```
3. A free **Cloudinary** account — https://cloudinary.com/users/register/free
   - After signing up, your Dashboard home page shows three values you'll
     need: **Cloud name**, **API Key**, **API Secret**.

## 2. Backend setup

```
cd backend
npm install
cp .env.example .env
```

Open `.env` and fill in:

- `DATABASE_URL` — your Postgres connection string (update the password and
  database name to match what you created above)
- `JWT_SECRET` — any long random string (e.g. mash your keyboard)
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` —
  from your Cloudinary dashboard

Then create the database tables and start the server:

```
npx prisma migrate dev --name init
npm run dev
```

You should see `RentAny backend running on http://localhost:5000`.
Visit `http://localhost:5000/api/health` in a browser — it should return
`{"status":"ok"}`.

## 3. Frontend setup

Open a **new terminal** (leave the backend running):

```
cd frontend
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

## 4. Try it out

1. Register a new account
2. Click "List an item", fill the form, attach an image, submit
3. Go back to the home page — your item should appear in the grid
4. Try the search box

## Notes for your report / demo

- Passwords are hashed with bcrypt before being stored — never stored in
  plain text.
- Auth uses stateless JWTs (7-day expiry), sent as `Authorization: Bearer <token>`.
- Prisma is the ORM, `backend/prisma/schema.prisma` is the single source of
  truth for the database schema — run `npx prisma studio` to view your data
  in a browser-based table editor.
- Image files never touch our own server disk; multer streams them directly
  to Cloudinary and we store only the resulting URL.

## If something doesn't work

- **`P1001` or connection refused from Prisma**: PostgreSQL isn't running,
  or `DATABASE_URL` is wrong.
- **Cloudinary upload fails**: double check the three Cloudinary values in
  `.env` have no extra spaces/quotes.
- **CORS error in browser console**: make sure the backend is running on
  port 5000 (or update `baseURL` in `frontend/src/api/axios.js` to match).

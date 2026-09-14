# Build notes — Skip (standalone check-in app)

Built 2026-09-14 (forked from the athlete portal's check-in system).
Location: `~/workspace/atkinson-hitting/skip-server/`

## What was built

A real server app (not a static page): **Node 24 + Express + `node:sqlite`** (Node's built-in
SQLite — no native modules, no external services). Server-rendered HTML, black/red,
mobile-first. Same boring-standard dependency set as the portal.

Forked from `portal-server/` with everything program-related stripped out:
**no athlete programs, no video library, no program coach views.** What stayed:

- **Auth** — bcrypt-hashed passwords, server-side sessions in SQLite (survive restarts),
  login/registration throttling, secure/HttpOnly/SameSite cookies in production.
- **Open signup** — `GET/POST /register`: username (3–20 chars, alphanumeric, unique),
  password (min 8), confirm password. No email. New users auto-login; role `athlete`,
  `athlete_name` = username (unique, used for drill-correlation grouping).
- **Seed** — coach/admin account `bobby` only. No athlete seeds; everyone signs up.
  `CREDENTIALS.md` (gitignored, mode 600) holds the coach password.
- **Check-in flow ("Check in with Skip")** — environment (Game / Cage / Live BP /
  Tee Work / Other), drills done (autocomplete datalist from the drill registry in
  `data/drill_links.json`; comma-separated multiples; free-typed names accepted),
  three 1–10 sliders (Feel, Confidence, Focus), session notes, what worked, what's next.
- **Skip's session score** — server-side average of the three ratings, one decimal.
  Tiers: 9.0+ Locked In, 7.0–8.9 Solid, 5.0–6.9 Off, below 5.0 Rough. Shown big
  after submit with a per-tier Skip line.
- **Skip's journal rating** — `skip_journal_score` / `skip_journal_note` /
  `skip_rated_at` columns; `POST /api/checkins/:id/skip-rating` (API key;
  401/404/400 on bad key/id/body). Hitters see a "Skip's read" block; unrated
  entries show "Skip's reviewing your entry — his read lands here."
- **"What works for you"** — per-hitter drill ranking by average session score
  (min 3 sessions), top 5, in Skip's voice; shown on home + history + coach views.
- **Coach dashboard** — hitter count, total check-in count, all users with
  check-in counts + last check-in, latest-check-ins feed across everyone,
  per-user history + drill correlation, JSON export for backup.
- **Ingestion API** — `GET /api/checkins?since=<ISO>` guarded by `SKIP_API_KEY`
  (`x-api-key` header or `?key=`). Returns every field per check-in, oldest first.
- **Deploy-ready** — `Dockerfile` (node:24-slim, `DB_PATH=/app/data/skip.db`),
  `render.yaml` (free tier, secrets auto-generated, service name `skip-checkin-app`),
  `.env.example`, `.gitignore` (excludes `CREDENTIALS.md`, `.env`, DB).

Deliberately NOT built: billing/subscription (free for now; accounts system is ready),
password change/reset, CSRF tokens, email.

## API shape (for the assistant)

`GET /api/checkins?since=2026-09-14T00:00:00Z` with `x-api-key: <SKIP_API_KEY>`
→ `{ "checkins": [{ id, athlete_name, username, created_at, environment,
drills_done[], feel, confidence, focus, session_score, score_tier,
session_notes, what_worked, whats_next,
skip_journal_score, skip_journal_note, skip_rated_at }] }`
401 = bad key, 400 = bad `since`. Poll with the last seen `created_at` for deltas.

`POST /api/checkins/:id/skip-rating` with the same key, body
`{ "score": 1–10, "note": "1–2 sentences in Skip's voice" }`
→ sets skip_journal_score / skip_journal_note / skip_rated_at, returns the
updated check-in. 401 = bad key, 404 = unknown id, 400 = bad body.
The assistant polls GET for check-ins with no `skip_journal_score`, reads the
journal text, and POSTs Skip's rating back — no in-app scheduling needed.

## Bobby's launch checklist — SKIP IS THE LAUNCH PRIORITY (~10 min)

1. **Render account** — sign up at render.com (2 min).
2. **Push to GitHub** — push the `skip-server` folder as its own repo.
   `CREDENTIALS.md` is gitignored and will NOT go with it (2 min).
3. **Create the service** — Render → New → Web Service → pick the repo.
   `render.yaml` pre-fills everything. Secrets generate automatically (2 min).
4. **Deploy, copy credentials** — open deploy Logs, copy the coach
   username/password printed on first boot (2 min).
5. **Remove `SEED_ON_BOOT`** — delete that env var in Render and redeploy, so the
   credentials never print again (1 min).
6. **Save `SKIP_API_KEY`** — from Render → Environment; hand it to the assistant
   so the poll→read→POST Skip's-read loop can target the live Skip API.
7. **Share the URL** — anyone can sign up free. No logins to hand out.
8. **Within a week: upgrade off free** — free tier wipes the database on restart.
   Starter ($7/mo) + the 1GB disk block commented in `render.yaml` makes
   accounts + check-ins permanent. Until then, hit Export on the dashboard regularly.

Local run: `npm install && npm run seed && npm start` (`CREDENTIALS.md`
generated in the project root for handoff).

## Relationship to portal-server

`portal-server/` is now **programs-only**: the 4 remote hitters' programs +
video library + coach program view. Its check-in feature was removed; the
remote hitters check in via the Skip app instead.

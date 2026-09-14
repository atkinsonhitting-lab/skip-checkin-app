# Skip

Check in with Skip. He'll score your session and learn what your best days look like.

A standalone session check-in app for hitters. Free to use — anyone can sign up. No programs, no video library (those live in the coach's private programs portal).

**Stack:** Node.js 24 + Express + `node:sqlite` (built in, zero native deps) + `express-session` with a SQLite session store. Server-rendered HTML, no build step, no external services. No billing — the accounts system is subscription-ready for later.

## Run locally

```bash
npm install
npm run seed        # create the coach account; writes CREDENTIALS.md (gitignored)
npm start           # http://localhost:3000
```

Copy `.env.example` to `.env` and set `SESSION_SECRET` and `SKIP_API_KEY` first.
`SEED_ON_BOOT=true` seeds the coach account automatically on first boot instead of `npm run seed`.

## What hitters get

- **Sign up** — pick a username (3–20 chars, letters/numbers) + password (8+ chars). Free, no email.
- **Check In** — environment (Game / Cage / Live BP / Tee Work / Other), drills done (autocomplete from the drill registry), three 1–10 sliders (Feel, Confidence, Focus), session notes, what worked, what's next.
- **Skip's Session Score** — instant score after submit: average of the three ratings, one decimal. Tiers: 9.0+ "Locked In", 7.0–8.9 "Solid", 5.0–6.9 "Off", below 5.0 "Rough".
- **Skip's read** — the assistant reads the journal entry and posts back a 1–10 rating + a line or two in Skip's voice. Shows on the score page and in history; before it's rated: "Skip's reviewing your entry — his read lands here."
- **What works for you** — drills ranked by the hitter's average session score (min 3 sessions each), top 5.
- **History** — every check-in submitted, newest first.

## What the coach gets

- **Dashboard** — hitter count, total check-ins, every user with check-in counts, latest check-ins feed across everyone, per-user history + drill correlation.
- **Export** — `/coach/export` downloads every check-in as JSON (backup).

## Ingestion API (for the AI assistant)

```
GET /api/checkins?since=<ISO timestamp>
```

Auth: `x-api-key` header or `?key=` query param — must equal `SKIP_API_KEY`.

- `since` is optional. Without it, returns up to 1000 check-ins, oldest first.
- `since` must be an ISO timestamp (e.g. `2026-09-14T00:00:00Z`); invalid → 400.
- Missing/wrong key → 401. `SKIP_API_KEY` unset → 500.

Response:

```json
{
  "checkins": [
    {
      "id": 1,
      "athlete_name": "somehitter",
      "username": "somehitter",
      "created_at": "2026-09-14T19:45:12.691Z",
      "environment": "Cage",
      "drills_done": ["Deep Tee Drill", "Walk In Drill"],
      "feel": 8,
      "confidence": 9,
      "focus": 7,
      "session_score": 8.0,
      "score_tier": "Solid",
      "session_notes": "...",
      "what_worked": "...",
      "whats_next": "...",
      "skip_journal_score": 7.5,
      "skip_journal_note": "You said timing was late on inside pitches — that's a load issue, not a swing issue.",
      "skip_rated_at": "2026-09-14T20:31:00.000Z"
    }
  ]
}
```

`session_score` is Skip's session score: the average of feel + confidence + focus,
one decimal. `score_tier`: 9.0+ "Locked In", 7.0–8.9 "Solid", 5.0–6.9 "Off",
below 5.0 "Rough".

Poll with `?since=<last seen created_at>` to pick up only new check-ins.

### Skip's journal rating

After reading a hitter's journal text (`session_notes`, `what_worked`,
`whats_next`), the assistant posts Skip's own take back to the check-in:

```
POST /api/checkins/:id/skip-rating
```

Same auth (`x-api-key` header or `?key=`). JSON body:

```json
{ "score": 7.5, "note": "One or two sentences in Skip's voice." }
```

- `score` must be a number from 1 to 10.
- `note` must be non-empty, 500 characters or fewer.
- Bad key → 401. Unknown check-in id → 404. Bad body → 400.
- On success, sets `skip_journal_score`, `skip_journal_note`, `skip_rated_at`
  (now, ISO) and returns the updated check-in in the same shape as above.

The assistant's loop: poll `GET /api/checkins` for check-ins with no
`skip_journal_score`, read the journal text, `POST` Skip's rating back.

## Deploy on Render (free tier) — LAUNCH PRIORITY

1. Create a Render account at https://render.com.
2. Push this folder as its own GitHub repo. **Do not commit `CREDENTIALS.md`** (it's gitignored).
3. Render → New → Web Service → select the repo. `render.yaml` fills in the settings (Docker, free plan).
4. `SESSION_SECRET` and `SKIP_API_KEY` are generated automatically. Leave `SEED_ON_BOOT=true` for the first deploy.
5. Deploy, then open the deploy **Logs** — the coach username + password is printed there once.
6. Copy the credentials, then **remove the `SEED_ON_BOOT` env var** and redeploy.
7. Save the `SKIP_API_KEY` value (Render dashboard → Environment) — that's what the assistant uses for `/api/checkins`. Set up the assistant's poll→read→POST loop against the live URL.
8. Share the public URL — anyone can sign up free.

## Known limits

- **Free-tier data loss:** Render's free tier has an ephemeral filesystem — the SQLite database (accounts + check-ins) is wiped when the service restarts. Fine for testing. For real use, upgrade to Starter ($7/mo) and add a persistent disk at `/app/data` (see the commented block in `render.yaml`); the Dockerfile already points `DB_PATH` there. Until then, use **Dashboard → Export** regularly as a backup.
- No password-change or password-reset yet (planned v2).
- No CSRF tokens on forms (SameSite=Lax cookies mitigate this).
- No billing yet — free for now, subscription later.

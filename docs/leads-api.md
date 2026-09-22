# Website Application Leads API

**Live endpoint:** `POST https://skip-checkin-app.onrender.com/api/leads`

Every submission lands in Bobby's Diamond Daily coach dashboard under
**Website applications** (stat card + section, tap-to-call/text buttons) and
fires a push notification to Bobby, same path as signup approvals.

This is the SHORT public application form — name, phone, age/level, goals.
The full intake questionnaire stays behind Bobby's link, post-call.

## Authentication

Set `LEADS_API_SECRET` in Render (Dashboard → thedailyhitter → Environment).
It's a full-replace env-var PUT, so include ALL existing vars.

The website must send the secret with every request — pick ONE:

- Form field: `secret=<LEADS_API_SECRET>`
- Query param: `?secret=<LEADS_API_SECRET>`
- Header: `x-leads-secret: <LEADS_API_SECRET>`

Without the secret → `401 unauthorized`. If `LEADS_API_SECRET` isn't set on
the server → `503 leads endpoint not configured`.

## Anti-spam

- **Honeypot:** include a field named `website`. Leave it empty — real users
  never see it (hide with CSS), bots fill it. Filled → `400 invalid submission`.
- **Rate limit:** 10 submissions per IP per hour → `429 too many submissions`.

## Fields

| Field       | Required | Max | Notes                                      |
|-------------|----------|-----|--------------------------------------------|
| `name`      | yes      | 80  | Athlete's name                             |
| `phone`     | yes      | 30  | Any format; dashboard shows Call/Text links |
| `age_level` | no       | 60  | e.g. "16", "HS junior", "college". Also accepts `age`. |
| `goals`     | no       | 500 | Free text                                  |
| `source`    | no       | 40  | Defaults to `website`                      |
| `secret`    | yes      | —   | The shared secret (see above)              |
| `website`   | —        | —   | Honeypot — must stay empty                 |

Accepts `application/x-www-form-urlencoded` (plain HTML forms) or JSON.
Success → `200 { "ok": true }`.

## Example HTML form

```html
<form action="https://skip-checkin-app.onrender.com/api/leads" method="post">
  <input type="hidden" name="secret" value="LEADS_API_SECRET">
  <input type="text" name="website" style="display:none" tabindex="-1" autocomplete="off">
  <input type="text" name="name" placeholder="Name" required>
  <input type="tel" name="phone" placeholder="Phone" required>
  <input type="text" name="age_level" placeholder="Age / level">
  <textarea name="goals" placeholder="What are your goals?"></textarea>
  <button type="submit">Apply</button>
</form>
```

## Example curl

```bash
curl -X POST https://skip-checkin-app.onrender.com/api/leads \
  -d "secret=$LEADS_API_SECRET" \
  -d "name=Test Athlete" \
  -d "phone=312-555-0142" \
  -d "age_level=HS junior" \
  -d "goals=Add exit velo before junior season"
```

## Coach workflow

On the coach dashboard, each lead card shows Call / Text buttons and a
status dropdown: `new` → `contacted` → `enrolled` (or `archived`).
Status changes are full-access coaches only (Bobby).

// Skip — server-rendered HTML views. Black/red, mobile-first, no build step.

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(iso) {
  // Rendered server-side as UTC; app.js localizes it in the browser.
  return `<span data-localtime="${esc(iso)}">${esc(iso)}</span>`;
}

// ---------- Layout ----------

function layout({ title, user, tabs, body }) {
  const tabHtml = (tabs || [])
    .map((t) => `<a href="${t.href}" class="tab${t.active ? ' active' : ''}">${esc(t.label)}</a>`)
    .join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)} · The Dugout</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="topbar">
  <div class="brand"><span class="brand-mark">D</span> THE DUGOUT</div>
  ${user ? `<div class="userbox">${esc(user.displayName)} · <a href="/logout">Log out</a></div>` : ''}
</header>
${tabHtml ? `<nav class="tabs">${tabHtml}</nav>` : ''}
<main class="wrap">${body}</main>
<script src="/app.js"></script>
</body>
</html>`;
}

function userTabs(active) {
  return [
    { href: '/', label: 'Home', active: active === 'home' },
    { href: '/checkin', label: 'Check In', active: active === 'checkin' },
    { href: '/chat', label: 'Talk to Skip', active: active === 'chat' },
    { href: '/history', label: 'History', active: active === 'history' },
  ];
}

function coachTabs(active) {
  return [{ href: '/coach', label: 'Dashboard', active: active === 'dashboard' }];
}

// ---------- Pages ----------

function loginPage(error, notice) {
  return layout({
    title: 'Log in',
    user: null,
    tabs: [],
    body: `<div class="login-card card">
      <h1>The Dugout</h1>
      <p class="hint">Step into The Dugout. Skip scores your sessions and learns what your best days look like.</p>
      ${error ? `<div class="error">${esc(error)}</div>` : ''}
      ${notice ? `<div class="notice">${esc(notice)}</div>` : ''}
      <form method="post" action="/login" class="form">
        <label>Email<input type="email" name="email" autocomplete="email" required></label>
        <label>Password<input type="password" name="password" autocomplete="current-password" required></label>
        <button type="submit" class="btn-primary">Log in</button>
      </form>
      <p class="hint" style="text-align:center"><a href="/forgot-password">Forgot password?</a></p>
      <p class="hint" style="text-align:center">New here? <a href="/register">Create an account</a> — it's free.</p>
    </div>`,
  });
}

function registerPage(error) {
  return layout({
    title: 'Sign up',
    user: null,
    tabs: [],
    body: `<div class="login-card card">
      <h1>Join The Dugout</h1>
      <p class="hint">Free. Use your email, set a password, start checking in.</p>
      ${error ? `<div class="error">${esc(error)}</div>` : ''}
      <form method="post" action="/register" class="form">
        <label>Email
          <input type="email" name="email" autocomplete="email" required>
        </label>
        <label>Password <span class="hint-inline">(8+ characters)</span>
          <input type="password" name="password" autocomplete="new-password" required minlength="8">
        </label>
        <label>Confirm password
          <input type="password" name="confirm_password" autocomplete="new-password" required minlength="8">
        </label>
        <button type="submit" class="btn-primary">Create account</button>
      </form>
      <p class="hint" style="text-align:center">Already have one? <a href="/login">Log in</a>.</p>
    </div>`,
  });
}

function userHome(user, extras) {
  const { drillStats = [], avgScore = null, checkinCount = 0, recent = [] } = extras || {};
  const head = avgScore !== null
    ? `<p class="hint">Skip's average score for you: <strong class="score-inline">${avgScore}</strong> across ${checkinCount} session${checkinCount === 1 ? '' : 's'}.</p>`
    : `<p class="hint">No check-ins yet. Log your first session and Skip starts learning your game.</p>`;
  return layout({
    title: 'Home',
    user,
    tabs: userTabs('home'),
    body: `<h1 class="page-title">What's up, ${esc(user.displayName)}</h1>
    <div class="card cta-card">
      <p class="skip-intro">Check in with Skip. He'll score your session and learn what your best days look like.</p>
      <a href="/checkin" class="btn-primary">Check in today's session</a>
    </div>
    ${head}
    ${whatWorksSection(drillStats, avgScore, checkinCount)}
    ${recent.length ? `<h2 class="section-head">Recent</h2>${recent.map(checkinCard).join('')}<p><a href="/history">See all history →</a></p>` : ''}`,
  });
}

// Skip's read on this hitter's check-ins: drills ranked by average session score.
function whatWorksSection(stats, avgScore, checkinCount) {
  const body = stats.length
    ? `<div class="works-rows">${stats
        .map(
          (s) => `<div class="works-row">
            <div class="works-drill">${esc(s.name)}</div>
            <div class="works-line">When you do <strong>${esc(s.name)}</strong>, your average score is <strong class="score-inline">${s.avg}</strong> <span class="hint-inline">(${s.count} sessions)</span></div>
          </div>`
        )
        .join('')}</div>`
    : `<p class="hint">Check in 3+ times and Skip will start spotting your patterns.</p>`;
  return `<section id="what-works" class="card">
    <h2>What works for you</h2>
    <p class="hint">Skip's read on your sessions — the drills your best days have in common.</p>
    ${body}
  </section>`;
}

const ENVIRONMENTS = ['Game', 'Cage', 'Live BP', 'Tee Work', 'Other'];

function sliderField(name, label, question, value) {
  const v = Math.min(10, Math.max(1, Number(value) || 7));
  return `<div class="slider-block">
    <div class="field-label">${esc(label)} <span class="hint-inline">${esc(question)}</span></div>
    <div class="slider-row">
      <input type="range" name="${name}" min="1" max="10" step="1" value="${v}" class="slider" data-out="${name}-out" aria-label="${esc(label)}">
      <span class="slider-val" id="${name}-out">${v}</span>
    </div>
    <div class="slider-ends"><span>1</span><span>10</span></div>
  </div>`;
}

function checkinForm(user, error, values, drillNames) {
  const v = values || {};
  const envPills = ENVIRONMENTS
    .map((e) => `<label class="pill"><input type="radio" name="environment" value="${e}"${v.environment === e ? ' checked' : ''} required><span>${e}</span></label>`)
    .join('');
  const datalist = (drillNames || [])
    .map((d) => `<option value="${esc(d)}">`)
    .join('');
  return layout({
    title: 'Check In',
    user,
    tabs: userTabs('checkin'),
    body: `<h1 class="page-title">Check in with Skip</h1>
    <div class="card"><p class="hint skip-intro">Tell Skip about your session. Give as much detail as you can — the more he knows, the better his reads get.</p>
    <form method="post" action="/checkin" class="form">
      ${error ? `<div class="error">${esc(error)}</div>` : ''}
      <div class="field-label">Where were you?</div>
      <div class="pills">${envPills}</div>
      <label>What drills did you do today? <span class="hint-inline">(separate with commas)</span>
        <input name="drills_done" list="drill-list" placeholder="e.g. Deep Tee Drill, Walk In Drill" value="${esc(v.drills_done || '')}" required>
      </label>
      <datalist id="drill-list">${datalist}</datalist>
      ${sliderField('feel', 'Feel', 'How good did you feel?', v.feel)}
      ${sliderField('confidence', 'Confidence', 'How confident did you feel?', v.confidence)}
      ${sliderField('focus', 'Focus', 'How locked in was your focus?', v.focus)}
      <label>Session notes <span class="hint-inline">(don't hold back — what you felt, what you saw, what was off)</span><textarea name="session_notes" rows="4" placeholder="How did it go? What did you feel?">${esc(v.session_notes || '')}</textarea></label>
      <label>What worked <span class="hint-inline">(be specific — the exact drill, cue, or feel)</span><textarea name="what_worked" rows="2" placeholder="What clicked today?">${esc(v.what_worked || '')}</textarea></label>
      <button type="submit" class="btn-primary">Submit check-in</button>
    </form></div>`,
  });
}

const TIER_NOTES = {
  'Locked In': "That's the standard. Remember exactly what this felt like.",
  'Solid': 'Good day. Stack another one on top of it.',
  'Off': 'Shake it off — keep what worked, flush the rest.',
  'Rough': 'Everyone has them. Write down one thing to fix and move on.',
};

function tierBadgeClass(tier) {
  if (tier === 'Locked In') return 'ok';
  if (tier === 'Solid') return 'ok';
  if (tier === 'Off') return 'warn';
  return 'bad';
}

function scorePage(user, c) {
  const scoreStr = Number(c.session_score).toFixed(1);
  return layout({
    title: "Skip's Session Score",
    user,
    tabs: userTabs('checkin'),
    body: `<div class="card score-hero">
      <div class="score-kicker">Skip's Session Score</div>
      <div class="score-num">${esc(scoreStr)}</div>
      <div><span class="badge ${tierBadgeClass(c.score_tier)} badge-lg">${esc(c.score_tier)}</span></div>
      <p class="hint skip-note">${esc(TIER_NOTES[c.score_tier] || '')}</p>
      <div class="score-breakdown">
        <div><span class="label">Feel</span><strong>${esc(c.feel)}</strong></div>
        <div><span class="label">Confidence</span><strong>${esc(c.confidence)}</strong></div>
        <div><span class="label">Focus</span><strong>${esc(c.focus)}</strong></div>
      </div>
      ${skipReadBlock(c)}
      <div class="score-actions">
        <a href="/history" class="btn-primary">See your history</a>
        <p class="hint" style="text-align:center"><a href="/chat">Talk it through with Skip →</a></p>
        <p class="hint" style="text-align:center"><a href="/checkin">Log another session</a></p>
      </div>
    </div>`,
  });
}

function drillsOf(c) {
  try {
    const arr = JSON.parse(c.drills_done || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

// Skip's journal rating: posted by the assistant after reading the hitter's
// journal text. Shown once rated; a subtle placeholder before that.
function skipReadBlock(c) {
  if (c.skip_journal_score != null) {
    const s = Number(c.skip_journal_score);
    return `<div class="skip-read">
      <div class="skip-read-head">Skip's read</div>
      <div class="skip-read-score">${esc(Number.isFinite(s) ? s.toFixed(1) : s)}<span class="skip-read-of">/10</span></div>
      ${c.skip_journal_note ? `<p>${esc(c.skip_journal_note)}</p>` : ''}
    </div>`;
  }
  return `<p class="skip-pending">Skip's reviewing your entry — his read lands here.</p>`;
}

function checkinCard(c) {
  const drills = drillsOf(c);
  return `<div class="card checkin">
    <div class="checkin-head">
      <span class="checkin-date">${fmtDate(c.created_at)}</span>
      ${c.environment ? `<span class="badge env">${esc(c.environment)}</span>` : ''}
    </div>
    ${c.athlete_name && c.showAthlete ? `<div class="checkin-athlete">${esc(c.athlete_name)}</div>` : ''}
    ${c.session_score != null ? `<div class="checkin-score">
      <span class="score-inline-lg">${esc(c.session_score)}</span>
      <span class="badge ${tierBadgeClass(c.score_tier)}">${esc(c.score_tier)}</span>
      <span class="hint-inline">Feel ${esc(c.feel)} · Conf ${esc(c.confidence)} · Focus ${esc(c.focus)}</span>
    </div>` : ''}
    ${drills.length ? `<div class="drill-chips">${drills.map((d) => `<span class="chip">${esc(d)}</span>`).join('')}</div>` : ''}
    ${skipReadBlock(c)}
    ${c.session_notes ? `<p>${esc(c.session_notes)}</p>` : ''}
    <div class="checkin-grid">
      ${c.what_worked ? `<div><span class="label">What worked</span>${esc(c.what_worked)}</div>` : ''}
    </div>
  </div>`;
}

function historyPage(user, checkins, justSubmitted) {
  const scored = checkins.filter((c) => c.session_score != null);
  const avg = scored.length
    ? Math.round((scored.reduce((s, c) => s + c.session_score, 0) / scored.length) * 10) / 10
    : null;
  return layout({
    title: 'History',
    user,
    tabs: userTabs('history'),
    body: `<h1 class="page-title">Your Check-Ins</h1>
    ${avg !== null ? `<p class="hint">Skip's average score for you: <strong class="score-inline">${avg}</strong> over ${scored.length} session${scored.length === 1 ? '' : 's'}.</p>` : ''}
    ${justSubmitted ? `<div class="success">Check-in saved. Good work.</div>` : ''}
    ${checkins.length ? checkins.map(checkinCard).join('') : `<div class="card empty">No check-ins yet. <a href="/checkin">Log your first session</a>.</div>`}`,
  });
}

function chatPage(user, messages, chatEnabled) {
  const msgs = (messages || [])
    .map(
      (m) => `<div class="msg ${m.role === 'user' ? 'msg-user' : 'msg-skip'}"><div class="msg-bubble">${esc(m.content)}</div></div>`
    )
    .join('');
  return layout({
    title: 'Talk to Skip',
    user,
    tabs: userTabs('chat'),
    body: `<h1 class="page-title">Talk to Skip</h1>
    <p class="hint">Struggling? Tell Skip what's going on at the plate — he's seen your check-ins and will point you back on track.</p>
    ${chatEnabled
      ? `<div id="chat-log" class="chat-log">${msgs || `<div class="msg msg-skip"><div class="msg-bubble">What's going on at the plate? Tell me what feels off.</div></div>`}</div>
      <form id="chat-form" class="chat-form" autocomplete="off">
        <input id="chat-input" type="text" placeholder="Ask Skip…" maxlength="2000" required>
        <button type="submit" class="btn-primary">Send</button>
      </form>`
      : `<div class="card empty">Skip's chat isn't switched on yet — check back soon.</div>`}`,
  });
}

function coachDashboard(user, userStats, latest) {
  const totalCheckins = userStats.reduce((s, u) => s + u.total, 0);
  const cards = userStats
    .map(
      (a) => `<a class="card athlete-card" href="/coach/user/${encodeURIComponent(a.email)}">
        <div class="athlete-card-name">${esc(a.name)}</div>
        <div class="athlete-card-email">${esc(a.email)}</div>
        <div class="athlete-card-meta">${a.total} check-in${a.total === 1 ? '' : 's'}${a.last ? ` · last ${fmtDate(a.last)}` : ' · none yet'}</div>
      </a>`
    )
    .join('');
  const feed = latest.length
    ? latest.map((c) => checkinCard({ ...c, showAthlete: true })).join('')
    : '<div class="card empty">No check-ins yet.</div>';
  return layout({
    title: 'Coach Dashboard',
    user,
    tabs: coachTabs('dashboard'),
    body: `<h1 class="page-title">Skip Dashboard</h1>
    <div class="stat-row">
      <div class="card stat"><div class="stat-num">${userStats.length}</div><div class="stat-label">hitters</div></div>
      <div class="card stat"><div class="stat-num">${totalCheckins}</div><div class="stat-label">check-ins</div></div>
    </div>
    <h2 class="section-head">Hitters</h2>
    <div class="athlete-grid">${cards || '<div class="card empty">Nobody has signed up yet.</div>'}</div>
    <h2 class="section-head">Latest check-ins</h2>
    ${feed}`,
  });
}

function coachUser(user, name, checkins, stats) {
  return layout({
    title: name,
    user,
    tabs: coachTabs('dashboard'),
    body: `<h1 class="page-title">${esc(name)}</h1>
    <p><a href="/coach">← Back to dashboard</a></p>
    ${whatWorksSection(stats || [], null, 0)}
    ${checkins.length ? checkins.map(checkinCard).join('') : '<div class="card empty">No check-ins yet.</div>'}`,
  });
}

function forgotPasswordPage(sent) {
  return layout({
    title: 'Forgot password',
    user: null,
    tabs: [],
    body: `<div class="login-card card">
      <h1>Reset password</h1>
      <p class="hint">Enter your account email and we'll send you a reset link.</p>
      ${sent ? `<div class="notice">${esc(sent)}</div>` : ''}
      <form method="post" action="/forgot-password" class="form">
        <label>Email<input type="email" name="email" autocomplete="email" required></label>
        <button type="submit" class="btn-primary">Send reset link</button>
      </form>
      <p class="hint" style="text-align:center"><a href="/login">Back to log in</a></p>
    </div>`,
  });
}

function resetPasswordPage(token, error) {
  return layout({
    title: 'Set a new password',
    user: null,
    tabs: [],
    body: `<div class="login-card card">
      <h1>New password</h1>
      ${error ? `<div class="error">${esc(error)}</div>` : ''}
      ${token ? `<form method="post" action="/reset-password" class="form">
        <input type="hidden" name="token" value="${esc(token)}">
        <label>New password <span class="hint-inline">(8+ characters)</span>
          <input type="password" name="password" autocomplete="new-password" required minlength="8">
        </label>
        <label>Confirm new password
          <input type="password" name="confirm_password" autocomplete="new-password" required minlength="8">
        </label>
        <button type="submit" class="btn-primary">Set password</button>
      </form>` : `<p class="hint" style="text-align:center"><a href="/forgot-password">Request a new link</a></p>`}
    </div>`,
  });
}

module.exports = {
  layout,
  userTabs,
  coachTabs,
  loginPage,
  registerPage,
  userHome,
  checkinForm,
  scorePage,
  historyPage,
  chatPage,
  coachDashboard,
  coachUser,
  forgotPasswordPage,
  resetPasswordPage,
  esc,
};

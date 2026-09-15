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
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
<title>${esc(title)} · The Daily Hitter</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="topbar">
  <div class="brand"><img src="/daily-hitter-logo.jpg" class="brand-logo-icon" alt=""> THE DAILY HITTER</div>
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
    { href: '/routine', label: 'Routine', active: active === 'routine' },
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
      <img src="/daily-hitter-logo.jpg" class="brand-logo-full" alt="The Daily Hitter — A Hitting Journal">
      <p class="hint">Step into The Daily Hitter. Skip scores your sessions and learns what your best days look like.</p>
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
      <img src="/daily-hitter-logo.jpg" class="brand-logo-full" alt="The Daily Hitter — A Hitting Journal">
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

function sliderField(name, label, question, value, ends, ids) {
  const v = Math.min(10, Math.max(1, Number(value) || 7));
  const lo = (ends && ends[0]) || '1';
  const hi = (ends && ends[1]) || '10';
  const qId = ids ? ` id="${name}-q"` : '';
  const loId = ids ? ` id="${name}-lo"` : '';
  const hiId = ids ? ` id="${name}-hi"` : '';
  return `<div class="slider-block">
    <div class="field-label">${esc(label)} <span class="hint-inline"${qId}>${esc(question)}</span></div>
    <div class="slider-row">
      <input type="range" name="${name}" min="1" max="10" step="1" value="${v}" class="slider" data-out="${name}-out" aria-label="${esc(label)}">
      <span class="slider-val" id="${name}-out">${v}</span>
    </div>
    <div class="slider-ends"><span${loId}>${esc(lo)}</span><span${hiId}>${esc(hi)}</span></div>
  </div>`;
}

function checkinForm(user, error, values, drillNames, routine) {
  const v = values || {};
  const rt = routine || [];
  const routineJson = esc(JSON.stringify(rt.map((d) => ({ name: d.name, station: d.station }))));
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
      ${sliderField('feel', 'Feel', 'How good did you feel?', v.feel)}
      ${sliderField('confidence', 'Confidence', 'How confident did you feel?', v.confidence)}
      ${sliderField('focus', 'Focus', 'How locked in was your focus?', v.focus)}
      ${sliderField('difficulty', 'Difficulty', 'How hard was the training?', v.difficulty, ['Easy', 'Brutal'], true)}
      <script>(function(){var q=document.getElementById('difficulty-q'),lo=document.getElementById('difficulty-lo'),hi=document.getElementById('difficulty-hi');if(!q)return;function upd(){var s=document.querySelector('input[name="environment"]:checked');var g=s&&s.value==='Game';q.textContent=g?'How good was the pitching?':'How hard was the training?';lo.textContent=g?'Weak':'Easy';hi.textContent=g?'Nasty':'Brutal';}document.querySelectorAll('input[name="environment"]').forEach(function(r){r.addEventListener('change',upd)});upd();})();</script>
      <label>Session notes <span class="hint-inline">(don't hold back — what you felt, what you saw, what was off)</span><textarea name="session_notes" rows="4" placeholder="How did it go? What did you feel?">${esc(v.session_notes || '')}</textarea></label>
      <label>What worked <span class="hint-inline">(be specific — the exact drill, cue, or feel)</span><textarea name="what_worked" rows="2" placeholder="What clicked today?">${esc(v.what_worked || '')}</textarea></label>
      <div class="field-label">Did you do any drills?</div>
      <div class="pills">
        <label class="pill"><input type="radio" name="did_drills" value="yes"${v.did_drills === 'yes' ? ' checked' : ''} required><span>Yes</span></label>
        <label class="pill"><input type="radio" name="did_drills" value="no"${v.did_drills === 'no' ? ' checked' : ''} required><span>No</span></label>
      </div>
      <div id="drill-names"${v.did_drills === 'yes' ? '' : ' hidden'}>
        <label>What ones? <span class="hint-inline">(separate with commas)</span>
          <input id="drills-input" name="drills_done" list="drill-list" placeholder="e.g. Deep Tee Drill, Walk In Drill" value="${esc(v.drills_done || '')}">
        </label>
        ${rt.length ? `<button type="button" id="use-routine" class="btn-ghost" data-routine="${routineJson}">Use my daily routine</button>` : ''}
        <p class="hint">Tip: add (tee), (side toss), (front toss), (BP), or (machine) after a drill — e.g. "Fence drill (tee)".</p>
      </div>
      <datalist id="drill-list">${datalist}</datalist>
      <button type="submit" class="btn-primary">Submit check-in</button>
    </form></div>`,
  });
}

function routinePage(user, drills, error, drillNames, stations) {
  const groups = (stations || []).map((st) => ({
    station: st,
    drills: (drills || []).filter((d) => (d.station || '').toLowerCase() === st.toLowerCase()),
  }));
  const datalist = (drillNames || []).map((d) => `<option value="${esc(d)}">`).join('');
  const stationOpts = (stations || []).map((st) => `<option value="${esc(st)}">${esc(st)}</option>`).join('');
  return layout({
    title: 'Daily Routine',
    user,
    tabs: userTabs('routine'),
    body: `<h1 class="page-title">Daily routine</h1>
    <div class="card"><p class="hint skip-intro">Your everyday drills. Set it once — then one tap loads it into your check-in.</p>
    ${error ? `<div class="error">${esc(error)}</div>` : ''}
    <form method="post" action="/routine/add" class="form routine-add">
      <label>Drill
        <input name="name" list="drill-list" placeholder="e.g. Fence drill" maxlength="80" required>
      </label>
      <datalist id="drill-list">${datalist}</datalist>
      <label>Done on
        <select name="station" required>
          <option value="" disabled selected>Pick one</option>
          ${stationOpts}
        </select>
      </label>
      <button type="submit" class="btn-primary">Add drill</button>
    </form></div>
    ${groups.map((g) => `
    <div class="card routine-group">
      <h2 class="routine-station">${esc(g.station)}</h2>
      ${g.drills.length ? g.drills.map((d) => `
        <div class="routine-row">
          <span class="routine-name">${esc(d.name)}</span>
          <form method="post" action="/routine/remove" class="routine-remove">
            <input type="hidden" name="id" value="${d.id}">
            <button type="submit" class="btn-ghost btn-sm" aria-label="Remove ${esc(d.name)}">Remove</button>
          </form>
        </div>`).join('') : `<p class="hint">Nothing here yet.</p>`}
    </div>`).join('')}`,
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
  const bd = c.score_breakdown;
  const signed = (n) => (n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1));
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
        ${c.difficulty != null ? `<div><span class="label">Difficulty</span><strong>${esc(c.difficulty)}</strong></div>` : ''}
      </div>
      ${bd ? `<p class="hint score-formula">Base ${bd.base.toFixed(1)} · Grind ${signed(bd.grind)} · Your words ${signed(bd.words)}</p>` : ''}
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
  // Normalizes drills_done to [{name, station|null}]; handles legacy
  // rows stored as plain name strings.
  try {
    const arr = JSON.parse(c.drills_done || '[]');
    if (!Array.isArray(arr)) return [];
    return arr
      .map((d) =>
        d && typeof d === 'object'
          ? { name: String(d.name || ''), station: d.station || null }
          : { name: String(d || ''), station: null }
      )
      .filter((d) => d.name);
  } catch (e) {
    return [];
  }
}

function drillChip(d) {
  return `<span class="chip">${esc(d.name)}${d.station ? ` <span class="chip-station">${esc(d.station)}</span>` : ''}</span>`;
}

// Skip's journal rating: posted by the assistant after reading the hitter's
// journal text. Shown once rated; a subtle placeholder before that.
function skipReadBlock(c) {
  if (c.skip_journal_note) {
    return `<div class="skip-read">
      <div class="skip-read-head">Skip's read</div>
      <p>${esc(c.skip_journal_note)}</p>
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
      <span class="hint-inline">Feel ${esc(c.feel)} · Conf ${esc(c.confidence)} · Focus ${esc(c.focus)}${c.difficulty != null ? ` · Difficulty ${esc(c.difficulty)}` : ''}</span>
    </div>` : ''}
    ${drills.length ? `<div class="drill-chips">${drills.map(drillChip).join('')}</div>` : ''}
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
  const skipImg = `<img src="/skip-avatar.webp" class="skip-avatar" alt="Skip">`;
  const msgs = (messages || [])
    .map(
      (m) => `<div class="msg ${m.role === 'user' ? 'msg-user' : 'msg-skip'}">${m.role === 'user' ? '' : skipImg}<div class="msg-bubble">${esc(m.content)}</div></div>`
    )
    .join('');
  return layout({
    title: 'Talk to Skip',
    user,
    tabs: userTabs('chat'),
    body: `<h1 class="page-title chat-title"><img src="/skip-avatar.webp" class="skip-avatar" alt="Skip">Talk to Skip</h1>
    <p class="hint">Struggling? Tell Skip what's going on at the plate — he's seen your check-ins and will point you back on track.</p>
    ${chatEnabled
      ? `<div class="chat-mode">
        <button type="button" id="mode-text" class="mode-btn mode-active">Text</button>
        <button type="button" id="mode-live" class="mode-btn">Live</button>
      </div>
      <div id="text-panel">
        <div id="chat-log" class="chat-log">${msgs || `<div class="msg msg-skip">${skipImg}<div class="msg-bubble">What's going on at the plate? Tell me what feels off.</div></div>`}</div>
        <form id="chat-form" class="chat-form" autocomplete="off">
          <input id="chat-input" type="text" placeholder="Ask Skip…" maxlength="2000" required>
          <button type="submit" class="btn-primary">Send</button>
        </form>
      </div>
      <div id="live-panel" hidden>
        <div class="card live-card">
          <div id="live-status" class="live-status">Talk it out with Skip — live voice, like a phone call.</div>
          <div id="live-transcript" class="chat-log live-transcript"></div>
          <div class="live-controls">
            <button type="button" id="live-start" class="btn-primary">Start live conversation</button>
            <button type="button" id="live-end" class="btn-ghost" hidden>End</button>
          </div>
          <p class="hint">Everything you both say is saved to your chat as a transcript.</p>
        </div>
      </div>
      <script src="/live.js"></script>`
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
  routinePage,
  scorePage,
  historyPage,
  chatPage,
  coachDashboard,
  coachUser,
  forgotPasswordPage,
  resetPasswordPage,
  esc,
};

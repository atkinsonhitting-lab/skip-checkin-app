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
    .map((t) => `<a href="${t.href}" class="drawer-link${t.active ? ' active' : ''}"><span class="drawer-link-text">${esc(t.label)}${t.sub ? `<span class="drawer-sub">${esc(t.sub)}</span>` : ''}</span>${t.badge ? `<span class="tab-badge">${esc(t.badge)}</span>` : ''}</a>`)
    .join('');
  const drawer = tabHtml
    ? `<div id="drawer-overlay" hidden></div>
       <aside id="drawer" aria-label="Navigation" hidden>
         <div class="drawer-head"><span>THE DAILY HITTER</span><button type="button" id="drawer-close" aria-label="Close menu">\u2715</button></div>
         <nav>${tabHtml}</nav>
       </aside>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
<title>${esc(title)} · The Daily Hitter</title>
<link rel="stylesheet" href="/style.css">
<link rel="apple-touch-icon" sizes="180x180" href="/icons/icon-180.png">
<link rel="apple-touch-icon" sizes="152x152" href="/icons/icon-152.png">
<link rel="apple-touch-icon" sizes="167x167" href="/icons/icon-167.png">
<link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="The Daily Hitter">
<meta name="theme-color" content="#0a0a0a">
</head>
<body>
<header class="topbar">
  <div class="topbar-left">${tabHtml ? `<button type="button" id="drawer-btn" aria-label="Open menu">\u2630</button>` : ''}<div class="brand"><img src="/daily-hitter-logo.jpg" class="brand-logo-icon" alt=""> THE DAILY HITTER</div></div>
  ${user ? `<div class="userbox">${esc(user.displayName)} · <a href="/logout">Log out</a></div>` : ''}
</header>
${drawer}
${user && user.viewAs ? `<div class="viewas-banner">Previewing as <strong>${esc(user.viewAsName)}</strong> — actions are disabled. <form method="post" action="/coach/view-as/exit" style="display:inline;margin:0"><button type="submit" class="viewas-exit">Exit preview</button></form></div>` : ''}
<main class="wrap">${body}</main>
${(() => {
  const chatTab = (tabs || []).find((t) => t.href === '/chat');
  if (!chatTab || chatTab.active) return '';
  return `<a href="/chat" class="skip-fab" aria-label="Talk to Coach Skip"><img src="/skip-avatar.webp" alt="Skip"><span class="skip-fab-bubble" aria-hidden="true">\uD83D\uDCAC</span></a>`;
})()}
<script src="/app.js"></script>
</body>
</html>`;
}

function userTabs(active, user) {
  const tabs = [
    { href: '/', label: 'Home', active: active === 'home' },
    { href: '/checkin', label: 'Check In', active: active === 'checkin' },
    { href: '/notebook', label: 'Notebook', active: active === 'notebook' },
    { href: '/mental-game', label: 'Mental Game', active: active === 'mental' },
    { href: '/chat', label: 'Talk to Skip', sub: 'your personally trained hitting coach', active: active === 'chat' },
    { href: '/settings', label: 'Settings', active: active === 'settings' },
  ];
  // Bobby's remote hitters only — nobody else ever sees this tab.
  if (user && user.remoteProgramId) {
    tabs.splice(3, 0, { href: '/program', label: 'Program', active: active === 'program' });
    tabs.splice(4, 0, { href: '/program/routine', label: 'Routine', active: active === 'routine' });
    tabs.splice(5, 0, { href: '/videos', label: 'Videos', active: active === 'videos' });
  }
  return tabs;
}

function coachTabs(active, approvalCount) {
  return [
    { href: '/coach', label: 'Dashboard', active: active === 'dashboard' },
    { href: '/coach/approvals', label: 'Approvals', active: active === 'approvals', badge: approvalCount > 0 ? String(approvalCount) : null },
    { href: '/coach/skip', label: 'Train Skip', active: active === 'skip' },
    { href: '/settings', label: 'Settings', active: active === 'settings' },
  ];
}

// ---------- Pages ----------

function loginPage(error, notice) {
  return layout({
    title: 'Log in',
    user: null,
    tabs: [],
    body: `<div class="login-card card">
      <img src="/daily-hitter-logo.jpg" class="brand-logo-full" alt="The Daily Hitter — A Hitting Journal">
      <p class="hint">Step into The Daily Hitter. Skip reads your sessions and learns what your best days look like.</p>
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
      <p class="hint">Free. Use your email, set a password, start checking in. Your coach approves every new account.</p>
      ${error ? `<div class="error">${esc(error)}</div>` : ''}
      <form method="post" action="/register" class="form">
        <label>First name
          <input type="text" name="first_name" autocomplete="given-name" required maxlength="40">
        </label>
        <label>Last name
          <input type="text" name="last_name" autocomplete="family-name" required maxlength="40">
        </label>
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

// Waiting room: the hitter signed up but Bobby hasn't approved them yet.
function pendingPage() {
  return layout({
    title: 'Waiting for approval',
    user: null,
    tabs: [],
    body: `<div class="login-card card">
      <img src="/daily-hitter-logo.jpg" class="brand-logo-full" alt="The Daily Hitter — A Hitting Journal">
      <h1 class="page-title">You're on the list.</h1>
      <p class="hint">Every account is personally approved. You'll be able to log in as soon as you get the green light.</p>
      <p class="hint" style="text-align:center"><a href="/login">Back to log in</a></p>
    </div>`,
  });
}

function userHome(user, extras) {
  const { whatWorks = {}, avgScore = null, checkinCount = 0, recent = [], streak = null, pushOn = false, pushEnabled = false, precheckin = null } = extras || {};
  let streakCard = '';
  if (streak) {
    const n = streak.streak || 0;
    if (n >= 1) {
      const line =
        n >= 30 ? '30 days. You\u2019re a different hitter.' :
        n >= 7 ? 'A full week \u2014 that\u2019s how habits are built.' :
        n >= 2 ? 'Keep it rolling.' :
        'Check in tomorrow to build it.';
      streakCard = `<div class="card streak-card"><div class="streak-num">${n}</div><div><div class="streak-label">day streak</div><div class="hint">${line}</div></div></div>`;
    } else if (streak.daysSince != null && streak.daysSince >= 1) {
      streakCard = `<div class="card"><p style="margin:0">Streak reset \u2014 last check-in ${streak.daysSince} day${streak.daysSince === 1 ? '' : 's'} ago. Today starts a new one.</p></div>`;
    }
  }
  const pushCard = (pushEnabled && !pushOn)
    ? `<div class="card push-card">
        <p style="margin:0 0 10px"><strong>Never miss a day.</strong> <span class="hint">Turn on reminders \u2014 Skip nudges you on days you haven\u2019t checked in.</span></p>
        <p style="margin:0"><button type="button" class="btn-primary" id="push-enable-btn" style="margin-top:0">Turn on reminders</button></p>
      </div>`
    : '';
  const head = avgScore !== null
    ? `<div class="level-head"><p class="hint">Skip's read on you across ${checkinCount} session${checkinCount === 1 ? '' : 's'}:</p>${levelLine(avgScore)}</div>`
    : `<p class="hint">No check-ins yet. Log your first session and Skip starts learning your game.</p>`;
  const preCard = precheckin
    ? `<div class="card"><p style="margin:0 0 6px"><strong>Today's intent</strong> <span class="hint-inline">${precheckin.kind === 'game' ? 'Pregame / Live ABs' : 'Cage'}</span></p>
        ${precheckin.focus ? `<p style="margin:0 0 4px">&ldquo;${esc(precheckin.focus)}&rdquo;</p>` : ''}
        ${precheckin.plan ? `<p class="hint" style="margin:0 0 4px">Plan: ${esc(precheckin.plan)}</p>` : ''}
        ${precheckin.flush ? `<p class="hint" style="margin:0">Flushing: ${esc(precheckin.flush)}</p>` : ''}
        <p class="hint" style="margin:8px 0 0"><a href="/precheckin?kind=${precheckin.kind === 'game' ? 'game' : 'cage'}">Update it →</a></p></div>`
    : `<div class="card"><p style="margin:0"><strong>Before you hit?</strong> <span class="hint">Set your intent in two minutes — what you're working on and how. Optional.</span> <a href="/precheckin">Pre-hit check-in →</a></p></div>`;
  return layout({
    title: 'Home',
    user,
    tabs: userTabs('home', user),
    body: `<h1 class="page-title">What's up, ${esc(user.displayName)}</h1>
    <div class="card cta-card">
      <p class="skip-intro">Check in with Skip. He'll rate every session and learn what your best days look like.</p>
      <a href="/checkin" class="btn-primary">Check in today's session</a>
    </div>
    ${preCard}
    ${head}
    ${pushOn ? '' : streakCard}
    ${pushCard}
    ${whatWorksSection(whatWorks)}
    ${recent.length ? `<h2 class="section-head">Recent</h2>${recent.map(checkinCard).join('')}<p><a href="/notebook">See your notebook →</a></p>` : ''}
    ${pushOn ? streakCard : ''}`,
  });
}

// Skip's read on this hitter's check-ins: which cues to use, which to trash,
// whether routine days beat other days, and routine suggestions built from
// the drills of their best sessions.
function whatWorksSection(data, opts) {
  const d = data || {};
  const readOnly = !!(opts && opts.readOnly);
  const good = (d.goodCues || [])
    .map(
      (t) => `<div class="works-row">
          <div class="works-drill">&ldquo;${esc(t.text)}&rdquo;</div>
          <div class="works-line">Shows up on your good days <span class="hint-inline">(${t.count} sessions)</span>${levelLine(t.avg)}</div>
        </div>`
    )
    .join('');
  const trash = (d.trashCues || [])
    .map(
      (t) => `<div class="works-row">
          <div class="works-drill">&ldquo;${esc(t.text)}&rdquo;</div>
          <div class="works-line">Shows up on your rough days \u2014 drop it <span class="hint-inline">(${t.count} sessions)</span>${levelLine(t.avg)}</div>
        </div>`
    )
    .join('');
  const drills = (d.drills || [])
    .map(
      (s) => `<div class="works-row">
          <div class="works-drill">${esc(s.name)}</div>
          <div class="works-line">When you do <strong>${esc(s.name)}</strong> <span class="hint-inline">(${s.count} sessions)</span>${levelLine(s.avg)}</div>
        </div>`
    )
    .join('');

  let verdict = '';
  const v = d.routineVerdict;
  if (v) {
    verdict = `<div class="works-sub">Your routine</div>
      <div class="works-rows"><div class="works-row">
        <div class="works-drill">You're better when you go through your routine.</div>
        <div class="works-line">Routine days <span class="hint-inline">(${v.routineN})</span>${levelLine(v.routineAvg)}</div>
        <div class="works-line">Other days <span class="hint-inline">(${v.otherN})</span>${levelLine(v.otherAvg)}</div>
      </div></div>`;
  }

  let suggested = '';
  if (d.suggestedRoutine && d.suggestedRoutine.length) {
    const items = d.suggestedRoutine
      .map(
        (x) => `<li>${esc(x.name)}${x.station ? ` <span class="hint-inline">(${esc(x.station)})</span>` : ''} <span class="hint-inline">\u00b7 ${x.count} good days</span></li>`
      )
      .join('');
    const adopt = readOnly
      ? ''
      : `<form method="post" action="/routine/adopt" class="works-adopt">
          <input type="hidden" name="drills" value="${esc(JSON.stringify(d.suggestedRoutine.map((x) => ({ name: x.name, station: x.station }))))}">
          <button type="submit" class="btn-primary">Save as my daily routine</button>
        </form>`;
    suggested = `<details class="works-details">
        <summary>No routine? No problem \u2014 but if you ever want one, here's a starting point from your best days.</summary>
        <ul class="works-list">${items}</ul>
        ${adopt}
      </details>`;
  }

  let addable = '';
  const ds = d.drillSuggestions || [];
  if (ds.length) {
    const rows = ds
      .map(
        (x) => `<div class="works-row">
            <div class="works-drill">${esc(x.name)}</div>
            <div class="works-line">Showed up on your best days <span class="hint-inline">(${x.count})</span>${levelLine(x.avg)}</div>
            ${readOnly ? '' : `<form method="post" action="/routine/add" class="works-add">
              <input type="hidden" name="name" value="${esc(x.name)}">
              <input type="hidden" name="station" value="${esc(x.station || 'Tee')}">
              <button type="submit" class="btn-ghost btn-sm">Add to routine</button>
            </form>`}
          </div>`
      )
      .join('');
    addable = `<div class="works-sub">Worth adding to your routine</div><div class="works-rows">${rows}</div>`;
  }

  const hasAny = good || trash || drills || verdict || suggested || addable;
  const body = hasAny
    ? `${good ? `<div class="works-sub">Use these \u2014 your good-day cues</div><div class="works-rows">${good}</div>` : ''}
       ${trash ? `<div class="works-sub">Trash these \u2014 rough-day cues</div><div class="works-rows">${trash}</div>` : ''}
       ${verdict}
       ${suggested}
       ${addable}
       ${drills ? `<div class="works-sub">Your drills</div><div class="works-rows">${drills}</div>` : ''}`
    : `<p class="hint">Check in 3+ times and Skip will start spotting your patterns.</p>`;
  return `<section id="what-works" class="card">
    <h2>What works for you</h2>
    <p class="hint">Skip's read on your sessions \u2014 what to keep, what to trash, and what your routine is doing for you.</p>
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
    tabs: userTabs('checkin', user),
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
      <script src="/checkin.js"></script>
      <label>Session notes <span class="hint-inline">(don't hold back — what you felt, what you saw, what was off)</span><span class="talk-wrap"><textarea id="session_notes" name="session_notes" rows="4" placeholder="How did it go? What did you feel?">${esc(v.session_notes || '')}</textarea><button type="button" class="mic-btn" data-target="session_notes" aria-label="Dictate instead of typing">🎙</button></span></label>
      <label>What worked <span class="hint-inline">(be specific — the exact drill, cue, or feel)</span><span class="talk-wrap"><textarea id="what_worked" name="what_worked" rows="2" placeholder="What clicked today?">${esc(v.what_worked || '')}</textarea><button type="button" class="mic-btn" data-target="what_worked" aria-label="Dictate instead of typing">🎙</button></span></label>
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
        <p class="hint"><a href="/routine">Edit daily routine →</a></p>
        <p class="hint">Tip: add (tee), (side toss), (front toss), (BP), or (machine) after a drill — e.g. "Fence drill (tee)".</p>
      </div>
      <datalist id="drill-list">${datalist}</datalist>
      <button type="submit" class="btn-primary">Submit check-in</button>
    </form></div>`,
  });
}

// Optional pre-hit check-in: set the intent BEFORE the session. Cage mode asks
// what he's working on and how; game mode asks approach, one goal, and what
// he's flushing. Never required — Skip reads today's intent when he checks in
// after and connects the session back to it.
function preCheckinPage(user, kind, error, v) {
  const k = kind === 'game' ? 'game' : 'cage';
  const isGame = k === 'game';
  const mic = (id) => `<button type="button" class="mic-btn" data-target="${id}" aria-label="Dictate instead of typing">🎙</button>`;
  const fields = isGame ? `
      <label>What's your approach today? <span class="hint-inline">(what are you hunting? what's the plan vs this guy?)</span><span class="talk-wrap"><textarea id="pre_focus" name="focus" rows="2" placeholder="e.g. Hunting the fastball early, spitting on the slider away">${esc(v.focus || '')}</textarea>${mic('pre_focus')}</span></label>
      <label>What's your ONE job today? <span class="hint-inline">(one goal — nothing else)</span><span class="talk-wrap"><textarea id="pre_plan" name="plan" rows="2" placeholder="e.g. See it up, be on time">${esc(v.plan || '')}</textarea>${mic('pre_plan')}</span></label>
      <label>What are you flushing before first pitch? <span class="hint-inline">(leave it in the parking lot)</span><span class="talk-wrap"><textarea id="pre_flush" name="flush" rows="2" placeholder="e.g. Yesterday's 0-for, the last cage session">${esc(v.flush || '')}</textarea>${mic('pre_flush')}</span></label>`
    : `
      <label>What are you working on today? <span class="talk-wrap"><textarea id="pre_focus" name="focus" rows="2" placeholder="e.g. Staying inside the ball to right-center">${esc(v.focus || '')}</textarea>${mic('pre_focus')}</span></label>
      <label>How are you going to do it? <span class="hint-inline">(drills, pitch types, constraints — your plan)</span><span class="talk-wrap"><textarea id="pre_plan" name="plan" rows="3" placeholder="e.g. Fence drill off the tee, then front toss hunting inner half">${esc(v.plan || '')}</textarea>${mic('pre_plan')}</span></label>`;
  return layout({
    title: 'Pre-Hit Check-In',
    user,
    tabs: userTabs('home', user),
    body: `<h1 class="page-title">Pre-hit check-in</h1>
    <div class="card"><p class="hint skip-intro">Two minutes before you hit. Set the intent — then go do it. <span class="hint-inline">Totally optional.</span></p>
    <div class="pill-row">
      <a class="pill-link${isGame ? '' : ' active'}" href="/precheckin?kind=cage">Cage</a>
      <a class="pill-link${isGame ? ' active' : ''}" href="/precheckin?kind=game">Pregame / Live ABs</a>
    </div>
    <form method="post" action="/precheckin" class="form">
      <input type="hidden" name="kind" value="${k}">
      ${error ? `<div class="error">${esc(error)}</div>` : ''}
      <script src="/checkin.js"></script>
      ${fields}
      <button type="submit" class="btn-primary">Lock it in</button>
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
    tabs: userTabs('checkin', user),
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

const LEARN_CATEGORIES = ['Mechanics', 'Mental', 'Approach', 'Drills', 'Other'];

function notebookPage(user, checkins, notes, players, justSubmitted) {
  const catChips = LEARN_CATEGORIES.map(
    (c, i) =>
      `<label class="chip-radio"><input type="radio" name="category" value="${c}"${i === 0 ? ' checked' : ''}><span>${c}</span></label>`
  ).join('');
  const noteRows = (notes || [])
    .map(
      (n) => `<div class="learn-row">
        <div class="learn-main">
          ${n.category ? `<span class="badge env">${esc(n.category)}</span>` : ''}
          <span class="learn-date hint-inline">${esc(String(n.created_at).slice(0, 10))}</span>
          <p class="learn-text">${esc(n.note)}</p>
        </div>
        <form method="post" action="/learn/note/${n.id}/delete" class="routine-remove">
          <button type="submit" class="btn-ghost btn-sm" aria-label="Delete note">Remove</button>
        </form>
      </div>`
    )
    .join('');
  const playerRows = (players || [])
    .map(
      (p) => `<div class="learn-row">
        <div class="learn-main">
          <strong class="learn-player">${esc(p.player_name)}</strong>
          ${p.takeaway ? `<p class="learn-text">&ldquo;${esc(p.takeaway)}&rdquo;</p>` : ''}
        </div>
        <form method="post" action="/learn/player/${p.id}/delete" class="routine-remove">
          <button type="submit" class="btn-ghost btn-sm" aria-label="Delete player">Remove</button>
        </form>
      </div>`
    )
    .join('');
  const scored = checkins.filter((c) => c.session_score != null);
  const avg = scored.length
    ? Math.round((scored.reduce((s, c) => s + c.session_score, 0) / scored.length) * 10) / 10
    : null;
  const checkinsHtml = `
    ${avg !== null ? `<div class="level-head"><p class="hint">Skip's read on you over ${scored.length} session${scored.length === 1 ? '' : 's'}:</p>${levelLine(avg)}</div>` : ''}
    ${checkins.length ? checkins.map(checkinCard).join('') : `<div class="card empty">No check-ins yet. <a href="/checkin">Log your first session</a>.</div>`}`;
  return layout({
    title: 'Notebook',
    user,
    tabs: userTabs('notebook', user),
    body: `<h1 class="page-title">Notebook</h1>
    <div class="subnav"><a href="#checkins">Check-ins</a><a href="#notes">Notes</a></div>
    ${justSubmitted ? `<div class="success">Check-in saved. Good work.</div>` : ''}
    <h2 class="section-head" id="checkins">Check-ins</h2>
    ${checkinsHtml}
    <h2 class="section-head" id="notes">Notes</h2>
    <div class="card"><p class="hint skip-intro">Your hitting notebook — jot down anything about your swing and your game, no check-in needed. Skip reads this too.</p>
    <form method="post" action="/learn/note" class="form">
      <label>Something new I'm learning
        <textarea id="note-text" name="note" rows="2" maxlength="1000" placeholder="e.g. Keeping my front shoulder closed longer lets me stay through it" required></textarea>
      </label>
      <div class="chip-row">${catChips}</div>
      <div class="prompt-row">
        <button type="button" class="prompt-chip" data-prompt-text="What\u2019s working for me right now: ">What's working</button>
        <button type="button" class="prompt-chip" data-prompt-text="What I want to figure out: ">Figure out</button>
        <button type="button" class="prompt-chip" data-prompt-text="Something I need to remember: ">Remember</button>
      </div>
      <button type="submit" class="btn-primary">Save it</button>
    </form></div>
    <div class="card">
      <h2 class="routine-station">My notes</h2>
      ${noteRows || `<p class="hint">Nothing saved yet. When something clicks — a cue, a feel, an idea — put it here.</p>`}
    </div>
    <div class="card"><p class="hint skip-intro">Players you study. Skip will connect his coaching to the guys you look up to.</p>
    <form method="post" action="/learn/player" class="form">
      <label>Player
        <input name="player_name" maxlength="80" placeholder="e.g. Mookie Betts" required>
      </label>
      <label>What I'm stealing from them
        <input name="takeaway" maxlength="300" placeholder="e.g. Short to it, stays through it">
      </label>
      <button type="submit" class="btn-primary">Add player</button>
    </form></div>
    <div class="card">
      <h2 class="routine-station">Players I study</h2>
      ${playerRows || `<p class="hint">No players yet. Add the hitters you watch and learn from.</p>`}
    </div>
    <h2 class="section-head" id="checkins">Check-ins</h2>
    ${checkinsHtml}`,
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

// Session levels — color-coded, no numeric scores shown to hitters.
// The fuller the bar, the better the session. Bright green = best.
const LEVEL_COLORS = { 'Rough': '#ff5252', 'Off': '#ffd54f', 'Solid': '#66bb6a', 'Locked In': '#00e676' };
function tierFor(score) {
  if (score >= 9.0) return 'Locked In';
  if (score >= 7.0) return 'Solid';
  if (score >= 5.0) return 'Off';
  return 'Rough';
}
function levelColor(tier) { return LEVEL_COLORS[tier] || '#999'; }
function levelBar(score, tier, lg) {
  const t = tier || tierFor(Number(score) || 0);
  const pct = Math.max(6, Math.min(100, (Number(score) / 10) * 100));
  return `<div class="level-meter${lg ? ' lg' : ''}"><div class="level-fill" style="width:${pct}%;background:${levelColor(t)}"></div></div>`;
}
function levelLine(score, tier) {
  const t = tier || tierFor(Number(score) || 0);
  return `<div class="level-row">${levelBar(score, t)}<span class="badge ${tierBadgeClass(t)}">${esc(t)}</span></div>`;
}

function scorePage(user, c) {
  return layout({
    title: "Skip's Session Level",
    user,
    tabs: userTabs('checkin', user),
    body: `<div class="card score-hero">
      <div class="score-kicker">Skip's Session Level</div>
      <div class="level-hero-meter">${levelBar(c.session_score, c.score_tier, true)}</div>
      <div><span class="badge ${tierBadgeClass(c.score_tier)} badge-lg">${esc(c.score_tier)}</span></div>
      <p class="hint skip-note">${esc(TIER_NOTES[c.score_tier] || '')}</p>
      <div class="score-breakdown">
        <div><span class="label">Feel</span><strong>${esc(c.feel)}</strong></div>
        <div><span class="label">Confidence</span><strong>${esc(c.confidence)}</strong></div>
        <div><span class="label">Focus</span><strong>${esc(c.focus)}</strong></div>
        ${c.difficulty != null ? `<div><span class="label">Difficulty</span><strong>${esc(c.difficulty)}</strong></div>` : ''}
      </div>
      ${skipReadBlock(c)}
      <div class="score-actions">
        <a href="/notebook" class="btn-primary">See your notebook</a>
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
  const head = `<div class="checkin-head">
      <span class="checkin-date">${fmtDate(c.created_at)}</span>
      ${c.environment ? `<span class="badge env">${esc(c.environment)}</span>` : ''}
    </div>
    ${c.athlete_name && c.showAthlete ? `<div class="checkin-athlete">${esc(c.athlete_name)}</div>` : ''}`;
  const score = `${c.session_score != null ? `<div class="checkin-score">
      ${levelLine(c.session_score, c.score_tier)}
      <span class="hint-inline">Feel ${esc(c.feel)} · Conf ${esc(c.confidence)} · Focus ${esc(c.focus)}${c.difficulty != null ? ` · Difficulty ${esc(c.difficulty)}` : ''}</span>
    </div>` : ''}`;
  const drillRow = `${drills.length ? `<div class="drill-chips">${drills.map(drillChip).join('')}</div>` : ''}`;
  const read = `${skipReadBlock(c)}`;
  const notes = `${c.session_notes ? `<p>${esc(c.session_notes)}</p>` : ''}`;
  const worked = `<div class="checkin-grid">
      ${c.what_worked ? `<div><span class="label">What worked</span>${esc(c.what_worked)}</div>` : ''}
    </div>`;
  const words = `${notes}${worked}`;
  return `<div class="card checkin">
    ${head}
    ${score}
    ${drillRow}
    ${read}
    <details class="checkin-more"><summary>Full entry</summary>${words || `<p class="hint">No notes written for this session.</p>`}</details>
  </div>`;
}

function chatPage(user, messages, chatEnabled) {
  const skipImg = `<img src="/skip-avatar.webp" class="skip-avatar" alt="Skip">`;
  const msgs = (messages || [])
    .map(
      (m) => `<div class="msg ${m.role === 'user' ? 'msg-user' : 'msg-skip'}">${m.role === 'user' ? '' : skipImg}<div class="msg-bubble">${esc(m.content)}</div></div>`
    )
    .join('');
  return layout({
    title: 'Coach Skip',
    user,
    tabs: userTabs('chat', user),
    body: `<h1 class="page-title chat-title"><img src="/skip-avatar.webp" class="skip-avatar" alt="Skip">Coach Skip</h1>
    <p class="hint">Struggling? Tell Skip what's going on at the plate — he's seen your check-ins and will point you back on track.</p>
    ${chatEnabled
      ? `<div id="text-panel">
        <div id="chat-log" class="chat-log">${msgs || `<div class="msg msg-skip">${skipImg}<div class="msg-bubble">What's going on at the plate? Tell me what feels off.</div></div>`}</div>
        <form id="chat-form" class="chat-form" autocomplete="off">
          <input id="chat-input" type="text" placeholder="Ask Skip…" maxlength="2000" required>
          <button type="submit" class="btn-primary">Send</button>
        </form>
      </div>`
      : `<div class="card empty">Skip's chat isn't switched on yet — check back soon.</div>`}`,
  });
}

function pendingApprovalCards(pending) {
  return (pending || [])
    .map(
      (p) => `<div class="card athlete-card">
        <div class="athlete-card-name">${esc(p.name)}</div>
        <div class="athlete-card-email">${esc(p.email)}</div>
        <div class="athlete-card-meta">signed up ${fmtDate(p.created_at)}</div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <form method="post" action="/coach/approve/${p.id}" style="flex:1;margin:0">
            <button type="submit" class="btn-primary" style="width:100%">Approve</button>
          </form>
          <form method="post" action="/coach/decline/${p.id}" style="flex:1;margin:0">
            <button type="submit" style="width:100%;padding:14px;border-radius:12px;border:1px solid #5a5a5a;background:transparent;color:#b0b0b0;font-size:16px;cursor:pointer">Decline</button>
          </form>
        </div>
      </div>`
    )
    .join('');
}

function coachApprovalsPage(user, pending) {
  const n = (pending || []).length;
  return layout({
    title: 'Approvals',
    user,
    tabs: coachTabs('approvals', user.approvalCount),
    body: `<h1 class="page-title">Approvals</h1>
    <p class="hint">Every new account waits here until you approve it. Approved hitters can log in right away.</p>
    ${n ? `<div class="athlete-grid">${pendingApprovalCards(pending)}</div>` : `<div class="card empty">Nobody waiting — you're all caught up.</div>`}`,
  });
}

function coachDashboard(user, userStats, latest, pending, remotePrograms, library, opts) {
  const totalCheckins = userStats.reduce((s, u) => s + u.total, 0);
  const cards = userStats
    .map(
      (a) => `<div class="card athlete-card" data-search="${esc(`${a.name} ${a.email}`.toLowerCase())}">
        <a href="/coach/user/${encodeURIComponent(a.email)}" style="display:block;color:inherit;text-decoration:none">
          <div class="athlete-card-name">${esc(a.name)}</div>
          <div class="athlete-card-email">${esc(a.email)}</div>
          <div class="athlete-card-meta">${a.total} check-in${a.total === 1 ? '' : 's'}${a.last ? ` · last ${fmtDate(a.last)}` : ' · none yet'}</div>
        </a>
        <form method="post" action="/coach/view-as" style="margin:8px 0 0">
          <input type="hidden" name="id" value="${a.id}">
          <button class="btn-small btn-quiet" type="submit">View as hitter</button>
        </form>
      </div>`
    )
    .join('');
  const feed = latest.length
    ? latest.map((c) => checkinCard({ ...c, showAthlete: true })).join('')
    : '<div class="card empty">No check-ins yet.</div>';
  const approvalNudge = pending && pending.length
    ? `<a class="card approval-nudge" href="/coach/approvals">${pending.length} hitter${pending.length === 1 ? '' : 's'} waiting for approval →</a>`
    : '';
  return layout({
    title: 'Coach Dashboard',
    user,
    tabs: coachTabs('dashboard', user.approvalCount),
    body: `<h1 class="page-title">Skip Dashboard</h1>
    ${!(opts && opts.pushOn) ? '<p><button type="button" class="btn-small" id="push-enable-btn">Turn on notifications</button> <span class="hint-inline">get a push when a hitter needs approval</span></p>' : ''}
    <div class="stat-row">
      <div class="card stat"><div class="stat-num">${userStats.length}</div><div class="stat-label">hitters</div></div>
      <div class="card stat"><div class="stat-num">${totalCheckins}</div><div class="stat-label">check-ins</div></div>
    </div>
    ${approvalNudge}
    <h2 class="section-head">Hitters</h2>
    ${userStats.length ? `<input type="search" id="hitter-search" class="searchbar" placeholder="Search hitters…" autocomplete="off">` : ''}
    <div class="athlete-grid">${cards || '<div class="card empty">Nobody has signed up yet.</div>'}</div>
    <div class="card empty" id="hitter-no-match" hidden>No hitters match that search.</div>
    ${remoteProgramsSection(remotePrograms || [])}
    ${librarySection(library || { cats: [], lastSync: '' })}
    <h2 class="section-head">Latest check-ins</h2>
    ${feed}`,
  });
}

// ---- Remote programs ----

function programSection(title, inner, id) {
  return inner
    ? `<div class="card routine-group"${id ? ` id="${id}"` : ''}><h2 class="routine-station">${esc(title)}</h2>${inner}</div>`
    : '';
}

// Every-day blocks of a remote program (Daily Routine + Mobility) — shown on the
// Routine tab, not inside the Program tab.
function dailyRoutineBlocks(prog) {
  const routine = Array.isArray(prog.routine) ? prog.routine : [];
  return routine.filter((c) => /^daily routine/i.test(String(c.category || '')) || /^mobility/i.test(String(c.category || '')));
}

// Hitter-facing: their training program, read-only.
function programPage(user, p) {
  const prog = p.prog || {};
  const grades = prog.grades && typeof prog.grades === 'object' ? prog.grades : {};
  const gradeChips = Object.entries(grades)
    .map(([k, v]) => `<span class="grade-chip"><strong>${esc(k)}</strong> ${esc(String(v))}</span>`)
    .join('');
  const strengths = Array.isArray(prog.strengths) ? prog.strengths.filter(Boolean) : [];
  const routine = Array.isArray(prog.routine) ? prog.routine : [];
  const sectionCard = (name, items) => {
    const rows = (items || [])
      .map(
        (it) => `<div class="routine-row"><span class="routine-name">${esc(it.drill || '')}</span>${
          it.volume ? `<span class="hint-inline">${esc(it.volume)}</span>` : ''
        }</div>`
      )
      .join('');
    return `<details class="card routine-group" open><summary class="routine-summary"><span class="routine-station">${esc(name || 'Training')}</span></summary>${rows}</details>`;
  };
  const everyDayFirst = dailyRoutineBlocks(prog);
  const everyDaySet = new Set(everyDayFirst);
  const routineHtml = routine.filter((c) => !everyDaySet.has(c)).map((c) => sectionCard(c.category, c.items)).join('');
  const schedMap = {};
  for (const pair of Array.isArray(prog.schedule) ? prog.schedule : []) {
    if (Array.isArray(pair) && pair[0]) schedMap[String(pair[0])] = String(pair[1] || '');
  }
  // ---- Day-based training navigator ----
  // Blocks are grouped by day label ("Day 1 — Med Ball"). The hitter picks a
  // weekday (Mon–Fri, defaulting to today) and sees that whole day in one spot.
  const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const dayLabelRe = /^(Day \d+)(?:\s*[\u2014\u2013-]\s*(.+))?$/i;
  const everyDayBlocks = everyDayFirst;
  const everyDayCats = everyDaySet;
  const daySections = {};
  const pregameSections = [];
  const flatBlocks = [];
  for (const c of routine) {
    if (everyDayCats.has(c)) continue;
    const cat = String(c.category || '');
    const pg = cat.match(/^pregame(?:\s*[\u2014\u2013-]\s*(.+))?$/i);
    if (pg) {
      pregameSections.push({ section: (pg[1] || '').trim(), items: c.items || [] });
      continue;
    }
    const m = cat.match(dayLabelRe);
    if (m) {
      const lbl = 'Day ' + m[1].replace(/\D+/g, '');
      (daySections[lbl] = daySections[lbl] || []).push({ section: (m[2] || '').trim(), items: c.items || [] });
      continue;
    }
    flatBlocks.push(c);
  }
  const hasPregame = pregameSections.length > 0;
  const dayLabels = Object.keys(daySections).sort(
    (a, b) => parseInt(a.replace(/\D+/g, ''), 10) - parseInt(b.replace(/\D+/g, ''), 10)
  );
  const hasWeekdaySched = WEEKDAYS.some((d) => schedMap[d]);
  const trainMode = hasWeekdaySched ? 'week' : dayLabels.length ? 'labels' : 'flat';
  const panelForLabel = (label) => {
    if (/^off$/i.test(String(label || '').trim())) {
      return `<div class="card"><p style="margin:0">OFF — rest up.</p></div>`;
    }
    const cards = [];
    const dm = String(label || '').match(/^day\s*(\d+)$/i);
    if (dm) {
      for (const sec of daySections['Day ' + dm[1]] || []) {
        cards.push(sectionCard(sec.section || 'Day ' + dm[1], sec.items));
      }
    }
    for (const c of flatBlocks) cards.push(sectionCard(c.category, c.items));
    if (!cards.length) return `<div class="card empty">Nothing scheduled for this day.</div>`;
    return cards.join('');
  };
  const pregamePanel = () => {
    const cards = [];
    for (const c of everyDayBlocks) cards.push(sectionCard(c.category, c.items));
    for (const sec of pregameSections) cards.push(sectionCard(sec.section || 'Pregame', sec.items));
    if (!cards.length) return `<div class="card empty">Nothing here yet.</div>`;
    return cards.join('');
  };
  let trainingNav = '';
  if (trainMode === 'flat') {
    trainingNav = routine.length ? `<div id="training" class="prog-anchor">${routineHtml}</div>` : '';
  } else {
    const pillDays = trainMode === 'week' ? [...WEEKDAYS] : [...dayLabels];
    if (hasPregame) pillDays.push('Pregame');
    const pillHtml = pillDays
      .map((d) =>
        d === 'Pregame'
          ? `<button type="button" class="day-pill pregame-pill" data-daypill="Pregame">Pregame</button>`
          : `<button type="button" class="day-pill" data-daypill="${esc(d)}">${esc(trainMode === 'week' ? d.slice(0, 3) : d)}</button>`
      )
      .join('');
    const panelHtml = pillDays
      .map((d) => {
        if (d === 'Pregame') {
          return `<div data-daypanel="Pregame" hidden><div class="prog-day-head">Pregame <span class="hint-inline">· game day</span></div>${pregamePanel()}</div>`;
        }
        const label = trainMode === 'week' ? schedMap[d] || '' : d;
        const head = trainMode === 'week' ? `${esc(d)}${label ? ` <span class="hint-inline">· ${esc(label)}</span>` : ''}` : esc(label);
        return `<div data-daypanel="${esc(d)}" hidden><div class="prog-day-head">${head}</div>${panelForLabel(label)}</div>`;
      })
      .join('');
    trainingNav = `<div id="training" class="prog-anchor">
      <div class="day-pills">${pillHtml}</div>
      ${panelHtml}
    </div>`;
  }
  const schedRows = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    .filter((d) => schedMap[d])
    .map(
      (d) =>
        `<div class="cue-row"><span class="cue-label">${esc(d.slice(0, 3))}</span><span>${esc(schedMap[d])}</span></div>`
    )
    .join('');
  const progNotes = Array.isArray(prog.notes) ? prog.notes.filter(Boolean) : [];
  const meta = [prog.date_range, prog.phase_emphasis].filter(Boolean).map(esc).join(' · ');
  const nav = [
    ['focus', 'Focus', !!prog.adjustment],
    ['grades', 'Grades', !!gradeChips],
    ['strengths', 'Strengths', strengths.length > 0],
    ['training', 'Training', routine.length > 0],
    ['schedule', 'Schedule', trainMode === 'flat' && !!schedRows],
    ['notes', 'Notes', progNotes.length > 0],
  ].filter(([, , show]) => show);
  const navHtml = nav.length
    ? `<nav class="prog-nav">${nav.map(([id, label]) => `<a href="#${id}">${esc(label)}</a>`).join('')}</nav>`
    : '';
  return layout({
    title: 'Your Program',
    user,
    tabs: userTabs('program', user),
    body: `<h1 class="page-title">Your Program</h1>
    ${meta ? `<p class="lede">${meta}</p>` : ''}
    ${navHtml}
    ${programSection('The focus', prog.adjustment ? `<p>${esc(prog.adjustment)}</p>` : '', 'focus')}
    ${programSection('Grades', gradeChips ? `<div class="grade-row">${gradeChips}</div>` : '', 'grades')}
    ${programSection(
      'Strengths',
      strengths.length ? `<ul class="works-list">${strengths.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '',
      'strengths'
    )}
    ${trainingNav}
    ${trainMode === 'flat' ? programSection('Schedule', schedRows ? `<div class="cue-list">${schedRows}</div>` : '', 'schedule') : ''}
    ${programSection(
      'Notes',
      progNotes.length ? `<ul class="works-list">${progNotes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '',
      'notes'
    )}`,
  });
}

// Hitter-facing: their daily routine — the every-day blocks of their program.
// Remote athletes only.
function programRoutinePage(user, p) {
  const prog = p.prog || {};
  const blocks = dailyRoutineBlocks(prog);
  const sectionCard = (name, items) => {
    const rows = (items || [])
      .map(
        (it) => `<div class="routine-row"><span class="routine-name">${esc(it.drill || '')}</span>${
          it.volume ? `<span class="hint-inline">${esc(it.volume)}</span>` : ''
        }</div>`
      )
      .join('');
    return `<details class="card routine-group" open><summary class="routine-summary"><span class="routine-station">${esc(name || 'Training')}</span></summary>${rows}</details>`;
  };
  return layout({
    title: 'Daily Routine',
    user,
    tabs: userTabs('routine', user),
    body: `<h1 class="page-title">Daily Routine</h1>
    <p class="lede">Every day, before the work below — no thinking, just go.</p>
    ${blocks.length ? blocks.map((c) => sectionCard(c.category, c.items)).join('') : '<div class="card empty">No daily routine set yet.</div>'}`,
  });
}

// Hitter-facing: Mental Game — gauge questions + baseline, then Skip builds the
// hitter a personal plan. All hitters.
function mentalGamePage(user, baseline, saved, planFailed, keys) {
  const b = baseline || {};
  const radio = (name, options) => `
    <div class="chip-row">${options
      .map(
        ([val, label]) =>
          `<label class="chip-radio"><input type="radio" name="${name}" value="${esc(val)}"${
            b[name] === val ? ' checked' : ''
          }><span>${esc(label)}</span></label>`
      )
      .join('')}</div>`;
  const fld = (name, label, hint, val) => `
    <label class="fld">${esc(label)}<span class="hint">${esc(hint)}</span>
      <textarea name="${name}" rows="2" maxlength="600" placeholder="${esc(hint)}">${esc(val || '')}</textarea>
    </label>`;
  const planHtml = b.plan
    ? `<div class="card"><h2 class="routine-station">Your mental game plan</h2><p style="white-space:pre-wrap;margin:0">${esc(b.plan)}</p></div>`
    : '';
  return layout({
    title: 'Mental Game',
    user,
    tabs: userTabs('mental', user),
    body: `<h1 class="page-title">Mental Game</h1>
    <p class="lede">Answer honestly — Coach Skip gauges where your head's at and builds your plan from it.</p>
    ${saved ? '<div class="notice">Saved — Skip built your plan below.</div>' : ''}
    ${planFailed ? '<div class="notice">Baseline saved, but the plan didn\u2019t come through — tap the button again.</div>' : ''}
    ${planHtml}
    <div class="card">
      <h2 class="routine-station">Your keys</h2>
      <p class="hint">Things you and Coach Skip saved from the chat. Tell him <strong>&ldquo;add this to my mental game&rdquo;</strong> and it lands here.</p>
      ${(keys || []).length
        ? `<ul class="keys-list">${(keys || []).map((k) => `<li><span>${esc(k.content)}</span>
            <form method="post" action="/mental-game/keys/delete" style="display:inline;margin:0">
              <input type="hidden" name="id" value="${k.id}">
              <button type="submit" class="link-danger" aria-label="Remove">\u2715</button>
            </form></li>`).join('')}</ul>`
        : `<p class="hint">Nothing saved yet.</p>`}
    </div>
    <form method="post" action="/mental-game/save" class="form">
      <div class="card">
        <p class="field-label">Do you have a routine you actually trust?</p>
        ${radio('has_routine', [['yes', 'Yes — it\u2019s automatic'], ['sortof', 'Sort of — sometimes'], ['no', 'No routine yet']])}
        <p class="field-label">In games, where's your head usually?</p>
        ${radio('head_state', [['present', 'Present — I\u2019m seeing it'], ['between', 'In between'], ['worried', 'Worried — thinking about results']])}
        ${fld('pregame_routine', 'Pre-game routine', 'Do you have one? Walk through it.', b.pregame_routine)}
        ${fld('morning_routine', 'Morning routine', 'Game day or every day — what does it look like?', b.morning_routine)}
        ${fld('breath_work', 'Breath work', 'Do you do any? What kind?', b.breath_work)}
        ${fld('when_sped_up', 'When you feel sped up', 'Rushed in a game — what do you do right now?', b.when_sped_up)}
      </div>
      <p><button type="submit" class="btn btn-primary">Save & build my plan</button></p>
    </form>
    <div class="card">
      <p style="margin:0">Feeling sped up or rushing in a game? <a href="/chat">Talk to Coach Skip →</a> — he'll give you one thing to lock back in.</p>
    </div>`,
  });
}

// Coach-facing: edit a remote hitter's program.// Coach-facing: edit a remote hitter's program.
function programEditPage(user, p) {
  const prog = p.prog || {};
  const grades = prog.grades && typeof prog.grades === 'object' ? prog.grades : {};
  const gradeFields = ['Load', 'Path', 'Connection', 'Timing', 'Power Production']
    .map(
      (g) =>
        `<label class="fld fld-inline">Grade — ${esc(g)}<input type="text" name="grade_${g.replace(/ /g, '_')}" value="${esc(grades[g] || '')}" maxlength="4" placeholder="B+"></label>`
    )
    .join('');
  const routine = Array.isArray(prog.routine) ? prog.routine : [];
  const catBlocks = routine
    .map(
      (c, i) => `<div class="card routine-group prog-cat" data-cat>
        <label class="fld">Category<input type="text" name="cat_${i}_name" value="${esc(c.category || '')}" maxlength="60"></label>
        <label class="fld">Drills — one per line, as <em>Drill</em> or <em>Drill | volume</em>
          <textarea name="cat_${i}_items" rows="4">${esc((c.items || []).map((it) => (it.volume ? `${it.drill} | ${it.volume}` : it.drill)).join('\n'))}</textarea>
        </label>
        <button type="button" class="btn btn-danger btn-sm" data-remove-cat>Remove category</button>
      </div>`
    )
    .join('');
  const cues = prog.cues && typeof prog.cues === 'object' ? prog.cues : {};
  const editSchedMap = {};
  for (const pair of Array.isArray(prog.schedule) ? prog.schedule : []) {
    if (Array.isArray(pair) && pair[0]) editSchedMap[String(pair[0])] = String(pair[1] || '');
  }
  const schedFields = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    .map(
      (d, i) =>
        `<label class="fld fld-inline">${esc(d)}<input type="text" name="sched_${i}" value="${esc(editSchedMap[d] || '')}" maxlength="40" placeholder="Day 1 / OFF"></label>`
    )
    .join('');
  const editNotes = Array.isArray(prog.notes) ? prog.notes.filter(Boolean) : [];
  return layout({
    title: `Edit program — ${p.athlete_name}`,
    user,
    tabs: coachTabs('dashboard', user.approvalCount),
    body: `<h1 class="page-title">Program — ${esc(p.athlete_name)}</h1>
    <p><a href="/coach">← Back to dashboard</a></p>
    <form method="post" action="/coach/program/${p.id}/save" class="form">
      <div class="card routine-group">
        <label class="fld">Date range<input type="text" name="date_range" value="${esc(prog.date_range || '')}" maxlength="60" placeholder="8/18–9/16"></label>
        <label class="fld">Phase emphasis<input type="text" name="phase_emphasis" value="${esc(prog.phase_emphasis || '')}" maxlength="120" placeholder="Coil and Barrel Turn"></label>
        <label class="fld">The adjustment — the one thing he's working on
          <textarea name="adjustment" rows="2" maxlength="500">${esc(prog.adjustment || '')}</textarea>
        </label>
        <label class="fld">Mental framework<input type="text" name="mental_framework" value="${esc(prog.mental_framework || '')}" maxlength="200" placeholder="PREPARED → PRESENT → COMPETE"></label>
      </div>
      <div class="card routine-group"><h2 class="routine-station">Grades</h2><div class="grade-edit-row">${gradeFields}</div></div>
      <div class="card routine-group">
        <label class="fld">Strengths — one per line
          <textarea name="strengths" rows="3">${esc((prog.strengths || []).join('\n'))}</textarea>
        </label>
      </div>
      <div class="card routine-group"><h2 class="routine-station">Cues</h2>
        <label class="fld">Movement<input type="text" name="cue_movement" value="${esc(cues.movement || '')}" maxlength="300"></label>
        <label class="fld">Timing<input type="text" name="cue_timing" value="${esc(cues.timing || '')}" maxlength="300"></label>
        <label class="fld">Game<input type="text" name="cue_game" value="${esc(cues.game || '')}" maxlength="300"></label>
      </div>
      <div class="card routine-group"><h2 class="routine-station">Weekly schedule</h2><div class="grade-edit-row">${schedFields}</div></div>
      <div class="card routine-group">
        <label class="fld">Notes — one per line
          <textarea name="notes" rows="3">${esc(editNotes.join('\n'))}</textarea>
        </label>
      </div>
      <h2 class="section-head">Training blocks</h2>
      <div id="prog-cats" data-next="${routine.length}">${catBlocks}</div>
      <p><button type="button" class="btn" id="prog-add-cat">+ Add block</button></p>
      <p><button type="submit" class="btn btn-primary">Save program</button></p>
    </form>
`,
  });
}

// Coach dashboard section: the remote roster and their programs.
function remoteProgramsSection(list) {
  const rows = list
    .map((r) => {
      const linked = r.user_email
        ? `<span class="pill">${esc(r.user_email)}</span>`
        : '<span class="hint-inline">no account yet</span>';
      const updated = r.updated_at ? ` · updated ${esc(r.updated_at.slice(0, 10))}` : '';
      const aliasNames = String(r.aliases || '')
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean);
      const aliasLine = aliasNames.length
        ? `<div class="hint-inline">also: ${aliasNames.map((a) => esc(a)).join(', ')}</div>`
        : '';
      return `<div class="remote-row">
        <div><strong>${esc(r.athlete_name)}</strong><div class="hint-inline">${linked}${updated}</div>${aliasLine}
          <form method="post" action="/coach/remote/alias" class="inline-form" style="margin-top:4px">
            <input type="hidden" name="id" value="${r.id}">
            <input type="text" name="alias" placeholder="also known as" maxlength="80" class="input-sm" style="max-width:130px">
            <button class="btn btn-sm" type="submit">Add name</button>
          </form>
        </div>
        <div class="remote-actions">
          <a class="btn btn-sm" href="/coach/program/${r.id}/edit">Edit program</a>
          ${
            r.user_email
              ? `<form method="post" action="/coach/remote/unlink" class="inline-form"><input type="hidden" name="id" value="${r.id}"><button class="btn btn-sm" type="submit">Unlink</button></form>`
              : `<form method="post" action="/coach/remote/link" class="inline-form"><input type="email" name="email" placeholder="hitter email" required class="input-sm"><input type="hidden" name="id" value="${r.id}"><button class="btn btn-sm" type="submit">Link</button></form>`
          }
          <form method="post" action="/coach/remote/remove" class="inline-form" data-confirm-remove="${esc(r.athlete_name)}"><input type="hidden" name="id" value="${r.id}"><button class="btn btn-sm btn-danger" type="submit">Remove</button></form>
        </div>
      </div>`;
    })
    .join('');
  return `<h2 class="section-head">Remote programs</h2>
  <div class="card">
    ${rows || '<div class="empty">No remote hitters yet.</div>'}
    <form method="post" action="/coach/remote/add" class="inline-form remote-add">
      <input type="text" name="name" placeholder="Full name" required maxlength="80" class="input-sm">
      <button class="btn btn-sm" type="submit">Add remote hitter</button>
    </form>
  </div>`;
}

// ---- Video library ----

function cleanCat(c) {
  return String(c || '').replace(/^#\d+\s*/, '');
}

function videosPage(user, cats, activeCat, videos) {
  const pills = cats
    .map(
      (c) =>
        `<a class="pill-link${c.category === activeCat ? ' active' : ''}" href="/videos?cat=${encodeURIComponent(c.category)}">${esc(cleanCat(c.category))} <span class="hint-inline">${c.n}</span></a>`
    )
    .join('');
  const isVideo = (m) => String(m || '').startsWith('video/');
  const disp = (v) => (v.custom_name && v.custom_name.trim()) || v.name;
  const cards = videos
    .map(
      (v) => `<a class="card video-card" data-search="${esc(disp(v).toLowerCase())}" href="/videos/watch/${v.id}">
        <div class="video-thumb">${isVideo(v.mime_type) ? '\u25B6' : '\uD83D\uDCC4'}</div>
        <div class="video-name">${esc(disp(v))}</div>
      </a>`
    )
    .join('');
  return layout({
    title: 'Training Videos',
    user,
    tabs: userTabs('videos', user),
    body: `<h1 class="page-title">Training Videos</h1>
    ${cats.length ? `<input type="search" id="video-search" class="searchbar" placeholder="Search videos\u2026" autocomplete="off">` : ''}
    <div class="pill-row">${pills}</div>
    <div class="video-grid">${cards || '<div class="card empty">No videos yet — they\u2019ll appear here after the next sync.</div>'}</div>
    <div class="card empty" id="video-no-match" hidden>No videos match that search.</div>
`,
  });
}

function videoWatchPage(user, v) {
  const src = `https://drive.google.com/file/d/${encodeURIComponent(v.drive_file_id)}/preview`;
  const disp = (v.custom_name && v.custom_name.trim()) || v.name;
  return layout({
    title: disp,
    user,
    tabs: userTabs('videos', user),
    body: `<p><a href="/videos?cat=${encodeURIComponent(v.category)}">\u2190 ${esc(cleanCat(v.category))}</a></p>
    <h1 class="page-title">${esc(disp)}</h1>
    <div class="video-player"><iframe src="${src}" allow="autoplay; fullscreen" allowfullscreen></iframe></div>`,
  });
}

function librarySection(library) {
  const cats = library.cats || [];
  const rows = cats
    .map((c) => `<div class="remote-row"><div><strong>${esc(cleanCat(c.category))}</strong></div><div class="hint-inline">${c.n} file${c.n === 1 ? '' : 's'}</div></div>`)
    .join('');
  const syncLine = library.lastSync
    ? `Last synced ${esc(library.lastSync.slice(0, 16).replace('T', ' '))}`
    : 'Not synced yet';
  const total = cats.reduce((t, c) => t + c.n, 0);
  return `<h2 class="section-head">Video library</h2>
  <div class="card">
    <div class="hint-inline">${total} file${total === 1 ? '' : 's'} · ${syncLine} · syncs automatically from Drive</div>
    ${rows || '<div class="empty">Empty.</div>'}
    <div style="margin-top:10px"><a class="btn-small" href="/coach/library">Open video library</a></div>
  </div>`;
}

function coachLibraryPage(user, cats, activeCat, videos, playing) {
  const pills = cats
    .map(
      (c) =>
        `<a class="pill-link${c.category === activeCat ? ' active' : ''}" href="/coach/library?cat=${encodeURIComponent(c.category)}">${esc(cleanCat(c.category))} <span class="hint-inline">${c.n}</span></a>`
    )
    .join('');
  const isVideo = (m) => String(m || '').startsWith('video/');
  const rows = videos
    .map((v) => {
      const disp = (v.custom_name && v.custom_name.trim()) || v.name;
      const renamed = v.custom_name && v.custom_name.trim() && v.custom_name.trim() !== v.name;
      return `<div class="card lib-row${v.hidden ? ' lib-hidden' : ''}">
        <div class="lib-main">
          <div class="lib-title">${isVideo(v.mime_type) ? '\u25B6 ' : '\uD83D\uDCC4 '}${esc(disp)}</div>
          ${renamed ? `<div class="hint-inline">Drive name: ${esc(v.name)}</div>` : ''}
          <div class="lib-actions">
            <a class="btn-small" href="/coach/library?cat=${encodeURIComponent(activeCat)}&play=${v.id}">Play</a>
            <form method="post" action="/coach/library/toggle" style="display:inline">
              <input type="hidden" name="id" value="${v.id}">
              <input type="hidden" name="cat" value="${esc(activeCat)}">
              <button class="btn-small${v.hidden ? '' : ' btn-quiet'}" type="submit">${v.hidden ? 'Unhide' : 'Hide'}</button>
            </form>
          </div>
        </div>
        <form method="post" action="/coach/library/rename" class="lib-rename">
          <input type="hidden" name="id" value="${v.id}">
          <input type="hidden" name="cat" value="${esc(activeCat)}">
          <input type="text" name="custom_name" value="${esc(v.custom_name || '')}" placeholder="Rename\u2026" maxlength="200">
          <button class="btn-small" type="submit">Save</button>
        </form>
      </div>`;
    })
    .join('');
  const player = playing
    ? `<h1 class="page-title">${esc((playing.custom_name && playing.custom_name.trim()) || playing.name)}</h1>
       <div class="video-player"><iframe src="https://drive.google.com/file/d/${encodeURIComponent(playing.drive_file_id)}/preview" allow="autoplay; fullscreen" allowfullscreen></iframe></div>`
    : '';
  return layout({
    title: 'Video library',
    user,
    active: 'coach',
    body: `<p><a href="/coach">\u2190 Dashboard</a></p>
    <h1 class="page-title">Video library</h1>
    <div class="hint-inline">Renames and hidden videos are yours only — the Drive sync never overwrites them. New Drive files appear here automatically.</div>
    ${player}
    <div class="pill-row">${pills}</div>
    ${rows || '<div class="card empty">No videos in this category yet.</div>'}`,
  });
}

function coachUser(user, name, checkins, whatWorks, thread, email, memories, routine) {
  const skipImg = `<img src="/skip-avatar.webp" class="skip-avatar" alt="Skip">`;
  const convo =
    thread && thread.length
      ? `<h2 class="section-head">Talk to Skip history</h2>
    <div class="chat-log">${thread
      .map(
        (m) =>
          `<div class="msg ${m.role === 'user' ? 'msg-user' : 'msg-skip'}">${
            m.role === 'user' ? '' : skipImg
          }<div class="msg-bubble">${esc(m.content)}</div></div>`
      )
      .join('')}</div>`
      : '';
  return layout({
    title: name,
    user,
    tabs: coachTabs('dashboard', user.approvalCount),
    body: `<h1 class="page-title">${esc(name)}</h1>
    <p><a href="/coach">← Back to dashboard</a></p>
    ${routineReadonly(routine)}
    ${memorySection(email, memories)}
    ${whatWorksSection(whatWorks || {}, { readOnly: true })}
    ${convo}
    ${checkins.length ? checkins.map(checkinCard).join('') : '<div class="card empty">No check-ins yet.</div>'}
    <p style="margin-top:28px;text-align:center"><a href="/coach/user/${encodeURIComponent(email)}/delete" style="color:#8a8a8a;font-size:14px">Delete hitter from the platform</a></p>`,
  });
}

// Read-only daily routine for the coach's per-hitter view.
function routineReadonly(drills) {
  const groups = [];
  for (const d of drills || []) {
    const st = d.station || 'Unsorted';
    let g = groups.find((x) => x.station === st);
    if (!g) {
      g = { station: st, drills: [] };
      groups.push(g);
    }
    g.drills.push(d);
  }
  return `<h2 class="section-head">Daily routine</h2>
  ${groups.length ? groups.map((g) => `
    <div class="card routine-group">
      <h2 class="routine-station">${esc(g.station)}</h2>
      ${g.drills.map((d) => `<div class="routine-row"><span class="routine-name">${esc(d.name)}</span></div>`).join('')}
    </div>`).join('') : `<div class="card empty">No routine set yet.</div>`}`;
}

// What Skip has learned about this hitter over time — Bobby's durable notes,
// injected into every Skip chat with this hitter. This is how Skip learns hitters.
function memorySection(email, memories) {
  const items = (memories || [])
    .map(
      (m) => `<div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <div>${esc(m.fact)}</div>
        <form method="post" action="/coach/user/${encodeURIComponent(email)}/memory/${m.id}/delete" style="margin:0">
          <button type="submit" class="btn-primary" style="padding:4px 10px;font-size:12px;background:#5a5a5a">Remove</button>
        </form>
      </div>`
    )
    .join('');
  return `<h2 class="section-head">What Skip has learned about this hitter</h2>
  <p class="hint">Durable memory — Skip reads this before every chat with this hitter. His best-day patterns, cues that work for him, what fixed his slumps. This is how he learns hitters over time.</p>
  ${items || '<div class="card empty">Nothing saved yet.</div>'}
  <div class="card"><form method="post" action="/coach/user/${encodeURIComponent(email)}/memory" class="form">
    <label>Teach Skip something about this hitter<input name="fact" maxlength="500" required placeholder="e.g. When he's rolling over, the cue 'stay inside it' in his own words fixed it — use that before any mechanical cue."></label>
    <button type="submit" class="btn-primary">Save to Skip's memory</button>
  </form></div>`;
}

// Confirm page before permanently deleting a hitter.
function coachDeleteHitterPage(user, hitter, name, checkinCount) {
  return layout({
    title: 'Delete hitter',
    user,
    tabs: coachTabs('dashboard', user.approvalCount),
    body: `<h1 class="page-title">Delete hitter?</h1>
    <div class="card">
      <p>This will permanently remove <strong>${esc(name)}</strong> (${esc(hitter.email)}) from The Daily Hitter — their account, ${checkinCount} check-in${checkinCount === 1 ? '' : 's'}, chat history, and routine.</p>
      <p class="hint">This can't be undone.</p>
      <form method="post" action="/coach/user/${encodeURIComponent(hitter.email)}/delete" class="form">
        <button type="submit" class="btn-primary" style="background:#a02020">Yes, delete ${esc(String(name).split(' ')[0] || 'hitter')}</button>
      </form>
      <p class="hint" style="text-align:center"><a href="/coach/user/${encodeURIComponent(hitter.email)}">Cancel — keep them</a></p>
    </div>`,
  });
}

// ---- Train Skip: Bobby's HQ for training Skip and reviewing his chats ----
function coachSkipPage(user, entries, hitters, thread, chatEnabled, saved) {
  const brain = require('./brain');
  const skipImg = `<img src="/skip-avatar.webp" class="skip-avatar" alt="Skip">`;
  const msgs = (thread || [])
    .map(
      (m) =>
        `<div class="msg ${m.role === 'user' ? 'msg-user' : 'msg-skip'}">${
          m.role === 'user' ? '' : skipImg
        }<div class="msg-bubble">${esc(m.content)}</div></div>`
    )
    .join('');
  const convos = hitters.length
    ? hitters
        .map(
          (h) => `<a class="card athlete-card" href="/coach/user/${encodeURIComponent(h.email)}">
        <div class="athlete-card-name">${esc(h.name)}</div>
        <div class="athlete-card-email">${esc(h.email)}</div>
        <div class="athlete-card-meta">${h.n} message${h.n === 1 ? '' : 's'}${
            h.last ? ` · last ${fmtDate(h.last)}` : ''
          }</div>
        ${
          h.lastSkip
            ? `<div class="hint" style="margin-top:6px">Skip's latest: &ldquo;${esc(
                h.lastSkip.slice(0, 140)
              )}${h.lastSkip.length > 140 ? '…' : ''}&rdquo;</div>`
            : ''
        }
      </a>`
        )
        .join('')
    : '<div class="card empty">No hitter has talked to Skip yet.</div>';

  // Skip's Brain: entries grouped by type, each with edit + archive/restore.
  const typeOrder = brain.LIB_TYPES;
  const grouped = {};
  for (const e of entries || []) (grouped[e.type] = grouped[e.type] || []).push(e);
  const brainSections = typeOrder
    .map((t) => {
      const list = grouped[t] || [];
      if (!list.length) return '';
      const cards = list
        .map(
          (e) => `<div class="card" style="${e.active ? '' : 'opacity:0.55'}">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
          <strong>${esc(e.title)}${e.active ? '' : ' (archived)'}</strong>
          <form method="post" action="/coach/skip/brain/${e.id}/archive" style="margin:0">
            <input type="hidden" name="active" value="${e.active ? '0' : '1'}">
            <button type="submit" class="btn-primary" style="padding:4px 10px;font-size:12px;background:${e.active ? '#5a5a5a' : '#1f7a33'}">${e.active ? 'Archive' : 'Restore'}</button>
          </form>
        </div>
        <div class="hint" style="white-space:pre-wrap;margin:8px 0">${esc(e.body)}</div>
        ${e.tags ? `<div class="hint">tags: ${esc(e.tags)}</div>` : ''}
        <details style="margin-top:8px"><summary class="hint" style="cursor:pointer">Edit</summary>
          <form method="post" action="/coach/skip/brain/${e.id}" class="form" style="margin-top:8px">
            <label>Title<input name="title" value="${esc(e.title)}" maxlength="120" required></label>
            <label>Body<textarea name="body" rows="3" maxlength="2000" required>${esc(e.body)}</textarea></label>
            <label>Tags (space-separated, used for matching)<input name="tags" value="${esc(e.tags)}" maxlength="200"></label>
            <button type="submit" class="btn-primary" style="padding:6px 12px;font-size:13px">Save changes</button>
          </form>
        </details>
      </div>`
        )
        .join('');
      return `<h3 class="section-head" style="font-size:16px">${brain.TYPE_LABELS[t]} (${list.length})</h3>${cards}`;
    })
    .join('');

  const typeOptions = typeOrder
    .map((t) => `<option value="${t}">${brain.TYPE_LABELS[t].replace(/s$/, '')}</option>`)
    .join('');

  return layout({
    title: 'Train Skip',
    user,
    tabs: coachTabs('skip', user.approvalCount),
    body: `<h1 class="page-title">Train Skip</h1>
    <p class="hint">Talk to Skip directly. To make training <strong>stick</strong>, put it in his Brain below — small discrete entries he pulls from when they're relevant. That's what fixed the "more training = worse Skip" problem: no more one giant note.</p>
    ${saved ? '<div class="notice">Brain updated — Skip is using it with every hitter now.</div>' : ''}
    <h2 class="section-head">Talk to Skip</h2>
    ${
      chatEnabled
        ? `<div id="chat-log" class="chat-log">${
            msgs ||
            `<div class="msg msg-skip">${skipImg}<div class="msg-bubble">Coach — what do you want me doing different with your hitters?</div></div>`
          }</div>
        <form id="chat-form" class="chat-form" data-endpoint="/api/coach/chat" autocomplete="off">
          <input id="chat-input" type="text" placeholder="Train Skip…" maxlength="2000" required>
          <button type="submit" class="btn-primary">Send</button>
        </form>`
        : `<div class="card empty">Skip's chat isn't switched on yet — check back soon.</div>`
    }
    <h2 class="section-head">Log a correction</h2>
    <div class="card">
      <p class="hint">Skip got something wrong with a hitter? Log it here — it becomes an <strong>example</strong> in his Brain so the fix sticks. This is the fastest way to train him now.</p>
      <form method="post" action="/coach/skip/correction" class="form">
        <label>What the hitter said<input name="hitter_said" maxlength="500" placeholder="e.g. I'm rolling over everything"></label>
        <label>What Skip said (wrong)<input name="skip_said" maxlength="500" placeholder="e.g. Widen your stance"></label>
        <label>What he should have said<textarea name="should_say" rows="3" maxlength="1000" required placeholder="e.g. That's the bat wrapping around your head at launch — think 'swing down the line'..."></textarea></label>
        <button type="submit" class="btn-primary">Save correction</button>
      </form>
    </div>
    <h2 class="section-head">Skip's Brain</h2>
    <div class="card">
      <p class="hint"><strong>Rules</strong> always apply. Everything else is pulled in only when it matches what the hitter is talking about. Archive anything stale instead of deleting — you can restore it.</p>
      <form method="post" action="/coach/skip/brain" class="form">
        <label>Type<select name="type">${typeOptions}</select></label>
        <label>Title<input name="title" maxlength="120" required placeholder="e.g. Bat drag fix"></label>
        <label>Body<textarea name="body" rows="3" maxlength="2000" required placeholder="The cue, read, or rule — keep it to a sentence or two."></textarea></label>
        <label>Tags (space-separated, used for matching)<input name="tags" maxlength="200" placeholder="e.g. mechanics bat-drag"></label>
        <button type="submit" class="btn-primary">Add to Brain</button>
      </form>
    </div>
    ${brainSections}
    <h2 class="section-head">His conversations</h2>
    <div class="athlete-grid">${convos}</div>
    <p class="hint">Tap a hitter to read their full thread with Skip — and to teach Skip what he's learning about that hitter over time.</p>`,
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

// ---------- Settings ----------

function settingsPage(user, opts) {
  const o = opts || {};
  const sub = o.subscription || null;
  const isCoach = user.role === 'coach';
  const tabs = isCoach ? coachTabs('settings', user.approvalCount) : userTabs('settings', user);
  return layout({
    title: 'Settings',
    user,
    tabs,
    body: `<h1 class="page-title">Settings</h1>
    ${o.error ? `<div class="error">${esc(o.error)}</div>` : ''}
    ${o.notice ? `<div class="notice">${esc(o.notice)}</div>` : ''}
    <div class="card">
      <h2 class="section-head">Account</h2>
      <form method="post" action="/settings/profile" class="form">
        <label>First name<input name="first_name" value="${esc(user.firstName || '')}" required maxlength="40"></label>
        <label>Last name<input name="last_name" value="${esc(user.lastName || '')}" required maxlength="40"></label>
        <label>Email<input type="email" name="email" value="${esc(user.email)}" required></label>
        <button class="btn-primary" type="submit">Save changes</button>
      </form>
    </div>
    <div class="card">
      <h2 class="section-head">Password</h2>
      <form method="post" action="/settings/password" class="form">
        <label>Current password<input type="password" name="current_password" autocomplete="current-password" required></label>
        <label>New password<input type="password" name="new_password" autocomplete="new-password" required minlength="8"></label>
        <button class="btn-primary" type="submit">Change password</button>
      </form>
    </div>
    <div class="card">
      <h2 class="section-head">Subscription</h2>
      ${sub && sub.status === 'active'
        ? `<p>You&apos;re on the <strong>${esc(sub.plan || 'paid')}</strong> plan.</p>
           <form method="post" action="/settings/subscription/cancel" class="form">
             <button class="btn-danger" type="submit">End subscription</button>
           </form>
           <p class="hint">You keep full access until the end of the current billing period.</p>`
        : `<p class="hint">You&apos;re on the free plan. When paid subscriptions launch, you&apos;ll manage your plan and billing right here.</p>`}
    </div>
    ${isCoach ? '' : `<div class="card danger-zone">
      <h2 class="section-head">Danger zone</h2>
      <p class="hint">Deleting your account permanently removes your check-ins, notes, chat history, streak, and everything else tied to it. This can&apos;t be undone.</p>
      <form method="post" action="/settings/delete" class="form">
        <label>Type DELETE to confirm<input name="confirm" autocomplete="off" required></label>
        <button class="btn-danger" type="submit">Delete my account</button>
      </form>
    </div>`}`,
  });
}

module.exports = {
  layout,
  userTabs,
  coachTabs,
  loginPage,
  registerPage,
  pendingPage,
  userHome,
  checkinForm,
  preCheckinPage,
  routinePage,
  notebookPage,
  scorePage,
  chatPage,
  coachDashboard,
  coachApprovalsPage,
  coachUser,
  coachDeleteHitterPage,
  coachSkipPage,
  forgotPasswordPage,
  resetPasswordPage,
  programPage,
  programRoutinePage,
  mentalGamePage,
  programEditPage,
  videosPage,
  videoWatchPage,
  coachLibraryPage,
  esc,
  settingsPage,
};

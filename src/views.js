// Skip — server-rendered HTML views. Black/red, mobile-first, no build step.

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Message bodies: escape HTML, then make http(s) URLs tappable links
// (Bobby, Sep 17 2026 — booking links in messages must be clickable).
function linkify(text) {
  return esc(text).replace(/https?:\/\/[^\s<>"')\]]+/g, (u) => {
    const trail = (u.match(/[.,!?;:]+$/) || [''])[0];
    const url = trail ? u.slice(0, -trail.length) : u;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>${trail}`;
  });
}

// Coach views: link an athlete's name to their coach profile page, styled
// like the existing homepage athlete-card links (invisible, inherits color).
function athleteLink(email, inner) {
  return `<a href="/coach/user/${encodeURIComponent(email || '')}" style="color:inherit;text-decoration:none">${inner}</a>`;
}

function fmtDate(iso) {
  // Rendered server-side as UTC; app.js localizes it in the browser.
  return `<span data-localtime="${esc(iso)}">${esc(iso)}</span>`;
}

// ---------- Layout ----------

// Bottom tab bar (Sep 2026): the daily loop — Home, Check In, Notebook,
// Talk to Skip — one thumb-tap away for hitters. The hamburger drawer keeps
// every tab (Mental Game, Program, Routine, Videos, Settings); the bar is
// additive, hitter-only, hidden on desktop where the drawer is the nav.
const TABBAR_HREFS = ['/mental-game', '/checkin', '/messages', '/notebook', '/chat'];
// Remote-program players already work from their program: the tab bar shows
// Program in the Messages slot. Messages stays in their sidebar drawer.
// Bottom tab bar for Bobby's remote hitters only (mobile). Program comes
// before Check In — the program is the point of the app for these guys.
const REMOTE_TABBAR_HREFS = ['/program', '/mental-game', '/checkin', '/notebook', '/chat'];
// Coach tab bar (Sep 2026, Bobby: Messages in the tab bar instead of Train
// Skip): Bobby's coaching loop — Home (attention), My Players, Approvals
// (badge), Messages (badge). Train Skip, Programs, Videos, Finances, and
// Settings stay in the drawer. Same bar for every coach, including view-only Cam.
const COACH_TABBAR_HREFS = ['/coach', '/coach/my-players', '/coach/approvals', '/coach/messages'];
const COACH_TABBAR_ICONS = {
  '/coach': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
  '/coach/my-players': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  '/coach/hitters': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  '/coach/approvals': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/></svg>',
  '/coach/skip': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
  '/coach/messages': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/></svg>',
};
const TABBAR_ICONS = {
  '/': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
  '/mental-game': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2z"/></svg>',
  '/checkin': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  '/messages': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/></svg>',
  '/program': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
  '/notebook': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
  '/routine': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>',
  '/chat': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
};
function bottomTabbar(user, tabs) {
  if (!user) return '';
  const isCoach = user.role === 'coach';
  if (!isCoach && user.role !== 'athlete') return '';
  const hrefs = isCoach ? COACH_TABBAR_HREFS : user.remoteProgramId ? REMOTE_TABBAR_HREFS : TABBAR_HREFS;
  const icons = isCoach ? COACH_TABBAR_ICONS : TABBAR_ICONS;
  const items = (tabs || []).filter((t) => hrefs.includes(t.href));
  if (!items.length) return '';
  return `<nav id="tabbar" aria-label="Primary">${items
    .map(
      (t) =>
        `<a href="${t.href}" class="tabbar-link${t.active ? ' active' : ''}">${icons[t.href] || ''}<span>${esc(t.label)}</span>${t.badge ? `<span class="tabbar-badge">${esc(t.badge)}</span>` : ''}</a>`
    )
    .join('')}</nav>`;
}

function layout({ title, user, tabs, body }) {
  const tabbarHtml = bottomTabbar(user, tabs);
  const tabHtml = (tabs || [])
    .map((t) => `<a href="${t.href}" class="drawer-link${t.active ? ' active' : ''}"><span class="drawer-link-text">${esc(t.label)}${t.sub ? `<span class="drawer-sub">${esc(t.sub)}</span>` : ''}</span>${t.badge ? `<span class="tab-badge">${esc(t.badge)}</span>` : ''}</a>`)
    .join('');
  // Organization branding (Sep 17 2026): a branded org's players see their
  // program's logo + name + colors instead of the stock Diamond Daily look.
  // Colors are hex-validated server-side, so the inline style block is safe.
  const brand = (user && user.brand) || null;
  const brandCss = brand
    ? `<style>:root{--red:${brand.primary};--red-dark:${brand.primaryDark};}.topbar{border-bottom-color:${brand.accent};}.brand-powered{font-size:9px;opacity:.55;letter-spacing:1px;margin-left:6px;font-weight:700;}.brand-logo-org{object-fit:contain;background:transparent;border:none;border-radius:0;}</style>`
    : '';
  const brandBlock = brand
    ? `<div class="brand"><img src="${esc(brand.logoUrl || '/diamond-daily-logo.jpg')}" class="brand-logo-icon${brand.logoUrl ? ' brand-logo-org' : ''}" alt=""> ${esc(brand.orgName)} <span class="brand-powered">POWERED BY DIAMOND DAILY</span></div>`
    : `<div class="brand"><img src="/diamond-daily-logo.jpg" class="brand-logo-icon" alt=""> DIAMOND DAILY</div>`;
  const drawer = tabHtml
    ? `<div id="drawer-overlay" hidden></div>
       <aside id="drawer" aria-label="Navigation" hidden>
         <div class="drawer-head"><span>DIAMOND DAILY</span><button type="button" id="drawer-close" aria-label="Close menu">\u2715</button></div>
         <nav>${tabHtml}</nav>
       </aside>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
<title>${esc(title)} · Diamond Daily</title>
<link rel="stylesheet" href="/style.css?v=2">
${brandCss}
<link rel="apple-touch-icon" sizes="180x180" href="/icons/icon-180.png?v=2">
<link rel="apple-touch-icon" sizes="152x152" href="/icons/icon-152.png?v=2">
<link rel="apple-touch-icon" sizes="167x167" href="/icons/icon-167.png?v=2">
<link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png?v=2">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Diamond Daily">
<meta name="theme-color" content="${brand ? brand.primary : '#0a0a0a'}">
</head>
<body${tabbarHtml ? ' class="has-tabbar"' : ''}>
<header class="topbar">
  <div class="topbar-left">${tabHtml ? `<button type="button" id="drawer-btn" aria-label="Open menu">\u2630</button>` : ''}${brandBlock}</div>
  ${user ? `<div class="userbox">${esc(user.displayName)} · <a href="/logout">Log out</a></div>` : ''}
</header>
${drawer}
${tabbarHtml}
${user && user.viewAs ? `<div class="viewas-banner">Previewing as <strong>${esc(user.viewAsName)}</strong> — actions are disabled. <form method="post" action="/coach/view-as/exit" style="display:inline;margin:0"><button type="submit" class="viewas-exit">Exit preview</button></form></div>` : ''}
${user && user.role === 'coach' && user.canEdit === false ? '<div class="viewonly-banner">View-only coach — you can look at everything, but changes are disabled.</div>' : ''}
<main class="wrap">${body}</main>
<script src="/app.js"></script>
</body>
</html>`;
}

function userTabs(active, user) {
  const isRemote = !!(user && user.remoteProgramId);
  // Mental Game is the landing tab (Sep 23 2026) — Home is gone. Athletes
  // open the app to today's exercise, the verse, and check-in.
  const tabs = [
    { href: '/mental-game', label: 'Lock In', active: active === 'mental' },
  ];
  // Program-first for athletes with an assigned remote/hybrid program:
  // Programs comes before Check In; everyone else keeps the old layout.
  if (isRemote) tabs.push({ href: '/program', label: 'Program', active: active === 'program' });
  tabs.push({ href: '/checkin', label: 'Check In', active: active === 'checkin' });
  // Messaging tab is for organization players only (Bobby's rule) — standalone
  // athletes don't get the tab at all.
  if (user && user.organizationId) {
    tabs.push({ href: '/messages', label: 'Messages', active: active === 'messages', badge: user.unreadMessages > 0 ? String(user.unreadMessages) : null });
  }
  // Bobby's remote hitters only — nobody else ever sees these tabs.
  if (isRemote) {
    tabs.push({ href: '/program/routine', label: 'Routine', active: active === 'routine' });
    tabs.push({ href: '/videos', label: 'Remote Library', active: active === 'videos' });
  } else {
    // Personal routine editor for every other hitter — one Routine tab, never two.
    tabs.push({ href: '/routine', label: 'Routine', active: active === 'routine' });
  }
  tabs.push(
    { href: '/notebook', label: 'Notebook', active: active === 'notebook' },
    { href: '/chat', label: 'Talk to Skip', sub: 'your personally trained coach', active: active === 'chat' },
    { href: '/settings', label: 'Settings', active: active === 'settings' },
  );
  // Organizations can turn Talk to Skip off for their players: no tab, no FAB,
  // no bottom-bar icon (all three key off this tab list).
  if (user && user.skipChatDisabled) {
    return tabs.filter((t) => t.href !== '/chat');
  }
  return tabs;
}

function coachTabs(active, approvalCount, user) {
  // Organization coaches are scoped to their program: Home, Hitters, Approvals,
  // plus Organizations so they can run their own teams and coaches (Bobby's
  // rule: the program is the master account). Team coaches get no Organizations tab.
  // No Train Skip, no Programs/Videos.
  if (user && user.role === 'coach' && user.organizationId) {
    const tabs = [
      { href: '/coach', label: 'Home', active: active === 'home' },
      { href: '/coach/hitters', label: 'Players', active: active === 'hitters' },
      { href: '/coach/approvals', label: 'Approvals', active: active === 'approvals', badge: approvalCount > 0 ? String(approvalCount) : null },
    ];
    if (!user.teamId) tabs.push({ href: '/coach/organizations', label: 'Organizations', active: active === 'organizations' });
    tabs.push({ href: '/settings', label: 'Settings', active: active === 'settings' });
    return tabs;
  }
  const tabs = [
    { href: '/coach', label: 'Home', active: active === 'home' },
    { href: '/coach/my-players', label: 'My Players', active: active === 'my-players' },
    { href: '/coach/hitters', label: 'All Players', active: active === 'hitters' },
    { href: '/coach/messages', label: 'Messages', active: active === 'messages', badge: user && user.unreadMessages > 0 ? String(user.unreadMessages) : null },
    { href: '/coach/videos', label: 'Remote Library', active: active === 'videos' },
    { href: '/coach/organizations', label: 'Organizations', active: active === 'organizations' },
    { href: '/coach/skip', label: 'Train Skip', active: active === 'skip' },
    { href: '/coach/approvals', label: 'Approvals', active: active === 'approvals', badge: approvalCount > 0 ? String(approvalCount) : null },
    { href: '/settings', label: 'Settings', active: active === 'settings' },
  ];
  // Lifting programs + Finances are Bobby's pages: full-access global coaches
  // only. Cam (view-only) and organization coaches never see them.
  if (user && user.role === 'coach' && !user.organizationId && user.canEdit !== false) {
    tabs.splice(6, 0, { href: '/coach/lifting', label: 'Lifting', active: active === 'lifting' });
    tabs.splice(7, 0, { href: '/coach/finances', label: 'Finances', active: active === 'finances' });
  }
  return tabs;
}

// ---------- Pages ----------

function loginPage(error, notice, parentResend) {
  return layout({
    title: 'Log in',
    user: null,
    tabs: [],
    body: `<div class="login-card card">
      <img src="/diamond-daily-logo.jpg" class="brand-logo-full" alt="Diamond Daily — A Baseball Journal">
      <p class="hint">Step into Diamond Daily. Log your sessions — the app learns what your best days look like.</p>
      ${error ? `<div class="error">${esc(error)}</div>` : ''}
      ${notice ? `<div class="notice">${esc(notice)}</div>` : ''}
      ${parentResend ? `<p class="hint" style="text-align:center"><a href="/parent-consent?resend=1">Resend the parent email</a></p>` : ''}
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
      <img src="/diamond-daily-logo.jpg" class="brand-logo-full" alt="Diamond Daily — A Baseball Journal">
      <p class="hint">Free. Use your email, set a password, start checking in. Your coach approves every new account.</p>
      ${error ? `<div class="error">${esc(error)}</div>` : ''}
      <form method="post" action="/register" class="form">
        <label>First name
          <input type="text" name="first_name" autocomplete="given-name" required maxlength="40">
        </label>
        <label>Last name
          <input type="text" name="last_name" autocomplete="family-name" required maxlength="40">
        </label>
        <label>Date of birth
          <input type="date" name="date_of_birth" required>
        </label>
        <fieldset class="role-picker">
          <legend>I am a…</legend>
          <div class="role-options">
          <label class="role-option"><input type="radio" name="player_type" value="hitter" checked> <span><strong>Hitter</strong></span></label>
          <label class="role-option"><input type="radio" name="player_type" value="pitcher"> <span><strong>Pitcher</strong></span></label>
          <label class="role-option"><input type="radio" name="player_type" value="two_way"> <span><strong>Two-way</strong> <span class="hint-inline">(both)</span></span></label>
          </div>
        </fieldset>
        <label>Email
          <input type="email" name="email" autocomplete="email" required>
        </label>
        <label>Password <span class="hint-inline">(8+ characters)</span>
          <input type="password" name="password" autocomplete="new-password" required minlength="8">
        </label>
        <label>Confirm password
          <input type="password" name="confirm_password" autocomplete="new-password" required minlength="8">
        </label>
        <label>Organization or team code <span class="hint-inline">(optional — only if your coach gave you one)</span>
          <input type="text" name="organization_code" autocomplete="off" maxlength="20" style="text-transform:uppercase">
        </label>
        <div id="parent-fields" hidden>
          <p class="hint"><strong>Under 18?</strong> A parent or guardian has to accept the terms for you — have them fill this in.</p>
          <p class="hint" id="under13-note" hidden><strong>Under 13?</strong> We'll email your parent a link to approve — your account activates after they click it, then your coach approves it.</p>
          <label>Parent/guardian full name
            <input type="text" name="parent_name" autocomplete="off" maxlength="80">
          </label>
          <label>Parent/guardian email
            <input type="email" name="parent_email" autocomplete="email" maxlength="120">
          </label>
        </div>
        <label class="agree-row">
          <input type="checkbox" name="agree_terms" value="1" required>
          <span>I agree to the <a href="/terms" target="_blank" rel="noopener">Terms of Service</a> and <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a>.</span>
        </label>
        <button type="submit" class="btn-primary">Create account</button>
      </form>
      <script>
      (function () {
        var dob = document.querySelector('input[name="date_of_birth"]');
        var box = document.getElementById('parent-fields');
        var note13 = document.getElementById('under13-note');
        function age() {
          if (!dob.value) return null;
          var d = new Date(dob.value + 'T12:00:00');
          if (isNaN(d.getTime())) return null;
          var now = new Date(), a = now.getFullYear() - d.getFullYear();
          var m = now.getMonth() - d.getMonth();
          if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
          return a;
        }
        function sync() {
          var a = age();
          var u18 = a !== null && a < 18;
          box.hidden = !u18;
          box.querySelectorAll('input').forEach(function (i) { i.required = u18; });
          note13.hidden = !(a !== null && a < 13);
        }
        dob.addEventListener('change', sync);
        dob.addEventListener('input', sync);
        sync();
      })();
      </script>
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
      <img src="/diamond-daily-logo.jpg" class="brand-logo-full" alt="Diamond Daily — A Baseball Journal">
      <h1 class="page-title">You're on the list.</h1>
      <p class="hint">Every account is personally approved. You'll be able to log in as soon as you get the green light.</p>
      <p class="hint" style="text-align:center"><a href="/login">Back to log in</a></p>
    </div>`,
  });
}

// Waiting room for under-13 signups: parent email sent, account activates
// after the parent clicks the approval link.
function parentWaitPage() {
  return layout({
    title: 'Check your parent\u2019s email',
    user: null,
    tabs: [],
    body: `<div class="login-card card">
      <img src="/diamond-daily-logo.jpg" class="brand-logo-full" alt="Diamond Daily — A Baseball Journal">
      <h1 class="page-title">One more step.</h1>
      <p class="hint">Because you're under 13, we emailed your parent/guardian an approval link. Your account activates once they click it — then your coach gives the final approval and you're in.</p>
      <p class="hint" style="text-align:center"><a href="/parent-consent?resend=1">Didn\u2019t get the email? Send it again</a></p>
      <p class="hint" style="text-align:center"><a href="/login">Back to log in</a></p>
    </div>`,
  });
}

// Parent consent result: success (name set) or invalid/expired link (error).
function parentConsentPage(name, error) {
  return layout({
    title: 'Parent approval',
    user: null,
    tabs: [],
    body: `<div class="login-card card">
      <img src="/diamond-daily-logo.jpg" class="brand-logo-full" alt="Diamond Daily — A Baseball Journal">
      ${name
        ? `<h1 class="page-title">Thanks!</h1>
           <p class="hint">${esc(name)}\u2019s account is approved and now waiting for coach approval. They\u2019ll be able to log in once it\u2019s approved.</p>`
        : `<h1 class="page-title">That link didn\u2019t work.</h1>
           ${error ? `<div class="error">${esc(error)}</div>` : ''}
           <p class="hint">Links expire after 7 days and can only be used once.</p>
           <form method="post" action="/parent-consent/resend" class="form">
             <label>Player\u2019s account email<input type="email" name="child_email" autocomplete="email" required></label>
             <button type="submit" class="btn-primary">Send a new link</button>
           </form>`}
      <p class="hint" style="text-align:center"><a href="/login">Back to log in</a></p>
    </div>`,
  });
}

function parentConsentResendPage(message) {
  return layout({
    title: 'Resend parent email',
    user: null,
    tabs: [],
    body: `<div class="login-card card">
      <img src="/diamond-daily-logo.jpg" class="brand-logo-full" alt="Diamond Daily — A Baseball Journal">
      <h1 class="page-title">Resend the approval email.</h1>
      ${message ? `<div class="notice">${esc(message)}</div>` : ''}
      <form method="post" action="/parent-consent/resend" class="form">
        <label>Player\u2019s account email<input type="email" name="child_email" autocomplete="email" required></label>
        <button type="submit" class="btn-primary">Send it again</button>
      </form>
      <p class="hint" style="text-align:center"><a href="/login">Back to log in</a></p>
    </div>`,
  });
}

function legalPage(title, sections) {
  const body = sections
    .map(([h, p]) => `<h2 class="legal-h">${esc(h)}</h2><p class="legal-p">${p}</p>`)
    .join('');
  return layout({
    title,
    user: null,
    tabs: [],
    body: `<div class="card legal-card">
      <h1 class="page-title">${esc(title)}</h1>
      <p class="hint">Version 1.0 — September 2026 · <a href="/register">Back to sign up</a></p>
      ${body}
    </div>`,
  });
}

function termsPage() {
  return legalPage('Terms of Service', [
    ['What Diamond Daily is',
      'Diamond Daily is a daily development platform for baseball players — hitters, pitchers, and two-way players. Players log their training sessions, reflect on what happened, and build a history of their development. An AI coaching assistant called Skip can talk players through their training using their own logged history. Coaches get dashboards showing engagement, check-ins, and trends across players, teams, and organizations. Diamond Daily is operated by Atko Enterprises, Inc., an Illinois company.'],
    ['Eligibility',
      'You must be at least 13 years old to use Diamond Daily. If you are under 18, a parent or guardian must accept these terms on your behalf when you sign up.'],
    ['Parent / guardian consent',
      'For players under 18, we require a parent or guardian\u2019s full name and email address at signup, and the parent or guardian accepts these terms for the player. For children under 13, we require verifiable parental consent before an account is created — contact us at <a href="mailto:diamonddailyapp@gmail.com">diamonddailyapp@gmail.com</a> to arrange it.'],
    ['Your account',
      'Every new account is reviewed and must be approved before use. You are responsible for keeping your password private and for activity on your account. One account per person.'],
    ['Acceptable use',
      'Use Diamond Daily for your own training and development. Don\u2019t try to break, overload, or misuse the service, don\u2019t access other people\u2019s accounts, and don\u2019t post anything abusive or unlawful. We may suspend or remove accounts that misuse the service.'],
    ['Skip is an AI assistant, not a coach',
      'Skip is an AI coaching assistant. It is not a professional or certified coach, and nothing in the app — from Skip or otherwise — is medical, health, or professional advice. Training guidance is general information based on what you log. Use it at your own risk, and talk to a qualified professional about injuries, pain, or health concerns.'],
    ['Your content',
      'You own what you write in your check-ins, notes, and messages. By using the service you allow us to store and display that content to you and to your approved coaches as part of the service. Diamond Daily\u2019s branding, software, and design belong to Atko Enterprises, Inc.'],
    ['Free during testing',
      'Diamond Daily is free while it is being tested. There is no paywall and no charge. Paid subscription plans may be introduced in the future; if that happens, we will present the subscription terms before anything is charged and continued use will be governed by those terms.'],
    ['Limitation of liability',
      'To the maximum extent permitted by law, Atko Enterprises, Inc. is not liable for indirect or consequential damages arising from your use of the service. The service is provided \u201cas is\u201d without warranties of any kind.'],
    ['Changes to these terms',
      'We may update these terms as the service evolves. We will note the new version date here, and for material changes we will notify users in the app. Continued use after changes take effect means you accept the updated terms.'],
    ['Governing law & contact',
      'These terms are governed by the laws of the State of Illinois. Questions about these terms: <a href="mailto:diamonddailyapp@gmail.com">diamonddailyapp@gmail.com</a>.'],
  ]);
}

function privacyPage() {
  return legalPage('Privacy Policy', [
    ['What we collect',
      'On every player we collect: your name, email address, date of birth, player type (hitter, pitcher, or two-way), and your password (stored securely hashed — never in plain text). We also store everything you put into the app: every check-in (session scores, session notes, what worked, struggles, pitch counts and other training details), your conversations with Skip, your notebook entries, your mental game keys, push notification tokens, and login records. On coaches we collect name, email address, and activity in the app. On organizations we collect the organization name, roster, and deal/payment terms.'],
    ['Why we collect it',
      'To run the service: create and protect accounts, keep your check-in history, generate coaching insights, power coach dashboards, and review new signups before approval.'],
    ['How it is used',
      'Your entries are shown to you and to your approved coaches — that is the core of the service. We use aggregated, de-identified information to improve the app. We do not sell your personal information to anyone.'],
    ['Who can see your data',
      'You, your approved coaches (including organization and team coaches for players on their roster), and the operators of Diamond Daily for support and safety purposes. Service providers that host our infrastructure may process data on our behalf and are not permitted to use it for their own purposes. We disclose information if required by law.'],
    ['Children\u2019s privacy',
      'Diamond Daily is for users 13 and older. If you are under 18, a parent or guardian must accept these terms and this policy on your behalf at signup. For children under 13, we require verifiable parental consent before collecting any personal information, consistent with the Children\u2019s Online Privacy Protection Act (COPPA). Parents may contact us at any time to review, correct, or delete their child\u2019s information.'],
    ['Data retention',
      'We keep your information for as long as your account is active and as needed to run the service. If you delete your account, we remove your personal information and entries; backup copies are purged on a rolling basis.'],
    ['Security',
      'We use reasonable technical and organizational safeguards to protect your information — including hashed passwords, encrypted connections, and approval-gated accounts. No system is perfectly secure, so we cannot guarantee absolute security.'],
    ['Your rights',
      'You (or your parent/guardian, for players under 18) can ask us to show, correct, or delete your personal information at any time by emailing <a href="mailto:diamonddailyapp@gmail.com">diamonddailyapp@gmail.com</a>. We will respond to legitimate requests promptly.'],
    ['Changes to this policy',
      'We may update this policy as the service evolves. We will note the new version date here and notify users of material changes in the app.'],
    ['Contact',
      'Questions about privacy: <a href="mailto:diamonddailyapp@gmail.com">diamonddailyapp@gmail.com</a> — Atko Enterprises, Inc., Illinois.'],
  ]);
}

function userHome(user, extras) {
  const { whatWorks = {}, avgScore = null, checkinCount = 0, recent = [], streak = null, pushOn = false, pushEnabled = false, precheckin = null, showBiblePopup = false } = extras || {};
  // Unread coach messages + no push: point them at the inbox (the Messages
  // page itself carries the turn-on-notifications nudge).
  const msgBanner =
    user.unreadMessages > 0 && !pushOn
      ? `<div class="card push-card"><p style="margin:0 0 10px"><strong>You have messages from Coach.</strong> <span class="hint">Turn on notifications so you never miss one.</span></p><p style="margin:0"><a href="/messages" class="btn-primary">Read messages</a></p></div>`
      : '';
  let streakCard = '';
  if (streak) {
    const n = streak.streak || 0;
    if (n >= 1) {
      const line =
        n >= 30 ? '30 days. You\u2019re a different player.' :
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
        <p style="margin:0 0 10px"><strong>Never miss a day.</strong> <span class="hint">Turn on reminders \u2014 get a nudge on days you haven\u2019t checked in.</span></p>
        <p style="margin:0"><button type="button" class="btn-primary" id="push-enable-btn" style="margin-top:0">Turn on reminders</button></p>
      </div>`
    : '';
  const head = avgScore !== null
    ? `<div class="level-head"><p class="hint">Your read across ${checkinCount} session${checkinCount === 1 ? '' : 's'}:</p>${levelLine(avgScore)}</div>`
    : `<p class="hint">No check-ins yet. Log your first session and the app starts learning your game.</p>`;
  const preCard = precheckin
    ? `<div class="card"><p style="margin:0 0 6px"><strong>Today's intent</strong> <span class="hint-inline">${precheckin.kind === 'game' ? 'Pregame / Live ABs' : 'Cage'}</span></p>
        ${precheckin.focus ? `<p style="margin:0 0 4px">&ldquo;${esc(precheckin.focus)}&rdquo;</p>` : ''}
        ${precheckin.plan ? `<p class="hint" style="margin:0 0 4px">Plan: ${esc(precheckin.plan)}</p>` : ''}
        ${precheckin.flush ? `<p class="hint" style="margin:0">Flushing: ${esc(precheckin.flush)}</p>` : ''}
        <p class="hint" style="margin:8px 0 0"><a href="/precheckin?kind=${precheckin.kind === 'game' ? 'game' : 'cage'}">Update it →</a></p></div>`
    : `<div class="card"><p style="margin:0"><strong>Before you hit?</strong> <span class="hint">Set your intent in two minutes — what you're working on and how. Optional.</span> <a href="/precheckin">Pre-hit check-in →</a></p></div>`;
  // Bible study opt-in popup (Sep 23 2026, Bobby): appears on app open until
  // the athlete answers. Yes/No posts once; the popup never shows again.
  const biblePopup = showBiblePopup ? `
    <div id="bible-popup-overlay" class="modal-overlay">
      <div class="card modal-card" role="dialog" aria-modal="true" aria-labelledby="bible-popup-title">
        <h2 id="bible-popup-title" style="margin-top:0">New: Daily Bible Study</h2>
        <p>We&apos;re adding an optional daily Bible study &mdash; a verse plus a short breakdown in the Lock In tab. Only for guys who want it.</p>
        <div class="modal-actions">
          <button type="button" class="btn-primary" id="bible-yes">Yes, count me in</button>
          <button type="button" class="btn-secondary" id="bible-no">No thanks</button>
        </div>
      </div>
    </div>
    ` : '';
  return layout({
    title: 'Home',
    user,
    tabs: userTabs('home', user),
    body: `<h1 class="page-title">What's up, ${esc(user.displayName)}</h1>
    ${biblePopup}
    ${msgBanner}
    <div class="card cta-card">
      <p class="skip-intro">Check in daily. Every session gets a read, and the app learns what your best days look like.</p>
      <a href="/checkin" class="btn-primary">Check in today's session</a>
    </div>
    ${user.viewAsRestricted ? '' : preCard}
    ${head}
    ${pushOn ? '' : streakCard}
    ${pushCard}
    ${user.viewAsRestricted ? '' : whatWorksSection(whatWorks)}
    ${recent.length ? `<h2 class="section-head">Recent</h2>${recent.map((c) => checkinCard(c, { restricted: user.viewAsRestricted })).join('')}<p><a href="/notebook">See your notebook →</a></p>` : ''}
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
          <div class="works-line">Shows up on your tough days \u2014 drop it <span class="hint-inline">(${t.count} sessions)</span>${levelLine(t.avg)}</div>
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
       ${drills ? `<div class="works-sub">What you did on good days</div><div class="works-rows">${drills}</div>` : ''}`
    : `<p class="hint">Check in 3+ times and your patterns start to show.</p>`;
  return `<section id="what-works" class="card">
    <h2>What works for you</h2>
    <p class="hint">Your read on your sessions \u2014 what to keep, what to trash, and what your routine is doing for you.</p>
    ${body}
  </section>`;
}

const ENVIRONMENTS = ['Game', 'Cage', 'Live BP', 'Tee Work', 'Other'];

// Pitching check-ins (Sep 2026).
const PITCH_SESSION_TYPES = [
  ['bullpen', 'Bullpen'],
  ['live', 'Live'],
  ['game', 'Game'],
  ['catch_play', 'Catch play'],
  ['recovery', 'Recovery'],
  ['no_throw', 'No throw'],
];
const THROW_INTENTS = [
  ['light', 'Light day'],
  ['medium', 'Medium day'],
  ['heavy', 'Heavy day'],
];
const PITCH_TYPES = ['4-seam FB', '2-seam FB', 'Cutter', 'Slider', 'Curveball', 'Changeup', 'Splitter', 'Sweeper'];
function pitchSessionTypeLabel(t) {
  const f = PITCH_SESSION_TYPES.find((x) => x[0] === t);
  return f ? f[1] : t;
}
function throwIntentLabel(t) {
  const f = THROW_INTENTS.find((x) => x[0] === t);
  return f ? f[1] : t;
}

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

// "What did you do today?" sections (Bobby, Sep 17 2026: separated sections,
// not one text box). Each section is its own comma-separated input + its own
// history chips. `field` is the form input name/id; `key` indexes sectioned
// value objects server-side; `quick` is the per-section quick-pick chip
// (null = none).
const DRILL_SECTIONS = [
  { key: 'prep', field: 'sec_prep', label: 'Prep', quick: 'Prep' },
  { key: 'tee', field: 'sec_tee', label: 'Off the tee', quick: 'Tee' },
  { key: 'sideToss', field: 'sec_sidetoss', label: 'Side toss', quick: 'Side Toss' },
  { key: 'frontToss', field: 'sec_fronttoss', label: 'Front toss', quick: 'Front Toss' },
  { key: 'bp', field: 'sec_bp', label: 'BP', quick: 'BP' },
  { key: 'machine', field: 'sec_machine', label: 'Machine', quick: 'Machine' },
  { key: 'other', field: 'sec_other', label: 'Other', quick: null },
];

function checkinForm(user, error, values, drillNames, routine, recentGroups, action) {
  const v = values || {};
  const isEdit = !!action; // hitter self-serve edit (Bobby, Sep 17 2026)
  const rt = routine || [];
  const routineJson = esc(JSON.stringify(rt.map((d) => ({ name: d.name, station: d.station }))));
  const envPills = ENVIRONMENTS
    .map((e) => `<label class="pill"><input type="radio" name="environment" value="${e}"${v.environment === e ? ' checked' : ''} required><span>${e}</span></label>`)
    .join('');
  // "What did you do today?" searchable dropdown (Bobby, Sep 18 2026): one
  // compact combobox replaces the 7 stacked section inputs. Options = the
  // hitter's recent drills (tagged with their section) + the full drill
  // registry; free-typed entries take the section select's value. Picks become
  // removable tokens; "Didn't do this" clears them all. Tokens serialize into
  // the hidden sec_* inputs on submit, so the server parser is untouched.
  // Blank submits as none — nothing drill-related lands on the entry.
  const bareDrill = (n) => String(n).replace(/\s*\([^()]*\)\s*$/, '').trim() || String(n).trim();
  const seenOpt = new Set();
  const recentOpts = [];
  const groups = recentGroups && typeof recentGroups === 'object' ? recentGroups : {};
  for (const s of DRILL_SECTIONS) {
    const names = Array.isArray(groups[s.key]) ? groups[s.key] : [];
    for (const n of names) {
      const b = bareDrill(n);
      const k = b.toLowerCase();
      if (!b || seenOpt.has(k)) continue;
      seenOpt.add(k);
      recentOpts.push({ name: b, section: s.key });
    }
  }
  const registryOpts = (drillNames || [])
    .map((d) => String(d).trim())
    .filter((d) => d && !seenOpt.has(d.toLowerCase()))
    .map((d) => { seenOpt.add(d.toLowerCase()); return { name: d, section: null }; });
  const drillOptionsJson = esc(JSON.stringify({ recent: recentOpts, registry: registryOpts }));
  // Seed tokens from existing values (edit form / failed POST re-render).
  const initialTokens = [];
  for (const s of DRILL_SECTIONS) {
    const raw = v[s.field] || (v.sections && v.sections[s.key]) || '';
    for (const part of String(raw).split(',')) {
      const name = part.trim();
      if (name) initialTokens.push({ name, section: s.key });
    }
  }
  const initialTokensJson = esc(JSON.stringify(initialTokens));
  const hiddenSectionInputs = DRILL_SECTIONS
    .map((s) => {
      const secVal = v[s.field] || (v.sections && v.sections[s.key]) || '';
      return `<input type="hidden" id="${s.field}" name="${s.field}" value="${esc(secVal)}">`;
    })
    .join('');
  return layout({
    title: 'Check In',
    user,
    tabs: userTabs('checkin', user),
    body: `<h1 class="page-title">${isEdit ? 'Edit check-in' : 'Check In'}</h1>
    <div class="card"><p class="hint skip-intro">${isEdit ? 'Fix anything that wasn’t right. Saving updates your entry — the session date stays the same.' : 'Log your session. Give as much detail as you can — the more detail, the better the reads get.'}</p>
    <form method="post" action="${isEdit ? esc(action) : '/checkin'}" class="form" data-validate="hitting">
      ${error ? `<div class="error">${esc(error)}</div>` : ''}
      <div class="field-label">Where were you?</div>
      <div class="pills">${envPills}</div>
      <div class="field-label">What did you do today?</div>
      <p class="hint">Tap what you did, then list the drills for each.</p>
      <div class="activity-checklist">
        ${DRILL_SECTIONS.filter(s => s.key !== 'other').map((s) => {
          const secVal = v[s.field] || (v.sections && v.sections[s.key]) || '';
          const checked = secVal.trim() ? ' checked' : '';
          return `<div class="activity-item">
            <label class="activity-check">
              <input type="checkbox" data-section="${s.key}"${checked}>
              <span>${s.label}</span>
            </label>
            <input type="text" name="${s.field}" value="${esc(secVal)}" placeholder="What drills?" class="activity-drills"${checked ? '' : ' hidden'}>
          </div>`;
        }).join('')}
        ${(() => {
          const secVal = v['sec_other'] || (v.sections && v.sections['other']) || '';
          const checked = secVal.trim() ? ' checked' : '';
          return `<div class="activity-item">
            <label class="activity-check">
              <input type="checkbox" data-section="other"${checked}>
              <span>Other</span>
            </label>
            <input type="text" name="sec_other" value="${esc(secVal)}" placeholder="What did you do?" class="activity-drills"${checked ? '' : ' hidden'}>
          </div>`;
        })()}
      </div>
      ${sliderField('feel', 'Feel', 'How good did you feel?', v.feel)}
      ${sliderField('confidence', 'Confidence', 'How confident did you feel?', v.confidence)}
      ${sliderField('focus', 'Focus', 'How locked in was your focus?', v.focus)}
      ${sliderField('difficulty', 'Difficulty', 'How hard was the training?', v.difficulty, ['Easy', 'Brutal'], true)}
      <script src="/checkin.js"></script>
      <label>Session notes <span class="req" aria-hidden="true">*</span> <span class="hint-inline">(don't hold back — what you felt, what you saw, what was off)</span><span class="talk-wrap"><textarea id="session_notes" name="session_notes" rows="4" placeholder="How did it go? What did you feel?">${esc(v.session_notes || '')}</textarea><button type="button" class="mic-btn" data-target="session_notes" aria-label="Dictate instead of typing">🎙</button></span></label>
      <label>What worked <span class="hint-inline">(be specific — the exact drill, cue, or feel)</span><span class="talk-wrap"><textarea id="what_worked" name="what_worked" rows="2" placeholder="What clicked today?">${esc(v.what_worked || '')}</textarea><button type="button" class="mic-btn" data-target="what_worked" aria-label="Dictate instead of typing">🎙</button></span></label>
      <button type="submit" class="btn-primary">${isEdit ? 'Save changes' : 'Submit check-in'}</button>
    </form></div>`,
  });
}

// Combined two-way check-in (Sep 2026): one form for both. "What did you do
// today?" toggles the condensed hitting and throwing blocks; feel, focus,
// confidence and the three reflections are shared so he only answers once.
function combinedCheckinForm(user, error, values, action) {
  const v = values || {};
  const isEdit = !!action; // hitter self-serve edit (Bobby, Sep 17 2026)
  const didHit = v.did_hit === 'yes' || (!v.pitch_session_type && v.did_throw !== 'yes');
  const didThrow = v.did_throw === 'yes' || !!v.pitch_session_type;
  const envPills = ENVIRONMENTS
    .map((e) => `<label class="pill"><input type="radio" name="environment" value="${e}"${v.environment === e ? ' checked' : ''}><span>${e}</span></label>`)
    .join('');
  const mic = (id) => `<button type="button" class="mic-btn" data-target="${id}" aria-label="Dictate instead of typing">🎙</button>`;
  return layout({
    title: 'Check In',
    user,
    tabs: userTabs('checkin', user),
    body: `<h1 class="page-title">${isEdit ? 'Edit check-in' : 'Check In'}</h1>
    <div class="card"><p class="hint skip-intro">${isEdit ? 'Fix anything that wasn\u2019t right. Saving updates your entry \u2014 the session date stays the same.' : 'One check-in for the whole day. Say what you did \u2014 hitting, throwing, or both.'}</p>
    <form method="post" action="${isEdit ? esc(action) : '/checkin/combined'}" class="form" id="combined-form" data-throw-sync data-validate="combined">
      ${error ? `<div class="error">${esc(error)}</div>` : ''}
      <div class="field-label">What did you do today?</div>
      <div class="pills">
        <label class="pill"><input type="checkbox" name="did_hit" value="yes"${didHit ? ' checked' : ''}><span>Hitting</span></label>
        <label class="pill"><input type="checkbox" name="did_throw" value="yes"${didThrow ? ' checked' : ''}><span>Throwing</span></label>
      </div>
      ${sliderField('feel', 'Feel', 'How good did you feel overall?', v.feel)}
      ${sliderField('focus', 'Focus', 'How locked in was your focus?', v.focus)}
      ${sliderField('confidence', 'Confidence', 'How confident did you feel?', v.confidence)}
      <div id="combined-hitting-block"${didHit ? '' : ' hidden'}>
        <div class="field-label">Hitting — where were you?</div>
        <div class="pills">${envPills}</div>
        ${sliderField('difficulty', 'Difficulty', 'How hard was the hitting?', v.difficulty, ['Easy', 'Brutal'], true)}
      </div>
      <div id="combined-throwing-block"${didThrow ? '' : ' hidden'}>
        <div class="field-label">Throwing</div>
        ${throwingFields(v, 'combined-form', `
        <div id="combined-form-command-block"${['recovery', 'no_throw'].includes(v.pitch_session_type) ? ' hidden' : ''}>
          ${sliderField('command', 'Command', 'How well did you command the ball?', v.command)}
        </div>`)}
      </div>
      <label>What felt good?<span class="talk-wrap"><textarea id="felt_good" name="felt_good" rows="2" placeholder="What clicked today, hitting or throwing?">${esc(v.felt_good || '')}</textarea>${mic('felt_good')}</span></label>
      <label>What was working?<span class="talk-wrap"><textarea id="what_was_working" name="what_was_working" rows="2" placeholder="Which feel, which pitch, which cue?">${esc(v.what_was_working || '')}</textarea>${mic('what_was_working')}</span></label>
      <label>What was your biggest struggle?<span class="talk-wrap"><textarea id="biggest_struggle" name="biggest_struggle" rows="2" placeholder="Be honest — that's what makes the read useful.">${esc(v.biggest_struggle || '')}</textarea>${mic('biggest_struggle')}</span></label>
      <script src="/checkin.js"></script>
      <button type="submit" class="btn-primary">${isEdit ? 'Save changes' : 'Submit check-in'}</button>
    </form></div>`,
  });
}

// Shared throwing block for the pitcher-only and combined two-way forms:
// session type + intent + conditional detail fields. The command slider is
// passed in so it lands after feel/focus/confidence in each form.
function throwingFields(v, formId, commandHtml) {
  const typePills = PITCH_SESSION_TYPES
    .map(([val, label]) => `<label class="pill"><input type="radio" name="pitch_session_type" value="${val}"${v.pitch_session_type === val ? ' checked' : ''} required><span>${label}</span></label>`)
    .join('');
  const intentPills = THROW_INTENTS
    .map(([val, label]) => `<label class="pill"><input type="radio" name="intent" value="${val}"${v.intent === val ? ' checked' : ''}><span>${label}</span></label>`)
    .join('');
  const pitchChecks = PITCH_TYPES
    .map((p) => `<label class="check"><input type="checkbox" name="pitches_thrown" value="${esc(p)}"${(v.pitches_thrown || []).includes(p) ? ' checked' : ''}><span>${esc(p)}</span></label>`)
    .join('');
  const mic = (id) => `<button type="button" class="mic-btn" data-target="${id}" aria-label="Dictate instead of typing">🎙</button>`;
  return `
      <div class="field-label">What kind of throwing was it?</div>
      <div class="pills">${typePills}</div>
      <div id="${formId}-intent-block"${['recovery', 'no_throw'].includes(v.pitch_session_type) ? ' hidden' : ''}>
        <div class="field-label">What was the intent today?</div>
        <div class="pills">${intentPills}</div>
      </div>
      <div id="${formId}-detail-throw"${['bullpen', 'live', 'game'].includes(v.pitch_session_type) ? '' : ' hidden'}>
        <label>Pitch count
          <input type="number" name="pitch_count" min="1" max="300" inputmode="numeric" placeholder="e.g. 35" value="${esc(v.pitch_count || '')}" required>
        </label>
        <div class="field-label">Which pitches did you throw?</div>
        <div class="checks">${pitchChecks}</div>
        <label>Top velo <span class="hint-inline">(optional)</span>
          <input type="number" name="velo_max" min="40" max="110" step="0.1" inputmode="decimal" placeholder="e.g. 88.5" value="${esc(v.velo_max || '')}">
        </label>
      </div>
      <div id="${formId}-detail-catch"${v.pitch_session_type === 'catch_play' ? '' : ' hidden'}>
        <label>How far did you stretch it out? <span class="hint-inline">(optional)</span>
          <input type="text" name="catch_distance" maxlength="30" placeholder="e.g. 120 ft" value="${esc(v.catch_distance || '')}">
        </label>
      </div>
      <div id="${formId}-detail-recovery"${v.pitch_session_type === 'recovery' ? '' : ' hidden'}>
        <label>What recovery work did you do?<span class="talk-wrap"><textarea id="${formId}_recovery_notes" name="recovery_notes" rows="3" placeholder="e.g. Bands, shoulder care, 10 min flush run">${esc(v.recovery_notes || '')}</textarea>${mic(formId + '_recovery_notes')}</span></label>
      </div>
      <div id="${formId}-detail-nothrow"${v.pitch_session_type === 'no_throw' ? '' : ' hidden'}>
        <p class="hint">No throwing today — that's fine. Days off the mound still count.</p>
        <label>What did you do to get better today?<span class="talk-wrap"><textarea id="${formId}_no_throw_note" name="no_throw_note" rows="3" placeholder="e.g. Lifted legs, watched film on my last outing, mobility">${esc(v.no_throw_note || '')}</textarea>${mic(formId + '_no_throw_note')}</span></label>
      </div>
      ${commandHtml || ''}`;
}

// Pitching check-in (Sep 2026): session type first, then intent, then the
// throwing details for that type, then feel/focus/confidence/command plus
// three reflections. Blocks show/hide based on session type.
function pitchingCheckinForm(user, error, values, action) {
  const v = values || {};
  const isEdit = !!action; // hitter self-serve edit (Bobby, Sep 17 2026)
  const mic = (id) => `<button type="button" class="mic-btn" data-target="${id}" aria-label="Dictate instead of typing">🎙</button>`;
  return layout({
    title: 'Check In',
    user,
    tabs: userTabs('checkin', user),
    body: `<h1 class="page-title">${isEdit ? 'Edit check-in' : 'Check In'}</h1>
    <div class="card"><p class="hint skip-intro">${isEdit ? 'Fix anything that wasn\u2019t right. Saving updates your entry \u2014 the session date stays the same.' : 'Log your throwing today. The more detail, the better the reads get.'}</p>
    <form method="post" action="${isEdit ? esc(action) : '/checkin/pitching'}" class="form" id="pitching-form" data-throw-sync data-validate="pitching">
      ${error ? `<div class="error">${esc(error)}</div>` : ''}
      ${throwingFields(v, 'pitching-form', '')}
      ${sliderField('feel', 'Feel', 'How good did your arm/body feel?', v.feel)}
      ${sliderField('focus', 'Focus', 'How locked in was your focus?', v.focus)}
      ${sliderField('confidence', 'Confidence', 'How confident did you feel?', v.confidence)}
      <div id="pitching-form-command-block"${['recovery', 'no_throw'].includes(v.pitch_session_type) ? ' hidden' : ''}>
        ${sliderField('command', 'Command', 'How well did you command the ball?', v.command)}
      </div>
      <label>What felt good?<span class="talk-wrap"><textarea id="felt_good" name="felt_good" rows="2" placeholder="What clicked physically?">${esc(v.felt_good || '')}</textarea>${mic('felt_good')}</span></label>
      <label>What was working?<span class="talk-wrap"><textarea id="what_was_working" name="what_was_working" rows="2" placeholder="Which pitch, which feel, which sequence?">${esc(v.what_was_working || '')}</textarea>${mic('what_was_working')}</span></label>
      <label>What was your biggest struggle?<span class="talk-wrap"><textarea id="biggest_struggle" name="biggest_struggle" rows="2" placeholder="Be honest — that's what makes the read useful.">${esc(v.biggest_struggle || '')}</textarea>${mic('biggest_struggle')}</span></label>
      <script src="/checkin.js"></script>
      <button type="submit" class="btn-primary">${isEdit ? 'Save changes' : 'Submit check-in'}</button>
    </form></div>`,
  });
}

// Optional pre-hit check-in: set the intent BEFORE the session. Cage mode asks
// what he's working on and how; game mode asks approach, one goal, and what
// he's flushing. Never required — Skip reads today's intent when he checks in
// after and connects the session back to it.
function preCheckinPage(user, kind, error, v) {
  const k = kind === 'game' ? 'game' : kind === 'throwing' ? 'throwing' : kind === 'both' ? 'both' : 'cage';
  const isGame = k === 'game';
  const isThrowing = k === 'throwing';
  const isBoth = k === 'both';
  const mic = (id) => `<button type="button" class="mic-btn" data-target="${id}" aria-label="Dictate instead of typing">🎙</button>`;
  const intentPills = THROW_INTENTS
    .map(([val, label]) => `<label class="pill"><input type="radio" name="throw_intent" value="${val}"${v.throw_intent === val ? ' checked' : ''}><span>${label}</span></label>`)
    .join('');
  const throwingFields = `
      <div class="field-label">Throwing intent</div>
      <div class="pills">${intentPills}</div>
      <label>Throwing focus <span class="hint-inline">(one thing — command, a pitch, a feel)</span><span class="talk-wrap"><textarea id="pre_throw_focus" name="throw_focus" rows="2" placeholder="e.g. Landing the changeup arm-side, staying tall on the back leg">${esc(v.throw_focus || '')}</textarea>${mic('pre_throw_focus')}</span></label>`;
  const fields = isGame ? `
      <label>What's your approach today? <span class="hint-inline">(what are you hunting? what's the plan vs this guy?)</span><span class="talk-wrap"><textarea id="pre_focus" name="focus" rows="2" placeholder="e.g. Hunting the fastball early, spitting on the slider away">${esc(v.focus || '')}</textarea>${mic('pre_focus')}</span></label>
      <label>What's your ONE job today? <span class="hint-inline">(one goal — nothing else)</span><span class="talk-wrap"><textarea id="pre_plan" name="plan" rows="2" placeholder="e.g. See it up, be on time">${esc(v.plan || '')}</textarea>${mic('pre_plan')}</span></label>
      <label>What are you flushing before first pitch? <span class="hint-inline">(leave it in the parking lot)</span><span class="talk-wrap"><textarea id="pre_flush" name="flush" rows="2" placeholder="e.g. Yesterday's 0-for, the last cage session">${esc(v.flush || '')}</textarea>${mic('pre_flush')}</span></label>`
    : isThrowing ? throwingFields
    : isBoth ? `
      <div class="field-label">Hitting</div>
      <label>What are you working on at the plate?<span class="talk-wrap"><textarea id="pre_focus" name="focus" rows="2" placeholder="e.g. Staying inside the ball to right-center">${esc(v.focus || '')}</textarea>${mic('pre_focus')}</span></label>
      <label>How are you going to do it? <span class="hint-inline">(your plan)</span><span class="talk-wrap"><textarea id="pre_plan" name="plan" rows="2" placeholder="e.g. Fence drill off the tee, then front toss hunting inner half">${esc(v.plan || '')}</textarea>${mic('pre_plan')}</span></label>
      <div class="field-label">Throwing</div>
      ${throwingFields}`
    : `
      <label>What are you working on today?<span class="talk-wrap"><textarea id="pre_focus" name="focus" rows="2" placeholder="e.g. Staying inside the ball to right-center">${esc(v.focus || '')}</textarea>${mic('pre_focus')}</span></label>
      <label>How are you going to do it? <span class="hint-inline">(drills, pitch types, constraints — your plan)</span><span class="talk-wrap"><textarea id="pre_plan" name="plan" rows="3" placeholder="e.g. Fence drill off the tee, then front toss hunting inner half">${esc(v.plan || '')}</textarea>${mic('pre_plan')}</span></label>`;
  const title = isThrowing ? 'Pre-throw check-in' : isBoth ? 'Pre-session check-in' : 'Pre-hit check-in';
  const intro = isThrowing ? 'Two minutes before you throw. Set the intent — then go do it.'
    : isBoth ? 'Two minutes before the day. One intent for the plate, one for the mound.'
    : 'Two minutes before you hit. Set the intent — then go do it.';
  return layout({
    title,
    user,
    tabs: userTabs('home', user),
    body: `<h1 class="page-title">${title}</h1>
    <div class="card"><p class="hint skip-intro">${intro} <span class="hint-inline">Totally optional.</span></p>
    ${isGame || k === 'cage' ? `<div class="pill-row">
      <a class="pill-link${isGame ? '' : ' active'}" href="/precheckin?kind=cage">Cage</a>
      <a class="pill-link${isGame ? ' active' : ''}" href="/precheckin?kind=game">Pregame / Live ABs</a>
    </div>` : ''}
    <form method="post" action="/precheckin" class="form" data-validate="pre">
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
    <div class="card"><p class="hint skip-intro">Your everyday work. Set it once — then one tap loads it into your check-in.</p>
    ${error ? `<div class="error">${esc(error)}</div>` : ''}
    <form method="post" action="/routine/add" class="form routine-add">
      <label>Activity
        <input name="name" list="drill-list" placeholder="e.g. Fence drill" maxlength="80" required>
      </label>
      <datalist id="drill-list">${datalist}</datalist>
      <label>Done on
        <select name="station" required>
          <option value="" disabled selected>Pick one</option>
          ${stationOpts}
        </select>
      </label>
      <button type="submit" class="btn-primary">Add</button>
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

function notebookPage(user, checkins, notes, players, justSubmitted, filter) {
  const kindLabels = { hitting: 'Hitting', pitching: 'Throwing', combined: 'Both' };
  const f = filter || {};
  const activeKind = f.kind || 'all';
  const kindPills = (f.kinds && f.kinds.length > 1)
    ? `<div class="pill-row">${['all', ...f.kinds].map((k) => `<a class="pill-link${activeKind === k ? ' active' : ''}" href="/notebook${k === 'all' ? '' : `?kind=${k}`}">${k === 'all' ? 'All sessions' : kindLabels[k] || k}</a>`).join('')}</div>`
    : '';
  const kindName = activeKind !== 'all' ? (kindLabels[activeKind] || '') : '';
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
        <div class="edit-row">
          ${user.viewAs ? '' : `<a href="/learn/note/${n.id}/edit" class="btn-ghost btn-sm">Edit</a>`}
          <form method="post" action="/learn/note/${n.id}/delete" class="routine-remove">
            <button type="submit" class="btn-ghost btn-sm" aria-label="Delete note">Remove</button>
          </form>
        </div>
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
        <div class="edit-row">
          ${user.viewAs ? '' : `<a href="/learn/player/${p.id}/edit" class="btn-ghost btn-sm">Edit</a>`}
          <form method="post" action="/learn/player/${p.id}/delete" class="routine-remove">
            <button type="submit" class="btn-ghost btn-sm" aria-label="Delete player">Remove</button>
          </form>
        </div>
      </div>`
    )
    .join('');
  const scored = checkins.filter((c) => c.session_score != null);
  // Median, not mean — one off day can't drag the read (Bobby, Sep 17 2026).
  const med = medianOf(scored.map((c) => c.session_score));
  const avg = med != null ? Math.round(med * 10) / 10 : null;
  const checkinsHtml = `
    ${avg !== null ? `<div class="level-head"><p class="hint">Your read over ${scored.length} session${scored.length === 1 ? '' : 's'}:</p>${levelLine(avg)}</div>` : ''}
    ${checkins.length ? checkins.map((c) => checkinCard(c, { editable: !user.viewAs, restricted: user.viewAsRestricted })).join('') : `<div class="card empty">${kindName ? `No ${kindName.toLowerCase()} sessions logged yet.` : `No check-ins yet. <a href="/checkin">Log your first session</a>.`}</div>`}`;
  return layout({
    title: 'Notebook',
    user,
    tabs: userTabs('notebook', user),
    body: `<h1 class="page-title">Notebook</h1>
    <div class="subnav"><a href="#checkins">Check-ins</a><a href="#notes">Notes</a></div>
    ${justSubmitted ? `<div class="success">Check-in saved. Good work.</div>` : ''}
    <h2 class="section-head" id="checkins">Check-ins</h2>
    ${kindPills}
    ${checkinsHtml}
    <h2 class="section-head" id="notes">Notes</h2>
    <div class="card"><p class="hint skip-intro">Your notebook — jot down anything about your game, no check-in needed. Your notes get read too.</p>
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
    <div class="card"><p class="hint skip-intro">Players you study — your reads connect back to the guys you look up to.</p>
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
      ${playerRows || `<p class="hint">No players yet. Add the players you watch and learn from.</p>`}
    </div>`,
  });
}


const TIER_NOTES = {
  'Locked In': "That's the standard. Remember exactly what this felt like.",
  'Solid': 'Good day. Stack another one on top of it.',
  'Building': 'Not your sharpest — but you put the work in, and that stacks.',
  'Grind Day': 'Tough day. You showed up anyway, and that counts. Flush it and go again tomorrow.',
};

// Hitter self-serve check-in delete confirm (Bobby, Sep 17 2026).
function checkinDeletePage(user, c) {
  const kind = c.session_kind || 'hitting';
  const kindLabel = kind === 'pitching' ? 'throwing' : kind === 'combined' ? 'hitting + throwing' : 'hitting';
  const when = c.created_at ? String(c.created_at).slice(0, 10) : '';
  return layout({
    title: 'Delete check-in',
    user,
    tabs: userTabs('notebook', user),
    body: `<h1 class="page-title">Delete this check-in?</h1>
    <div class="card">
      <p>This permanently removes your <strong>${esc(when)}${c.environment ? ` · ${esc(c.environment)}` : ''}</strong> ${kindLabel} check-in.</p>
      <p class="hint">Your other entries, notes, and chats stay exactly as they are.</p>
      <form method="post" action="/checkin/${c.id}/delete" class="form">
        <button class="btn-primary" type="submit">Yes, delete it</button>
      </form>
      <p style="margin-top:10px"><a href="/notebook">Keep it \u2014 go back</a></p>
    </div>`,
  });
}

// Hitter self-serve learning-note edit (Bobby, Sep 17 2026).
function learnNoteEditPage(user, note, error) {
  const n = note || {};
  const catChips = LEARN_CATEGORIES.map(
    (c) => `<label class="chip-radio"><input type="radio" name="category" value="${c}"${(n.category || 'Mechanics') === c ? ' checked' : ''}><span>${c}</span></label>`
  ).join('');
  return layout({
    title: 'Edit note',
    user,
    tabs: userTabs('notebook', user),
    body: `<h1 class="page-title">Edit note</h1>
    <div class="card">
    <form method="post" action="/learn/note/${n.id}" class="form">
      ${error ? `<div class="error">${esc(error)}</div>` : ''}
      <label>Something new I'm learning
        <textarea name="note" rows="3" maxlength="1000" required>${esc(n.note || '')}</textarea>
      </label>
      <div class="chip-row">${catChips}</div>
      <button type="submit" class="btn-primary">Save changes</button>
    </form>
    <p style="margin-top:10px"><a href="/notebook">Cancel \u2014 go back</a></p>
    </div>`,
  });
}

// Hitter self-serve study-player edit (Bobby, Sep 17 2026).
function studyPlayerEditPage(user, player, error) {
  const pl = player || {};
  return layout({
    title: 'Edit player',
    user,
    tabs: userTabs('notebook', user),
    body: `<h1 class="page-title">Edit player</h1>
    <div class="card">
    <form method="post" action="/learn/player/${pl.id}" class="form">
      ${error ? `<div class="error">${esc(error)}</div>` : ''}
      <label>Player
        <input name="player_name" maxlength="80" value="${esc(pl.player_name || '')}" required>
      </label>
      <label>What I'm stealing from them
        <input name="takeaway" maxlength="300" value="${esc(pl.takeaway || '')}">
      </label>
      <button type="submit" class="btn-primary">Save changes</button>
    </form>
    <p style="margin-top:10px"><a href="/notebook">Cancel \u2014 go back</a></p>
    </div>`,
  });
}

function tierBadgeClass(tier) {
  if (tier === 'Locked In') return 'ok';
  if (tier === 'Solid') return 'ok';
  if (tier === 'Building') return 'warn';
  return 'bad';
}

// Session levels — color-coded, no numeric scores shown to hitters.
// The fuller the bar, the better the session. Bright green = best.
const LEVEL_COLORS = { 'Grind Day': '#ff5252', 'Building': '#ffd54f', 'Solid': '#66bb6a', 'Locked In': '#00e676' };
function tierFor(score) {
  if (score >= 9.0) return 'Locked In';
  if (score >= 7.0) return 'Solid';
  if (score >= 5.0) return 'Building';
  return 'Grind Day';
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
  const isPitching = c.session_kind === 'pitching';
  const isCombined = c.session_kind === 'combined';
  const throwBits = [];
  if (isPitching || isCombined) {
    if (c.pitch_session_type) throwBits.push(['Session', pitchSessionTypeLabel(c.pitch_session_type)]);
    if (c.intent) throwBits.push(['Intent', throwIntentLabel(c.intent)]);
    if (c.command != null) throwBits.push(['Command', c.command]);
    if (c.pitch_count != null) throwBits.push(['Pitch count', c.pitch_count]);
    if (c.velo_max != null) throwBits.push(['Top velo', c.velo_max]);
    if (c.catch_distance) throwBits.push(['Distance', c.catch_distance]);
    let pitchNames = [];
    try { const pp = JSON.parse(c.pitches_thrown || '[]'); if (Array.isArray(pp)) pitchNames = pp; } catch (e) {}
    if (pitchNames.length) throwBits.push(['Pitches', pitchNames.join(', ')]);
  }
  return layout({
    title: "Session Level",
    user,
    tabs: userTabs('checkin', user),
    body: `<div class="card score-hero">
      <div class="score-kicker">Session Level</div>
      <div class="level-hero-meter">${levelBar(c.session_score, c.score_tier, true)}</div>
      <div><span class="badge ${tierBadgeClass(c.score_tier)} badge-lg">${esc(c.score_tier)}</span></div>
      <p class="hint skip-note">${esc(TIER_NOTES[c.score_tier] || '')}</p>
      ${user.viewAsRestricted ? '' : `<div class="score-breakdown">
        <div><span class="label">Feel</span><strong>${esc(c.feel)}</strong></div>
        <div><span class="label">Confidence</span><strong>${esc(c.confidence)}</strong></div>
        <div><span class="label">Focus</span><strong>${esc(c.focus)}</strong></div>
        ${c.difficulty != null ? `<div><span class="label">Difficulty</span><strong>${esc(c.difficulty)}</strong></div>` : ''}
        ${throwBits.map(([l, val]) => `<div><span class="label">${esc(l)}</span><strong>${esc(val)}</strong></div>`).join('')}
      </div>`}
      ${isCombined && c.hitting_score != null && c.pitching_score != null ? `<p class="hint">Hitting ${esc(c.hitting_score)} · Throwing ${esc(c.pitching_score)}</p>` : ''}
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
  // Normalizes drills_done to [{name, station|null, known}]; handles legacy
  // rows stored as plain name strings. Summaries ("did some tee stuff")
  // are flagged known:false so they're never shown as drill chips.
  try {
    const arr = JSON.parse(c.drills_done || '[]');
    if (!Array.isArray(arr)) return [];
    return arr
      .map((d) => {
        const name = d && typeof d === 'object' ? String(d.name || '') : String(d || '');
        const station = d && typeof d === 'object' ? d.station || null : null;
        const known = d && typeof d === 'object' && d.known === false ? false
          : d && typeof d === 'object' && d.known === true ? true
          : viewKnownDrill(name);
        return { name, station, known };
      })
      .filter((d) => d.name);
  } catch (e) {
    return [];
  }
}

// Same known-drill judgment as the server (kept local — views can't import
// server). Summaries are never rendered as drill chips.
let _viewKnownDrills = null;
function viewKnownDrill(name) {
  if (!_viewKnownDrills) {
    try {
      const data = require('./data');
      const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
      _viewKnownDrills = new Set(data.drillNames().map(norm).filter(Boolean));
    } catch (e) {
      _viewKnownDrills = new Set();
    }
  }
  const n = String(name || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!n) return false;
  if (!_viewKnownDrills.size) return true;
  if (_viewKnownDrills.has(n)) return true;
  if (n.length >= 4) {
    for (const k of _viewKnownDrills) {
      if (k.length >= 4 && (n.startsWith(k) || k.startsWith(n))) return true;
    }
  }
  return false;
}

function drillChip(d) {
  return `<span class="chip">${esc(d.name)}${d.station ? ` <span class="chip-station">${esc(d.station)}</span>` : ''}</span>`;
}

// Skip's journal rating: posted by the assistant after reading the hitter's
// journal text. Shown once rated; a subtle placeholder before that.
function skipReadBlock(c) {
  if (c.skip_journal_note) {
    return `<div class="skip-read">
      <div class="skip-read-head">Your read</div>
      <p>${esc(c.skip_journal_note)}</p>
    </div>`;
  }
  return `<p class="skip-pending">Reviewing your entry — your read lands here.</p>`;
}

// Median of session scores — the typical day. A single off day can't drag
// it the way a mean lets it (Bobby, Sep 17 2026).
function medianOf(xs) {
  const s = xs.filter((v) => v != null).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function checkinCard(c, opts) {
  // Hitter self-serve edit/delete (Bobby, Sep 17 2026): shown only on the
  // hitter's own notebook — never on coach views. Server re-checks ownership.
  const editActions = opts && opts.editable && c.id
    ? `<div class="checkin-actions"><a href="/checkin/${c.id}/edit">Edit</a><a href="/checkin/${c.id}/delete" class="danger-link">Delete</a></div>`
    : '';
  // College-org privacy (Bobby, Sep 17 2026): coaches of programs that aren't
  // Bobby's own see the brief summary — what the player did, Skip's read —
  // not the player's own words or feel-slider numbers.
  const restricted = !!(opts && opts.restricted) || !!c.coachRestricted;
  const drills = drillsOf(c);
  const realDrills = drills.filter((d) => d.known);
  const otherWork = drills.filter((d) => !d.known);
  const kind = c.session_kind || 'hitting';
  const kindBadge = kind === 'pitching'
    ? `<span class="badge env">Throwing</span>`
    : kind === 'combined'
      ? `<span class="badge env">Hitting + Throwing</span>`
      : '';
  const head = `<div class="checkin-head">
      <span class="checkin-date">${fmtDate(c.created_at)}</span>
      ${c.environment ? `<span class="badge env">${esc(c.environment)}</span>` : ''}
      ${kindBadge}
    </div>
    ${c.athlete_name && c.showAthlete ? `<div class="checkin-athlete">${c.athlete_email ? athleteLink(c.athlete_email, esc(c.athlete_name)) : esc(c.athlete_name)}</div>` : ''}`;
  const throwBits = [];
  if (kind !== 'hitting') {
    if (c.pitch_session_type) throwBits.push(pitchSessionTypeLabel(c.pitch_session_type));
    if (c.intent) throwBits.push(throwIntentLabel(c.intent));
    if (c.pitch_count != null) throwBits.push(`${c.pitch_count} pitches`);
    if (c.velo_max != null) throwBits.push(`top ${c.velo_max}`);
    if (c.catch_distance) throwBits.push(esc(c.catch_distance));
  }
  let pitchesThrown = [];
  try { pitchesThrown = JSON.parse(c.pitches_thrown || '[]'); } catch (e) {}
  const score = `${c.session_score != null ? `<div class="checkin-score">
      ${levelLine(c.session_score, c.score_tier)}
      ${restricted ? '' : `<span class="hint-inline">Feel ${esc(c.feel)} · Conf ${esc(c.confidence)} · Focus ${esc(c.focus)}${c.difficulty != null ? ` · Difficulty ${esc(c.difficulty)}` : ''}${c.command != null ? ` · Command ${esc(c.command)}` : ''}</span>`}
      ${throwBits.length ? `<div class="hint-inline">${throwBits.join(' · ')}</div>` : ''}
      ${pitchesThrown.length ? `<div class="drill-chips">${pitchesThrown.map((p) => `<span class="chip">${esc(p)}</span>`).join('')}</div>` : ''}
    </div>` : ''}`;
  const drillRow = `${realDrills.length ? `<div class="drill-chips">${realDrills.map(drillChip).join('')}</div>` : ''}${otherWork.length ? `<p class="hint" style="margin:6px 0 0">Also mentioned: ${esc(otherWork.map((d) => d.name).join(', '))}</p>` : ''}`;
  const read = `${skipReadBlock(c)}`;
  const notes = `${c.session_notes ? `<p>${esc(c.session_notes)}</p>` : ''}`;
  const reflections = [
    c.felt_good ? `<div><span class="label">What felt good</span>${esc(c.felt_good)}</div>` : '',
    c.what_was_working ? `<div><span class="label">What was working</span>${esc(c.what_was_working)}</div>` : '',
    c.biggest_struggle ? `<div><span class="label">Biggest struggle</span>${esc(c.biggest_struggle)}</div>` : '',
    c.recovery_notes ? `<div><span class="label">Recovery work</span>${esc(c.recovery_notes)}</div>` : '',
    c.no_throw_note ? `<div><span class="label">Got better by</span>${esc(c.no_throw_note)}</div>` : '',
    c.what_worked ? `<div><span class="label">What worked</span>${esc(c.what_worked)}</div>` : '',
  ].filter(Boolean).join('');
  const words = `${notes}${reflections ? `<div class="checkin-grid">${reflections}</div>` : ''}`;
  return `<div class="card checkin">
    ${head}
    ${score}
    ${drillRow}
    ${read}
    ${restricted ? '' : `<details class="checkin-more"><summary>Full entry</summary>${words || `<p class="hint">No notes written for this session.</p>`}</details>`}
    ${editActions}
  </div>`;
}

function chatPage(user, messages, chatEnabled) {
  const img = skipAvatar(user);
  const isPitcher = (user && (user.playerType || user.player_type)) === 'pitcher';
  const skipImg = `<img src="${img}" class="skip-avatar" alt="Skip">`;
  const msgs = (messages || [])
    .map(
      (m) => `<div class="msg ${m.role === 'user' ? 'msg-user' : 'msg-skip'}">${m.role === 'user' ? '' : skipImg}<div class="msg-bubble">${esc(m.content)}</div></div>`
    )
    .join('');
  return layout({
    title: 'Coach Skip',
    user,
    tabs: userTabs('chat', user),
    body: `<h1 class="page-title chat-title">${skipImg}Coach Skip</h1>
    <p class="hint">Struggling? Tell Skip what\u2019s going on \u2014 he\u2019s seen your sessions and will point you back on track.</p>
    ${chatEnabled
      ? `<div id="text-panel">
        <div id="chat-log" class="chat-log" data-skip-avatar="${img}">${msgs || `<div class="msg msg-skip">${skipImg}<div class="msg-bubble">${isPitcher ? "What\u2019s going on with your throwing? Tell me what feels off." : "What\u2019s going on at the plate? Tell me what feels off."}</div></div>`}</div>
        <form id="chat-form" class="chat-form" autocomplete="off">
          <input id="chat-input" type="text" placeholder="Ask Skip…" maxlength="2000" required>
          <button type="submit" class="btn-primary">Send</button>
        </form>
      </div>`
      : `<div class="card empty">Skip's chat isn't switched on yet — check back soon.</div>`}`,
  });
}

function pendingApprovalCards(pending, canEdit) {
  return (pending || [])
    .map(
      (p) => `<div class="card athlete-card">
        <div class="athlete-card-name">${athleteLink(p.email, esc(p.name))}</div>
        <div class="athlete-card-email">${esc(p.email)}</div>
        <div class="athlete-card-meta">signed up ${fmtDate(p.created_at)}${p.organization_name ? ` · ${esc(p.organization_name)}` : ''}${p.team_name ? ` · ${esc(p.team_name)}` : ''}</div>
        ${canEdit
          ? `<div style="display:flex;gap:8px;margin-top:10px">
          <form method="post" action="/coach/approve/${p.id}" style="flex:1;margin:0">
            <button type="submit" class="btn-primary" style="width:100%">Approve</button>
          </form>
          <form method="post" action="/coach/decline/${p.id}" style="flex:1;margin:0">
            <button type="submit" style="width:100%;padding:14px;border-radius:12px;border:1px solid #5a5a5a;background:transparent;color:#b0b0b0;font-size:16px;cursor:pointer">Decline</button>
          </form>
        </div>`
          : `<div class="hint-inline" style="margin-top:10px">Waiting for approval.</div>`}
      </div>`
    )
    .join('');
}

function coachApprovalsPage(user, pending, waitingOnParent) {
  const n = (pending || []).length;
  const canEdit = user.role === 'coach' && user.canEdit !== false;
  return layout({
    title: 'Approvals',
    user,
    tabs: coachTabs('approvals', user.approvalCount, user),
    body: `<h1 class="page-title">Approvals</h1>
    <p class="hint">${canEdit ? 'Every new account waits here until you approve it. Approved players can log in right away.' : 'Every new account waits here until it gets approved.'}</p>
    ${waitingOnParent > 0 ? `<p class="hint">${waitingOnParent} under-13 signup${waitingOnParent === 1 ? '' : 's'} waiting on a parent or guardian to approve \u2014 ${waitingOnParent === 1 ? 'it shows' : 'they show'} up here after that.</p>` : ''}
    ${n ? `<div class="athlete-grid">${pendingApprovalCards(pending, canEdit)}</div>` : `<div class="card empty">Nobody waiting — you're all caught up.</div>`}`,
  });
}

// Coach Finances page (Bobby only, Sep 16 2026): everything worth knowing
// about money — collected, outstanding, pipeline, renewals, per-org deals,
// payment history, and individual subscriptions.
const DEAL_STATUSES = [
  ['', 'No status'],
  ['prospect', 'Prospect'],
  ['pilot', 'Pilot'],
  ['active', 'Active'],
  ['past', 'Past'],
];
function dealBadge(status) {
  if (status === 'active') return '<span class="badge ok">Active</span>';
  if (status === 'pilot') return '<span class="badge warn">Pilot</span>';
  if (status === 'prospect') return '<span class="badge">Prospect</span>';
  if (status === 'past') return '<span class="badge quiet">Past</span>';
  return '<span class="hint-inline">no status</span>';
}
function financeOrgCard(o) {
  const balance = Math.max((o.deal_cents || 0) - (o.paid_cents || 0), 0);
  const statusOpts = DEAL_STATUSES.map(([v, l]) => `<option value="${v}"${o.deal_status === v ? ' selected' : ''}>${l}</option>`).join('');
  return `<div class="card fin-org">
    <div class="fin-org-head">
      <div><strong>${esc(o.name)}</strong> ${dealBadge(o.deal_status)}
        <div class="hint-inline">${o.players} player${o.players === 1 ? '' : 's'}${o.deal_renewal ? ` · renews ${esc(o.deal_renewal)}` : ''}</div>
      </div>
      <div class="fin-nums">
        <div><span class="hint-inline">Deal</span><br><strong>${fmtMoney(o.deal_cents)}</strong></div>
        <div><span class="hint-inline">Paid</span><br><strong>${fmtMoney(o.paid_cents)}</strong></div>
        <div><span class="hint-inline">Owed</span><br><strong class="${balance > 0 ? 'fin-owed' : ''}">${fmtMoney(balance)}</strong></div>
      </div>
    </div>
    ${o.deal_notes ? `<div class="hint" style="margin:6px 0">${esc(o.deal_notes)}</div>` : ''}
    <div class="fin-forms">
      <details><summary class="hint" style="cursor:pointer">Record a payment</summary>
        <form method="post" action="/coach/organizations/${o.id}/payment" class="deal-form" style="margin-top:8px">
          <label>Amount $<input name="amount" inputmode="decimal" placeholder="1500" required style="width:90px"></label>
          <label>Date<input type="date" name="paid_at"></label>
          <label>Method<input name="method" placeholder="Zelle / check" maxlength="40" style="width:110px"></label>
          <label>Note<input name="note" placeholder="spring semester" maxlength="200" style="width:140px"></label>
          <button class="btn-small" type="submit">Record</button>
        </form>
      </details>
      <details><summary class="hint" style="cursor:pointer">Edit deal terms</summary>
        <form method="post" action="/coach/organizations/${o.id}/deal" class="deal-form" style="margin-top:8px">
          <label>Deal $<input name="deal" inputmode="decimal" style="width:90px" value="${o.deal_cents ? o.deal_cents / 100 : ''}"></label>
          <label>Collected $<input name="paid" inputmode="decimal" style="width:90px" value="${o.paid_cents ? o.paid_cents / 100 : ''}"></label>
          <label>Status<select name="status">${statusOpts}</select></label>
          <label>Start<input type="date" name="start" value="${esc(o.deal_start || '')}"></label>
          <label>Renews<input type="date" name="renewal" value="${esc(o.deal_renewal || '')}"></label>
          <label>Notes<input name="notes" maxlength="500" style="width:160px" value="${esc(o.deal_notes || '')}"></label>
          <button class="btn-small" type="submit">Save</button>
        </form>
      </details>
    </div>
  </div>`;
}
function coachFinancesPage(user, fin) {
  const maxMonth = Math.max(1, ...fin.monthly.map((m) => m.cents));
  const bars = fin.monthly.map((m) => {
    const h = Math.round((m.cents / maxMonth) * 90);
    return `<div class="fin-bar-col"><div class="fin-bar" style="height:${h}px" title="${fmtMoney(m.cents)}"></div>
      <div class="hint-inline">${m.label}</div><div class="hint-inline">${m.cents ? fmtMoney(m.cents).replace('.00', '') : ''}</div></div>`;
  }).join('');
  const renewals = fin.renewalsDue.length
    ? `<div class="card fin-renew"><strong>Renewals due soon</strong>${fin.renewalsDue.map((o) => {
        const balance = Math.max((o.deal_cents || 0) - (o.paid_cents || 0), 0);
        return `<div class="org-row"><div><strong>${esc(o.name)}</strong><div class="hint-inline">renews ${esc(o.deal_renewal)}</div></div>
          <div class="org-money">${balance ? `<span class="badge warn">${fmtMoney(balance)} owed</span>` : '<span class="badge ok">paid up</span>'}</div></div>`;
      }).join('')}</div>`
    : '';
  const payments = fin.payments.length
    ? `<div class="card"><div class="fin-table">${fin.payments.map((p) => `<div class="fin-trow">
        <div>${esc(p.paid_at || '')}</div><div><strong>${esc(p.org_name)}</strong>${p.note ? ` <span class="hint-inline">${esc(p.note)}</span>` : ''}</div>
        <div>${esc(p.method || '')}</div><div class="fin-amt">${fmtMoney(p.amount_cents)}</div></div>`).join('')}</div></div>`
    : '<div class="card empty">No payments recorded yet — record the first one on an organization above.</div>';
  const subs = fin.subs.length
    ? `<div class="card"><div class="fin-table">${fin.subs.map((s) => `<div class="fin-trow">
        <div><strong>${athleteLink(s.email, esc(s.athlete_name || s.email))}</strong></div><div>${esc(s.plan)}</div>
        <div class="hint-inline">renews ${esc(s.current_period_end || '—')}</div></div>`).join('')}</div></div>`
    : '<div class="card empty">No individual subscriptions yet — billing hasn\u2019t launched.</div>';
  return layout({
    title: 'Finances',
    user,
    tabs: coachTabs('finances', user.approvalCount, user),
    body: `<h1 class="page-title">Finances</h1>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-num">${fmtMoney(fin.collected)}</div><div class="stat-label">Collected · all time</div></div>
      <div class="stat-card"><div class="stat-num">${fmtMoney(fin.outstanding)}</div><div class="stat-label">Outstanding</div></div>
      <div class="stat-card"><div class="stat-num">${fmtMoney(fin.pipeline)}</div><div class="stat-label">Pipeline · prospects</div></div>
      <div class="stat-card"><div class="stat-num">${fmtMoney(fin.mrr)}<span class="hint-inline">/mo</span></div><div class="stat-label">Subscriptions MRR</div></div>
      <div class="stat-card"><div class="stat-num">${fin.activeDeals}</div><div class="stat-label">Active deals</div></div>
      <div class="stat-card"><div class="stat-num">${fin.renewalsDue.length}</div><div class="stat-label">Renewals · 60d</div></div>
    </div>
    ${renewals}
    <h2 class="section-head">Collected per month</h2>
    <div class="card fin-bars">${bars}</div>
    <h2 class="section-head">Deals by organization</h2>
    ${fin.orgs.map(financeOrgCard).join('') || '<div class="card empty">No organizations yet.</div>'}
    <h2 class="section-head">Payment history</h2>
    ${payments}
    <h2 class="section-head">Individual subscriptions</h2>
    ${subs}`,
  });
}

// Coach Organizations tab (Bobby only): add a organization, hand out its signup code,
// flip Talk to Skip per organization, and manage that organization's coach accounts.
// Confirm page before Bobby deletes a organization: players go standalone,
// the organization's coach accounts are removed.
function coachOrganizationDeletePage(user, organization, playerCount, coachCount, teamCount) {
  return layout({
    title: 'Delete organization',
    user,
    tabs: coachTabs('organizations', user.approvalCount, user),
    body: `<h1 class="page-title">Delete ${esc(organization.name)}?</h1>
    <div class="card">
      <p>This permanently removes <strong>${esc(organization.name)}</strong> (signup code ${esc(organization.code)}).</p>
      <ul>
        <li>${playerCount} player${playerCount === 1 ? '' : 's'} ${playerCount === 1 ? 'becomes' : 'become'} standalone \u2014 accounts and check-ins stay, just with no organization attached.</li>
        <li>${teamCount} team${teamCount === 1 ? '' : 's'} will be removed.</li>
        <li>${coachCount} coach account${coachCount === 1 ? '' : 's'} will be removed.</li>
      </ul>
      <form method="post" action="/coach/organizations/${organization.id}/delete" class="form">
        <button class="btn-danger" type="submit">Yes, delete ${esc(organization.name)}</button>
      </form>
      <p style="margin-top:10px"><a href="/coach/organizations">Keep it \u2014 go back</a></p>
    </div>`,
  });
}

function coachTeamDeletePage(user, organization, team, playerCount, coachCount) {
  return layout({
    title: 'Delete team',
    user,
    tabs: coachTabs('organizations', user.approvalCount, user),
    body: `<h1 class="page-title">Delete ${esc(team.name)}?</h1>
    <div class="card">
      <p>This removes the team <strong>${esc(team.name)}</strong> from ${esc(organization.name)} (signup code ${esc(team.code)}).</p>
      <ul>
        <li>${playerCount} player${playerCount === 1 ? '' : 's'} stay${playerCount === 1 ? 's' : ''} in the program \u2014 accounts and check-ins stay, just no longer on this team.</li>
        <li>${coachCount} coach account${coachCount === 1 ? '' : 's'} on this team will be removed.</li>
      </ul>
      <form method="post" action="/coach/organizations/${organization.id}/teams/${team.id}/delete" class="form">
        <button class="btn-danger" type="submit">Yes, delete ${esc(team.name)}</button>
      </form>
      <p style="margin-top:10px"><a href="/coach/organizations">Keep it \u2014 go back</a></p>
    </div>`,
  });
}

function coachOrganizationsPage(user, organizations, error, addedId) {
  // Bobby (full global coach): everything. The program's own organization-level
  // coaches: run their teams and coaches. Everyone else (Cam, team coaches):
  // read-only.
  const isBobby = user.role === 'coach' && user.canEdit !== false && !user.organizationId;
  const managesTeams = isBobby || (user.role === 'coach' && user.organizationId && !user.teamId);
  const teamCard = (c, t) => {
    const coachRows = (t.coaches || [])
      .map((ch) => {
        const name = [ch.first_name, ch.last_name].filter(Boolean).join(' ') || ch.email;
        return `<div class="remote-row"><div><strong>${esc(name)}</strong><div class="hint-inline">${esc(ch.email)}</div></div>
          ${managesTeams ? `<form method="post" action="/coach/organizations/${c.id}/teams/${t.id}/coaches/remove" class="inline-form" style="margin:0">
            <input type="hidden" name="coach_id" value="${ch.id}">
            <button class="btn-small btn-quiet" type="submit">Remove</button>
          </form>` : ''}</div>`;
      })
      .join('');
    return `<div class="card" style="margin-top:10px">
      <div style="display:flex;justify-content:space-between;align-items:start;gap:12px;flex-wrap:wrap">
        <div>
          <div class="athlete-card-name">${esc(t.name)}</div>
          <div class="athlete-card-meta">team code: <strong style="font-size:16px;letter-spacing:1px">${esc(t.code)}</strong> \u00b7 ${t.playerCount} player${t.playerCount === 1 ? '' : 's'}</div>
        </div>
        ${managesTeams ? `<a class="btn-small btn-quiet" href="/coach/organizations/${c.id}/teams/${t.id}/delete" style="text-decoration:none">Delete team</a>` : ''}
      </div>
      <h4 class="section-head" style="margin-top:10px">Team coaches</h4>
      ${coachRows || `<p class="hint">No coaches on this team yet \u2014 they\u2019ll see only ${esc(t.name)}\u2019s players.</p>`}
      ${managesTeams ? `<details style="margin-top:10px">
        <summary class="hint" style="cursor:pointer">Add a team coach</summary>
        <form method="post" action="/coach/organizations/${c.id}/teams/${t.id}/coaches/add" class="form" style="margin-top:10px">
          <label>First name<input name="first_name" required maxlength="40"></label>
          <label>Last name<input name="last_name" required maxlength="40"></label>
          <label>Email<input type="email" name="email" required></label>
          <label>Password <span class="hint-inline">(8+ characters)</span><input type="password" name="password" required minlength="8"></label>
          <button class="btn-primary" type="submit">Create team coach</button>
        </form>
      </details>` : ''}
    </div>`;
  };
  const cards = (organizations || [])
    .map((c) => {
      const coachRows = (c.coaches || [])
        .map((ch) => {
          const name = [ch.first_name, ch.last_name].filter(Boolean).join(' ') || ch.email;
          return `<div class="remote-row"><div><strong>${esc(name)}</strong><div class="hint-inline">${esc(ch.email)}</div></div>
            ${managesTeams ? `<form method="post" action="/coach/organizations/${c.id}/coaches/remove" class="inline-form" style="margin:0">
              <input type="hidden" name="coach_id" value="${ch.id}">
              <button class="btn-small btn-quiet" type="submit">Remove</button>
            </form>` : ''}</div>`;
        })
        .join('');
      const added = String(addedId) === String(c.id)
        ? `<div class="notice">Organization added. Hand this code to their coaches: <strong>${esc(c.code)}</strong></div>`
        : '';
      const teamCards = (c.teams || []).map((t) => teamCard(c, t)).join('');
      // Roster dropdown on every org card: collapsed by default, compact with
      // internal scroll, players grouped by team when the org has teams.
      // Founder org keeps its per-player "Edit program" link (Bobby only).
      const rosterRow = (pl) => {
        const name = [pl.first_name, pl.last_name].filter(Boolean).join(' ') || pl.athlete_name || pl.email;
        const editLink =
          c.isFounder && isBobby && pl.remote_program_id
            ? `<a class="btn btn-sm" href="/coach/program/${pl.remote_program_id}/edit" style="text-decoration:none">Edit program</a>`
            : '';
        return `<div class="remote-row" style="padding:5px 0"><div><strong>${athleteLink(pl.email, esc(name))}</strong></div><div class="remote-actions">${editLink}</div></div>`;
      };
      const rosterDropdown = (() => {
        const roster = c.roster || [];
        if (!roster.length) return '';
        const teams = c.teams || [];
        let body;
        if (teams.length) {
          const groups = teams
            .map((t) => {
              const members = roster.filter((p) => p.team_id === t.id);
              if (!members.length) return '';
              return `<div class="hint" style="margin:8px 0 2px;font-weight:600">${esc(t.name)}</div>${members.map(rosterRow).join('')}`;
            })
            .join('');
          const unteamed = roster.filter((p) => !p.team_id);
          const unteamedHtml = unteamed.length
            ? `<div class="hint" style="margin:8px 0 2px;font-weight:600">No team</div>${unteamed.map(rosterRow).join('')}`
            : '';
          body = groups + unteamedHtml;
        } else {
          body = roster.map(rosterRow).join('');
        }
        return `<details style="margin-top:10px">
          <summary class="hint" style="cursor:pointer">Roster (${roster.length}) &mdash; tap to expand</summary>
          <div style="max-height:230px;overflow-y:auto;margin-top:6px;padding:2px 12px;border:1px solid var(--line);border-radius:10px">${body}</div>
        </details>`;
      })();
      return `<div class="card">
        ${added}
        <div style="display:flex;justify-content:space-between;align-items:start;gap:12px;flex-wrap:wrap">
          <div>
            <div class="athlete-card-name">${esc(c.name)}</div>
            <div class="athlete-card-meta">signup code: <strong style="font-size:18px;letter-spacing:1px">${esc(c.code)}</strong> \u00b7 ${c.playerCount} player${c.playerCount === 1 ? '' : 's'}</div>
            <div class="hint-inline" style="margin-top:4px">Deal: <strong>${fmtMoney(c.deal_cents)}</strong> \u00b7 Collected: <strong>${fmtMoney(c.paid_cents)}</strong></div>
            ${isBobby ? `<form method="post" action="/coach/organizations/${c.id}/mine" style="margin-top:6px;display:flex;align-items:center;gap:8px">
              <span class="hint-inline">My program: <strong>${c.is_mine ? 'ON' : 'OFF'}</strong></span>
              <button class="btn-small${c.is_mine ? '' : ' btn-quiet'}" type="submit">${c.is_mine ? 'Unmark' : 'Mark'}</button>
            </form>` : ''}
            ${isBobby ? `<details style="margin-top:6px">
              <summary class="hint" style="cursor:pointer">Set deal / collected</summary>
              <form method="post" action="/coach/organizations/${c.id}/deal" class="deal-form" style="margin-top:8px">
                <label>Deal $<input name="deal" inputmode="decimal" placeholder="1500" value="${c.deal_cents ? (c.deal_cents / 100) : ''}" style="width:90px"></label>
                <label>Collected $<input name="paid" inputmode="decimal" placeholder="0" value="${c.paid_cents ? (c.paid_cents / 100) : ''}" style="width:90px"></label>
                <button class="btn-small" type="submit">Save</button>
              </form>
            </details>` : ''}
            ${managesTeams ? (() => {
              // Organization branding (Sep 17 2026): logo + colors the org's
              // players see. Colors were hex-validated on save; re-check here
              // before injecting into style attributes.
              const hx = (s) => (/^#[0-9a-fA-F]{6}$/.test(String(s || '')) ? String(s) : null);
              const primary = hx(c.primary_color) || '#e10600';
              const accent = hx(c.accent_color) || '#a80400';
              const logoImg = c.logo_path
                ? `<img src="/org-logos/${esc(c.logo_path)}" alt="" style="height:40px;object-fit:contain">`
                : `<span class="hint-inline">No logo yet</span>`;
              const preview = `<div style="background:#000;border-bottom:3px solid ${accent};border-radius:10px;padding:10px 12px;display:flex;align-items:center;gap:10px">
                  ${c.logo_path ? `<img src="/org-logos/${esc(c.logo_path)}" alt="" style="width:34px;height:34px;object-fit:contain">` : ''}
                  <span style="font-weight:800;letter-spacing:1px;font-size:13px;color:#fff">${esc(c.name)}</span>
                  <span style="font-size:8px;opacity:.5;letter-spacing:1px;color:#fff;font-weight:700">POWERED BY DIAMOND DAILY</span>
                </div>
                <div style="display:flex;gap:14px;align-items:center;margin-top:10px">
                  <span style="background:${primary};color:#fff;font-size:12px;font-weight:700;padding:8px 16px;border-radius:8px">Check In</span>
                  <span style="color:${primary};font-size:12px;font-weight:700">View notebook</span>
                </div>
                <p class="hint" style="margin:8px 0 0">Player preview &mdash; this is what ${esc(c.name)}&rsquo;s players see.</p>`;
              return `<details style="margin-top:6px">
                <summary class="hint" style="cursor:pointer">Branding &mdash; logo &amp; colors</summary>
                <div style="margin-top:8px">${preview}</div>
                <form method="post" action="/coach/organizations/${c.id}/brand" enctype="multipart/form-data" class="form" style="margin-top:10px">
                  <div style="margin-bottom:8px">${logoImg}</div>
                  <label>Logo <span class="hint-inline">(PNG, JPG, WebP, or GIF &mdash; 2MB max)</span><input type="file" name="logo" accept="image/png,image/jpeg,image/webp,image/gif"></label>
                  <div style="display:flex;gap:12px">
                    <label>Primary color<input type="color" name="primary_color" value="${primary}" style="width:60px;height:36px;padding:2px"></label>
                    <label>Accent color<input type="color" name="accent_color" value="${accent}" style="width:60px;height:36px;padding:2px"></label>
                  </div>
                  <button class="btn-primary" type="submit">Save branding</button>
                </form>
                ${c.logo_path ? `<form method="post" action="/coach/organizations/${c.id}/brand/logo/remove" style="margin-top:8px">
                  <button class="btn-small btn-quiet" type="submit">Remove logo</button>
                </form>` : ''}
              </details>`;
            })() : ''}
          </div>
          ${isBobby ? `<div style="display:flex;gap:8px;align-items:center">
          <form method="post" action="/coach/organizations/${c.id}/skip" style="margin:0">
            <button class="btn-small${c.skip_enabled ? '' : ' btn-quiet'}" type="submit">Talk to Skip: ${c.skip_enabled ? 'ON' : 'OFF'}</button>
          </form>
          <a class="btn-small btn-quiet" href="/coach/organizations/${c.id}/delete" style="text-decoration:none;display:inline-block">Delete</a>
          </div>` : ''}
        </div>
        ${rosterDropdown}
        <h3 class="section-head" style="margin-top:14px">Program coaches</h3>
        ${coachRows || '<p class="hint">No program coaches yet \u2014 they see every team in the program.</p>'}
        ${managesTeams ? `<details style="margin-top:10px">
          <summary class="hint" style="cursor:pointer">Add a program coach</summary>
          <form method="post" action="/coach/organizations/${c.id}/coaches/add" class="form" style="margin-top:10px">
            <label>First name<input name="first_name" required maxlength="40"></label>
            <label>Last name<input name="last_name" required maxlength="40"></label>
            <label>Email<input type="email" name="email" required></label>
            <label>Password <span class="hint-inline">(8+ characters)</span><input type="password" name="password" required minlength="8"></label>
            <button class="btn-primary" type="submit">Create coach account</button>
          </form>
        </details>` : ''}
        <h3 class="section-head" style="margin-top:16px">Teams</h3>
        ${teamCards || '<p class="hint">No teams yet \u2014 add one and each team gets its own signup code and coaches.</p>'}
        ${managesTeams ? `<details style="margin-top:10px">
          <summary class="hint" style="cursor:pointer">Add a team</summary>
          <form method="post" action="/coach/organizations/${c.id}/teams/add" class="form" style="margin-top:10px">
            <label>Team name<input name="name" required maxlength="60" placeholder="e.g. 14U Black"></label>
            <button class="btn-primary" type="submit">Add team</button>
          </form>
        </details>` : ''}
      </div>`;
    })
    .join('');
  return layout({
    title: 'Organizations',
    user,
    tabs: coachTabs('organizations', user.approvalCount, user),
    body: `<h1 class="page-title">Organizations</h1>
    <p class="hint">Add a program, give its coaches the signup code, and their players sign up under it. Coaches log in and see only their organization\u2019s players \u2014 view-only, like Cam. Travel programs can split into teams: each team gets its own code and coaches who see only that team.</p>
    ${error ? `<div class="error">${esc(error)}</div>` : ''}
    ${isBobby ? `<div class="card">
      <h2 class="section-head">Add a organization</h2>
      <form method="post" action="/coach/organizations/add" class="form">
        <label>Organization name<input name="name" required maxlength="60" placeholder="e.g. Illinois State"></label>
        <button class="btn-primary" type="submit">Add organization</button>
      </form>
    </div>` : ''}
    ${cards || '<div class="card empty">No organizations yet.</div>'}`,
  });
}

// Coach Home: "needs your attention" — approvals waiting, hitters gone
// quiet (no check-in in 3+ Chicago days), and the compact latest feed.
function coachHomePage(user, quiet, latest, pending, pushOn, analytics, leads) {
  const canEdit = user.role === 'coach' && user.canEdit !== false;
  // Organization coaches see which program (and team) they're scoped to.
  const orgBanner = user.role === 'coach' && user.organizationName
    ? `<div class="notice">${esc(user.organizationName)}${user.teamName ? ` · ${esc(user.teamName)}` : ''} — you\u2019re seeing ${user.teamName ? 'this team' : 'this program'}\u2019s players only.</div>`
    : '';
  const a = analytics || {};
  const trendSub = (cur, prev) => {
    if (prev == null || prev === 0) return cur > 0 ? '<div class="stat-sub up">new</div>' : '';
    const pct = Math.round(((cur - prev) / prev) * 100);
    if (pct === 0) return '<div class="stat-sub">flat</div>';
    const arrow = pct > 0 ? '\u25b2' : '\u25bc';
    return `<div class="stat-sub ${pct > 0 ? 'up' : 'down'}">${arrow} ${Math.abs(pct)}% vs prior 7d</div>`;
  };
  const scoreSub = (cur, prev) => {
    if (cur == null || prev == null) return '';
    const d = Math.round((cur - prev) * 10) / 10;
    if (d === 0) return '<div class="stat-sub">flat</div>';
    const arrow = d > 0 ? '\u25b2' : '\u25bc';
    return `<div class="stat-sub ${d > 0 ? 'up' : 'down'}">${arrow} ${Math.abs(d)} vs prior 7d</div>`;
  };
  const statCard = (num, label, sub, href) => {
    const inner = `<div class="stat-num">${num}</div><div class="stat-label">${label}</div>${sub || ''}`;
    return href
      ? `<a class="stat-card" href="${href}">${inner}</a>`
      : `<div class="stat-card">${inner}</div>`;
  };
  const isGlobal = !user.organizationId;
  const leadList = leads || [];
  const newLeadCount = leadList.filter((l) => l.status === 'new').length;
  const cards = [
    statCard(a.players || 0, 'Players'),
    ...(isGlobal
      ? [statCard(a.orgCount || 0, 'Organizations', '', '/coach/organizations'),
         statCard(fmtMoney(a.revenueCents), 'Collected', '', '/coach/organizations'),
         statCard(newLeadCount, 'New applications', '', '#leads')]
      : []),
    statCard(a.checkedInToday || 0, 'Checked in today'),
    statCard(a.checkinsWeek || 0, 'Check-ins \u00b7 7d', trendSub(a.checkinsWeek || 0, a.checkinsPrevWeek)),
    statCard(a.avgScore == null ? '\u2014' : a.avgScore, 'Avg score \u00b7 7d', scoreSub(a.avgScore, a.avgScorePrev)),
    statCard((quiet || []).length, 'Gone quiet', '', '#gone-quiet'),
    statCard((pending || []).length, 'Waiting approval', '', '/coach/approvals'),
  ].join('');
  const analyticsStrip = `<div class="stat-grid">${cards}</div>`;
  const orgBreakdown = isGlobal && a.orgs && a.orgs.length
    ? `<h2 class="section-head">Players by organization</h2>
    <div class="card org-breakdown">${a.orgs
      .map(
        (o) => `<a class="org-row" href="/coach/hitters?org=${o.id == null ? 'none' : o.id}">
          <div><strong>${esc(o.name)}</strong>
            <div class="hint-inline">${o.players} player${o.players === 1 ? '' : 's'} \u00b7 ${o.weekCheckins} check-in${o.weekCheckins === 1 ? '' : 's'} \u00b7 7d</div>
          </div>
          <div class="org-row-right">
            <div class="org-money">${o.paidCents ? `<span class="badge ok">${fmtMoney(o.paidCents)} paid</span>` : o.dealCents ? `<span class="badge warn">${fmtMoney(o.dealCents)} deal \u00b7 unpaid</span>` : '<span class="hint-inline">no deal set</span>'}</div>
            <span class="org-chev" aria-hidden="true">\u203a</span>
          </div>
        </a>`
      )
      .join('')}</div>`
    : '';
  const approvalNudge = pending && pending.length
    ? `<a class="card approval-nudge" href="/coach/approvals">${pending.length} player${pending.length === 1 ? '' : 's'} waiting for approval →</a>`
    : '';
  // Website application leads (Sep 2026): name, phone, age/level, goals.
  // Tap-to-call/text so Bobby can reach back fast.
  const leadStatusPill = (s) => {
    const cls = s === 'new' ? 'warn' : s === 'contacted' ? '' : s === 'enrolled' ? 'ok' : 'quiet';
    return `<span class="badge ${cls}">${esc(s)}</span>`;
  };
  const leadCards = leadList
    .map((l) => {
      const tel = String(l.phone || '').replace(/[^\d+]/g, '');
      const statusOpts = ['new', 'contacted', 'enrolled', 'archived']
        .map((s) => `<option value="${s}"${l.status === s ? ' selected' : ''}>${s}</option>`)
        .join('');
      return `<div class="card athlete-card">
        <div class="athlete-card-name">${esc(l.name)} ${leadStatusPill(l.status || 'new')}</div>
        <div class="athlete-card-meta">${l.age_level ? `${esc(l.age_level)} · ` : ''}applied ${fmtDate(l.submitted_at)}</div>
        ${l.goals ? `<div class="hint" style="margin-top:4px">${esc(l.goals)}</div>` : ''}
        <div style="display:flex;gap:8px;margin:8px 0 0;flex-wrap:wrap;align-items:center">
          ${tel ? `<a class="btn-small" href="tel:${esc(tel)}">Call</a><a class="btn-small btn-quiet" href="sms:${esc(tel)}">Text</a>` : ''}
          ${canEdit ? `<form method="post" action="/coach/leads/${l.id}/questionnaire" style="margin:0">
            <button class="btn-small" type="submit">${l.invite_token ? 'Questionnaire link' : 'Send questionnaire'}</button>
          </form>` : ''}
          ${canEdit ? `<form method="post" action="/coach/leads/${l.id}/status" style="margin:0;display:flex;gap:6px;align-items:center">
            <select name="status" aria-label="Lead status">${statusOpts}</select>
            <button class="btn-small btn-quiet" type="submit">Update</button>
          </form>` : ''}
        </div>
      </div>`;
    })
    .join('');
  const leadsSection = isGlobal
    ? `<h2 class="section-head" id="leads">Website applications</h2>
    ${leadCards || '<div class="card empty">No applications yet.</div>'}`
    : '';
  const quietCards = (quiet || [])
    .map(
      (a) => `<a href="/coach/user/${encodeURIComponent(a.email)}" class="card athlete-card" style="display:block;color:inherit;text-decoration:none">
        <div class="athlete-card-name">${esc(a.name)} ${rolePill(a.playerType)}</div>
        <div class="athlete-card-meta">last check-in ${a.daysAgo} day${a.daysAgo === 1 ? '' : 's'} ago</div>
      </a>`
    )
    .join('');
  const feed = latest.length
    ? latest.map((c) => checkinCard({ ...c, showAthlete: true })).join('')
    : '<div class="card empty">No check-ins yet.</div>';
  return layout({
    title: 'Coach Dashboard',
    user,
    tabs: coachTabs('home', user.approvalCount, user),
    body: `<h1 class="page-title">Coach Dashboard</h1>
    ${orgBanner}
    ${analyticsStrip}
    ${canEdit && !pushOn ? '<div class="card push-card"><p style="margin:0 0 10px"><strong>Turn on notifications</strong> <span class="hint">so you never miss an approval, a check-in, or a message.</span></p><p style="margin:0"><button type="button" class="btn-primary" id="push-enable-btn" style="margin-top:0">Turn on notifications</button></p></div>' : ''}
    ${approvalNudge}
    ${leadsSection}
    ${orgBreakdown}
    <h2 class="section-head" id="gone-quiet">Gone quiet</h2>
    ${quietCards || '<div class="card empty">Everyone\u2019s checking in.</div>'}
    <h2 class="section-head">Latest check-ins</h2>
    ${feed}`,
  });
}

// Coach Hitters tab: the search bar + athlete cards.
function roleLabel(t) {
  return t === 'pitcher' ? 'Pitcher' : t === 'two_way' ? 'Two-way' : 'Hitter';
}
function fmtMoney(cents) {
  const n = Math.round(Number(cents) || 0) / 100;
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: n % 1 ? 2 : 0 });
}
function rolePill(t) {
  const cls = t === 'pitcher' ? 'pitcher' : t === 'two_way' ? 'twoway' : 'hitter';
  return `<span class="badge role-${cls}">${roleLabel(t)}</span>`;
}
// Skip's face follows the athlete: pitchers get the glove variant, everyone
// else gets the classic bat-on-the-shoulder.
function skipAvatar(user) {
  const pt = user && (user.playerType || user.player_type);
  return pt === 'pitcher' ? '/skip-avatar-pitching.webp' : '/skip-avatar.webp';
}
function coachHittersPage(user, userStats, opts) {
  const o = opts || {};
  const title = o.title || 'Players';
  const tab = o.tab || 'hitters';
  const cards = userStats
    .map(
      (a) => `<div class="card athlete-card" data-search="${esc(`${a.name} ${a.email}`.toLowerCase())}" data-role="${esc(a.playerType || 'hitter')}">
        <a href="/coach/user/${encodeURIComponent(a.email)}" style="display:block;color:inherit;text-decoration:none">
          <div class="athlete-card-name">${esc(a.name)} ${rolePill(a.playerType)}</div>
          <div class="athlete-card-email">${esc(a.email)}</div>
          <div class="athlete-card-meta">${a.total} check-in${a.total === 1 ? '' : 's'}${a.streak ? ` · 🔥 ${a.streak}-day streak` : ''}${a.weekCount != null ? ` · ${a.weekCount}/7 days` : ''}${a.last ? ` · last ${fmtDate(a.last)}` : ' · none yet'}${a.age != null ? ` · age ${a.age}` : ''}${a.team ? ` · ${esc(a.team)}` : ''}${!o.filterOrg && a.orgName ? ` · ${esc(a.orgName)}` : ''}</div>
        </a>
        <div style="display:flex;gap:8px;margin:8px 0 0;flex-wrap:wrap">
          ${o.messageButton ? `<a class="btn-small" href="/coach/messages/${a.id}">Message</a>` : ''}
          ${o.notifyButton ? `<form method="post" action="/coach/player/${a.id}/notify-checkin" style="margin:0">
            <input type="hidden" name="back" value="${esc(o.tab === 'my-players' ? '/coach/my-players' : '/coach/hitters')}">
            <button class="btn-small btn-quiet" type="submit" title="${a.notifyOn ? 'Log alerts ON — tap to mute' : 'Log alerts OFF — tap to unmute'}">${a.notifyOn ? '🔔 Alerts on' : '🔕 Alerts off'}</button>
          </form>` : ''}
          <form method="post" action="/coach/view-as" style="margin:0">
            <input type="hidden" name="id" value="${a.id}">
            <button class="btn-small btn-quiet" type="submit">View as player</button>
          </form>
        </div>
      </div>`
    )
    .join('');
  const emptyText = o.empty || 'Nobody has signed up yet.';
  return layout({
    title,
    user,
    tabs: coachTabs(tab, user.approvalCount, user),
    body: `<h1 class="page-title">${esc(title)}</h1>
    ${o.filterOrg ? `<p style="margin:0 0 12px"><a href="/coach/hitters" class="btn-small btn-quiet">\u2190 All players</a></p>` : ''}
    ${userStats.length ? `<input type="search" id="hitter-search" class="searchbar" placeholder="Search players…" autocomplete="off">` : ''}
    ${userStats.length ? `<div class="pill-row" id="role-filter">
      <button type="button" class="pill-link active" data-rolefilter="all">All</button>
      <button type="button" class="pill-link" data-rolefilter="hitter">Hitters</button>
      <button type="button" class="pill-link" data-rolefilter="pitcher">Pitchers</button>
      <button type="button" class="pill-link" data-rolefilter="two_way">Two-way</button>
    </div>` : ''}
    <div class="athlete-grid">${cards || `<div class="card empty">${esc(emptyText)}</div>`}</div>
    <div class="card empty" id="hitter-no-match" hidden>No players match that search.</div>`,
  });
}

// Player inbox (Sep 17 2026): broadcasts + 1:1 with the coach, chronological.
// The "Message Coach" box only renders for Bobby's own players; everyone else
// just sees their (empty) inbox.
function playerMessagesPage(user, msgs, opts) {
  const o = opts || {};
  const cards = msgs
    .map((m) => {
      const mine = m.sender_id === user.id;
      return `<div class="card"><p style="margin:0 0 6px"><strong>${mine ? 'You' : 'Coach'}</strong> <span class="hint-inline">${fmtDate(m.created_at)}</span></p><p style="margin:0">${linkify(m.body)}</p></div>`;
    })
    .join('');
  return layout({
    title: 'Messages',
    user,
    tabs: userTabs('messages', user),
    body: `<h1 class="page-title">Messages</h1>
    ${o.nudge ? `<div class="card push-card"><p style="margin:0 0 10px"><strong>Turn on notifications</strong> <span class="hint">so you never miss a message from Coach.</span></p><p style="margin:0"><button type="button" class="btn-primary" id="push-enable-btn" style="margin-top:0">Turn on notifications</button></p></div>` : ''}
    ${o.error ? `<p class="error">${esc(o.error)}</p>` : ''}
    ${o.canMessage ? `<div class="card"><form method="post" action="/messages/to-coach">
      <label>Message Coach <span class="hint-inline">(500 characters max)</span>
        <textarea name="body" maxlength="500" required rows="3" style="width:100%;box-sizing:border-box" placeholder="Ask Bobby anything…">${esc(o.prefill || '')}</textarea>
      </label>
      <button class="btn-primary" type="submit" style="margin-top:8px">Send</button>
    </form></div>` : ''}
    ${cards || '<div class="card empty">No messages yet.</div>'}`,
  });
}

// Coach inbox (Sep 17 2026): one row per athlete with message traffic.
// The messaging hub — "New message" opens the clean compose screen.
function coachMessagesPage(user, threads, opts) {
  const o = opts || {};
  const rows = threads
    .map(
      (t) => `<a href="/coach/messages/${t.id}" class="card" style="display:block;color:inherit;text-decoration:none">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <strong>${esc(t.name)}</strong>
          ${t.unread ? `<span class="tab-badge">${t.unread}</span>` : ''}
        </div>
        <p class="hint" style="margin:6px 0 0">${esc(t.last.body.slice(0, 80))}${t.last.body.length > 80 ? '…' : ''} <span class="hint-inline">· ${fmtDate(t.last.created_at)}</span></p>
      </a>`
    )
    .join('');
  return layout({
    title: 'Messages',
    user,
    tabs: coachTabs('messages', user.approvalCount, user),
    body: `<h1 class="page-title">Messages</h1>
    <p style="margin:0 0 14px"><a class="btn-primary" href="/coach/messages/new" style="text-decoration:none;display:inline-block">New message</a></p>
    ${o.sent ? `<p class="notice"><strong>Sent</strong> to ${esc(String(o.sent))} player${String(o.sent) === '1' ? '' : 's'}.</p>` : ''}
    ${rows || '<div class="card empty">No message threads yet. Tap New message to start one.</div>'}`,
  });
}

// Coach compose (Sep 17 2026, redesign): clean "New message" screen. Bobby
// picks "All my players" (one tap) or "Choose players" — a compact
// searchable checkbox list in a scrollable box with Select all / Clear.
function coachComposePage(user, players, opts) {
  const o = opts || {};
  const list = (players || [])
    .map(
      (a) => `<label class="compose-row" data-name="${esc(a.name.toLowerCase())}" style="display:block;padding:5px 2px;cursor:pointer"><input type="checkbox" name="user_ids" value="${a.id}"> <span>${esc(a.name)}</span></label>`
    )
    .join('');
  return layout({
    title: 'New message',
    user,
    tabs: coachTabs('messages', user.approvalCount, user),
    body: `<h1 class="page-title">New message</h1>
    <p class="hint"><a href="/coach/messages">← All messages</a></p>
    ${o.error ? `<p class="error">${esc(o.error)}</p>` : ''}
    <form method="post" action="/coach/messages/new" class="card">
      <div style="display:grid;gap:8px;margin-bottom:12px">
        <label style="display:flex;align-items:center;gap:8px"><input type="radio" name="to_mode" value="all" checked> <strong>All my players</strong> <span class="hint-inline">(${(players || []).length})</span></label>
        <label style="display:flex;align-items:center;gap:8px"><input type="radio" name="to_mode" value="choose"> <strong>Choose players</strong></label>
      </div>
      <div id="choose-box" hidden>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
          <input type="search" id="compose-search" class="searchbar" placeholder="Search players…" autocomplete="off" style="margin:0;flex:1">
          <button type="button" class="btn-small btn-quiet" id="compose-all">All</button>
          <button type="button" class="btn-small btn-quiet" id="compose-clear">Clear</button>
        </div>
        <div style="max-height:220px;overflow:auto;border:1px solid #e3e3e3;border-radius:8px;padding:6px 10px;margin-bottom:12px">
          ${list || '<p class="hint">No players yet.</p>'}
        </div>
      </div>
      <label>Message <span class="hint-inline">(<span id="char-count">0</span>/500)</span>
        <textarea name="body" id="compose-body" maxlength="500" required rows="4" style="width:100%;box-sizing:border-box" placeholder="Write your message…"></textarea>
      </label>
      <button class="btn-primary" type="submit" style="margin-top:10px">Send message</button>
    </form>
    <script>
    (function () {
      var modes = document.querySelectorAll('input[name="to_mode"]');
      var box = document.getElementById('choose-box');
      var search = document.getElementById('compose-search');
      var rows = Array.prototype.slice.call(document.querySelectorAll('.compose-row'));
      function syncMode() {
        var v = document.querySelector('input[name="to_mode"]:checked').value;
        box.hidden = v !== 'choose';
      }
      modes.forEach(function (r) { r.addEventListener('change', syncMode); });
      syncMode();
      search.addEventListener('input', function () {
        var q = search.value.toLowerCase();
        rows.forEach(function (r) { r.style.display = r.dataset.name.indexOf(q) === -1 ? 'none' : ''; });
      });
      document.getElementById('compose-all').addEventListener('click', function () {
        rows.forEach(function (r) { if (r.style.display !== 'none') r.querySelector('input').checked = true; });
      });
      document.getElementById('compose-clear').addEventListener('click', function () {
        rows.forEach(function (r) { r.querySelector('input').checked = false; });
      });
      var body = document.getElementById('compose-body');
      var count = document.getElementById('char-count');
      body.addEventListener('input', function () { count.textContent = body.value.length; });
    })();
    </script>`,
  });
}

// Coach 1:1 thread (Sep 17 2026): full history with one player, both
// directions. The reply box only renders for full-access coaches.
function coachThreadPage(user, other, msgs, opts) {
  const o = opts || {};
  const canReply = user.canEdit !== false;
  const cards = msgs
    .map((m) => {
      const mine = m.sender_id === user.id;
      return `<div class="card"><p style="margin:0 0 6px"><strong>${mine ? 'You' : esc(other.name)}</strong> <span class="hint-inline">${fmtDate(m.created_at)}</span></p><p style="margin:0">${linkify(m.body)}</p></div>`;
    })
    .join('');
  return layout({
    title: 'Messages',
    user,
    tabs: coachTabs('messages', user.approvalCount, user),
    body: `<h1 class="page-title">${esc(other.name)}</h1>
    <p class="hint"><a href="/coach/messages">← All messages</a></p>
    ${o.error ? `<p class="error">${esc(o.error)}</p>` : ''}
    ${cards || '<div class="card empty">No messages yet.</div>'}
    ${canReply ? `<div class="card"><form method="post" action="/coach/messages/to/${other.id}">
      <label>Reply <span class="hint-inline">(500 characters max)</span>
        <textarea name="body" maxlength="500" required rows="3" style="width:100%;box-sizing:border-box"></textarea>
      </label>
      <button class="btn-primary" type="submit" style="margin-top:8px">Send</button>
    </form></div>` : ''}`,
  });
}

// Coach Programs tab: the remote program list.
function coachProgramsPage(user, remotePrograms, intake) {
  const canEdit = user.role === 'coach' && user.canEdit !== false;
  return layout({
    title: 'Programs',
    user,
    tabs: coachTabs('programs', user.approvalCount, user),
    body: `<h1 class="page-title">Programs</h1>
    ${intakeSection(intake || {}, canEdit)}
    ${remoteProgramsSection(remotePrograms || [], canEdit)}`,
  });
}

// ---- Pre-signup intake questionnaire ----

// Bobby's shareable intake link + recent questionnaires. Full-access coaches
// only (canEdit) see the rotate button; view-only coaches can still review.
function intakeSection(intake, canEdit) {
  const rows = (intake.intakes || [])
    .map((r) => {
      const name = [r.first_name, r.last_name].filter(Boolean).join(' ') || r.email;
      const date = r.created_at ? esc(String(r.created_at).slice(0, 10)) : '';
      const pill = r.is_draft
        ? '<span class="pill-draft">Draft — unreviewed</span>'
        : r.status === 'approved'
          ? '<span class="pill">Approved</span>'
          : '<span class="hint-inline">pending approval</span>';
      const waiver = r.waiver_signed_at
        ? `<span class="pill">Waiver signed ${esc(String(r.waiver_signed_at).slice(0, 10))}</span>`
        : '<span class="pill-warn">Waiver pending</span>';
      return `<div class="remote-row">
        <div><strong>${esc(name)}</strong><div class="hint-inline">${esc(r.email || '')} · ${date}</div></div>
        <div class="remote-actions">${pill} ${waiver}
          <a class="btn btn-sm" href="/coach/intake/${r.id}">View answers</a>
          ${r.remote_program_id ? `<a class="btn btn-sm" href="/coach/program/${r.remote_program_id}/edit">Edit draft</a>` : ''}
        </div>
      </div>`;
    })
    .join('');
  return `<h2 class="section-head">New athlete intake</h2>
  <div class="card">
    <p class="hint" style="margin-top:0">Text this link to a prospect — they fill it out, their account is created, and a draft program is built from their answers for you to review.</p>
    <div class="intake-linkrow">
      <input type="text" readonly value="${esc(intake.url || '')}" id="intake-link" class="input-sm" style="flex:1;min-width:0" onclick="this.select()">
      <button type="button" class="btn btn-sm" id="intake-copy">Copy</button>
    </div>
    ${canEdit ? `<form method="post" action="/coach/intake/rotate" class="inline-form" style="margin-top:8px"><button class="btn btn-sm btn-quiet" type="submit">New link</button></form>` : ''}
    <h3 class="prog-h3" style="margin-top:14px">Recent questionnaires</h3>
    ${rows || '<div class="empty">No questionnaires yet.</div>'}
  </div>
  <script>
  (function(){var b=document.getElementById('intake-copy');if(!b)return;b.addEventListener('click',function(){var i=document.getElementById('intake-link');i.select();var done=function(){b.textContent='Copied';setTimeout(function(){b.textContent='Copy'},1500)};if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(i.value).then(done).catch(function(){document.execCommand('copy');done()})}else{document.execCommand('copy');done()}});})();
  </script>`;
}

// Questionnaire link bound to a website-application lead (Sep 2026): Bobby
// copies it and texts it to the athlete after the call. Their name, phone,
// and goals are already filled in when they open it.
function leadQuestionnaireLinkPage(user, lead, link) {
  const tel = String((lead && lead.phone) || '').replace(/[^\d+]/g, '');
  const text = encodeURIComponent(`Hey ${String((lead && lead.name) || '').split(' ')[0] || 'there'} — here's your Atkinson Hitting intake questionnaire. Your application info is already filled in: ${link}`);
  return layout({
    title: 'Questionnaire link',
    user,
    tabs: [],
    body: `<div class="login-card card">
      <h1 class="page-title">Questionnaire ready</h1>
      <p class="hint">Text this link to <strong>${esc(lead.name || '')}</strong> — their name, phone, and goals are already filled in from their application.</p>
      <div class="intake-linkrow">
        <input type="text" readonly value="${esc(link)}" id="qlink" class="input-sm" style="flex:1;min-width:0" onclick="this.select()">
        <button type="button" class="btn btn-sm" id="qcopy">Copy</button>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        ${tel ? `<a class="btn btn-sm" href="sms:${esc(tel)}?body=${text}">Text it to them</a>` : ''}
        <a class="btn btn-sm btn-quiet" href="/coach#leads">Back to applications</a>
      </div>
    </div>
    <script>
    (function(){var b=document.getElementById('qcopy');if(!b)return;b.addEventListener('click',function(){var i=document.getElementById('qlink');i.select();var done=function(){b.textContent='Copied';setTimeout(function(){b.textContent='Copy'},1500)};if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(i.value).then(done).catch(function(){document.execCommand('copy');done()})}else{document.execCommand('copy');done()}});})();
    </script>`,
  });
}

// Coaches with dashboard access — full access or view-only. Only a full
// coach sees this section, and only they can flip someone's access.
function coachesSection(coaches, selfId) {
  const rows = (coaches || [])
    .map((c) => {
      const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email;
      const full = c.can_edit !== 0;
      const pill = full ? '<span class="pill">Full access</span>' : '<span class="hint-inline">View only</span>';
      const toggle =
        c.id === selfId
          ? '<span class="hint-inline">you</span>'
          : `<form method="post" action="/coach/coaches/toggle" class="inline-form" style="margin:0"><input type="hidden" name="id" value="${c.id}"><button class="btn-small${full ? ' btn-quiet' : ''}" type="submit">${full ? 'Make view-only' : 'Give full access'}</button></form>`;
      return `<div class="remote-row"><div><strong>${esc(name)}</strong><div class="hint-inline">${esc(c.email)}</div></div><div class="remote-actions">${pill}${toggle}</div></div>`;
    })
    .join('');
  return `<h2 class="section-head">Coaches</h2>
  <div class="card">
    ${rows || '<div class="empty">Just you.</div>'}
  </div>`;
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
// Athlete Programs tab (Sep 2026): program-first, today-first.
// One tab, four ordered sub-tabs (data-driven): MOBILITY -> MED BALL ->
// Programs sub-tab order per Bobby: lifters get MOBILITY -> HITTING ->
// LIFTING, with med ball work living INSIDE the Lifting tab (ahead of the
// lifts); everyone else gets MOBILITY -> MED BALL -> HITTING. Prep work stays
// with Hitting. Items check off per day; lifts log weight + RPE with target
// RPE, last-time, and history inline.
// Athlete-facing rule (Bobby): blank rows he leaves empty in the editor never
// reach the athlete — only items with real content render, and a block with
// no real items doesn't appear at all.
const realItems = (items) =>
  (Array.isArray(items) ? items : []).filter((it) => String((it && it.drill) || '').trim());
const realExercises = (exs) =>
  (Array.isArray(exs) ? exs : []).filter((ex) => String((ex && ex.name) || '').trim());

function programPage(user, p, opts) {
  const prog = p.prog || {};
  const o = opts || {};
  const tabs = o.tabs || [{ id: 'hitting', label: 'Hitting' }];
  const sub = o.sub || 'hitting';
  const day = o.day || '';
  const labels = o.labels || [];
  const today = o.today || '';
  const checkoffs = o.checkoffs || {};
  const lifting = o.lifting || null;
  const weekday = o.weekday || '';
  const autoDay = o.autoDay || '';
  const isToday = !!o.isToday;
  const videoLib = o.videoLib || {};

  // Resolve a stored item video URL to its href: Drive URLs open the in-app
  // library watch page when the video is in Bobby's library (and visible);
  // YouTube and anything else open directly. Hidden library videos show no
  // link at all.
  const videoHref = (url) => {
    const u = String(url || '').trim();
    if (!u) return '';
    const dm = /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/.exec(u);
    if (dm) {
      const v = videoLib[dm[1]];
      if (v && !v.hidden) return '/videos/watch/' + v.id;
      if (v && v.hidden) return '';
      return u;
    }
    return u;
  };
  const watchLink = (video) => {
    const href = videoHref(video);
    if (!href) return '';
    const ext = /^https?:\/\//i.test(href);
    return ` <a class="watch-link" href="${esc(href)}"${ext ? ' target="_blank" rel="noopener"' : ''} aria-label="Watch video">&#9654; <span>Watch</span></a>`;
  };

  const grades = prog.grades && typeof prog.grades === 'object' ? prog.grades : {};
  const gradeChips = Object.entries(grades)
    .map(([k, v]) => `<span class="grade-chip"><strong>${esc(k)}</strong> ${esc(String(v))}</span>`)
    .join('');
  const strengths = Array.isArray(prog.strengths) ? prog.strengths.filter(Boolean) : [];
  const routine = Array.isArray(prog.routine) ? prog.routine : [];
  const meta = [prog.date_range, prog.phase_emphasis].filter(Boolean).map(esc).join(' · ');
  const progNotes = Array.isArray(prog.notes) ? prog.notes.filter(Boolean) : [];

  // Sub-tab nav: MOBILITY -> MED BALL -> HITTING -> LIFTING (only what he has).
  const tabHtml = `<nav class="prog-subtabs">${tabs
    .map(
      (t) =>
        `<a href="/program?sub=${t.id}${day ? '&day=' + encodeURIComponent(day) : ''}" class="subtab${t.id === sub ? ' active' : ''}">${esc(t.label)}</a>`
    )
    .join('')}</nav>`;
  // Session order (Bobby's call, Sep 2026): hitting and lifting can run in
  // either order. The athlete or Bobby picks; tabs follow the choice.
  // Hidden in coach preview (view-as): previews are read-only by design,
  // so the buttons would be dead there. Bobby sets it in the program editor.
  const sessionOrder = o.sessionOrder === 'lifting_first' ? 'lifting_first' : 'hitting_first';
  const hasLiftingTab = tabs.some((t) => t.id === 'lifting');
  const orderToggle = hasLiftingTab && !user.viewAs ? `<form method="post" action="/program/session-order" class="order-toggle">
      <input type="hidden" name="sub" value="${esc(sub)}">
      <span class="hint-inline">Session order:</span>
      <button type="submit" name="session_order" value="hitting_first" class="btn-small${sessionOrder === 'hitting_first' ? '' : ' btn-quiet'}">Hitting first</button>
      <button type="submit" name="session_order" value="lifting_first" class="btn-small${sessionOrder === 'lifting_first' ? '' : ' btn-quiet'}">Lifting first</button>
    </form>` : '';
  // Lifting-first primer: no hitting beforehand to warm them up, so the
  // integrated warm-up has to fully prime med ball / explosive work and
  // heavy lifting. Hitting-first just needs the short banner.
  const liftPrimer = sessionOrder === 'lifting_first' ? `<details class="card warmup-block" open>
      <summary class="routine-summary"><span class="routine-station">Prime-up — lifting first</span></summary>
      <p class="hint" style="margin:0 0 6px">No hitting beforehand today, so prime fully before med ball. Do the <strong>Mobility tab</strong> first, then:</p>
      <ol class="warmup-list">
        <li>Leg swings front-to-back — 10 each leg</li>
        <li>Hip openers — 8 each side</li>
        <li>World's greatest stretch — 5 each side</li>
        <li>A-skips — 2 x 20 yd (in place if no space)</li>
        <li>Bounds — 2 x 20 yd</li>
        <li>Build-up sprints: 3 x 30 yd, each faster (last ~90%)</li>
      </ol>
      <p class="hint" style="margin:6px 0 0">Then med ball, then lifts — the ramp-up sets on main lifts are <strong>essential</strong> today.</p>
    </details>` : '';

  // Day helpers.
  const dayPrefix = (cat) => {
    const m = /^([A-Za-z]+ ?\d+|Pregame)/i.exec(String(cat || '').trim());
    return m ? m[1].trim() : '';
  };
  const kindOf = (cat) => {
    const n = String(cat || '');
    if (/med\s*ball/i.test(n)) return 'medball';
    if (/mobility/i.test(n)) return 'mobility';
    if (/prep/i.test(n)) return 'prep';
    if (/metabol|conditioning/i.test(n)) return 'metabolic';
    return 'hit';
  };
  const inDay = (cat, d) => dayPrefix(cat).toLowerCase() === String(d || '').toLowerCase();

  // Rest day? (schedule maps today to OFF / Rest). Sheet entries are
  // [weekday, label] pairs; tolerate { weekday, day_label } objects too.
  const schedEntry = (s) =>
    Array.isArray(s)
      ? { weekday: String(s[0] || '').trim(), label: String(s[1] || '').trim() }
      : { weekday: String((s && s.weekday) || '').trim(), label: String((s && (s.day_label || s.label)) || '').trim() };
  const schedArr = (Array.isArray(prog.schedule) ? prog.schedule : []).map(schedEntry);
  const schedToday = schedArr.find((s) => s.weekday.toLowerCase() === String(weekday).toLowerCase());
  const isRest = schedToday && /^(off|rest)/i.test(schedToday.label);

  // Compact day header + manual day picker (GET form, no clunky JS).
  const dayHead = (showPicker) => {
    const picker = showPicker && labels.length > 1
      ? `<form method="get" action="/program" class="daypick"><input type="hidden" name="sub" value="${esc(sub)}"><select name="day" data-autosubmit aria-label="Pick a program day">${labels
          .map((l) => `<option value="${esc(l)}"${l.toLowerCase() === String(day).toLowerCase() ? ' selected' : ''}>${esc(l)}</option>`)
          .join('')}</select></form>`
      : '';
    const big = isRest && isToday
      ? `<div class="day-now">Today · ${esc(weekday)}</div><div class="day-label">Rest day — recover.</div>`
      : isToday
        ? `<div class="day-now">Today · ${esc(weekday)}</div><div class="day-label">${esc(day || 'Your program')}</div>`
        : `<div class="day-now">Viewing · ${esc(day || 'Your program')}</div>${autoDay ? `<div class="day-alsotoday">Today is ${esc(autoDay)} — switch back anytime.</div>` : ''}`;
    return `<div class="day-head">${big}${picker}</div>`;
  };

  // One check-off row (hitting / mobility / med ball / prep).
  const checkRow = (kind, key, drill, volume, video, extra) => {
    const done = !!checkoffs[key];
    const swapped = (o.subs || {})[key];
    const shown = swapped ? String(swapped.sub_name || drill) : drill;
    const subBadge = swapped
      ? ` <span class="sub-badge">⇄ swapped from ${esc(drill)}</span>`
      : (kind === 'med'
          ? ` <a class="sub-link" href="/program/substitute?name=${encodeURIComponent(drill)}&key=${encodeURIComponent(key)}&sub=${esc(sub)}&day=${encodeURIComponent(day || '')}">⇄ Substitute</a>`
          : '');
    return `<form method="post" action="/program/check" class="checkrow${done ? ' done' : ''}">
      <input type="hidden" name="kind" value="${kind}">
      <input type="hidden" name="sub" value="${esc(sub)}">
      <input type="hidden" name="day" value="${esc(day)}">
      ${extra || ''}
      <input type="hidden" name="item_key" value="${esc(key)}">
      <button type="submit" class="checkbtn" aria-label="${done ? 'Mark not done' : 'Mark done'}">${done ? '☑' : '☐'}</button>
      <span class="routine-name">${esc(shown || '')}</span>${volume ? `<span class="hint-inline">${esc(volume)}</span>` : ''}${watchLink(video)}${subBadge}
    </form>`;
  };
  const blockCard = (cat, items, kind, dayScope, extra) => {
    const real = realItems(items);
    if (!real.length) return '';
    return `<details class="card routine-group" open><summary class="routine-summary"><span class="routine-station">${esc(cat)}</span></summary>${real
      .map((it) => checkRow(kind, `${kind}::${dayScope || ''}::${cat}::${it.drill}`, it.drill, it.volume, it.video, extra))
      .join('')}</details>`;
  };

  let content = '';
  if (sub === 'mobility') {
    const blocks = routine.filter((c) => kindOf(c.category) === 'mobility' && realItems(c.items).length);
    content = `${dayHead(false)}
      <p class="lede">Do this first, every day — then get after the work below.</p>
      ${blocks.map((c) => blockCard(c.category, c.items, 'mob')).join('') || '<div class="card empty">No mobility work in your program.</div>'}`;
  } else if (sub === 'medball') {
    const blocks = routine.filter((c) => kindOf(c.category) === 'medball' && realItems(c.items).length);
    const todays = day ? blocks.filter((c) => inDay(c.category, day)) : blocks;
    const others = day ? blocks.filter((c) => !inDay(c.category, day)) : [];
    content = `${dayHead(true)}
      ${(todays.length || others.length
        ? todays.map((c) => blockCard(c.category, c.items, 'med', dayPrefix(c.category))).join('') +
          (others.length
            ? `<details class="card"><summary class="routine-summary"><span class="routine-station">Other days</span></summary>` +
              others.map((c) => blockCard(c.category, c.items, 'med', dayPrefix(c.category))).join('') +
              `</details>`
            : '')
        : '<div class="card empty">No med ball work in your program.</div>')}`;
  } else if (sub === 'lifting' && lifting) {
    const days = (Array.isArray(lifting.days) ? lifting.days : []).filter((d) => realExercises(d.exercises).length);
    // Bobby's session order (Sep 2026): 1. SPEED (sprints first) → 2. POWER
    // (med ball) → 3. LIFTS. No standalone Metabolic tab — speed lives here.
    // Legacy 'Metabolic' blocks in old programs fold into the Speed section.
    const lday = o.ldayIdx || 0;
    const ldayExtra = `<input type="hidden" name="lday" value="${lday}">`;
    const curDay = days[lday] || {};
    const daySpeed = Array.isArray(curDay.speed) ? curDay.speed.filter((s) => String(s && s.name || '').trim()) : [];
    const metBlocks = routine.filter((c) => kindOf(c.category) === 'metabolic' && realItems(c.items).length);
    const speedHtml = (daySpeed.length || metBlocks.length)
      ? `<h3 class="prog-h3"><span class="flow-num">1</span> Speed — sprints first</h3>\n` +
        (daySpeed.length
          ? `<div class="card routine-group">${daySpeed.map((s) =>
              checkRow('spd', `spd::${dayScope || ''}::${curDay.label || ''}::${s.name}`, s.name,
                [s.volume, s.notes].filter(Boolean).join(' — '), s.video, ldayExtra)
            ).join('')}</div>`
          : '') +
        metBlocks.map((c) => blockCard(c.category, c.items, 'spd', dayPrefix(c.category), ldayExtra)).join('')
      : '';
    const medBlocks = routine.filter((c) => kindOf(c.category) === 'medball' && realItems(c.items).length);
    const mbToday = day ? medBlocks.filter((c) => inDay(c.category, day)) : medBlocks;
    const mbOthers = day ? medBlocks.filter((c) => !inDay(c.category, day)) : [];
    const medHtml = mbToday.length || mbOthers.length
      ? `<h3 class="prog-h3"><span class="flow-num">2</span> Power — med ball</h3>\n` +
        mbToday.map((c) => blockCard(c.category, c.items, 'med', dayPrefix(c.category), ldayExtra)).join('') +
        (mbOthers.length
          ? `<details class="card"><summary class="routine-summary"><span class="routine-station">Other days</span></summary>` +
            mbOthers.map((c) => blockCard(c.category, c.items, 'med', dayPrefix(c.category), ldayExtra)).join('') +
            `</details>`
          : '')
      : '';
    const liftsHead = (daySpeed.length || metBlocks.length || medBlocks.length) ? `<h3 class="prog-h3"><span class="flow-num">3</span> Lifts</h3>\n` : '';
    content = `${liftPrimer}${sessionOrder === 'hitting_first' ? `<p class="hint">Hit first, then lift — you're warm, go straight to speed work. Ramp-up sets on main lifts still apply. Lifting-only day? Full Mobility tab first.</p>` : ''}${speedHtml}${medHtml}${liftsHead}${liftSubTab(user, lifting, days, lday, sub, checkoffs, today, o.liftData || {}, o.subs || {})}`;
  } else {
    // HITTING (default): today's plan first — prep for the day + the day's
    // hitting blocks. Then pregame, then Focus/Grades/Strengths/Notes.
    const dayBlocks = routine.filter(
      (c) => realItems(c.items).length && (kindOf(c.category) === 'hit' || kindOf(c.category) === 'prep') &&
             (!day || inDay(c.category, day) || !dayPrefix(c.category))
    );
    const daySpecific = dayBlocks.filter((c) => day && inDay(c.category, day));
    const flat = dayBlocks.filter((c) => !dayPrefix(c.category));
    const pregame = routine.filter((c) => realItems(c.items).length && /^pregame/i.test(dayPrefix(c.category)) && kindOf(c.category) !== 'mobility' && kindOf(c.category) !== 'medball');
    const prepToday = daySpecific.filter((c) => kindOf(c.category) === 'prep');
    const hitToday = daySpecific.filter((c) => kindOf(c.category) === 'hit');
    content = `${dayHead(true)}
      ${isRest && isToday ? '<div class="card"><p style="margin:0">No work scheduled — rest, recover, come back tomorrow.</p></div>' : `
      ${prepToday.map((c) => blockCard(c.category, c.items, 'hit', day)).join('')}
      ${hitToday.map((c) => blockCard(c.category, c.items, 'hit', day)).join('')}
      ${!daySpecific.length && !flat.length ? '<div class="card empty">Nothing scheduled for this day.</div>' : ''}
      ${flat.length ? `<h3 class="prog-h3">Every day</h3>${flat.map((c) => blockCard(c.category, c.items, 'hit', '')).join('')}` : ''}
      ${pregame.length ? `<h3 class="prog-h3">Pregame</h3>${pregame.map((c) => blockCard(c.category, c.items, 'hit', dayPrefix(c.category))).join('')}` : ''}`}
      ${programSection('The focus', prog.adjustment ? `<p>${esc(prog.adjustment)}</p>` : '', 'focus')}
      ${programSection('Grades', gradeChips ? `<div class="grade-row">${gradeChips}</div>` : '', 'grades')}
      ${programSection(
        'Strengths',
        strengths.length ? `<ul class="works-list">${strengths.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '',
        'strengths'
      )}
      ${programSection(
        'Notes',
        progNotes.length ? `<ul class="works-list">${progNotes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '',
        'notes'
      )}`;
  }

  return layout({
    title: 'Your Program',
    user,
    tabs: userTabs('program', user),
    body: `<h1 class="page-title">Your Program</h1>
    ${meta ? `<p class="lede">${meta}</p>` : ''}
    ${tabHtml}
    ${orderToggle}
    ${content}
    <div class="card finish-card"><p style="margin:0 0 8px">Done with the work? <a href="/checkin"><strong>Log your session →</strong></a></p>
    <p class="hint-inline" style="margin:0">Work first, journal second.</p></div>`,
  });
}

// LIFTING sub-tab: day pills, per-exercise check-off + weight/RPE log,
// target RPE chip, "last time" line, and a compact history view.
// Warm-up rows render first as their own block (no logging on them).
// Each exercise gets a mid-workout "Substitute" link; today's swaps are
// pulled from opts.subs and shown with a marker.
function liftSubTab(user, lifting, days, ldayIdx, sub, checkoffs, today, liftData, subs) {
  const day = days[ldayIdx] || { label: '', exercises: [] };
  const dayKey = String(day.label || '');
  const subsMap = subs || {};
  const readOnly = !!(user && user.viewAs);
  const pills = days
    .map(
      (d, i) =>
        `<a href="/program?sub=lifting&lday=${i}" class="day-pill${i === ldayIdx ? ' active' : ''}">${esc(d.label || 'Day ' + (i + 1))}</a>`
    )
    .join('');
  const fmtDay = (d) => {
    try {
      const dt = new Date(d + 'T12:00:00');
      return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch (e) { return d; }
  };
  const fmtSet = (s) => {
    if (!s) return '—';
    const w = s.w != null && s.w !== '' ? String(s.w) : '—';
    const r = s.r != null && s.r !== '' ? String(s.r) : '—';
    if (w === '—' && r === '—') return '—';
    return `${w} × ${r}`;
  };
  const parseRowSets = (row) => {
    try {
      const s = JSON.parse(row && row.sets_json ? row.sets_json : '[]');
      return Array.isArray(s) ? s : [];
    } catch (e) { return []; }
  };
  const warmup = Array.isArray(day.warmup) ? day.warmup : [];
  const warmupHtml = warmup.length
    ? `<details class="card warmup-block" open><summary class="routine-summary"><span class="routine-station">Warm-up — do this first</span></summary>
      <ol class="warmup-list">${warmup.map((w) => `<li>${esc(w)}</li>`).join('')}</ol></details>`
    : '';
  const exRows = realExercises(day.exercises)
    .map((ex) => {
      const name = String(ex.name || '');
      const key = `lift::${dayKey}::${name}`;
      const swapped = subsMap[key];
      const shown = swapped ? String(swapped.sub_name || name) : name;
      const row = checkoffs[key] || null;
      const loggedSets = parseRowSets(row);
      const info = liftData[key] || {};
      const last = info.last || null;
      const lastSets = last && Array.isArray(last.sets) ? last.sets : [];
      const hist = Array.isArray(info.history) ? info.history : [];
      const progSetCount = Math.max(1, Math.min(20, parseInt(ex.sets, 10) || 3));
      const progReps = String(ex.reps || '').trim();
      // Display sets: today's logged sets, or programmed shells prefilled
      // from last time so set 1 is one tap away.
      const dispSets = loggedSets.length
        ? loggedSets
        : Array.from({ length: progSetCount }, (_, i) => {
            const prev = lastSets[i];
            return {
              w: prev && prev.w != null ? prev.w : null,
              r: prev && prev.r != null ? prev.r : (progReps === '' ? null : parseInt(progReps, 10) || null),
              done: 0,
              _prefill: true,
            };
          });
      const doneSets = dispSets.filter((s) => s.done).length;
      const done = dispSets.length > 0 && doneSets === dispSets.length && loggedSets.length > 0;
      const sr = [ex.sets, ex.reps].filter(Boolean).join(' × ');
      const trpe = ex.target_rpe ? `<span class="rpe-chip">Target RPE ${esc(String(ex.target_rpe))}</span>` : '';
      const lastSummary = last
        ? lastSets.length
          ? lastSets.map(fmtSet).join(' · ')
          : `${last.weight != null ? esc(String(last.weight)) + ' lbs' : '—'}${last.rpe != null ? ` · RPE ${esc(String(last.rpe))}` : ''}`
        : null;
      const lastHtml = lastSummary
        ? `<div class="lift-last">Last: <strong>${lastSummary}</strong> <span class="hint-inline">· ${esc(fmtDay(last.day))}</span></div>`
        : `<div class="lift-last dim">First time logging this one — set the tone.</div>`;
      const histHtml = hist.length
        ? `<ul class="hist-list">${hist
            .map((h) => {
              const hs = Array.isArray(h.sets) ? h.sets : [];
              const txt = hs.length
                ? hs.map(fmtSet).join(' · ')
                : `${h.weight != null ? esc(String(h.weight)) + ' lbs' : '—'}${h.rpe != null ? ` · RPE ${esc(String(h.rpe))}` : ''}`;
              return `<li><span class="hint-inline">${esc(fmtDay(h.day))}</span> ${txt}</li>`;
            })
            .join('')}</ul>`
        : '<div class="hint-inline">No logs yet.</div>';
      const rpeOpts = Array.from({ length: 10 }, (_, i) => {
        const v = i + 1;
        return `<option value="${v}"${row && String(row.rpe) === String(v) ? ' selected' : ''}>${v}</option>`;
      }).join('');
      const subUrl = `/program/substitute?name=${encodeURIComponent(name)}&key=${encodeURIComponent(key)}&sub=lifting&lday=${ldayIdx}`;
      const subBadge = swapped
        ? `<span class="sub-badge">⇄ swapped from ${esc(name)}</span>
           ${readOnly ? '' : `<form method="post" action="/program/substitute/revert" class="inline-form" style="display:inline">
             <input type="hidden" name="key" value="${esc(key)}"><input type="hidden" name="sub" value="lifting"><input type="hidden" name="lday" value="${ldayIdx}">
             <button class="btn-small btn-quiet" type="submit">Revert</button>
           </form>`}`
        : (readOnly ? '' : `<a class="sub-link" href="${subUrl}">⇄ Substitute</a>`);
      const setRows = dispSets
        .map((s, i) => {
          const prev = lastSets[i];
          const prevTxt = prev ? fmtSet(prev) : '—';
          const wVal = s.w != null && s.w !== '' ? esc(String(s.w)) : '';
          const rVal = s.r != null && s.r !== '' ? esc(String(s.r)) : '';
          const isDone = !!s.done;
          const checkCell = readOnly
            ? `<span class="set-check${isDone ? ' on' : ''}" aria-hidden="true">${isDone ? '☑' : '☐'}</span>`
            : `<form method="post" action="/program/check" class="set-check-form">
                <input type="hidden" name="kind" value="lift">
                <input type="hidden" name="sub" value="lifting">
                <input type="hidden" name="lday" value="${ldayIdx}">
                <input type="hidden" name="item_key" value="${esc(key)}">
                <input type="hidden" name="lift_op" value="${isDone ? 'unset' : 'set'}">
                <input type="hidden" name="set_idx" value="${i}">
                <input type="hidden" name="prog_sets" value="${progSetCount}">
                <input type="hidden" name="prog_reps" value="${esc(progReps)}">
                <input type="hidden" name="set_weight" value="${wVal}">
                <input type="hidden" name="set_reps" value="${rVal}">
                <button type="submit" class="set-check${isDone ? ' on' : ''}" aria-label="${isDone ? 'Uncheck set ' + (i + 1) : 'Check off set ' + (i + 1)}">${isDone ? '☑' : '☐'}</button>
              </form>`;
          const inputs = readOnly
            ? `<span class="set-val">${wVal === '' ? '—' : wVal}</span>`
            : `<input name="set_weight" type="number" inputmode="decimal" step="any" min="0" max="2000" placeholder="lbs" value="${wVal}" aria-label="Set ${i + 1} weight">`;
          const repsInput = readOnly
            ? `<span class="set-val">${rVal === '' ? '—' : rVal}</span>`
            : `<input name="set_reps" type="number" inputmode="numeric" step="1" min="0" max="500" placeholder="reps" value="${rVal}" aria-label="Set ${i + 1} reps">`;
          // Editable weight/reps live in the per-set check form so one tap
          // logs whatever is typed. Wrap inputs+button in a single form.
          const rowForm = readOnly
            ? `<tr class="set-row${isDone ? ' done' : ''}">
                <td class="set-num">${i + 1}</td>
                <td class="set-prev">${esc(prevTxt)}</td>
                <td>${inputs}</td>
                <td>${repsInput}</td>
                <td class="set-check-cell">${checkCell}</td>
              </tr>`
            : `<tr class="set-row${isDone ? ' done' : ''}">
                <td class="set-num">${i + 1}</td>
                <td class="set-prev">${esc(prevTxt)}</td>
                <td colspan="3">
                  <form method="post" action="/program/check" class="set-form">
                    <input type="hidden" name="kind" value="lift">
                    <input type="hidden" name="sub" value="lifting">
                    <input type="hidden" name="lday" value="${ldayIdx}">
                    <input type="hidden" name="item_key" value="${esc(key)}">
                    <input type="hidden" name="lift_op" value="${isDone ? 'unset' : 'set'}">
                    <input type="hidden" name="set_idx" value="${i}">
                    <input type="hidden" name="prog_sets" value="${progSetCount}">
                    <input type="hidden" name="prog_reps" value="${esc(progReps)}">
                    <input name="set_weight" type="number" inputmode="decimal" step="any" min="0" max="2000" placeholder="lbs" value="${wVal}" aria-label="Set ${i + 1} weight in pounds">
                    <input name="set_reps" type="number" inputmode="numeric" step="1" min="0" max="500" placeholder="reps" value="${rVal}" aria-label="Set ${i + 1} reps">
                    <button type="submit" class="set-check${isDone ? ' on' : ''}" aria-label="${isDone ? 'Uncheck set ' + (i + 1) : 'Log set ' + (i + 1)}">${isDone ? '☑' : '☐'}</button>
                  </form>
                </td>
              </tr>`;
          return rowForm;
        })
        .join('');
      const addSetHtml = readOnly
        ? ''
        : `<form method="post" action="/program/check" class="inline-form set-add">
            <input type="hidden" name="kind" value="lift">
            <input type="hidden" name="sub" value="lifting">
            <input type="hidden" name="lday" value="${ldayIdx}">
            <input type="hidden" name="item_key" value="${esc(key)}">
            <input type="hidden" name="lift_op" value="addset">
            <button type="submit" class="btn-small">+ Add set</button>
          </form>`;
      const rpeHtml = readOnly
        ? (row && row.rpe != null ? `<div class="hint-inline">RPE ${esc(String(row.rpe))}</div>` : '')
        : `<form method="post" action="/program/check" class="lift-rpe">
            <input type="hidden" name="kind" value="lift">
            <input type="hidden" name="sub" value="lifting">
            <input type="hidden" name="lday" value="${ldayIdx}">
            <input type="hidden" name="item_key" value="${esc(key)}">
            <input type="hidden" name="lift_op" value="rpe">
            <select name="rpe" aria-label="Actual RPE 1 to 10"><option value="">RPE</option>${rpeOpts}</select>
            <button type="submit" class="btn btn-sm">Save</button>
          </form>`;
      const progressHtml = dispSets.length
        ? `<div class="hint-inline set-progress">${doneSets}/${dispSets.length} sets</div>`
        : '';
      return `<div class="lift-ex${done ? ' done' : ''}">
        <div class="lift-main">
          <div class="lift-name-row">
            <div class="lift-name">${esc(shown)}${sr ? ` <span class="hint-inline">${esc(sr)}</span>` : ''} ${trpe}${ex.video ? ` <a class="watch-link" href="${esc(ex.video)}" target="_blank" rel="noopener" aria-label="Watch video">&#9654; <span>Watch</span></a>` : ''}</div>
            ${progressHtml}
          </div>
          ${subBadge ? `<div class="hint-inline">${subBadge}</div>` : ''}
          ${ex.notes ? `<div class="hint-inline">${esc(ex.notes)}</div>` : ''}
          ${ex.suggested_weight ? `<div class="lift-suggest">Suggested: <strong>${esc(String(ex.suggested_weight))} lbs</strong> <span class="hint-inline">based on your maxes</span></div>` : ''}
          ${lastHtml}
          <table class="set-table">
            <thead><tr><th>Set</th><th>Previous</th><th>lbs</th><th>Reps</th><th aria-label="Done">✓</th></tr></thead>
            <tbody>${setRows}</tbody>
          </table>
          <div class="set-actions">${addSetHtml}${rpeHtml}</div>
          <details class="lift-hist"><summary>History</summary>${histHtml}</details>
        </div>
      </div>`;
    })
    .join('');
  return `<div class="day-pills">${pills}</div>
    <h3 class="prog-h3">${esc(dayKey)}</h3>
    ${warmupHtml}
    ${readOnly ? '<p class="hint">Preview — logging is disabled.</p>' : ''}
    ${exRows || '<div class="card empty">No exercises on this day yet — your coach can add them.</div>'}`;
}

// Coach: lifting programs overview — templates + per-athlete assignments.
function liftingProgramsPage(user, data) {
  const { templates, programs, assignments } = data;
  const tplCards = templates
    .map(
      (t) => `<div class="card lift-tpl">
        <div class="lift-tpl-head"><strong>${esc(t.name)}</strong>
        <span class="hint-inline">${t.days.length} day${t.days.length === 1 ? '' : 's'} · template</span></div>
        <div class="hint-inline">${t.days.map((d) => esc(d.label) + ' (' + (d.exercises || []).length + ')').join(' · ')}</div>
        <div class="row-actions">
          <a class="btn btn-sm" href="/coach/lifting/${t.id}/edit">Edit</a>
          <form method="post" action="/coach/lifting/assign" class="inline-form">
            <input type="hidden" name="template_id" value="${t.id}">
            <select name="program_id" required><option value="">Assign to athlete…</option>
              ${assignments.map((a) => `<option value="${a.id}">${esc(a.athlete_name)}${a.lifting_name ? ' (has: ' + esc(a.lifting_name) + ')' : ''}</option>`).join('')}
            </select>
            <button type="submit" class="btn btn-sm">Assign copy</button>
          </form>
          <form method="post" action="/coach/lifting/delete" class="inline-form" onsubmit="return confirm('Delete template ${esc(t.name)}? Assigned athlete copies are kept.')">
            <input type="hidden" name="id" value="${t.id}"><button type="submit" class="btn btn-sm btn-danger">Delete</button>
          </form>
        </div>
      </div>`
    )
    .join('');
  const rows = assignments
    .map((a) => {
      const lp = programs.find((x) => a.lifting_program_id === x.id);
      return `<div class="coach-row">
        <div><strong>${esc(a.athlete_name)}</strong>
        <div class="hint-inline">${a.user_email ? esc(a.user_email) : 'no login yet'}</div></div>
        <div class="row-actions">
          ${lp
            ? `<span class="hint-inline">${esc(lp.name)}</span>
               <a class="btn btn-sm" href="/coach/lifting/${lp.id}/edit">Edit lifts</a>
               <form method="post" action="/coach/lifting/unassign" class="inline-form"><input type="hidden" name="program_id" value="${a.id}"><button type="submit" class="btn btn-sm">Unassign</button></form>`
            : `<form method="post" action="/coach/lifting/assign" class="inline-form">
                 <input type="hidden" name="program_id" value="${a.id}">
                 <select name="template_id" required><option value="">Assign template…</option>
                   ${templates.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}
                 </select>
                 <button type="submit" class="btn btn-sm">Assign</button>
               </form>`}
        </div>
      </div>`;
    })
    .join('');
  return layout({
    title: 'Lifting Programs',
    user,
    tabs: coachTabs('lifting', 0, user),
    body: `<h1 class="page-title">Lifting Programs</h1>
    <p class="lede">Templates are starters — assigning one makes a private copy for that athlete, so tweaks never touch the template or another guy's program.</p>
    <div class="card"><h3 style="margin-top:0">New ${templates.length || programs.length ? 'program' : 'program'}</h3>
      <form method="post" action="/coach/lifting/create" class="inline-form">
        <input name="name" placeholder="Program name" required maxlength="80" style="min-width:200px">
        <label class="hint-inline"><input type="checkbox" name="is_template" value="1"> Save as template</label>
        <button type="submit" class="btn btn-sm">Create &amp; edit</button>
      </form></div>
    <h2 class="section-title">Templates</h2>
    ${tplCards || '<div class="card empty">No templates yet.</div>'}
    <h2 class="section-title">Athletes</h2>
    ${rows || '<div class="card empty">No remote programs yet.</div>'}`,
  });
}

// Coach: per-athlete / template lifting editor — compact day + exercise rows.
function liftingEditPage(user, lp) {
  const days = Array.isArray(lp.days) ? lp.days : [];
  const rpeOpts = (sel) =>
    `<option value="">—</option>` +
    Array.from({ length: 10 }, (_, i) => {
      const v = i + 1;
      return `<option value="${v}"${String(sel) === String(v) ? ' selected' : ''}>${v}</option>`;
    }).join('');
  const dayCards = days
    .map(
      (d, i) => `<fieldset class="card lift-day" data-lift-day="${i}">
        <legend class="lift-day-legend">Day ${i + 1}</legend>
        <input type="hidden" name="lday_${i}_excount" value="${(d.exercises || []).length}" data-excount>
        <label class="lift-field">Day label <input name="lday_${i}_label" value="${esc(d.label || '')}" maxlength="40"></label>
        <label class="lift-field">Warm-up <span class="hint-inline">(one per line — renders first on the day, no logging)</span>
          <textarea name="lday_${i}_warmup" rows="3" style="width:100%;box-sizing:border-box" placeholder="Jump rope — 2 min&#10;Leg swings — 10 each leg">${esc((d.warmup || []).join('\n'))}</textarea></label>
        <label class="lift-field">Speed — sprints first <span class="hint-inline">(one per line: Name | volume | notes — the day's opening block)</span>
          <textarea name="lday_${i}_speed" rows="3" style="width:100%;box-sizing:border-box" placeholder="Build-Up Sprints | 6 x 40 yd | Walk-back recovery">${esc((d.speed || []).map((s) => [s.name, s.volume, s.notes].filter(Boolean).join(' | ')).join('\n'))}</textarea></label>
        <div class="lift-ex-list" data-exlist>
        ${(d.exercises || [])
          .map(
            (ex, j) => `<div class="lift-ex-edit" data-exrow>
              <input name="lex_${i}_${j}_name" value="${esc(ex.name || '')}" placeholder="Exercise" maxlength="120" required>
              <input name="lex_${i}_${j}_sets" value="${esc(ex.sets || '')}" placeholder="Sets" maxlength="12" class="num">
              <input name="lex_${i}_${j}_reps" value="${esc(ex.reps || '')}" placeholder="Reps" maxlength="24" class="num">
              <select name="lex_${i}_${j}_trpe" title="Target RPE">${rpeOpts(ex.target_rpe)}</select>
              <input name="lex_${i}_${j}_notes" value="${esc(ex.notes || '')}" placeholder="Cue / note" maxlength="200" class="wide">
              <input name="lex_${i}_${j}_video" value="${esc(ex.video || '')}" placeholder="YouTube link" maxlength="300" class="wide" inputmode="url">
              <button type="button" class="btn btn-sm btn-danger" data-rmex>✕</button>
            </div>`
          )
          .join('')}
        </div>
        <div class="row-actions"><button type="button" class="btn btn-sm" data-addex="${i}">+ Exercise</button>
        <button type="button" class="btn btn-sm btn-danger" data-rmday>Remove day</button></div>
      </fieldset>`
    )
    .join('');
  return layout({
    title: 'Edit ' + lp.name,
    user,
    tabs: coachTabs('lifting', 0, user),
    body: `<h1 class="page-title">${lp.is_template ? 'Template' : 'Lifting program'}: ${esc(lp.name)}</h1>
    <form method="post" action="/coach/lifting/${lp.id}/save" id="lift-form">
      <div class="card"><label class="lift-field">Program name <input name="name" value="${esc(lp.name)}" maxlength="80" required></label></div>
      <div id="lift-days">${dayCards}</div>
      <div class="row-actions" style="margin:12px 0">
        <button type="button" class="btn" id="lift-add-day">+ Add day</button>
        <button type="submit" class="btn primary">Save lifting program</button>
        <a class="btn" href="/coach/lifting">Cancel</a>
      </div>
    </form>
    <script>window.__liftEditDays = ${days.length};</script>`,
  });
}
// Hitter-facing: their daily routine — the every-day blocks of their program.
// Remote athletes only.
function programRoutinePage(user, p, videoLib) {
  const prog = p.prog || {};
  const blocks = dailyRoutineBlocks(prog);
  const lib = videoLib || {};
  const routineHref = (url) => {
    const u = String(url || '').trim();
    if (!u) return '';
    const dm = /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/.exec(u);
    if (dm) {
      const v = lib[dm[1]];
      if (v && !v.hidden) return '/videos/watch/' + v.id;
      if (v && v.hidden) return '';
      return u;
    }
    return u;
  };
  const sectionCard = (name, items) => {
    const real = realItems(items);
    if (!real.length) return '';
    const rows = real
      .map((it) => {
        const href = routineHref(it.video);
        const ext = /^https?:\/\//i.test(href);
        return `<div class="routine-row"><span class="routine-name">${esc(it.drill || '')}</span>${
          it.volume ? `<span class="hint-inline">${esc(it.volume)}</span>` : ''
        }${
          href
            ? ` <a class="watch-link" href="${esc(href)}"${ext ? ' target="_blank" rel="noopener"' : ''} aria-label="Watch video">&#9654; <span>Watch</span></a>`
            : ''
        }</div>`;
      })
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
// Bible study opt-in popup (Sep 23 2026, Bobby): appears on app open until
// the athlete answers. Yes/No posts once; the popup never shows again.
function biblePopupHtml() {
  return `
    <div id="bible-popup-overlay" class="modal-overlay">
      <div class="card modal-card" role="dialog" aria-modal="true" aria-labelledby="bible-popup-title">
        <h2 id="bible-popup-title" style="margin-top:0">New: Daily Bible Study</h2>
        <p>We&apos;re adding an optional daily Bible study &mdash; a verse plus a short breakdown in the Lock In tab. Only for guys who want it.</p>
        <div class="modal-actions">
          <button type="button" class="btn-primary" id="bible-yes">Yes, count me in</button>
          <button type="button" class="btn-secondary" id="bible-no">No thanks</button>
        </div>
      </div>
    </div>
    `;
}

function mentalGamePage(user, data) {
  const { baseline, saved, planFailed, keys, exercise, exerciseDone, bibleOptIn, bibleVerse, checkedInToday, showBiblePopup } = data || {};
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
  // Questionnaire — main focus of the tab (Sep 23 2026). Bobby wants everyone
  // to fill this out. Shown at the top if no plan yet, or if ?retake=1.
  const showQuestionnaire = !b.plan || (data && data.retake);
  const questionnaireHtml = showQuestionnaire ? `
    <form method="post" action="/mental-game/save" class="form">
      <div class="card" style="border:2px solid var(--accent)">
        <h2 class="routine-station">Where's your head at?</h2>
        <p class="hint">Answer honestly — Skip builds your personal plan from this.</p>
        <p class="field-label">In games, what color are you usually? (Ravizza's signal lights)</p>
        ${radio('signal_light', [['green', 'Green — calm, focused'], ['yellow', 'Yellow — tension creeping in'], ['red', 'Red — emotional, rushed']])}
        <p class="field-label">What's the worst thing you say to yourself when it's going bad? (write the actual sentence)</p>
        ${fld('worst_self_talk', 'Worst self-talk', 'The exact sentence in your head.', b.worst_self_talk)}
        <p class="field-label">When you struggle, what's usually going on in your head?</p>
        ${radio('struggle_pattern', [['expecting_results', 'Expecting results'], ['thinking_mechanics', 'Thinking mechanics'], ['worried_watching', "Worried who's watching"], ['blank', 'I go blank']])}
        <p class="field-label">In big moments — are you attacking or hoping?</p>
        ${radio('big_moment_mode', [['attacking', 'Attacking'], ['hoping', 'Hoping'], ['depends', 'Depends']])}
        <p class="field-label">When it gets hard, what does the voice say? (the governor)</p>
        ${fld('hard_voice', 'The voice when it gets hard', 'What does it tell you?', b.hard_voice)}
        <p class="field-label">Do you have a routine you actually trust?</p>
        ${radio('has_routine', [['yes', 'Yes — it\u2019s automatic'], ['sortof', 'Sort of — sometimes'], ['no', 'No routine yet']])}
        <p class="field-label">Between pitches — what do you actually do? (Ravizza: the 15 seconds between pitches is the game)</p>
        ${fld('between_pitches', 'Between pitches', 'Step out? Breathe? Nothing?', b.between_pitches)}
        <p class="field-label">Do you have a reset word — one word that locks you back in?</p>
        ${fld('keyword', 'Your keyword', 'One word. Yours, not someone else\u2019s.', b.keyword)}
        <p class="field-label">Your best game ever — what were you thinking and feeling? (be specific)</p>
        ${fld('best_game', 'Best game', 'What was going through your head?', b.best_game)}
        <p class="field-label">Do you picture success before games — see yourself getting hits?</p>
        ${radio('visualization', [['yes', 'Yes — every game'], ['sometimes', 'Sometimes'], ['no', 'No, never tried it']])}
        <p class="field-label">Where does your confidence come from?</p>
        ${radio('confidence_source', [['preparation', 'My preparation — I know I put the work in'], ['past_success', 'Past success — I know I\u2019ve done it before'], ['disappears', 'Honestly it disappears when I struggle']])}
        <p class="field-label">After a bad game, what do you do?</p>
        ${radio('post_game', [['replay', 'Replay the mistakes over and over'], ['forget', 'Try to forget it'], ['review', 'Review what happened, then move on'], ['beat_up', 'Beat myself up']])}
        <p class="field-label">What pulls your focus during games? (crowd, scouts, parents, last at-bat...)</p>
        ${fld('focus_pull', 'Focus pull', 'What gets in your head?', b.focus_pull)}
        <p><button type="submit" class="btn btn-primary">Save & build my plan</button></p>
      </div>
    </form>` : '';
  // Today's exercise card
  const exerciseHtml = exercise ? `
    <div class="card" style="border-left:4px solid var(--accent)">
      <h2 class="routine-station">Today's mental exercise</h2>
      <p style="margin:0 0 4px"><strong>${esc(exercise.title)}</strong> <span class="hint">— ${esc(exercise.book)}</span></p>
      <p style="margin:0 0 8px">${esc(exercise.concept)}</p>
      <p style="margin:0 0 8px"><strong>Baseball:</strong> ${esc(exercise.baseball)}</p>
      <p style="margin:0 0 8px"><strong>Do this:</strong> ${esc(exercise.action)}</p>
      ${exerciseDone
        ? '<p class="hint" style="margin:0">✓ Done for today. See you tomorrow.</p>'
        : `<form method="post" action="/mental-game/exercise/done" style="margin:0">
            <button type="submit" class="btn btn-primary btn-sm">Mark done</button>
          </form>`}
    </div>` : '';
  // Bible verse card (opt-ins only)
  const bibleHtml = (bibleOptIn && bibleVerse) ? `
    <div class="card" style="border-left:4px solid #8b5cf6">
      <h2 class="routine-station">Daily Bible study</h2>
      <p style="margin:0 0 4px"><strong>${esc(bibleVerse.ref)}</strong> <span class="hint">— ${esc(bibleVerse.theme)}</span></p>
      <p style="margin:0 0 8px;font-style:italic">“${esc(bibleVerse.text)}”</p>
      <p style="margin:0 0 8px">${esc(bibleVerse.explanation)}</p>
      <p style="margin:0 0 8px"><strong>Baseball:</strong> ${esc(bibleVerse.baseball)}</p>
      <p style="margin:0"><strong>Life:</strong> ${esc(bibleVerse.life)}</p>
    </div>` : '';
  // Check-in CTA (if not checked in today)
  const checkinHtml = !checkedInToday ? `
    <div class="card" style="text-align:center">
      <p style="margin:0 0 8px">Haven't checked in today yet.</p>
      <a href="/checkin" class="btn btn-primary">Check in today's session</a>
    </div>` : '';
  // Compact cards (Sep 23 2026) — Bobby: no long scroll. Tappable boxes with
  // checkmarks. Tap to expand, do it, mark done → green.
  const routine = data.routine || { morning: [], done: false };
  const routineItems = Array.isArray(routine.morning) ? routine.morning : [];
  const routineDone = !!routine.done;
  const pregame = data.pregame || { items: [], done: false };
  const practice = data.practice || { items: [], done: false };
  const pregameItems = Array.isArray(pregame.items) ? pregame.items : [];
  const practiceItems = Array.isArray(practice.items) ? practice.items : [];
  
  const card = (id, title, done, content) => `
    <div class="lockin-card${done ? ' done' : ''}" data-card="${id}">
      <button type="button" class="lockin-card-head" data-toggle="${id}">
        <span class="lockin-check">${done ? '✓' : '○'}</span>
        <span class="lockin-title">${esc(title)}</span>
        <span class="lockin-chevron">›</span>
      </button>
      <div class="lockin-card-body" id="card-${id}" hidden>
        ${content}
      </div>
    </div>`;
  
  const routineContent = `
    ${routineItems.length ? `<ul class="routine-list">${routineItems.map((item, i) => `
      <li><label><input type="checkbox" data-routine-item="${i}"${item.done ? ' checked' : ''}> ${esc(item.text)}</label></li>
    `).join('')}</ul>` : '<p class="hint">No routine yet — add your first item below.</p>'}
    <form method="post" action="/mental-game/routine/add" class="form" style="margin-top:8px">
      <div style="display:flex;gap:8px">
        <input type="text" name="text" placeholder="Add to morning routine..." maxlength="200" style="flex:1">
        <button type="submit" class="btn btn-sm">Add</button>
      </div>
    </form>
    ${routineItems.length && !routineDone ? `<form method="post" action="/mental-game/routine/done" style="margin:8px 0 0"><button type="submit" class="btn btn-primary btn-sm">Mark routine done</button></form>` : ''}`;
  
  const exerciseContent = exercise ? `
    <p style="margin:0 0 8px"><strong>${esc(exercise.title)}</strong> <span class="hint">— ${esc(exercise.book)}</span></p>
    <p style="margin:0 0 8px">${esc(exercise.concept)}</p>
    <p style="margin:0 0 8px"><strong>Baseball:</strong> ${esc(exercise.baseball)}</p>
    <p style="margin:0 0 8px"><strong>Do this:</strong> ${esc(exercise.action)}</p>
    ${!exerciseDone ? `<form method="post" action="/mental-game/exercise/done" style="margin:0"><button type="submit" class="btn btn-primary btn-sm">Mark done</button></form>` : ''}` : '';
  
  const bibleContent = (bibleOptIn && bibleVerse) ? `
    <p style="margin:0 0 4px"><strong>${esc(bibleVerse.ref)}</strong> <span class="hint">— ${esc(bibleVerse.theme)}</span></p>
    <p style="margin:0 0 8px;font-style:italic">"${esc(bibleVerse.text)}"</p>
    <p style="margin:0 0 8px">${esc(bibleVerse.explanation)}</p>
    <p style="margin:0 0 8px"><strong>Baseball:</strong> ${esc(bibleVerse.baseball)}</p>
    <p style="margin:0 0 8px"><strong>Life:</strong> ${esc(bibleVerse.life)}</p>
    ${!data.bibleDone ? `<form method="post" action="/mental-game/bible/done" style="margin:0"><button type="submit" class="btn btn-primary btn-sm">Mark done</button></form>` : ''}` : '';
  
  const planCard = b.plan ? card('plan', 'Your Plan', true, `<p style="white-space:pre-wrap;margin:0">${esc(b.plan)}</p>`) : '';
  
  const keysContent = `
    <p class="hint">Tell Skip <strong>"add this to my lock in"</strong> and it lands here.</p>
    ${(keys || []).length
      ? `<ul class="keys-list">${(keys || []).map((k) => `<li><span>${esc(k.content)}</span>
          <form method="post" action="/mental-game/keys/delete" style="display:inline;margin:0">
            <input type="hidden" name="id" value="${k.id}">
            <button type="submit" class="link-danger" aria-label="Remove">✕</button>
          </form></li>`).join('')}</ul>`
      : `<p class="hint">Nothing saved yet.</p>`}`;
  
  const gamePracticeContent = `
    <div class="gp-toggle">
      <button type="button" class="gp-btn active" data-gp="game">Game Day</button>
      <button type="button" class="gp-btn" data-gp="practice">Practice Day</button>
    </div>
    <div id="gp-game">
      ${pregameItems.length ? `<ul class="routine-list">${pregameItems.map((item) => `
        <li><label><input type="checkbox"${item.done ? ' checked' : ''}> ${esc(item.text)}</label></li>
      `).join('')}</ul>` : '<p class="hint">No pregame routine yet.</p>'}
      <form method="post" action="/mental-game/routine/add" class="form" style="margin-top:8px">
        <input type="hidden" name="which" value="pregame">
        <div style="display:flex;gap:8px">
          <input type="text" name="text" placeholder="Add to pregame routine..." maxlength="200" style="flex:1">
          <button type="submit" class="btn btn-sm">Add</button>
        </div>
      </form>
      ${pregameItems.length && !pregame.done ? `<form method="post" action="/mental-game/routine/done" style="margin:8px 0 0"><input type="hidden" name="card" value="pregame"><button type="submit" class="btn btn-primary btn-sm">Mark pregame done</button></form>` : ''}
    </div>
    <div id="gp-practice" hidden>
      ${practiceItems.length ? `<ul class="routine-list">${practiceItems.map((item) => `
        <li><label><input type="checkbox"${item.done ? ' checked' : ''}> ${esc(item.text)}</label></li>
      `).join('')}</ul>` : '<p class="hint">No pre-practice routine yet.</p>'}
      <form method="post" action="/mental-game/routine/add" class="form" style="margin-top:8px">
        <input type="hidden" name="which" value="practice">
        <div style="display:flex;gap:8px">
          <input type="text" name="text" placeholder="Add to pre-practice routine..." maxlength="200" style="flex:1">
          <button type="submit" class="btn btn-sm">Add</button>
        </div>
      </form>
      ${practiceItems.length && !practice.done ? `<form method="post" action="/mental-game/routine/done" style="margin:8px 0 0"><input type="hidden" name="card" value="practice"><button type="submit" class="btn btn-primary btn-sm">Mark practice done</button></form>` : ''}
    </div>`;
  
  const gpDone = pregame.done || practice.done;
  
  const cardsHtml = b.plan ? `
    <h2 class="section-title">Today</h2>
    ${card('routine', 'Morning Routine', routineDone, routineContent)}
    ${card('gamepractice', 'Game Day / Practice Day', gpDone, gamePracticeContent)}
    ${exercise ? card('exercise', 'Daily Exercise', exerciseDone, exerciseContent) : ''}
    ${(bibleOptIn && bibleVerse) ? card('bible', 'Bible Study', !!data.bibleDone, bibleContent) : ''}
    <h2 class="section-title" style="margin-top:16px">Yours</h2>
    ${planCard}
    ${card('keys', 'Your Keys', false, keysContent)}
  ` : '';

  return layout({
    title: 'Lock In',
    user,
    tabs: userTabs('mental', user),
    body: `<h1 class="page-title">Lock In</h1>
    ${showBiblePopup ? biblePopupHtml() : ''}
    ${questionnaireHtml}
    ${saved ? '<div class="notice">Saved — your plan is below.</div>' : ''}
    ${planFailed ? '<div class="notice">Baseline saved, but the plan didn\u2019t come through — tap the button again.</div>' : ''}
    ${cardsHtml}
    ${b.plan ? `
    <div class="card">
      <p style="margin:0">Feeling sped up or rushing in a game? <a href="/chat">Talk to Coach Skip →</a> — he'll give you one thing to lock back in.</p>
    </div>
    <p style="text-align:center;margin-top:24px"><a href="/mental-game?retake=1" class="hint">Retake the questionnaire</a></p>` : ''}`,
  });
}

// Questionnaire page — separate from the Lock In tab (Sep 23 2026). Bobby's
// rule: no flashing, no forcing. Small link at the bottom of Lock In to redo it.

// Coach-facing: edit a remote hitter's program.// Coach-facing: edit a remote hitter's program.
// Progression read card (Sep 2026): per-lift improving/stalled status from the
// logged weights + the data-driven next-block emphasis recommendation.
function progressionCard(pr) {
  const pillFor = (s) =>
    s === 'improving' ? '<span class="pill-good">improving</span>'
    : s === 'stalled' ? '<span class="pill-warn">stalled</span>'
    : s === 'regressing' ? '<span class="pill-bad">regressing</span>'
    : s === 'new' ? '<span class="pill">new</span>'
    : '<span class="pill">holding</span>';
  const lines = (pr.lines || [])
    .map((l) => `<li>${pillFor(l.status)} <strong>${esc(l.name)}</strong> <span class="hint-inline">${esc(l.detail)}</span></li>`)
    .join('');
  const adj = (pr.adjustments || []).map((a) => `<li>${esc(a)}</li>`).join('');
  return `<div class="card prog-read">
    <h2 class="routine-station" style="margin-top:0">Progression — next block read</h2>
    <p class="hint" style="margin-top:0">Block ${pr.blockNumber} · goal: ${esc(pr.trackLabel)} · arc: ${esc(pr.arcStep.label)}<br>
    <span class="hint-inline">${esc(pr.arcStep.detail)}</span></p>
    <p><strong>Suggested next-block emphasis: ${esc(pr.emphasisLabel)}</strong></p>
    ${lines ? `<ul class="prog-lines">${lines}</ul>` : '<p class="hint-inline">No lifting logs yet.</p>'}
    ${adj ? `<ul class="prog-adj">${adj}</ul>` : ''}
    <p class="hint-inline" style="margin-bottom:0">Built from his logged weights + RPE (estimated 1RM trends). You approve the final program — this just makes the call faster.</p>
  </div>`;
}

function programEditPage(user, p, profileEmail, hasLifting, progression, opts) {
  const o = opts || {};
  const blk = o.block || {};
  const subs = o.subs || [];
  const prog = p.prog || {};
  const grades = prog.grades && typeof prog.grades === 'object' ? prog.grades : {};
  const gradeFields = ['Load', 'Path', 'Connection', 'Timing', 'Power Production']
    .map(
      (g) =>
        `<label class="fld fld-inline">Grade — ${esc(g)}<input type="text" name="grade_${g.replace(/ /g, '_')}" value="${esc(grades[g] || '')}" maxlength="4" placeholder="B+"></label>`
    )
    .join('');
  const routine = Array.isArray(prog.routine) ? prog.routine : [];
  const itemLine = (it) => {
    const parts = [it.drill || ''];
    if (it.volume || it.video) parts.push(it.volume || '');
    if (it.video) parts.push(it.video);
    return parts.join(' | ');
  };
  const linkStatus = (items) => {
    let auto = 0,
      manual = 0,
      none = 0;
    for (const it of items || []) {
      if (it.video) (it.video_source === 'manual' ? manual++ : auto++);
      else none++;
    }
    return { auto, manual, none };
  };
  const catBlocks = routine
    .map((c, i) => {
      const st = linkStatus(c.items);
      const statusBits = [];
      if (st.auto) statusBits.push(`${st.auto} auto-linked`);
      if (st.manual) statusBits.push(`${st.manual} manual`);
      if (st.none) statusBits.push(`${st.none} need a link`);
      return `<div class="card routine-group prog-cat" data-cat>
        <div class="cat-head-row">
          <span class="hint-inline">Block ${i + 1}</span>
          <span class="cat-move">
            <button type="button" class="btn btn-sm" data-move-cat="-1" title="Move block up">↑</button>
            <button type="button" class="btn btn-sm" data-move-cat="1" title="Move block down">↓</button>
          </span>
        </div>
        <label class="fld">Category<input type="text" name="cat_${i}_name" value="${esc(c.category || '')}" maxlength="60"></label>
        <label class="fld">Drills — one per line, as <em>Drill</em>, <em>Drill | volume</em>, or <em>Drill | volume | video link</em>
          <textarea name="cat_${i}_items" rows="4">${esc((c.items || []).map(itemLine).join('\n'))}</textarea>
        </label>
        <div class="hint-inline">🔗 ${statusBits.join(' · ') || 'no drills'}. Paste a YouTube or library URL after the last | to set a link; delete a link to keep it blank. New library videos auto-link on their own — your links are never overwritten.</div>
        <button type="button" class="btn btn-danger btn-sm" data-remove-cat>Remove category</button>
      </div>`;
    })
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
  const draftBanner = prog.draft
    ? `<div class="draft-banner"><strong>DRAFT — built from the intake questionnaire.</strong> Review everything below, add your drills and cues, fix the lifting program, then save. Saving clears the draft flag.</div>`
    : '';
  // Progression read (Sep 2026): logged weights → improving/stalled per lift →
  // data-driven next-block emphasis. Makes Bobby's next-block approval fast.
  const progCard = progression ? progressionCard(progression) : '';
  // 4-week block status + next-block staging + the athlete's self-subs.
  const blockEnd = blk.block_start ? (() => { try { const d = new Date(blk.block_start + 'T12:00:00'); d.setDate(d.getDate() + 28); return d.toISOString().slice(0, 10); } catch (e) { return ''; } })() : '';
  const blockCard = `<div class="card"><h3 class="card-title">Training block</h3>
    <p class="hint" style="margin:0 0 8px">Block <strong>${esc(String(blk.block_number || 1))}</strong> · started ${esc(blk.block_start || '—')} · ends ${esc(blockEnd || '—')}</p>
    ${blk.next_lifting_id ? `<p class="hint" style="margin:0 0 8px">Next block staged: <strong>${esc(o.nextLiftName || '')}</strong> — flips ${esc(blk.next_block_start || '')}. <a href="/coach/lifting/${blk.next_lifting_id}/edit">Review / edit it</a></p>
    <form method="post" action="/coach/program/${p.id}/block-flip-now" class="inline-form" onsubmit="return confirm('Make the staged next block current right now?')"><button class="btn btn-sm" type="submit">Make current now</button></form>` : ''}
    <div class="row-actions">
      <form method="post" action="/coach/program/${p.id}/next-block" class="inline-form"><button class="btn btn-sm" type="submit">Build next block draft</button></form>
      <form method="post" action="/coach/program/${p.id}/block-bump" class="inline-form"><button class="btn btn-sm btn-quiet" type="submit">Start new block today</button></form>
    </div>
    <p class="hint-inline" style="margin:8px 0 0">Next-block drafts are built from his logged lifts (progression read) + goal arc + equipment. Staged blocks flip automatically on the date.</p>
  </div>`;
  const subsCard = subs.length ? `<div class="card"><h3 class="card-title">Recent substitutions</h3>
    <ul class="works-list">${subs.map((s) => `<li><span class="hint-inline">${esc(String(s.day || '').slice(0, 10))}</span> <strong>${esc(s.sub_name)}</strong> instead of ${esc(s.original_name)}${s.reason ? ` — <em>${esc(s.reason)}</em>` : ''}</li>`).join('')}</ul>
  </div>` : '';
  return layout({
    title: `Edit program — ${p.athlete_name}`,
    user,
    tabs: coachTabs('organizations', user.approvalCount, user),
    body: `<h1 class="page-title">Program — ${esc(p.athlete_name)}</h1>
    ${draftBanner}
    ${progCard}
    ${blockCard}
    ${subsCard}
    <p><a href="/coach/organizations">← Back to organizations</a>${profileEmail ? ` · <a href="/coach/user/${encodeURIComponent(profileEmail)}">View profile →</a>` : ''}</p>
    <form method="post" action="/coach/program/${p.id}/save" class="form">
      <div class="card routine-group">
        <label class="fld">Date range<input type="text" name="date_range" value="${esc(prog.date_range || '')}" maxlength="60" placeholder="8/18–9/16"></label>
        <label class="fld">Session order <span class="hint-inline">— which runs first when he trains</span>
          <select name="session_order">
            <option value="hitting_first"${(p.session_order || 'hitting_first') === 'hitting_first' ? ' selected' : ''}>Hitting first (default)</option>
            <option value="lifting_first"${p.session_order === 'lifting_first' ? ' selected' : ''}>Lifting first</option>
          </select></label>
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
      ${hasLifting ? '<p class="hint-inline"><strong>This athlete has a lifting program</strong> — their Med Ball blocks don\'t get their own tab; they show inside the <em>Lifting</em> tab, ahead of the lifts.</p>' : ''}
      <p class="hint-inline">Blocks named with <em>Mobility</em> feed the Mobility tab, <em>Med Ball</em> feeds the Med Ball tab (or lands inside the <em>Lifting</em> tab for athletes with a lifting program), <em>Prep</em> stays with Hitting. Speed work lives inside the <em>Lifting</em> program (its Speed section) — there's no Metabolic tab; legacy <em>Metabolic</em> blocks fold into the Lifting tab's Speed section. Naming a block is how tabs appear or disappear for the athlete.</p>
      <div id="prog-cats" data-next="${routine.length}">${catBlocks}</div>
      <p><button type="button" class="btn" id="prog-add-cat">+ Add block</button>
      <button type="button" class="btn" data-addcat-name="Mobility">+ Mobility block</button>
      <button type="button" class="btn" data-addcat-name="Med Ball">+ Med ball block</button></p>
      <p><button type="submit" class="btn btn-primary">Save program</button></p>
    </form>
`,
  });
}

// Coach dashboard section: the remote roster and their programs.
function remoteProgramsSection(list, canEdit) {
  const rows = list
    .map((r) => {
      const linked = r.user_email
        ? `<span class="pill">${esc(r.user_email)}</span>`
        : '<span class="hint-inline">no account yet</span>';
      const draftPill = r.is_draft ? ' <span class="pill-draft">Draft — unreviewed</span>' : '';
      const updated = r.updated_at ? ` · updated ${esc(r.updated_at.slice(0, 10))}` : '';
      const aliasNames = String(r.aliases || '')
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean);
      const aliasLine = aliasNames.length
        ? `<div class="hint-inline">also: ${aliasNames.map((a) => esc(a)).join(', ')}</div>`
        : '';
      const aliasForm = canEdit
        ? `<form method="post" action="/coach/remote/alias" class="inline-form" style="margin-top:4px">
            <input type="hidden" name="id" value="${r.id}">
            <input type="text" name="alias" placeholder="also known as" maxlength="80" class="input-sm" style="max-width:130px">
            <button class="btn btn-sm" type="submit">Add name</button>
          </form>`
        : '';
      const actions = canEdit
        ? `<div class="remote-actions">
          <a class="btn btn-sm" href="/coach/program/${r.id}/edit">Edit program</a>
          ${
            r.lifting_name
              ? `<a class="btn btn-sm" href="/coach/lifting">🏋 ${esc(r.lifting_name)}</a>`
              : `<a class="btn btn-sm" href="/coach/lifting">+ Lifting</a>`
          }
          ${
            r.user_email
              ? `<form method="post" action="/coach/remote/unlink" class="inline-form"><input type="hidden" name="id" value="${r.id}"><button class="btn btn-sm" type="submit">Unlink</button></form>`
              : `<form method="post" action="/coach/remote/link" class="inline-form"><input type="email" name="email" placeholder="hitter email" required class="input-sm"><input type="hidden" name="id" value="${r.id}"><button class="btn btn-sm" type="submit">Link</button></form>`
          }
          <form method="post" action="/coach/remote/remove" class="inline-form" data-confirm-remove="${esc(r.athlete_name)}"><input type="hidden" name="id" value="${r.id}"><button class="btn btn-sm btn-danger" type="submit">Remove</button></form>
        </div>`
        : '';
      return `<div class="remote-row">
        <div>${r.user_email ? `<strong>${athleteLink(r.user_email, esc(r.athlete_name))}</strong>` : `<strong>${esc(r.athlete_name)}</strong>`}${draftPill}<div class="hint-inline">${linked}${updated}</div>${aliasLine}
          ${aliasForm}
        </div>
        ${actions}
      </div>`;
    })
    .join('');
  const addForm = canEdit
    ? `<form method="post" action="/coach/remote/add" class="inline-form remote-add">
      <input type="text" name="name" placeholder="Full name" required maxlength="80" class="input-sm">
      <button class="btn btn-sm" type="submit">Add remote hitter</button>
    </form>`
    : '';
  return `<h2 class="section-head">Remote programs</h2>
  <div class="card">
    ${rows || '<div class="empty">No remote hitters yet.</div>'}
    ${addForm}
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
    title: 'Remote Library',
    user,
    tabs: userTabs('videos', user),
    body: `<h1 class="page-title">Remote Library</h1>
    ${cats.length ? `<input type="search" id="video-search" class="searchbar" placeholder="Search videos\u2026" autocomplete="off">` : ''}
    <div class="pill-row">${pills}</div>
    <div class="video-grid">${cards || '<div class="card empty">No videos yet — they\u2019ll appear here after the next sync.</div>'}</div>
    <div class="card empty" id="video-no-match" hidden>No library items match that search.</div>
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
  return `<h2 class="section-head">Remote Library</h2>
  <div class="card">
    <div class="hint-inline">${total} file${total === 1 ? '' : 's'} · ${syncLine} · syncs automatically from Drive</div>
    ${rows || '<div class="empty">Empty.</div>'}
    <div style="margin-top:10px"><a class="btn-small" href="/coach/library">Open Remote Library</a></div>
  </div>`;
}

function coachLibraryPage(user, cats, activeCat, videos, playing) {
  const canEdit = user.role === 'coach' && user.canEdit !== false;
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
            ${canEdit ? `<form method="post" action="/coach/library/toggle" style="display:inline">
              <input type="hidden" name="id" value="${v.id}">
              <input type="hidden" name="cat" value="${esc(activeCat)}">
              <button class="btn-small${v.hidden ? '' : ' btn-quiet'}" type="submit">${v.hidden ? 'Unhide' : 'Hide'}</button>
            </form>` : ''}
          </div>
        </div>
        ${canEdit ? `<form method="post" action="/coach/library/rename" class="lib-rename">
          <input type="hidden" name="id" value="${v.id}">
          <input type="hidden" name="cat" value="${esc(activeCat)}">
          <input type="text" name="custom_name" value="${esc(v.custom_name || '')}" placeholder="Rename\u2026" maxlength="200">
          <button class="btn-small" type="submit">Save</button>
        </form>` : ''}
      </div>`;
    })
    .join('');
  const player = playing
    ? `<h1 class="page-title">${esc((playing.custom_name && playing.custom_name.trim()) || playing.name)}</h1>
       <div class="video-player"><iframe src="https://drive.google.com/file/d/${encodeURIComponent(playing.drive_file_id)}/preview" allow="autoplay; fullscreen" allowfullscreen></iframe></div>`
    : '';
  return layout({
    title: 'Remote Library',
    user,
    tabs: coachTabs('videos', user.approvalCount, user),
    body: `<p><a href="/coach">\u2190 Dashboard</a></p>
    <h1 class="page-title">Remote Library</h1>
    <div class="hint-inline">Renames and hidden items are yours only — the Drive sync never overwrites them. New Drive files and PDFs appear here automatically.</div>
    ${player}
    <div class="pill-row">${pills}</div>
    ${rows || '<div class="card empty">No items in this category yet.</div>'}`,
  });
}

// Throwing summary for pitchers and two-way players: last 30 throwing
// sessions at a glance — session mix, command, workload, velo.
function throwingSummarySection(sum) {
  if (!sum) return '';
  const mix = Object.entries(sum.byType)
    .map(([t, n]) => `${pitchSessionTypeLabel(t)} ×${n}`)
    .join(' · ');
  return `<h2 class="section-head">Throwing summary</h2>
  <div class="card"><div class="checkin-grid">
    <div><span class="label">Sessions</span>${sum.sessions}</div>
    ${mix ? `<div><span class="label">Mix</span>${esc(mix)}</div>` : ''}
    ${sum.avgCommand != null ? `<div><span class="label">Avg command</span>${esc(sum.avgCommand)}</div>` : ''}
    ${sum.totalPitches ? `<div><span class="label">Total pitches</span>${esc(sum.totalPitches)}</div>` : ''}
    ${sum.avgVelo != null ? `<div><span class="label">Avg top velo</span>${esc(sum.avgVelo)}</div>` : ''}
  </div><p class="hint">Last ${sum.sessions} throwing session${sum.sessions === 1 ? '' : 's'}.</p></div>`;
}

function coachUser(user, name, checkins, whatWorks, thread, email, memories, routine, playerType, throwSum, msgUserId, opts) {
  const pt = playerType || 'hitter';
  // College-org privacy (Bobby, Sep 17 2026): coaches of programs that aren't
  // Bobby's own see the brief summary only — no chat history, no what-works
  // detail, no journal words on the cards.
  const skipImg = `<img src="${skipAvatar({ playerType: pt })}" class="skip-avatar" alt="Skip">`;
  const canEdit = user.role === 'coach' && user.canEdit !== false;
  const restricted = !!(opts && opts.restricted);
  const convo =
    thread && thread.length
      ? `<h2 class="section-head">Chat history</h2>
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
    tabs: coachTabs('hitters', user.approvalCount, user),
    body: `<h1 class="page-title">${esc(name)} ${rolePill(pt)}</h1>
    <p><a href="/coach/hitters">← Back to players</a>${msgUserId ? ` · <a class="btn-small" href="/coach/messages/${msgUserId}">Message</a>` : ''}</p>
    ${pt === 'pitcher' ? '' : routineReadonly(routine)}
    ${pt !== 'hitter' ? throwingSummarySection(throwSum) : ''}
    ${memorySection(email, memories, canEdit)}
    ${restricted ? '' : whatWorksSection(whatWorks || {}, { readOnly: true })}
    ${restricted ? '' : convo}
    ${checkins.length ? checkins.map((c) => checkinCard(c, { restricted })).join('') : '<div class="card empty">No check-ins yet.</div>'}
    ${canEdit ? `<p style="margin-top:28px;text-align:center"><a href="/coach/user/${encodeURIComponent(email)}/delete" style="color:#8a8a8a;font-size:14px">Delete hitter from the platform</a></p>` : ''}`,
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

// What Skip has learned about this player over time — Bobby's durable notes,
// injected into every Skip chat with this hitter. This is how Skip learns hitters.
function memorySection(email, memories, canEdit) {
  const items = (memories || [])
    .map(
      (m) => `<div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <div>${esc(m.fact)}</div>
        ${canEdit ? `<form method="post" action="/coach/user/${encodeURIComponent(email)}/memory/${m.id}/delete" style="margin:0">
          <button type="submit" class="btn-primary" style="padding:4px 10px;font-size:12px;background:#5a5a5a">Remove</button>
        </form>` : ''}
      </div>`
    )
    .join('');
  const addForm = canEdit
    ? `<div class="card"><form method="post" action="/coach/user/${encodeURIComponent(email)}/memory" class="form">
    <label>Teach Skip something about this hitter<input name="fact" maxlength="500" required placeholder="e.g. When he's rolling over, the cue 'stay inside it' in his own words fixed it — use that before any mechanical cue."></label>
    <button type="submit" class="btn-primary">Save to Skip's memory</button>
  </form></div>`
    : '';
  return `<h2 class="section-head">Learned about this player</h2>
  <p class="hint">Durable memory — read before every chat with this player. Best-day patterns, cues that work, what fixed slumps. This is how the app learns players over time.</p>
  ${items || '<div class="card empty">Nothing saved yet.</div>'}
  ${addForm}`;
}

// Confirm page before permanently deleting a hitter.
function coachDeleteHitterPage(user, hitter, name, checkinCount) {
  return layout({
    title: 'Delete hitter',
    user,
    tabs: coachTabs('hitters', user.approvalCount, user),
    body: `<h1 class="page-title">Delete hitter?</h1>
    <div class="card">
      <p>This will permanently remove <strong>${esc(name)}</strong> (${esc(hitter.email)}) from Diamond Daily — their account, ${checkinCount} check-in${checkinCount === 1 ? '' : 's'}, chat history, and routine.</p>
      <p class="hint">This can't be undone.</p>
      <form method="post" action="/coach/user/${encodeURIComponent(hitter.email)}/delete" class="form">
        <button type="submit" class="btn-primary" style="background:#a02020">Yes, delete ${esc(String(name).split(' ')[0] || 'hitter')}</button>
      </form>
      <p class="hint" style="text-align:center"><a href="/coach/user/${encodeURIComponent(hitter.email)}">Cancel — keep them</a></p>
    </div>`,
  });
}

// ---- Train Skip: Bobby's HQ for training Skip and reviewing his chats ----
// Proposals waiting on dual approval — shown to every coach. Nothing here
// enters Skip's Brain until every coach has approved it.
function proposalSection(proposals, user, canEdit) {
  const list = proposals || [];
  if (!list.length) return '';
  const cards = list
    .map((p) => {
      const approvedIds = new Set((p.approvals || []).map((a) => a.coach_id));
      const mine = approvedIds.has(user.id);
      const approveBtn = mine
        ? '<span class="hint-inline">You approved ✓</span>'
        : `<form method="post" action="/coach/skip/proposals/${p.id}/approve" style="margin:0"><button class="btn-small" type="submit">Approve</button></form>`;
      const rejectBtn = canEdit
        ? `<form method="post" action="/coach/skip/proposals/${p.id}/reject" style="margin:0"><button class="btn-small btn-quiet" type="submit">Reject</button></form>`
        : '';
      const who = (p.approvals || []).map((a) => esc(a.name)).join(', ') || 'nobody yet';
      return `<div class="card">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
          <strong>${esc(p.title)}</strong><span class="pill">${esc(p.type)}</span>
        </div>
        <div class="hint">proposed by ${esc(p.proposer_name)} · ${fmtDate(p.created_at)}</div>
        <div class="hint" style="white-space:pre-wrap;margin:8px 0">${esc(p.body)}</div>
        ${p.tags ? `<div class="hint">tags: ${esc(p.tags)}</div>` : ''}
        <div class="hint-inline" style="margin:8px 0">Approved by: ${who} — goes live when every coach has approved.</div>
        <div style="display:flex;gap:8px;margin-top:8px;align-items:center">${approveBtn}${rejectBtn}</div>
      </div>`;
    })
    .join('');
  return `<h2 class="section-head">Proposals waiting on approval</h2>
  <p class="hint">Nothing here enters Skip's Brain until <strong>every coach</strong> approves it.</p>
  ${cards}`;
}

function coachSkipPage(user, entries, hitters, thread, chatEnabled, saved, proposals) {
  const brain = require('./brain');
  const skipImg = `<img src="/skip-avatar.webp" class="skip-avatar" alt="Skip">`;
  const canEdit = user.role === 'coach' && user.canEdit !== false;
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
    : '<div class="card empty">No player has talked to Skip yet.</div>';

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
          ${canEdit ? `<form method="post" action="/coach/skip/brain/${e.id}/archive" style="margin:0">
            <input type="hidden" name="active" value="${e.active ? '0' : '1'}">
            <button type="submit" class="btn-primary" style="padding:4px 10px;font-size:12px;background:${e.active ? '#5a5a5a' : '#1f7a33'}">${e.active ? 'Archive' : 'Restore'}</button>
          </form>` : ''}
        </div>
        <div class="hint" style="white-space:pre-wrap;margin:8px 0">${esc(e.body)}</div>
        ${e.tags ? `<div class="hint">tags: ${esc(e.tags)}</div>` : ''}
        ${canEdit ? `<details style="margin-top:8px"><summary class="hint" style="cursor:pointer">Edit</summary>
          <form method="post" action="/coach/skip/brain/${e.id}" class="form" style="margin-top:8px">
            <label>Title<input name="title" value="${esc(e.title)}" maxlength="120" required></label>
            <label>Body<textarea name="body" rows="3" maxlength="2000" required>${esc(e.body)}</textarea></label>
            <label>Tags (space-separated, used for matching)<input name="tags" value="${esc(e.tags)}" maxlength="200"></label>
            <button type="submit" class="btn-primary" style="padding:6px 12px;font-size:13px">Save changes</button>
          </form>
        </details>` : ''}
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
    tabs: coachTabs('skip', user.approvalCount, user),
    body: `<h1 class="page-title">Train Skip</h1>
    <p class="hint">Talk to Skip directly. To make training <strong>stick</strong>, put it in his Brain below — small discrete entries he pulls from when they're relevant. That's what fixed the "more training = worse Skip" problem: no more one giant note.</p>
    ${saved ? '<div class="notice">Brain updated — Skip is using it with every hitter now.</div>' : ''}
    ${proposalSection(proposals, user, canEdit)}
    <h2 class="section-head">Talk to Skip</h2>
    ${
      !canEdit
        ? `<div class="card empty">You can read Skip's Brain below and propose additions — a proposal goes live once every coach approves it.</div>`
        : chatEnabled
        ? `<div id="chat-log" class="chat-log">${
            msgs ||
            `<div class="msg msg-skip">${skipImg}<div class="msg-bubble">Coach — what do you want me doing different with your players?</div></div>`
          }</div>
        <form id="chat-form" class="chat-form" data-endpoint="/api/coach/chat" autocomplete="off">
          <input id="chat-input" type="text" placeholder="Train Skip…" maxlength="2000" required>
          <button type="submit" class="btn-primary">Send</button>
        </form>`
        : `<div class="card empty">Skip's chat isn't switched on yet — check back soon.</div>`
    }
    ${canEdit ? `<h2 class="section-head">Log a correction</h2>
    <div class="card">
      <p class="hint">Skip got something wrong with a hitter? Log it here — it becomes an <strong>example</strong> in his Brain so the fix sticks. This is the fastest way to train him now.</p>
      <form method="post" action="/coach/skip/correction" class="form">
        <label>What the hitter said<input name="hitter_said" maxlength="500" placeholder="e.g. I'm rolling over everything"></label>
        <label>What Skip said (wrong)<input name="skip_said" maxlength="500" placeholder="e.g. Widen your stance"></label>
        <label>What he should have said<textarea name="should_say" rows="3" maxlength="1000" required placeholder="e.g. That's the bat wrapping around your head at launch — think 'swing down the line'..."></textarea></label>
        <button type="submit" class="btn-primary">Save correction</button>
      </form>
    </div>` : `<h2 class="section-head">Propose a correction</h2>
    <div class="card">
      <p class="hint">Skip got something wrong with a hitter? Propose the fix — it becomes an <strong>example</strong> in his Brain once every coach approves it.</p>
      <form method="post" action="/coach/skip/propose-correction" class="form">
        <label>What the hitter said<input name="hitter_said" maxlength="500" placeholder="e.g. I'm rolling over everything"></label>
        <label>What Skip said (wrong)<input name="skip_said" maxlength="500" placeholder="e.g. Widen your stance"></label>
        <label>What he should have said<textarea name="should_say" rows="3" maxlength="1000" required placeholder="e.g. That's the bat wrapping around your head at launch — think 'swing down the line'..."></textarea></label>
        <button type="submit" class="btn-primary">Propose correction</button>
      </form>
    </div>`}
    <h2 class="section-head">Skip's Brain</h2>
    ${canEdit ? `<div class="card">
      <p class="hint"><strong>Rules</strong> always apply. Everything else is pulled in only when it matches what the hitter is talking about. Archive anything stale instead of deleting — you can restore it.</p>
      <form method="post" action="/coach/skip/brain" class="form">
        <label>Type<select name="type">${typeOptions}</select></label>
        <label>Title<input name="title" maxlength="120" required placeholder="e.g. Bat drag fix"></label>
        <label>Body<textarea name="body" rows="3" maxlength="2000" required placeholder="The cue, read, or rule — keep it to a sentence or two."></textarea></label>
        <label>Tags (space-separated, used for matching)<input name="tags" maxlength="200" placeholder="e.g. mechanics bat-drag"></label>
        <button type="submit" class="btn-primary">Add to Brain</button>
      </form>
    </div>` : `<div class="card">
      <p class="hint"><strong>Rules</strong> always apply. Everything else is pulled in only when it matches what the hitter is talking about. Propose an addition — it goes live once every coach approves.</p>
      <form method="post" action="/coach/skip/propose" class="form">
        <label>Type<select name="type">${typeOptions}</select></label>
        <label>Title<input name="title" maxlength="120" required placeholder="e.g. Bat drag fix"></label>
        <label>Body<textarea name="body" rows="3" maxlength="2000" required placeholder="The cue, read, or rule — keep it to a sentence or two."></textarea></label>
        <label>Tags (space-separated, used for matching)<input name="tags" maxlength="200" placeholder="e.g. mechanics bat-drag"></label>
        <button type="submit" class="btn-primary">Propose to Brain</button>
      </form>
    </div>`}
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
  const canEdit = isCoach && user.canEdit !== false;
  const tabs = isCoach ? coachTabs('settings', user.approvalCount, user) : userTabs('settings', user);
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
        ${isCoach ? '' : `<label>Date of birth<input type="date" name="date_of_birth" value="${esc(user.dateOfBirth || '')}" max="${new Date().toISOString().slice(0, 10)}"></label>`}
        <button class="btn-primary" type="submit">Save changes</button>
      </form>
    </div>
    ${isCoach ? '' : `<div class="card">
      <h2 class="section-head">Player role</h2>
      <p class="hint">This decides which check-in you get: hitting, pitching, or a combined one for both.</p>
      <form method="post" action="/settings/role" class="form">
        <fieldset class="role-picker">
          <div class="role-options">
          <label class="role-option"><input type="radio" name="player_type" value="hitter"${user.playerType !== 'pitcher' && user.playerType !== 'two_way' ? ' checked' : ''}> <span><strong>Hitter</strong></span></label>
          <label class="role-option"><input type="radio" name="player_type" value="pitcher"${user.playerType === 'pitcher' ? ' checked' : ''}> <span><strong>Pitcher</strong></span></label>
          <label class="role-option"><input type="radio" name="player_type" value="two_way"${user.playerType === 'two_way' ? ' checked' : ''}> <span><strong>Two-way</strong></span></label>
          </div>
        </fieldset>
        <button class="btn-primary" type="submit">Save role</button>
      </form>
    </div>`}
    ${isCoach ? '' : `<div class="card">
      <h2 class="section-head">Organization / organization</h2>
      ${user.organizationId && user.organizationName
        ? `<p>You&apos;re with <strong>${esc(user.organizationName)}</strong>${user.teamName ? ` \u00b7 team <strong>${esc(user.teamName)}</strong>` : ''} \u2014 your organization&apos;s coach can see your check-ins.</p>
           ${user.skipChatDisabled ? `<p class="hint">Your organization has Talk to Skip turned off, so it isn&apos;t available on your account.</p>` : ''}
           <form method="post" action="/settings/organization" class="form">
             <button class="btn-small btn-quiet" type="submit" name="organization_code" value="">Leave ${esc(user.organizationName)}</button>
           </form>`
        : `<p class="hint">Playing for a organization on Diamond Daily? Enter the signup code your coach gave you \u2014 the program code or your team\u2019s code.</p>
           <form method="post" action="/settings/organization" class="form">
             <label>Organization or team code<input name="organization_code" autocomplete="off" placeholder="e.g. TESTUN-X7K2" style="text-transform:uppercase"></label>
             <button class="btn-primary" type="submit">Join organization</button>
           </form>
           <p class="hint">Heads up: if your organization turned off Talk to Skip, joining removes your access to it.</p>`}
    </div>`}
    ${isCoach && canEdit ? `<div class="card">
      <h2 class="section-head">Notifications</h2>
      ${o.pushOn
        ? `<p><span class="badge ok">On</span></p>
           <p class="hint">You get a push for everything: player approval requests, check-in log alerts, and new messages. Use the Alerts on/off buttons on My Players to pick which players trigger a log alert.</p>
           <form method="post" action="/settings/push/off" class="form">
             <button class="btn-small btn-quiet" type="submit">Turn off notifications</button>
           </form>`
        : `<p><span class="badge warn">Off</span></p>
           <p class="hint">One switch for everything: player approval requests, check-in log alerts, and new messages.</p>
           <p><button type="button" class="btn-primary" id="push-enable-btn">Turn on notifications</button></p>
           <p class="hint">On iPhone, add the app to your home screen first — push doesn&apos;t work from Safari.</p>`}
    </div>` : ''}
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
    ${canEdit && o.coaches ? coachesSection(o.coaches, o.selfId || user.id) : ''}
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


// ---- Intake questionnaire views (Sep 2026) ----
// Detailed multi-step intake. Bobby: "everything knowable about a guy" —
// thorough, organized in sections with a progress indicator.

function intakeFormPage(token, err, values, opts) {
  const v = values || {};
  const pre = opts && opts.prefillLead ? opts.prefillLead : null;
  // Lead-bound link: the athlete already gave us the basics on the website
  // application — show what's pre-filled so they can confirm, not re-type.
  const prefillBanner = pre
    ? `<div class="card" style="margin:0 0 12px;border-left:3px solid var(--accent,#2e7d32)">` +
      `<strong>✓ Already got your application${pre.age_level ? ` (${esc(pre.age_level)})` : ''}.</strong> ` +
      `We filled in your name, phone, and goals below — check they're right and fix anything that's off.</div>`
    : '';
  const ival = (n) => esc(String((v[n] != null ? v[n] : '') || ''));
  const ivc = (n, val) => {
    const cur = v[n];
    const on = Array.isArray(cur) ? cur.includes(val) : String(cur || '') === String(val);
    return on ? ' checked' : '';
  };
  const checkRow = (name, val, label, hint) =>
    `<label class="pick"><input type="checkbox" name="${name}" value="${val}"${ivc(name, val)}> <span><strong>${label}</strong>${hint ? ` <span class="hint-inline">${hint}</span>` : ''}</span></label>`;
  const step = (title, inner) => `<fieldset class="istep" data-title="${title}"><legend class="istep-title">${title}</legend>${inner}</fieldset>`;
  const req = ' required';
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  return layout({
    title: 'Athlete intake',
    user: null,
    tabs: [],
    body: `<div class="login-card card intake-card">
      <img src="/diamond-daily-logo.jpg" class="brand-logo-full" alt="Diamond Daily">
      <h1 class="page-title" style="margin-top:4px">Athlete intake</h1>
      <p class="hint">This is how Coach Bobby builds your program — the more detail you give, the better it fits. Takes most guys 10–15 minutes.</p>
      ${prefillBanner}
      <div class="intake-progress"><div class="intake-bar"><div id="ibar"></div></div><div id="istep-label" class="hint"></div></div>
      ${err ? `<div class="error">${esc(err)}</div>` : ''}
      <form method="post" action="/intake/${esc(token)}/submit" class="form" id="intake-form" novalidate>

      ${step('1 · About you', `
        <label>First name<input type="text" name="first_name" value="${ival('first_name')}" maxlength="40"${req}></label>
        <label>Last name<input type="text" name="last_name" value="${ival('last_name')}" maxlength="40"${req}></label>
        <label>Email<input type="email" name="email" value="${ival('email')}" maxlength="120"${req}></label>
        <label>Phone <span class="hint-inline">(so Bobby can text you)</span><input type="tel" name="phone" value="${ival('phone')}" maxlength="30"></label>
        <label>Date of birth<input type="date" name="date_of_birth" id="dob" value="${ival('date_of_birth')}"${req}></label>
        <div class="two-col">
          <label>Height <span class="hint-inline">(e.g. 6'1")</span><input type="text" name="height" value="${ival('height')}" maxlength="20"></label>
          <label>Weight <span class="hint-inline">(lbs)</span><input type="text" name="weight" value="${ival('weight')}" maxlength="20" inputmode="numeric"></label>
        </div>
        <div id="parent-fields" hidden>
          <p class="hint"><strong>Under 18?</strong> A parent or guardian fills this in.</p>
          <label>Parent/guardian full name<input type="text" name="parent_name" value="${ival('parent_name')}" maxlength="80"></label>
          <label>Parent/guardian email<input type="email" name="parent_email" value="${ival('parent_email')}" maxlength="120"></label>
        </div>`)}

      ${step('2 · Your goals', `
        <p class="hint" style="margin-top:0">Check everything you're after. Pick your #1 in the box below.</p>
        <div class="pick-group">
          ${checkRow('goals', 'Build exit velocity', 'Build exit velocity', 'hit the ball harder')}
          ${checkRow('goals', 'Get stronger', 'Get stronger', 'overall strength')}
          ${checkRow('goals', 'Strong but not explosive', 'Strong but not explosive', "I'm strong — I need to move fast")}
          ${checkRow('goals', 'Stay healthy', 'Stay healthy', 'train without breaking down')}
        </div>
        <label>Other goals<input type="text" name="goals_other" value="${ival('goals_other')}" maxlength="200" placeholder="e.g. make varsity, add 5 mph EV"></label>
        <label>What does success look like 90 days from now?<textarea name="goals_90" rows="3" maxlength="500" placeholder="Be specific — numbers help.">${ival('goals_90')}</textarea></label>`)}

      ${step('3 · Health & injuries', `
        <p class="hint" style="margin-top:0">Be honest here — this is how your lifting stays safe. Nothing you write benches you; it just changes the plan.</p>
        <label>Current injuries — describe each one<textarea name="injury_current" rows="3" maxlength="1000" placeholder="e.g. right shoulder impingement, hurts on overhead pressing">${ival('injury_current')}</textarea></label>
        <div class="two-col">
          <label>Body area<input type="text" name="injury_area" value="${ival('injury_area')}" maxlength="200" placeholder="e.g. right shoulder"></label>
          <label>Severity (1–10)<input type="text" name="injury_severity" value="${ival('injury_severity')}" maxlength="20" inputmode="numeric" placeholder="e.g. 4"></label>
        </div>
        <label>Cleared to train by a doctor?<select name="injury_cleared">
          <option value="">—</option>
          <option value="yes"${ivc('injury_cleared', 'yes') ? ' selected' : ''}>Yes</option>
          <option value="no"${ivc('injury_cleared', 'no') ? ' selected' : ''}>No</option>
          <option value="na"${ivc('injury_cleared', 'na') ? ' selected' : ''}>No injury / N/A</option>
        </select></label>
        <label>Past injuries or surgeries<textarea name="injury_past" rows="2" maxlength="1000" placeholder="e.g. Tommy John 2023, ankle sprain last spring">${ival('injury_past')}</textarea></label>
        <label>Any pain or limitations right now?<textarea name="pain_now" rows="2" maxlength="500" placeholder="e.g. left knee aches after squatting deep">${ival('pain_now')}</textarea></label>
        <label>Anything a doctor told you to avoid?<input type="text" name="doctor_notes" value="${ival('doctor_notes')}" maxlength="500"></label>`)}

      ${step('4 · Training background', `
        <div class="two-col">
          <label>Years training baseball<input type="text" name="years_training" value="${ival('years_training')}" maxlength="20"></label>
          <label>Lifting experience<select name="lifting_experience">
            <option value="">—</option>
            ${['Never lifted', 'Beginner (<1 yr)', 'Intermediate (1–3 yrs)', 'Advanced (3+ yrs)'].map((o) => `<option${ivc('lifting_experience', o) ? ' selected' : ''}>${o}</option>`).join('')}
          </select></label>
        </div>
        <label>Programs you've run before<textarea name="past_programs" rows="2" maxlength="1000" placeholder="e.g. school weight room program, 5x5, Driveline, etc.">${ival('past_programs')}</textarea></label>
        <label>What worked for you?<textarea name="what_worked" rows="2" maxlength="1000">${ival('what_worked')}</textarea></label>
        <label>What didn't work?<textarea name="what_didnt" rows="2" maxlength="1000">${ival('what_didnt')}</textarea></label>
        <p class="hint"><strong>Best lifts</strong> <span class="hint-inline">(if you know them — estimates are fine)</span></p>
        <div class="three-col">
          <label>Squat<input type="text" name="squat_max" value="${ival('squat_max')}" maxlength="20" inputmode="numeric" placeholder="lbs"></label>
          <label>Bench<input type="text" name="bench_max" value="${ival('bench_max')}" maxlength="20" inputmode="numeric" placeholder="lbs"></label>
          <label>Deadlift<input type="text" name="deadlift_max" value="${ival('deadlift_max')}" maxlength="20" inputmode="numeric" placeholder="lbs"></label>
        </div>
        <label class="pick"><input type="checkbox" name="strong_not_explosive" value="1"${ivc('strong_not_explosive', '1')}> <span><strong>I feel strong but not explosive</strong></span></label>`)}

      ${step('5 · Your equipment', `
        <p class="hint" style="margin-top:0">Check <strong>everything</strong> you can actually use week to week. Your program is built only from what you check — nothing you can't do.</p>
        <div class="pick-group">
          ${checkRow('equipment', 'full_gym', 'Full commercial gym', 'everything below and more')}
          ${checkRow('equipment', 'barbell', 'Barbell + plates', '')}
          ${checkRow('equipment', 'rack', 'Squat rack / power rack', '')}
          ${checkRow('equipment', 'dumbbell', 'Dumbbells', '')}
          ${checkRow('equipment', 'kettlebell', 'Kettlebells', '')}
          ${checkRow('equipment', 'trapbar', 'Trap bar / hex bar', '')}
          ${checkRow('equipment', 'bands', 'Resistance bands', '')}
          ${checkRow('equipment', 'pullup_bar', 'Pull-up bar', '')}
          ${checkRow('equipment', 'bench', 'Adjustable / flat bench', '')}
          ${checkRow('equipment', 'medball', 'Medicine balls', '')}
          ${checkRow('equipment', 'plyo_box', 'Plyo box', '')}
          ${checkRow('equipment', 'sled', 'Sled / prowler', '')}
          ${checkRow('equipment', 'cables', 'Cable machine', '')}
          ${checkRow('equipment', 'field_space', 'Field / open space for sprints', '')}
          ${checkRow('equipment', 'jump_rope', 'Jump rope', '')}
        </div>
        <label>Details — weights, limits, what's shared or crowded<textarea name="equipment_detail" rows="3" maxlength="1000" placeholder="e.g. dumbbells up to 50 lbs, home garage gym, no leg machines, med balls 6/10/14 lb">${ival('equipment_detail')}</textarea></label>`)}

      ${step('6 · Availability & season', `
        <div class="two-col">
          <label>Days per week you can HIT <span class="hint-inline">(Bobby recommends 5–6)</span>
            <select name="hit_days_per_week">${[1, 2, 3, 4, 5, 6, 7].map((d) => `<option value="${d}"${String(v.hit_days_per_week || 5) === String(d) ? ' selected' : ''}>${d}</option>`).join('')}</select></label>
          <label>Days per week you can LIFT <span class="hint-inline">(Bobby recommends 4)</span>
            <select name="lift_days_per_week">${[1, 2, 3, 4, 5, 6, 7].map((d) => `<option value="${d}"${String(v.lift_days_per_week || 4) === String(d) ? ' selected' : ''}>${d}</option>`).join('')}</select></label>
        </div>
        <p class="hint"><strong>Which weekdays</strong> can you train?</p>
        <div class="pick-group pick-inline">${days.map((d) => `<label class="pick chip"><input type="checkbox" name="train_days" value="${d}"${ivc('train_days', d)}> <span>${d.slice(0, 3)}</span></label>`).join('')}</div>
        <div class="two-col">
          <label>Typical session length<input type="text" name="session_length" value="${ival('session_length')}" maxlength="40" placeholder="e.g. 60–90 min"></label>
          <label>Games per week <span class="hint-inline">(in-season)</span><input type="text" name="games_per_week" value="${ival('games_per_week')}" maxlength="20" inputmode="numeric"></label>
        </div>
        <p class="hint"><strong>Season status</strong> <span class="hint-inline">— your blocks are built around this</span></p>
        <div class="pick-group">
          <label class="pick"><input type="radio" name="season_phase" value="offseason"${(!v.season_phase || v.season_phase === 'offseason') ? ' checked' : ''}> <span><strong>Off-season</strong> <span class="hint-inline">— building time</span></span></label>
          <label class="pick"><input type="radio" name="season_phase" value="preseason"${v.season_phase === 'preseason' ? ' checked' : ''}> <span><strong>Pre-season</strong> <span class="hint-inline">— ramping up</span></span></label>
          <label class="pick"><input type="radio" name="season_phase" value="inseason"${v.season_phase === 'inseason' ? ' checked' : ''}> <span><strong>In-season</strong> <span class="hint-inline">— maintaining, not burying you</span></span></label>
        </div>
        <label>Season / practice details<textarea name="season_detail" rows="2" maxlength="500" placeholder="e.g. HS season starts March, practice M–F 4–6pm">${ival('season_detail')}</textarea></label>
        <label>Schedule constraints (school, work, travel)<textarea name="schedule_constraints" rows="2" maxlength="500">${ival('schedule_constraints')}</textarea></label>`)}

      ${step('7 · Hitting resources', `
        <p class="hint" style="margin-top:0">Be exact — Bobby programs only what you actually have. And the big one: <strong>do you have someone who can feed you consistently?</strong></p>
        <div class="pick-group">
          ${checkRow('has_tee', '1', 'I have a batting tee', '')}
          ${checkRow('has_net', '1', 'I have a net', '')}
          ${checkRow('has_cage', '1', 'I have cage access', '')}
          ${checkRow('has_machine', '1', 'I have a pitching machine', '')}
          ${checkRow('has_feed_partner', '1', 'I have someone who can feed me front toss / side toss consistently', 'this one matters most')}
        </div>
        <label>Who feeds you? How often?<input type="text" name="feed_partner_detail" value="${ival('feed_partner_detail')}" maxlength="300" placeholder="e.g. my dad, 3x a week"></label>
        <p class="hint"><strong>Which hitting environments</strong> do you train in?</p>
        <div class="pick-group pick-inline">
          ${[['tee', 'Tee'], ['side_toss', 'Side toss'], ['front_toss', 'Front toss'], ['machine', 'Machine'], ['live', 'Live'], ['other', 'Other']].map(([val, label]) => `<label class="pick chip"><input type="checkbox" name="hitting_progression" value="${val}"${ivc('hitting_progression', val)}> <span>${label}</span></label>`).join('')}
        </div>
        <div class="two-col">
          <label>Current exit velo <span class="hint-inline">(mph, if known)</span><input type="text" name="current_ev" value="${ival('current_ev')}" maxlength="20" inputmode="decimal"></label>
          <label>Current bat speed <span class="hint-inline">(mph, if known)</span><input type="text" name="current_bat_speed" value="${ival('current_bat_speed')}" maxlength="20" inputmode="decimal"></label>
        </div>`)}

      ${step('8 · Program pieces', `
        <p class="hint" style="margin-top:0">What do you want in your program?</p>
        <div class="pick-group" data-required-group="components">
          ${checkRow('components', 'mobility', 'Mobility', 'baseball-specific: hips, t-spine, shoulders, ankles')}
          ${checkRow('components', 'hitting', 'Hitting', "Bobby picks your drills")}
          ${checkRow('components', 'lifting', 'Lifting', 'speed + med ball + explosive work included automatically')}
          ${checkRow('components', 'medball', 'Med ball only', 'without lifting — lifters get it inside lifting')}
        </div>
        <p class="hint" id="lift-note" hidden><strong>Lifting selected:</strong> med ball and explosive work come with it — no need to check med ball separately.</p>`)}

      ${step('9 · Lifestyle', `
        <p class="hint" style="margin-top:0">Recovery is training. This changes how hard Bobby can push you.</p>
        <div class="two-col">
          <label>Hours of sleep<input type="text" name="sleep_hours" value="${ival('sleep_hours')}" maxlength="20" placeholder="e.g. 7–8"></label>
          <label>Sleep quality<select name="sleep_quality">
            <option value="">—</option>
            ${['Great', 'Good', 'OK', 'Poor'].map((o) => `<option${ivc('sleep_quality', o) ? ' selected' : ''}>${o}</option>`).join('')}
          </select></label>
        </div>
        <label>Nutrition — what does a normal day of eating look like?<textarea name="nutrition" rows="3" maxlength="1000" placeholder="Be honest. Are you eating enough? Protein?">${ival('nutrition')}</textarea></label>
        <label>Stress / life load<textarea name="stress" rows="2" maxlength="500" placeholder="School, work, anything heavy right now">${ival('stress')}</textarea></label>
        <label>Anything else Bobby should know?<textarea name="other_notes" rows="3" maxlength="2000">${ival('other_notes')}</textarea></label>`)}

      ${step('10 · Submit', `
        <p class="hint" style="margin-top:0">Here's what happens next:</p>
        <ol class="hint" style="padding-left:18px">
          <li>Your account is created and a first-draft program is built from your answers.</li>
          <li>Bobby reviews everything, picks your hitting drills, and finalizes the program.</li>
          <li>You sign a training waiver, then your program unlocks.</li>
        </ol>
        <label class="pick"><input type="checkbox" name="agree_terms" value="1"${req}> <span>I agree to the <a href="/terms" target="_blank" rel="noopener">Terms of Service</a> and <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a>.</span></label>`)}

        <div class="intake-nav">
          <button type="button" class="btn" id="iback">← Back</button>
          <button type="button" class="btn-primary" id="inext">Next →</button>
          <button type="submit" class="btn-primary" id="isubmit" hidden>Build my program</button>
        </div>
      </form>
      <script>
      (function(){
        document.documentElement.classList.add('js');
        var steps = Array.prototype.slice.call(document.querySelectorAll('.istep'));
        var i = 0, bar = document.getElementById('ibar'), label = document.getElementById('istep-label');
        var back = document.getElementById('iback'), next = document.getElementById('inext'), submit = document.getElementById('isubmit');
        function show(n){
          i = Math.max(0, Math.min(steps.length - 1, n));
          steps.forEach(function(s, k){ s.classList.toggle('active', k === i); });
          bar.style.width = Math.round(((i + 1) / steps.length) * 100) + '%';
          label.textContent = 'Step ' + (i + 1) + ' of ' + steps.length + ' — ' + steps[i].getAttribute('data-title');
          back.hidden = (i === 0);
          next.hidden = (i === steps.length - 1);
          submit.hidden = (i !== steps.length - 1);
          window.scrollTo(0, 0);
        }
        function validStep(){
          var ok = true, first = null;
          var reqs = steps[i].querySelectorAll('[required]');
          var groups = {};
          reqs.forEach(function(el){
            if (el.type === 'checkbox' || el.type === 'radio') {
              (groups[el.name] = groups[el.name] || []).push(el);
            } else if (!String(el.value || '').trim()) { ok = false; first = first || el; el.classList.add('field-err'); }
            else el.classList.remove('field-err');
          });
          Object.keys(groups).forEach(function(name){
            var any = groups[name].some(function(el){ return el.checked; });
            groups[name].forEach(function(el){ el.classList.toggle('field-err', !any); });
            if (!any) { ok = false; first = first || groups[name][0]; }
          });
          var cg = steps[i].querySelector('[data-required-group]');
          if (cg) {
            var anyc = cg.querySelectorAll('input:checked').length > 0;
            cg.classList.toggle('group-err', !anyc);
            if (!anyc) { ok = false; first = first || cg; }
          }
          if (!ok && first && first.scrollIntoView) first.scrollIntoView({ block: 'center' });
          return ok;
        }
        next.addEventListener('click', function(){ if (validStep()) show(i + 1); });
        back.addEventListener('click', function(){ show(i - 1); });
        // Under-18 parent fields
        var dob = document.getElementById('dob'), pf = document.getElementById('parent-fields');
        function checkDob(){
          if (!dob.value || !pf) return;
          var d = new Date(dob.value + 'T12:00:00'), now = new Date();
          var age = now.getFullYear() - d.getFullYear();
          var m = now.getMonth() - d.getMonth();
          if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
          pf.hidden = !(age < 18);
        }
        if (dob) { dob.addEventListener('change', checkDob); checkDob(); }
        // Lifting includes med ball + explosive
        var liftCb = document.querySelector('input[name="components"][value="lifting"]');
        var liftNote = document.getElementById('lift-note');
        function checkLift(){ if (liftNote) liftNote.hidden = !(liftCb && liftCb.checked); }
        if (liftCb) { liftCb.addEventListener('change', checkLift); checkLift(); }
        show(0);
      })();
      </script>
    </div>`,
  });
}

// Coach view of one intake response + the account/program it created.
function intakeDetailPage(user, row) {
  const a = row.answers || {};
  const athlete = [row.first_name, row.last_name].filter(Boolean).join(' ') || row.email;
  const sec = (t, inner) => inner ? `<div class="card"><h3 class="card-title">${t}</h3>${inner}</div>` : '';
  const kv = (k, val) => val ? `<div class="remote-row"><div><strong>${k}</strong></div><div style="text-align:right;max-width:60%">${esc(String(val)).replace(/\n/g, '<br>')}</div></div>` : '';
  const list = (k, arr) => (arr && arr.length) ? kv(k, arr.join(', ')) : '';
  const yn = (b) => b ? 'Yes' : '—';
  const waiver = row.waiver_signed_at
    ? `<span class="pill">Signed ${esc(String(row.waiver_signed_at).slice(0, 10))} by ${esc(row.waiver_name || '')}</span>`
    : '<span class="pill-warn">Not signed yet</span>';
  return layout({
    title: 'Intake — ' + athlete,
    user,
    tabs: coachTabs('programs', user.approvalCount, user),
    body: `<h1 class="page-title">Intake — ${esc(athlete)}</h1>
    <p class="hint">Submitted ${esc(String(row.created_at).slice(0, 10))} · Status: <strong>${esc(row.status || 'pending')}</strong> · Waiver: ${waiver}</p>
    ${row.remote_program_id ? `<p><a class="btn-primary" href="/coach/program/${row.remote_program_id}/edit" style="text-decoration:none;display:inline-block">Edit draft program</a> <a class="btn" href="/coach/players?search=${encodeURIComponent(athlete)}" style="text-decoration:none">Approve athlete</a></p>` : '<p class="hint">No program linked.</p>'}
    ${sec('Athlete', kv('Name', athlete) + kv('Email', row.email) + kv('Phone', a.phone) + kv('Date of birth', a.date_of_birth) + kv('Height / weight', [a.height, a.weight].filter(Boolean).join(' / ')) + kv('Parent/guardian', [a.parent_name, a.parent_email].filter(Boolean).join(' · ')))}
    ${sec('Goals', list('Goals', a.goals) + kv('Other goals', a.goals_other) + kv('90-day goal', a.goals_90) + kv('Current EV / bat speed', [a.current_ev, a.current_bat_speed].filter(Boolean).join(' / ')))}
    ${sec('Health & injuries', kv('Current injuries', a.injury_current) + kv('Area', a.injury_area) + kv('Severity', a.injury_severity) + kv('Cleared to train', a.injury_cleared) + kv('Past injuries/surgeries', a.injury_past) + kv('Current pain', a.pain_now) + kv("Doctor's notes", a.doctor_notes))}
    ${sec('Training background', kv('Years training', a.years_training) + kv('Lifting experience', a.lifting_experience) + kv('Past programs', a.past_programs) + kv('What worked', a.what_worked) + kv("What didn't", a.what_didnt) + kv('Best lifts', [a.squat_max && ('Squat ' + a.squat_max), a.bench_max && ('Bench ' + a.bench_max), a.deadlift_max && ('DL ' + a.deadlift_max)].filter(Boolean).join(' / ')) + kv('Strong but not explosive', a.strong_not_explosive ? 'Yes' : '—'))}
    ${sec('Equipment', list('Checked', a.equipment) + kv('Details', a.equipment_detail))}
    ${sec('Availability & season', list('Components', a.components) + kv('Hit days/week', a.hit_days_per_week) + kv('Lift days/week', a.lift_days_per_week) + list('Training weekdays', a.train_days) + kv('Session length', a.session_length) + kv('Games/week', a.games_per_week) + kv('Season phase', a.season_phase) + kv('Season detail', a.season_detail) + kv('Schedule constraints', a.schedule_constraints))}
    ${sec('Hitting resources', kv('Tee', yn(a.has_tee)) + kv('Net', yn(a.has_net)) + kv('Cage', yn(a.has_cage)) + kv('Machine', yn(a.has_machine)) + kv('Feed partner', yn(a.has_feed_partner)) + kv('Feeder detail', a.feed_partner_detail) + list('Environments', a.hitting_progression))}
    ${sec('Lifestyle', kv('Sleep', [a.sleep_hours, a.sleep_quality].filter(Boolean).join(' ')) + kv('Nutrition', a.nutrition) + kv('Stress', a.stress) + kv('Other notes', a.other_notes))}`,
  });
}

// After intake submit: password setup before the account goes live.
function welcomePage(token, err) {
  return layout({
    title: 'Set up your account',
    user: null,
    tabs: [],
    body: `<div class="login-card card">
      <img src="/diamond-daily-logo.jpg" class="brand-logo-full" alt="Diamond Daily">
      <h1 class="page-title">You're in the queue</h1>
      <p class="hint">Your answers are with Coach Bobby — he's building your program now. Set a password so you can log in when it's ready.</p>
      ${err ? `<div class="error">${esc(err)}</div>` : ''}
      <form method="post" action="/welcome/${esc(token)}" class="form">
        <label>New password<input type="password" name="password" required minlength="8" autocomplete="new-password"></label>
        <label>Confirm password<input type="password" name="confirm_password" required minlength="8" autocomplete="new-password"></label>
        <button class="btn-primary" type="submit">Set password</button>
      </form>
    </div>`,
  });
}

// Liability waiver. Versioned text pinned in WAIVER_* server-side; signing
// stores the version + typed names so Bobby can see exactly what was signed.
function waiverPage(user, err, opts) {
  const o = opts || {};
  const paras = (o.paragraphs || []).map((p) => `<p>${esc(p)}</p>`).join('');
  const minor = !!o.minor;
  return layout({
    title: 'Training waiver',
    user,
    tabs: [],
    body: `<div class="login-card card">
      <img src="/diamond-daily-logo.jpg" class="brand-logo-full" alt="Diamond Daily">
      <h1 class="page-title">Training waiver</h1>
      <p class="hint">Read this before you start. Your program unlocks once it's signed.</p>
      ${err ? `<div class="error">${esc(err)}</div>` : ''}
      <div class="waiver-text">${paras || '<p>Waiver text unavailable — please contact your coach.</p>'}</div>
      <form method="post" action="/waiver" class="form">
        <label>Type your full name to sign<input type="text" name="waiver_name" required maxlength="120" placeholder="Full legal name"></label>
        ${minor ? `<label>Parent/guardian — type your full name to co-sign (under 18)<input type="text" name="waiver_parent_name" required maxlength="120" placeholder="Parent/guardian full name"></label>` : ''}
        <button class="btn-primary" type="submit">I understand — sign waiver</button>
      </form>
    </div>`,
  });
}

// Athlete self-substitution: same movement pattern, filtered by their gear.
function substitutePage(user, o) {
  const opts = o.options || [];
  const rows = opts.map((e) =>
    `<form method="post" action="/program/substitute" class="sub-row">
      <input type="hidden" name="key" value="${esc(o.key)}">
      <input type="hidden" name="original" value="${esc(o.name)}">
      <input type="hidden" name="sub_name" value="${esc(e.name)}">
      <input type="hidden" name="sub" value="${esc(o.sub)}">
      <input type="hidden" name="lday" value="${esc(o.lday)}">
      <input type="hidden" name="day" value="${esc(o.day)}">
      <div><strong>${esc(e.name)}</strong><div class="hint-inline">${esc(o.pattern || '')} pattern · fits your equipment</div></div>
      <button class="btn-primary btn-sm" type="submit">Use this</button>
    </form>`
  ).join('');
  const askBody = encodeURIComponent(`Hey Coach — I can't do ${o.name} on ${o.day || 'today'}. Can you suggest a replacement? (Reason: )`);
  return layout({
    title: 'Substitute exercise',
    user,
    tabs: userTabs('program', user),
    body: `<h1 class="page-title">Substitute</h1>
    <p class="hint">Swapping <strong>${esc(o.name)}</strong> — same ${esc(o.pattern || 'movement')} pattern, filtered to your equipment. Bobby sees every swap.</p>
    ${rows || '<div class="card empty">No automatic alternatives for this one with your equipment — ask Bobby instead.</div>'}
    ${rows ? `<div class="card"><label>Why the swap? <span class="hint-inline">(optional — Bobby sees it)</span>
      <input type="text" id="sub-reason" maxlength="200" placeholder="e.g. shoulder cranky, gym is packed" style="width:100%;box-sizing:border-box"></label>
    </div>` : ''}
    <div class="card">
      <p style="margin:0 0 10px"><strong>None of these work?</strong></p>
      <p style="margin:0"><a class="btn-primary" href="/messages?prefill=${askBody}" style="text-decoration:none;display:inline-block">Ask Coach Bobby</a></p>
      <p class="hint" style="margin:8px 0 0">Opens a message pre-filled with the details — just add your reason and send.</p>
    </div>
    <p><a href="${esc(o.back)}">← Back to program</a></p>
    <script>
    (function(){
      // Attach the reason to whichever swap is tapped.
      var reason = document.getElementById('sub-reason');
      if (!reason) return;
      document.querySelectorAll('form.sub-row').forEach(function(f){
        f.addEventListener('submit', function(){
          var h = document.createElement('input');
          h.type = 'hidden'; h.name = 'reason'; h.value = reason.value;
          f.appendChild(h);
        });
      });
    })();
    </script>`,
  });
}


module.exports = {
  layout,
  userTabs,
  coachTabs,
  loginPage,
  registerPage,
  pendingPage,
  parentWaitPage,
  parentConsentPage,
  parentConsentResendPage,
  termsPage,
  privacyPage,
  userHome,
  checkinForm,
  pitchingCheckinForm,
  combinedCheckinForm,
  pitchSessionTypeLabel,
  throwIntentLabel,
  preCheckinPage,
  routinePage,
  notebookPage,
  checkinDeletePage,
  learnNoteEditPage,
  studyPlayerEditPage,
  scorePage,
  chatPage,
  coachHomePage,
  coachHittersPage,
  coachMessagesPage,
  coachComposePage,
  coachThreadPage,
  playerMessagesPage,
  coachProgramsPage,
  coachApprovalsPage,
  coachFinancesPage,
  coachOrganizationsPage,
  coachOrganizationDeletePage,
  coachTeamDeletePage,
  coachUser,
  coachDeleteHitterPage,
  coachSkipPage,
  forgotPasswordPage,
  resetPasswordPage,
  programPage,
  programRoutinePage,
  mentalGamePage,
  programEditPage,
  liftingProgramsPage,
  liftingEditPage,
  videosPage,
  videoWatchPage,
  coachLibraryPage,
  esc,
  linkify,
  settingsPage,
  DRILL_SECTIONS,
  intakeFormPage,
  intakeDetailPage,
  leadQuestionnaireLinkPage,
  welcomePage,
  waiverPage,
  substitutePage,
};

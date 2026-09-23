// Skip — server-rendered HTML views. Black/red, mobile-first, no build step.

// Asset cache-busting (Bobby, Sep 23 2026): hash CSS/JS at boot so phones
// pick up new versions immediately — no stale-cache roulette.
// (Fix Sep 23 2026: was only hashing app.js + style.css, so lift-editor.js,
// workout.js, session.js and checkin.js could go stale on phones after a
// deploy — exactly the "editor shows no days" class of ghost bug.)
const ASSET_V = (() => {
  try {
    const crypto = require('crypto');
    const fs = require('fs');
    const path = require('path');
    const h = (f) => {
      try { return crypto.createHash('md5').update(fs.readFileSync(path.join(__dirname, '..', 'public', f))).digest('hex').slice(0, 8); }
      catch (e) { return 'missing'; }
    };
    return ['app.js', 'checkin.js', 'lift-editor.js', 'session.js', 'workout.js', 'live.js', 'style.css'].map(h).join('');
  } catch (e) { return 'dev'; }
})();

// Guided Today session entry point. The route (/program/session) exists for
// testing, but the athlete-facing button stays hidden until the flow is
// finished and verified end-to-end (Change 2). Flip to true then.
const GUIDED_SESSION_LIVE = false;

// Warm-up normalization (Sep 23 2026): legacy programs store warmup as a plain
// string; the editor saves an array of lines. Normalize both to string[].
function normWarmup(w) {
  if (Array.isArray(w)) return w.map((x) => String(x || '').trim()).filter(Boolean);
  if (typeof w === 'string') return w.split('\n').map((x) => x.trim()).filter(Boolean);
  return [];
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Different Animal v4 (Sep 23 2026): max-intent marker + inline YouTube demos,
// shared by the program page and the lifting sub-tab renderer.
function ytIdOf(url) {
  const m = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/.exec(String(url || '').trim());
  return m ? m[1] : '';
}
function intentBadgeHtml(intent) {
  const s = String(intent || '').toLowerCase();
  if (s === 'max') return ' <span class="intent-badge">⚡ MAX INTENT</span>';
  if (s === 'ecc') return ' <span class="intent-badge intent-ecc">🐌 ECCENTRIC</span>';
  return '';
}
// Lifting video control: YouTube demos expand inline (tap ▶, plays in page);
// anything else falls back to the plain watch link.
function liftVideoHtml(video, watchLink) {
  const id = ytIdOf(video);
  if (!id) return watchLink(video);
  return ` <button type="button" class="watch-link yt-toggle" data-yt="${esc(id)}" aria-label="Watch video">&#9654; <span>Watch</span></button>`;
}
const YT_TOGGLE_SCRIPT = `<script>(function(){document.addEventListener('click',function(e){
  var b=e.target.closest?e.target.closest('.yt-toggle'):null;if(!b)return;
  var host=b.closest('.lift-ex')||b.closest('.spd-row')||b.closest('form');if(!host)return;
  var open=host.querySelector('.yt-embed');
  if(open){open.remove();b.classList.remove('open');return;}
  if(host.tagName==='DETAILS'&&!host.open)host.open=true;
  var inner=host.querySelector('.lift-main')||host;
  var d=document.createElement('div');d.className='yt-embed';
  d.innerHTML='<iframe src="https://www.youtube.com/embed/'+b.getAttribute('data-yt')+'?rel=0" title="Demo video" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>';
  inner.appendChild(d);b.classList.add('open');
});})();</script>`;

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
// Program first, then the rest. Bobby (Sep 23 2026): remote guys get Messages
// in the bottom tab bar too.
// Bottom tab bar for Bobby's remote hitters only (mobile). Program comes
// before Check In — the program is the point of the app for these guys.
const REMOTE_TABBAR_HREFS = ['/program', '/mental-game', '/checkin', '/notebook', '/chat', '/messages'];
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
<link rel="stylesheet" href="/style.css?v=${ASSET_V}">
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
${onboardingOverlay(user)}
<script src="/app.js?v=${ASSET_V}"></script>
</body>
</html>`;
}

// First-run onboarding (Bobby, Sep 23 2026): 3 swipe screens so a new kid
// learns the daily loop — Lock In → Check In → Talk to Skip. Athletes only,
// shown once (app.js gates on localStorage).
function onboardingOverlay(user) {
  if (!user || user.role !== 'athlete') return '';
  const slides = [
    { icon: '🔒', title: 'Lock In first', text: 'Before you train: run your morning routine, read today\u2019s verse, and do the daily mental exercise. Show up locked in.' },
    { icon: '✅', title: 'Check in after', text: 'Three taps and talk. Tell Skip how the session went \u2014 he sorts it out and scores your day.' },
    { icon: '💬', title: 'Talk to Skip anytime', text: 'Struggling? Skip has seen every session you\u2019ve logged. He\u2019ll point you back to what works for YOU.' },
    { icon: '🧠', title: 'New: your questionnaire', text: 'Everything\u2019s fresh in here. Fill out the new mental-game questionnaire so Skip can build your plan.', cta: 'Fill it out →', href: '/mental-game/questionnaire' },
  ];
  return `<div id="onboard" hidden>
    <div class="onboard-card">
      <div class="onboard-slides">${slides.map((s, i) => `<div class="onboard-slide" data-slide="${i}"${s.cta ? ` data-cta="${esc(s.cta)}" data-href="${esc(s.href)}"` : ''}${i ? ' hidden' : ''}><div class="onboard-icon">${s.icon}</div><h2>${s.title}</h2><p>${s.text}</p></div>`).join('')}</div>
      <div class="onboard-dots">${slides.map((_, i) => `<span class="onboard-dot${i ? '' : ' active'}" data-dot="${i}"></span>`).join('')}</div>
      <div class="onboard-nav"><button type="button" id="onboard-skip" class="btn-ghost">Skip</button><button type="button" id="onboard-next" class="btn-primary">Next</button></div>
    </div>
  </div>`;
}

function userTabs(active, user) {
  // Bobby (Sep 23 2026): bottom bar is exactly these 5, in this order.
  // Remote athletes get Program first — they open the app to train.
  const isRemote = !!(user && user.remoteProgramId);
  const tabs = [];
  if (isRemote) tabs.push({ href: '/program', label: 'Program', active: active === 'program' });
  tabs.push(
    { href: '/mental-game', label: 'Lock In', active: active === 'mental' },
    { href: '/checkin', label: 'Check In', active: active === 'checkin' },
    { href: '/notebook', label: 'Notebook', active: active === 'notebook' },
    { href: '/chat', label: 'Talk to Skip', sub: 'your personally trained coach', active: active === 'chat' },
  );
  // Bobby (Sep 23 2026): only remote guys get the Messages tab.
  if (isRemote) {
    tabs.push({ href: '/messages', label: 'Messages', active: active === 'messages', badge: user && user.unreadMessages > 0 ? String(user.unreadMessages) : null });
  }
  // Bobby (Sep 23 2026): Settings back in the sidebar drawer (not the bottom bar).
  tabs.push({ href: '/settings', label: 'Settings', active: active === 'settings' });
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
    tabs.splice(8, 0, { href: '/coach/mental-questions', label: 'Questionnaire', active: active === 'mental-questions' });
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
      <input type="range" name="${name}" min="1" max="10" step="1" value="${v}" class="slider" data-out="${name}-out" aria-label="${esc(label)}" oninput="var o=document.getElementById('${name}-out');if(o)o.textContent=this.value">
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
  // Bobby's 12-question check-in (Sep 23 2026)
  const pill = (name, options, val) => `
    <div class="pills">${options.map(([optVal, label]) =>
      `<label class="pill"><input type="radio" name="${name}" value="${optVal}"${val === optVal ? ' checked' : ''}><span>${label}</span></label>`
    ).join('')}</div>`;
  const stars = (name, val) => `
    <div class="stars">${[1, 2, 3, 4, 5].map((n) =>
      `<label class="star"><input type="radio" name="${name}" value="${n}"${String(val) === String(n) ? ' checked' : ''}><span>★</span></label>`
    ).join('')}</div>`;
  const short = (name, label, val, placeholder) => `
    <label>${esc(label)}<span class="talk-wrap"><input type="text" id="${name}" name="${name}" value="${esc(val || '')}" placeholder="${esc(placeholder || '')}" maxlength="300"><button type="button" class="mic-btn" data-target="${name}" aria-label="Dictate instead of typing">🎙</button></span></label>`;
  // Bobby's check-in (Sep 23 2026): a few taps, big mic, Skip sorts it out.
  // No reflection fields — the server parses the talk text into the summary.
  // Condensed: sliders not stars, tight spacing.
  const slider = (name, val) => `
    <div class="feel-slider">
      <input type="range" name="${name}" min="1" max="10" step="1" value="${val || 5}" id="slider-${name}" oninput="document.getElementById('slider-${name}-val').textContent=this.value">
      <div class="feel-slider-labels"><span>Rough</span><span id="slider-${name}-val">${val || 5}</span><span>Locked in</span></div>
    </div>`;
  return layout({
    title: 'Check In',
    user,
    tabs: userTabs('checkin', user),
    body: `<h1 class="page-title">${isEdit ? 'Edit check-in' : 'Check In'}</h1>
    <div class="card">
    <form method="post" action="${isEdit ? esc(action) : '/checkin'}" class="form" data-validate="hitting12">
      ${error ? `<div class="error">${esc(error)}</div>` : ''}
      <div class="field-label compact">What did you do today?</div>
      ${pill('session_type', [['game', 'Game'], ['cage', 'Cage'], ['live_abs', 'Live ABs'], ['team_practice', 'Team Practice']], v.session_type)}
      <div class="field-label compact">Follow your hitting routine?</div>
      <a href="/routine" class="btn btn-secondary btn-sm" style="margin-bottom:8px">View / edit my routine</a>
      ${pill('routine_followed', [['yes', 'Yes'], ['mostly', 'Mostly'], ['no', 'No']], v.routine_followed)}
      <div class="field-label compact">Rate the session as a whole</div>
      ${slider('swing_feel', v.swing_feel)}
      <hr style="margin:14px 0;border:none;border-top:1px solid var(--line)">
      <div style="text-align:center">
        <p class="hint compact" style="margin-top:0">Talk it out — tap a topic or hit the mic.</p>
        <div class="talk-points">
          <span class="talk-point" data-point="What felt good today was ">What felt good</span>
          <span class="talk-point" data-point="I struggled with ">What you struggled with</span>
          <span class="talk-point" data-point="My timing was ">Timing</span>
          <span class="talk-point" data-point="My swing decisions were ">Swing decisions</span>
          <span class="talk-point" data-point="The adjustment that helped most was ">What helped</span>
          <span class="talk-point" data-point="My one focus for next time is ">Next focus</span>
        </div>
        <button type="button" id="big-mic" class="big-mic" aria-label="Talk it out">🎙</button>
        <p class="hint" id="talk-status" style="display:none"></p>
      </div>
      <div style="text-align:left">
        <label>Your words<textarea id="talk-text" name="talk_text" rows="4" placeholder="Or type it here — what happened today?">${esc(v.talk_text || v.session_notes || '')}</textarea></label>
        <p class="hint">Skip sorts it out from here — your summary lands in your Notebook.</p>
      </div>
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
      <script src="/checkin.js?v=${ASSET_V}"></script>
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
      <script src="/checkin.js?v=${ASSET_V}"></script>
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
      <script src="/checkin.js?v=${ASSET_V}"></script>
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

function notebookPage(user, checkins, notes, players, justSubmitted, filter, extras) {
  const streak = (extras && extras.streak) || null;
  // Streak card (absorbed from the old Home tab — Bobby, Sep 23 2026: Home is
  // redundant, Notebook is the daily loop home).
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
    ${streakCard}
    <div id="skips-read" class="skips-read" hidden>
      <div class="skips-read-head"><span class="skips-read-title">👀 Skip's read</span><span class="hint-inline">patterns from your check-ins</span></div>
      <div id="skips-read-body"><p class="hint">Reading your check-ins…</p></div>
    </div>
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

function scorePage(user, c, streak) {
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
    body: `<div class="card score-hero score-reveal">
      <div class="score-kicker">Session Level</div>
      <div class="level-hero-meter">${levelBar(c.session_score, c.score_tier, true)}</div>
      <div><span class="badge ${tierBadgeClass(c.score_tier)} badge-lg">${esc(c.score_tier)}</span></div>
      ${streak >= 2 ? `<div class="streak-flame">🔥 ${streak}-day streak — keep it rolling</div>` : ''}
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
      ${restricted ? '' : `<span class="hint-inline">${c.session_type ? esc(c.session_type.replace('_', ' ')) + ' · ' : ''}${c.swing_feel ? `Session ${esc(c.swing_feel)}/10` : ''}${c.timing ? ` · Timing ${esc(c.timing.replace('_', ' '))}` : ''}${c.contact_quality ? ` · Contact ${esc(c.contact_quality)}/5` : ''}${c.approach_score ? ` · Approach ${esc(c.approach_score)}/5` : ''}${c.routine_followed ? ` · Routine: ${esc(c.routine_followed)}` : ''}</span>`}
      ${throwBits.length ? `<div class="hint-inline">${throwBits.join(' · ')}</div>` : ''}
      ${pitchesThrown.length ? `<div class="drill-chips">${pitchesThrown.map((p) => `<span class="chip">${esc(p)}</span>`).join('')}</div>` : ''}
    </div>` : ''}`;
  const drillRow = `${realDrills.length ? `<div class="drill-chips">${realDrills.map(drillChip).join('')}</div>` : ''}${otherWork.length ? `<p class="hint" style="margin:6px 0 0">Also mentioned: ${esc(otherWork.map((d) => d.name).join(', '))}</p>` : ''}`;
  const read = `${skipReadBlock(c)}`;
  const notes = `${c.session_notes ? `<p>${esc(c.session_notes)}</p>` : ''}`;
  const reflections = [
    c.main_focus ? `<div><span class="label">Main focus</span>${esc(c.main_focus)}</div>` : '',
    c.felt_good ? `<div><span class="label">What felt good</span>${esc(c.felt_good)}</div>` : '',
    c.what_was_working ? `<div><span class="label">What was working</span>${esc(c.what_was_working)}</div>` : '',
    c.biggest_struggle ? `<div><span class="label">Struggled with</span>${esc(c.biggest_struggle)}</div>` : '',
    c.adjustment_helped ? `<div><span class="label">Adjustment that helped</span>${esc(c.adjustment_helped)}</div>` : '',
    c.learned ? `<div><span class="label">Learned</span>${esc(c.learned)}</div>` : '',
    c.whats_next ? `<div><span class="label">One focus for next time</span>${esc(c.whats_next)}</div>` : '',
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
// Coach dashboard for Bobby (Sep 23 2026): manage-first and SHORT.
// Remote program first, then in-person hitters, then latest check-ins.
// Nothing else lives on this page — analytics, orgs, and applications
// sit behind links. Org coaches keep the existing dashboard below.
function coachHomeManage(user, quiet, latest, pending, pushOn, leads, myGuys, bibleOptIns) {
  const g = myGuys || { remote: [], inPerson: [] };
  const bibleRows = (bibleOptIns || []).map((b) =>
    `<a class="ppl-row" href="/coach/user/${encodeURIComponent(b.email)}">
      <span class="ppl-main"><strong>${esc(b.name || b.email)}</strong>
      <span class="hint-inline">daily verse opt-in</span></span>
      <span class="org-chev" aria-hidden="true">›</span></a>`).join('');
  const lastTxt = (p) => {
    if (p.checkedToday) return 'checked in today';
    if (!p.last) return 'no check-ins yet';
    const d = Math.max(0, Math.round((Date.now() - new Date(p.last).getTime()) / 864e5));
    return d <= 1 ? 'last check-in yesterday' : `last check-in ${d}d ago`;
  };
  const playerRow = (p) => `<a class="ppl-row" href="/coach/user/${encodeURIComponent(p.email)}">
      <span class="ppl-dot${p.checkedToday ? ' on' : ''}" aria-hidden="true"></span>
      <span class="ppl-main"><strong>${esc(p.name)}</strong>
        <span class="hint-inline">${p.streak ? p.streak + '-day streak · ' : ''}${esc(lastTxt(p))}</span></span>
      <span class="org-chev" aria-hidden="true">›</span></a>`;
  const guySection = (title, list) => {
    if (!list.length) return '';
    return `<div class="dash-sec-head"><h2 class="section-head" style="margin:0">${title}</h2>
      <a class="hint-inline" href="/coach/my-players">Manage →</a></div>
      <div class="card ppl-list">${list.map(playerRow).join('')}</div>`;
  };
  const pendingRow = pending && pending.length
    ? `<a class="ppl-row" href="/coach/approvals"><span class="ppl-dot warn" aria-hidden="true"></span>
       <span class="ppl-main"><strong>${pending.length} waiting for approval</strong>
       <span class="hint-inline">tap to review</span></span>
       <span class="org-chev" aria-hidden="true">›</span></a>` : '';
  const quietRows = (quiet || []).slice(0, 4).map((a) =>
    `<a class="ppl-row" href="/coach/user/${encodeURIComponent(a.email)}">
      <span class="ppl-dot" aria-hidden="true"></span>
      <span class="ppl-main"><strong>${esc(a.name)}</strong>
      <span class="hint-inline">gone quiet · ${a.daysAgo}d</span></span>
      <span class="org-chev" aria-hidden="true">›</span></a>`).join('');
  const attention = '';
  const checkRows = (latest || []).map((c) =>
    `<a class="ppl-row" href="${c.athlete_email ? '/coach/user/' + encodeURIComponent(c.athlete_email) : '/coach/hitters'}">
      <span class="ppl-main"><strong>${esc(c.athlete_name || c.athlete_email || 'Check-in')}</strong>
      <span class="hint-inline">${esc(fmtDate(c.created_at))}</span></span>
      ${c.score != null ? `<span class="score-chip">${esc(String(c.score))}</span>` : ''}</a>`).join('');
  const newLeads = (leads || []).filter((l) => l.status === 'new').length;
  const canEdit = user.role === 'coach' && user.canEdit !== false;
  const leadStatusPill = (s) => {
    const cls = s === 'new' ? 'warn' : s === 'contacted' ? '' : s === 'enrolled' ? 'ok' : 'quiet';
    return `<span class="badge ${cls}">${esc(s)}</span>`;
  };
  const leadCards = (leads || []).map((l) => {
    const tel = String(l.phone || '').replace(/[^\d+]/g, '');
    const statusOpts = ['new', 'contacted', 'enrolled', 'archived']
      .map((s) => `<option value="${s}"${l.status === s ? ' selected' : ''}>${s}</option>`).join('');
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
      </div></div>`;
  }).join('');
  return layout({
    title: 'Coach Dashboard',
    user,
    tabs: coachTabs('home', user.approvalCount, user),
    body: `<h1 class="page-title">Coach Dashboard</h1>
    ${pushOn ? '' : '<div class="card push-card"><p style="margin:0 0 10px"><strong>Turn on notifications</strong> <span class="hint">so you never miss an approval, a check-in, or a message.</span></p><p style="margin:0"><button type="button" class="btn-primary" id="push-enable-btn" style="margin-top:0">Turn on notifications</button></p></div>'}
    ${attention}
    ${guySection('Remote program', g.remote)}
    ${guySection('In-person hitters', g.inPerson)}
    ${bibleRows ? `<div class="dash-sec-head"><h2 class="section-head" style="margin:0">📖 Bible Study</h2></div>
      <div class="card ppl-list">${bibleRows}</div>` : ''}
    ${checkRows ? `<h2 class="section-head">Latest check-ins</h2><div class="card ppl-list">${checkRows}</div>` : ''}
    <h2 class="section-head">More</h2>
    <div class="card ppl-list">
      <details class="more-leads"><summary class="ppl-row" style="cursor:pointer;list-style:none">
        <span class="ppl-main"><strong>Website applications</strong>
        <span class="hint-inline">${newLeads ? newLeads + ' new' : 'none new'}</span></span>
        <span class="org-chev" aria-hidden="true">›</span></summary>
        <div class="more-leads-body">${leadCards || '<p class="hint">No applications yet.</p>'}</div>
      </details>
      <a class="ppl-row" href="/coach/organizations"><span class="ppl-main"><strong>Organizations</strong></span><span class="org-chev" aria-hidden="true">›</span></a>
      <a class="ppl-row" href="/coach/lifting"><span class="ppl-main"><strong>Lifting programs</strong></span><span class="org-chev" aria-hidden="true">›</span></a>
      <a class="ppl-row" href="/coach/messages"><span class="ppl-main"><strong>Messages</strong>${user.unreadMessages ? ` <span class="tab-badge">${esc(String(user.unreadMessages))}</span>` : ''}</span><span class="org-chev" aria-hidden="true">›</span></a>
    </div>`,
  });
}

function coachHomePage(user, quiet, latest, pending, pushOn, analytics, leads, myGuys, bibleOptIns) {
  // Bobby's manage-first dashboard (Sep 23 2026): short page, his programs
  // only. Org coaches keep the full dashboard below.
  if (myGuys && !user.organizationId) return coachHomeManage(user, quiet, latest, pending, pushOn, leads, myGuys, bibleOptIns);
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
      </details>`;
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
          ${o.messageButton && a.isRemote ? `<a class="btn-small" href="/coach/messages/${a.id}">Message</a>` : ''}
          ${o.notifyButton ? `<form method="post" action="/coach/player/${a.id}/notify-checkin" style="margin:0">
            <input type="hidden" name="back" value="${esc(o.tab === 'my-players' ? '/coach/my-players' : '/coach/hitters')}">
            <button class="btn-small btn-quiet" type="submit" title="${a.notifyOn ? 'Log alerts ON — tap to mute' : 'Log alerts OFF — tap to unmute'}">${a.notifyOn ? '🔔 Alerts on' : '🔕 Alerts off'}</button>
          </form>` : ''}
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
// iMessage-style messaging (Sep 23 2026, Bobby): blue sent bubbles,
// gray received bubbles, day dividers, sticky input bar. Shared by the
// athlete thread and the coach 1:1 thread.
function imsgInitials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  return ((parts[0] || '?')[0] + ((parts[1] || '')[0] || '')).toUpperCase();
}
function imsgDayLabel(iso) {
  try {
    const tz = 'America/Chicago';
    const key = new Date(iso).toLocaleDateString('en-CA', { timeZone: tz });
    const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });
    const yest = new Date(Date.now() - 864e5).toLocaleDateString('en-CA', { timeZone: tz });
    if (key === today) return 'Today';
    if (key === yest) return 'Yesterday';
    return new Date(iso).toLocaleDateString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' });
  } catch (e) { return ''; }
}
function imsgTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' });
  } catch (e) { return ''; }
}
function imsgAttach(m) {
  if (!m.attachment_path) return '';
  const url = `/msg-attachments/${esc(m.attachment_path)}`;
  if (m.attachment_type === 'video') {
    return `<video src="${url}" controls playsinline preload="metadata" class="imsg-media"></video>`;
  }
  return `<img src="${url}" alt="Attachment" class="imsg-media" loading="lazy">`;
}
function imsgBubbles(meId, msgs) {
  let lastDay = '';
  return (msgs || []).map((m) => {
    const mine = m.sender_id === meId;
    let day = '';
    try {
      const k = new Date(m.created_at).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
      if (k !== lastDay) { lastDay = k; day = `<div class="imsg-day"><span>${esc(imsgDayLabel(m.created_at))}</span></div>`; }
    } catch (e) {}
    const inner = `${m.body ? `<div class="imsg-text">${linkify(m.body)}</div>` : ''}${imsgAttach(m)}`;
    if (!inner) return day;
    return `${day}<div class="imsg-row${mine ? ' mine' : ''}">
      <div class="imsg-bubble">${inner}</div></div>
      <div class="imsg-ts${mine ? ' mine' : ''}">${esc(imsgTime(m.created_at))}</div>`;
  }).join('');
}

function playerMessagesPage(user, msgs, opts) {
  const o = opts || {};
  return layout({
    title: 'Messages',
    user,
    tabs: userTabs('messages', user),
    body: `<div class="imsg">
    <div class="imsg-head"><span class="imsg-avatar">${esc(imsgInitials('Coach'))}</span>
      <strong>Coach</strong></div>
    ${o.nudge ? `<div class="card push-card" style="margin:10px 14px 0"><p style="margin:0 0 10px"><strong>Turn on notifications</strong> <span class="hint">so you never miss a message from Coach.</span></p><p style="margin:0"><button type="button" class="btn-primary" id="push-enable-btn" style="margin-top:0">Turn on notifications</button></p></div>` : ''}
    ${o.error ? `<p class="error" style="margin:10px 14px 0">${esc(o.error)}</p>` : ''}
    <div class="imsg-list" id="imsg-list">${imsgBubbles(user.id, msgs) || '<div class="imsg-empty">No messages yet — say hey to Coach.</div>'}</div>
    ${o.canMessage ? `<form class="imsg-bar" method="post" action="/messages/to-coach" enctype="multipart/form-data">
      <label class="imsg-clip" aria-label="Attach a video or photo">📎
        <input type="file" name="attachment" accept="video/mp4,video/quicktime,video/webm,image/*" hidden></label>
      <input class="imsg-input" name="body" maxlength="500" placeholder="Message Coach" autocomplete="off" value="${esc(o.prefill || '')}">
      <button class="imsg-send" type="submit" aria-label="Send">↑</button>
    </form>` : ''}
    </div>
    <script>(function(){var l=document.getElementById('imsg-list');if(l)l.scrollTop=l.scrollHeight;})();</script>`,
  });
}

// Coach inbox (Sep 17 2026): one row per athlete with message traffic.
// The messaging hub — "New message" opens the clean compose screen.
function coachMessagesPage(user, threads, opts) {
  const o = opts || {};
  const rows = threads
    .map(
      (t) => `<a href="/coach/messages/${t.id}" class="imsg-thread-row">
        <span class="imsg-avatar">${esc(imsgInitials(t.name))}</span>
        <span class="imsg-thread-main">
          <span class="imsg-thread-top"><strong>${esc(t.name)}</strong>
            <span class="hint-inline">${esc(imsgTime(t.last.created_at))}</span></span>
          <span class="imsg-thread-sub"><span>${t.last.attachment_type === 'video' ? '🎥 Video' : esc(t.last.body.slice(0, 60))}${t.last.body.length > 60 ? '…' : ''}</span>
            ${t.unread ? `<span class="imsg-unread">${t.unread}</span>` : ''}</span>
        </span></a>`
    )
    .join('');
  return layout({
    title: 'Messages',
    user,
    tabs: coachTabs('messages', user.approvalCount, user),
    body: `<h1 class="page-title">Messages</h1>
    <p style="margin:0 0 14px"><a class="btn-primary" href="/coach/messages/new" style="text-decoration:none;display:inline-block">New message</a></p>
    ${o.sent ? `<p class="notice"><strong>Sent</strong> to ${esc(String(o.sent))} player${String(o.sent) === '1' ? '' : 's'}.</p>` : ''}
    <div class="card imsg-thread-list">${rows || '<div class="card empty">No message threads yet. Tap New message to start one.</div>'}</div>`,
  });
}

// New message composer (Sep 23 2026, Bobby: "make this look way better"):
// iMessage-style dark card, segmented recipient control, tappable player
// rows with avatar initials + check circles, selected-player chips, live
// send label. Field names kept: to_mode + user_ids checkboxes.
function coachComposePage(user, players, opts) {
  const o = opts || {};
  const n = (players || []).length;
  const list = (players || [])
    .map(
      (a) => `<button type="button" class="cmp-row" data-name="${esc(a.name.toLowerCase())}" data-id="${a.id}" data-label="${esc(a.name)}">
        <span class="imsg-avatar cmp-ava">${esc(imsgInitials(a.name))}</span>
        <span class="cmp-name">${esc(a.name)}</span>
        <span class="cmp-check" aria-hidden="true"></span>
      </button>`
    )
    .join('');
  return layout({
    title: 'New message',
    user,
    tabs: coachTabs('messages', user.approvalCount, user),
    body: `<h1 class="page-title">New message</h1>
    <p class="hint"><a href="/coach/messages">← All messages</a></p>
    ${o.error ? `<p class="error">${esc(o.error)}</p>` : ''}
    <form method="post" action="/coach/messages/new" class="cmp-card" id="cmp-form" enctype="multipart/form-data">
      <div class="cmp-seg">
        <button type="button" class="cmp-seg-btn on" data-mode="all">All my players <span class="cmp-count">${n}</span></button>
        <button type="button" class="cmp-seg-btn" data-mode="choose">Choose players</button>
      </div>
      <input type="hidden" name="to_mode" id="cmp-mode" value="all">
      <div id="choose-box" hidden>
        <div id="cmp-chips" class="cmp-chips" hidden></div>
        <div class="cmp-tools">
          <input type="search" id="compose-search" class="cmp-search" placeholder="Search players…" autocomplete="off">
          <button type="button" class="btn-small btn-quiet" id="compose-all">All</button>
          <button type="button" class="btn-small btn-quiet" id="compose-clear">Clear</button>
        </div>
        <div class="cmp-list" id="cmp-list">
          ${list || '<p class="hint">No players yet.</p>'}
        </div>
        <div id="cmp-ids" aria-hidden="true"></div>
      </div>
      <label class="cmp-label">Message <span class="hint-inline"><span id="char-count">0</span>/500</span></label>
      <textarea name="body" id="compose-body" maxlength="500" rows="4" class="cmp-textarea" placeholder="Write your message…"></textarea>
      <label class="cmp-attach" aria-label="Attach a video or photo">📎 <span class="hint-inline">Attach video/photo</span>
        <input type="file" name="attachment" accept="video/mp4,video/quicktime,video/webm,image/*" hidden></label>
      <button class="btn-primary cmp-send" type="submit"><span id="cmp-send-label">Send to all ${n} player${n === 1 ? '' : 's'}</span></button>
    </form>
    <script>
    (function () {
      var modeInput = document.getElementById('cmp-mode');
      var box = document.getElementById('choose-box');
      var segBtns = Array.prototype.slice.call(document.querySelectorAll('.cmp-seg-btn'));
      var search = document.getElementById('compose-search');
      var rows = Array.prototype.slice.call(document.querySelectorAll('.cmp-row'));
      var chips = document.getElementById('cmp-chips');
      var idsBox = document.getElementById('cmp-ids');
      var sendLabel = document.getElementById('cmp-send-label');
      var total = rows.length;
      var selected = new Set();
      function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
      function rowById(id) { return rows.filter(function (r) { return r.dataset.id === id; })[0]; }
      function syncUI() {
        rows.forEach(function (r) { r.classList.toggle('on', selected.has(r.dataset.id)); });
        // hidden checkboxes the server reads
        idsBox.innerHTML = '';
        selected.forEach(function (id) {
          var cb = document.createElement('input');
          cb.type = 'checkbox'; cb.name = 'user_ids'; cb.value = id; cb.checked = true; cb.style.display = 'none';
          idsBox.appendChild(cb);
        });
        // chips
        var items = [];
        selected.forEach(function (id) {
          var r = rowById(id);
          if (r) items.push({ id: id, label: r.dataset.label });
        });
        chips.hidden = !items.length;
        chips.innerHTML = items.map(function (it) {
          return '<span class="cmp-chip">' + esc(it.label) + '<button type="button" data-uncheck="' + esc(it.id) + '" aria-label="Remove">×</button></span>';
        }).join('');
        // send label
        if (modeInput.value === 'all') {
          sendLabel.textContent = 'Send to all ' + total + ' player' + (total === 1 ? '' : 's');
        } else {
          var c = selected.size;
          sendLabel.textContent = c ? 'Send to ' + c + ' player' + (c === 1 ? '' : 's') : 'Choose players to send';
        }
      }
      segBtns.forEach(function (b) {
        b.addEventListener('click', function () {
          segBtns.forEach(function (x) { x.classList.toggle('on', x === b); });
          modeInput.value = b.dataset.mode;
          box.hidden = b.dataset.mode !== 'choose';
          syncUI();
        });
      });
      rows.forEach(function (r) {
        r.addEventListener('click', function () {
          var id = r.dataset.id;
          if (selected.has(id)) selected.delete(id); else selected.add(id);
          syncUI();
        });
      });
      chips.addEventListener('click', function (e) {
        var b = e.target.closest('[data-uncheck]');
        if (!b) return;
        selected.delete(b.dataset.uncheck);
        syncUI();
      });
      search.addEventListener('input', function () {
        var q = search.value.toLowerCase();
        rows.forEach(function (r) { r.style.display = r.dataset.name.indexOf(q) === -1 ? 'none' : ''; });
      });
      document.getElementById('compose-all').addEventListener('click', function () {
        rows.forEach(function (r) { if (r.style.display !== 'none') selected.add(r.dataset.id); });
        syncUI();
      });
      document.getElementById('compose-clear').addEventListener('click', function () {
        selected.clear();
        syncUI();
      });
      var body = document.getElementById('compose-body');
      var count = document.getElementById('char-count');
      body.addEventListener('input', function () { count.textContent = body.value.length; });
      document.getElementById('cmp-form').addEventListener('submit', function (e) {
        if (modeInput.value === 'choose' && !selected.size) {
          e.preventDefault();
          box.hidden = false;
          search.focus();
        }
      });
      syncUI();
    })();
    </script>`,
  });
}

// Coach 1:1 thread (Sep 17 2026): full history with one player, both
// directions. The reply box only renders for full-access coaches.
function coachThreadPage(user, other, msgs, opts) {
  const o = opts || {};
  const canReply = user.canEdit !== false;
  return layout({
    title: 'Messages',
    user,
    tabs: coachTabs('messages', user.approvalCount, user),
    body: `<div class="imsg">
    <div class="imsg-head"><a class="imsg-back" href="/coach/messages" aria-label="Back to messages">‹</a>
      <span class="imsg-avatar">${esc(imsgInitials(other.name))}</span>
      <strong>${esc(other.name)}</strong></div>
    ${o.error ? `<p class="error" style="margin:10px 14px 0">${esc(o.error)}</p>` : ''}
    <div class="imsg-list" id="imsg-list">${imsgBubbles(user.id, msgs) || '<div class="imsg-empty">No messages yet.</div>'}</div>
    ${canReply ? `<form class="imsg-bar" method="post" action="/coach/messages/to/${other.id}" enctype="multipart/form-data">
      <label class="imsg-clip" aria-label="Attach a video or photo">📎
        <input type="file" name="attachment" accept="video/mp4,video/quicktime,video/webm,image/*" hidden></label>
      <input class="imsg-input" name="body" maxlength="500" placeholder="Message" autocomplete="off">
      <button class="imsg-send" type="submit" aria-label="Send">↑</button>
    </form>` : ''}
    </div>
    <script>(function(){var l=document.getElementById('imsg-list');if(l)l.scrollTop=l.scrollHeight;})();</script>`,
  });
}

function coachProgramsPage(user, remotePrograms, intake) {
  const canEdit = user.role === 'coach' && user.canEdit !== false;
  return layout({
    title: 'Programs',
    user,
    tabs: coachTabs('programs', user.approvalCount, user),
    body: `<h1 class="page-title">Programs</h1>
    <div class="card" style="margin-bottom:16px">
      <p style="margin:0"><a href="/coach/sample-hitting"><strong>👁️ View sample personalized hitting program</strong></a> <span class="hint-inline">— see what a questionnaire-built hitting program looks like</span></p>
    </div>
    ${intakeSection(intake || {}, canEdit)}
    ${remoteProgramsSection(remotePrograms || [], canEdit)}`,
  });
}

// Sample personalized hitting program (Sep 23 2026) — for Bobby to see what
// a questionnaire-driven hitting program looks like. Not real athlete data.
function sampleHittingPage(user, sample) {
  const prog = sample;
  const q = prog.questionnaire_snapshot || {};
  const notes = (prog.personalization_notes || []).map((n) => `<li>${esc(n)}</li>`).join('');
  const qRows = [
    ['Environments', (q.environments || []).join(', ')],
    ['Missing', (q.missing || []).join(', ')],
    ['Goals', (q.goals || []).join('; ')],
    ['Current EV', q.current_ev || ''],
    ['Bat speed', q.current_bat_speed || ''],
  ].filter(([, v]) => v).map(([k, v]) => `<div><strong>${esc(k)}:</strong> ${esc(v)}</div>`).join('');
  const blocks = (prog.routine || []).map((b) => {
    const items = (b.items || []).map((it) =>
      `<div class="routine-row"><span class="routine-name">${esc(it.drill || '')}</span>${it.volume ? `<span class="hint-inline">${esc(it.volume)}</span>` : ''}</div>`
    ).join('');
    return `<details class="card routine-group" open><summary class="routine-summary"><span class="routine-station">${esc(b.category)}</span></summary>${items}</details>`;
  }).join('');
  const cues = prog.cues || {};
  const cueRows = [['Movement', cues.movement], ['Timing', cues.timing], ['Game', cues.game]]
    .filter(([, v]) => String(v || '').trim())
    .map(([k, v]) => `<li><strong>${esc(k)}:</strong> ${esc(String(v).trim())}</li>`).join('');
  return layout({
    title: 'Sample Hitting Program',
    user,
    tabs: coachTabs('programs', user.approvalCount, user),
    body: `<p><a href="/coach/programs">← Back to Programs</a></p>
    <h1 class="page-title">Sample: Personalized Hitting Program</h1>
    <div class="card" style="background:#e8f5e9;border:1px solid #4caf50;margin-bottom:16px">
      <p style="margin:0"><strong>✓ Built from questionnaire</strong> <span class="hint-inline">— source: personalized</span></p>
      ${notes ? `<ul style="margin:8px 0 0;padding-left:20px">${notes}</ul>` : ''}
    </div>
    <div class="card" style="margin-bottom:16px">
      <h3 style="margin-top:0">Questionnaire snapshot</h3>
      ${qRows}
      <p class="hint" style="margin-bottom:0">Athlete: ${esc(prog.athlete || '')} · ${esc(prog.date_range || '')}</p>
    </div>
    <h2 class="section-head">The program</h2>
    <p class="hint"><strong>Phase:</strong> ${esc(prog.phase_emphasis || '')}</p>
    ${prog.adjustment ? `<div class="card"><p style="margin:0"><strong>Focus:</strong> ${esc(prog.adjustment)}</p></div>` : ''}
    ${blocks}
    ${cueRows ? `<h2 class="section-head">Cues to work on</h2><div class="card"><ul class="works-list" style="margin:0">${cueRows}</ul></div>` : ''}
    <div class="card" style="margin-top:16px;background:#fff8e1;border:1px solid #f0d060">
      <p style="margin:0"><strong>This is a sample.</strong> It shows what a hitting program built from questionnaire answers looks like — sections matched to his environments, drills picked for his goals, missing equipment omitted. The real builder (questionnaire → drill pool → program) is not yet built.</p>
    </div>`,
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
      </details>`;
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
  // (yt helpers live at module scope: ytIdOf, intentBadgeHtml, liftVideoHtml, YT_TOGGLE_SCRIPT)


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
  // Session order removed (Bobby, Sep 23 2026) — hitting always runs first.
  const sessionOrder = 'hitting_first';

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
  const isRest = schedToday && /^(off|rest|recovery|mobility)/i.test(schedToday.label);

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

  // Interactive week calendar (Sep 2026): the full Mon–Sun schedule as a
  // tappable strip. Today is highlighted; OFF days are dimmed and not links.
  // "Mobility Day" opens the Mobility tab — the day's work IS the mobility
  // flow. Everything else opens the day's blocks.
  const weekStrip = () => {
    if (!schedArr.length) return '';
    const order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const cells = order.map((wd) => {
      const s = schedArr.find((x) => x.weekday.toLowerCase() === wd.toLowerCase());
      const lab = s ? s.label : '';
      const isToday = wd.toLowerCase() === String(weekday).toLowerCase();
      const isOff = /^(off|rest)/i.test(lab) || !lab;
      // Bobby (Sep 23 2026): Mobility Day opens the Mobility tab for non-lifters;
      // lifters get mobility inside the Lifting tab, so it opens lifting.
      const hasMobTab = tabs.some((t) => t.id === 'mobility');
      const tab = /mobility day/i.test(lab) ? (hasMobTab ? 'mobility' : 'lifting') : sub;
      const inner = `<span class="ws-dow">${wd.slice(0, 3)}</span><span class="ws-lab">${esc(lab || '—')}</span>`;
      const cls = `ws-cell${isToday ? ' ws-today' : ''}${isOff ? ' ws-off' : ''}`;
      return isOff
        ? `<span class="${cls}">${inner}</span>`
        : `<a class="${cls}" href="/program?sub=${esc(tab)}&day=${encodeURIComponent(lab)}">${inner}</a>`;
    }).join('');
    return `<div class="week-strip" role="navigation" aria-label="Your week">${cells}</div>`;
  };

  // One check-off row (hitting / mobility / med ball / prep).
  const checkRow = (kind, key, drill, volume, video, extra, badge) => {
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
      <span class="routine-name">${esc(shown || '')}</span>${badge || ''}${volume ? `<span class="hint-inline">${esc(volume)}</span>` : ''}${watchLink(video)}${subBadge}
    </form>`;
  };
  const blockCard = (cat, items, kind, dayScope, extra, guide) => {
    const real = realItems(items);
    if (!real.length) return '';
    // Guide blocks (e.g. "Hitting — Week plan") are reference material, not
    // check-offs: render plain rows.
    const rows = guide
      ? real.map((it) => `<div class="guide-row"><span class="routine-name">${esc(it.drill || '')}</span>${it.volume || it.prescription ? `<span class="hint-inline">${esc(it.volume || it.prescription)}</span>` : ''}</div>`).join('')
      : real.map((it) => checkRow(kind, `${kind}::${dayScope || ''}::${cat}::${it.drill}`, it.drill, it.volume, it.video, extra)).join('');
    return `<details class="card routine-group" open><summary class="routine-summary"><span class="routine-station">${esc(cat)}</span></summary>${rows}</details>`;
  };

  let content = '';
  if (sub === 'mobility') {
    const blocks = routine.filter((c) => kindOf(c.category) === 'mobility' && realItems(c.items).length);
    // Bobby (Sep 23 2026): mobility + med ball paired in one flow for athletes
    // without a lifting program — med ball work renders below the mobility.
    const medBlocks = routine.filter((c) => kindOf(c.category) === 'medball' && realItems(c.items).length);
    const medHtmlMob = medBlocks.length
      ? `<h3 class="prog-h3"><span class="flow-num">2</span> \U0001f4a5 Med Ball — explosive throws</h3>` +
        medBlocks.map((c) => blockCard(c.category, c.items, 'med', dayPrefix(c.category))).join('')
      : '';
    content = `${dayHead(false)}
      <p class="lede">Do this first, every day — then get after the work below.</p>
      ${blocks.map((c) => blockCard(c.category, c.items, 'mob')).join('') || '<div class="card empty">No mobility work in your program.</div>'}${medHtmlMob}`;
  } else if (sub === 'medball') {
    const blocks = routine.filter((c) => kindOf(c.category) === 'medball' && realItems(c.items).length);
    const todays = day ? blocks.filter((c) => inDay(c.category, day)) : blocks;
    const others = day ? blocks.filter((c) => !inDay(c.category, day)) : [];
    content = `${dayHead(true)}
      ${(todays.length || others.length
        ? todays.map((c) => blockCard(c.category, c.items, 'med', dayPrefix(c.category))).join('') +
          others.map((c) => blockCard(c.category, c.items, 'med', dayPrefix(c.category))).join('')
        : '<div class="card empty">No med ball work in your program.</div>')}`;
  } else if (sub === 'lifting' && lifting) {
    const days = (Array.isArray(lifting.days) ? lifting.days : []).filter((d) => realExercises(d.exercises).length);
    // Different Animal v4 (Sep 2026): 1. SPEED → 2. POWER (jumps + med ball) →
    // 3. STRENGTH → 4. ROTATIONAL → 5. BRAKES. No standalone Metabolic tab —
    // speed lives here; legacy 'Metabolic' blocks fold into Speed.
    // ldayIdx is -1 on Recovery / Mobility / OFF days (real seven-day
    // calendar, Sep 23 2026) - rest, not a lift.
    const lday = Number.isFinite(Number(o.ldayIdx)) ? Number(o.ldayIdx) : 0;
    const isRestDay = lday < 0;
    const effLday = isRestDay ? -1 : lday;
    const ldayExtra = `<input type=\"hidden\" name=\"lday\" value=\"${effLday}\">`;
    const curDay = effLday >= 0 ? days[effLday] || {} : {};
    const phaseBanner = (Array.isArray(lifting.notes) && lifting.notes.length)
      ? `<div class=\"card phase-banner\">${lifting.notes
          .filter((n) => !/test\/retest/i.test(String(n || '')))
          .map((n) => `<p>${esc(n)}</p>`).join('')}</div>`
      : '';
    const daySpeedAll = Array.isArray(curDay.speed) ? curDay.speed.filter((s) => String(s && s.name || '').trim()) : [];
    // Held items never render as work — the athlete sees a placeholder.
    const daySpeed = daySpeedAll.filter((s) => !s.held);
    const heldSpeed = daySpeedAll.filter((s) => s.held);
    const heldHtml = (held) => held.length
      ? held.map(() => `<div class="card lift-held"><p style="margin:0"><strong>Your coach is picking the right exercise for this spot.</strong></p><p class="hint-inline" style="margin:4px 0 0">Check back soon — it will appear here when it's ready.</p></div>`).join('')
      : '';
    // Different Animal bans metabolic circuits (Sep 23 2026, Bobby's video):
    // the Speed section shows ONLY the lifting program's speed work. The old
    // routine 'metabolic' blocks are never rendered here.
    const speedHtml = (daySpeed.length || heldSpeed.length)
      ? `<h3 class=\"prog-h3\"><span class=\"flow-num\">1</span> ⚡ Speed — sprints first</h3>\n` +
        (daySpeed.length
          ? `<div class=\"card routine-group\">${daySpeed.map((s) =>
              `<div class=\"spd-row\">` +
              checkRow('spd', `spd::::${curDay.label || ''}::${s.name}`, s.name,
                [s.volume, s.notes].filter(Boolean).join(' — '), null, ldayExtra, intentBadgeHtml(s.intent)) +
              liftVideoHtml(s.video, watchLink) + `</div>`
            ).join('')}</div>`
          : '') +
        heldHtml(heldSpeed)
      : '';
    // Lifting-day power work is ONLY the program's medball work (Sep 23 2026,
    // Bobby's video): the old routine med-ball blocks are not rendered here.
    // The v4 template's medball array is the source of truth.
    const dayMedballAll = Array.isArray(curDay.medball) ? curDay.medball.filter((s) => String(s && s.name || '').trim()) : [];
    const dayMedball = dayMedballAll.filter((s) => !s.held);
    const heldMedball = dayMedballAll.filter((s) => s.held);
    const medHtml = (dayMedball.length || heldMedball.length)
      ? `<h3 class=\"prog-h3\"><span class=\"flow-num\">2</span> 💥 Power — jumps & med ball</h3>\n` +
        (dayMedball.length
          ? `<div class=\"card routine-group\">${dayMedball.map((s) =>
              `<div class=\"spd-row\">` +
              checkRow('med', `med::::${curDay.label || ''}::${s.name}`, s.name,
                [s.volume, s.notes].filter(Boolean).join(' — '), null, ldayExtra, intentBadgeHtml(s.intent)) +
              liftVideoHtml(s.video, watchLink) + `</div>`
            ).join('')}</div>`
          : '') +
        heldHtml(heldMedball)
      : '';
    // Section flow numbers continue after speed/power (liftSubTab renders
    // Strength / Rotational / Brakes groups).
    const secBase = (daySpeed.length || heldSpeed.length ? 1 : 0) + (dayMedball.length || heldMedball.length ? 1 : 0);
    const weekStripTop = liftWeekStrip(o.sched, o.weekday, days, effLday);
    if (isRestDay) {
      // Recovery / Mobility / OFF day on the real seven-day calendar:
      // no lifting at all. OFF stays actual rest.
      const schedArr = Array.isArray(o.sched) ? o.sched : [];
      const tEntry = schedArr.find(([wd]) => String(wd || '').toLowerCase() === String(o.weekday || '').toLowerCase());
      const tLabel = tEntry ? String(tEntry[1] || '') : '';
      const restCopy = /mobil/i.test(tLabel)
        ? '<strong>Mobility day</strong> — no lifting today. Hit the Mobility tab if you want to move.'
        : /recover/i.test(tLabel)
          ? '<strong>Recovery day</strong> — no lifting today. Walk, stretch, sleep — the rest is the work.'
          : '<strong>OFF day</strong> — no lifting today. True rest.';
      content = `${weekStripTop}<div class="card"><p style="margin:0">${restCopy}</p></div>${YT_TOGGLE_SCRIPT}`;
    } else {
      // Bobby (Sep 23 2026): Start Lift goes at the very top of the lifting tab.
      // Always show when there's a lifting day (not rest day).
      const topStartBtn = `<a class="start-workout" href="/program/workout?lday=${effLday}">
        <span class="start-workout-play">▶</span>
        <span class="start-workout-text"><strong>Start Lift</strong>
        <span>Walk through it — video + logging as you go</span></span></a>`;
      // Bobby (Sep 23 2026): mobility pairs WITH the lifting — no standalone
      // Mobility tab for lifters. Mobility blocks render first, as the warm-up.
      const mobBlocks = routine.filter((c) => kindOf(c.category) === 'mobility' && realItems(c.items).length);
      const mobHtml = mobBlocks.length
        ? `<h3 class=\"prog-h3\"><span class=\"flow-num\">0</span> \U0001f9d8 Mobility — move first, then work</h3>` +
          mobBlocks.map((c) => blockCard(c.category, c.items, 'mob')).join('')
        : '';
      content = `${topStartBtn}${phaseBanner}${mobHtml}${speedHtml}${medHtml}${liftSubTab(user, lifting, days, effLday, sub, checkoffs, today, o.liftData || {}, o.subs || {}, secBase, o.todayLdayIdx, o.sched, o.weekday)}${YT_TOGGLE_SCRIPT}`;
    }
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
      ${flat.length ? `<h3 class="prog-h3">Every day</h3>${flat.map((c) => blockCard(c.category, c.items, 'hit', '', null, c.guide)).join('')}` : ''}
      ${pregame.length ? `<h3 class="prog-h3">Pregame</h3>${pregame.map((c) => blockCard(c.category, c.items, 'hit', dayPrefix(c.category))).join('')}` : ''}`}
      ${programSection('The focus', prog.adjustment ? `<p>${esc(prog.adjustment)}</p>` : '', 'focus')}
      ${(() => {
        // Bobby's cues (Movement / Timing / Game) — the athlete finally sees
        // them here. Empty until he sets them in the program editor.
        const cu = (prog.cues && typeof prog.cues === 'object') ? prog.cues : {};
        const rows = [['Movement', cu.movement], ['Timing', cu.timing], ['Game', cu.game]]
          .filter(([, v]) => String(v || '').trim());
        return programSection(
          'Cues to work on',
          rows.length ? `<ul class="works-list">${rows.map(([k, v]) => `<li><strong>${esc(k)}:</strong> ${esc(String(v).trim())}</li>`).join('')}</ul>` : '',
          'cues'
        );
      })()}
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
    <p><a href="/program/hitting-plan" class="btn" style="display:inline-block;text-decoration:none">📄 Hitting Plan</a></p>
    ${meta ? `<p class="lede">${meta}</p>` : ''}
    ${tabHtml}
    ${weekStrip()}
    ${(() => {
      // Guided Today session: one tap runs the whole day in the athlete's
      // chosen order. Hidden until GUIDED_SESSION_LIVE flips (Change 2), and
      // hidden on rest days — but rest is about the SELECTED day, not today.
      // The day picker only offers real program days (Day 1, Day 2…), so an
      // explicit pick always has work: the CTA shows even on a rest today.
      // (isRest is true only for today, and isToday is false on a manual pick.)
      const selectedIsRest = isRest && isToday;
      if (!GUIDED_SESSION_LIVE || selectedIsRest || !day) return '';
      const lday = (o.ldayIdx || 0);
      const href = '/program/session?day=' + encodeURIComponent(day) +
        (tabs.some((t) => t.id === 'lifting') ? '&lday=' + lday : '');
      return `<a class="btn-primary session-cta" href="${href}">▶ Start ${isToday ? 'today\u2019s' : 'this day\u2019s'} session</a>`;
    })()}
    ${content}
    <div class="card finish-card"><p style="margin:0 0 8px">Done with the work? <a href="/checkin"><strong>Log your session →</strong></a></p>
    <p class="hint-inline" style="margin:0">Work first, journal second.</p></div>`,
  });
}

// Workout mode (Sep 23 2026): guided lifting session. One movement at a
// time — Speed → Med Ball → Lifts — big inputs, one-tap set logging,
// rest timer, no page reloads. The day JSON rides in window.WO_DAY;
// /workout.js renders and runs the session.
function workoutPage(user, program, wd, ldayIdx, preview, phaseNotes) {
  // Bobby (Sep 23 2026): mobility pairs WITH the lifting — the guided workout
  // opens with the athlete's mobility blocks, then Speed → Med Ball → Lifts.
  const progRoutine = (program && program.prog && Array.isArray(program.prog.routine)) ? program.prog.routine : [];
  const mobItems = [];
  for (const c of progRoutine) {
    if (!/mobility/i.test(String((c && c.category) || ''))) continue;
    for (const it of (Array.isArray(c.items) ? c.items : [])) {
      const nm = String((it && it.drill) || '').trim();
      if (nm) mobItems.push({ name: nm, volume: String((it && it.sets) || ''), video: String((it && it.video) || ''), type: 'mobility' });
    }
  }
  const wdMob = wd && wd.day ? { ...wd, day: { ...wd.day, mobility: mobItems } } : wd;
  const dayJson = JSON.stringify(wdMob).replace(/</g, '\\u003c');
  const lday = Number(ldayIdx) || 0;
  const previewBanner = preview
    ? '<div class="card" style="margin:0 0 12px;background:#fff8e1;border:1px solid #f0d060"><p style="margin:0"><strong>Preview</strong> — you\'re viewing as a coach. Logging is disabled.</p></div>'
    : '';
  // Phase banner: current phase, what it means, core principles (no test/retest).
  const phaseHtml = (Array.isArray(phaseNotes) && phaseNotes.length)
    ? '<div class="card phase-banner" style="margin:0 0 12px">' +
      phaseNotes.map((n) => `<p style="margin:4px 0">${esc(n)}</p>`).join('') + '</div>'
    : '';
  // Server-rendered fallback: if the client JS fails, the athlete still sees
  // the workout. The JS guided mode enhances this when it loads.
  const d = (wdMob && wdMob.day) || {};
  const allItems = [...(d.mobility || []), ...(d.speed || []), ...(d.medball || []), ...(d.lifts || [])];
  const fallbackHtml = allItems.length
    ? `<div class="card"><h3 style="margin-top:0">Today's exercises (${allItems.length})</h3>` +
      allItems.map((it, i) => {
        const nm = esc(it.name || '');
        const vol = esc(it.volume || [it.sets, it.reps].filter(Boolean).join(' × ') || '');
        const vid = it.video ? ` <a href="${esc(it.video)}" target="_blank" rel="noopener">▶ video</a>` : '';
        return `<div class="routine-row"><span class="routine-name">${i + 1}. ${nm}</span>${vol ? `<span class="hint-inline">${vol}</span>` : ''}${vid}</div>`;
      }).join('') + `<p class="hint" style="margin-bottom:0">Guided mode didn't load — this is the full list. Try refreshing.</p></div>`
    : '<div class="card empty">No work programmed for this day.</div>';
  return layout({
    title: wd.day.label + ' · Lift',
    user,
    tabs: [],
    body: `${previewBanner}${phaseHtml}<div class="wo">
      <div class="wo-top">
        <a class="wo-end" href="/program?sub=lifting&lday=${lday}">✕ End</a>
        <div class="wo-prog"><div class="wo-bar"><div class="wo-fill" id="wo-fill"></div></div>
        <div class="wo-count" id="wo-count"></div></div>
        <div class="wo-day">${esc(wd.day.label)}</div>
      </div>
      <div class="wo-seq" id="wo-seq"></div>
      <main class="wo-body" id="wo-body">${fallbackHtml}</main>
      <nav class="wo-nav">
        <button type="button" class="wo-navbtn" id="wo-prev">‹ Prev</button>
        <button type="button" class="wo-navbtn primary" id="wo-next">Next ›</button>
      </nav>
      <div class="wo-rest" id="wo-rest" hidden>
        <div class="wo-rest-card">
          <div class="wo-rest-label">Rest</div>
          <div class="wo-rest-time" id="wo-rest-time">2:00</div>
          <div class="wo-rest-next" id="wo-rest-next"></div>
          <div class="wo-rest-btns">
            <button type="button" class="wo-chipbtn" id="wo-rest-less">−15s</button>
            <button type="button" class="wo-chipbtn primary" id="wo-rest-skip">Skip</button>
            <button type="button" class="wo-chipbtn" id="wo-rest-more">+15s</button>
          </div>
        </div>
      </div>
      <div class="wo-finish" id="wo-finish" hidden>
        <div class="wo-finish-card">
          <div class="wo-finish-emoji">🔒</div>
          <h2>Workout complete</h2>
          <p class="hint" id="wo-finish-stats"></p>
          <a class="btn-primary" href="/program?sub=lifting&lday=${lday}" style="display:block;text-align:center;text-decoration:none">Back to program</a>
        </div>
      </div>
    </div>
    <script>window.WO_DAY = ${dayJson}; window.WO_PREVIEW = ${preview ? 'true' : 'false'};</script>
    <script src="/workout.js?v=${ASSET_V}"></script>`,
  });
}

// ---- Guided Today session (Sep 2026) ----
// Today → pick your order → tap through every exercise → done. One guided
// flow for Mobility, Med Ball, Hitting, and Lifting, in the order the athlete
// chooses. Screen stays awake during the session (Wake Lock). Progress logs
// through the same checkoffs as the Programs tab, so everything syncs.
function sessionPage(user, s) {
  const comps = s.components || {};
  const order = (s.order || []).filter((id) => comps[id] && comps[id].items.length);
  const totalItems = order.reduce((n, id) => n + comps[id].items.length, 0);
  const sessJson = JSON.stringify({
    dayLabel: s.dayLabel, weekday: s.weekday, date: s.date,
    order, components: order.reduce((o, id) => ((o[id] = comps[id]), o), {}),
    skipOrder: !!s.savedOrder, ldayIdx: s.ldayIdx, backUrl: s.backUrl,
  }).replace(/</g, '\\u003c');

  // Rest day: nothing to run — offer the mobility flow only.
  if (s.rest && !totalItems) {
    return layout({
      title: 'Today · Rest',
      user,
      tabs: [],
      body: `<div class="sess-rest"><p class="wo-kicker">Today · ${esc(s.weekday || '')}</p>
        <h1 class="sess-title">Rest day</h1>
        <p class="lede">No work scheduled — recover and come back tomorrow.</p>
        <div class="wo-card"><p style="margin:0">Want to move a little? The mobility flow is always fair game.</p>
        <p style="margin:10px 0 0"><a class="btn-primary" href="/program?sub=mobility" style="display:block;text-align:center;text-decoration:none">Mobility flow</a></p></div>
        <p style="margin-top:14px"><a href="${esc(s.backUrl || '/program')}" class="hint-inline">← Back to program</a></p></div>`,
    });
  }

  const orderRows = order
    .map((id, i) => {
      const c = comps[id];
      const n = c.items.length;
      return `<div class="sess-orderrow" data-comp="${esc(id)}" data-i="${i}">
        <span class="sess-grip" aria-hidden="true">⋮⋮</span>
        <span class="sess-icon" aria-hidden="true">${esc(c.icon || '')}</span>
        <div class="sess-ordermeta"><strong>${esc(c.label)}</strong>
          <span class="hint-inline">${n} ${n === 1 ? 'exercise' : 'exercises'}${c.tag ? ' · ' + esc(c.tag) : ''}</span></div>
        <div class="sess-arrows">
          <button type="button" class="sess-arrow" data-move="-1" aria-label="Move up"${i === 0 ? ' disabled' : ''}>↑</button>
          <button type="button" class="sess-arrow" data-move="1" aria-label="Move down"${i === order.length - 1 ? ' disabled' : ''}>↓</button>
        </div>
      </div>`;
    })
    .join('');

  return layout({
    title: (s.dayLabel || 'Today') + ' · Session',
    user,
    tabs: [],
    body: `<div class="wo sess">
      <div class="sess-order" id="sess-order">
        <p class="wo-kicker">Today · ${esc(s.weekday || '')}</p>
        <h1 class="sess-title">${esc(s.dayLabel || 'Today')}</h1>
        <p class="lede">Run the whole day in one flow. Put the pieces in the order you want — we'll remember it.</p>
        <div class="sess-orderlist" id="sess-orderlist">${orderRows}</div>
        <button type="button" class="btn-primary sess-start" id="sess-start">▶ Start session</button>
        <p style="margin-top:12px"><a href="${esc(s.backUrl || '/program')}" class="hint-inline">← Back to program</a></p>
      </div>
      <div class="sess-flow" id="sess-flow" hidden>
        <div class="wo-top">
          <a class="wo-end" href="${esc(s.backUrl || '/program')}">✕ End</a>
          <div class="wo-prog"><div class="wo-bar"><div class="wo-fill" id="wo-fill"></div></div>
          <div class="wo-count" id="wo-count"></div></div>
          <button type="button" class="wo-end sess-reorder" id="sess-reorder" title="Change order">Order</button>
          <div class="wo-day">${esc(s.dayLabel || '')}</div>
        </div>
        <div class="wo-seq" id="wo-seq"></div>
        <main class="wo-body" id="wo-body"></main>
        <nav class="wo-nav">
          <button type="button" class="wo-navbtn" id="wo-prev">‹ Prev</button>
          <button type="button" class="wo-navbtn primary" id="wo-next">Next ›</button>
        </nav>
        <div class="wo-rest" id="wo-rest" hidden>
          <div class="wo-rest-card">
            <div class="wo-rest-label">Rest</div>
            <div class="wo-rest-time" id="wo-rest-time">2:00</div>
            <div class="wo-rest-next" id="wo-rest-next"></div>
            <div class="wo-rest-btns">
              <button type="button" class="wo-chipbtn" id="wo-rest-less">−15s</button>
              <button type="button" class="wo-chipbtn primary" id="wo-rest-skip">Skip</button>
              <button type="button" class="wo-chipbtn" id="wo-rest-more">+15s</button>
            </div>
          </div>
        </div>
        <div class="wo-finish" id="wo-finish" hidden>
          <div class="wo-finish-card">
            <div class="wo-finish-emoji">🔒</div>
            <h2>Day complete</h2>
            <p class="hint" id="wo-finish-stats"></p>
            <p><a class="btn-primary" href="/checkin" style="display:block;text-align:center;text-decoration:none">Log your session →</a></p>
            <p><a class="btn" href="${esc(s.backUrl || '/program')}" style="display:block;text-align:center;text-decoration:none">Back to program</a></p>
            <p><button type="button" class="btn-quiet" id="sess-reorder2" style="width:100%">Change my order</button></p>
          </div>
        </div>
      </div>
    </div>
    <script>window.SESSION = ${sessJson};</script>
    <script src="/session.js?v=${ASSET_V}"></script>`,
  });
}

// LIFTING sub-tab: today's lift first with a Start Lift button, per-exercise
// check-off + weight/RPE log, other days in a disclosure (Sep 2026).
// target RPE chip, "last time" line, and a compact history view.
// Warm-up rows render first as their own block (no logging on them).
// Each exercise gets a mid-workout "Substitute" link; today's swaps are
// pulled from opts.subs and shown with a marker.
// Week strip (Sep 23 2026, Bobby): the Lifting tab follows the athlete's real
// seven-day calendar. Each weekday shows its schedule label; lifting days link
// straight to that day, today is highlighted, Recovery / Mobility / OFF are
// rest - never lifting. Replaces the old "Other lifting days" disclosure.
function liftWeekStrip(sched, weekday, days, ldayIdx) {
  const schedArr = Array.isArray(sched) ? sched : [];
  if (!schedArr.length) return '';
  const pills = schedArr.map(([wd, label]) => {
    const lab = String(label || '');
    const short = String(wd || '').slice(0, 3);
    const isToday = String(wd || '').toLowerCase() === String(weekday || '').toLowerCase();
    const cls = isToday ? ' wk-today' : '';
    const m = lab.match(/day\s*(\d+)/i);
    if (m) {
      const k = parseInt(m[1], 10) - 1;
      const di = Number.isFinite(k) && k >= 0 && k < days.length ? k : -1;
      const dayName = lab.replace(/\s*[\u2014-].*$/, '');
      const inner = `<span class="wk-d">${esc(short)}</span><span class="wk-l">${esc(dayName)}</span>`;
      if (di < 0) return `<span class="wk-pill wk-na${cls}">${inner}</span>`;
      const active = di === ldayIdx ? ' wk-active' : '';
      return `<a href="/program?sub=lifting&lday=${di}" class="wk-pill${cls}${active}">${inner}</a>`;
    }
    const kind = /off/i.test(lab) ? 'OFF' : (/recover/i.test(lab) ? 'Recovery' : (/mobil/i.test(lab) ? 'Mobility' : lab));
    return `<span class="wk-pill wk-rest${cls}"><span class="wk-d">${esc(short)}</span><span class="wk-l">${esc(kind)}</span></span>`;
  }).join('');
  return `<div class="wk-strip">${pills}</div>`;
}

// Start Lift button — lives at the very top of the lifting tab (Sep 23 2026,
// Bobby: "that needs to be at the top"). Visible to coaches in view-as too so
// Bobby can test the flow; the workout page renders in preview mode for them.
function startLiftButton(ldayIdx, doneEx, totalSets) {
  const sub = totalSets > 0
    ? `${doneEx}/${totalSets} exercises done — walk through it, video + logging as you go`
    : 'Walk through it — video + logging as you go';
  return `<a class="start-workout" href="/program/workout?lday=${ldayIdx}">
    <span class="start-workout-play">▶</span>
    <span class="start-workout-text"><strong>Start Lift</strong>
    <span>${sub}</span></span></a>`;
}

function liftSubTab(user, lifting, days, ldayIdx, sub, checkoffs, today, liftData, subs, secBase, todayLdayIdx, sched, weekday) {
  const day = days[ldayIdx] || { label: '', exercises: [] };
  const dayKey = String(day.label || '');
  const subsMap = subs || {};
  const readOnly = !!(user && user.viewAs);
  // Bobby (Sep 23 2026): the tab leads with today's lift. The week strip -
  // the athlete's real seven-day calendar - is the day picker. No more
  // "Other lifting days" disclosure.
  const todayIdx = Number.isFinite(Number(todayLdayIdx)) ? Number(todayLdayIdx) : ldayIdx;
  const isToday = ldayIdx === todayIdx;
  const weekStrip = liftWeekStrip(sched, weekday, days, ldayIdx);
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
  const warmup = normWarmup(day.warmup);
  const warmupHtml = warmup.length
    ? `<details class="card warmup-block" open><summary class="routine-summary"><span class="routine-station">Warm-up — do this first</span></summary>
      <ol class="warmup-list">${warmup.map((w) => `<li>${esc(w)}</li>`).join('')}</ol></details>`
    : '';
  const realEx = realExercises(day.exercises);
  // Different Animal v4: exercises carry section ('strength' | 'rotational' |
  // 'brakes') and intent ('max'). Group the day into its sections.
  const secOf = (e) => {
    const s = String((e && e.section) || 'strength').toLowerCase();
    return s === 'rotational' || s === 'brakes' ? s : 'strength';
  };
  const exRow = (ex) => {
      // Held for coach review (Sep 2026): the questionnaire flagged this
      // spot as unsafe and no clean substitute exists. The athlete never
      // sees the original exercise — just that their coach is on it.
      if (ex && ex.held) {
        return `<div class="card lift-held"><p style="margin:0"><strong>Your coach is picking the right exercise for this spot.</strong></p><p class="hint-inline" style="margin:4px 0 0">Check back soon — it will appear here when it's ready.</p></div>`;
      }
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
      const sumSub = [sr ? esc(sr) : '', ex.target_rpe ? 'RPE ' + esc(String(ex.target_rpe)) : '',
        lastSummary ? 'Last: ' + lastSummary : ''].filter(Boolean).join(' · ');
      return `<details class="lift-ex${done ? ' done' : ''}">
        <summary class="lift-sum">
          <span class="lift-dot" aria-hidden="true">${done ? '✓' : '○'}</span>
          <span class="lift-sum-main">
            <span class="lift-name">${esc(shown)}${intentBadgeHtml(ex.intent)}</span>
            ${sumSub ? `<span class="lift-sum-sub">${sumSub}</span>` : ''}
          </span>
          ${(() => { const id = ytIdOf(ex.video); return id ? `<button type="button" class="watch-link yt-toggle" data-yt="${esc(id)}" aria-label="Watch video" onclick="event.stopPropagation()">&#9654;</button>` : (ex.video ? `<a class="watch-link" href="${esc(ex.video)}" target="_blank" rel="noopener" aria-label="Watch video" onclick="event.stopPropagation()">&#9654;</a>` : ''); })()}
        </summary>
        <div class="lift-main">
          <div class="lift-name-row">
            <div class="lift-name">${sr ? `<span class="hint-inline">${esc(sr)}</span>` : ''} ${trpe}</div>
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
      </details>`;
    };
  const SEC_META = [
    ['strength', '🏋️ Strength'],
    ['rotational', '🔄 Rotational'],
    ['brakes', '🛑 Brakes'],
  ];
  let secNum = Number(secBase) || 0;
  const exRows = SEC_META.map(([secId, secLabel]) => {
    const rows = realEx.filter((e) => secOf(e) === secId).map(exRow).join('');
    if (!rows) return '';
    secNum += 1;
    return `<h3 class="prog-h3"><span class="flow-num">${secNum}</span> ${secLabel}</h3>\n` + rows;
  }).join('');
  const totalSets = realEx.length;
  const doneEx = (exRows.match(/<details class="lift-ex done"/g) || []).length;
  return `${weekStrip}
    ${isToday ? '' : `<p><a href="/program?sub=lifting">← Back to today's lift</a></p>`}
    <p class="wo-kicker">${isToday ? "Today's lift" : 'Lift day'} · ${esc(dayKey)}</p>
    ${warmupHtml}
    ${readOnly ? '<p class="hint">Preview — logging is disabled.</p>' : ''}
    ${exRows || '<div class="card empty">No exercises on this day yet — your coach can add them.</div>'}`;
}

// Coach: lifting programs overview — templates + per-athlete assignments.
function liftingProgramsPage(user, data) {
  const { templates, programs, assignments, error } = data;
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
      </details>`;
    })
    .join('');
  return layout({
    title: 'Lifting Programs',
    user,
    tabs: coachTabs('lifting', 0, user),
    body: `<h1 class="page-title">Lifting Programs</h1>
    <p class="lede">Templates are starters — assigning one makes a private copy for that athlete, so tweaks never touch the template or another guy's program.</p>
    <div class="card"><h3 style="margin-top:0">New ${templates.length || programs.length ? 'program' : 'program'}</h3>
      ${error ? `<p class="error" style="margin:0 0 10px">${esc(error)}</p>` : ''}
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
// Coach: mental-game questionnaire editor (Sep 23 2026, Bobby). Add, edit,
// reorder, archive questions. Athletes see the active ones on Lock In.
function coachMentalQuestionsPage(user, questions) {
  const optLines = (q) => (q.options || []).map((o) => `${o[0]} | ${o[1]}`).join('\n');
  const rows = (questions || []).map((q, i) => `
    <div class="card${q.active ? '' : ' archived'}" style="${q.active ? '' : 'opacity:0.55'}">
      <form method="post" action="/coach/mental-questions/update" class="form">
        <input type="hidden" name="id" value="${q.id}">
        <p class="field-label" style="margin-top:0">${q.active ? '' : '<span class="badge">archived</span> '}Question ${i + 1}</p>
        <label class="fld">Prompt<textarea name="prompt" rows="2" maxlength="300" required>${esc(q.prompt)}</textarea></label>
        <label class="fld">Hint (optional)<input name="hint" maxlength="300" value="${esc(q.hint || '')}"></label>
        <label class="fld">Type
          <select name="qtype">
            <option value="text"${q.qtype === 'text' ? ' selected' : ''}>Written answer</option>
            <option value="radio"${q.qtype === 'radio' ? ' selected' : ''}>Tap choices</option>
          </select>
        </label>
        <label class="fld">Choices (one per line: value | label)<textarea name="options" rows="3" placeholder="green | Green — calm, focused">${esc(optLines(q))}</textarea></label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <button type="submit" class="btn btn-primary btn-sm">Save</button>
        </div>
      </form>
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
        <form method="post" action="/coach/mental-questions/move" style="margin:0"><input type="hidden" name="id" value="${q.id}"><input type="hidden" name="dir" value="up"><button type="submit" class="btn-ghost btn-sm">↑</button></form>
        <form method="post" action="/coach/mental-questions/move" style="margin:0"><input type="hidden" name="id" value="${q.id}"><input type="hidden" name="dir" value="down"><button type="submit" class="btn-ghost btn-sm">↓</button></form>
        <form method="post" action="/coach/mental-questions/toggle" style="margin:0"><input type="hidden" name="id" value="${q.id}"><button type="submit" class="btn-ghost btn-sm">${q.active ? 'Archive' : 'Restore'}</button></form>
      </div>
    </div>`).join('');
  return layout({
    title: 'Questionnaire',
    user,
    tabs: coachTabs('mental-questions', 0, user),
    body: `<h1 class="page-title">Lock In questionnaire</h1>
    <p class="hint">This is what hitters answer on the Lock In tab. Skip builds their personal plan from it. Archived questions disappear for hitters but keep their old answers.</p>
    ${rows}
    <div class="card">
      <h2 class="routine-station">Add a question</h2>
      <form method="post" action="/coach/mental-questions/add" class="form">
        <label class="fld">Prompt<textarea name="prompt" rows="2" maxlength="300" required placeholder="What do you want to ask?"></textarea></label>
        <label class="fld">Hint (optional)<input name="hint" maxlength="300"></label>
        <label class="fld">Type
          <select name="qtype">
            <option value="text">Written answer</option>
            <option value="radio">Tap choices</option>
          </select>
        </label>
        <label class="fld">Choices (one per line: value | label)<textarea name="options" rows="3" placeholder="attacking | Attacking"></textarea></label>
        <p><button type="submit" class="btn btn-primary">Add question</button></p>
      </form>
    </div>`,
  });
}

// Lifting program editor (Sep 23 2026 rebuild, Bobby): state-driven,
// one day at a time. Day tabs, structured Speed/Med Ball rows (no pipe
// syntax), labeled exercise cards with reorder + duplicate + video
// thumbnails, athlete preview, sticky save bar. State posts as JSON.
function liftingEditPage(user, lp, opts) {
  const error = (opts && opts.error) || '';
  const state = {
    id: lp.id,
    name: lp.name || '',
    is_template: !!lp.is_template,
    serverDayCount: (Array.isArray(lp.days) ? lp.days : []).length,
    days: (Array.isArray(lp.days) ? lp.days : []).map((d) => ({
      label: d.label || '',
      warmup: normWarmup(d.warmup),
      speed: (Array.isArray(d.speed) ? d.speed : []).map((s) => ({
        name: s.name || '', volume: s.volume || '', notes: s.notes || '', video: s.video || '',
        intent: s.intent || '',
        held: !!s.held, held_original: s.held_original || '', held_reason: s.held_reason || '',
      })),
      medball: (Array.isArray(d.medball) ? d.medball : []).map((s) => ({
        name: s.name || '', volume: s.volume || '', notes: s.notes || '', video: s.video || '',
        intent: s.intent || '',
        held: !!s.held, held_original: s.held_original || '', held_reason: s.held_reason || '',
      })),
      exercises: (Array.isArray(d.exercises) ? d.exercises : []).map((e) => ({
        name: e.name || '', sets: e.sets || '', reps: e.reps || '',
        target_rpe: e.target_rpe || '', rest: e.rest || 120,
        notes: e.notes || '', video: e.video || '',
        section: e.section || 'strength', intent: e.intent || '',
        held: !!e.held, held_original: e.held_original || '', held_reason: e.held_reason || '',
      })),
    })),
  };
  const stateJson = JSON.stringify(state).replace(/</g, '\\u003c');
  // Coach-facing personalization notes (Sep 23 2026): what the questionnaire
  // changed in this copy. Never shown to athletes.
  const pnotes = Array.isArray(lp.personalization_notes) ? lp.personalization_notes : [];
  const heldCount = (Array.isArray(lp.days) ? lp.days : []).reduce((n, d) =>
    n + ['speed', 'medball', 'exercises'].reduce((m, k) =>
      m + (Array.isArray(d[k]) ? d[k] : []).filter((e) => e && e.held).length, 0), 0);
  const heldBanner = heldCount
    ? `<div class=\"card\" style=\"border:2px solid #e8a13c;background:#fff7e8;margin:0 0 12px\">\n        <strong>⏸ ${heldCount} exercise${heldCount === 1 ? '' : 's'} held for your review</strong>\n        <p style=\"margin:6px 0 0\">The questionnaire flagged these as unsafe and no clean substitute exists. The athlete can't see them. Rename each one to release it.</p>\n      </div>`
    : '';
  const pnotesHtml = (heldBanner || '') + (pnotes.length
    ? `<div class=\"card\" style=\"border-left:4px solid #f5a623;margin:0 0 12px\">\n        <strong>📋 Built from his questionnaire</strong>\n        ${pnotes.map((n) => `<p style=\"margin:6px 0 0\">${esc(n)}</p>`).join('')}\n      </div>`
    : '');
  return layout({
    title: 'Edit ' + (lp.name || 'program'),
    user,
    tabs: coachTabs('lifting', 0, user),
    body: `<h1 class="page-title">${lp.is_template ? 'Template' : 'Lifting program'}</h1>
    ${error ? `<p class="error" style="margin:0 0 12px">${esc(error)}</p>` : ''}
    ${pnotesHtml}
    <div class="card le-name"><label>Program name
      <input id="le-name" value="${esc(lp.name || '')}" maxlength="80" style="width:100%;box-sizing:border-box"></label></div>
    <div class="le-tabs" id="le-tabs"></div>
    <div id="le-day"></div>
    <div class="le-savebar">
      <a class="btn" href="/coach/lifting">Cancel</a>
      <button type="button" class="btn" id="le-preview">Preview</button>
      <button type="button" class="btn primary" id="le-save">Save program</button>
    </div>
    <div class="le-preview" id="le-preview-ov" hidden>
      <div class="le-preview-card">
        <div class="le-preview-head"><strong>Athlete preview</strong>
          <button type="button" class="btn btn-sm" id="le-preview-close">Close</button></div>
        <div id="le-preview-body"></div>
      </div>
    </div>
    <form method="post" action="/coach/lifting/${lp.id}/save" id="le-form" hidden>
      <input type="hidden" name="name" id="le-form-name">
      <input type="hidden" name="program_json" id="le-form-json">
    </form>
    <script>window.LIFT_EDIT = ${stateJson};</script>
    <script src="/lift-editor.js?v=${ASSET_V}"></script>`,
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
        <p>We&apos;re adding an optional daily Bible study &mdash; a fresh verse plus a short breakdown every morning. Only for guys who want it.</p>
        <p class="hint">Your verse shows up inside your Morning Routine in Lock In. Haven&apos;t built a routine yet? It&apos;ll be waiting on your Lock In page every morning.</p>
        <div class="modal-actions">
          <button type="button" class="btn-primary" id="bible-yes">Yes, count me in</button>
          <button type="button" class="btn-secondary" id="bible-no">No thanks</button>
        </div>
      </div>
    </div>
    `;
}

function mentalGamePage(user, data) {
  const { baseline, saved, planFailed, keys, exercise, exerciseDone, bibleOptIn, bibleVerse, checkedInToday, showBiblePopup, questions, answers } = data || {};
  const b = baseline || {};
  const ans = answers || {};
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
  // Questionnaire v2 (Sep 23 2026) — rebuilt from scratch: renders from
  // mental_questions so Bobby can edit it. Shown at the top if no plan yet,
  // or if ?retake=1.
  const showQuestionnaire = !b.plan || (data && data.retake);
  const qField = (q) => {
    const name = 'q_' + q.qkey;
    const val = ans[q.qkey] || '';
    if (q.qtype === 'radio') {
      return `<div class="chip-row">${(q.options || []).map(([ov, ol]) =>
        `<label class="chip-radio"><input type="radio" name="${esc(name)}" value="${esc(ov)}"${val === String(ov) ? ' checked' : ''}><span>${esc(ol)}</span></label>`
      ).join('')}</div>`;
    }
    return `<label class="fld">${q.hint ? `<span class="hint">${esc(q.hint)}</span>` : ''}
      <textarea name="${esc(name)}" rows="2" maxlength="600" placeholder="${esc(q.hint || q.prompt)}">${esc(val)}</textarea>
    </label>`;
  };
  const questionnaireHtml = showQuestionnaire ? `
    <form method="post" action="/mental-game/save" class="form" id="questionnaire-form">
      <div class="card" style="border:2px solid var(--accent)">
        <h2 class="routine-station">Where's your head at?</h2>
        <p class="hint">Answer honestly — Skip builds your personal plan from this.</p>
        ${(questions || []).map((q) => `
        <p class="field-label">${esc(q.prompt)}</p>
        ${qField(q)}`).join('')}
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
  // Personalized routines (Sep 23 2026, Bobby): built from his questionnaire
  // answers — no two hitters get the same routine.
  const routineSource = data.routineSource || 'default';
  const routineCaption = routineSource === 'personalized'
    ? '<p class="hint" style="margin:0 0 8px">Built from your questionnaire answers — edit anything to make it yours.</p>'
    : '';
  
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
  
  const routineList = (items, which) => items.length ? `<ul class="routine-list">${items.map((item, i) => `
      <li data-routine-li>
        <label><input type="checkbox"${item.done ? ' checked' : ''}> <span data-routine-text>${esc(item.text)}</span></label>
        <span class="routine-actions">
          <button type="button" class="routine-edit" data-which="${which}" data-idx="${i}" aria-label="Edit">✎</button>
          <form method="post" action="/mental-game/routine/delete" style="display:inline;margin:0">
            <input type="hidden" name="which" value="${which}">
            <input type="hidden" name="idx" value="${i}">
            <button type="submit" class="routine-del" aria-label="Remove">✕</button>
          </form>
        </span>
      </li>
    `).join('')}</ul>` : '<p class="hint">No routine yet — add your first item below.</p>';
  
  const routineContent = `
    ${routineList(routineItems, 'morning')}
    <form method="post" action="/mental-game/routine/add" class="form" style="margin-top:8px">
      <input type="hidden" name="which" value="morning">
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
      ${routineList(pregameItems, 'pregame')}
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
      ${routineList(practiceItems, 'practice')}
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
  
  // Routine player data (Sep 23 2026): immersive, app-grade. Bible verse is
  // woven into the morning routine for opt-ins — not a separate card.
  const playerData = (items, which) => {
    const steps = (items || []).map((it) => ({
      title: it.text || '',
      detail: it.detail || '',
      kind: /breath/i.test(it.text || '') ? 'breath' : 'step',
    }));
    return esc(JSON.stringify({ which, steps }));
  };
  const bibleStep = (bibleOptIn && bibleVerse) ? {
    title: 'Today\u2019s verse',
    detail: '',
    kind: 'bible',
    verse: bibleVerse.text,
    ref: bibleVerse.ref,
    theme: bibleVerse.theme,
    explanation: bibleVerse.explanation || '',
    baseball: bibleVerse.baseball || '',
    life: bibleVerse.life || '',
  } : null;
  const stepList = (items) => (items || []).map((it) => ({
    title: it.text || '',
    detail: it.detail || '',
    kind: /breath/i.test(it.text || '') ? 'breath' : 'step',
  }));
  const pregameSteps = stepList(pregameItems);
  const practiceSteps = stepList(practiceItems);
  const morningSteps = (() => {
    const steps = (routineItems || []).map((it) => ({
      title: it.text || '',
      detail: it.detail || '',
      kind: /breath/i.test(it.text || '') ? 'breath' : 'step',
    }));
    // Bible goes second — after breaths, before the keyword.
    if (bibleStep && steps.length) steps.splice(1, 0, bibleStep);
    else if (bibleStep) steps.push(bibleStep);
    return steps;
  })();
  const heroCard = (which, icon, title, items, done, timeEst) => `
    <button type="button" class="routine-hero${done ? ' done' : ''}" data-routine="${which}"
      data-steps="${esc(JSON.stringify({ which, steps: which === 'morning' ? morningSteps : (items || []).map((it) => ({ title: it.text || it.title || '', detail: it.detail || '', kind: it.kind || (/breath/i.test(it.text || it.title || '') ? 'breath' : 'step') })) }))}">
      <span class="routine-hero-icon">${done ? '✓' : icon}</span>
      <span class="routine-hero-body">
        <span class="routine-hero-title">${esc(title)}</span>
        <span class="routine-hero-sub">${(items || []).length} steps · ~${timeEst}</span>
      </span>
      <span class="routine-hero-go">${done ? '✓' : '›'}</span>
    </button>`;

  const cardsHtml = b.plan ? `
    <h2 class="section-title">Today</h2>
    ${routineCaption}
    ${heroCard('morning', '🌅', 'Morning Routine', routineItems, routineDone, '3 min')}
    ${bibleHtml}
    <div class="day-picker">
      <p class="field-label compact">What's today?</p>
      <div class="day-picker-btns">
        <button type="button" class="routine-hero day-pick" data-routine="pregame"
          data-steps="${esc(JSON.stringify({ which: 'pregame', steps: pregameSteps }))}">
          <span class="routine-hero-icon">⚾</span>
          <span class="routine-hero-body"><span class="routine-hero-title">Game Day</span>
          <span class="routine-hero-sub">${pregameItems.length} steps · ~2 min${pregame.done ? ' · ✓ done' : ''}</span></span>
          <span class="routine-hero-go">›</span>
        </button>
        <button type="button" class="routine-hero day-pick" data-routine="practice"
          data-steps="${esc(JSON.stringify({ which: 'practice', steps: practiceSteps }))}">
          <span class="routine-hero-icon">🔥</span>
          <span class="routine-hero-body"><span class="routine-hero-title">Practice Day</span>
          <span class="routine-hero-sub">${practiceItems.length} steps · ~2 min${practice.done ? ' · ✓ done' : ''}</span></span>
          <span class="routine-hero-go">›</span>
        </button>
      </div>
    </div>
    ${exercise ? heroCard('exercise', '🧠', 'Daily Exercise',
      [
        { text: exercise.title, detail: exercise.concept, kind: 'step' },
        { text: 'Baseball application', detail: exercise.baseball, kind: 'step' },
        { text: 'Do this', detail: exercise.action, kind: 'step' },
      ],
      exerciseDone, '5 min') : ''}
    <p style="text-align:center;margin:10px 0 0"><a href="/mental-game/routines/edit" class="btn btn-secondary btn-sm">Edit your routines</a></p>
    <div class="routine-player" id="routine-player" hidden>
      <div class="rp-top">
        <button type="button" class="rp-close" id="rp-close" aria-label="Close">✕</button>
        <div class="rp-progress"><div class="rp-progress-fill" id="rp-fill"></div></div>
        <span class="rp-count" id="rp-count"></span>
      </div>
      <div class="rp-stage" id="rp-stage"></div>
      <div class="rp-nav">
        <button type="button" class="rp-btn rp-btn-back" id="rp-back" aria-label="Back">‹</button>
        <button type="button" class="rp-btn rp-btn-next" id="rp-next">Next</button>
      </div>
    </div>
    <h2 class="section-title" style="margin-top:16px">Yours</h2>
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
  // Bobby (Sep 23 2026): interactive schedule calendar — tap a day, tap another
  // day to swap their workouts; or pick a label from the dropdown. The hidden
  // sched_N inputs keep the existing save handler working unchanged.
  const schedDayLabels = (() => {
    const seen = [];
    for (const c of routine) {
      const m = /^([A-Za-z]+ ?\d+|Pregame)/i.exec(String((c && c.category) || '').trim());
      const lab = m ? m[1].trim() : null;
      if (lab && !seen.some((s) => s.toLowerCase() === lab.toLowerCase())) seen.push(lab);
    }
    return seen;
  })();
  const schedOptions = ['OFF', 'Recovery', 'Mobility Day', ...schedDayLabels];
  const schedFields = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    .map(
      (d, i) => {
        const cur = editSchedMap[d] || '';
        const isOff = /^(off|rest)/i.test(cur) || !cur;
        const opts = schedOptions
          .map((o) => `<option value="${esc(o)}"${o.toLowerCase() === cur.toLowerCase() ? ' selected' : ''}>${esc(o)}</option>`)
          .join('');
        // Include the current value even if it's not in the options list
        const curOpt = cur && !schedOptions.some((o) => o.toLowerCase() === cur.toLowerCase())
          ? `<option value="${esc(cur)}" selected>${esc(cur)}</option>` : '';
        return `<div class="sched-cal-cell${isOff ? ' is-off' : ''}" data-sched-day="${i}" tabindex="0" role="button" aria-label="${esc(d)}: ${esc(cur || 'OFF')}. Tap to select, tap another day to swap.">` +
          `<span class="sched-cal-dow">${esc(d.slice(0, 3))}</span>` +
          `<span class="sched-cal-lab">${esc(cur || 'OFF')}</span>` +
          `<select class="sched-cal-pick" data-sched-pick="${i}" aria-label="${esc(d)} workout">${curOpt}${opts}</select>` +
          `<input type="hidden" name="sched_${i}" value="${esc(cur)}" data-sched-hidden="${i}">` +
          `</div>`;
      }
    )
    .join('');
  const schedCalScript = `<script>(function(){
    var cells = Array.prototype.slice.call(document.querySelectorAll('[data-sched-day]'));
    var selected = -1;
    function labelOf(i){
      var h = document.querySelector('[data-sched-hidden="'+i+'"]');
      return h ? h.value : '';
    }
    function setLabel(i, v){
      var h = document.querySelector('[data-sched-hidden="'+i+'"]');
      var lab = document.querySelector('[data-sched-day="'+i+'"] .sched-cal-lab');
      var pick = document.querySelector('[data-sched-pick="'+i+'"]');
      var cell = document.querySelector('[data-sched-day="'+i+'"]');
      if (h) h.value = v;
      if (lab) lab.textContent = v || 'OFF';
      if (cell) cell.classList.toggle('is-off', /^(off|rest)/i.test(v) || !v);
      if (pick && pick.value !== v) {
        var found = false;
        for (var k = 0; k < pick.options.length; k++) if (pick.options[k].value.toLowerCase() === String(v).toLowerCase()) { pick.selectedIndex = k; found = true; break; }
        if (!found && v) { var o = document.createElement('option'); o.value = v; o.textContent = v; o.selected = true; pick.appendChild(o); }
        if (!v) pick.selectedIndex = 0;
      }
    }
    function clearSel(){
      cells.forEach(function(c){ c.classList.remove('is-sel'); });
      selected = -1;
    }
    cells.forEach(function(cell){
      var i = Number(cell.getAttribute('data-sched-day'));
      cell.addEventListener('click', function(e){
        if (e.target && e.target.classList && e.target.classList.contains('sched-cal-pick')) return;
        if (selected === -1) { selected = i; cell.classList.add('is-sel'); }
        else if (selected === i) { clearSel(); }
        else {
          var a = labelOf(selected), b = labelOf(i);
          setLabel(selected, b); setLabel(i, a);
          clearSel();
          if (navigator.vibrate) try { navigator.vibrate(10); } catch (e2) {}
        }
      });
      cell.addEventListener('keydown', function(e){
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cell.click(); }
      });
    });
    document.querySelectorAll('[data-sched-pick]').forEach(function(pick){
      pick.addEventListener('change', function(){
        var i = Number(pick.getAttribute('data-sched-pick'));
        setLabel(i, pick.value);
        clearSel();
      });
      pick.addEventListener('click', function(e){ e.stopPropagation(); });
    });
  })();</script>`;
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
    <p><a href="/coach/program/${p.id}/hitting-plan" class="btn" style="display:inline-block;text-decoration:none">📄 Edit Hitting Plan</a></p>
    ${draftBanner}
    ${progCard}
    ${blockCard}
    ${subsCard}
    <p><a href="/coach/organizations">← Back to organizations</a>${profileEmail ? ` · <a href="/coach/user/${encodeURIComponent(profileEmail)}">View profile →</a>` : ''}</p>
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
      <div class="card routine-group"><h2 class="routine-station">Weekly schedule</h2><p class="hint"><strong>Tap a day, then tap another day to swap their workouts.</strong> Or pick a workout from each day's dropdown. This is the athlete's week.</p><div class="sched-cal">${schedFields}</div></div>${schedCalScript}
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

function videosPage(user, cats, activeCat, videos, q) {
  const pills = cats
    .map(
      (c) =>
        `<a class="pill-link${c.category === activeCat && !q ? ' active' : ''}" href="/videos?cat=${encodeURIComponent(c.category)}">${c.emoji ? esc(c.emoji) + ' ' : ''}${esc(cleanCat(c.title || c.category))} <span class="hint-inline">${c.n}</span></a>`
    )
    .join('');
  const disp = (v) => (v.custom_name && v.custom_name.trim()) || v.name;
  // Real Drive thumbnails (Sep 2026) instead of the ▶/📄 emoji tiles.
  const thumb = (v) =>
    v.drive_file_id
      ? `<img class="video-thumbimg" loading="lazy" src="https://drive.google.com/thumbnail?id=${encodeURIComponent(v.drive_file_id)}&sz=w400" alt="">`
      : `<div class="video-thumb">\u25B6</div>`;
  const cards = videos
    .map(
      (v) => `<a class="card video-card" href="/videos/watch/${v.id}">
        ${thumb(v)}
        <div class="video-name">${esc(disp(v))}</div>
        ${v.cat_title ? `<div class="hint-inline">${esc(cleanCat(v.cat_title))}</div>` : ''}
      </a>`
    )
    .join('');
  return layout({
    title: 'Remote Library',
    user,
    tabs: userTabs('videos', user),
    body: `<h1 class="page-title">Remote Library</h1>
    ${cats.length ? `<form method="get" action="/videos" class="form" style="margin:0 0 10px"><input type="search" name="q" class="searchbar" placeholder="Search every category\u2026" autocomplete="off" value="${esc(q || '')}"></form>` : ''}
    ${q ? `<p class="hint-inline" style="margin:0 0 8px">${videos.length} result${videos.length === 1 ? '' : 's'} for \u201C${esc(q)}\u201D · <a href="/videos">clear</a></p>` : `<div class="pill-row">${pills}</div>`}
    <div class="video-grid">${cards || '<div class="card empty">No videos yet — they\u2019ll appear here after the next sync.</div>'}</div>
`,
  });
}

function videoWatchPage(user, v) {
  const fileId = encodeURIComponent(v.drive_file_id);
  const preview = `https://drive.google.com/file/d/${fileId}/preview`;
  const disp = (v.custom_name && v.custom_name.trim()) || v.name;
  return layout({
    title: disp,
    user,
    tabs: userTabs('videos', user),
    body: `<p><a href="/videos?cat=${encodeURIComponent(v.category)}">\u2190 ${esc(cleanCat(v.category))}</a></p>
    <h1 class="page-title">${esc(disp)}</h1>
    <div class="video-player">
      <iframe src="${preview}" title="${esc(disp)}" allow="autoplay; fullscreen" allowfullscreen style="width:100%;aspect-ratio:16/9;border:0;background:#000"></iframe>
    </div>
    <p class="hint">Use the fullscreen button on the player for the biggest view. <a href="https://drive.google.com/file/d/${fileId}/view" target="_blank" rel="noopener">Open in Drive</a> if it won't play.</p>`,
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
        `<a class="pill-link${c.category === activeCat ? ' active' : ''}" href="/coach/library?cat=${encodeURIComponent(c.category)}">${c.emoji ? esc(c.emoji) + ' ' : ''}${esc(cleanCat(c.title || c.category))}${c.mhidden ? ' (hidden)' : ''} <span class="hint-inline">${c.n}</span></a>`
    )
    .join('');
  const activeMeta = cats.find((c) => c.category === activeCat) || {};
  const catEditor = canEdit && activeCat
    ? `<details class="card" style="margin:0 0 12px"><summary style="cursor:pointer"><strong>Category display</strong> <span class="hint-inline">rename · reorder · hide</span></summary>
      <form method="post" action="/coach/library/category" class="form" style="margin-top:10px">
        <input type="hidden" name="category" value="${esc(activeCat)}">
        <label>Athletes see<input name="title" value="${esc(activeMeta.title || '')}" placeholder="${esc(cleanCat(activeCat))}" maxlength="120"></label>
        <label>Emoji<input name="emoji" value="${esc(activeMeta.emoji || '')}" maxlength="12" placeholder="🎯"></label>
        <label>Sort order (low = first)<input name="sort_order" type="number" value="${activeMeta.so != null ? activeMeta.so : 999}" min="0" max="9999"></label>
        <label style="display:flex;align-items:center;gap:8px"><input type="checkbox" name="hidden" value="1"${activeMeta.mhidden ? ' checked' : ''}> Hide this category from athletes</label>
        <button class="btn-primary" type="submit">Save category</button>
      </form></details>`
    : '';
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
    ${catEditor}
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
  // "View as player" lives here now (Sep 23 2026, Bobby): tap a player's
  // name to open their page, then preview the app exactly as they see it.
  const viewAsBtn = opts && opts.viewAsId
    ? `<form method="post" action="/coach/view-as" style="display:inline;margin:0">
      <input type="hidden" name="id" value="${opts.viewAsId}">
      <button class="btn-small btn-quiet" type="submit" style="margin-left:4px">View as player</button>
    </form>` : '';
  return layout({
    title: name,
    user,
    tabs: coachTabs('hitters', user.approvalCount, user),
    body: `<h1 class="page-title">${esc(name)} ${rolePill(pt)}</h1>
    <p><a href="/coach/hitters">← Back to players</a>${msgUserId ? ` · <a class="btn-small" href="/coach/messages/${msgUserId}">Message</a>` : ''}${viewAsBtn}</p>
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
    ${isCoach ? '' : `<div class="card">
      <h2 class="section-head">Training questionnaire</h2>
      <p class="hint">Injured? New equipment? Schedule changed? Update your answers and your program rebuilds from the new ones. Anything your coach customized by hand stays as he left it.</p>
      <p style="margin:0"><a class="btn" href="/questionnaire">Update your answers</a></p>
    </div>`}
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
  // "What DON'T you have?" picker (Sep 2026): a dropdown + Add button that
  // stacks removable chips. Cleaner than 15 checkboxes; baseline assumption
  // is the athlete has everything, they only list what's missing.
  const noHavePicker = (name, options, placeholder) => {
    const cur = Array.isArray(v[name]) ? v[name] : (v[name] ? [v[name]] : []);
    const labelOf = (val) => (options.find(([ov]) => ov === val) || [val, val])[1];
    const chips = cur
      .filter((x) => options.some(([ov]) => ov === x))
      .map((x) => `<span class="nohave-chip"><input type="hidden" name="${name}" value="${x}">${esc(labelOf(x))} <button type="button" class="nohave-x" aria-label="Remove">×</button></span>`)
      .join('');
    return `<div class="nohave" data-field="${name}">
      <div class="nohave-row">
        <select class="nohave-select" aria-label="${esc(placeholder || "What don't you have?")}">
          <option value="">${esc(placeholder || "What don't you have? Pick one…")}</option>
          ${options.map(([val, label]) => `<option value="${val}">${label}</option>`).join('')}
        </select>
        <button type="button" class="btn nohave-add">Add</button>
      </div>
      <div class="nohave-chips">${chips}</div>
    </div>`;
  };
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
      <p class="hint">This is how your coach builds your program — the more detail you give, the better it fits. Takes most guys 10–15 minutes.</p>
      ${prefillBanner}
      <div class="intake-progress"><div class="intake-bar"><div id="ibar"></div></div><div id="istep-label" class="hint"></div></div>
      ${err ? `<div class="error">${esc(err)}</div>` : ''}
      ${(opts && opts.updateMode) ? `<div class="card" style="margin:0 0 12px;border-left:3px solid var(--accent,#2e7d32)">` +
      `<strong>Updating your answers.</strong> Change what changed — new injury, new equipment, new schedule — and your program updates from the new answers. Anything your coach customized by hand stays exactly as he left it.</div>` : ``}
      <form method="post" action="${(opts && opts.updateMode) ? `/questionnaire` : `/intake/${esc(token)}/submit`}" class="form" id="intake-form" novalidate>

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
        <p class="hint" style="margin-top:0">Assume you have <strong>everything</strong> — just add what you <strong>don't</strong> have. Your program is built only from what's left.</p>
        ${noHavePicker('missing_equipment', [
          ['barbell', 'Barbell + plates'],
          ['rack', 'Squat rack / power rack'],
          ['dumbbell', 'Dumbbells'],
          ['kettlebell', 'Kettlebells'],
          ['trapbar', 'Trap bar / hex bar'],
          ['bands', 'Resistance bands'],
          ['pullup_bar', 'Pull-up bar'],
          ['bench', 'Adjustable / flat bench'],
          ['medball', 'Medicine balls'],
          ['plyo_box', 'Plyo box'],
          ['sled', 'Sled / prowler'],
          ['cables', 'Cable machine'],
          ['field_space', 'Field / open space for sprints'],
          ['jump_rope', 'Jump rope'],
        ], "What equipment DON'T you have? Pick one…")}
        <label>Details — weights, limits, what's shared or crowded<textarea name="equipment_detail" rows="3" maxlength="1000" placeholder="e.g. dumbbells up to 50 lbs, home garage gym, no leg machines, med balls 6/10/14 lb">${ival('equipment_detail')}</textarea></label>`)}

      ${step('6 · Availability & season', `
        <div class="two-col">
          <label>Days per week you can HIT <span class="hint-inline">(Bobby recommends 5–6)</span>
            <select name="hit_days_per_week">${[1, 2, 3, 4, 5, 6, 7].map((d) => `<option value="${d}"${String(v.hit_days_per_week || 5) === String(d) ? ' selected' : ''}>${d}</option>`).join('')}</select></label>
          <label>Days per week you can LIFT <span class="hint-inline">(Bobby recommends 4)</span>
            <select name="lift_days_per_week">${[1, 2, 3, 4, 5, 6, 7].map((d) => `<option value="${d}"${String(v.lift_days_per_week || 4) === String(d) ? ' selected' : ''}>${d}</option>`).join('')}</select></label>
        </div>
        <p class="hint"><strong>Which weekdays</strong> can you train? <span class="hint-inline">Tap the days.</span></p>
        <div class="cal-week" role="group" aria-label="Training weekdays">${days.map((d) => `<label class="cal-day"><input type="checkbox" name="train_days" value="${d}"${ivc('train_days', d)}><span class="cal-dow">${d[0]}</span><span class="cal-dname">${d.slice(0, 3)}</span></label>`).join('')}</div>
        <p class="hint"><strong>Recovery / mobility days</strong> <span class="hint-inline">— scheduled into your week like training days</span></p>
        <div class="pick-group pick-inline">
          ${[['recovery_day', 'Recovery day'], ['mobility_day', 'Pure mobility day']].map(([val, label]) => `<label class="pick chip"><input type="checkbox" name="weekly_days" value="${val}"${ivc('weekly_days', val)}> <span>${label}</span></label>`).join('')}
        </div>
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
        <p class="hint" style="margin-top:0">Assume you have <strong>everything</strong> — just add what you <strong>don't</strong> have. Be exact — Bobby programs only what's left. And the big one: if nobody can feed you consistently, add that.</p>
        ${noHavePicker('missing_hitting', [
          ['tee', 'Batting tee'],
          ['net', 'Net'],
          ['cage', 'Cage access'],
          ['machine', 'Pitching machine'],
          ['feed_partner', 'Someone to feed me front / side toss'],
        ], "What DON'T you have? Pick one…")}
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
        // "What DON'T you have?" dropdown + chips pickers
        Array.prototype.forEach.call(document.querySelectorAll('.nohave'), function(box){
          var field = box.getAttribute('data-field');
          var sel = box.querySelector('.nohave-select');
          var addBtn = box.querySelector('.nohave-add');
          var chips = box.querySelector('.nohave-chips');
          function has(val){ return !!chips.querySelector('input[value="' + val + '"]'); }
          function addChip(val, label){
            var chip = document.createElement('span');
            chip.className = 'nohave-chip';
            var hid = document.createElement('input');
            hid.type = 'hidden'; hid.name = field; hid.value = val;
            var x = document.createElement('button');
            x.type = 'button'; x.className = 'nohave-x'; x.textContent = '×';
            x.setAttribute('aria-label', 'Remove');
            x.addEventListener('click', function(){ chip.remove(); });
            chip.appendChild(hid);
            chip.appendChild(document.createTextNode(label + ' '));
            chip.appendChild(x);
            chips.appendChild(chip);
          }
          addBtn.addEventListener('click', function(){
            var opt = sel.options[sel.selectedIndex];
            if (!opt || !opt.value) return;
            if (has(opt.value)) { sel.value = ''; return; }
            addChip(opt.value, opt.textContent);
            sel.value = '';
          });
          Array.prototype.forEach.call(chips.querySelectorAll('.nohave-x'), function(x){
            x.addEventListener('click', function(){ x.closest('.nohave-chip').remove(); });
          });
        });
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
    ${sec('Equipment', (() => {
      // New answers: what they DON'T have. Legacy answers: positive `equipment` list.
      const miss = (a.missing_equipment && a.missing_equipment.length) ? kv('Does NOT have', a.missing_equipment.join(', ')) : '';
      const leg = (!a.missing_equipment || !a.missing_equipment.length) && a.equipment && a.equipment.length ? kv('Has (legacy answer)', a.equipment.join(', ')) : '';
      const none = (!miss && !leg) ? kv('Missing equipment', 'Has everything') : '';
      return miss + leg + none + kv('Details', a.equipment_detail);
    })())}
    ${sec('Availability & season', list('Components', a.components) + kv('Hit days/week', a.hit_days_per_week) + kv('Lift days/week', a.lift_days_per_week) + list('Training weekdays', a.train_days) + list('Recovery / mobility days', a.weekly_days) + kv('Session length', a.session_length) + kv('Games/week', a.games_per_week) + kv('Season phase', a.season_phase) + kv('Season detail', a.season_detail) + kv('Schedule constraints', a.schedule_constraints))}
    ${sec('Hitting resources', (() => {
      // New answers: what they DON'T have. Legacy answers: has_* booleans.
      if (a.missing_hitting && a.missing_hitting.length) {
        return kv('Does NOT have', a.missing_hitting.join(', ')) + kv('Feeder detail', a.feed_partner_detail) + list('Environments', a.hitting_progression);
      }
      const yn2 = (b) => (b === undefined || b === null || b === '') ? null : (b ? 'Yes' : 'No');
      const legParts = [
        ['Tee', yn2(a.has_tee)], ['Net', yn2(a.has_net)], ['Cage', yn2(a.has_cage)],
        ['Machine', yn2(a.has_machine)], ['Feed partner', yn2(a.has_feed_partner)],
      ].filter(([, v]) => v !== null);
      const leg = legParts.length ? kv('Has (legacy answers)', legParts.map(([k, v]) => k + ': ' + v).join(' · ')) : '';
      return (leg || kv('Missing resources', 'Has everything')) + kv('Feeder detail', a.feed_partner_detail) + list('Environments', a.hitting_progression);
    })())}
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
      <p class="hint">Your answers are with your coach — he's building your program now. Set a password so you can log in when it's ready.</p>
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
      <p style="margin:0"><a class="btn-primary" href="/messages?prefill=${askBody}" style="text-decoration:none;display:inline-block">Ask your coach</a></p>
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


function hittingPlanPage(user, p) {
  const prog = (p && p.prog) || {};
  const plan = prog.hitting_plan || {};
  const athleteName = (p && p.athlete_name) || prog.athlete || 'Hitter';

  // Grading sheet — the athlete's grades (Load, Path, Connection, Timing, Power)
  const grades = prog.grades && typeof prog.grades === 'object' ? prog.grades : {};
  const gradeEntries = Object.entries(grades).filter(([k, v]) => v && String(v).trim());
  const gradesHtml = gradeEntries.length
    ? `<table class="doc-table grades-table"><tbody><tr>${gradeEntries.map(([k, v]) => `<th>${esc(k)}</th>`).join('')}</tr><tr>${gradeEntries.map(([k, v]) => `<td class="grade-val">${esc(String(v))}</td>`).join('')}</tr></tbody></table>`
    : '';

  // Training environments explainer
  const defaultEnvironments = `<p>Do your work across all <strong>training environments</strong>. Each one trains something different:</p>
<ul>
<li><strong>Tee</strong> — most controlled. Feel the move, own your positions. This is where the pattern gets built.</li>
<li><strong>Toss</strong> (side flips) — the ball's moving now, short distance. Blend what you felt off the tee into timing.</li>
<li><strong>Front Toss</strong> — coming at you now. Timing starts to matter.</li>
<li><strong>BP</strong> — full distance, moderate speed. Timing, direction, and barrel accuracy.</li>
<li><strong>Machine</strong> — full speed. Execute under pressure. This is where it has to show up.</li>
</ul>
<p>Don't count a rep unless it's flush. It doesn't need to be hard — it needs to be right.</p>`;
  const environmentsHtml = plan.environments_note || defaultEnvironments;

  // Warmup — Bobby's prep work
  const warmup = Array.isArray(plan.warmup) ? plan.warmup : [];
  const warmupHtml = warmup.length
    ? `<ul class="doc-list">${warmup.map((w) => `<li><strong>${esc(w.name || '')}</strong>${w.detail ? ` — ${esc(w.detail)}` : ''}</li>`).join('')}</ul>
       <p class="doc-note">Demos for all prep work are in the Remote library (Videos tab).</p>`
    : '<p class="doc-note">Your coach will add your prep work here.</p>';

  // Drills grouped by training environment in progression order
  const ENV_ORDER = ['Tee', 'Toss', 'Front Toss', 'BP', 'Machine', 'Game'];
  const drills = Array.isArray(plan.drills) ? plan.drills : [];
  const byEnv = {};
  for (const d of drills) {
    const env = d.env || 'Tee';
    if (!byEnv[env]) byEnv[env] = [];
    byEnv[env].push(d);
  }
  const drillsHtml = drills.length
    ? ENV_ORDER.filter((env) => byEnv[env] && byEnv[env].length).map((env) => `
      <h3 class="doc-env">${esc(env)}</h3>
      <table class="doc-table">
        <thead><tr><th>Drill</th><th>Volume</th><th>Cues</th><th>Why?</th></tr></thead>
        <tbody>${byEnv[env].map((d) => `<tr>
          <td><strong>${esc(d.name || '')}</strong></td>
          <td>${esc(d.volume || '')}</td>
          <td>${esc(d.cues || '')}</td>
          <td>${esc(d.why || '')}</td>
        </tr>`).join('')}</tbody>
      </table>`).join('')
      + `<p class="doc-note">Drill demos are all in the Remote library (Videos tab).</p>`
    : '<p class="doc-note">Your coach will add your drills here.</p>';

  // Training environment variations (open angle, breaking balls, velo, etc.)
  const defaultVariations = `<p>Mix these into your environments to make the work game-like:</p>
<ul>
<li><strong>Open angle</strong> — open up the front side, work the other way</li>
<li><strong>Breaking balls</strong> — recognize spin, stay on the ball</li>
<li><strong>Velo</strong> — turn the machine up, be on time for heat</li>
</ul>`;
  const variationsHtml = plan.env_variations || defaultVariations;

  const footer = plan.footer ? `<div class="doc-footer">${esc(plan.footer)}</div>` : '';

  return layout({
    title: 'Hitting Plan',
    user,
    tabs: userTabs('program', user),
    body: `<div class="doc-page">
      <div class="doc-brand">
        <div class="doc-brand-mark">AH</div>
        <div class="doc-brand-text">
          <div class="doc-brand-name">ATKINSON HITTING</div>
          <div class="doc-brand-sub">Remote Development</div>
        </div>
      </div>
      <h1 class="doc-title">Hitting Program</h1>
      <p class="doc-athlete">${esc(athleteName)}</p>
      <hr class="doc-rule">
      ${gradesHtml ? `<section class="doc-section"><h2>Grades</h2>${gradesHtml}</section>` : ''}
      <section class="doc-section">
        <h2>Training Environments</h2>
        ${environmentsHtml}
      </section>
      <section class="doc-section">
        <h2>Warmup — Prep Work</h2>
        ${warmupHtml}
      </section>
      <section class="doc-section">
        <h2>The Work — Drill Progression</h2>
        ${drillsHtml}
      </section>
      <section class="doc-section">
        <h2>Environment Variations</h2>
        ${variationsHtml}
      </section>
      ${footer}
    </div>
    <p class="doc-back"><a href="/program" class="hint-inline">‹ Back to program</a></p>
    <style>
      .doc-page { max-width: 760px; margin: 0 auto; background: #ffffff; color: #1a1a1a;
        padding: 40px 36px; border-radius: 4px; box-shadow: 0 2px 12px rgba(0,0,0,0.12);
        font-family: Georgia, 'Times New Roman', serif; line-height: 1.6; }
      .doc-brand { display: flex; align-items: center; gap: 14px; margin-bottom: 8px; }
      .doc-brand-mark { width: 52px; height: 52px; border-radius: 50%; background: #111; color: #fff;
        display: flex; align-items: center; justify-content: center;
        font-family: -apple-system, Helvetica, Arial, sans-serif; font-weight: 800; font-size: 20px; letter-spacing: 1px; }
      .doc-brand-name { font-family: -apple-system, Helvetica, Arial, sans-serif; font-weight: 800;
        font-size: 18px; letter-spacing: 2px; color: #111; }
      .doc-brand-sub { font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 12px;
        letter-spacing: 3px; text-transform: uppercase; color: #666; }
      .doc-title { font-size: 32px; margin: 18px 0 0; color: #111; font-weight: 700; }
      .doc-athlete { font-size: 20px; color: #444; margin: 4px 0 0; font-style: italic; }
      .doc-rule { border: none; border-top: 3px solid #111; margin: 18px 0 24px; }
      .doc-section { margin: 28px 0; }
      .doc-section h2 { font-size: 20px; color: #111; border-bottom: 1px solid #ddd;
        padding-bottom: 6px; margin: 0 0 12px; font-family: -apple-system, Helvetica, Arial, sans-serif; }
      .doc-section p, .doc-section li { color: #222; font-size: 16px; }
      .doc-env { font-size: 17px; color: #111; margin: 20px 0 8px;
        font-family: -apple-system, Helvetica, Arial, sans-serif; }
      .doc-list { padding-left: 22px; }
      .doc-list li { margin: 6px 0; }
      .doc-note { font-size: 14px; color: #666; font-style: italic;
        font-family: -apple-system, Helvetica, Arial, sans-serif; }
      .doc-table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 15px;
        font-family: -apple-system, Helvetica, Arial, sans-serif; }
      .doc-table th { background: #111; color: #fff; padding: 10px 12px; text-align: left; font-weight: 600; }
      .doc-table td { padding: 10px 12px; border-bottom: 1px solid #e0e0e0; color: #222; vertical-align: top; }
      .doc-table tr:nth-child(even) td { background: #f7f7f7; }
      .grades-table th { background: #333; }
      .grade-val { font-size: 22px; font-weight: 700; text-align: center; }
      .doc-footer { margin-top: 24px; padding: 14px 16px; background: #fffbe6;
        border-left: 4px solid #e6a800; font-style: italic; color: #333; font-size: 15px; }
      .doc-back { max-width: 760px; margin: 16px auto 0; }
      @media (max-width: 600px) { .doc-page { padding: 24px 18px; } .doc-title { font-size: 26px; } }
      @media print {
        .doc-page { box-shadow: none; padding: 0; max-width: none; }
        .doc-back { display: none; }
        .doc-section { break-inside: avoid; }
      }
    </style>`,
  });
}



function hittingPlanEditPage(user, p) {
  const prog = (p && p.prog) || {};
  const plan = prog.hitting_plan || {};
  const athleteName = (p && p.athlete_name) || prog.athlete || 'Hitter';
  const saved = typeof window !== 'undefined' ? false : false; // handled via query in server

  const warmup = Array.isArray(plan.warmup) ? plan.warmup : [];
  const drills = Array.isArray(plan.drills) ? plan.drills : [];

  const warmupRows = warmup.map((w, i) => `
    <div class="plan-row">
      <input type="text" name="w_name_${i}" value="${esc(w.name || '')}" placeholder="Prep movement" maxlength="100">
      <input type="text" name="w_detail_${i}" value="${esc(w.detail || '')}" placeholder="Detail (optional)" maxlength="200">
    </div>`).join('');
  // Blank rows for adding
  const warmupBlanks = [0, 1, 2].map((k) => {
    const i = warmup.length + k;
    return `<div class="plan-row">
      <input type="text" name="w_name_${i}" value="" placeholder="Prep movement" maxlength="100">
      <input type="text" name="w_detail_${i}" value="" placeholder="Detail (optional)" maxlength="200">
    </div>`;
  }).join('');

  const envOpts = (sel) => ['Tee','Toss','Front Toss','BP','Machine','Game'].map((e) => `<option value="${e}"${(sel||'Tee')===e?' selected':''}>${e}</option>`).join('');
  const drillRows = drills.map((d, i) => `
    <div class="plan-drill">
      <input type="text" name="d_name_${i}" value="${esc(d.name || '')}" placeholder="Drill name" maxlength="100" class="drill-name">
      <select name="d_env_${i}">${envOpts(d.env)}</select>
      <input type="text" name="d_volume_${i}" value="${esc(d.volume || '')}" placeholder="Volume (e.g. 2x5)" maxlength="100">
      <input type="text" name="d_cues_${i}" value="${esc(d.cues || '')}" placeholder="Cues" maxlength="200">
      <input type="text" name="d_why_${i}" value="${esc(d.why || '')}" placeholder="Why? (what it trains)" maxlength="300">
    </div>`).join('');
  const drillBlanks = [0, 1, 2, 3].map((k) => {
    const i = drills.length + k;
    return `<div class="plan-drill">
      <input type="text" name="d_name_${i}" value="" placeholder="Drill name" maxlength="100" class="drill-name">
      <select name="d_env_${i}">${envOpts('Tee')}</select>
      <input type="text" name="d_volume_${i}" value="" placeholder="Volume (e.g. 2x5)" maxlength="100">
      <input type="text" name="d_cues_${i}" value="" placeholder="Cues" maxlength="200">
      <input type="text" name="d_why_${i}" value="" placeholder="Why? (what it trains)" maxlength="300">
    </div>`;
  }).join('');

  return layout({
    title: 'Edit Hitting Plan',
    user,
    tabs: coachTabs('programs', 0, user),
    body: `<h1 class="page-title">Hitting Plan — ${esc(athleteName)}</h1>
    <p><a href="/coach/program/${p.id}/edit" class="hint-inline">‹ Back to program editor</a></p>
    <form method="post" action="/coach/program/${p.id}/hitting-plan" class="form">
      <label class="fld">Training environments note (leave blank for the standard explainer)
        <textarea name="environments_note" rows="6" placeholder="Custom note, or blank for default...">${esc(plan.environments_note || '')}</textarea>
      </label>
      <h3>Warmup — Prep Work</h3>
      <p class="hint-inline">Bobby's prep work for them. Demos live in the Remote library.</p>
      ${warmupRows}${warmupBlanks}
      <h3>The Work — Drills</h3>
      <p class="hint-inline">Drill demos are all in the Remote library. Add the "why" for each.</p>
      ${drillRows}${drillBlanks}
      <label class="fld">Environment variations (open angle, breaking balls, velo, etc. — leave blank for defaults)
        <textarea name="env_variations" rows="4" placeholder="Custom variations, or blank for default...">${esc(plan.env_variations || '')}</textarea>
      </label>
      <label class="fld">Footer note (optional)
        <textarea name="footer" rows="3" placeholder="e.g. Don't count a rep unless it's flush...">${esc(plan.footer || '')}</textarea>
      </label>
      <button type="submit" class="btn btn-primary">Save Hitting Plan</button>
    </form>
    <style>
      .plan-row { display: flex; gap: 8px; margin: 6px 0; }
      .plan-row input { flex: 1; padding: 8px; }
      .plan-drill { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 10px 0; padding: 10px; background: #f9f9f9; border-radius: 6px; }
      .plan-drill input { padding: 8px; }
      .plan-drill .drill-name { grid-column: 1 / -1; font-weight: 600; }
    </style>`,
  });
}


// Routine edit page (Bobby, Sep 23 2026) — athletes edit their own routines.
function routineEditPage(user, routines) {
  const section = (which, r) => `
    <div class="card">
      <h2 class="routine-station" style="margin-top:0">${esc(r.title)}</h2>
      ${(r.items || []).map((it, i) => `
        <div class="edit-step">
          <form method="post" action="/mental-game/routine/edit" class="form" style="flex:1">
            <input type="hidden" name="which" value="${which}">
            <input type="hidden" name="idx" value="${i}">
            <input type="text" name="text" value="${esc(it.text || '')}" maxlength="200" required>
            <input type="text" name="detail" value="${esc(it.detail || '')}" maxlength="500" placeholder="What to do (optional)">
            <button type="submit" class="btn btn-sm">Save</button>
          </form>
          <form method="post" action="/mental-game/routine/delete" style="margin:0">
            <input type="hidden" name="which" value="${which}">
            <input type="hidden" name="idx" value="${i}">
            <input type="hidden" name="back" value="edit">
            <button type="submit" class="link-danger" aria-label="Delete step">✕</button>
          </form>
        </div>`).join('')}
      <form method="post" action="/mental-game/routine/add" class="form" style="margin-top:10px">
        <input type="hidden" name="which" value="${which}">
        <input type="hidden" name="back" value="edit">
        <input type="text" name="text" placeholder="New step..." maxlength="200" required>
        <input type="text" name="detail" placeholder="What to do (optional)" maxlength="500">
        <button type="submit" class="btn btn-sm">Add step</button>
      </form>
    </div>`;
  return layout({
    title: 'Edit Routines',
    user,
    tabs: userTabs('mental', user),
    body: `<h1 class="page-title">Edit Routines</h1>
    <p><a href="/mental-game" class="hint-inline">‹ Back to Lock In</a></p>
    ${section('morning', routines.morning)}
    ${section('pregame', routines.pregame)}
    ${section('practice', routines.practice)}`,
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
  sampleHittingPage,
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
  workoutPage,
  sessionPage,
  programRoutinePage,
  mentalGamePage,
  programEditPage,
  liftingProgramsPage,
  liftingEditPage,
  coachMentalQuestionsPage,
  videosPage,
  videoWatchPage,
  coachLibraryPage,
  esc,
  linkify,
  normWarmup,
  settingsPage,
  DRILL_SECTIONS,
  intakeFormPage,
  intakeDetailPage,
  leadQuestionnaireLinkPage,
  welcomePage,
  waiverPage,
  substitutePage,
  routineEditPage,
  hittingPlanPage,
  hittingPlanEditPage,
};


// Skip — server-rendered HTML views. Black/red, mobile-first, no build step.

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
const TABBAR_HREFS = ['/', '/checkin', '/notebook', '/chat'];
// Coach tab bar (Sep 2026): Bobby's coaching loop — Home (attention),
// Hitters, Approvals (badge), Train Skip. Programs, Videos, and Settings
// stay in the drawer. Same bar for every coach, including view-only Cam.
const COACH_TABBAR_HREFS = ['/coach', '/coach/hitters', '/coach/approvals', '/coach/skip'];
const COACH_TABBAR_ICONS = {
  '/coach': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
  '/coach/hitters': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  '/coach/approvals': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/></svg>',
  '/coach/skip': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
};
const TABBAR_ICONS = {
  '/': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
  '/checkin': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  '/notebook': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
  '/chat': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
};
function bottomTabbar(user, tabs) {
  if (!user) return '';
  const isCoach = user.role === 'coach';
  if (!isCoach && user.role !== 'athlete') return '';
  const hrefs = isCoach ? COACH_TABBAR_HREFS : TABBAR_HREFS;
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
  const tabs = [
    { href: '/', label: 'Home', active: active === 'home' },
    { href: '/checkin', label: 'Check In', active: active === 'checkin' },
    { href: '/notebook', label: 'Notebook', active: active === 'notebook' },
    { href: '/mental-game', label: 'Mental Game', active: active === 'mental' },
    { href: '/chat', label: 'Talk to Skip', sub: 'your personally trained coach', active: active === 'chat' },
    { href: '/settings', label: 'Settings', active: active === 'settings' },
  ];
  // Bobby's remote hitters only — nobody else ever sees this tab.
  if (user && user.remoteProgramId) {
    tabs.splice(3, 0, { href: '/program', label: 'Program', active: active === 'program' });
    tabs.splice(4, 0, { href: '/program/routine', label: 'Routine', active: active === 'routine' });
    tabs.splice(5, 0, { href: '/videos', label: 'Videos', active: active === 'videos' });
  }
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
    { href: '/coach/hitters', label: 'Players', active: active === 'hitters' },
    { href: '/coach/videos', label: 'Videos', active: active === 'videos' },
    { href: '/coach/organizations', label: 'Organizations', active: active === 'organizations' },
    { href: '/coach/skip', label: 'Train Skip', active: active === 'skip' },
    { href: '/coach/approvals', label: 'Approvals', active: active === 'approvals', badge: approvalCount > 0 ? String(approvalCount) : null },
    { href: '/settings', label: 'Settings', active: active === 'settings' },
  ];
  // Finances is Bobby's page: full-access global coaches only. Cam (view-only)
  // and organization coaches never see it.
  if (user && user.role === 'coach' && !user.organizationId && user.canEdit !== false) {
    tabs.splice(5, 0, { href: '/coach/finances', label: 'Finances', active: active === 'finances' });
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
  const { whatWorks = {}, avgScore = null, checkinCount = 0, recent = [], streak = null, pushOn = false, pushEnabled = false, precheckin = null } = extras || {};
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
  return layout({
    title: 'Home',
    user,
    tabs: userTabs('home', user),
    body: `<h1 class="page-title">What's up, ${esc(user.displayName)}</h1>
    <div class="card cta-card">
      <p class="skip-intro">Check in daily. Every session gets a read, and the app learns what your best days look like.</p>
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
    body: `<h1 class="page-title">Check In</h1>
    <div class="card"><p class="hint skip-intro">Log your session. Give as much detail as you can — the more detail, the better the reads get.</p>
    <form method="post" action="/checkin" class="form" data-validate="hitting">
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

// Combined two-way check-in (Sep 2026): one form for both. "What did you do
// today?" toggles the condensed hitting and throwing blocks; feel, focus,
// confidence and the three reflections are shared so he only answers once.
function combinedCheckinForm(user, error, values) {
  const v = values || {};
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
    body: `<h1 class="page-title">Check In</h1>
    <div class="card"><p class="hint skip-intro">One check-in for the whole day. Say what you did — hitting, throwing, or both.</p>
    <form method="post" action="/checkin/combined" class="form" id="combined-form" data-throw-sync data-validate="combined">
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
      <button type="submit" class="btn-primary">Submit check-in</button>
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
function pitchingCheckinForm(user, error, values) {
  const v = values || {};
  const mic = (id) => `<button type="button" class="mic-btn" data-target="${id}" aria-label="Dictate instead of typing">🎙</button>`;
  return layout({
    title: 'Check In',
    user,
    tabs: userTabs('checkin', user),
    body: `<h1 class="page-title">Check In</h1>
    <div class="card"><p class="hint skip-intro">Log your throwing today. The more detail, the better the reads get.</p>
    <form method="post" action="/checkin/pitching" class="form" id="pitching-form" data-throw-sync data-validate="pitching">
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
      <button type="submit" class="btn-primary">Submit check-in</button>
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
    ${avg !== null ? `<div class="level-head"><p class="hint">Your read over ${scored.length} session${scored.length === 1 ? '' : 's'}:</p>${levelLine(avg)}</div>` : ''}
    ${checkins.length ? checkins.map(checkinCard).join('') : `<div class="card empty">${kindName ? `No ${kindName.toLowerCase()} sessions logged yet.` : `No check-ins yet. <a href="/checkin">Log your first session</a>.`}</div>`}`;
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
      <div class="score-breakdown">
        <div><span class="label">Feel</span><strong>${esc(c.feel)}</strong></div>
        <div><span class="label">Confidence</span><strong>${esc(c.confidence)}</strong></div>
        <div><span class="label">Focus</span><strong>${esc(c.focus)}</strong></div>
        ${c.difficulty != null ? `<div><span class="label">Difficulty</span><strong>${esc(c.difficulty)}</strong></div>` : ''}
        ${throwBits.map(([l, val]) => `<div><span class="label">${esc(l)}</span><strong>${esc(val)}</strong></div>`).join('')}
      </div>
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

function checkinCard(c) {
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
      <span class="hint-inline">Feel ${esc(c.feel)} · Conf ${esc(c.confidence)} · Focus ${esc(c.focus)}${c.difficulty != null ? ` · Difficulty ${esc(c.difficulty)}` : ''}${c.command != null ? ` · Command ${esc(c.command)}` : ''}</span>
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
    <details class="checkin-more"><summary>Full entry</summary>${words || `<p class="hint">No notes written for this session.</p>`}</details>
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
function coachHomePage(user, quiet, latest, pending, pushOn, analytics) {
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
  const cards = [
    statCard(a.players || 0, 'Players'),
    ...(isGlobal
      ? [statCard(a.orgCount || 0, 'Organizations', '', '/coach/organizations'),
         statCard(fmtMoney(a.revenueCents), 'Collected', '', '/coach/organizations')]
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
        (o) => `<div class="org-row">
          <div><strong>${esc(o.name)}</strong>
            <div class="hint-inline">${o.players} player${o.players === 1 ? '' : 's'} \u00b7 ${o.weekCheckins} check-in${o.weekCheckins === 1 ? '' : 's'} \u00b7 7d</div>
          </div>
          <div class="org-money">${o.paidCents ? `<span class="badge ok">${fmtMoney(o.paidCents)} paid</span>` : o.dealCents ? `<span class="badge warn">${fmtMoney(o.dealCents)} deal \u00b7 unpaid</span>` : '<span class="hint-inline">no deal set</span>'}</div>
        </div>`
      )
      .join('')}</div>`
    : '';
  const approvalNudge = pending && pending.length
    ? `<a class="card approval-nudge" href="/coach/approvals">${pending.length} player${pending.length === 1 ? '' : 's'} waiting for approval →</a>`
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
    ${canEdit && !pushOn ? '<p><button type="button" class="btn-small" id="push-enable-btn">Turn on notifications</button> <span class="hint-inline">get a push when a player needs approval</span></p>' : ''}
    ${approvalNudge}
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
function coachHittersPage(user, userStats) {
  const cards = userStats
    .map(
      (a) => `<div class="card athlete-card" data-search="${esc(`${a.name} ${a.email}`.toLowerCase())}" data-role="${esc(a.playerType || 'hitter')}">
        <a href="/coach/user/${encodeURIComponent(a.email)}" style="display:block;color:inherit;text-decoration:none">
          <div class="athlete-card-name">${esc(a.name)} ${rolePill(a.playerType)}</div>
          <div class="athlete-card-email">${esc(a.email)}</div>
          <div class="athlete-card-meta">${a.total} check-in${a.total === 1 ? '' : 's'}${a.last ? ` · last ${fmtDate(a.last)}` : ' · none yet'}${a.age != null ? ` · age ${a.age}` : ''}${a.team ? ` · ${esc(a.team)}` : ''}</div>
        </a>
        <form method="post" action="/coach/view-as" style="margin:8px 0 0">
          <input type="hidden" name="id" value="${a.id}">
          <button class="btn-small btn-quiet" type="submit">View as player</button>
        </form>
      </div>`
    )
    .join('');
  return layout({
    title: 'Players',
    user,
    tabs: coachTabs('hitters', user.approvalCount, user),
    body: `<h1 class="page-title">Players</h1>
    ${userStats.length ? `<input type="search" id="hitter-search" class="searchbar" placeholder="Search players…" autocomplete="off">` : ''}
    ${userStats.length ? `<div class="pill-row" id="role-filter">
      <button type="button" class="pill-link active" data-rolefilter="all">All</button>
      <button type="button" class="pill-link" data-rolefilter="hitter">Hitters</button>
      <button type="button" class="pill-link" data-rolefilter="pitcher">Pitchers</button>
      <button type="button" class="pill-link" data-rolefilter="two_way">Two-way</button>
    </div>` : ''}
    <div class="athlete-grid">${cards || '<div class="card empty">Nobody has signed up yet.</div>'}</div>
    <div class="card empty" id="hitter-no-match" hidden>No players match that search.</div>`,
  });
}

// Coach Programs tab: the remote program list.
function coachProgramsPage(user, remotePrograms) {
  const canEdit = user.role === 'coach' && user.canEdit !== false;
  return layout({
    title: 'Programs',
    user,
    tabs: coachTabs('programs', user.approvalCount, user),
    body: `<h1 class="page-title">Programs</h1>
    ${remoteProgramsSection(remotePrograms || [], canEdit)}`,
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
    <p class="lede">Answer honestly — it gauges where your head's at and builds your plan from it.</p>
    ${saved ? '<div class="notice">Saved — your plan is below.</div>' : ''}
    ${planFailed ? '<div class="notice">Baseline saved, but the plan didn\u2019t come through — tap the button again.</div>' : ''}
    ${planHtml}
    <div class="card">
      <h2 class="routine-station">Your keys</h2>
      <p class="hint">Things you saved from the chat. Tell him <strong>&ldquo;add this to my mental game&rdquo;</strong> and it lands here.</p>
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
function programEditPage(user, p, profileEmail) {
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
    tabs: coachTabs('organizations', user.approvalCount, user),
    body: `<h1 class="page-title">Program — ${esc(p.athlete_name)}</h1>
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
function remoteProgramsSection(list, canEdit) {
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
            r.user_email
              ? `<form method="post" action="/coach/remote/unlink" class="inline-form"><input type="hidden" name="id" value="${r.id}"><button class="btn btn-sm" type="submit">Unlink</button></form>`
              : `<form method="post" action="/coach/remote/link" class="inline-form"><input type="email" name="email" placeholder="hitter email" required class="input-sm"><input type="hidden" name="id" value="${r.id}"><button class="btn btn-sm" type="submit">Link</button></form>`
          }
          <form method="post" action="/coach/remote/remove" class="inline-form" data-confirm-remove="${esc(r.athlete_name)}"><input type="hidden" name="id" value="${r.id}"><button class="btn btn-sm btn-danger" type="submit">Remove</button></form>
        </div>`
        : '';
      return `<div class="remote-row">
        <div>${r.user_email ? `<strong>${athleteLink(r.user_email, esc(r.athlete_name))}</strong>` : `<strong>${esc(r.athlete_name)}</strong>`}<div class="hint-inline">${linked}${updated}</div>${aliasLine}
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
    title: 'Video library',
    user,
    tabs: coachTabs('videos', user.approvalCount, user),
    body: `<p><a href="/coach">\u2190 Dashboard</a></p>
    <h1 class="page-title">Video library</h1>
    <div class="hint-inline">Renames and hidden videos are yours only — the Drive sync never overwrites them. New Drive files appear here automatically.</div>
    ${player}
    <div class="pill-row">${pills}</div>
    ${rows || '<div class="card empty">No videos in this category yet.</div>'}`,
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

function coachUser(user, name, checkins, whatWorks, thread, email, memories, routine, playerType, throwSum) {
  const pt = playerType || 'hitter';
  const skipImg = `<img src="${skipAvatar({ playerType: pt })}" class="skip-avatar" alt="Skip">`;
  const canEdit = user.role === 'coach' && user.canEdit !== false;
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
    <p><a href="/coach/hitters">← Back to players</a></p>
    ${pt === 'pitcher' ? '' : routineReadonly(routine)}
    ${pt !== 'hitter' ? throwingSummarySection(throwSum) : ''}
    ${memorySection(email, memories, canEdit)}
    ${whatWorksSection(whatWorks || {}, { readOnly: true })}
    ${convo}
    ${checkins.length ? checkins.map(checkinCard).join('') : '<div class="card empty">No check-ins yet.</div>'}
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
  scorePage,
  chatPage,
  coachHomePage,
  coachHittersPage,
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
  videosPage,
  videoWatchPage,
  coachLibraryPage,
  esc,
  settingsPage,
};

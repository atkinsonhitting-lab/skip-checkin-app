// Skip client-side helpers: local timestamps, check-in sliders.
(function () {
  // Localize server-rendered UTC timestamps.
  document.querySelectorAll('[data-localtime]').forEach((el) => {
    try {
      const d = new Date(el.getAttribute('data-localtime'));
      el.textContent = d.toLocaleString(undefined, {
        month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
      });
    } catch (e) { /* leave as-is */ }
  });

  // Live value readout for 1–10 sliders on the check-in form.
  document.querySelectorAll('input[type="range"].slider').forEach((slider) => {
    const out = document.getElementById(slider.dataset.out);
    if (!out) return;
    slider.addEventListener('input', () => { out.textContent = slider.value; });
  });

  // ---- Talk to Skip chat ----
  (function chat() {
    const form = document.getElementById('chat-form');
    if (!form) return;
    const log = document.getElementById('chat-log');
    const input = document.getElementById('chat-input');
    function scroll() { log.scrollTop = log.scrollHeight; }
    // (Speaker button removed Sep 15 2026 — text only.)
    function addMsg(role, text, speakable) {
      const d = document.createElement('div');
      d.className = 'msg ' + (role === 'user' ? 'msg-user' : 'msg-skip');
      if (role !== 'user') {
        const img = document.createElement('img');
        img.src = log.dataset.skipAvatar || '/skip-avatar.webp';
        img.className = 'skip-avatar';
        img.alt = 'Skip';
        d.appendChild(img);
      }
      const b = document.createElement('div');
      b.className = 'msg-bubble';
      b.textContent = text;
      d.appendChild(b);
      log.appendChild(d);
      scroll();
    }
    scroll();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      input.disabled = true;
      addMsg('user', text);
      const thinking = document.createElement('div');
      thinking.className = 'msg msg-skip';
      thinking.innerHTML = '<img src="' + (log.dataset.skipAvatar || '/skip-avatar.webp') + '" class="skip-avatar" alt="Skip"><div class="msg-bubble typing"><span></span><span></span><span></span></div>';
      log.appendChild(thinking);
      scroll();
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 45000);
        const endpoint = form.dataset.endpoint || '/api/chat';
        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text }),
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        const data = await resp.json().catch(() => ({}));
        thinking.remove();
        if (data.reply) addMsg('assistant', data.reply);
        else addMsg('assistant', data.error || 'Something went wrong. Try again.', false);
      } catch (err) {
        thinking.remove();
        addMsg(
          'assistant',
          err && err.name === 'AbortError'
            ? 'Skip is taking too long — try sending that again.'
            : 'Could not reach Skip. Check your connection and try again.',
          false
        );
      }
      input.disabled = false;
      input.focus();
    });
  })();

})();

  // ---- Check-in drill picker: pure helpers (unit-tested via source extraction) ----
  // Routine station -> drill-picker section key.
  function sectionKeyForStation(station) {
    const s = String(station || '').trim().toLowerCase();
    if (s === 'prep') return 'prep';
    if (s === 'tee') return 'tee';
    if (s === 'side toss') return 'sideToss';
    if (s === 'front toss') return 'frontToss';
    if (s === 'bp' || s === 'batting practice') return 'bp';
    if (s === 'machine') return 'machine';
    return 'other';
  }
  // Add a {name, section} token: no dupes (case-insensitive on name+section),
  // no blanks. Returns true when the token was added.
  function addDrillToken(tokens, name, section) {
    const clean = String(name || '').trim();
    if (!clean) return false;
    const sec = String(section || 'other');
    const key = sec + '|' + clean.toLowerCase();
    for (const t of tokens) {
      if (String(t.section || 'other') + '|' + String(t.name || '').toLowerCase() === key) return false;
    }
    tokens.push({ name: clean, section: sec });
    return true;
  }
  // Serialize tokens into per-section comma-separated values for the hidden
  // sec_* inputs. Every section key is always present ('' when empty), so a
  // blank picker submits as none and nothing lands on the entry.
  function serializeDrillTokens(tokens) {
    const out = { prep: [], tee: [], sideToss: [], frontToss: [], bp: [], machine: [], other: [] };
    for (const t of tokens || []) {
      const k = Object.prototype.hasOwnProperty.call(out, t.section) ? t.section : 'other';
      const name = String(t.name || '').trim();
      if (name) out[k].push(name);
    }
    const joined = {};
    for (const k of Object.keys(out)) joined[k] = out[k].join(', ');
    return joined;
  }

  // ---- Check-in: "What did you do today?" searchable dropdown (Bobby, Sep 18 2026) ----
  // One compact combobox replaces the 7 stacked section inputs. Players search
  // the dropdown or type their own; each pick is tagged with a delivery-method
  // section (the select next to the input, or the option's own section for
  // history picks). "Didn't do this" clears every token. Tokens serialize into
  // the hidden sec_* inputs on submit, so the server parser is untouched.
  (function drillCombo() {
    const input = document.getElementById('drill-input');
    if (!input) return;
    const menu = document.getElementById('drill-menu');
    const tokensEl = document.getElementById('drill-tokens');
    const sectionSel = document.getElementById('drill-section');
    const form = input.closest('form');
    const SECTION_LABEL = { prep: 'Prep', tee: 'Tee', sideToss: 'Side toss', frontToss: 'Front toss', bp: 'BP', machine: 'Machine', other: 'Other' };
    const SECTION_INPUT = { prep: 'sec_prep', tee: 'sec_tee', sideToss: 'sec_sidetoss', frontToss: 'sec_fronttoss', bp: 'sec_bp', machine: 'sec_machine', other: 'sec_other' };
    function esc(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function readJson(id) {
      const el = document.getElementById(id);
      if (!el) return null;
      try { return JSON.parse(el.textContent || 'null'); } catch (e) { return null; }
    }
    const opts = readJson('drill-options') || { recent: [], registry: [] };
    const tokens = readJson('drill-initial') || [];
    function renderTokens() {
      tokensEl.innerHTML = tokens.map((t, i) =>
        '<span class="drill-token">' + esc(t.name) + ' <span class="drill-token-sec">' + esc(SECTION_LABEL[t.section] || t.section) + '</span>' +
        '<button type="button" class="drill-token-x" data-i="' + i + '" aria-label="Remove ' + esc(t.name) + '">\u00d7</button></span>'
      ).join('');
    }
    tokensEl.addEventListener('click', (ev) => {
      const b = ev.target.closest ? ev.target.closest('[data-i]') : null;
      if (!b) return;
      tokens.splice(Number(b.getAttribute('data-i')), 1);
      renderTokens();
      input.focus();
    });
    // ---- dropdown ----
    let items = []; // menu items: {act:'none'} | {act:'add', name, section|null}
    let active = -1;
    function matches(q) {
      q = String(q || '').trim().toLowerCase();
      const hit = (o) => !q || String(o.name).toLowerCase().indexOf(q) !== -1;
      return {
        recent: (opts.recent || []).filter(hit).slice(0, 8),
        registry: (opts.registry || []).filter(hit).slice(0, 40),
      };
    }
    function renderMenu() {
      const m = matches(input.value);
      items = [{ act: 'none' }];
      let html = '<div class="drill-option drill-option-none" role="option" data-i="0">Didn\u2019t do this</div>';
      if (m.recent.length) {
        html += '<div class="drill-menu-group">Recent</div>';
        m.recent.forEach((o) => {
          items.push({ act: 'add', name: o.name, section: o.section });
          html += '<div class="drill-option" role="option" data-i="' + (items.length - 1) + '">' + esc(o.name) +
            ' <span class="drill-option-sec">' + esc(SECTION_LABEL[o.section] || '') + '</span></div>';
        });
      }
      if (m.registry.length) {
        html += '<div class="drill-menu-group">All drills</div>';
        m.registry.forEach((o) => {
          items.push({ act: 'add', name: o.name, section: null });
          html += '<div class="drill-option" role="option" data-i="' + (items.length - 1) + '">' + esc(o.name) + '</div>';
        });
      }
      if (!m.recent.length && !m.registry.length && String(input.value).trim()) {
        html += '<div class="drill-menu-hint">No matches \u2014 hit enter to add \u201c' + esc(String(input.value).trim()) + '\u201d.</div>';
      }
      menu.innerHTML = html;
      active = -1;
    }
    function openMenu() {
      renderMenu();
      menu.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }
    function closeMenu() {
      menu.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      active = -1;
    }
    function isOpen() { return !menu.hidden; }
    function highlight() {
      const els = menu.querySelectorAll('.drill-option');
      els.forEach((el, i) => el.classList.toggle('active', i === active));
      if (active >= 0 && els[active] && els[active].scrollIntoView) {
        els[active].scrollIntoView({ block: 'nearest' });
      }
    }
    function defaultSection() { return (sectionSel && sectionSel.value) || 'other'; }
    function commitTyped() {
      const typed = String(input.value || '').trim();
      if (!typed) return;
      if (addDrillToken(tokens, typed, defaultSection())) {
        renderTokens();
        input.value = '';
        closeMenu();
      }
    }
    function pick(item) {
      if (!item) return;
      if (item.act === 'none') {
        // "Didn't do this": clear everything so nothing lands on the entry.
        tokens.length = 0;
        renderTokens();
        input.value = '';
        closeMenu();
        input.focus();
        return;
      }
      if (addDrillToken(tokens, item.name, item.section || defaultSection())) {
        renderTokens();
        input.value = '';
        closeMenu();
        input.focus();
      }
    }
    input.addEventListener('focus', openMenu);
    input.addEventListener('input', () => { if (!isOpen()) openMenu(); else renderMenu(); });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { closeMenu(); return; }
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        if (!isOpen()) openMenu();
        const n = items.length;
        active = ev.key === 'ArrowDown' ? (active + 1) % n : (active - 1 + n) % n;
        highlight();
        return;
      }
      if (ev.key === 'Enter') {
        ev.preventDefault();
        if (isOpen() && active >= 0 && active < items.length) pick(items[active]);
        else commitTyped();
      }
    });
    menu.addEventListener('mousedown', (ev) => {
      const el = ev.target.closest ? ev.target.closest('.drill-option') : null;
      if (!el) return;
      ev.preventDefault(); // keep input focus; pick on mousedown before blur
      pick(items[Number(el.getAttribute('data-i'))]);
    });
    document.addEventListener('click', (ev) => {
      if (!ev.target.closest || !ev.target.closest('.drill-combo')) closeMenu();
    });
    // "Use my daily routine" (top of the section, Bobby Sep 18 2026): merges
    // each routine item in as a token under its station's section — never
    // wipes what the player already picked or typed.
    const routineBtn = document.getElementById('use-routine');
    if (routineBtn) routineBtn.addEventListener('click', () => {
      let drills = [];
      try { drills = JSON.parse(routineBtn.dataset.routine || '[]'); } catch (e) { drills = []; }
      let added = false;
      for (const d of drills) {
        if (addDrillToken(tokens, String(d.name || ''), sectionKeyForStation(d.station))) added = true;
      }
      if (added) renderTokens();
      input.focus();
    });
    // Serialize tokens into the hidden sec_* inputs on submit. A leftover
    // typed-but-uncommitted entry is committed first so nothing is lost.
    if (form) form.addEventListener('submit', () => {
      commitTyped();
      const bySection = serializeDrillTokens(tokens);
      for (const k of Object.keys(SECTION_INPUT)) {
        const el = document.getElementById(SECTION_INPUT[k]);
        if (el) el.value = bySection[k];
      }
    });
    renderTokens();
  })();

  // ---- Coach dashboard: filter hitters as you type + by role ----
  (function hitterSearch() {
    const input = document.getElementById('hitter-search');
    const pills = Array.from(document.querySelectorAll('[data-rolefilter]'));
    if (!input && !pills.length) return;
    const cards = Array.from(document.querySelectorAll('.athlete-card[data-search]'));
    const none = document.getElementById('hitter-no-match');
    let role = 'all';
    function apply() {
      const q = input ? input.value.trim().toLowerCase() : '';
      let shown = 0;
      cards.forEach((c) => {
        const hitQ = !q || (c.getAttribute('data-search') || '').includes(q);
        const hitR = role === 'all' || (c.getAttribute('data-role') || 'hitter') === role;
        const hit = hitQ && hitR;
        c.style.display = hit ? '' : 'none';
        if (hit) shown++;
      });
      if (none) none.hidden = shown > 0;
    }
    if (input) input.addEventListener('input', apply);
    pills.forEach((p) =>
      p.addEventListener('click', () => {
        role = p.getAttribute('data-rolefilter');
        pills.forEach((x) => x.classList.toggle('active', x === p));
        apply();
      })
    );
  })();

  // ---- Program day navigator (Mon-Fri pills; auto-opens today) ----
  // Lives here (not inline) because helmet's CSP blocks inline scripts.
  (function dayNav() {
    var pills = document.querySelectorAll('[data-daypill]');
    if (!pills.length) return;
    var panels = document.querySelectorAll('[data-daypanel]');
    function show(day) {
      pills.forEach(function (p) {
        p.classList.toggle('active', p.getAttribute('data-daypill') === day);
      });
      panels.forEach(function (p) {
        p.hidden = p.getAttribute('data-daypanel') !== day;
      });
    }
    pills.forEach(function (p) {
      p.addEventListener('click', function () {
        show(p.getAttribute('data-daypill'));
      });
    });
    var names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    var want = names[new Date().getDay()];
    var pillDays = Array.prototype.map.call(pills, function (p) {
      return p.getAttribute('data-daypill');
    });
    if (pillDays.indexOf(want) === -1) want = pillDays[0];
    if (want) show(want);
  })();

  // ---- Coach program editor: add/remove training blocks (CSP-safe) ----
  (function progEditor() {
    var wrap = document.getElementById('prog-cats');
    if (!wrap) return;
    var next = parseInt(wrap.getAttribute('data-next') || '0', 10);
    function addCat(presetName) {
      var div = document.createElement('div');
      div.className = 'card routine-group prog-cat';
      div.setAttribute('data-cat', '');
      div.innerHTML =
        '<div class="cat-head-row"><span class="hint-inline">Block</span>' +
        '<span class="cat-move"><button type="button" class="btn btn-sm" data-move-cat="-1" title="Move block up">↑</button>' +
        '<button type="button" class="btn btn-sm" data-move-cat="1" title="Move block down">↓</button></span></div>' +
        '<label class="fld">Category<input type="text" name="cat_' + next + '_name" maxlength="60" value="' +
        String(presetName || '').replace(/"/g, '&quot;') + '"></label>' +
        '<label class="fld">Drills — one per line, as <em>Drill</em> or <em>Drill | volume</em>' +
        '<textarea name="cat_' + next + '_items" rows="4"></textarea></label>' +
        '<button type="button" class="btn btn-danger btn-sm" data-remove-cat>Remove category</button>';
      wrap.appendChild(div);
      next++;
      div.scrollIntoView({ block: 'nearest' });
    }
    var addBtn = document.getElementById('prog-add-cat');
    if (addBtn) addBtn.addEventListener('click', function () { addCat(''); });
    document.querySelectorAll('[data-addcat-name]').forEach(function (b) {
      b.addEventListener('click', function () { addCat(b.getAttribute('data-addcat-name')); });
    });
    wrap.addEventListener('click', function (e) {
      if (e.target && e.target.hasAttribute('data-remove-cat')) {
        var card = e.target.closest('[data-cat]');
        if (card) card.remove();
        return;
      }
      // Move block up/down: swap the field VALUES with the neighbor card.
      // (The save handler reads cat_N_name by index, so swapping values
      // reorders the saved program without renumbering fields.)
      if (e.target && e.target.hasAttribute('data-move-cat')) {
        var dir = parseInt(e.target.getAttribute('data-move-cat'), 10);
        var card = e.target.closest('[data-cat]');
        if (!card) return;
        var sib = dir < 0 ? card.previousElementSibling : card.nextElementSibling;
        while (sib && !sib.hasAttribute('data-cat')) sib = dir < 0 ? sib.previousElementSibling : sib.nextElementSibling;
        if (!sib) return;
        var aName = card.querySelector('input[name$="_name"]');
        var aItems = card.querySelector('textarea');
        var bName = sib.querySelector('input[name$="_name"]');
        var bItems = sib.querySelector('textarea');
        if (!aName || !bName) return;
        var t1 = aName.value, t2 = aItems ? aItems.value : '';
        aName.value = bName.value;
        if (aItems) aItems.value = bItems ? bItems.value : '';
        bName.value = t1;
        if (bItems) bItems.value = t2;
      }
    });
  })();

  // ---- Video library search filter (CSP-safe) ----
  (function videoSearch() {
    var box = document.getElementById('video-search');
    if (!box) return;
    var none = document.getElementById('video-no-match');
    box.addEventListener('input', function () {
      var q = box.value.trim().toLowerCase();
      var shown = 0;
      document.querySelectorAll('.video-card').forEach(function (el) {
        var hit = !q || (el.getAttribute('data-search') || '').indexOf(q) !== -1;
        el.style.display = hit ? '' : 'none';
        if (hit) shown++;
      });
      if (none) none.hidden = shown !== 0;
    });
  })();

  // ---- Notebook prompt chips (CSP-safe) ----
  document.querySelectorAll('[data-prompt-text]').forEach(function (chip) {
    chip.addEventListener('click', function () {
      var box = document.getElementById('note-text');
      if (box) {
        box.value = chip.getAttribute('data-prompt-text') || '';
        box.focus();
      }
    });
  });

  // ---- Confirm before removing a remote hitter (CSP-safe) ----
  document.querySelectorAll('[data-confirm-remove]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      var name = form.getAttribute('data-confirm-remove') || 'this hitter';
      if (!window.confirm('Remove ' + name + ' and their program?')) e.preventDefault();
    });
  });

// ---- Push notifications: service worker + subscribe ----
(function push() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(function () {});
  }
  var btn = document.getElementById('push-enable-btn');
  if (!btn) return;
  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(base64);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  fetch('/api/push/status').then(function (r) { return r.json(); }).then(function (st) {
    if (!st.pushEnabled) { btn.style.display = 'none'; return; }
    if (st.subscribed) {
      btn.textContent = /notification/i.test(btn.textContent) ? 'Notifications on' : 'Reminders on';
      btn.disabled = true;
    }
  }).catch(function () {});
  btn.addEventListener('click', function () {
    btn.disabled = true;
    (async function () {
      try {
        if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
          btn.textContent = 'Not supported on this browser';
          return;
        }
        var perm = await Notification.requestPermission();
        if (perm !== 'granted') {
          btn.textContent = 'Blocked — allow notifications in settings';
          btn.disabled = false;
          return;
        }
        var reg = await navigator.serviceWorker.ready;
        var keyResp = await fetch('/api/push/vapid-key');
        var keyJson = await keyResp.json();
        if (!keyJson.publicKey) { btn.textContent = 'Reminders not set up yet'; return; }
        var sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(keyJson.publicKey),
        });
        var resp = await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ subscription: sub.toJSON() }),
        });
        if (!resp.ok) throw new Error('subscribe failed');
        btn.textContent = /notification/i.test(btn.textContent) ? 'Notifications on' : 'Reminders on';
      } catch (e) {
        btn.textContent = 'Could not turn on — try again';
        btn.disabled = false;
      }
    })();
  });
})();

// ---- Sidebar drawer nav ----
(function drawer() {
  var btn = document.getElementById('drawer-btn');
  var panel = document.getElementById('drawer');
  var overlay = document.getElementById('drawer-overlay');
  var closeBtn = document.getElementById('drawer-close');
  if (!btn || !panel || !overlay) return;
  function open() {
    panel.hidden = false;
    overlay.hidden = false;
    requestAnimationFrame(function () { document.body.classList.add('drawer-open'); });
  }
  function close() {
    document.body.classList.remove('drawer-open');
    setTimeout(function () { panel.hidden = true; overlay.hidden = true; }, 260);
  }
  btn.addEventListener('click', open);
  if (closeBtn) closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', close);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && document.body.classList.contains('drawer-open')) close();
  });
})();

  // ---- Compact day picker: <select data-autosubmit> submits its form ----
  document.addEventListener('change', function (e) {
    if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-autosubmit')) {
      var f = e.target.closest('form');
      if (f) f.submit();
    }
  });

  // ---- Lifting program editor (coach): days + per-exercise rows ----
  (function liftEditor() {
    var form = document.getElementById('lift-form');
    if (!form) return;
    var daysWrap = document.getElementById('lift-days');
    var dayCount = parseInt(window.__liftEditDays || '0', 10) || daysWrap.querySelectorAll('[data-lift-day]').length;
    function exRowHtml(i, j) {
      var rpe = '<option value="">—</option>';
      for (var v = 1; v <= 10; v++) rpe += '<option value="' + v + '">' + v + '</option>';
      return '<div class="lift-ex-edit" data-exrow>' +
        '<input name="lex_' + i + '_' + j + '_name" placeholder="Exercise" maxlength="120" required>' +
        '<input name="lex_' + i + '_' + j + '_sets" placeholder="Sets" maxlength="12" class="num">' +
        '<input name="lex_' + i + '_' + j + '_reps" placeholder="Reps" maxlength="24" class="num">' +
        '<select name="lex_' + i + '_' + j + '_trpe" title="Target RPE">' + rpe + '</select>' +
        '<input name="lex_' + i + '_' + j + '_notes" placeholder="Cue / note" maxlength="200" class="wide">' +
        '<button type="button" class="btn btn-sm btn-danger" data-rmex>✕</button></div>';
    }
    function renumberDay(fs) {
      var i = parseInt(fs.getAttribute('data-lift-day'), 10);
      var rows = fs.querySelectorAll('[data-exrow]');
      rows.forEach(function (row, j) {
        row.querySelectorAll('input, select').forEach(function (inp) {
          var m = inp.name.match(/^lex_\d+_\d+_(.+)$/);
          if (m) inp.name = 'lex_' + i + '_' + j + '_' + m[1];
        });
      });
      var cnt = fs.querySelector('[data-excount]');
      if (cnt) cnt.value = rows.length;
    }
    daysWrap.addEventListener('click', function (e) {
      var t = e.target;
      if (!t) return;
      if (t.hasAttribute('data-addex')) {
        var i = parseInt(t.getAttribute('data-addex'), 10);
        var fs = daysWrap.querySelector('[data-lift-day="' + i + '"]');
        if (!fs) return;
        var list = fs.querySelector('[data-exlist]');
        var j = list.querySelectorAll('[data-exrow]').length;
        var tmp = document.createElement('div');
        tmp.innerHTML = exRowHtml(i, j);
        list.appendChild(tmp.firstChild);
        renumberDay(fs);
        return;
      }
      if (t.hasAttribute('data-rmex')) {
        var row = t.closest('[data-exrow]');
        var fs2 = t.closest('[data-lift-day]');
        if (row) row.remove();
        if (fs2) renumberDay(fs2);
        return;
      }
      if (t.hasAttribute('data-rmday')) {
        var fs3 = t.closest('[data-lift-day]');
        if (fs3 && window.confirm('Remove this day and its exercises?')) {
          fs3.remove();
          var fss = daysWrap.querySelectorAll('[data-lift-day]');
          fss.forEach(function (f, ni) {
            var oi = parseInt(f.getAttribute('data-lift-day'), 10);
            if (oi !== ni) {
              f.setAttribute('data-lift-day', String(ni));
              f.querySelectorAll('input[name^="lday_"]').forEach(function (inp) {
                inp.name = inp.name.replace(/^lday_\d+_/, 'lday_' + ni + '_');
              });
              f.querySelectorAll('[data-addex]').forEach(function (b) { b.setAttribute('data-addex', String(ni)); });
            }
          });
          dayCount = fss.length;
          fss.forEach(renumberDay);
        }
      }
    });
    var addDay = document.getElementById('lift-add-day');
    if (addDay) {
      addDay.addEventListener('click', function () {
        if (dayCount >= 14) return;
        var i = dayCount;
        var fs = document.createElement('fieldset');
        fs.className = 'card lift-day';
        fs.setAttribute('data-lift-day', String(i));
        fs.innerHTML =
          '<legend class="lift-day-legend">Day ' + (i + 1) + '</legend>' +
          '<input type="hidden" name="lday_' + i + '_excount" value="0" data-excount>' +
          '<label class="lift-field">Day label <input name="lday_' + i + '_label" maxlength="40" placeholder="Day ' + String.fromCharCode(65 + i) + '"></label>' +
          '<div class="lift-ex-list" data-exlist></div>' +
          '<div class="row-actions"><button type="button" class="btn small" data-addex="' + i + '">+ Exercise</button> ' +
          '<button type="button" class="btn btn-sm btn-danger" data-rmday>Remove day</button></div>';
        daysWrap.appendChild(fs);
        dayCount++;
      });
    }
  })();

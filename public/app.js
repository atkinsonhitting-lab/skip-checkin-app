// Shared mic recorder (Sep 23 2026): uses getUserMedia + MediaRecorder.
// iOS remembers the mic permission, so it only asks once — unlike the
// Web Speech API which prompts on every use. Audio goes to /api/transcribe.
window.SkipMic = (function () {
  // Prefer the phone's built-in speech recognition (Bobby, Sep 23 2026) —
  // far more accurate for dictation than server transcription, and instant.
  // Falls back to MediaRecorder + server transcribe where unsupported.
  // Like the iOS keyboard mic (Bobby, Sep 23 2026): words appear in the
  // text box LIVE as they speak. `target` is the textarea to fill.
  // Dialed in: iOS kills recognition on silence — auto-restart so the kid
  // never has to "go again". Only stops when they tap.
  function webspeechRecord(onDone, onStatus, target) {
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Rec || !target) return null;
    const rec = new Rec();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = true;
    const base = target.value ? target.value.replace(/\s+$/, '') + ' ' : '';
    let finalText = '';
    let userStopped = false;
    let restarts = 0;
    const paint = (interim) => {
      target.value = base + finalText + interim;
      target.scrollTop = target.scrollHeight;
    };
    const startRec = () => {
      try { rec.start(); } catch (e) { /* already started */ }
    };
    rec.onresult = (ev) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) finalText += t + ' ';
        else interim += t;
      }
      paint(interim);
      restarts = 0; // got speech — reset the restart budget
      if (onStatus) onStatus('Listening… tap again to stop');
    };
    rec.onerror = (ev) => {
      if (userStopped) return;
      const err = ev && ev.error;
      // "no-speech" / "aborted" just mean iOS cut it — restart, don't quit.
      if ((err === 'no-speech' || err === 'aborted') && restarts < 5) {
        restarts++;
        setTimeout(() => { if (!userStopped) startRec(); }, 300);
        return;
      }
      userStopped = true;
      try { rec.stop(); } catch (e) {}
      onDone(finalText.trim());
    };
    rec.onend = () => {
      if (userStopped) return;
      // iOS ended it (silence/timeout) — keep going until they tap stop.
      if (restarts < 5) {
        restarts++;
        setTimeout(() => { if (!userStopped) startRec(); }, 300);
      } else {
        userStopped = true;
        onDone(finalText.trim());
      }
    };
    startRec();
    if (onStatus) onStatus('Listening… tap again to stop');
    return () => {
      if (!userStopped) {
        userStopped = true;
        try { rec.stop(); } catch (e) {}
        // Give onend a beat; if it doesn't fire, finish now.
        setTimeout(() => onDone(finalText.trim()), 400);
      }
    };
  }
  let stream = null;
  async function getStream() {
    if (stream && stream.active) return stream;
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return stream;
  }
  // onDone(transcript), onStatus(text). Returns a stop function (or promise of one).
  // Pass { target: textarea } for live keyboard-mic-style fill.
  async function record(onDone, onStatus, opts) {
    const ws = webspeechRecord(onDone, onStatus, opts && opts.target);
    if (ws) return ws;
    const s = await getStream();
    const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
    const rec = new MediaRecorder(s, { mimeType: mime });
    const chunks = [];
    rec.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
    rec.onstop = async () => {
      if (onStatus) onStatus('Transcribing…');
      const blob = new Blob(chunks, { type: mime });
      // Skip tiny/empty recordings (tap-stop with no speech).
      if (blob.size < 2000) { onDone(''); return; }
      const b64 = await new Promise((resolve) => {
        const r = new FileReader();
        r.onloadend = () => resolve(String(r.result).split(',')[1] || '');
        r.readAsDataURL(blob);
      });
      // Try transcription twice before giving up — don't make them re-record
      // for a one-off server hiccup (Bobby, Sep 23 2026).
      let transcript = '';
      for (let attempt = 0; attempt < 2 && !transcript; attempt++) {
        if (attempt > 0 && onStatus) onStatus('One more try…');
        try {
          const resp = await fetch('/api/transcribe', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ audio: b64, mime }),
          });
          const d = await resp.json();
          if (d.ok && d.transcript) transcript = d.transcript;
        } catch (e) { /* retry once */ }
      }
      onDone(transcript);
    };
    rec.start();
    return () => { if (rec.state !== 'inactive') rec.stop(); };
  }
  return { record };
})();

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

// ---- Keep the bottom tab bar pinned when the iOS keyboard opens ----
// iOS positions position:fixed;bottom:0 relative to the visual viewport,
// so the tab bar rides up above the keyboard and drops back down when it
// closes. Counter-translate it by the keyboard height so it stays put
// (tucked behind the keyboard while typing) instead of jumping.
(function pinTabbar() {
  var tabbar = document.getElementById('tabbar');
  if (!tabbar) return;
  var vv = window.visualViewport;
  if (!vv) return;
  function pin() {
    var kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    tabbar.style.transform = kb > 1 ? 'translateY(' + Math.round(kb) + 'px)' : '';
  }
  vv.addEventListener('resize', pin);
  vv.addEventListener('scroll', pin);
  pin();
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
        '<input name="lex_' + i + '_' + j + '_video" placeholder="YouTube link" maxlength="300" class="wide" inputmode="url">' +
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
              f.querySelectorAll('input[name^="lday_"], textarea[name^="lday_"]').forEach(function (inp) {
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
          '<label class="lift-field">Warm-up <span class="hint-inline">(one per line)</span>' +
          '<textarea name="lday_' + i + '_warmup" rows="3" style="width:100%;box-sizing:border-box"></textarea></label>' +
          '<label class="lift-field">Speed — sprints first <span class="hint-inline">(one per line: Name | volume | notes)</span>' +
          '<textarea name="lday_' + i + '_speed" rows="3" style="width:100%;box-sizing:border-box"></textarea></label>' +
          '<div class="lift-ex-list" data-exlist></div>' +
          '<div class="row-actions"><button type="button" class="btn small" data-addex="' + i + '">+ Exercise</button> ' +
          '<button type="button" class="btn btn-sm btn-danger" data-rmday>Remove day</button></div>';
        daysWrap.appendChild(fs);
        dayCount++;
      });
    }
  })();

// Bible study opt-in popup (Sep 23 2026): the popup HTML is server-rendered
// on athlete home when unanswered. Handlers live here (not inline) because
// the Content-Security-Policy blocks inline scripts.
(function () {
  var overlay = document.getElementById('bible-popup-overlay');
  if (!overlay) return;
  var yes = document.getElementById('bible-yes');
  var no = document.getElementById('bible-no');
  if (!yes || !no) return;
  function choose(v) {
    yes.disabled = true;
    no.disabled = true;
    fetch('/api/bible-study-choice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ choice: v })
    }).then(function (r) {
      if (!r.ok) throw 0;
      overlay.remove();
    }).catch(function () {
      yes.disabled = false;
      no.disabled = false;
    });
  }
  yes.addEventListener('click', function () { choose(1); });
  no.addEventListener('click', function () { choose(0); });
})();

// Lock In cards — tap to expand/collapse (Sep 23 2026)
(function () {
  document.addEventListener('click', function (ev) {
    const btn = ev.target.closest('[data-toggle]');
    if (!btn) return;
    const id = btn.getAttribute('data-toggle');
    const body = document.getElementById('card-' + id);
    const card = btn.closest('.lockin-card');
    if (!body || !card) return;
    const isHidden = body.hidden;
    body.hidden = !isHidden;
    card.classList.toggle('open', isHidden);
  });
})();

// Game Day / Practice Day toggle (Sep 23 2026)
(function () {
  document.addEventListener('click', function (ev) {
    const btn = ev.target.closest('[data-gp]');
    if (!btn) return;
    const which = btn.getAttribute('data-gp');
    document.querySelectorAll('[data-gp]').forEach(b => b.classList.toggle('active', b === btn));
    const game = document.getElementById('gp-game');
    const practice = document.getElementById('gp-practice');
    if (game) game.hidden = which !== 'game';
    if (practice) practice.hidden = which !== 'practice';
  });
})();

// Activity checklist — show/hide drill field on check (Sep 23 2026)
(function () {
  document.addEventListener('change', function (ev) {
    const cb = ev.target.closest('[data-section]');
    if (!cb) return;
    const item = cb.closest('.activity-item');
    if (!item) return;
    const input = item.querySelector('.activity-drills');
    if (!input) return;
    input.hidden = !cb.checked;
    if (!cb.checked) input.value = '';
  });
})();

// Routine inline edit (Sep 23 2026)
(function () {
  document.addEventListener('click', function (ev) {
    const btn = ev.target.closest('.routine-edit');
    if (!btn) return;
    const li = btn.closest('[data-routine-li]');
    if (!li || li.querySelector('.routine-edit-form')) return;
    const textSpan = li.querySelector('[data-routine-text]');
    const current = textSpan ? textSpan.textContent : '';
    const which = btn.getAttribute('data-which');
    const idx = btn.getAttribute('data-idx');
    const form = document.createElement('form');
    form.method = 'post';
    form.action = '/mental-game/routine/edit';
    form.className = 'routine-edit-form';
    form.innerHTML = `<input type="hidden" name="which" value="${which}"><input type="hidden" name="idx" value="${idx}"><input type="text" name="text" value="" maxlength="200" style="flex:1"><button type="submit" class="btn btn-sm">Save</button>`;
    form.querySelector('input[name="text"]').value = current;
    const label = li.querySelector('label');
    if (label) label.style.display = 'none';
    btn.style.display = 'none';
    li.insertBefore(form, li.firstChild);
    form.querySelector('input[name="text"]').focus();
  });
})();

// Check-in step 2: big mic + talking points + sort it out (Sep 23 2026)
(function () {
  const mic = document.getElementById('big-mic');
  if (!mic) return;
  const status = document.getElementById('talk-status');
  const ta = document.getElementById('talk-text');
  const sortBtn = document.getElementById('sort-it-out');
  const fields = document.getElementById('talk-fields');
  const setStatus = (t) => { if (status) { status.style.display = t ? 'block' : 'none'; status.textContent = t; } };
  const micOk = window.SkipMic && (window.SpeechRecognition || window.webkitSpeechRecognition || navigator.mediaDevices);
  if (!micOk) { mic.style.display = 'none'; }

  // Talking points: tap to append a starter to the text.
  document.querySelectorAll('.talk-point').forEach((chip) => {
    chip.addEventListener('click', () => {
      const starter = chip.getAttribute('data-point') || '';
      ta.value = ta.value ? ta.value.replace(/\s+$/, '') + ' ' + starter : starter;
      ta.focus();
    });
  });

  // Big mic: keyboard-mic style — words fill the box live as they speak.
  let stopFn = null;
  mic.addEventListener('click', () => {
    if (stopFn) { try { stopFn(); } catch (e) {} stopFn = null; return; }
    mic.classList.add('listening');
    setStatus('Listening… tap again to stop');
    window.SkipMic.record((transcript) => {
      mic.classList.remove('listening');
      stopFn = null;
      // Web Speech path already painted live; fallback path appends here.
      if (transcript && !ta.value.trim().endsWith(transcript.trim().slice(-20))) {
        ta.value = ta.value ? ta.value.replace(/\s+$/, '') + ' ' + transcript : transcript;
      }
      setStatus(transcript || ta.value.trim() ? 'Got it — keep talking or hit submit.' : 'Didn\u2019t catch that — try again.');
    }, setStatus, { target: ta }).then((fn) => { stopFn = fn; })
      .catch(() => { mic.classList.remove('listening'); setStatus('Microphone blocked — allow mic access in Settings.'); });
  });

  // Sort it out: parse the text into the 6 reflection fields.
  if (sortBtn) {
    sortBtn.addEventListener('click', () => {
    const text = ta.value.trim();
    if (!text) { setStatus('Talk or type something first.'); return; }
    setStatus('Skip is sorting that out…');
    fetch('/api/checkin/parse', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transcript: text }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok || !d.fields) { setStatus('Couldn\u2019t sort that — just fill the fields in.'); fields.hidden = false; return; }
        const f = d.fields;
        const set = (name, val) => {
          const el = document.querySelector(`[name="${name}"]`);
          if (el && val) el.value = val;
        };
        set('main_focus', f.main_focus);
        set('felt_good', f.felt_good);
        set('biggest_struggle', f.biggest_struggle);
        set('adjustment_helped', f.adjustment_helped);
        set('learned', f.learned);
        set('whats_next', f.whats_next);
        fields.hidden = false;
        setStatus('Done — check it over and hit submit.');
        fields.scrollIntoView({ behavior: 'smooth', block: 'start' });
      })
      .catch(() => { setStatus('Something went wrong — just fill the fields in.'); fields.hidden = false; });
    });
  }
})();

// Lock In routine player (Sep 23 2026): immersive full-screen, one step at
// a time. App, not a checklist.
(function () {
  const player = document.getElementById('routine-player');
  if (!player) return;
  const stage = document.getElementById('rp-stage');
  const fill = document.getElementById('rp-fill');
  const count = document.getElementById('rp-count');
  const nextBtn = document.getElementById('rp-next');
  const backBtn = document.getElementById('rp-back');
  const closeBtn = document.getElementById('rp-close');
  let steps = [], idx = 0, which = '';

  function render() {
    const s = steps[idx];
    const total = steps.length;
    fill.style.width = ((idx + 1) / (total + 1)) * 100 + '%';
    count.textContent = (idx + 1) + ' / ' + total;
    backBtn.style.visibility = idx === 0 ? 'hidden' : 'visible';
    nextBtn.textContent = idx === total - 1 ? 'Finish' : 'Next';
    let html = '';
    if (s.kind === 'intro') {
      html = `<div class="rp-kind">Why this matters</div>
        <h2 class="rp-title">${escHtml(s.title)}</h2>
        <p class="rp-detail">${escHtml(s.detail)}</p>`;
    } else if (s.kind === 'bible') {
      html = `<div class="rp-kind">Daily verse</div>
        <p class="rp-verse">\u201c${escHtml(s.verse)}\u201d</p>
        <div class="rp-ref">${escHtml(s.ref)}${s.theme ? ' · ' + escHtml(s.theme) : ''}</div>
        ${s.explanation ? `<p class="rp-detail">${escHtml(s.explanation)}</p>` : ''}
        ${s.baseball ? `<p class="rp-detail"><strong>Baseball:</strong> ${escHtml(s.baseball)}</p>` : ''}
        ${s.life ? `<p class="rp-detail"><strong>Life:</strong> ${escHtml(s.life)}</p>` : ''}`;
    } else if (s.kind === 'breath') {
      html = `<div class="rp-kind">Breathe</div>
        <div class="rp-breath"></div>
        <h2 class="rp-title">${escHtml(s.title)}</h2>
        ${s.detail ? `<p class="rp-detail">${escHtml(s.detail)}</p>` : ''}`;
    } else {
      html = `<div class="rp-kind">${escHtml(whichLabel())}</div>
        <h2 class="rp-title">${escHtml(s.title)}</h2>
        ${s.detail ? `<p class="rp-detail">${escHtml(s.detail)}</p>` : ''}`;
    }
    stage.innerHTML = html;
  }
  function whichLabel() {
    return which === 'morning' ? 'Morning routine' : which === 'pregame' ? 'Game day' : which === 'practice' ? 'Practice day' : 'Exercise';
  }
  function escHtml(t) {
    return String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function open(data) {
    which = data.which;
    steps = data.steps || [];
    if (!steps.length) return;
    // Intro screen explains the routine before the steps (Bobby, Sep 23 2026).
    steps = [{ title: introFor(which).title, detail: introFor(which).detail, kind: 'intro' }, ...steps];
    idx = 0;
    player.hidden = false;
    document.body.style.overflow = 'hidden';
    render();
  }
  function introFor(w) {
    if (w === 'morning') return {
      title: 'Morning Routine',
      detail: 'Your mind sets the day before your body does. Three quiet minutes every morning — breathe, lock your word, see it before it happens. Do this daily and you stop hoping you show up locked in. You decide it.',
    };
    if (w === 'pregame') return {
      title: 'Game Day',
      detail: 'Games are won by the mind that has already been there. This is your pregame lock-in — slow it down, trust your eyes, and walk to the plate already knowing who you are.',
    };
    if (w === 'practice') return {
      title: 'Practice Day',
      detail: 'Practice is where games are built. Lock in before you pick up a bat — one focus, full intent. No wasted reps. Every swing has a job.',
    };
    return {
      title: 'Daily Exercise',
      detail: 'One concept a day from the best minds in the mental game. Read it, feel it, carry it into today. Small daily edges stack into a different player.',
    };
  }
  function close() {
    player.hidden = true;
    document.body.style.overflow = '';
  }
  function finish() {
    // Final screen
    fill.style.width = '100%';
    count.textContent = '';
    stage.innerHTML = `<div class="rp-done-icon">🔒</div>
      <h2 class="rp-title">You're locked in.</h2>
      <p class="rp-detail">Go attack today.</p>`;
    nextBtn.textContent = 'Done';
    backBtn.style.visibility = 'hidden';
    nextBtn.onclick = () => {
      // Mark the routine done server-side, then close.
      fetch('/mental-game/routine/done', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'which=' + encodeURIComponent(which === 'morning' ? 'morning' : which),
      }).then(() => location.reload()).catch(() => location.reload());
    };
  }
  nextBtn.onclick = () => {
    if (idx < steps.length - 1) { idx++; render(); }
    else finish();
  };
  backBtn.onclick = () => { if (idx > 0) { idx--; render(); } };
  closeBtn.onclick = close;

  document.querySelectorAll('[data-routine]').forEach((el) => {
    el.addEventListener('click', () => {
      try { open(JSON.parse(el.getAttribute('data-steps'))); }
      catch (e) {}
    });
  });
})();

// Check-in feel slider value display (Sep 23 2026)
document.querySelectorAll('.feel-slider input[type="range"]').forEach((el) => {
  const out = document.getElementById(el.id + '-val');
  if (!out) return;
  el.addEventListener('input', () => { out.textContent = el.value; });
});

// Skip's read — Notebook top (Sep 23 2026)
(function () {
  const box = document.getElementById('skips-read');
  if (!box) return;
  const body = document.getElementById('skips-read-body');
  fetch('/api/notebook/read')
    .then((r) => r.json())
    .then((d) => {
      if (!d.ok || d.empty) return;
      // Bobby, Sep 23 2026: Skip's read starts after 3 sessions. Before that,
      // tell the kid to keep going — confidence and momentum.
      if (d.notEnough) {
        const n = d.count || 0;
        body.innerHTML = `<div class="skips-read-section"><h3>Skip's getting to know your game</h3><ul><li>Skip starts reading your game after 3 check-ins — you're at ${n}. Keep logging, keep going.</li></ul></div>`;
        box.hidden = false;
        return;
      }
      if (!d.read) return;
      const sections = (d.read.sections || []).filter((s) => s && s.title && s.items && s.items.length);
      if (!sections.length) return;
      body.innerHTML = sections.map((s) =>
        `<div class="skips-read-section"><h3>${String(s.title).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</h3><ul>${s.items.map((t) =>
          `<li>${String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</li>`).join('')}</ul></div>`
      ).join('');
      box.hidden = false;
    })
    .catch(() => {});
})();

// Seamless + top tier (Bobby, Sep 23 2026):
// 1. Autosave check-in drafts — never lose their words.
// 2. Submit loading state — Skip's parsing takes ~10s, show it.
// 3. Tap haptics + press states — feels like a real app.
(function () {
  // Haptics: tiny buzz on taps (Android; iOS Safari ignores harmlessly).
  document.addEventListener('touchstart', (ev) => {
    const t = ev.target.closest && ev.target.closest('button, .pill, a.btn');
    if (t && navigator.vibrate) { try { navigator.vibrate(8); } catch (e) {} }
  }, { passive: true });

  // Check-in draft autosave.
  const form = document.querySelector('form[data-validate="hitting12"], form[action="/checkin"]');
  if (!form) return;
  const KEY = 'dd-checkin-draft';
  const ta = form.querySelector('#talk-text');
  // Restore (only if the server didn't render a value already).
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (ta && !ta.value && d.talk) ta.value = d.talk;
      const slider = form.querySelector('input[type="range"][name="swing_feel"]');
      if (slider && d.feel && !slider.dataset.touched) {
        slider.value = d.feel;
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        if (slider.hasAttribute('oninput')) slider.oninput && slider.oninput();
        const out = document.getElementById('slider-swing_feel-val');
        if (out) out.textContent = d.feel;
      }
      for (const [name, val] of Object.entries(d.pills || {})) {
        const el = form.querySelector(`input[name="${name}"][value="${val}"]`);
        if (el && !form.querySelector(`input[name="${name}"]:checked`)) el.checked = true;
      }
    }
  } catch (e) {}
  // Save on every change.
  const save = () => {
    try {
      const d = { talk: ta ? ta.value : '', pills: {} };
      const slider = form.querySelector('input[type="range"][name="swing_feel"]');
      if (slider) d.feel = slider.value;
      form.querySelectorAll('.pills input[type="radio"]:checked').forEach((r) => { d.pills[r.name] = r.value; });
      localStorage.setItem(KEY, JSON.stringify(d));
    } catch (e) {}
  };
  form.addEventListener('input', save);
  form.addEventListener('change', save);

  // Submit: loading state, clear draft.
  form.addEventListener('submit', () => {
    try { localStorage.removeItem(KEY); } catch (e) {}
    const btn = form.querySelector('button[type="submit"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    let ov = document.getElementById('submit-loading');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'submit-loading';
      ov.innerHTML = '<div class="submit-loading-card"><div class="spinner"></div><p>Skip&rsquo;s sorting it out…</p></div>';
      document.body.appendChild(ov);
    }
    ov.hidden = false;
  });
})();

// First-run onboarding (Bobby, Sep 23 2026): swipe screens, once ever.
// v2 (Sep 23): everyone sees it again; ends by sending them to the new
// mental-game questionnaire.
(function () {
  const KEY = 'dd-onboarded-v2';
  const ov = document.getElementById('onboard');
  if (!ov) return;
  try { if (localStorage.getItem(KEY)) return; } catch (e) { return; }
  const slides = Array.from(ov.querySelectorAll('.onboard-slide'));
  const dots = Array.from(ov.querySelectorAll('.onboard-dot'));
  const nextBtn = document.getElementById('onboard-next');
  const skipBtn = document.getElementById('onboard-skip');
  let i = 0;
  const last = slides.length - 1;
  const cta = () => {
    const el = slides[i];
    return el ? { text: el.dataset.cta || null, href: el.dataset.href || null } : {};
  };
  const show = (n) => {
    i = n;
    slides.forEach((s, k) => { s.hidden = k !== i; });
    dots.forEach((d, k) => d.classList.toggle('active', k === i));
    const c = cta();
    nextBtn.textContent = c.text || (i === last ? "Let's go" : 'Next');
  };
  const done = (go) => {
    try { localStorage.setItem(KEY, '1'); } catch (e) {}
    ov.hidden = true;
    document.body.style.overflow = '';
    if (go) location.href = go;
  };
  nextBtn.addEventListener('click', () => {
    if (i < last) return show(i + 1);
    const c = cta();
    done(c.href || null);
  });
  skipBtn.addEventListener('click', done);
  // Swipe support.
  let sx = null;
  ov.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
  ov.addEventListener('touchend', (e) => {
    if (sx == null) return;
    const dx = e.changedTouches[0].clientX - sx;
    sx = null;
    if (dx < -50 && i < slides.length - 1) show(i + 1);
    else if (dx > 50 && i > 0) show(i - 1);
  }, { passive: true });
  ov.hidden = false;
  document.body.style.overflow = 'hidden';
  const unhide = () => { document.body.style.overflow = ''; };
  nextBtn.addEventListener('click', unhide, { once: true });
  skipBtn.addEventListener('click', unhide, { once: true });
})();

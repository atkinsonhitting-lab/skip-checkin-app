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

  // ---- Check-in drill field: pure helpers (unit-tested via source extraction) ----
  // Merge comma-separated drill names: additions go on the end, no dupes
  // (case-insensitive), no stray commas.
  function mergeDrillNames(current, additions) {
    const parts = String(current || '').split(',').map((s) => s.trim()).filter(Boolean);
    const seen = new Set(parts.map((p) => p.toLowerCase()));
    for (const a of additions || []) {
      const name = String(a || '').trim();
      if (name && !seen.has(name.toLowerCase())) { seen.add(name.toLowerCase()); parts.push(name); }
    }
    return parts.join(', ');
  }
  // Toggle one drill name in the comma-separated field.
  function toggleDrillName(current, name) {
    const parts = String(current || '').split(',').map((s) => s.trim()).filter(Boolean);
    const key = String(name || '').toLowerCase();
    const idx = parts.findIndex((p) => p.toLowerCase() === key);
    if (idx >= 0) parts.splice(idx, 1);
    else if (key) parts.push(String(name).trim());
    return parts.join(', ');
  }
  function syncDrillChips() {
    const input = document.getElementById('drills-input');
    const chips = Array.from(document.querySelectorAll('.drill-chip'));
    if (!input || !chips.length) return;
    const present = new Set(input.value.split(',').map((s) => s.trim().toLowerCase()));
    chips.forEach((chip) => {
      chip.classList.toggle('active', present.has(String(chip.dataset.drill || '').toLowerCase()));
    });
  }

  // ---- Check-in: add the hitter's daily routine into the drills field ----
  // Merges with whatever is already there (Bobby: "use their routine and add
  // to it") — never wipes chips the player already tapped.
  (function useRoutine() {
    const btn = document.getElementById('use-routine');
    if (!btn) return;
    btn.addEventListener('click', () => {
      let drills = [];
      try { drills = JSON.parse(btn.dataset.routine || '[]'); } catch (e) { drills = []; }
      const input = document.getElementById('drills-input');
      if (!input || !drills.length) return;
      input.value = mergeDrillNames(
        input.value,
        drills.map((d) => (d.station ? `${d.name} (${d.station})` : d.name))
      );
      syncDrillChips();
      input.focus();
    });
  })();

  // ---- Check-in: quick-tap drill chips toggle entries in the drills input ----
  (function drillChips() {
    const chips = Array.from(document.querySelectorAll('.drill-chip'));
    if (!chips.length) return;
    const input = document.getElementById('drills-input');
    chips.forEach((chip) => {
      chip.addEventListener('click', () => {
        if (!input) return;
        input.value = toggleDrillName(input.value, chip.dataset.drill);
        syncDrillChips();
        input.focus();
      });
    });
    // Mark chips already present when the form loads (e.g. editing a draft).
    syncDrillChips();
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
    var addBtn = document.getElementById('prog-add-cat');
    var next = parseInt(wrap.getAttribute('data-next') || '0', 10);
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        var div = document.createElement('div');
        div.className = 'card routine-group prog-cat';
        div.setAttribute('data-cat', '');
        div.innerHTML =
          '<label class="fld">Category<input type="text" name="cat_' + next + '_name" maxlength="60"></label>' +
          '<label class="fld">Drills — one per line, as <em>Drill</em> or <em>Drill | volume</em>' +
          '<textarea name="cat_' + next + '_items" rows="4"></textarea></label>' +
          '<button type="button" class="btn btn-danger btn-sm" data-remove-cat>Remove category</button>';
        wrap.appendChild(div);
        next++;
      });
    }
    wrap.addEventListener('click', function (e) {
      if (e.target && e.target.hasAttribute('data-remove-cat')) {
        var card = e.target.closest('[data-cat]');
        if (card) card.remove();
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

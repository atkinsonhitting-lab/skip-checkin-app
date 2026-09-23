/* Guided Today session (Sep 23 2026).
 * Today -> pick your component order -> tap through every exercise -> done.
 * Mobility / Med Ball / Hitting / Lifting in the athlete's chosen order,
 * one item at a time, no page reloads. Checkoffs log through the same
 * /api/program/log endpoint as the Programs tab, so progress syncs both
 * ways and a refresh resumes exactly where the athlete left off.
 * Wake Lock keeps the screen on for the whole session. */
(function () {
  'use strict';
  var S = (window.SESSION && window.SESSION.components) ? window.SESSION : null;
  if (!S) return;

  var orderEl = document.getElementById('sess-order');
  var flowEl = document.getElementById('sess-flow');
  var orderListEl = document.getElementById('sess-orderlist');
  var order = S.order.slice();

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function buzz(ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms || 10); } catch (e) {}
  }

  /* ---------- component order screen ---------- */
  function renderOrder() {
    var html = '';
    order.forEach(function (id, i) {
      var c = S.components[id];
      if (!c) return;
      var n = c.items.length;
      html += '<div class="sess-orderrow" data-i="' + i + '">' +
        '<span class="sess-grip" aria-hidden="true">⋮⋮</span>' +
        '<span class="sess-icon" aria-hidden="true">' + esc(c.icon || '') + '</span>' +
        '<div class="sess-ordermeta"><strong>' + esc(c.label) + '</strong>' +
        '<span class="hint-inline">' + n + ' ' + (n === 1 ? 'exercise' : 'exercises') +
        (c.tag ? ' · ' + esc(c.tag) : '') + '</span></div>' +
        '<div class="sess-arrows">' +
        '<button type="button" class="sess-arrow" data-move="-1" aria-label="Move up"' +
          (i === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button type="button" class="sess-arrow" data-move="1" aria-label="Move down"' +
          (i === order.length - 1 ? ' disabled' : '') + '>↓</button>' +
        '</div></div>';
    });
    orderListEl.innerHTML = html;
  }

  if (orderListEl) {
    orderListEl.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.sess-arrow') : null;
      if (!btn || btn.disabled) return;
      var row = e.target.closest('.sess-orderrow');
      var i = Number(row.getAttribute('data-i'));
      var j = i + Number(btn.getAttribute('data-move'));
      if (j < 0 || j >= order.length) return;
      var t = order[i]; order[i] = order[j]; order[j] = t;
      renderOrder();
      buzz();
    });
  }

  function saveOrder(cb) {
    fetch('/program/component-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ order: order }),
      credentials: 'same-origin',
    }).then(function () { cb(); }).catch(function () { cb(); });
  }

  /* ---------- wake lock (screen stays on) ---------- */
  var wakeLock = null;
  var sessionLive = false;
  function keepAwake() {
    try {
      if (!('wakeLock' in navigator)) return;
      navigator.wakeLock.request('screen').then(function (lock) {
        wakeLock = lock;
        lock.addEventListener('release', function () { wakeLock = null; });
      }).catch(function () {});
    } catch (e) {}
  }
  function releaseWake() {
    try { if (wakeLock) wakeLock.release(); } catch (e) {}
    wakeLock = null;
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && sessionLive && !wakeLock) keepAwake();
  });

  /* ---------- guided flow ---------- */
  var items = [];
  order.forEach(function (id) {
    var c = S.components[id];
    if (!c) return;
    c.items.forEach(function (it) {
      it.comp = id;
      it.compLabel = c.label;
      it.compIcon = c.icon || '';
      items.push(it);
    });
  });

  var body = document.getElementById('wo-body');
  var seqEl = document.getElementById('wo-seq');
  var fillEl = document.getElementById('wo-fill');
  var countEl = document.getElementById('wo-count');
  var prevBtn = document.getElementById('wo-prev');
  var nextBtn = document.getElementById('wo-next');
  var restEl = document.getElementById('wo-rest');
  var restTimeEl = document.getElementById('wo-rest-time');
  var restNextEl = document.getElementById('wo-rest-next');
  var finishEl = document.getElementById('wo-finish');
  var finishStatsEl = document.getElementById('wo-finish-stats');

  var idx = 0;
  var restTimer = null;
  var restLeft = 0;

  function itemDone(it) {
    if (it.type === 'lift') return !!it.allDone;
    return !!it.done;
  }

  function syncProgress() {
    var done = items.filter(itemDone).length;
    fillEl.style.width = Math.round((done / items.length) * 100) + '%';
    countEl.textContent = done + ' of ' + items.length;
    renderSeq();
  }

  function renderSeq() {
    var html = '';
    order.forEach(function (id) {
      var c = S.components[id];
      if (!c) return;
      var list = items.filter(function (it) { return it.comp === id; });
      if (!list.length) return;
      var d = list.filter(itemDone).length;
      html += '<span class="wo-seqchip' + (d === list.length ? ' done' : '') + '">' +
        esc(c.icon || '') + ' ' + esc(c.label) + ' ' + d + '/' + list.length + '</span>';
    });
    seqEl.innerHTML = html;
  }

  function videoHtml(it) {
    var v = it.video;
    if (!v) return '';
    if (v.type === 'yt') {
      return '<div class="wo-video" data-yt="' + esc(v.id) + '">' +
        '<img src="https://i.ytimg.com/vi/' + esc(v.id) + '/hqdefault.jpg" alt="Demo video" loading="lazy">' +
        '<span class="wo-play">▶</span></div>';
    }
    if (v.type === 'drive') {
      return '<div class="wo-video wo-drive" data-drive="' + esc(v.fileId) + '">' +
        '<span class="wo-play">▶</span><span class="wo-drivetap">Tap to play</span></div>';
    }
    return '<p><a class="watch-link" href="' + esc(v.url) + '" target="_blank" rel="noopener">▶ Watch video</a></p>';
  }

  function wireVideo() {
    body.querySelectorAll('.wo-video').forEach(function (el) {
      el.addEventListener('click', function () {
        var yt = el.getAttribute('data-yt');
        if (yt) {
          el.innerHTML = '<iframe src="https://www.youtube.com/embed/' + yt +
            '?autoplay=1&rel=0" allow="autoplay; encrypted-media" allowfullscreen ' +
            'style="width:100%;aspect-ratio:16/9;border:0;border-radius:10px"></iframe>';
          return;
        }
        var dr = el.getAttribute('data-drive');
        if (dr) {
          el.innerHTML = '<iframe src="https://drive.google.com/file/d/' + dr + '/preview" ' +
            'allow="autoplay; fullscreen" allowfullscreen ' +
            'style="width:100%;aspect-ratio:16/9;border:0;border-radius:10px"></iframe>';
        }
      });
    });
  }

  function log(payload) {
    return fetch('/api/program/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'same-origin',
    }).then(function (r) { return r.json(); });
  }

  /* ---------- item renderers ---------- */
  function render() {
    var it = items[idx];
    prevBtn.disabled = idx === 0;
    nextBtn.disabled = idx === items.length - 1;
    if (it.type === 'lift') body.innerHTML = liftHtml(it);
    else body.innerHTML = blockHtml(it);
    wireVideo();
    if (it.type === 'lift') wireLift(it);
    else wireBlock(it);
    syncProgress();
    window.scrollTo(0, 0);
  }

  function kicker(it) {
    var parts = [];
    if (it.compIcon) parts.push(it.compIcon);
    var sec = it.section || it.compLabel || '';
    if (it.type === 'lift' && (sec === 'strength' || sec === 'rotational' || sec === 'brakes')) {
      sec = sec.charAt(0).toUpperCase() + sec.slice(1);
    }
    parts.push(sec);
    var n = 0, total = 0;
    items.forEach(function (x) { if (x.comp === it.comp) { total++; if (itemDone(x)) n++; } });
    return esc(parts.join(' ')) + ' <span class="hint-inline">' + n + '/' + total + '</span>';
  }

  function intentBadge(it) {
    return it.intent === 'max' ? ' <span class="intent-badge">⚡ MAX INTENT</span>' : '';
  }

  function blockHtml(it) {
    var meta = it.meta || '';
    var swap = it.swappedFrom
      ? '<p class="hint-inline" style="margin:0 0 8px">⇄ swapped from ' + esc(it.swappedFrom) + '</p>' : '';
    return '<div class="wo-card' + (it.done ? ' done' : '') + '">' +
      '<div class="wo-kicker">' + kicker(it) + '</div>' +
      (it.block ? '<p class="hint-inline" style="margin:0 0 4px">' + esc(it.block) + '</p>' : '') +
      '<h2 class="wo-name">' + esc(it.name) + intentBadge(it) + '</h2>' +
      (meta ? '<p class="wo-meta">' + esc(meta) + '</p>' : '') +
      (it.notes ? '<p class="wo-notes">' + esc(it.notes) + '</p>' : '') +
      swap + videoHtml(it) +
      '<button type="button" class="wo-bigbtn' + (it.done ? ' done' : '') + '" id="wo-block-done">' +
        (it.done ? '✓ Done — tap to undo' : 'Mark done') + '</button>' +
      '</div>';
  }

  function liftHtml(it) {
    var rx = [it.sets && it.reps ? it.sets + ' × ' + it.reps : '',
              it.target_rpe ? 'RPE ' + it.target_rpe : '']
      .filter(Boolean).join(' · ');
    var lastLine = '';
    if (it.lastSets && it.lastSets.length) {
      var parts = it.lastSets
        .filter(function (s) { return s.w != null || s.r != null; })
        .map(function (s) { return (s.w != null ? s.w : '–') + '×' + (s.r != null ? s.r : '–'); });
      if (parts.length) {
        lastLine = '<div class="wo-last">Last time' +
          (it.lastDay ? ' (' + esc(it.lastDay) + ')' : '') + ': <strong>' +
          esc(parts.join(' · ')) + '</strong></div>';
      }
    }
    var rows = it.dispSets.map(function (s, k) {
      var cur = !s.done && it.dispSets.slice(0, k).every(function (x) { return x.done; });
      return '<div class="wo-setrow' + (s.done ? ' done' : '') + (cur ? ' current' : '') + '" data-k="' + k + '">' +
        '<div class="wo-setnum">' + (k + 1) + '</div>' +
        '<label>lbs<input type="number" inputmode="decimal" min="0" step="2.5" class="wo-w" value="' +
          (s.w != null ? esc(s.w) : '') + '" placeholder="—" ' + (s.done ? 'disabled' : '') + '></label>' +
        '<label>reps<input type="number" inputmode="numeric" min="0" class="wo-r" value="' +
          (s.r != null ? esc(s.r) : '') + '" placeholder="—" ' + (s.done ? 'disabled' : '') + '></label>' +
        '<button type="button" class="wo-logbtn" data-act="' + (s.done ? 'unset' : 'set') + '">' +
          (s.done ? '✓' : 'Log') + '</button>' +
        '</div>';
    }).join('');
    var rpeBtns = '';
    for (var r = 1; r <= 10; r++) {
      rpeBtns += '<button type="button" class="wo-rpebtn' + (String(it.rpe) === String(r) ? ' sel' : '') +
        '" data-rpe="' + r + '">' + r + '</button>';
    }
    var lifts = items.filter(function (x) { return x.type === 'lift'; });
    var li = lifts.indexOf(it);
    return '<div class="wo-card">' +
      '<div class="wo-kicker">' + kicker(it) + ' · Lift ' + (li + 1) + ' of ' + lifts.length + '</div>' +
      '<h2 class="wo-name">' + esc(it.name) + intentBadge(it) + '</h2>' +
      (rx ? '<p class="wo-meta">' + esc(rx) + '</p>' : '') +
      (it.notes ? '<p class="wo-notes">' + esc(it.notes) + '</p>' : '') +
      lastLine + videoHtml(it) +
      '<div class="wo-sets">' + rows + '</div>' +
      '<button type="button" class="wo-addset" id="wo-addset">+ Add set</button>' +
      '<div class="wo-rpewrap" id="wo-rpewrap">' +
        '<div class="wo-rpelabel">How hard was this? <strong>RPE</strong> <span class="hint-inline">(1 easy → 10 max)</span></div>' +
        '<div class="wo-rpegrid">' + rpeBtns + '</div>' +
      '</div></div>';
  }

  /* ---------- block items ---------- */
  function wireBlock(it) {
    var btn = document.getElementById('wo-block-done');
    btn.addEventListener('click', function () {
      buzz();
      btn.disabled = true;
      log({ kind: it.kind, item_key: it.key })
        .then(function (r) {
          it.done = !!r.checked;
          if (it.done) advance();
          else render();
        })
        .catch(function () { btn.disabled = false; });
    });
  }

  /* ---------- lifts ---------- */
  function wireLift(it) {
    body.querySelectorAll('.wo-setrow').forEach(function (row) {
      var k = Number(row.getAttribute('data-k'));
      var btn = row.querySelector('.wo-logbtn');
      btn.addEventListener('click', function () {
        var w = row.querySelector('.wo-w').value;
        var r = row.querySelector('.wo-r').value;
        var act = btn.getAttribute('data-act');
        buzz();
        btn.disabled = true;
        log({
          kind: 'lift', item_key: it.key, lift_op: act, set_idx: k,
          set_weight: w, set_reps: r,
          prog_sets: it.progSetCount, prog_reps: it.progReps,
        }).then(function (res) {
          if (Array.isArray(res.sets)) it.dispSets = res.sets;
          it.allDone = !!res.checked;
          if (act === 'set') {
            var moreSets = it.dispSets.some(function (s) { return !s.done; });
            startRest(it, !moreSets);
          }
          render();
        }).catch(function () { btn.disabled = false; });
      });
    });
    var add = document.getElementById('wo-addset');
    if (add) add.addEventListener('click', function () {
      buzz();
      add.disabled = true;
      log({ kind: 'lift', item_key: it.key, lift_op: 'addset', reps: it.progReps })
        .then(function (res) {
          if (Array.isArray(res.sets)) it.dispSets = res.sets;
          it.allDone = !!res.checked;
          render();
        })
        .catch(function () { add.disabled = false; });
    });
    body.querySelectorAll('.wo-rpebtn').forEach(function (b) {
      b.addEventListener('click', function () {
        var v = b.getAttribute('data-rpe');
        buzz();
        log({ kind: 'lift', item_key: it.key, lift_op: 'rpe', rpe: v })
          .then(function (res) {
            it.rpe = res.rpe != null ? res.rpe : Number(v);
            render();
          });
      });
    });
  }

  /* ---------- rest timer ---------- */
  function fmtRest(sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function startRest(it, exerciseDone) {
    var secs = it.rest || 120;
    var nextIt = items[idx + 1];
    restNextEl.textContent = exerciseDone && nextIt ? 'Next: ' + nextIt.name : '';
    restLeft = secs;
    restTimeEl.textContent = fmtRest(restLeft);
    restEl.hidden = false;
    clearInterval(restTimer);
    restTimer = setInterval(function () {
      restLeft--;
      if (restLeft <= 0) {
        stopRest();
        buzz(40);
        return;
      }
      restTimeEl.textContent = fmtRest(restLeft);
    }, 1000);
  }
  function stopRest() {
    clearInterval(restTimer);
    restEl.hidden = true;
  }
  document.getElementById('wo-rest-skip').addEventListener('click', stopRest);
  document.getElementById('wo-rest-less').addEventListener('click', function () {
    restLeft = Math.max(5, restLeft - 15);
    restTimeEl.textContent = fmtRest(restLeft);
  });
  document.getElementById('wo-rest-more').addEventListener('click', function () {
    restLeft = Math.min(900, restLeft + 15);
    restTimeEl.textContent = fmtRest(restLeft);
  });

  /* ---------- nav / finish ---------- */
  function advance() {
    stopRest();
    if (idx < items.length - 1) {
      idx++;
      render();
    } else {
      showFinish();
    }
  }
  prevBtn.addEventListener('click', function () {
    if (idx > 0) { stopRest(); idx--; render(); }
  });
  nextBtn.addEventListener('click', function () {
    if (idx < items.length - 1) { stopRest(); idx++; render(); }
    else showFinish();
  });

  function showFinish() {
    releaseWake();
    sessionLive = false;
    var done = items.filter(itemDone).length;
    var lines = order.map(function (id) {
      var c = S.components[id];
      if (!c) return null;
      var list = items.filter(function (x) { return x.comp === id; });
      var d = list.filter(itemDone).length;
      return (c.icon || '') + ' ' + c.label + ' — ' + d + '/' + list.length;
    }).filter(Boolean);
    finishStatsEl.innerHTML = 'Done <strong>' + done + ' of ' + items.length + '</strong><br>' +
      lines.map(esc).join('<br>');
    finishEl.hidden = false;
    window.scrollTo(0, 0);
    buzz(30);
  }

  /* ---------- start ---------- */
  function bootFlow() {
    if (!items.length) {
      body.innerHTML = '<div class="card empty">No work programmed for this day.</div>';
      return;
    }
    for (var f = 0; f < items.length; f++) {
      if (!itemDone(items[f])) { idx = f; break; }
      idx = f;
    }
    render();
  }

  function startFlow() {
    // Rebuild item order from the (possibly reordered) components.
    items.length = 0;
    order.forEach(function (id) {
      var c = S.components[id];
      if (!c) return;
      c.items.forEach(function (it) {
        it.comp = id;
        it.compLabel = c.label;
        it.compIcon = c.icon || '';
        items.push(it);
      });
    });
    orderEl.hidden = true;
    finishEl.hidden = true;
    flowEl.hidden = false;
    sessionLive = true;
    keepAwake();
    bootFlow();
  }

  var startBtn = document.getElementById('sess-start');
  if (startBtn) startBtn.addEventListener('click', function () {
    startBtn.disabled = true;
    saveOrder(function () {
      startBtn.disabled = false;
      startFlow();
    });
  });

  var reorderBtn = document.getElementById('sess-reorder');
  function goOrder() {
    sessionLive = false;
    releaseWake();
    flowEl.hidden = true;
    finishEl.hidden = true;
    orderEl.hidden = false;
    renderOrder();
    window.scrollTo(0, 0);
  }
  if (reorderBtn) reorderBtn.addEventListener('click', goOrder);
  var reorderBtn2 = document.getElementById('sess-reorder2');
  if (reorderBtn2) reorderBtn2.addEventListener('click', goOrder);

  document.querySelectorAll('.wo-end[href]').forEach(function (a) {
    a.addEventListener('click', function () { releaseWake(); sessionLive = false; });
  });

  // Already picked an order before: skip straight to the flow, like the app
  // reel — open, tap through, done. "Order" in the top bar changes it.
  renderOrder();
  if (S.skipOrder && items.length) {
    orderEl.hidden = true;
    flowEl.hidden = false;
    sessionLive = true;
    keepAwake();
    bootFlow();
  }
})();

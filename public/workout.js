/* Workout mode (Sep 23 2026): guided lifting session.
 * One movement at a time — Speed → Med Ball → Lifts.
 * Big inputs, one-tap set logging via /api/program/log, rest timer,
 * no page reloads. Server is the source of truth, so a refresh
 * resumes exactly where the athlete left off. */
(function () {
  'use strict';
  var DAY = (window.WO_DAY && window.WO_DAY.day) || null;
  var bodyEl = document.getElementById('wo-body');
  if (!DAY) {
    // Server-rendered fallback is already in #wo-body; add diagnostic.
    var diag = document.createElement('div');
    diag.className = 'card';
    diag.style.marginTop = '12px';
    diag.innerHTML = '<p class="hint">Debug: WO_DAY=' + (window.WO_DAY ? 'set' : 'missing') +
      ', day=' + (window.WO_DAY && window.WO_DAY.day ? 'set' : 'missing') + '</p>';
    if (bodyEl) bodyEl.appendChild(diag);
    return;
  }

  var items = [];
  // Bobby (Sep 23 2026): mobility pairs with the lifting — guided workout
  // opens with mobility, then Speed → Med Ball → Lifts.
  (DAY.mobility || []).forEach(function (s) { s.type = s.type || 'mobility'; items.push(s); });
  (DAY.speed || []).forEach(function (s) { items.push(s); });
  (DAY.medball || []).forEach(function (s) { items.push(s); });
  (DAY.lifts || []).forEach(function (s) { items.push(s); });
  if (!items.length) {
    document.getElementById('wo-body').innerHTML =
      '<div class="card empty">No work programmed for this day.</div>';
    return;
  }

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

  // Pairing (Oct 2026, Bobby): consecutive items sharing a non-empty
  // `pair` id render together on one screen, visually grouped.
  var screens = [];
  (function () {
    var cur = null, curPair = null;
    items.forEach(function (it) {
      var p = it.pair || '';
      if (p && p === curPair && cur) { cur.push(it); }
      else { cur = [it]; screens.push(cur); curPair = p || null; if (!p) curPair = '__single__' + screens.length; }
    });
  })();
  var idx = 0;
  var restTimer = null;
  var restLeft = 0;

  function buzz(ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms || 10); } catch (e) {}
  }

  function itemDone(it) {
    if (it.type === 'lift') return !!it.allDone;
    return !!it.done;
  }

  function syncProgress() {
    var done = items.filter(itemDone).length;
    fillEl.style.width = Math.round((done / items.length) * 100) + '%';
    countEl.textContent = done + ' of ' + items.length;
    // First incomplete item — resume there on load.
    renderSeq();
  }

  function renderSeq() {
    var html = '';
    var sections = [
      { key: 'mobility', label: 'Mobility' },
      { key: 'speed', label: 'Speed' },
      { key: 'medball', label: 'Med Ball' },
      { key: 'lift', label: 'Lifts' },
    ];
    sections.forEach(function (sec) {
      var list = items.filter(function (it) { return it.type === sec.key; });
      if (!list.length) return;
      var d = list.filter(itemDone).length;
      html += '<span class="wo-seqchip' + (d === list.length ? ' done' : '') + '">' +
        sec.label + ' ' + d + '/' + list.length + '</span>';
    });
    seqEl.innerHTML = html;
  }

  function ytId(url) {
    if (!url) return '';
    var m = String(url).match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
    return m ? m[1] : '';
  }

  function videoHtml(it) {
    // Bobby (Oct 19 2026): optional per-exercise video_url (direct link) —
    // renders as an HTML5 player above the YouTube demo video if present.
    var out = '';
    var vurl = String((it && it.video_url) || '').trim();
    if (vurl) {
      out += '<div class="wo-video-url"><video src="' + esc(vurl) + '" controls playsinline preload="metadata" style="width:100%;border-radius:10px"></video></div>';
    }
    var id = ytId(it.video);
    if (id) {
      out += '<div class="wo-video" data-yt="' + id + '">' +
        '<img src="https://i.ytimg.com/vi/' + id + '/hqdefault.jpg" alt="Demo video" loading="lazy">' +
        '<span class="wo-play">\u25b6</span></div>';
    }
    return out;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtRest(sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* ---------- API ---------- */
  var PREVIEW = !!window.WO_PREVIEW;
  function log(payload) {
    if (PREVIEW) return Promise.resolve({ ok: true, preview: true });
    return fetch(window.WO_LOG_URL || '/api/program/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'same-origin',
    }).then(function (r) { return r.json(); });
  }

  /* ---------- render current item ---------- */
  function itemHtml(it) {
    if (it.type === 'lift') return liftHtml(it);
    if (it.type === 'mobility') return mobilityHtml(it);
    return blockHtml(it);
  }
  function wireItem(it) {
    if (it.type === 'lift') wireLift(it);
    else if (it.type === 'mobility') wireMobility(it);
    else wireBlock(it);
  }
  function render() {
    var screen = screens[idx] || [];
    prevBtn.disabled = idx === 0;
    nextBtn.disabled = idx === screens.length - 1;
    if (screen.length > 1) {
      body.innerHTML = '<div class="wo-pair-group"><div class="wo-pair-badge">\u2194 Paired — alternate these</div>' +
        screen.map(itemHtml).join('') + '</div>';
    } else if (screen.length === 1) {
      body.innerHTML = itemHtml(screen[0]);
    } else {
      body.innerHTML = '<div class="card empty">No work programmed for this day.</div>';
    }
    wireVideo();
    screen.forEach(wireItem);
    syncProgress();
    window.scrollTo(0, 0);
  }

  function intentBadge(it) {
    if (it.intent === 'max') return ' <span class="intent-badge">⚡ MAX INTENT</span>';
    if (it.intent === 'ecc') return ' <span class="intent-badge intent-ecc">🐌 ECCENTRIC</span>';
    return '';
  }

  function secLabel(it) {
    var s = it.section;
    return s === 'strength' || s === 'rotational' || s === 'brakes'
      ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  }

  function mobilityHtml(it) {
    return '<div class="wo-card' + (it.done ? ' done' : '') + '">' +
      '<div class="wo-kicker">Mobility</div>' +
      '<h2 class="wo-name">' + esc(it.name) + '</h2>' +
      (it.volume ? '<p class="wo-meta">' + esc(it.volume) + '</p>' : '') +
      videoHtml(it) +
      '<button type="button" class="wo-logbtn wo-mobbtn" data-act="' + (it.done ? 'unset' : 'set') + '">' +
        (it.done ? '\u2713 Done' : 'Mark done') + '</button>' +
      '</div>';
  }

  function wireMobility(it) {
    var btn = body.querySelector('.wo-mobbtn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      it.done = !it.done;
      btn.textContent = it.done ? '\u2713 Done' : 'Mark done';
      btn.setAttribute('data-act', it.done ? 'unset' : 'set');
      btn.closest('.wo-card').classList.toggle('done', it.done);
      buzz(10);
      syncProgress();
    });
  }

  function blockHtml(it) {
    var kindLabel = it.type === 'speed' ? 'Speed' : it.type === 'mobility' ? 'Mobility' : 'Med Ball';
    var meta = [it.volume, it.notes].filter(Boolean).join(' · ');
    var isMed = it.type === 'medball';
    var rows = (it.dispSets || []).map(function (s, k) {
      var cur = !s.done && (it.dispSets || []).slice(0, k).every(function (x) { return x.done; });
      return '<div class="wo-setrow' + (s.done ? ' done' : '') + (cur ? ' current' : '') + '" data-k="' + k + '">' +
        '<div class="wo-setnum">' + (k + 1) + '</div>' +
        (isMed
          ? '<label>ball lbs<input type="number" inputmode="decimal" min="0" step="1" class="wo-w" value="' +
            (s.w != null ? esc(s.w) : '') + '" placeholder="—" ' + (s.done ? 'disabled' : '') + '></label>'
          : '') +
        '<label>reps<input type="number" inputmode="numeric" min="0" class="wo-r" value="' +
          (s.r != null ? esc(s.r) : '') + '" placeholder="—" ' + (s.done ? 'disabled' : '') + '></label>' +
        '<button type="button" class="wo-logbtn" data-act="' + (s.done ? 'unset' : 'set') + '">' +
          (s.done ? '✓' : 'Log') + '</button>' +
        '</div>';
    }).join('');
    return '<div class="wo-card' + (it.done ? ' done' : '') + '">' +
      '<div class="wo-kicker">' + kindLabel + '</div>' +
      '<h2 class="wo-name">' + esc(it.name) + intentBadge(it) + '</h2>' +
      (meta ? '<p class="wo-meta">' + esc(meta) + '</p>' : '') +
      (it.desc ? '<p class="wo-desc">' + esc(it.desc) + '</p>' : '') +
      videoHtml(it) +
      '<div class="wo-sets">' + rows + '</div>' +
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
      // Bobby (Oct 19 2026): each set shows what they did last time, right
      // next to the set number — the lifter's reference for today's load.
      var ls = it.lastSets && it.lastSets[k];
      var lastChip = (ls && (ls.w != null || ls.r != null))
        ? '<span class="wo-lastset">' + esc((ls.w != null ? ls.w : '–') + '×' + (ls.r != null ? ls.r : '–')) + '</span>' : '';
      return '<div class="wo-setrow' + (s.done ? ' done' : '') + (cur ? ' current' : '') + '" data-k="' + k + '">' +
        '<div class="wo-setnum">' + (k + 1) + lastChip + '</div>' +
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
    return '<div class="wo-card">' +
      '<div class="wo-kicker">' + (secLabel(it) ? secLabel(it) + ' · ' : '') + 'Lift ' + (liftIndex(it) + 1) + ' of ' + items.filter(function (x) { return x.type === 'lift'; }).length + '</div>' +
      '<h2 class="wo-name">' + esc(it.name) + intentBadge(it) + '</h2>' +
      (rx ? '<p class="wo-meta">' + esc(rx) + '</p>' : '') +
      (it.notes ? '<p class="wo-notes">' + esc(it.notes) + '</p>' : '') +
      (it.desc ? '<p class="wo-desc">' + esc(it.desc) + '</p>' : '') +
      lastLine +
      videoHtml(it) +
      '<div class="wo-sets">' + rows + '</div>' +
      '<button type="button" class="wo-addset" id="wo-addset">+ Add set</button>' +
      '<div class="wo-rpewrap" id="wo-rpewrap">' +
        '<div class="wo-rpelabel">How hard was this? <strong>RPE</strong> <span class="hint-inline">(1 easy → 10 max)</span></div>' +
        '<div class="wo-rpegrid">' + rpeBtns + '</div>' +
      '</div>' +
      '</div>';
  }

  function liftIndex(it) {
    var n = 0;
    for (var k = 0; k < items.length; k++) {
      if (items[k].type === 'lift') {
        if (items[k] === it) return n;
        n++;
      }
    }
    return 0;
  }

  function wireVideo() {
    body.querySelectorAll('.wo-video').forEach(function (el) {
      el.addEventListener('click', function () {
        var id = el.getAttribute('data-yt');
        el.innerHTML = '<iframe src="https://www.youtube.com/embed/' + id +
          '?autoplay=1&rel=0" allow="autoplay; encrypted-media" allowfullscreen ' +
          'style="width:100%;aspect-ratio:16/9;border:0;border-radius:10px"></iframe>';
      });
    });
  }

  /* ---------- speed / medball ---------- */
  function wireBlock(it) {
    body.querySelectorAll('.wo-setrow').forEach(function (row) {
      var k = Number(row.getAttribute('data-k'));
      var btn = row.querySelector('.wo-logbtn');
      btn.addEventListener('click', function () {
        var w = row.querySelector('.wo-w');
        var r = row.querySelector('.wo-r').value;
        var act = btn.getAttribute('data-act');
        buzz();
        btn.disabled = true;
        log({
          kind: it.type === 'speed' ? 'spd' : 'med', item_key: it.key, lift_op: act, set_idx: k,
          set_weight: w ? w.value : '', set_reps: r,
          prog_sets: it.progSetCount, prog_reps: it.progReps,
        }).then(function (res) {
          if (Array.isArray(res.sets)) it.dispSets = res.sets;
          it.done = !!res.checked;
          render();
        }).catch(function () { btn.disabled = false; });
      });
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
            if (!moreSets) startRest(it, true);
            else startRest(it, false);
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
  function startRest(it, exerciseDone) {
    var secs = it.rest || 120;
    var nextScreen = screens[idx + 1] || [];
    var nextIt = nextScreen[0];
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

  /* ---------- nav ---------- */
  function advance() {
    stopRest();
    if (idx < screens.length - 1) {
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
    if (idx < screens.length - 1) { stopRest(); idx++; render(); }
    else showFinish();
  });

  function showFinish() {
    var sets = 0, vol = 0, lifts = 0;
    items.forEach(function (it) {
      if (it.type !== 'lift') return;
      lifts++;
      (it.dispSets || []).forEach(function (s) {
        if (s.done) {
          sets++;
          if (s.w != null && s.r != null) vol += Number(s.w) * Number(s.r);
        }
      });
    });
    finishStatsEl.textContent = lifts + ' lifts · ' + sets + ' sets' +
      (vol > 0 ? ' · ' + Math.round(vol).toLocaleString() + ' lbs moved' : '');
    finishEl.hidden = false;
    buzz(30);
  }

  // Resume at the first screen with an incomplete movement.
  for (var f = 0; f < screens.length; f++) {
    var scr = screens[f];
    var anyOpen = scr.some(function (it) { return !itemDone(it); });
    if (anyOpen) { idx = f; break; }
    idx = f;
  }
  render();
})();

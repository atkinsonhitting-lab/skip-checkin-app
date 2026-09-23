const DEMO_VIDEOS = [
  { name: '10-Yard Sprint', url: 'https://www.youtube.com/watch?v=aLzKKgrZI30' },
  { name: 'Flying 10 Sprint', url: 'https://www.youtube.com/shorts/MiS6sNYial8' },
  { name: '20-Yard Sprint', url: 'https://www.youtube.com/watch?v=wHDGKBJEnOQ' },
  { name: '5-10-5 Pro Agility Drill', url: 'https://www.youtube.com/watch?v=tYhCJd7LaBU' },
  { name: 'Medicine Ball Rotational Throw', url: 'https://www.youtube.com/watch?v=l2R7f3r1228' },
  { name: 'Medicine Ball Overhead Slam', url: 'https://www.youtube.com/watch?v=EsAhU1jHpiQ' },
  { name: 'Medicine Ball Scoop Toss', url: 'https://www.youtube.com/watch?v=KT7iAYA3g7Y' },
  { name: 'Medicine Ball Shotput Throw', url: 'https://www.youtube.com/watch?v=EXV9UhUMTiY' },
  { name: 'Trap Bar Deadlift', url: 'https://www.youtube.com/watch?v=dfYIApfWS5o' },
  { name: 'Dumbbell Bench Press', url: 'https://www.youtube.com/watch?v=xhEhjF5ozuY' },
  { name: 'Chest-Supported Dumbbell Row', url: 'https://www.youtube.com/watch?v=kNvy2_9Ji2w' },
  { name: 'Pallof Press', url: 'https://www.youtube.com/watch?v=YI4Yewxn_sg' },
  { name: 'Front Squat', url: 'https://www.youtube.com/watch?v=Q1R0_CbgHpc' },
  { name: 'Barbell Overhead Press', url: 'https://www.youtube.com/watch?v=S3kYKH32VqI' },
  { name: 'Lat Pulldown', url: 'https://www.youtube.com/watch?v=FDtwvLNjSYs' },
  { name: "Farmer's Carry", url: 'https://www.youtube.com/watch?v=8OtwXwrJizk' },
  { name: 'Barbell Bench Press', url: 'https://www.youtube.com/watch?v=ejI1Nlsul9k' },
  { name: 'Bent-Over Barbell Row', url: 'https://www.youtube.com/watch?v=Ola0WMb0mXc' },
  { name: 'Dumbbell Overhead Press', url: 'https://www.youtube.com/watch?v=9Uj1LL-rvF8' },
  { name: 'Face Pull', url: 'https://www.youtube.com/watch?v=sd4W2lFmIMM' },
  { name: 'Barbell Back Squat', url: 'https://www.youtube.com/watch?v=rrJIyZGlK8c' },
  { name: 'Romanian Deadlift', url: 'https://www.youtube.com/watch?v=5bJEigM5iVg' },
  { name: 'Bulgarian Split Squat', url: 'https://www.youtube.com/watch?v=je7lk51Vl8c' },
  { name: 'Hanging Knee Raise', url: 'https://www.youtube.com/watch?v=dDd2gMmbWJU' }
];
/* Lifting program editor (Sep 23 2026 rebuild, Bobby): state-driven,
   one day at a time. Reads window.LIFT_EDIT, renders day tabs +
   active-day editor, posts JSON to the hidden form. Phone-first. */
(function () {
  'use strict';
  var S = window.LIFT_EDIT || { id: 0, name: '', is_template: false, days: [] };
  if (!Array.isArray(S.days)) S.days = [];
  var active = 0;
  var draftKey = 'lift-edit-draft-' + (S.id || 'new');
  var els = {};

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function blankDay(label) {
    return { label: label || 'Day ' + (S.days.length + 1), warmup: [], speed: [], medball: [], exercises: [] };
  }
  function blankSpeed() { return { name: '', volume: '', notes: '', video: '' }; }
  function blankLift() { return { name: '', sets: '', reps: '', target_rpe: '', rest: 120, notes: '', video: '' }; }
  function normDay(d) {
    d = d || {};
    if (!Array.isArray(d.warmup)) d.warmup = [];
    if (!Array.isArray(d.speed)) d.speed = [];
    if (!Array.isArray(d.medball)) d.medball = [];
    if (!Array.isArray(d.exercises)) d.exercises = [];
    return d;
  }

  // ---- autosave draft ----
  var draftNotice = null;
  function saveDraft() {
    try {
      localStorage.setItem(draftKey, JSON.stringify({ name: nameVal(), days: S.days, savedAt: Date.now() }));
    } catch (e) {}
  }
  function loadDraft() {
    try {
      var raw = localStorage.getItem(draftKey);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (d && Array.isArray(d.days) && d.days.length) {
        S.days = d.days.map(normDay);
        if (typeof d.name === 'string') S.name = d.name;
        draftNotice = 'Draft restored from your last edit.';
      }
    } catch (e) {}
  }
  function clearDraft() { try { localStorage.removeItem(draftKey); } catch (e) {} }

  function nameVal() {
    var n = document.getElementById('le-name');
    return n ? n.value : (S.name || '');
  }

  // ---- demo video picker ----
  var pickerTarget = null; // {obj, field}
  function suggestVideo(name) {
    var n = String(name || '').toLowerCase().trim();
    if (!n) return null;
    for (var i = 0; i < DEMO_VIDEOS.length; i++) {
      var dn = DEMO_VIDEOS[i].name.toLowerCase();
      if (dn === n || n.indexOf(dn) !== -1 || dn.indexOf(n) !== -1) return DEMO_VIDEOS[i];
    }
    return null;
  }
  function openPicker(obj) {
    pickerTarget = obj;
    renderPicker('');
    els.pickerOv.hidden = false;
  }
  function closePicker() { els.pickerOv.hidden = true; pickerTarget = null; }
  function renderPicker(q) {
    q = String(q || '').toLowerCase();
    var list = DEMO_VIDEOS.filter(function (v) {
      return !q || v.name.toLowerCase().indexOf(q) !== -1;
    });
    els.pickerList.innerHTML = list.map(function (v, i) {
      return '<button type="button" class="le-pick" data-i="' + i + '">' +
        '<span class="le-pick-play">▶</span><span>' + esc(v.name) + '</span></button>';
    }).join('') || '<p class="hint">No matches.</p>';
    var btns = els.pickerList.querySelectorAll('.le-pick');
    for (var b = 0; b < btns.length; b++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          var v = list[parseInt(btn.getAttribute('data-i'), 10)];
          if (v && pickerTarget) {
            pickerTarget.video = v.url;
            var inp = pickerTarget.inputEl;
            if (inp) inp.value = v.url;
            changed();
          }
          closePicker();
        });
      })(btns[b]);
    }
  }
  function videoField(obj, label) {
    var sug = suggestVideo(obj.name);
    var sugBtn = (!obj.video && sug)
      ? '<button type="button" class="btn-small le-sug" data-sug="1">Use ' + esc(sug.name) + ' demo</button>' : '';
    return '<label class="le-f">' + label +
      '<span class="le-vidrow"><input data-f="video" value="' + esc(obj.video || '') + '" placeholder="YouTube link" inputmode="url">' +
      '<button type="button" class="btn-small" data-pick="1" aria-label="Pick demo video">🎬</button></span>' + sugBtn + '</label>';
  }

  // ---- change tracking ----
  var saveTimer = null;
  function changed() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraft, 400);
  }

  // ---- tabs ----
  function renderTabs() {
    var t = els.tabs;
    t.innerHTML = '';
    S.days.forEach(function (d, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'le-tab' + (i === active ? ' on' : '');
      b.textContent = d.label || ('Day ' + (i + 1));
      b.addEventListener('click', function () { active = i; renderAll(); });
      t.appendChild(b);
    });
    var add = document.createElement('button');
    add.type = 'button';
    add.className = 'le-tab le-add';
    add.textContent = '+ Day';
    add.addEventListener('click', function () {
      S.days.push(blankDay());
      active = S.days.length - 1;
      changed(); renderAll();
    });
    t.appendChild(add);
  }

  // ---- movement rows ----
  function speedRow(obj, section) {
    var wrap = document.createElement('div');
    wrap.className = 'le-row';
    wrap.innerHTML =
      '<label class="le-f le-grow">Exercise<input data-f="name" value="' + esc(obj.name) + '" placeholder="e.g. 10-Yard Sprint"></label>' +
      '<label class="le-f le-vol">Volume<input data-f="volume" value="' + esc(obj.volume) + '" placeholder="4×10y"></label>' +
      '<button type="button" class="le-x" aria-label="Remove">×</button>' +
      '<label class="le-f le-full">Notes<input data-f="notes" value="' + esc(obj.notes) + '" placeholder="Walk-back recovery…"></label>' +
      '<div class="le-f le-full">' + videoField(obj, 'Demo video') + '</div>';
    bindRow(wrap, obj, section);
    return wrap;
  }
  function bindRow(wrap, obj, section) {
    var inputs = wrap.querySelectorAll('[data-f]');
    for (var i = 0; i < inputs.length; i++) {
      (function (inp) {
        if (inp.getAttribute('data-f') === 'video') obj.inputEl = inp;
        inp.addEventListener('input', function () {
          obj[inp.getAttribute('data-f')] = inp.value;
          if (inp.getAttribute('data-f') === 'name') {
            // refresh the "use demo" suggestion live
            var sug = (!obj.video && suggestVideo(inp.value));
            var old = wrap.querySelector('[data-sug]');
            if (old) old.remove();
            if (sug) {
              var btn = document.createElement('button');
              btn.type = 'button'; btn.className = 'btn-small le-sug';
              btn.setAttribute('data-sug', '1');
              btn.textContent = 'Use ' + sug.name + ' demo';
              btn.addEventListener('click', function () {
                obj.video = sug.url;
                var vi = wrap.querySelector('[data-f="video"]');
                if (vi) vi.value = sug.url;
                btn.remove(); changed();
              });
              var vr = wrap.querySelector('.le-vidrow');
              if (vr && vr.parentNode) vr.parentNode.appendChild(btn);
            }
          }
          changed();
        });
      })(inputs[i]);
    }
    var sug0 = wrap.querySelector('[data-sug]');
    if (sug0) sug0.addEventListener('click', function () {
      var s = suggestVideo(obj.name);
      if (s) { obj.video = s.url; var vi = wrap.querySelector('[data-f="video"]'); if (vi) vi.value = s.url; sug0.remove(); changed(); }
    });
    var pick = wrap.querySelector('[data-pick]');
    if (pick) pick.addEventListener('click', function () { openPicker(obj); });
    var x = wrap.querySelector('.le-x');
    if (x) x.addEventListener('click', function () {
      var arr = S.days[active][section];
      arr.splice(arr.indexOf(obj), 1);
      changed(); renderAll();
    });
  }

  function liftCard(obj) {
    var wrap = document.createElement('div');
    wrap.className = 'le-lift';
    wrap.innerHTML =
      '<div class="le-lift-head"><strong>' + (esc(obj.name) || 'New lift') + '</strong>' +
      '<span class="le-tools">' +
      '<button type="button" data-t="up" aria-label="Move up">↑</button>' +
      '<button type="button" data-t="down" aria-label="Move down">↓</button>' +
      '<button type="button" data-t="dup">⧉</button>' +
      '<button type="button" data-t="del" aria-label="Remove">×</button></span></div>' +
      '<div class="le-grid">' +
      '<label class="le-f">Exercise<input data-f="name" value="' + esc(obj.name) + '" placeholder="Trap Bar Deadlift"></label>' +
      '<label class="le-f">Sets<input data-f="sets" value="' + esc(obj.sets) + '" placeholder="4" inputmode="numeric"></label>' +
      '<label class="le-f">Reps<input data-f="reps" value="' + esc(obj.reps) + '" placeholder="6"></label>' +
      '<label class="le-f">Target RPE <span class="hint-inline">1–10</span><input data-f="target_rpe" value="' + esc(obj.target_rpe) + '" placeholder="8" inputmode="decimal"></label>' +
      '<label class="le-f">Rest <span class="hint-inline">sec</span><input data-f="rest" value="' + esc(obj.rest) + '" placeholder="120" inputmode="numeric"></label>' +
      '<label class="le-f le-full">Coaching notes<textarea data-f="notes" rows="2" placeholder="Chest up, push the floor away…">' + esc(obj.notes) + '</textarea></label>' +
      '<div class="le-f le-full">' + videoField(obj, 'Demo video') + '</div>' +
      '</div>';
    var inputs = wrap.querySelectorAll('[data-f]');
    for (var i = 0; i < inputs.length; i++) {
      (function (inp) {
        if (inp.getAttribute('data-f') === 'video') obj.inputEl = inp;
        inp.addEventListener('input', function () {
          obj[inp.getAttribute('data-f')] = inp.value;
          if (inp.getAttribute('data-f') === 'name') {
            var h = wrap.querySelector('.le-lift-head strong');
            if (h) h.textContent = inp.value || 'New lift';
          }
          changed();
        });
      })(inputs[i]);
    }
    var sug0 = wrap.querySelector('[data-sug]');
    if (sug0) sug0.addEventListener('click', function () {
      var s = suggestVideo(obj.name);
      if (s) { obj.video = s.url; var vi = wrap.querySelector('[data-f="video"]'); if (vi) vi.value = s.url; sug0.remove(); changed(); }
    });
    var pick = wrap.querySelector('[data-pick]');
    if (pick) pick.addEventListener('click', function () { openPicker(obj); });
    var tools = wrap.querySelectorAll('[data-t]');
    for (var t = 0; t < tools.length; t++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          var arr = S.days[active].exercises;
          var ix = arr.indexOf(obj);
          var kind = btn.getAttribute('data-t');
          if (kind === 'del') arr.splice(ix, 1);
          else if (kind === 'dup') arr.splice(ix + 1, 0, JSON.parse(JSON.stringify(obj)));
          else if (kind === 'up' && ix > 0) { arr[ix] = arr[ix - 1]; arr[ix - 1] = obj; }
          else if (kind === 'down' && ix < arr.length - 1) { arr[ix] = arr[ix + 1]; arr[ix + 1] = obj; }
          changed(); renderAll();
        });
      })(tools[t]);
    }
    return wrap;
  }

  // ---- day editor ----
  function renderDay() {
    var host = els.day;
    host.innerHTML = '';
    if (!S.days.length) {
      var p = document.createElement('p');
      p.className = 'hint';
      p.textContent = 'No days yet — tap + Day to build one.';
      host.appendChild(p);
      return;
    }
    var d = normDay(S.days[active]);

    var head = document.createElement('div');
    head.className = 'card le-dayhead';
    head.innerHTML =
      '<label class="le-f le-grow">Day label<input id="le-daylabel" value="' + esc(d.label || '') + '" maxlength="40"></label>' +
      '<div class="le-daytools">' +
      '<button type="button" class="btn-small" data-d="left">←</button>' +
      '<button type="button" class="btn-small" data-d="right">→</button>' +
      '<button type="button" class="btn-small" data-d="dup">Duplicate day</button>' +
      '<button type="button" class="btn-small btn-danger" data-d="del">Delete</button></div>';
    host.appendChild(head);
    var labelInp = head.querySelector('#le-daylabel');
    labelInp.addEventListener('input', function () { d.label = labelInp.value; changed(); renderTabs(); });
    var dtools = head.querySelectorAll('[data-d]');
    for (var i = 0; i < dtools.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          var k = btn.getAttribute('data-d');
          if (k === 'del') {
            if (!confirm('Delete this day?')) return;
            S.days.splice(active, 1);
            active = Math.max(0, active - 1);
          } else if (k === 'dup') {
            S.days.splice(active + 1, 0, JSON.parse(JSON.stringify(d)));
            active = active + 1;
          } else if (k === 'left' && active > 0) {
            S.days[active] = S.days[active - 1]; S.days[active - 1] = d; active--;
          } else if (k === 'right' && active < S.days.length - 1) {
            S.days[active] = S.days[active + 1]; S.days[active + 1] = d; active++;
          }
          changed(); renderAll();
        });
      })(dtools[i]);
    }

    host.appendChild(section('Warm-up', d.warmup, 'warmup', true));
    host.appendChild(section('Speed', d.speed, 'speed', false));
    host.appendChild(section('Med ball', d.medball, 'medball', false));

    var lh = document.createElement('h3');
    lh.className = 'le-sec';
    lh.textContent = 'Lifts (' + d.exercises.length + ')';
    host.appendChild(lh);
    d.exercises.forEach(function (e) { host.appendChild(liftCard(e)); });
    var addL = document.createElement('button');
    addL.type = 'button'; addL.className = 'btn le-addbtn';
    addL.textContent = '+ Add lift';
    addL.addEventListener('click', function () { d.exercises.push(blankLift()); changed(); renderAll(); });
    host.appendChild(addL);
  }

  function section(title, arr, key, simple) {
    var frag = document.createElement('div');
    var h = document.createElement('h3');
    h.className = 'le-sec';
    h.textContent = title + ' (' + arr.length + ')';
    frag.appendChild(h);
    arr.forEach(function (obj) {
      if (simple) {
        var w = document.createElement('div');
        w.className = 'le-row';
        w.innerHTML =
          '<label class="le-f le-grow">Movement<input data-f="name" value="' + esc(obj.name || '') + '" placeholder="Jumping jacks"></label>' +
          '<label class="le-f le-grow">Details<input data-f="notes" value="' + esc(obj.notes || '') + '" placeholder="2×20"></label>' +
          '<button type="button" class="le-x" aria-label="Remove">×</button>';
        (function (wrap, o) {
          var ins = wrap.querySelectorAll('[data-f]');
          for (var i = 0; i < ins.length; i++) {
            (function (inp) {
              inp.addEventListener('input', function () { o[inp.getAttribute('data-f')] = inp.value; changed(); });
            })(ins[i]);
          }
          wrap.querySelector('.le-x').addEventListener('click', function () {
            arr.splice(arr.indexOf(o), 1); changed(); renderAll();
          });
        })(w, obj);
        // normalize simple warmup shape
        if (typeof obj === 'string') { /* legacy */ }
        frag.appendChild(w);
      } else {
        frag.appendChild(speedRow(obj, key));
      }
    });
    var add = document.createElement('button');
    add.type = 'button'; add.className = 'btn le-addbtn';
    add.textContent = '+ Add ' + title.toLowerCase().replace(/ \(.*/, '');
    add.addEventListener('click', function () {
      arr.push(simple ? { name: '', notes: '' } : blankSpeed());
      changed(); renderAll();
    });
    frag.appendChild(add);
    return frag;
  }

  // ---- preview ----
  function renderPreview() {
    var d = S.days.length ? normDay(S.days[active]) : blankDay('Day 1');
    function rows(arr) {
      return arr.map(function (r) {
        return '<div class="le-pv-row"><strong>' + esc(r.name || 'Untitled') + '</strong>' +
          (r.volume ? ' <span class="hint-inline">' + esc(r.volume) + '</span>' : '') +
          (r.notes ? '<div class="hint">' + esc(r.notes) + '</div>' : '') +
          (r.video ? ' <a href="' + esc(r.video) + '" target="_blank" rel="noopener">🎬 demo</a>' : '') + '</div>';
      }).join('');
    }
    function lifts(arr) {
      return arr.map(function (e) {
        return '<div class="le-pv-row"><strong>' + esc(e.name || 'Untitled') + '</strong>' +
          ' <span class="hint-inline">' + esc([e.sets, e.reps].filter(Boolean).join('×')) +
          (e.target_rpe ? ' @ RPE ' + esc(e.target_rpe) : '') +
          (e.rest ? ' · rest ' + esc(e.rest) + 's' : '') + '</span>' +
          (e.notes ? '<div class="hint">' + esc(e.notes) + '</div>' : '') +
          (e.video ? ' <a href="' + esc(e.video) + '" target="_blank" rel="noopener">🎬 demo</a>' : '') + '</div>';
      }).join('');
    }
    els.pvBody.innerHTML =
      '<h3 style="margin-top:0">' + esc(d.label || 'Day') + '</h3>' +
      (d.warmup.length ? '<h4>Warm-up</h4>' + rows(d.warmup.map(function (w) { return typeof w === 'string' ? { name: w } : w; })) : '') +
      (d.speed.length ? '<h4>Speed</h4>' + rows(d.speed) : '') +
      (d.medball.length ? '<h4>Med ball</h4>' + rows(d.medball) : '') +
      (d.exercises.length ? '<h4>Lifts</h4>' + lifts(d.exercises) : '') +
      (!d.warmup.length && !d.speed.length && !d.medball.length && !d.exercises.length ? '<p class="hint">This day is empty.</p>' : '');
    els.pvOv.hidden = false;
  }

  // ---- save ----
  function save() {
    var nm = nameVal().trim();
    if (!nm) { alert('Give the program a name first.'); return; }
    if (!S.days.length) { alert('Add at least one day first.'); return; }
    document.getElementById('le-form-name').value = nm;
    document.getElementById('le-form-json').value = JSON.stringify({ name: nm, days: S.days });
    clearDraft();
    document.getElementById('le-form').submit();
  }

  function renderAll() {
    renderTabs();
    renderDay();
  }

  function init() {
    els.tabs = document.getElementById('le-tabs');
    els.day = document.getElementById('le-day');
    els.pvOv = document.getElementById('le-preview-ov');
    els.pvBody = document.getElementById('le-preview-body');
    if (!els.tabs || !els.day) return;
    // picker overlay
    var ov = document.createElement('div');
    ov.className = 'le-picker';
    ov.hidden = true;
    ov.innerHTML = '<div class="le-picker-card"><div class="le-picker-head"><strong>Pick demo video</strong>' +
      '<button type="button" class="btn-small" id="le-picker-close">Close</button></div>' +
      '<input id="le-picker-q" class="searchbar" placeholder="Search demos…" autocomplete="off">' +
      '<div id="le-picker-list" class="le-picker-list"></div></div>';
    document.body.appendChild(ov);
    els.pickerOv = ov;
    els.pickerList = ov.querySelector('#le-picker-list');
    ov.querySelector('#le-picker-close').addEventListener('click', closePicker);
    ov.addEventListener('click', function (e) { if (e.target === ov) closePicker(); });
    ov.querySelector('#le-picker-q').addEventListener('input', function (e) { renderPicker(e.target.value); });

    loadDraft();
    var nm = document.getElementById('le-name');
    if (nm && S.name) nm.value = S.name;
    if (nm) nm.addEventListener('input', changed);

    document.getElementById('le-save').addEventListener('click', save);
    document.getElementById('le-preview').addEventListener('click', renderPreview);
    document.getElementById('le-preview-close').addEventListener('click', function () { els.pvOv.hidden = true; });

    if (draftNotice) {
      var n = document.createElement('p');
      n.className = 'notice';
      n.innerHTML = esc(draftNotice) + ' <button type="button" class="btn-small btn-quiet" id="le-discard">Discard</button>';
      els.day.parentNode.insertBefore(n, els.day);
      document.getElementById('le-discard').addEventListener('click', function () {
        clearDraft(); n.remove();
      });
    }
    renderAll();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

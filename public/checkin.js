// Check-in form: difficulty slider wording follows the environment.
// Game / Live BP = pitching ("How good was the pitching?", Weak -> Nasty).
// Everything else = training ("How hard was the training?", Easy -> Brutal).
// (External file because the Content-Security-Policy blocks inline scripts.)
(function () {
  var q = document.getElementById('difficulty-q');
  var lo = document.getElementById('difficulty-lo');
  var hi = document.getElementById('difficulty-hi');
  if (!q || !lo || !hi) return;
  function upd() {
    var s = document.querySelector('input[name="environment"]:checked');
    var g = s && (s.value === 'Game' || s.value === 'Live BP');
    q.textContent = g ? 'How good was the pitching?' : 'How hard was the training?';
    lo.textContent = g ? 'Weak' : 'Easy';
    hi.textContent = g ? 'Nasty' : 'Brutal';
  }
  var radios = document.querySelectorAll('input[name="environment"]');
  for (var i = 0; i < radios.length; i++) radios[i].addEventListener('change', upd);
  upd();
})();

// Voice dictation: mic buttons on the check-in textareas.
// (Runs on DOMContentLoaded because the script tag sits above the buttons.)
(function () {
  function init() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    var btns = document.querySelectorAll('.mic-btn');
    if (!btns.length) return;
    if (!SR) {
      for (var h = 0; h < btns.length; h++) btns[h].style.display = 'none';
      return;
    }
    var rec = null, activeBtn = null;
    function stop() {
      if (rec) { try { rec.stop(); } catch (e) {} }
    }
    for (var j = 0; j < btns.length; j++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          if (activeBtn === btn) { stop(); return; } // tap again to stop
          stop();
          var ta = document.getElementById(btn.getAttribute('data-target'));
          if (!ta) return;
          var base = ta.value ? ta.value.replace(/\s+$/, '') + ' ' : '';
          var said = '';
          rec = new SR();
          rec.lang = 'en-US';
          rec.interimResults = true;
          rec.continuous = true;
          rec.onresult = function (ev) {
            var interim = '';
            for (var k = ev.resultIndex; k < ev.results.length; k++) {
              var t = ev.results[k][0].transcript;
              if (ev.results[k].isFinal) said += t;
              else interim += t;
            }
            ta.value = base + said + interim;
          };
          rec.onend = function () {
            if (activeBtn === btn) {
              btn.classList.remove('listening');
              activeBtn = null;
              rec = null;
            }
          };
          rec.onerror = function (ev) {
            if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
              ta.placeholder = 'Microphone blocked — allow mic access to dictate.';
            }
            stop();
          };
          activeBtn = btn;
          btn.classList.add('listening');
          try { rec.start(); } catch (e) {
            btn.classList.remove('listening');
            activeBtn = null;
          }
        });
      })(btns[j]);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

// Throwing-session conditional fields (pitcher + combined two-way forms):
// shows only the detail block for the selected session type, and hides the
// intent/command UI on recovery and no-throw days.
// (External file because the Content-Security-Policy blocks inline scripts.)
(function () {
  function syncThrow(form) {
    var t = (form.querySelector('input[name="pitch_session_type"]:checked') || {}).value;
    var isThrow = t === 'bullpen' || t === 'live' || t === 'game';
    var noArm = t === 'recovery' || t === 'no_throw';
    var p = form.id + '-';
    function set(id, hide) {
      var el = document.getElementById(id);
      if (el) el.hidden = hide;
    }
    set(p + 'detail-throw', !isThrow);
    set(p + 'detail-catch', t !== 'catch_play');
    set(p + 'detail-recovery', t !== 'recovery');
    set(p + 'detail-nothrow', t !== 'no_throw');
    set(p + 'intent-block', noArm || !t);
    set(p + 'command-block', noArm);
  }
  var forms = document.querySelectorAll('form[data-throw-sync]');
  for (var i = 0; i < forms.length; i++) {
    (function (form) {
      form.addEventListener('change', function () { syncThrow(form); });
      syncThrow(form);
    })(forms[i]);
  }
})();

// Combined two-way form: hitting / throwing toggles show the matching block.
// Hidden blocks skip browser validation, so unchecked sections never block.
(function () {
  var form = document.getElementById('combined-form');
  if (!form) return;
  var hitBox = form.querySelector('input[name="did_hit"]');
  var throwBox = form.querySelector('input[name="did_throw"]');
  if (!hitBox || !throwBox) return;
  function sync() {
    var hb = document.getElementById('combined-hitting-block');
    var tb = document.getElementById('combined-throwing-block');
    if (hb) hb.hidden = !hitBox.checked;
    if (tb) tb.hidden = !throwBox.checked;
  }
  hitBox.addEventListener('change', sync);
  throwBox.addEventListener('change', sync);
  sync();
})();

// Submit guard backstop: if the user navigates back to the form afterwards,
// the browser may restore it with the button still disabled — re-enable it
// and put the original label back.
window.addEventListener('pageshow', function () {
  var btns = document.querySelectorAll('form button[type=submit][disabled]');
  for (var i = 0; i < btns.length; i++) {
    btns[i].disabled = false;
    if (btns[i].dataset.origText) btns[i].textContent = btns[i].dataset.origText;
  }
});

// Submit-time validation with a plain-language banner.
// When a check-in can't be submitted, the athlete gets a clear list of
// exactly what's missing and why — instead of a silent failure or a tiny
// browser bubble. This mirrors the server-side rules exactly: it only flags
// what the server would reject, never more. The old inline onsubmit
// "Saving…" guard moved here: the submit button is disabled only AFTER the
// form passes validation and really submits.
// (External file because the Content-Security-Policy blocks inline scripts.)
(function () {
  var ENVS = ['Game', 'Cage', 'Live BP', 'Tee Work', 'Other'];
  var THROW_TYPES = ['bullpen', 'live', 'game', 'catch_play', 'recovery', 'no_throw'];
  var INTENTS = ['light', 'medium', 'heavy'];

  var HEADLINES = {
    hitting: "Your entry won't submit yet — here's what's missing:",
    pitching: "Your entry won't submit yet — here's what's missing:",
    combined: "Your entry won't submit yet — here's what's missing:",
    pre: "Can't lock it in yet — here's what's missing:"
  };

  // Pure validation: (kind, values) -> [{key, title, why}]. Kept DOM-free so
  // it can be unit-tested in Node.
  function validateValues(kind, v) {
    var out = [];
    function missing(key, title, why) { out.push({ key: key, title: title, why: why }); }
    function blank(s) { return !String(s == null ? '' : s).trim(); }

    function checkThrowing() {
      var t = v.pitch_session_type;
      if (THROW_TYPES.indexOf(t) < 0) {
        missing('pitch_session_type', 'What kind of throwing was it?',
          'Bullpen, game, catch play — Skip reads each one differently.');
        return;
      }
      var noArm = t === 'recovery' || t === 'no_throw';
      if (!noArm && INTENTS.indexOf(v.intent) < 0) {
        missing('intent', 'Intent for the day',
          'Light, medium, or heavy. Skip needs to know how hard you went.');
      }
      if (t === 'bullpen' || t === 'live' || t === 'game') {
        var n = parseInt(v.pitch_count, 10);
        if (!isFinite(n) || n < 1 || n > 300) {
          missing('pitch_count', 'Pitch count',
            "How many you threw. Skip can't track workload without a number.");
        }
        if (!v.pitches || !v.pitches.length) {
          missing('pitches_thrown', 'Which pitches did you throw?',
            "Check off at least one — that's how Skip knows your mix.");
        }
        var veloRaw = String(v.velo_max == null ? '' : v.velo_max).trim();
        if (veloRaw !== '') {
          var velo = parseFloat(veloRaw);
          if (!isFinite(velo) || velo < 40 || velo > 110) {
            missing('velo_max', 'Top velo',
              "If you log one, it's got to be a real number between 40 and 110.");
          }
        }
      }
      if (t === 'recovery' && blank(v.recovery_notes)) {
        missing('recovery_notes', 'Recovery work',
          'What did you actually do? Bands, lift, flush run — it all counts.');
      }
      if (t === 'no_throw' && blank(v.no_throw_note)) {
        missing('no_throw_note', 'What did you do to get better?',
          'No throwing is fine — but tell Skip what the day was for.');
      }
    }

    if (kind === 'hitting') {
      if (ENVS.indexOf(v.environment) < 0) {
        missing('environment', 'Where were you?',
          'Skip needs to know what kind of day it was to make sense of your entry.');
      }
      if (v.did_drills !== 'yes' && v.did_drills !== 'no') {
        missing('did_drills', 'Did you do any drills?',
          "Yes or no, that's all — it's how Skip tracks what's working for you.");
      } else if (v.did_drills === 'yes' && !String(v.drills_done || '').replace(/[\s,]/g, '')) {
        missing('drills_done', 'Which drills?',
          "You said you did drills, so name them. Skip can't use what you don't log.");
      }
    } else if (kind === 'pitching') {
      checkThrowing();
    } else if (kind === 'combined') {
      if (v.did_hit !== 'yes' && v.did_throw !== 'yes') {
        missing('did_hit', 'What did you do today?',
          "Hitting, throwing, or both — Skip can't log a day he doesn't know about.");
      }
      if (v.did_hit === 'yes' && ENVS.indexOf(v.environment) < 0) {
        missing('environment', 'Where did you hit?',
          'Skip needs to know what kind of hitting day it was.');
      }
      if (v.did_throw === 'yes') checkThrowing();
    } else if (kind === 'pre') {
      if (v.pre_kind === 'throwing') {
        if (blank(v.throw_focus)) {
          missing('throw_focus', 'Throwing focus', "One thing. That's the whole point of this page.");
        }
      } else if (v.pre_kind === 'both') {
        if (blank(v.focus) && blank(v.throw_focus)) {
          missing('focus', 'A focus — hitting or throwing',
            "Give me at least one. That's the whole point of this page.");
        }
      } else if (blank(v.focus)) {
        missing('focus', 'What are you working on?', "One thing. That's the whole point of this page.");
      }
    }
    return out;
  }

  // key -> the field to focus / highlight for a missing item.
  function fieldAnchor(form, key) {
    var map = {
      environment: 'input[name="environment"]',
      did_drills: 'input[name="did_drills"]',
      drills_done: 'input[name="drills_done"]',
      did_hit: 'input[name="did_hit"]',
      pitch_session_type: 'input[name="pitch_session_type"]',
      intent: 'input[name="intent"]',
      pitch_count: 'input[name="pitch_count"]',
      pitches_thrown: 'input[name="pitches_thrown"]',
      velo_max: 'input[name="velo_max"]',
      recovery_notes: 'textarea[name="recovery_notes"]',
      no_throw_note: 'textarea[name="no_throw_note"]',
      throw_focus: 'textarea[name="throw_focus"]',
      focus: 'textarea[name="focus"]'
    };
    var sel = map[key];
    return sel ? form.querySelector(sel) : null;
  }

  function collectValues(form) {
    function checkedVal(name) {
      var el = form.querySelector('input[name="' + name + '"]:checked');
      return el ? el.value : '';
    }
    function fieldVal(name) {
      var el = form.querySelector('[name="' + name + '"]');
      return el ? el.value : '';
    }
    var pitches = [];
    var pc = form.querySelectorAll('input[name="pitches_thrown"]:checked');
    for (var i = 0; i < pc.length; i++) pitches.push(pc[i].value);
    function boxChecked(name) {
      var el = form.querySelector('input[name="' + name + '"]');
      return el ? (el.checked ? 'yes' : '') : '';
    }
    return {
      environment: checkedVal('environment'),
      did_drills: checkedVal('did_drills'),
      drills_done: fieldVal('drills_done'),
      did_hit: boxChecked('did_hit'),
      did_throw: boxChecked('did_throw'),
      pitch_session_type: checkedVal('pitch_session_type'),
      intent: checkedVal('intent'),
      pitch_count: fieldVal('pitch_count'),
      pitches: pitches,
      velo_max: fieldVal('velo_max'),
      recovery_notes: fieldVal('recovery_notes'),
      no_throw_note: fieldVal('no_throw_note'),
      throw_focus: fieldVal('throw_focus'),
      focus: fieldVal('focus'),
      pre_kind: fieldVal('kind')
    };
  }

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function clearValidation(form) {
    var old = form.querySelector('.validate-banner');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var marks = form.querySelectorAll('.missing');
    for (var i = 0; i < marks.length; i++) marks[i].classList.remove('missing');
  }

  function showValidation(form, kind, missing) {
    clearValidation(form);
    var banner = document.createElement('div');
    banner.className = 'error validate-banner';
    banner.setAttribute('role', 'alert');
    var html = '<strong>' + escHtml(HEADLINES[kind] || HEADLINES.hitting) + '</strong><ul>';
    missing.forEach(function (m) {
      html += '<li><a href="#" data-focus-key="' + escHtml(m.key) + '"><strong>' +
        escHtml(m.title) + '</strong></a> — ' + escHtml(m.why) + '</li>';
      var anchor = fieldAnchor(form, m.key);
      if (anchor) {
        // Pill/checkbox groups highlight the whole group; single fields
        // highlight their label.
        var box = anchor.closest
          ? (anchor.closest('.pills, .checks') || anchor.closest('label, .field-label'))
          : null;
        if (box) box.classList.add('missing');
        else anchor.classList.add('missing');
      }
    });
    html += '</ul>';
    banner.innerHTML = html;
    form.insertBefore(banner, form.firstChild);
    var links = banner.querySelectorAll('a[data-focus-key]');
    for (var i = 0; i < links.length; i++) {
      links[i].addEventListener('click', function (ev) {
        ev.preventDefault();
        var el = fieldAnchor(form, this.getAttribute('data-focus-key'));
        if (el) {
          if (el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.focus();
        }
      });
    }
    if (banner.scrollIntoView) banner.scrollIntoView({ behavior: 'smooth', block: 'start' });
    var first = fieldAnchor(form, missing[0].key);
    if (first) {
      try { first.focus({ preventScroll: true }); }
      catch (e) { first.focus(); }
    }
  }

  function init() {
    var forms = document.querySelectorAll('form[data-validate]');
    for (var i = 0; i < forms.length; i++) {
      (function (form) {
        var kind = form.getAttribute('data-validate');
        form.noValidate = true; // our banner replaces the native bubble
        form.addEventListener('submit', function (ev) {
          var missing = validateValues(kind, collectValues(form));
          clearValidation(form);
          if (missing.length) {
            ev.preventDefault();
            showValidation(form, kind, missing);
            return;
          }
          var b = form.querySelector('button[type=submit]');
          if (b && !b.disabled) {
            b.dataset.origText = b.textContent;
            b.disabled = true;
            b.textContent = 'Saving…';
          }
        });
        // He started fixing things — clear the banner/highlights; the next
        // submit re-validates from scratch.
        function onFix() { clearValidation(form); }
        form.addEventListener('input', onFix);
        form.addEventListener('change', onFix);
      })(forms[i]);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Export the pure validator for Node unit tests.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { validateValues: validateValues, HEADLINES: HEADLINES };
  }
})();

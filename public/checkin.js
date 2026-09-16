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

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

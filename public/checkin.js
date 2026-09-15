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

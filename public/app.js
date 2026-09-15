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
        img.src = '/skip-avatar.webp';
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
      thinking.innerHTML = '<img src="/skip-avatar.webp" class="skip-avatar" alt="Skip"><div class="msg-bubble typing"><span></span><span></span><span></span></div>';
      log.appendChild(thinking);
      scroll();
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 45000);
        const resp = await fetch('/api/chat', {
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

  // ---- Check-in: show "What ones?" only when drills = yes ----
  (function drillToggle() {
    const wrap = document.getElementById('drill-names');
    if (!wrap) return;
    const sync = () => {
      const sel = document.querySelector('input[name="did_drills"]:checked');
      wrap.hidden = !sel || sel.value !== 'yes';
    };
    document.querySelectorAll('input[name="did_drills"]').forEach((r) => r.addEventListener('change', sync));
    sync();
  })();

  // ---- Check-in: fill drills from the hitter's daily routine ----
  (function useRoutine() {
    const btn = document.getElementById('use-routine');
    if (!btn) return;
    btn.addEventListener('click', () => {
      let drills = [];
      try { drills = JSON.parse(btn.dataset.routine || '[]'); } catch (e) { drills = []; }
      const input = document.getElementById('drills-input');
      if (!input || !drills.length) return;
      input.value = drills
        .map((d) => (d.station ? `${d.name} (${d.station})` : d.name))
        .join(', ');
      input.focus();
    });
  })();

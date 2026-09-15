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
    let currentAudio = null;
    let currentBtn = null;
    function stopAudio() {
      if (currentAudio) { try { currentAudio.pause(); } catch (e) { /* noop */ } currentAudio = null; }
      if (currentBtn) { currentBtn.classList.remove('playing'); currentBtn = null; }
    }
    async function speak(text, btn) {
      if (currentBtn === btn && currentAudio) { stopAudio(); return; }
      stopAudio();
      btn.classList.add('loading');
      try {
        const resp = await fetch('/api/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        if (!resp.ok) throw new Error('voice failed');
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        currentAudio = audio;
        currentBtn = btn;
        btn.classList.remove('loading');
        btn.classList.add('playing');
        audio.onended = () => { stopAudio(); URL.revokeObjectURL(url); };
        audio.onerror = () => { stopAudio(); URL.revokeObjectURL(url); };
        await audio.play();
      } catch (err) {
        btn.classList.remove('loading');
        btn.classList.add('denied');
        btn.title = 'Voice unavailable right now — try again later';
        setTimeout(() => btn.classList.remove('denied'), 2500);
      }
    }
    const SPEAKER_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
    function attachSpeak(msgDiv) {
      const bubble = msgDiv.querySelector('.msg-bubble');
      if (!bubble || msgDiv.querySelector('.speak-btn')) return;
      const text = bubble.textContent.trim();
      if (!text) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'speak-btn';
      btn.setAttribute('aria-label', 'Hear Skip say this');
      btn.title = 'Hear it';
      btn.innerHTML = SPEAKER_SVG;
      btn.addEventListener('click', (e) => { e.preventDefault(); speak(text, btn); });
      msgDiv.appendChild(btn);
    }
    function addMsg(role, text, speakable) {
      const d = document.createElement('div');
      d.className = 'msg ' + (role === 'user' ? 'msg-user' : 'msg-skip');
      const b = document.createElement('div');
      b.className = 'msg-bubble';
      b.textContent = text;
      d.appendChild(b);
      log.appendChild(d);
      if (role === 'assistant' && speakable !== false) attachSpeak(d);
      scroll();
    }
    // Speaker buttons on history rendered by the server.
    log.querySelectorAll('.msg-skip').forEach(attachSpeak);
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
      thinking.innerHTML = '<div class="msg-bubble typing"><span></span><span></span><span></span></div>';
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

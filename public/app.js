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

  // ---- Voice dictation: mic button on every text box ----
  // Uses the browser's built-in speech recognition (iOS Safari 14.5+, Android/ desktop Chrome).
  // On browsers without it, no mic buttons are added — nothing looks broken.
  (function voiceDictation() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    const TEXT_TYPES = ['', 'text', 'search'];
    let active = null; // { rec, field, btn }

    function stopActive() {
      if (active) {
        try { active.rec.stop(); } catch (e) { /* already stopped */ }
        active.btn.classList.remove('listening');
        active = null;
      }
    }

    function appendText(field, text) {
      text = String(text || '').trim();
      if (!text) return;
      const cur = field.value.trim();
      field.value = cur ? cur + ' ' + text : text;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function attach(field) {
      const wrap = document.createElement('div');
      wrap.className = 'voice-wrap' + (field.tagName === 'TEXTAREA' ? ' tall' : '');
      field.parentNode.insertBefore(wrap, field);
      wrap.appendChild(field);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mic-btn';
      btn.setAttribute('aria-label', 'Dictate instead of typing');
      btn.title = 'Tap and speak';
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="19" x2="12" y2="22"/></svg>';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (active && active.field === field) { stopActive(); return; }
        stopActive();
        const rec = new SR();
        rec.lang = 'en-US';
        rec.interimResults = false;
        rec.maxAlternatives = 1;
        btn.classList.add('listening');
        active = { rec, field, btn };
        rec.onresult = (ev) => {
          let text = '';
          for (let i = ev.resultIndex; i < ev.results.length; i++) {
            if (ev.results[i].isFinal) text += ev.results[i][0].transcript;
          }
          appendText(field, text);
        };
        rec.onerror = (ev) => {
          if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
            btn.classList.add('denied');
            btn.title = 'Microphone blocked — allow mic access for this site, then try again';
            setTimeout(() => btn.classList.remove('denied'), 3000);
          }
        };
        rec.onend = () => {
          if (active && active.rec === rec) {
            btn.classList.remove('listening');
            active = null;
          }
        };
        try {
          rec.start();
        } catch (err) {
          btn.classList.remove('listening');
          active = null;
        }
      });
      wrap.appendChild(btn);
    }

    document.querySelectorAll('input, textarea').forEach((field) => {
      if (field.disabled || field.readOnly) return;
      if (field.tagName === 'INPUT' && TEXT_TYPES.indexOf((field.type || '').toLowerCase()) === -1) return;
      attach(field);
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

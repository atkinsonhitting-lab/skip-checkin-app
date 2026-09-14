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

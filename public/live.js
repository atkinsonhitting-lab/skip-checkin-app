// Live voice conversation with Skip.
// Captures mic audio (downsampled to 16kHz PCM), streams it to /live,
// plays back Skip's 24kHz PCM replies, and shows live transcripts.
// Transcripts are also saved server-side into the normal chat history.
(function () {
  var modeText = document.getElementById('mode-text');
  var modeLive = document.getElementById('mode-live');
  if (!modeText || !modeLive) return; // not on the chat page

  var textPanel = document.getElementById('text-panel');
  var livePanel = document.getElementById('live-panel');
  var statusEl = document.getElementById('live-status');
  var startBtn = document.getElementById('live-start');
  var endBtn = document.getElementById('live-end');
  var transcriptEl = document.getElementById('live-transcript');

  function setMode(live) {
    textPanel.hidden = live;
    livePanel.hidden = !live;
    modeText.classList.toggle('mode-active', !live);
    modeLive.classList.toggle('mode-active', live);
    if (!live) endCall();
  }
  modeText.addEventListener('click', function () { setMode(false); });
  modeLive.addEventListener('click', function () { setMode(true); });

  var ws = null;
  var audioCtx = null;
  var micStream = null;
  var micSource = null;
  var micProc = null;
  var playQueue = [];
  var scheduledSources = [];
  var nextPlayTime = 0;
  var userBubble = null;
  var skipBubble = null;
  var lastSpeechAt = 0;
  var audioSentSinceEnd = false;
  var silenceTimer = null;

  function setStatus(t) { statusEl.textContent = t; }

  function addBubble(role) {
    var div = document.createElement('div');
    div.className = 'msg ' + (role === 'user' ? 'msg-user' : 'msg-skip');
    if (role !== 'user') {
      var img = document.createElement('img');
      img.src = '/skip-avatar.webp';
      img.className = 'skip-avatar';
      img.alt = 'Skip';
      div.appendChild(img);
    }
    var b = document.createElement('div');
    b.className = 'msg-bubble';
    div.appendChild(b);
    transcriptEl.appendChild(div);
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
    return b;
  }

  function ensureCtx() {
    if (!audioCtx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function downsample(buffer, fromRate, toRate) {
    var ratio = fromRate / toRate;
    var len = Math.floor(buffer.length / ratio);
    var out = new Int16Array(len);
    for (var i = 0; i < len; i++) {
      var idx = i * ratio;
      var i0 = Math.floor(idx);
      var i1 = Math.min(i0 + 1, buffer.length - 1);
      var frac = idx - i0;
      var s = buffer[i0] * (1 - frac) + buffer[i1] * frac;
      s = Math.max(-1, Math.min(1, s));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  function b64encode(int16) {
    var bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
    var binary = '';
    var chunk = 32768;
    for (var i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  // Gapless scheduled playback: each chunk starts exactly when the
  // previous one ends, so Skip's voice doesn't drag or stutter.
  function queueAudio(b64) {
    var binary = atob(b64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    var int16 = new Int16Array(bytes.buffer);
    var f32 = new Float32Array(int16.length);
    for (var j = 0; j < int16.length; j++) f32[j] = int16[j] / 0x8000;
    playQueue.push(f32);
    pumpAudio();
  }

  function pumpAudio() {
    if (!playQueue.length) return;
    var ctx = ensureCtx();
    var now = ctx.currentTime;
    if (nextPlayTime < now) nextPlayTime = now + 0.06; // recover from starvation
    while (playQueue.length && nextPlayTime - now < 3) {
      var buf = playQueue.shift();
      var ab = ctx.createBuffer(1, buf.length, 24000);
      ab.getChannelData(0).set(buf);
      var src = ctx.createBufferSource();
      src.buffer = ab;
      src.connect(ctx.destination);
      src.onended = function () {
        for (var i = scheduledSources.length - 1; i >= 0; i--) {
          if (scheduledSources[i] === this) scheduledSources.splice(i, 1);
        }
      };
      try { src.start(nextPlayTime); } catch (e) { continue; }
      scheduledSources.push(src);
      nextPlayTime += buf.length / 24000;
    }
  }

  function stopPlayback() {
    playQueue = [];
    for (var i = 0; i < scheduledSources.length; i++) {
      try { scheduledSources[i].stop(); } catch (e) {}
    }
    scheduledSources = [];
    nextPlayTime = 0;
  }

  function startMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('This browser cannot access the mic — try Safari or Chrome.');
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .then(function (stream) {
        micStream = stream;
        var ctx = ensureCtx();
        micSource = ctx.createMediaStreamSource(stream);
        micProc = ctx.createScriptProcessor(2048, 1, 1);
        micProc.onaudioprocess = function (e) {
          if (!ws || ws.readyState !== 1) return;
          var input = e.inputBuffer.getChannelData(0);
          // Speech vs silence: used to flush end-of-turn pauses to Skip.
          var sum = 0;
          var n = 0;
          for (var k = 0; k < input.length; k += 4) { sum += input[k] * input[k]; n++; }
          if (n && Math.sqrt(sum / n) > 0.02) lastSpeechAt = Date.now();
          var pcm = downsample(input, ctx.sampleRate, 16000);
          if (pcm.length) {
            ws.send(JSON.stringify({ type: 'audio', data: b64encode(pcm) }));
            audioSentSinceEnd = true;
          }
        };
        var sink = ctx.createGain();
        sink.gain.value = 0; // keep the processor running without playing mic back
        micSource.connect(micProc);
        micProc.connect(sink);
        sink.connect(ctx.destination);
        // When the mic goes quiet ~0.8s after speech, flush so Skip replies.
        lastSpeechAt = Date.now();
        audioSentSinceEnd = false;
        if (silenceTimer) clearInterval(silenceTimer);
        silenceTimer = setInterval(function () {
          if (audioSentSinceEnd && ws && ws.readyState === 1 && Date.now() - lastSpeechAt > 800) {
            try { ws.send(JSON.stringify({ type: 'audioEnd' })); } catch (err) {}
            audioSentSinceEnd = false;
          }
        }, 200);
      })
      .catch(function () {
        setStatus('Mic blocked — allow microphone access and tap Start again.');
        startBtn.hidden = false;
        endBtn.hidden = true;
      });
  }

  function onServerMsg(ev) {
    var msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (msg.type === 'ready') {
      setStatus('You\u2019re live — just start talking.');
      var card = document.querySelector('.live-card');
      if (card) card.classList.add('live-on');
      startMic();
      endBtn.hidden = false;
    } else if (msg.type === 'audio') {
      queueAudio(msg.data);
    } else if (msg.type === 'transcript') {
      if (msg.role === 'user') {
        if (!userBubble) userBubble = addBubble('user');
        userBubble.textContent = msg.text;
      } else {
        if (!skipBubble) skipBubble = addBubble('skip');
        skipBubble.textContent = msg.text;
      }
    } else if (msg.type === 'turn') {
      userBubble = null;
      skipBubble = null;
    } else if (msg.type === 'interrupted') {
      stopPlayback();
      skipBubble = null;
      setStatus('You\u2019re live — just start talking.');
    } else if (msg.type === 'warning') {
      setStatus('Wrapping up ' + msg.timeLeft + ' — finish your thought.');
    } else if (msg.type === 'error') {
      setStatus(msg.message || 'Voice error — try again.');
    }
  }

  function startCall() {
    ensureCtx(); // unlock audio on the tap gesture (iOS)
    transcriptEl.innerHTML = '';
    userBubble = null;
    skipBubble = null;
    setStatus('Connecting\u2026');
    startBtn.hidden = true;
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(proto + '//' + location.host + '/live');
    ws.onopen = function () { setStatus('Connected — bringing Skip on the line\u2026'); };
    ws.onmessage = onServerMsg;
    ws.onclose = function (e) {
      if (e.code === 4429) setStatus('You\u2019ve hit today\u2019s chat limit — back tomorrow.');
      else if (e.code === 4401) setStatus('Please log in again to use live voice.');
      else setStatus('Call ended.');
      cleanup();
    };
    ws.onerror = function () { setStatus('Connection problem — check your signal and try again.'); };
  }

  function cleanup() {
    stopPlayback();
    var card = document.querySelector('.live-card');
    if (card) card.classList.remove('live-on');
    if (silenceTimer) { clearInterval(silenceTimer); silenceTimer = null; }
    if (micProc) { try { micProc.disconnect(); } catch (e) {} micProc = null; }
    if (micSource) { try { micSource.disconnect(); } catch (e) {} micSource = null; }
    if (micStream) { micStream.getTracks().forEach(function (t) { t.stop(); }); micStream = null; }
    startBtn.hidden = false;
    endBtn.hidden = true;
    userBubble = null;
    skipBubble = null;
  }

  function endCall() {
    if (ws) { try { ws.close(); } catch (e) {} ws = null; }
    cleanup();
    setStatus('Talk it out with Skip — live voice, like a phone call.');
  }

  startBtn.addEventListener('click', startCall);
  endBtn.addEventListener('click', endCall);
})();

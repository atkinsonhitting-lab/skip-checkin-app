// Live voice conversations with Skip.
//
// The browser opens a WebSocket to /live. This module proxies it to Google's
// Gemini Live API (server-side, so the API key never reaches the browser),
// relays PCM audio both ways, and saves both sides' transcripts to
// chat_messages so live conversations show up in the normal chat history.

const WebSocket = require('ws');

const LIVE_MODEL = process.env.LLM_LIVE_MODEL || 'gemini-3.1-flash-live-preview';
const LIVE_URL =
  process.env.LLM_LIVE_URL ||
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

function setupLive(server, db, opts) {
  const wss = new WebSocket.Server({ server, path: '/live' });

  wss.on('connection', (client, req) => {
    const sid = opts.getSessionId(req);
    if (!sid) {
      try {
        client.close(4401, 'unauthorized');
      } catch (e) {}
      return;
    }
    opts.sessionStore.get(sid, (err, sess) => {
      if (err || !sess || !sess.userId) {
        try {
          client.close(4401, 'unauthorized');
        } catch (e) {}
        return;
      }
      const user = db
        .prepare('SELECT id, email, role, athlete_name, first_name FROM users WHERE id = ?')
        .get(sess.userId);
      if (!user || user.role !== 'athlete') {
        try {
          client.close(4401, 'unauthorized');
        } catch (e) {}
        return;
      }
      if (!process.env.LLM_API_KEY) {
        try {
          client.close(4500, 'voice not configured');
        } catch (e) {}
        return;
      }
      if (opts.todayUserCount(user.id) >= opts.chatCap) {
        try {
          client.close(4429, 'daily limit reached');
        } catch (e) {}
        return;
      }
      handleSession(client, user, opts);
    });
  });

  return wss;
}

function send(client, obj) {
  if (client.readyState === WebSocket.OPEN) {
    try {
      client.send(JSON.stringify(obj));
    } catch (e) {}
  }
}

function handleSession(client, user, opts) {
  const apiKey = process.env.LLM_API_KEY;
  let google = null;
  let ready = false;
  let closed = false;
  let userText = '';
  let skipText = '';

  const closeBoth = () => {
    closed = true;
    try {
      if (google) google.close();
    } catch (e) {}
    try {
      client.close();
    } catch (e) {}
  };

  const finalizeTurn = () => {
    const u = userText.trim();
    const s = skipText.trim();
    if (u || s) {
      const now = new Date().toISOString();
      try {
        if (u) opts.saveMessage(user.id, 'user', u);
        if (s) opts.saveMessage(user.id, 'assistant', s);
      } catch (e) {
        console.error('live transcript save failed:', e.message);
      }
    }
    send(client, { type: 'turn', user: u, skip: s });
    userText = '';
    skipText = '';
  };

  try {
    google = new WebSocket(`${LIVE_URL}?key=${encodeURIComponent(apiKey)}`);
  } catch (e) {
    send(client, { type: 'error', message: 'Could not reach the voice service.' });
    closeBoth();
    return;
  }

  google.on('open', () => {
    const nameLine = user.first_name
      ? `The hitter you're talking to is named "${user.first_name}". Call them ${user.first_name} — use their first name naturally, the way a coach would.\n\n`
      : '';
    const systemText = `${opts.systemPrompt()}\n\n${nameLine}${opts.dataBlock(user.id)}\n\nYou are speaking LIVE with this hitter by voice. Keep every reply short and conversational — 1 to 3 sentences, like talking on the phone. No lists, no long breakdowns. If they need a drill or a plan, give one thing at a time and offer to go deeper. Speak fast and energetic, like a coach talking in the cage — quick natural pace, no slow dragging delivery, no long pauses between thoughts.`;
    google.send(
      JSON.stringify({
        setup: {
          model: `models/${LIVE_MODEL}`,
          systemInstruction: { parts: [{ text: systemText }] },
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Fenrir' } },
            },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      })
    );
  });

  google.on('message', (raw) => {
    if (closed) return;
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return;
    }
    // Surface Google's structured error payloads in the server log for diagnosis.
    if (msg.error) {
      googleDown(`error payload ${JSON.stringify(msg.error).slice(0, 200)}`);
      return;
    }
    if (msg.setupComplete) {
      ready = true;
      send(client, { type: 'ready' });
      return;
    }
    if (msg.goAway && msg.goAway.timeLeft) {
      send(client, { type: 'warning', timeLeft: msg.goAway.timeLeft });
      return;
    }
    const sc = msg.serverContent;
    if (!sc) return;

    // Audio chunks -> straight to the browser.
    const parts = (sc.modelTurn && sc.modelTurn.parts) || [];
    for (const p of parts) {
      if (p.inlineData && p.inlineData.data) {
        send(client, { type: 'audio', data: p.inlineData.data });
      }
    }
    // Transcripts (arrive independently of audio).
    if (sc.inputTranscription && sc.inputTranscription.text) {
      userText += sc.inputTranscription.text;
      send(client, { type: 'transcript', role: 'user', text: userText, partial: true });
    }
    if (sc.outputTranscription && sc.outputTranscription.text) {
      skipText += sc.outputTranscription.text;
      send(client, { type: 'transcript', role: 'skip', text: skipText, partial: true });
    }
    // Barge-in: user started talking over Skip — drop the partial reply.
    if (sc.interrupted) {
      skipText = '';
      send(client, { type: 'interrupted' });
      return;
    }
    if (sc.turnComplete) finalizeTurn();
  });

  const googleDown = (why) => {
    if (closed) return;
    console.error('live voice upstream closed:', why);
    send(client, { type: 'error', message: 'Lost connection to the voice service — try again.' });
    closeBoth();
  };
  google.on('close', (code, reason) => googleDown(`code ${code} ${reason || ''}`.trim()));
  google.on('error', (e) => googleDown(e.message));

  client.on('message', (raw) => {
    if (closed || !ready || !google || google.readyState !== WebSocket.OPEN) return;
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return;
    }
    if (msg.type === 'audio' && typeof msg.data === 'string' && msg.data.length) {
      try {
        google.send(
          JSON.stringify({
            realtimeInput: { audio: { data: msg.data, mimeType: 'audio/pcm;rate=16000' } },
          })
        );
      } catch (e) {}
      return;
    }
    // Explicit end-of-audio signal (flushes VAD-buffered audio server-side).
    if (msg.type === 'audioEnd') {
      try {
        google.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
      } catch (e) {}
      return;
    }
    if (msg.type === 'text' && typeof msg.data === 'string' && msg.data.trim()) {
      try {
        google.send(
          JSON.stringify({
            clientContent: {
              turns: [{ role: 'user', parts: [{ text: msg.data.trim().slice(0, 500) }] }],
              turnComplete: true,
            },
          })
        );
      } catch (e) {}
    }
  });

  client.on('close', () => {
    if (userText.trim() || skipText.trim()) finalizeTurn();
    closeBoth();
  });
  client.on('error', () => closeBoth());
}

module.exports = { setupLive };

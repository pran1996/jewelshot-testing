require('dotenv').config({ quiet: true });
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const PORT = process.env.PORT || 3456;

app.use(express.json({ limit: '50mb' }));

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('❌ GEMINI_API_KEY env var is required');
  console.error('Available env keys:', Object.keys(process.env).filter(k => !k.startsWith('npm_')).join(', '));
  process.exit(1);
}

// ── Simple Auth ─────────────────────────────────────────────────────
const AUTH_USER = process.env.AUTH_USER || 'pranshu';
const AUTH_PASS = process.env.AUTH_PASS || 'password';
const AUTH_COOKIE = 'sketch_auth';
const AUTH_TOKEN_TTL = 24 * 60 * 60 * 1000; // 24h
const authTokens = new Set();

function generateToken() {
  const token = crypto.randomBytes(32).toString('hex');
  authTokens.add(token);
  return token;
}

function isAuthed(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(new RegExp(`${AUTH_COOKIE}=([^;]+)`));
  return match && authTokens.has(match[1]);
}

// Login page
app.get('/login', (req, res) => {
  const error = req.query.error ? '<div style="color:#e55;margin-bottom:16px;font-size:13px;">Wrong username or password</div>' : '';
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Login — Sketch Studio</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0e1117;color:#e6edf3;font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:40px;width:340px;text-align:center}
h1{font-size:24px;margin-bottom:8px}p{color:#8b949e;font-size:13px;margin-bottom:24px}
input{width:100%;padding:10px 14px;background:#0d1117;border:1px solid #30363d;border-radius:8px;color:#e6edf3;font-size:14px;margin-bottom:12px;outline:none}
input:focus{border-color:#58a6ff}
button{width:100%;padding:10px;background:#238636;border:none;border-radius:8px;color:#fff;font-size:14px;font-weight:600;cursor:pointer}
button:hover{background:#2ea043}</style></head>
<body><div class="card"><h1>💎 Sketch Studio</h1><p>Enter credentials to continue</p>${error}
<form method="POST" action="/login"><input name="username" placeholder="Username" required autofocus><input name="password" type="password" placeholder="Password" required><button type="submit">Sign In</button></form></div></body></html>`);
});

app.post('/login', express.urlencoded({ extended: false }), (req, res) => {
  if (req.body.username === AUTH_USER && req.body.password === AUTH_PASS) {
    const token = generateToken();
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${AUTH_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${AUTH_TOKEN_TTL / 1000}${secure}`);
    return res.redirect('/');
  }
  res.redirect('/login?error=1');
});

// Auth middleware — protect everything except /login
app.use((req, res, next) => {
  if (req.path === '/login') return next();
  if (!isAuthed(req)) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized — please log in again' });
    return res.redirect('/login');
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));
const MODEL = 'gemini-3-pro-image-preview';

const ai = new GoogleGenAI({ apiKey: API_KEY });

const CONFIG = {
  temperature: 1.0,
  aspectRatio: '1:1',
  imageSize: '2K',
  requestTimeoutMs: 120000,
  maxConcurrent: 3,
  memoryLimitMB: 512,
  sessionTTL: 30 * 60 * 1000,  // 30 min
};

// ── Memory monitoring ───────────────────────────────────────────────
function getHeapMB() {
  return Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
}

function checkMemory() {
  const heapMB = getHeapMB();
  if (heapMB > CONFIG.memoryLimitMB) {
    console.warn(`[Memory] Heap ${heapMB}MB exceeds limit ${CONFIG.memoryLimitMB}MB — rejecting request`);
    return false;
  }
  return true;
}

function logMemory(label) {
  const mem = process.memoryUsage();
  console.log(`[Memory:${label}] heap=${Math.round(mem.heapUsed/1024/1024)}MB rss=${Math.round(mem.rss/1024/1024)}MB`);
}

// ── Concurrency limiter ─────────────────────────────────────────────
let _active = 0;
const _queue = [];

function acquireSlot() {
  if (_active < CONFIG.maxConcurrent) {
    _active++;
    return Promise.resolve();
  }
  return new Promise(resolve => _queue.push(resolve));
}

function releaseSlot() {
  if (_queue.length > 0) {
    const next = _queue.shift();
    next();
  } else {
    _active--;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────
function parseTemp(temperature) {
  if (temperature === undefined || temperature === null || temperature === '') return CONFIG.temperature;
  const val = parseFloat(temperature);
  return isNaN(val) ? CONFIG.temperature : val;
}

// ── Chat session store ──────────────────────────────────────────────
const chatSessions = new Map();

function createSession(temperature) {
  const sessionId = crypto.randomUUID();
  const chat = ai.chats.create({
    model: MODEL,
    config: {
      responseModalities: ['TEXT', 'IMAGE'],
      temperature: parseTemp(temperature),
      thinkingConfig: { includeThoughts: true },
      imageConfig: {
        aspectRatio: CONFIG.aspectRatio,
        imageSize: CONFIG.imageSize,
      },
    },
  });
  chatSessions.set(sessionId, { chat, lastAccess: Date.now(), turns: 0 });
  console.log(`[Session] Created ${sessionId.substring(0,8)}… (${chatSessions.size} active)`);
  return { sessionId, chat };
}

function getSession(sessionId) {
  const session = chatSessions.get(sessionId);
  if (!session) return null;
  session.lastAccess = Date.now();
  return session;
}

// Cleanup expired sessions every 5 min
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [id, session] of chatSessions) {
    if (now - session.lastAccess > CONFIG.sessionTTL) {
      chatSessions.delete(id);
      cleaned++;
    }
  }
  if (cleaned > 0) console.log(`[Session] Cleaned ${cleaned} expired (${chatSessions.size} active)`);
}, 5 * 60 * 1000);

// ── Memory guard middleware ──────────────────────────────────────────
function memoryGuard(req, res, next) {
  if (!checkMemory()) {
    return res.status(503).json({ error: 'Server under memory pressure. Try again shortly.' });
  }
  next();
}

// ── Extract results from response ───────────────────────────────────
function extractResults(response) {
  const parts = response.candidates?.[0]?.content?.parts || [];
  const usage = response.usageMetadata || {};
  const result = { images: [], text: '', usage };

  for (const part of parts) {
    if (part.inlineData) {
      result.images.push({
        mimeType: part.inlineData.mimeType,
        data: part.inlineData.data,
      });
    }
    if (part.text !== undefined && !part.thought) {
      result.text += part.text;
    }
  }
  return result;
}

// ══════════════════════════════════════════════════════════════════════
// CHAT ENDPOINT — handles both generation (no sessionId) and refinement
// ══════════════════════════════════════════════════════════════════════
app.post('/api/chat', memoryGuard, async (req, res) => {
  try {
    const { sessionId, prompt, imageBase64, mimeType, annotationBase64, temperature } = req.body;

    let chat, sid, session, isNew;

    if (sessionId) {
      // ── Refinement: existing session ──
      session = getSession(sessionId);
      if (!session) return res.status(404).json({ error: 'Session expired or not found' });
      chat = session.chat;
      sid = sessionId;
      isNew = false;
    } else {
      // ── First generation: new session ──
      if (!imageBase64 || !prompt) return res.status(400).json({ error: 'Missing image or prompt' });
      const created = createSession(temperature);
      chat = created.chat;
      sid = created.sessionId;
      session = getSession(sid);
      isNew = true;
    }

    // ── Build message parts ──
    const messageParts = [];

    if (prompt) {
      messageParts.push({ text: prompt });
    }

    // Sketch image (first generation only)
    if (imageBase64 && isNew) {
      messageParts.push({
        inlineData: { mimeType: mimeType || 'image/jpeg', data: imageBase64 },
      });
    }

    // Annotated image (refinement with annotation)
    if (annotationBase64 && !isNew) {
      messageParts.push({
        inlineData: { mimeType: 'image/png', data: annotationBase64 },
      });
    }

    if (messageParts.length === 0) {
      return res.status(400).json({ error: 'Empty message — provide prompt or annotation' });
    }

    // ── Per-message config override ──
    const msgConfig = {};
    const temp = parseTemp(temperature);
    if (temp !== CONFIG.temperature) {
      msgConfig.temperature = temp;
    }

    session.turns++;
    const turnLabel = isNew ? 'Generate' : `Refine #${session.turns - 1}`;
    console.log(`[${turnLabel}] session=${sid.substring(0,8)}… temp=${temp}, imageSize=${CONFIG.imageSize}, heap=${getHeapMB()}MB`);

    // ── Send message with concurrency + timeout + retry ──
    await acquireSlot();
    let response;
    try {
      response = await Promise.race([
        chat.sendMessage({
          message: messageParts.length === 1 && messageParts[0].text
            ? messageParts[0].text   // simple text for refinement
            : messageParts,          // array of parts for multimodal
          config: Object.keys(msgConfig).length > 0 ? msgConfig : undefined,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(Object.assign(new Error('Request timed out'), { status: 408 })),
            CONFIG.requestTimeoutMs)
        ),
      ]);
    } finally {
      releaseSlot();
      if (global.gc) global.gc();
    }

    // ── Extract and return results ──
    const result = extractResults(response);

    if (result.images.length === 0) {
      throw new Error(result.text || 'No image generated');
    }

    res.json({
      sessionId: sid,
      images: result.images,
      text: result.text,
      usage: result.usage,
      turn: session.turns,
    });

  } catch (err) {
    console.error('[Chat Error]', err.status || '', err.message);
    res.status(err.status || 500).json({ error: err.message, details: err.details });
  }
});

// ── Session info (debug) ────────────────────────────────────────────
app.get('/api/sessions', (req, res) => {
  const sessions = [];
  for (const [id, s] of chatSessions) {
    sessions.push({
      id: id.substring(0, 8) + '…',
      turns: s.turns,
      age: Math.round((Date.now() - s.lastAccess) / 1000) + 's ago',
    });
  }
  res.json({ count: chatSessions.size, sessions });
});

// ── Health / debug endpoint ──────────────────────────────────────────
const logBuffer = [];
const MAX_LOG_LINES = 200;
const origLog = console.log, origErr = console.error;
console.log = (...args) => { const line = args.map(String).join(' '); logBuffer.push({ t: Date.now(), l: 'info', m: line }); if (logBuffer.length > MAX_LOG_LINES) logBuffer.shift(); origLog(...args); };
console.error = (...args) => { const line = args.map(String).join(' '); logBuffer.push({ t: Date.now(), l: 'error', m: line }); if (logBuffer.length > MAX_LOG_LINES) logBuffer.shift(); origErr(...args); };

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.round(process.uptime()) + 's',
    memory: { heap: getHeapMB() + 'MB', rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB' },
    sessions: chatSessions.size,
  });
});

app.get('/api/logs', (req, res) => {
  const since = req.query.since ? parseInt(req.query.since) : 0;
  const lines = logBuffer.filter(l => l.t > since);
  res.json({ count: lines.length, logs: lines });
});

// ── Graceful shutdown ───────────────────────────────────────────────
let server;
function shutdown(signal) {
  console.log(`\n[${signal}] Shutting down… (clearing ${chatSessions.size} sessions)`);
  chatSessions.clear();
  if (server) server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Log memory every 30s
setInterval(() => logMemory('periodic'), 30000);

server = app.listen(PORT, () => {
  console.log(`\n🚀 Jewelry Sketch Studio running at http://localhost:${PORT}`);
  console.log(`   Model: ${MODEL} | Concurrency: ${CONFIG.maxConcurrent} | Image: ${CONFIG.imageSize} | Memory limit: ${CONFIG.memoryLimitMB}MB\n`);
  logMemory('startup');
});

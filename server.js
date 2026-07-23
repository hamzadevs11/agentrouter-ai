/**
 * AgentRouter Chat — backend
 * ---------------------------------------------------------------
 * A thin proxy between the browser and https://agentrouter.org/v1.
 *
 * Why a proxy instead of calling AgentRouter straight from the browser?
 *   1. CORS: AgentRouter is built for server-side / CLI use (Claude Code,
 *      SDKs, etc). There's no guarantee it sends the headers a browser
 *      needs to allow a direct cross-origin fetch() call.
 *   2. Security: your AgentRouter key never has to be visible in a public
 *      network request to a third-party domain — the browser only ever
 *      talks to this local server.
 *   3. It gives us one place to turn AgentRouter's raw errors (including
 *      any WAF/verification-page responses) into a message that actually
 *      explains what happened.
 */

require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const AGENTROUTER_BASE = 'https://agentrouter.org/v1';
const SERVER_DEFAULT_KEY = (process.env.AGENTROUTER_API_KEY || '').trim();

app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/**
 * The API key can come from two places:
 *  - the browser (Settings screen -> stored in localStorage -> sent as
 *    the x-api-key header on every request). This is the normal path.
 *  - a AGENTROUTER_API_KEY value in .env, used as a fallback default so
 *    a single self-hoster doesn't have to paste the key into the UI.
 * A key typed in the browser always wins over the .env default.
 */
function resolveApiKey(req) {
  const fromBrowser = (req.get('x-api-key') || '').trim();
  return fromBrowser || SERVER_DEFAULT_KEY;
}

// Used only if AgentRouter's own GET /v1/models can't be reached right
// now (offline, key not entered yet, temporary upstream issue). The UI
// always also offers a free-text "custom model id" field, so a stale
// entry here can never block anyone from using the model they want.
const FALLBACK_MODELS = [
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  { id: 'gpt-5', label: 'GPT-5' },
  { id: 'gpt-5-mini', label: 'GPT-5 Mini' },
  { id: 'deepseek-v4', label: 'DeepSeek V4' },
  { id: 'glm-4.6', label: 'GLM-4.6' },
];

function familyOf(modelId = '') {
  const id = modelId.toLowerCase();
  if (id.includes('claude')) return 'claude';
  if (id.includes('gpt') || id.includes('o1') || id.includes('o3') || id.includes('o4')) return 'gpt';
  if (id.includes('deepseek')) return 'deepseek';
  if (id.includes('glm') || id.includes('zhipu')) return 'glm';
  if (id.includes('gemini')) return 'gemini';
  if (id.includes('qwen')) return 'qwen';
  return 'other';
}

// --- GET /api/models --------------------------------------------------
app.get('/api/models', async (req, res) => {
  const apiKey = resolveApiKey(req);

  if (!apiKey) {
    return res.json({
      models: FALLBACK_MODELS.map(m => ({ ...m, family: familyOf(m.id) })),
      source: 'fallback',
      note: 'No API key saved yet — showing a starter list. Add your key in Settings.',
    });
  }

  try {
    const upstream = await fetch(`${AGENTROUTER_BASE}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        'User-Agent': 'AgentRouterChat/1.0 (+local)',
      },
    });

    const contentType = upstream.headers.get('content-type') || '';
    if (!upstream.ok || !contentType.includes('application/json')) {
      throw new Error(`upstream status ${upstream.status}`);
    }

    const data = await upstream.json();
    const list = Array.isArray(data.data) ? data.data : [];
    if (!list.length) throw new Error('empty model list from upstream');

    const models = list
      .map(m => ({ id: m.id, label: m.id, family: familyOf(m.id) }))
      .sort((a, b) => a.id.localeCompare(b.id));

    res.json({ models, source: 'live' });
  } catch (err) {
    res.json({
      models: FALLBACK_MODELS.map(m => ({ ...m, family: familyOf(m.id) })),
      source: 'fallback',
      note: `Couldn't load the live model list (${err.message}). Showing a starter list instead — you can still type any model id by hand.`,
    });
  }
});

// --- POST /api/chat ------------------------------------------------------
app.post('/api/chat', async (req, res) => {
  const apiKey = resolveApiKey(req);
  if (!apiKey) {
    return res.status(401).json({ error: 'No API key set. Open Settings and paste your AgentRouter key first.' });
  }

  const { messages, model, temperature, max_tokens, system } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  const finalMessages = system && system.trim()
    ? [{ role: 'system', content: system.trim() }, ...messages]
    : messages;

  const payload = {
    model: model || 'claude-sonnet-4-5-20250929',
    messages: finalMessages,
    stream: true,
    temperature: typeof temperature === 'number' ? temperature : 0.7,
    max_tokens: typeof max_tokens === 'number' ? max_tokens : 4096,
  };

  let upstream;
  try {
    upstream = await fetch(`${AGENTROUTER_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        Accept: 'text/event-stream',
        'User-Agent': 'AgentRouterChat/1.0 (+local)',
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return res.status(502).json({ error: `Could not reach agentrouter.org: ${err.message}` });
  }

  const contentType = upstream.headers.get('content-type') || '';

  // Case 1 — a genuine SSE stream and a healthy response: pipe it straight through.
  if (upstream.ok && contentType.includes('event-stream')) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    req.on('close', () => {
      try { upstream.body.cancel(); } catch { /* already closed */ }
    });

    try {
      for await (const chunk of upstream.body) {
        res.write(chunk);
      }
    } catch {
      // Client disconnected mid-stream or upstream dropped — nothing else to do.
    }
    return res.end();
  }

  // Case 2 — request succeeded but the provider ignored stream:true and sent a
  // normal chat.completion object instead (some models/providers do this).
  // Repackage it as a single SSE chunk so the browser only needs one parser.
  if (upstream.ok && contentType.includes('application/json')) {
    let json;
    try {
      json = await upstream.json();
    } catch (err) {
      return res.status(502).json({ error: `Could not parse AgentRouter's response: ${err.message}` });
    }
    const content = (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || '';
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
    res.write('data: [DONE]\n\n');
    return res.end();
  }

  // Case 3 — something went wrong. Try to surface a clear reason, including
  // the AgentRouter/Aliyun WAF verification page some requests can hit.
  let bodyText = '';
  try {
    bodyText = await upstream.text();
  } catch { /* ignore */ }

  const looksLikeHtml = bodyText.trim().startsWith('<');
  let message;
  if (looksLikeHtml) {
    message = `AgentRouter returned an HTML/verification page instead of JSON (HTTP ${upstream.status}). This usually means a WAF challenge or rate limit on their side. Verify your key works with the curl command in the README, and check https://agentrouter.org/console/token`;
  } else if (contentType.includes('application/json')) {
    try {
      const parsed = JSON.parse(bodyText);
      message = (parsed.error && (parsed.error.message || parsed.error)) || parsed.message || JSON.stringify(parsed);
    } catch {
      message = bodyText || `HTTP ${upstream.status}`;
    }
  } else {
    message = bodyText || `HTTP ${upstream.status}`;
  }
  return res.status(upstream.status || 502).json({ error: message });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, hasServerKey: Boolean(SERVER_DEFAULT_KEY) });
});

app.listen(PORT, () => {
  console.log(`\n  AgentRouter Chat running → http://localhost:${PORT}\n`);
});

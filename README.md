# AgentRouter Chat

A self-hosted, Claude/ChatGPT-style chat web app powered by your own **[AgentRouter](https://agentrouter.org)** API key. One chat box, routed across Claude, GPT, DeepSeek, and GLM — good for coding questions and everyday chat alike.

**Quick start (Roman Urdu):** Terminal mein `npm install` phir `npm start` chalayein, browser mein `http://localhost:3000` kholein, upar-right "Settings" se apni AgentRouter API key paste karein (key `agentrouter.org/console/token` se milti hai), aur chat shuru karein. Poori detail neeche.

---

## What this is

- A small **Node.js/Express server** (`server.js`) that proxies chat requests to `https://agentrouter.org/v1`, so your API key never has to leave your own machine in a browser network request, and so the browser never needs AgentRouter to support cross-origin requests.
- A **plain HTML/CSS/JS frontend** (`public/`) — no build step, no framework — styled to feel like Claude.ai / ChatGPT: sidebar with conversation history, streaming replies, markdown + syntax-highlighted code blocks with copy buttons, a model picker, and a settings panel.
- Every reply is tagged with a small coloured dot for the model family that answered (Claude / GPT / DeepSeek / GLM / etc.) — since the whole point of AgentRouter is routing between them, the UI shows you that routing happening.

## Requirements

- [Node.js](https://nodejs.org) 18 or newer (check with `node -v`)
- An AgentRouter API key — get one free at **https://agentrouter.org** (sign up, then grab a key from `agentrouter.org/console/token`). New accounts get free credits to start with.

## Setup

```bash
npm install
npm start
```

Then open **http://localhost:3000**.

On first run, open **Settings** (bottom of the sidebar) and paste your AgentRouter API key. It's saved in your browser's local storage and sent only to this local server — the server then attaches it to requests it makes to agentrouter.org on your behalf.

If you'd rather not paste the key into the UI (e.g. you're the only user of this machine), copy `.env.example` to `.env` and set `AGENTROUTER_API_KEY=sk-...` there instead — the server will use it as a default whenever the browser hasn't saved its own key.

## Features

- **Multiple conversations** — saved locally in your browser, rename happens automatically from your first message, delete individual chats or clear everything from Settings.
- **Live model list** — on load, the app asks AgentRouter which models your key can currently use (`GET /v1/models`) and populates the picker from that, grouped by family. If that call fails for any reason, it falls back to a small starter list, and you can always type any exact model id by hand in the picker's "custom model id" box.
- **Streaming replies** with a stop button, markdown rendering, and syntax-highlighted code blocks (each with its own copy button).
- **Regenerate** the last reply, **copy** any message.
- **System prompt** and **temperature** controls in Settings.
- **Dark / light theme** toggle.
- Responsive layout — usable on a phone-width screen too.

## Project structure

```
agentrouter-chat/
├── server.js           Express server + proxy to agentrouter.org
├── package.json
├── .env.example         Optional server-side default API key
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js            All frontend logic (vanilla JS, no build step)
└── README.md
```

## Why a backend proxy instead of calling AgentRouter directly from the browser?

Three reasons, in order of importance:

1. **CORS.** AgentRouter is built primarily for server-side and CLI use (Claude Code, SDKs, etc.); there's no guarantee it sends the headers a browser requires to allow a direct `fetch()` from a webpage on a different origin. Routing through your own server sidesteps that entirely.
2. **Your key stays local.** It only ever travels from your browser to your own machine, and from your own machine to AgentRouter — never to any other third party.
3. **Clearer errors.** AgentRouter sits behind a WAF (bot-verification layer). Occasionally a request can come back as an HTML "please verify" page instead of JSON — see Troubleshooting below. The proxy detects this and turns it into a readable message instead of a silent failure or a wall of HTML in the UI.

## Troubleshooting

**"AgentRouter returned an HTML/verification page..."**
AgentRouter runs behind a WAF (Alibaba Cloud), and it occasionally challenges requests instead of answering them — this is a limitation of the free gateway itself, not this app. First, confirm your key works at all with a direct request:

```bash
curl https://agentrouter.org/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_KEY_HERE" \
  -d '{"model":"claude-sonnet-4-5-20250929","messages":[{"role":"user","content":"say hi"}],"max_tokens":50}'
```

If that also fails or hangs, the issue is on AgentRouter's side (rate limiting, WAF, or an outage) — check **https://agentrouter.org/console/token** for your key/credit status, or try again after a bit.

**401 / "invalid api key" / "UNAUTHENTICATED"**
Double-check the key was copied in full from `agentrouter.org/console/token`, with no extra spaces, and that you clicked **Save** in Settings.

**A model I want isn't in the dropdown**
Model lineups change. Use the "custom model id" field at the bottom of the model picker (or in Settings) and type the exact id — AgentRouter's site lists current model ids.

**Nothing happens when I click a chat / send a message**
Open your browser's console (F12) — the app logs a message there if the markdown library or highlighter failed to load from the CDN (this needs internet access to `cdnjs.cloudflare.com`). Everything else runs locally.

## Notes on scope

- This is built for **personal, local use**. If you expose this server beyond `localhost` (e.g. deploy it publicly), anyone who can reach it can spend your AgentRouter credits — put it behind your own authentication first.
- AgentRouter itself is a third-party, community-run gateway (not an Anthropic or OpenAI product) — treat its uptime and pricing as you would any other external API you don't control. Check current pricing/terms at agentrouter.org before heavy use.
- Default `max_tokens` per reply is 4096 and lives in `server.js` (`payload.max_tokens`) if you want to change it.

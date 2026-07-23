/**
 * AgentRouter Chat — frontend
 * Vanilla JS, no build step. Talks only to our own /api/* endpoints
 * (server.js proxies to agentrouter.org so the browser never has to
 * make a cross-origin call or hold the key in a request to a third party).
 */
(() => {
  'use strict';

  // ------------------------------------------------------------------
  // Constants
  // ------------------------------------------------------------------
  const LS_CHATS = 'agentrouter-chat:chats';
  const LS_SETTINGS = 'agentrouter-chat:settings';
  const FAMILY_ORDER = ['claude', 'gpt', 'gemini', 'deepseek', 'glm', 'qwen', 'other'];
  const FAMILY_LABEL = {
    claude: 'Claude', gpt: 'GPT', gemini: 'Gemini',
    deepseek: 'DeepSeek', glm: 'GLM', qwen: 'Qwen', other: 'Other',
  };
  const MOBILE_QUERY = '(max-width: 860px)';

  const ICONS = {
    copy: '<svg viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M5 15V5a2 2 0 012-2h10" stroke="currentColor" stroke-width="1.6"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none"><path d="M20 11A8 8 0 105.5 16.5M20 11V5M20 11h-6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    delete: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-8 0v12a1 1 0 001 1h6a1 1 0 001-1V7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  // ------------------------------------------------------------------
  // DOM refs
  // ------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const dom = {
    app: $('app'),
    sidebar: $('sidebar'),
    sidebarScrim: $('sidebarScrim'),
    collapseSidebarBtn: $('collapseSidebarBtn'),
    openSidebarBtn: $('openSidebarBtn'),
    newChatBtn: $('newChatBtn'),
    chatList: $('chatList'),
    keyStatus: $('keyStatus'),
    keyStatusText: $('keyStatusText'),
    settingsBtn: $('settingsBtn'),
    modelPicker: $('modelPicker'),
    modelPickerBtn: $('modelPickerBtn'),
    modelPickerLabel: $('modelPickerLabel'),
    modelDot: $('modelDot'),
    modelDropdown: $('modelDropdown'),
    themeToggleBtn: $('themeToggleBtn'),
    chatScroll: $('chatScroll'),
    emptyState: $('emptyState'),
    suggestionGrid: $('suggestionGrid'),
    messages: $('messages'),
    composerForm: $('composerForm'),
    promptInput: $('promptInput'),
    sendBtn: $('sendBtn'),
    stopBtn: $('stopBtn'),
    settingsBackdrop: $('settingsBackdrop'),
    closeSettingsBtn: $('closeSettingsBtn'),
    apiKeyInput: $('apiKeyInput'),
    toggleKeyVisibility: $('toggleKeyVisibility'),
    customModelInput: $('customModelInput'),
    systemPromptInput: $('systemPromptInput'),
    temperatureInput: $('temperatureInput'),
    tempValue: $('tempValue'),
    clearAllBtn: $('clearAllBtn'),
    saveSettingsBtn: $('saveSettingsBtn'),
    toast: $('toast'),
  };

  // ------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------
  let chats = loadChats();
  let settings = loadSettings();
  let activeChatId = chats.length ? chats[0].id : null;
  let models = [];
  let modelsSource = 'fallback';
  let modelsNote = '';
  let extraModelIds = new Set(settings.customModels || []);
  let currentAbort = null;
  let isStreaming = false;
  let toastTimer = null;

  // ------------------------------------------------------------------
  // Markdown setup (defensive — app must not die if the CDN is unreachable)
  // ------------------------------------------------------------------
  try {
    if (typeof marked !== 'undefined' && marked.Renderer) {
      const renderer = new marked.Renderer();
      // Raw HTML tokens (a model echoing a literal <tag>) are escaped instead
      // of injected — this is the main XSS guard, see sanitizeNode() for the
      // second layer.
      renderer.html = (html) => escapeHtml(typeof html === 'string' ? html : (html && html.text) || '');
      marked.setOptions({ renderer, breaks: true, gfm: true });
    }
  } catch (err) {
    console.warn('markdown renderer setup failed, falling back to plain text', err);
  }

  // ------------------------------------------------------------------
  // Persistence
  // ------------------------------------------------------------------
  function loadChats() {
    try {
      const raw = localStorage.getItem(LS_CHATS);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  function saveChats() {
    try { localStorage.setItem(LS_CHATS, JSON.stringify(chats)); }
    catch (err) { console.warn('could not save chats', err); }
  }
  function loadSettings() {
    const defaults = {
      apiKey: '', systemPrompt: '', temperature: 0.7,
      customModels: [], theme: 'dark', defaultModel: null,
    };
    try {
      const raw = localStorage.getItem(LS_SETTINGS);
      return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
    } catch {
      return defaults;
    }
  }
  function saveSettings() {
    try { localStorage.setItem(LS_SETTINGS, JSON.stringify(settings)); }
    catch (err) { console.warn('could not save settings', err); }
  }

  // ------------------------------------------------------------------
  // Small utilities
  // ------------------------------------------------------------------
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function familyOf(id) {
    const s = String(id || '').toLowerCase();
    if (s.includes('claude')) return 'claude';
    if (s.includes('gpt') || /(^|[^a-z])o[134](\D|$)/.test(s)) return 'gpt';
    if (s.includes('deepseek')) return 'deepseek';
    if (s.includes('glm') || s.includes('zhipu')) return 'glm';
    if (s.includes('gemini')) return 'gemini';
    if (s.includes('qwen')) return 'qwen';
    return 'other';
  }
  function familyColor(family) { return `var(--family-${family || 'other'})`; }

  function truncateTitle(text) {
    const clean = String(text).replace(/\s+/g, ' ').trim();
    if (clean.length <= 46) return clean || 'New chat';
    return clean.slice(0, 46).replace(/\s+\S*$/, '') + '…';
  }

  function showToast(msg) {
    dom.toast.textContent = msg;
    dom.toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => dom.toast.classList.add('hidden'), 2600);
  }

  function isNearBottom() {
    const el = dom.chatScroll;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 140;
  }
  function scrollToBottom(smooth) {
    dom.chatScroll.scrollTo({ top: dom.chatScroll.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }

  function getActiveChat() { return chats.find((c) => c.id === activeChatId) || null; }

  function getModelForChat(chat) {
    return (chat && chat.model) || settings.defaultModel || (models[0] && models[0].id) || 'claude-sonnet-4-5-20250929';
  }

  // ------------------------------------------------------------------
  // Sanitizing rendered markdown (defense in depth beyond the renderer.html
  // override above — strips any tag/attribute that could execute script,
  // in case a raw tag slips through as inline text the lexer didn't flag).
  // ------------------------------------------------------------------
  const BLOCKED_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'FORM']);
  function sanitizeNode(root) {
    const toRemove = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
    let node = walker.nextNode();
    while (node) {
      if (BLOCKED_TAGS.has(node.tagName)) {
        toRemove.push(node);
      } else {
        [...node.attributes].forEach((attr) => {
          const name = attr.name.toLowerCase();
          const value = attr.value || '';
          if (name.startsWith('on')) node.removeAttribute(attr.name);
          if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(value)) node.removeAttribute(attr.name);
        });
        if (node.tagName === 'A') {
          node.setAttribute('target', '_blank');
          node.setAttribute('rel', 'noopener noreferrer');
        }
      }
      node = walker.nextNode();
    }
    toRemove.forEach((n) => n.remove());
  }

  function safeMarkedParse(text) {
    try {
      if (typeof marked !== 'undefined' && typeof marked.parse === 'function') {
        return marked.parse(text || '');
      }
    } catch (err) {
      console.warn('markdown parse failed', err);
    }
    return `<p>${escapeHtml(text || '').replace(/\n/g, '<br>')}</p>`;
  }

  function renderMarkdownInto(container, rawText) {
    container.innerHTML = safeMarkedParse(rawText);
    sanitizeNode(container);
  }

  function enhanceCodeBlocks(container) {
    container.querySelectorAll('pre').forEach((pre) => {
      if (pre.closest('.code-block')) return;
      const codeEl = pre.querySelector('code');
      if (!codeEl) return;

      const langMatch = (codeEl.className || '').match(/language-([\w+-]+)/);
      const lang = langMatch ? langMatch[1] : '';

      try { hljs.highlightElement(codeEl); } catch { /* hljs unavailable or unknown lang, leave plain */ }

      const wrapDiv = document.createElement('div');
      wrapDiv.className = 'code-block';
      const header = document.createElement('div');
      header.className = 'code-block-header';
      const langLabel = document.createElement('span');
      langLabel.textContent = lang || 'text';
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'code-copy-btn';
      copyBtn.innerHTML = `${ICONS.copy}<span>Copy</span>`;
      copyBtn.addEventListener('click', () => copyText(codeEl.textContent, copyBtn));
      header.append(langLabel, copyBtn);

      pre.parentNode.insertBefore(wrapDiv, pre);
      wrapDiv.append(header, pre);
    });
  }

  function copyText(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
      const original = btn.innerHTML;
      btn.innerHTML = `${ICONS.check}<span>Copied</span>`;
      setTimeout(() => { btn.innerHTML = original; }, 1400);
    }).catch(() => showToast('Could not copy — check clipboard permissions'));
  }

  // ------------------------------------------------------------------
  // Message rendering
  // ------------------------------------------------------------------
  function renderMessageNode(msg, opts = {}) {
    const wrap = document.createElement('div');
    wrap.className = `msg msg-${msg.role}`;
    wrap.dataset.msgId = msg.id;

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    if (msg.role === 'assistant') {
      const dot = document.createElement('span');
      dot.className = 'model-dot';
      dot.style.background = familyColor(msg.family);
      avatar.appendChild(dot);
    } else {
      avatar.textContent = 'You';
    }

    const body = document.createElement('div');
    body.className = 'msg-body';

    if (msg.role === 'assistant') {
      const meta = document.createElement('div');
      meta.className = 'msg-meta';
      const metaDot = document.createElement('span');
      metaDot.className = 'model-dot';
      metaDot.style.background = familyColor(msg.family);
      const metaLabel = document.createElement('span');
      metaLabel.textContent = msg.model || 'assistant';
      meta.append(metaDot, metaLabel);
      body.appendChild(meta);
    }

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';

    if (msg.role === 'user') {
      bubble.textContent = msg.content;
    } else if (msg.error) {
      bubble.innerHTML = `<div class="msg-error"><strong>Couldn't get a reply.</strong><br>${escapeHtml(msg.content)}</div>`;
    } else if (opts.streaming && !msg.content) {
      bubble.innerHTML = '<div class="thinking-dots"><span></span><span></span><span></span></div>';
    } else {
      renderMarkdownInto(bubble, msg.content);
      enhanceCodeBlocks(bubble);
    }

    body.appendChild(bubble);
    if (msg.role === 'assistant' && !opts.streaming && !msg.error) {
      body.appendChild(buildMessageActions(msg));
    }

    wrap.append(avatar, body);
    return wrap;
  }

  function buildMessageActions(msg) {
    const box = document.createElement('div');
    box.className = 'msg-actions';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'msg-action-btn';
    copyBtn.innerHTML = `${ICONS.copy}<span>Copy</span>`;
    copyBtn.addEventListener('click', () => copyText(msg.content, copyBtn));
    box.appendChild(copyBtn);

    const chat = getActiveChat();
    const isLast = chat && chat.messages.length && chat.messages[chat.messages.length - 1].id === msg.id;
    if (isLast) {
      const regenBtn = document.createElement('button');
      regenBtn.type = 'button';
      regenBtn.className = 'msg-action-btn regen-action';
      regenBtn.innerHTML = `${ICONS.refresh}<span>Regenerate</span>`;
      regenBtn.addEventListener('click', regenerateLast);
      box.appendChild(regenBtn);
    }
    return box;
  }

  function renderActiveChat() {
    const chat = getActiveChat();
    dom.messages.innerHTML = '';
    if (!chat || chat.messages.length === 0) {
      dom.emptyState.classList.remove('hidden');
      dom.messages.classList.add('hidden');
    } else {
      dom.emptyState.classList.add('hidden');
      dom.messages.classList.remove('hidden');
      const frag = document.createDocumentFragment();
      chat.messages.forEach((m) => frag.appendChild(renderMessageNode(m, {})));
      dom.messages.appendChild(frag);
    }
    updateModelPickerLabel();
    scrollToBottom(false);
  }

  // ------------------------------------------------------------------
  // Chat CRUD
  // ------------------------------------------------------------------
  function createChatObject() {
    return { id: uid(), title: 'New chat', model: settings.defaultModel || null, createdAt: Date.now(), messages: [] };
  }

  function startNewChat() {
    if (isStreaming) stopStreaming();
    const chat = createChatObject();
    chats.unshift(chat);
    activeChatId = chat.id;
    saveChats();
    renderChatList();
    renderActiveChat();
    closeMobileSidebar();
    dom.promptInput.focus();
  }

  function switchChat(id) {
    if (id === activeChatId) { closeMobileSidebar(); return; }
    if (isStreaming) stopStreaming();
    activeChatId = id;
    renderChatList();
    renderActiveChat();
    closeMobileSidebar();
  }

  function deleteChat(id, evt) {
    if (evt) evt.stopPropagation();
    const idx = chats.findIndex((c) => c.id === id);
    if (idx === -1) return;
    const wasActive = id === activeChatId;
    if (wasActive && isStreaming) stopStreaming();
    chats.splice(idx, 1);
    saveChats();
    if (wasActive) {
      activeChatId = chats.length ? chats[0].id : null;
      renderActiveChat();
    }
    renderChatList();
  }

  function renderChatList() {
    dom.chatList.innerHTML = '';
    if (!chats.length) {
      const empty = document.createElement('div');
      empty.className = 'chat-list-empty';
      empty.textContent = 'No conversations yet — start one above.';
      dom.chatList.appendChild(empty);
      return;
    }
    const frag = document.createDocumentFragment();
    chats.forEach((chat) => {
      const item = document.createElement('div');
      item.className = 'chat-item' + (chat.id === activeChatId ? ' active' : '');
      item.setAttribute('role', 'button');
      item.tabIndex = 0;

      const lastAssistant = [...chat.messages].reverse().find((m) => m.role === 'assistant' && !m.error);
      const dot = document.createElement('span');
      dot.className = 'chat-item-dot';
      dot.style.background = familyColor(lastAssistant ? lastAssistant.family : 'other');

      const title = document.createElement('span');
      title.className = 'chat-item-title';
      title.textContent = chat.title || 'New chat';

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'chat-item-delete';
      del.innerHTML = ICONS.delete;
      del.setAttribute('aria-label', 'Delete conversation');
      del.addEventListener('click', (e) => deleteChat(chat.id, e));

      item.append(dot, title, del);
      item.addEventListener('click', () => switchChat(chat.id));
      item.addEventListener('keydown', (e) => { if (e.key === 'Enter') switchChat(chat.id); });
      frag.appendChild(item);
    });
    dom.chatList.appendChild(frag);
  }

  // ------------------------------------------------------------------
  // Sending messages / streaming
  // ------------------------------------------------------------------
  function sendMessage(rawText) {
    const text = String(rawText == null ? dom.promptInput.value : rawText).trim();
    if (!text || isStreaming) return;

    let chat = getActiveChat();
    const isNewChat = !chat;
    if (!chat) {
      chat = createChatObject();
      chats.unshift(chat);
      activeChatId = chat.id;
    }

    const userMsg = { id: uid(), role: 'user', content: text };
    chat.messages.push(userMsg);
    if (!chat.title || chat.title === 'New chat') chat.title = truncateTitle(text);

    dom.promptInput.value = '';
    autoResizeTextarea();

    if (isNewChat) {
      renderActiveChat();
    } else {
      dom.emptyState.classList.add('hidden');
      dom.messages.classList.remove('hidden');
      dom.messages.appendChild(renderMessageNode(userMsg, {}));
      scrollToBottom(true);
    }
    renderChatList();
    saveChats();
    runAssistantTurn(chat);
  }

  function runAssistantTurn(chat) {
    const payloadMessages = chat.messages
      .filter((m) => !m.error)
      .map((m) => ({ role: m.role, content: m.content }));

    // Whichever message previously held the Regenerate button is no longer
    // the last one — drop it now rather than leaving a stale action behind.
    dom.messages.querySelectorAll('.regen-action').forEach((el) => el.remove());

    const model = getModelForChat(chat);
    const assistantMsg = { id: uid(), role: 'assistant', content: '', model, family: familyOf(model) };
    chat.messages.push(assistantMsg);

    const node = renderMessageNode(assistantMsg, { streaming: true });
    dom.emptyState.classList.add('hidden');
    dom.messages.classList.remove('hidden');
    dom.messages.appendChild(node);
    scrollToBottom(true);

    streamInto(chat, assistantMsg, node, payloadMessages);
  }

  function regenerateLast() {
    if (isStreaming) return;
    const chat = getActiveChat();
    if (!chat || !chat.messages.length) return;
    const last = chat.messages[chat.messages.length - 1];
    if (last.role !== 'assistant') return;
    chat.messages.pop();
    const node = dom.messages.querySelector(`[data-msg-id="${last.id}"]`);
    if (node) node.remove();
    runAssistantTurn(chat);
  }

  function stopStreaming() {
    if (currentAbort) currentAbort.abort();
  }

  function updateComposerStreamingUI(active) {
    dom.sendBtn.classList.toggle('hidden', active);
    dom.stopBtn.classList.toggle('hidden', !active);
  }

  async function streamInto(chat, assistantMsg, msgNode, payloadMessages) {
    isStreaming = true;
    updateComposerStreamingUI(true);
    const bubbleEl = msgNode.querySelector('.msg-bubble');

    let accumulated = '';
    let renderScheduled = false;

    function paint(withCursor) {
      const near = isNearBottom();
      renderMarkdownInto(bubbleEl, accumulated);
      if (withCursor) {
        const cursor = document.createElement('span');
        cursor.className = 'streaming-cursor';
        bubbleEl.appendChild(cursor);
      }
      enhanceCodeBlocks(bubbleEl);
      if (near) scrollToBottom(false);
    }

    function scheduleRender() {
      if (renderScheduled) return;
      renderScheduled = true;
      requestAnimationFrame(() => { renderScheduled = false; paint(true); });
    }

    currentAbort = new AbortController();

    try {
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': settings.apiKey || '' },
        body: JSON.stringify({
          messages: payloadMessages,
          model: assistantMsg.model,
          temperature: settings.temperature,
          system: settings.systemPrompt,
        }),
        signal: currentAbort.signal,
      });

      if (!resp.ok) {
        let errMsg = `HTTP ${resp.status}`;
        try { const j = await resp.json(); errMsg = j.error || errMsg; } catch { /* body wasn't JSON */ }
        throw new Error(errMsg);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const evt of events) {
          for (const line of evt.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const data = trimmed.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta
                ? parsed.choices[0].delta.content : null;
              if (delta) { accumulated += delta; scheduleRender(); }
            } catch { /* partial/malformed SSE fragment, skip */ }
          }
        }
      }

      assistantMsg.content = accumulated;
      if (!accumulated.trim()) {
        assistantMsg.error = true;
        assistantMsg.content = 'The model returned an empty response. Try again, or switch models from the picker above.';
        renderErrorInPlace(bubbleEl, assistantMsg.content);
      } else {
        paint(false);
      }
    } catch (err) {
      if (err && err.name === 'AbortError') {
        assistantMsg.content = accumulated;
        paint(false);
      } else if (accumulated) {
        assistantMsg.content = accumulated;
        paint(false);
        showToast(`Stream interrupted: ${err.message}`);
      } else {
        assistantMsg.error = true;
        assistantMsg.content = (err && err.message) || 'Something went wrong talking to AgentRouter.';
        renderErrorInPlace(bubbleEl, assistantMsg.content);
      }
    } finally {
      isStreaming = false;
      currentAbort = null;
      updateComposerStreamingUI(false);
      const body = msgNode.querySelector('.msg-body');
      const existingActions = body.querySelector('.msg-actions');
      if (existingActions) existingActions.remove();
      if (!assistantMsg.error) body.appendChild(buildMessageActions(assistantMsg));
      saveChats();
      renderChatList();
    }
  }

  function renderErrorInPlace(bubbleEl, message) {
    bubbleEl.innerHTML = `<div class="msg-error"><strong>Couldn't get a reply.</strong><br>${escapeHtml(message)}</div>`;
  }

  // ------------------------------------------------------------------
  // Composer
  // ------------------------------------------------------------------
  function autoResizeTextarea() {
    const ta = dom.promptInput;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }

  // ------------------------------------------------------------------
  // Model picker
  // ------------------------------------------------------------------
  async function loadModels() {
    try {
      const resp = await fetch('/api/models', { headers: { 'x-api-key': settings.apiKey || '' } });
      const data = await resp.json();
      models = Array.isArray(data.models) ? data.models : [];
      modelsSource = data.source || 'fallback';
      modelsNote = data.note || '';
    } catch {
      modelsSource = 'fallback';
      modelsNote = 'Could not reach the local server — is it still running?';
    }
    updateModelPickerLabel();
    if (!dom.modelDropdown.classList.contains('hidden')) renderModelDropdown();
  }

  function mergeModelsWithCustom() {
    const byId = new Map(models.map((m) => [m.id, m]));
    extraModelIds.forEach((id) => { if (!byId.has(id)) byId.set(id, { id, label: id, family: familyOf(id) }); });
    return [...byId.values()];
  }

  function updateModelPickerLabel() {
    const current = getModelForChat(getActiveChat());
    dom.modelPickerLabel.textContent = current;
    dom.modelDot.style.background = familyColor(familyOf(current));
  }

  function chooseModel(id) {
    const chat = getActiveChat();
    if (chat) { chat.model = id; saveChats(); }
    settings.defaultModel = id;
    saveSettings();
    updateModelPickerLabel();
    renderChatList();
  }

  function renderModelDropdown() {
    dom.modelDropdown.innerHTML = '';
    const current = getModelForChat(getActiveChat());

    if (modelsSource === 'fallback') {
      const note = document.createElement('div');
      note.className = 'model-dropdown-note';
      note.textContent = modelsNote || 'Showing a starter list — add your API key in Settings to load live models.';
      dom.modelDropdown.appendChild(note);
    }

    const grouped = {};
    mergeModelsWithCustom().forEach((m) => {
      const fam = m.family || familyOf(m.id);
      (grouped[fam] = grouped[fam] || []).push(m);
    });
    const familiesPresent = FAMILY_ORDER.filter((f) => grouped[f] && grouped[f].length);

    familiesPresent.forEach((fam) => {
      if (familiesPresent.length > 1) {
        const label = document.createElement('div');
        label.className = 'model-group-label';
        label.textContent = FAMILY_LABEL[fam] || fam;
        dom.modelDropdown.appendChild(label);
      }
      grouped[fam].forEach((m) => {
        const opt = document.createElement('button');
        opt.type = 'button';
        opt.className = 'model-option' + (m.id === current ? ' active' : '');
        opt.setAttribute('role', 'option');
        opt.setAttribute('aria-selected', String(m.id === current));

        const dot = document.createElement('span');
        dot.className = 'model-dot';
        dot.style.background = familyColor(fam);
        const label2 = document.createElement('span');
        label2.className = 'model-option-label';
        label2.textContent = m.id;
        opt.append(dot, label2);

        if (m.id === current) {
          const check = document.createElement('span');
          check.className = 'model-option-check';
          check.innerHTML = ICONS.check;
          opt.appendChild(check);
        }
        opt.addEventListener('click', () => { chooseModel(m.id); closeModelDropdown(); });
        dom.modelDropdown.appendChild(opt);
      });
    });

    const customRow = document.createElement('div');
    customRow.className = 'custom-model-row';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'custom model id…';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Use';
    const commit = () => {
      const val = input.value.trim();
      if (!val) return;
      extraModelIds.add(val);
      settings.customModels = [...extraModelIds];
      saveSettings();
      chooseModel(val);
      closeModelDropdown();
    };
    btn.addEventListener('click', commit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
    customRow.append(input, btn);
    dom.modelDropdown.appendChild(customRow);
  }

  function openModelDropdown() {
    renderModelDropdown();
    dom.modelDropdown.classList.remove('hidden');
    dom.modelPickerBtn.setAttribute('aria-expanded', 'true');
  }
  function closeModelDropdown() {
    dom.modelDropdown.classList.add('hidden');
    dom.modelPickerBtn.setAttribute('aria-expanded', 'false');
  }

  // ------------------------------------------------------------------
  // Settings modal
  // ------------------------------------------------------------------
  function updateKeyStatus() {
    const hasKey = Boolean(settings.apiKey && settings.apiKey.trim());
    dom.keyStatus.classList.toggle('ok', hasKey);
    dom.keyStatusText.textContent = hasKey ? 'API key connected' : 'No API key set';
  }

  function openSettings() {
    dom.apiKeyInput.value = settings.apiKey || '';
    dom.apiKeyInput.type = 'password';
    dom.toggleKeyVisibility.textContent = 'Show';
    dom.customModelInput.value = '';
    dom.systemPromptInput.value = settings.systemPrompt || '';
    const temp = typeof settings.temperature === 'number' ? settings.temperature : 0.7;
    dom.temperatureInput.value = String(temp);
    dom.tempValue.textContent = temp.toFixed(1);
    dom.settingsBackdrop.classList.remove('hidden');
  }
  function closeSettings() { dom.settingsBackdrop.classList.add('hidden'); }

  function saveSettingsHandler() {
    const newKey = dom.apiKeyInput.value.trim();
    const keyChanged = newKey !== (settings.apiKey || '');
    settings.apiKey = newKey;
    settings.systemPrompt = dom.systemPromptInput.value;
    settings.temperature = Number(dom.temperatureInput.value);

    const customVal = dom.customModelInput.value.trim();
    if (customVal) {
      extraModelIds.add(customVal);
      settings.customModels = [...extraModelIds];
    }

    saveSettings();
    updateKeyStatus();
    closeSettings();
    showToast('Settings saved');
    if (keyChanged) loadModels();
  }

  function clearAllChats() {
    if (!chats.length) { showToast('No chats to delete'); return; }
    if (!confirm('Delete all conversations? This cannot be undone.')) return;
    if (isStreaming) stopStreaming();
    chats = [];
    activeChatId = null;
    saveChats();
    renderChatList();
    renderActiveChat();
    closeSettings();
    showToast('All chats deleted');
  }

  // ------------------------------------------------------------------
  // Theme + sidebar chrome
  // ------------------------------------------------------------------
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', settings.theme === 'light' ? 'light' : 'dark');
  }
  function toggleTheme() {
    settings.theme = settings.theme === 'light' ? 'dark' : 'light';
    applyTheme();
    saveSettings();
  }

  function closeMobileSidebar() { dom.app.classList.remove('sidebar-open'); }

  function handleOpenSidebarClick() {
    if (window.matchMedia(MOBILE_QUERY).matches) {
      dom.app.classList.add('sidebar-open');
    } else {
      dom.app.classList.remove('sidebar-collapsed');
    }
  }

  // ------------------------------------------------------------------
  // Event wiring
  // ------------------------------------------------------------------
  function wireEvents() {
    dom.newChatBtn.addEventListener('click', startNewChat);
    dom.collapseSidebarBtn.addEventListener('click', () => dom.app.classList.toggle('sidebar-collapsed'));
    dom.openSidebarBtn.addEventListener('click', handleOpenSidebarClick);
    dom.sidebarScrim.addEventListener('click', closeMobileSidebar);

    dom.composerForm.addEventListener('submit', (e) => { e.preventDefault(); sendMessage(); });
    dom.promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    dom.promptInput.addEventListener('input', autoResizeTextarea);
    dom.stopBtn.addEventListener('click', stopStreaming);

    dom.suggestionGrid.addEventListener('click', (e) => {
      const card = e.target.closest('.suggestion-card');
      if (card) sendMessage(card.dataset.prompt);
    });

    dom.modelPickerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dom.modelDropdown.classList.contains('hidden') ? openModelDropdown() : closeModelDropdown();
    });
    document.addEventListener('click', (e) => {
      if (!dom.modelPicker.contains(e.target)) closeModelDropdown();
    });

    dom.themeToggleBtn.addEventListener('click', toggleTheme);

    dom.settingsBtn.addEventListener('click', openSettings);
    dom.closeSettingsBtn.addEventListener('click', closeSettings);
    dom.settingsBackdrop.addEventListener('click', (e) => { if (e.target === dom.settingsBackdrop) closeSettings(); });
    dom.toggleKeyVisibility.addEventListener('click', () => {
      const show = dom.apiKeyInput.type === 'password';
      dom.apiKeyInput.type = show ? 'text' : 'password';
      dom.toggleKeyVisibility.textContent = show ? 'Hide' : 'Show';
    });
    dom.temperatureInput.addEventListener('input', () => {
      dom.tempValue.textContent = Number(dom.temperatureInput.value).toFixed(1);
    });
    dom.saveSettingsBtn.addEventListener('click', saveSettingsHandler);
    dom.clearAllBtn.addEventListener('click', clearAllChats);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeModelDropdown(); closeSettings(); }
    });
  }

  // ------------------------------------------------------------------
  // Init
  // ------------------------------------------------------------------
  function init() {
    applyTheme();
    renderChatList();
    renderActiveChat();
    updateKeyStatus();
    updateModelPickerLabel();
    autoResizeTextarea();
    wireEvents();
    loadModels();
  }

  try { init(); } catch (err) { console.error('AgentRouter Chat failed to start:', err); }
})();

document.addEventListener('DOMContentLoaded', async () => {
  const ws = new WebSocket(`ws://${location.host}`);
  const chatContainer = document.getElementById('chatContainer');
  const messageInput = document.getElementById('messageInput');
  const sendButton = document.getElementById('sendButton');
  const statusText = document.getElementById('statusText');
  const statusDot = document.getElementById('statusDot');
  const statusModel = document.getElementById('statusModel');
  const statusProvider = document.getElementById('statusProvider');
  const sidebar = document.getElementById('sidebar');
  const sessionsList = document.getElementById('sessionsList');
  const metricCtx = document.getElementById('metricCtx');
  const metricIn = document.getElementById('metricIn');
  const metricOut = document.getElementById('metricOut');
  const metricSpeed = document.getElementById('metricSpeed');

  let currentWorkspace = 'default';
  let theme = 'light';
  let lastConfig = {};
  let editingSession = null;
  let isTyping = false;
  let typingElement = null;
  let voiceRecognition = null;

  window.toggleTheme = function() {
    theme = theme === 'light' ? 'dark' : 'light';
    document.body.setAttribute('data-theme', theme);
    const btn = sidebar.querySelector('.theme-toggle');
    btn.textContent = theme === 'dark' ? 'Claro' : 'Oscuro';
    document.querySelector('meta[name="color-theme"]').setAttribute('content', theme);
  };

  window.toggleSidebar = function() {
    sidebar.classList.toggle('collapsed');
  };

  async function newSession() {
    currentSessionMessages = [];
    currentSessionId = null;
    chatContainer.innerHTML = '';
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'empty-state';
    emptyDiv.innerHTML = '<h2>Nueva conversación</h2><p>Escribe un mensaje abajo para comenzar.</p>';
    chatContainer.appendChild(emptyDiv);
    try {
      const response = await fetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace: currentWorkspace, sessionTitle: 'Nueva conversación' }),
      });
      const data = await response.json();
      if (data.success && data.session) {
        currentSessionId = data.session.id;
      }
    } catch (e) {
      console.error('Error creando sesión nueva:', e);
    }
    loadSessions();
  }

  window.newSession = newSession;

  window.deleteSession = function() {
    if (!editingSession) { showError('Selecciona una sesión para borrar'); return; }
    if (!confirm('¿Borrar esta sesión?')) return;
    fetch(`/api/history/${editingSession}?workspace=${currentWorkspace}`, { method: 'DELETE' })
      .then(() => {
        editingSession = null;
        loadSessions();
        chatContainer.innerHTML = '';
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'empty-state';
        emptyDiv.innerHTML = '<h2>Sesión borrada</h2><p>Crea una nueva sesión para comenzar.</p>';
        chatContainer.appendChild(emptyDiv);
      });
  };

  window.loadAvailableModels = async function(baseUrlOverride, providerOverride) {
    try {
      const provider = providerOverride || document.getElementById('settingProvider')?.value || 'ollama';
      const baseUrl = baseUrlOverride || document.getElementById('settingBaseUrl')?.value || 'http://127.0.0.1:11434';
      const response = await fetch(`/api/models?provider=${encodeURIComponent(provider)}&baseUrl=${encodeURIComponent(baseUrl)}`);
      const data = await response.json();
      const models = data.models || [];
      const defaultModel = data.default || models[0]?.name || '';
      const modelSelect = document.getElementById('modelSelect');
      if (modelSelect) {
        modelSelect.innerHTML = '';
        models.forEach((m) => {
          const option = document.createElement('option');
          option.value = m.name;
          option.textContent = m.name + (m.context ? ` (${m.context} ctx)` : '');
          modelSelect.add(option);
        });
        if (defaultModel) modelSelect.value = defaultModel;
        statusModel.textContent = defaultModel;
        statusProvider.textContent = data.provider || 'ollama';
      }
      const settingModelInput = document.getElementById('settingModel');
      if (settingModelInput && !settingModelInput.value && defaultModel) {
        settingModelInput.value = defaultModel;
      }
    } catch (e) {
      console.error('Error cargando modelos:', e);
    }
  };

  window.addMcpServer = function() {
    const container = document.getElementById('mcpList');
    const div = document.createElement('div');
    div.className = 'mcp-item';
    div.innerHTML = '<input type="text" placeholder="Nombre" style="flex:1; font-size:0.75rem;" />' +
      '<input type="text" placeholder="URL" style="flex:1.5; font-size:0.75rem;" />' +
      '<button onclick="removeMcpServer(this)" style="background:none;border:none;color:var(--accent-error);cursor:pointer;">×</button>';
    container.appendChild(div);
  };

  window.removeMcpServer = function(btn) {
    if (typeof btn === 'number') {
      const container = document.getElementById('mcpList');
      container.children[btn].remove();
    } else {
      btn.parentElement.remove();
    }
  };

  function readMCPList() {
    const container = document.getElementById('mcpList');
    const servers = [];
    container.querySelectorAll('.mcp-item').forEach((div) => {
      const inputs = div.querySelectorAll('input');
      if (inputs.length >= 2) {
        servers.push({ name: inputs[0].value, url: inputs[1].value });
      }
    });
    return servers;
  }

  ws.onopen = () => {
    statusText.textContent = 'Conectado';
    statusDot.className = 'status-dot connected';
    ws.send(JSON.stringify({ type: 'request:history', workspace: 'default' }));
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    handleWebSocketMessage(data);
  };

  ws.onclose = () => {
    statusText.textContent = 'Desconectado';
    statusDot.className = 'status-dot';
    setTimeout(() => location.reload(), 3000);
  };

  function handleWebSocketMessage(msg) {
    switch (msg.type) {
      case 'message': addMessage(msg.data.role, msg.data.content, false); break;
      case 'assistant:response': removeTyping(); addMessage('assistant', msg.data.text, true, msg.data.usage); break;
      case 'model:loading': setModelLoading(msg.data); break;
      case 'compaction:start': showSystemMessage('⚡ Compactando contexto…'); break;
      case 'compaction:end': showSystemMessage('✅ Contexto compactado'); break;
      case 'provider:error': showError(`Error del proveedor ${msg.data.provider}: ${msg.data.error}`); break;
      case 'session:updated': loadSessions(); break;
      case 'session:deleted': loadSessions(); break;
      case 'history': renderSessions(msg.data.history || []); break;
      case 'metrics': updateMetrics(msg.data); break;
    }
  }

  function addMessage(role, content, isAssistant, usage) {
    if (role === 'assistant') removeTyping();
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role}`;
    msgDiv.innerHTML = marked.parse(content) || content;
    if (isAssistant && usage) {
      const meta = document.createElement('div');
      meta.className = 'meta-line';
      const parts = [];
      if (usage.tokens) parts.push(`📥 ${usage.tokens.prompt} 📤 ${usage.tokens.completion} 🧮 ${usage.tokens.total}`);
      if (usage.responseTimeMs) parts.push(`⏱ ${usage.responseTimeMs}ms`);
      if (usage.context) parts.push(`🧠 ${Math.round(usage.context.used_percent || 0)}% ctx`);
      meta.textContent = parts.join('  │  ');
      msgDiv.appendChild(meta);
    }
    chatContainer.appendChild(msgDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    return msgDiv;
  }

  function showSystemMessage(text) {
    const div = document.createElement('div');
    div.className = 'message system';
    div.textContent = text;
    chatContainer.appendChild(div);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    return div;
  }

  function showError(text) {
    const div = document.createElement('div');
    div.className = 'error-message';
    div.textContent = text;
    chatContainer.appendChild(div);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    setTimeout(() => div.remove(), 8000);
  }

  function setModelLoading(data) {
    statusText.textContent = 'Cargando modelo…';
    statusDot.className = 'status-dot loading';
    statusModel.textContent = data.model || '–';
    statusProvider.textContent = data.provider || '–';
  }

  function updateMetrics(data) {
    // Métricas de contexto y tokens del turno actual (vía onMetrics del servidor)
    if (metricCtx && data.context) {
      const pct = Math.round(data.context.used_percent || 0);
      metricCtx.textContent = pct + '%';
      metricCtx.style.color = pct > 80 ? 'var(--accent-error)' : pct > 60 ? 'var(--accent-compact)' : 'var(--fg)';
    }
    if (metricIn && data.tokens) metricIn.textContent = data.tokens.prompt ?? '--';
    if (metricOut && data.tokens) metricOut.textContent = data.tokens.completion ?? '--';
    // tokens_per_second puede venir en la raíz o dentro de usage
    const tps = data.tokens_per_second ?? data.usage?.tokens_per_second ?? null;
    if (metricSpeed && tps != null) metricSpeed.textContent = tps;
  }

  function removeTyping() {
    if (typingElement) { typingElement.remove(); typingElement = null; isTyping = false; }
  }

  function showTyping() {
    if (isTyping) return;
    isTyping = true;
    typingElement = document.createElement('div');
    typingElement.className = 'typing-indicator';
    typingElement.innerHTML = '<span>Escribiendo</span><div class="typing-dots"><span></span><span></span><span></span></div>';
    chatContainer.appendChild(typingElement);
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }

  /**
   * Lee la configuración persistida (/api/config-full) y la aplica a la UI
   * principal nada más entrar: tema, modelo, proveedor y barra de estado.
   * Así el GUI siempre arranca con los últimos parámetros guardados.
   */
  async function loadAndApplyConfig() {
    try {
      const response = await fetch('/api/config-full');
      lastConfig = await response.json();
    } catch (e) {
      console.error('Error cargando configuración al iniciar:', e);
      lastConfig = {};
    }

    // Tema guardado (se aplica al cuerpo; el botón del sidebar lo gestiona toggleTheme al hacer clic)
    const savedTheme = lastConfig.theme || 'light';
    theme = savedTheme;
    document.body.setAttribute('data-theme', theme);
    document.querySelector('meta[name="color-theme"]').setAttribute('content', theme);

    // Modelo y proveedor guardados en la barra de estado (el dropdown se llena después en loadAvailableModels)
    const savedModel = lastConfig.provider?.model || '';
    const savedProvider = lastConfig.provider?.provider || 'ollama';
    if (statusModel) statusModel.textContent = savedModel || '--';
    if (statusProvider) statusProvider.textContent = savedProvider || '--';
  }

  function renderSessions(sessions) {
    sessionsList.innerHTML = '';
    if (sessions.length === 0) {
      sessionsList.innerHTML = '<div class="no-sessions">Sin sesiones guardadas</div>';
      return;
    }
    sessions.forEach((session) => {
      const div = document.createElement('div');
      div.className = `session-item ${editingSession === session.id ? 'selected' : ''}`;
      div.onclick = () => selectSession(session);
      div.innerHTML = '<div class="session-meta"><div class="session-title">' + (session.title || 'Sin título') + '</div><div class="session-count">' + (session.messageCount || 0) + ' mensajes</div></div>';
      div.dataset.id = session.id;
      sessionsList.appendChild(div);
    });
  }

  async function selectSession(session) {
    editingSession = session.id;
    currentSessionId = session.id;
    currentSessionMessages = (session.messages || []).map((m) => ({ role: m.role, content: m.content }));
    const items = sessionsList.querySelectorAll('.session-item');
    items.forEach((item) => item.classList.remove('selected'));
    const selected = sessionsList.querySelector(`[data-id="${session.id}"]`);
    if (selected) selected.classList.add('selected');

    // Renderizar el historial de la sesión retomada
    chatContainer.innerHTML = '';
    if (currentSessionMessages.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'empty-state';
      emptyDiv.innerHTML = '<h2>Nueva conversación</h2><p>Escribe un mensaje abajo para comenzar.</p>';
      chatContainer.appendChild(emptyDiv);
    } else {
      currentSessionMessages.forEach((m) => addMessage(m.role, m.content, m.role === 'assistant'));
    }

    // Actualizar modelo y proveedor de la sesión en la barra de estado
    if (session.model) {
      statusModel.textContent = session.model;
      const modelSelect = document.getElementById('modelSelect');
      if (modelSelect) modelSelect.value = session.model;
    }
    if (session.provider) statusProvider.textContent = session.provider;
  }

  function loadSessions() {
    fetch(`/api/history?workspace=${currentWorkspace}`)
      .then((r) => r.json())
      .then(renderSessions)
      .catch((err) => console.error('Error cargando sesiones:', err));
  }

  let currentSessionMessages = [];
  let currentSessionId = null;

  function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;
    const modelSelect = document.getElementById('modelSelect');
    const selectedModel = modelSelect ? modelSelect.value : 'qwen:7b';
    sendButton.disabled = true;
    sendButton.textContent = 'Enviando…';
    messageInput.value = '';
    currentSessionMessages.push({ role: 'user', content: text });
    addMessage('user', text, false);
    showTyping();
    const settingProvider = document.getElementById('settingProvider')?.value || 'ollama';
    const settingBaseUrl = document.getElementById('settingBaseUrl')?.value || 'http://127.0.0.1:11434';
    // El servidor recupera el historial de la sesión desde SQLite y se encarga de compactar si es necesario
    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, model: selectedModel, provider: settingProvider, baseUrl: settingBaseUrl, mode: 'build', workspace: currentWorkspace, sessionId: currentSessionId }),
    })
      .then(async (r) => {
        const data = await r.json();
        if (data.sessionId) currentSessionId = data.sessionId;
        currentSessionMessages.push({ role: 'assistant', content: data.text || '' });
        // No llamar addMessage aquí: la respuesta llega por WebSocket (assistant:response)
        // y se agrega una sola vez en handleWebSocketMessage. Llamarla aquí causa duplicación.
      })
      .catch((err) => { showError(`Error al enviar: ${err.message}`); removeTyping(); })
      .finally(() => { sendButton.disabled = false; sendButton.textContent = 'Enviar'; });
  }

  function handleFileSelect() {
    const file = document.getElementById('fileInput').files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => sendMessageWithFile(file, e.target.result);
    reader.readAsDataURL(file);
  }

  async function sendMessageWithFile(file, previewUrl) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('message', 'Adjunto de archivo');
    formData.append('model', document.getElementById('modelSelect')?.value || 'qwen:7b');
    formData.append('workspace', currentWorkspace);
    sendButton.disabled = true;
    sendButton.textContent = 'Enviando…';
    try {
      const response = await fetch('/api/chat', { method: 'POST', body: formData });
      const data = await response.json();
      addMessage('user', `Archivo: ${file.name}`, false);
      addMessage('assistant', data.text || `[Archivo procesado: ${file.name}]`, true, data.usage);
    } catch (error) { showError('Error al subir archivo'); }
    finally { sendButton.disabled = false; sendButton.textContent = 'Enviar'; document.getElementById('fileInput').value = ''; }
  }

  window.openSettings = async function() {
    const modal = document.getElementById('settingsModal');
    modal.classList.add('open');
    try {
      const response = await fetch('/api/config-full');
      const config = await response.json();
      document.getElementById('settingProvider').value = config.provider?.provider || 'ollama';
      document.getElementById('settingModel').value = config.provider?.model || '';
      document.getElementById('settingBaseUrl').value = config.provider?.baseUrl || 'http://127.0.0.1:11434';
      document.getElementById('settingApiKey').value = '';
      document.getElementById('settingMode').value = config.mode || 'build';
      document.getElementById('settingLanguage').value = config.language || 'en';
      document.getElementById('settingTheme').value = config.theme || 'light';
      document.getElementById('capTerminal').checked = config.capabilities?.terminal ?? false;
      document.getElementById('capWeb').checked = config.capabilities?.web ?? false;
      document.getElementById('capMcp').checked = config.capabilities?.mcp ?? false;
      document.getElementById('capDocuments').checked = config.capabilities?.documents ?? false;
      document.getElementById('capArtifacts').checked = config.capabilities?.artifacts ?? false;
      document.getElementById('capFilesystem').checked = config.capabilities?.filesystem ?? false;
      document.getElementById('capAutoCompact').checked = config.autoCompact ?? false;
      document.getElementById('capThresholdPercent').value = config.compactThresholdPercent ?? 90;
      document.getElementById('capKeepLastMessages').value = config.compaction?.keepLastMessages ?? 12;
      document.getElementById('sttEnabled').checked = config.stt?.enabled ?? false;
      document.getElementById('sttModel').value = config.stt?.model || '';
      document.getElementById('sttBaseUrl').value = config.stt?.baseUrl || '';
      document.getElementById('ttsEnabled').checked = config.tts?.enabled ?? false;
      document.getElementById('ttsModel').value = config.tts?.model || '';
      document.getElementById('ttsBaseUrl').value = config.tts?.baseUrl || '';
      document.getElementById('ttsVoice').value = config.tts?.voice || '';
      renderMCPList(config.mcpServers || []);
      await loadAvailableModels();
    } catch (e) { console.error('Error cargando configuración:', e); }
  };

  window.closeSettings = function() {
    document.getElementById('settingsModal').classList.remove('open');
  };

  window.saveAndCloseSettings = async function() {
    const config = {
      provider: {
        provider: document.getElementById('settingProvider').value,
        model: document.getElementById('settingModel').value,
        baseUrl: document.getElementById('settingBaseUrl').value,
        apiKey: document.getElementById('settingApiKey').value || undefined,
      },
      mode: document.getElementById('settingMode').value,
      language: document.getElementById('settingLanguage').value,
      theme: document.getElementById('settingTheme').value,
      capabilities: {
        terminal: document.getElementById('capTerminal').checked,
        web: document.getElementById('capWeb').checked,
        mcp: document.getElementById('capMcp').checked,
        documents: document.getElementById('capDocuments').checked,
        artifacts: document.getElementById('capArtifacts').checked,
        filesystem: document.getElementById('capFilesystem').checked,
      },
      compaction: {
        auto: document.getElementById('capAutoCompact').checked,
        thresholdPercent: parseInt(document.getElementById('capThresholdPercent').value) || 90,
        strategy: 'summary',
        keepLastMessages: parseInt(document.getElementById('capKeepLastMessages').value) || 12,
      },
      stt: {
        enabled: document.getElementById('sttEnabled').checked,
        model: document.getElementById('sttModel').value || undefined,
        baseUrl: document.getElementById('sttBaseUrl').value || undefined,
      },
      tts: {
        enabled: document.getElementById('ttsEnabled').checked,
        model: document.getElementById('ttsModel').value || undefined,
        baseUrl: document.getElementById('ttsBaseUrl').value || undefined,
        voice: document.getElementById('ttsVoice').value || undefined,
      },
    };

    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (response.ok) {
        await loadAvailableModels();
        if (config.theme === 'dark' && theme === 'light') toggleTheme();
        if (config.theme === 'light' && theme === 'dark') toggleTheme();
        closeSettings();
        statusText.textContent = 'Configuración guardada';
        setTimeout(() => { statusText.textContent = 'Listo'; }, 2000);
      }
    } catch (e) { console.error('Error guardando configuración:', e); }
  };

  function renderMCPList(servers) {
    const container = document.getElementById('mcpList');
    container.innerHTML = '';
    servers.forEach((server, index) => {
      const div = document.createElement('div');
      div.className = 'mcp-item';
      div.innerHTML = '<input type="text" value="' + (server.name || '') + '" placeholder="Nombre" style="flex:1; font-size:0.75rem;" />' +
        '<input type="text" value="' + (server.url || '') + '" placeholder="URL" style="flex:1.5; font-size:0.75rem;" />' +
        '<button onclick="removeMcpServer(' + index + ')" style="background:none;border:none;color:var(--accent-error);cursor:pointer;">×</button>';
      container.appendChild(div);
    });
  }

  window.toggleVoice = function() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      showError('Tu navegador no soporta entrada de voz');
      return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (voiceRecognition) { voiceRecognition.stop(); voiceRecognition = null; document.getElementById('btnVoice').classList.remove('recording'); return; }
    voiceRecognition = new SpeechRecognition();
    voiceRecognition.lang = 'es-ES';
    voiceRecognition.continuous = false;
    voiceRecognition.interimResults = false;
    voiceRecognition.onstart = () => { document.getElementById('btnVoice').classList.add('recording'); };
    voiceRecognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      messageInput.value = transcript;
      messageInput.dispatchEvent(new Event('input'));
    };
    voiceRecognition.onend = () => { voiceRecognition = null; document.getElementById('btnVoice').classList.remove('recording'); };
    voiceRecognition.onerror = () => { voiceRecognition = null; document.getElementById('btnVoice').classList.remove('recording'); };
    voiceRecognition.start();
  };

  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  sendButton.addEventListener('click', sendMessage);

  async function initialize() {
    await loadAndApplyConfig();
    loadSessions();
    await loadAvailableModels();
    // Seleccionar el modelo guardado tras cargar las opciones del dropdown
    const modelSelect = document.getElementById('modelSelect');
    if (modelSelect && lastConfig.provider?.model) {
      const existing = Array.from(modelSelect.options).find((o) => o.value === lastConfig.provider.model);
      if (existing) {
        modelSelect.value = lastConfig.provider.model;
        statusModel.textContent = lastConfig.provider.model;
      }
      if (lastConfig.provider.provider) statusProvider.textContent = lastConfig.provider.provider;
    }
  }

  initialize();

  document.getElementById('settingProvider')?.addEventListener('change', async () => { await loadAvailableModels(); });
  document.getElementById('settingBaseUrl')?.addEventListener('change', async () => { await loadAvailableModels(); });

  window.newSession = newSession;
  window.deleteSession = deleteSession;
});
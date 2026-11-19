#!/usr/bin/env node
import express from "express";
import { createWebSocketServer } from "./websocket.js";
import { askAgent, loadEffectiveConfig, saveGlobalConfig } from "agentkit-core/src/index.js";
import { listOllamaModels } from "agentkit-core/src/ollama.js";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import os from "node:os";
import { AgentKitDatabase } from "./database.js";

const app = express();
const server = http.createServer(app);
const wsInstance = createWebSocketServer(server);
const broadcast = wsInstance.broadcast;

// Base de datos SQLite para persistencia de sesiones y mensajes
const dbPath = path.join(process.cwd(), ".agentkit", "agentkit.sqlite");
const db = new AgentKitDatabase({ dbPath });

app.use(express.json());
app.use(express.static("public"));

// GET /api/models - lists models from the configured provider or a specified baseUrl
app.get("/api/models", async (req, res) => {
  const config = loadEffectiveConfig({ cwd: process.cwd() });
  const effective = config.config || {};
  const provider = req.query.provider || effective.provider?.provider || "ollama";
  const baseUrl = req.query.baseUrl || effective.provider?.baseUrl || "http://127.0.0.1:11434";
  let models = [];

  try {
    if (provider === "ollama") {
      const ollamaModels = await listOllamaModels({ baseUrl });
      models = ollamaModels.map((m) => ({
        name: m.name,
        size: m.size,
        context: m.contextLength
      }));
    } else if (provider === "openai-compatible") {
      models = [
        { name: "gpt-4o", context: 128000 },
        { name: "gpt-4o-mini", context: 128000 },
        { name: "gpt-3.5-turbo", context: 16384 }
      ];
    } else if (provider === "anthropic") {
      models = [
        { name: "claude-3-5-sonnet-20240620", context: 200000 },
        { name: "claude-3-haiku-20240307", context: 100000 }
      ];
    } else if (provider === "google-gemini") {
      models = [
        { name: "gemini-1.5-flash", context: 1048576 },
        { name: "gemini-1.5-pro", context: 1048576 }
      ];
    }
  } catch (error) {
    console.error("Failed to list models:", error);
    models = [];
  }

  // Siempre incluir el modelo configurado aunque el proveedor no responda,
  // así el GUI puede seleccionar y restaurar el último modelo usado.
  const configuredModel = effective.provider?.model;
  if (configuredModel && !models.some((m) => m.name === configuredModel)) {
    models.push({ name: configuredModel, context: models[0]?.context || 0, size: 0 });
  }

  res.json({
    models,
    default: configuredModel || models[0]?.name || "qwen:7b",
    provider,
    baseUrl
  });
});

// POST /api/chat
app.post("/api/chat", async (req, res) => {
  try {
    const { message, model, capabilities, workspace = "default" } = req.body;
    let sessionId = req.body.sessionId || null;

    let result;
    let fullProviderConfig;
    const pendingEvents = [];

    try {
      const config = loadEffectiveConfig({ cwd: process.cwd() });
      const providerConfig = config.provider || {};

      fullProviderConfig = {
        provider: req.body.provider || providerConfig.provider || "ollama",
        model: model || providerConfig.model || "qwen:7b",
        baseUrl: req.body.baseUrl || providerConfig.baseUrl || "http://127.0.0.1:11434",
        apiKey: providerConfig.apiKey || undefined,
      };

      // Asegurar que existe una sesión (crear si no se envió sessionId o es inválida)
      if (!sessionId || !db.getSession(sessionId)) {
        const created = db.createSession({ workspace, model: fullProviderConfig.model, provider: fullProviderConfig.provider, baseUrl: fullProviderConfig.baseUrl });
        sessionId = created.id;
      } else {
        // Actualizar modelo/proveedor de la sesión si cambiaron
        db.updateSession(sessionId, { model: fullProviderConfig.model, provider: fullProviderConfig.provider, baseUrl: fullProviderConfig.baseUrl });
      }

      // Recuperar historial de la sesión desde SQLite (contexto de conversaciones previas)
      const priorMessages = db.getMessages({ sessionId });
      const history = priorMessages.map((m) => ({ role: m.role, content: m.content }));

      // Broadcast modelo cargando inmediatamente
      broadcast({ type: "model:loading", data: { provider: fullProviderConfig.provider, model: fullProviderConfig.model }, timestamp: Date.now() });

      // Timeout de 30s para permitir que Ollama cargue el modelo
      const askPromise = askAgent({
        provider: fullProviderConfig,
        history,
        messages: [{ role: "user", content: message }],
        mode: req.body.mode || "build",
        capabilities: capabilities || { terminal: false, web: false, mcp: false, documents: false, artifacts: false, filesystem: false },
        includeDiagnostics: false,
        onModelLoading: (e) => {
          pendingEvents.push({ type: "model:loading", data: e, timestamp: Date.now() });
          broadcast({ type: "model:loading", data: e, timestamp: Date.now() });
        },
        onCompactionStart: (e) => {
          pendingEvents.push({ type: "compaction:start", data: e, timestamp: Date.now() });
          broadcast({ type: "compaction:start", data: e, timestamp: Date.now() });
        },
        onCompactionEnd: (e) => {
          pendingEvents.push({ type: "compaction:end", data: e, timestamp: Date.now() });
          broadcast({ type: "compaction:end", data: e, timestamp: Date.now() });
        },
        onProviderError: (e) => {
          pendingEvents.push({ type: "provider:error", data: e, timestamp: Date.now() });
          broadcast({ type: "provider:error", data: e, timestamp: Date.now() });
        },
        onMetrics: (e) => {
            if (process.env.DEBUG_E2E) console.log("SERVER onMetrics context:", JSON.stringify(e && e.context));
            pendingEvents.push({ type: "metrics", data: e, timestamp: Date.now() });
            broadcast({ type: "metrics", data: e, timestamp: Date.now() });
        },
      });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("askAgent timeout: proveedor IA excedió 5 minutos")), 300000)
      );
      result = await Promise.race([askPromise, timeoutPromise]);
    } catch (providerError) {
      broadcast({ type: "provider:error", data: { provider: fullProviderConfig?.provider || "desconocido", model: fullProviderConfig?.model || "", error: providerError?.message || String(providerError), aborted: false }, timestamp: Date.now() });
      const promptTokens = Math.max(1, Math.ceil(message.length / 4));
      const completionTokens = 50;
      const totalTokens = promptTokens + completionTokens;
      const contextLimit = 40960;
      const errMsg = providerError?.message || String(providerError);
      result = {
        text: `No se pudo obtener respuesta del proveedor IA (${fullProviderConfig.provider}:${fullProviderConfig.model} @ ${fullProviderConfig.baseUrl}).\n\nError: ${errMsg}\n\nPara usar una IA real, verifica en ⚙️ Configuración que el proveedor y el modelo sean correctos y que el servicio esté disponible.\n\nEsta es una respuesta de fallback. El chat funciona, pero sin IA real.`,
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: totalTokens,
          tokens: { prompt: promptTokens, completion: completionTokens, total: totalTokens },
          context: {
            used_tokens: promptTokens,
            limit_tokens: contextLimit,
            used_percent: Math.min(100, Math.round((promptTokens / contextLimit) * 100)),
            estimated: true,
          },
        },
      };
      // Métrica de contexto también por WebSocket (actualiza el % de contexto en pantalla)
      broadcast({ type: "metrics", data: { context: result.usage.context, timestamp: Date.now() }, timestamp: Date.now() });
    }

    // Guardar mensaje de usuario y respuesta del asistente en SQLite
    const userMsg = db.addMessage({ sessionId, role: 'user', content: message });
    const assistantMsg = db.addMessage({ sessionId, role: 'assistant', content: result.text || "" });

    const response = { text: result.text || "", usage: result.usage || null, model: model || fullProviderConfig?.model || "simulado", sessionId, userMessageId: userMsg.id, assistantMessageId: assistantMsg.id };
    broadcast({ type: "assistant:response", data: { text: result.text, model: response.model, usage: result.usage, sessionId }, timestamp: Date.now() });
    res.json(response);
  } catch (error) {
    console.error("/api/chat error:", error);
    res.status(500).json({ error: error.message || "Error desconocido" });
  }
});

// GET /api/history - lista sesiones con sus mensajes desde SQLite
app.get("/api/history", (req, res) => {
  const workspace = req.query.workspace || "default";
  const sessions = db.getSessions({ workspace, limit: 50 });
  const result = sessions.map((s) => {
    const messages = db.getMessages({ sessionId: s.id });
    return {
      id: s.id,
      title: s.title,
      created: s.created_at,
      updated: s.updated_at,
      messageCount: messages.length,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      model: s.model,
      provider: s.provider,
      baseUrl: s.base_url,
    };
  });
  res.json({ history: result, workspace });
});

// POST /api/history - crear sesión nueva en SQLite
app.post("/api/history", (req, res) => {
  const { workspace = "default", sessionTitle, messages } = req.body;
  const created = db.createSession({ workspace, title: sessionTitle || "Sesión sin título" });
  // Guardar mensajes iniciales si los hay
  if (Array.isArray(messages)) {
    messages.forEach((m, i) => {
      db.addMessage({ sessionId: created.id, role: m.role, content: m.content, orderIndex: i });
    });
  }
  const sessionWithMessages = {
    id: created.id,
    title: created.title,
    created: created.created_at,
    updated: created.updated_at,
    messageCount: messages?.length || 0,
    messages: messages || [],
    model: created.model,
    provider: created.provider,
    baseUrl: created.base_url,
  };
  broadcast({ type: "session:updated", data: { workspace, session: sessionWithMessages }, timestamp: Date.now() });
  res.json({ success: true, session: sessionWithMessages });
});

// DELETE /api/history/:id - eliminar sesión y sus mensajes de SQLite
app.delete("/api/history/:id", (req, res) => {
  const workspace = req.query.workspace || "default";
  const sessionId = req.params.id;
  const session = db.getSession(sessionId);
  if (session) {
    db.deleteSession(sessionId);
    broadcast({ type: "session:deleted", data: { workspace, sessionId }, timestamp: Date.now() });
  }
  res.json({ success: true });
});

// GET /api/metrics - métricas en tiempo real
app.get("/api/metrics", (req, res) => {
  const usage = process.cpuUsage();
  const mem = process.memoryUsage();
  const now = Date.now();
  
  // Calcular porcentaje de CPU aproximado
  const cpuPercent = Math.round(((usage.user + usage.system) / 1000) / (process.uptime() || 1) * 100);
  
  res.json({
    timestamp: now,
    cpu: Math.min(cpuPercent, 100),
    memory: {
      used: Math.round(mem.rss / 1024 / 1024 * 100) / 100,
      total: Math.round(os.totalmem() / 1024 / 1024 * 100) / 100,
      percent: Math.round(mem.rss / os.totalmem() * 100)
    },
    uptime: Math.floor(process.uptime()),
    connections: wsInstance.wss.clients.size
  });
});

// Enviar métricas por WebSocket cada 2 segundos
setInterval(() => {
  const usage = process.cpuUsage();
  const mem = process.memoryUsage();
  const now = Date.now();
  const cpuPercent = Math.round(((usage.user + usage.system) / 1000) / (process.uptime() || 1) * 100);
  
  wsInstance.broadcast({
    type: "system:metrics",
    data: {
      timestamp: now,
      cpu: Math.min(cpuPercent, 100),
      memory: {
        used: Math.round(mem.rss / 1024 / 1024 * 100) / 100,
        total: Math.round(os.totalmem() / 1024 / 1024 * 100) / 100,
        percent: Math.round(mem.rss / os.totalmem() * 100)
      },
      uptime: Math.floor(process.uptime()),
      connections: wsInstance.wss.clients.size
    }
  });
}, 2000);

// GET /api/config
app.get("/api/config", async (req, res) => {
  try {
    const config = await loadEffectiveConfig({ cwd: process.cwd() });
    console.log("DEBUG config provider:", JSON.stringify(config.config.provider));
    res.json(config);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// POST /api/config
app.post("/api/config", async (req, res) => {
  try { saveGlobalConfig(req.body); res.json({ success: true }); } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET /api/config-full - configuración completa para el GUI (MCP servers, capabilities, etc.)
app.get("/api/config-full", async (req, res) => {
  try {
    const config = await loadEffectiveConfig({ cwd: process.cwd() });
    const effective = config.config || {};
    res.json({
      provider: effective.provider || {},
      providers: effective.providers || {},
      mode: effective.mode || "build",
      language: effective.language || "en",
      theme: effective.theme || "light",
      capabilities: effective.capabilities || { terminal: true, web: true, mcp: true, documents: true, artifacts: true, filesystem: true },
      mcpServers: effective.mcpServers || [],
      terminal: effective.terminal || {},
      compaction: effective.compaction || { auto: false, thresholdPercent: 90, strategy: "summary", keepLastMessages: 12 },
      autoCompact: effective.compaction?.auto ?? false,
      compactThresholdPercent: effective.compaction?.thresholdPercent ?? 90,
      globalPath: config.globalPath || "",
      projectPath: config.projectPath || null,
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

fs.mkdirSync(path.join(process.cwd(), ".agentkit"), { recursive: true });

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", function() {
  console.log("🟢 AgentKit GUI running at http://0.0.0.0:" + PORT);
  console.log("📁 Workspace: " + process.cwd() + "/.agentkit/");
  console.log("API: GET /api/models, POST /api/chat, GET /api/history, POST /api/history, DELETE /api/history/:id, GET /api/config, POST /api/config");
});

process.on("SIGINT", function() {
  console.log("\n🛑 Shutting down...");
  server.close();
  process.exit(0);
});

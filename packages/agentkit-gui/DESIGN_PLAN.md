# Plan de Diseño - AgentKit GUI

## Sujeto del producto
**AgentKit** es un harness de IA local para desarrolladores y usuarios técnicos que ejecutan modelos de lenguaje en su propia máquina (Ollama, OpenAI-compatible, Anthropic, Gemini). Su trabajo principal: conversar con modelos locales, gestionar herramientas (MCP, terminal, web), y controlar el contexto de conversación.

**Audiencia**: desarrolladores, investigadores de IA, usuarios técnicos.
**Trabajo principal**: chatear con modelos locales con control total de configuración, métricas y herramientas.

## Token System

### Color (terminal cyberpunk, no generico)
- `--bg: #050507` (negro profundo, casi negro)
- `--surface: #0d0d12` (tarjetas/superficies)
- `--surface-2: #14141d` (superficies elevadas)
- `--fg: #e2e8f0` (texto principal)
- `--muted: #64748b` (texto secundario)
- `--accent: #22d3ee` (cian para IA/assistant)
- `--accent-user: #3b82f6` (azul para usuario)
- `--accent-compact: #f59e0b` (ámbar para compactación)
- `--accent-error: #ef4444` (rojo para errores)
- `--accent-success: #10b981` (verde para éxito)
- `--border: #1e1e2e` (bordes sutiles)
- `--input-bg: #0a0a0f` (fondo de inputs)

### Type (una sola familia, sans-serif, con monospace para código/mensajes)
- Display/Headings: `ui-sans-serif, system-ui, -apple-system, sans-serif` (tight tracking, letras pequeñas)
- Body/UI: `ui-sans-serif, system-ui, sans-serif`
- Mensajes/métricas/código: `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`
- Escala tipográfica: 0.75rem / 0.875rem / 1rem / 1.125rem / 1.25rem / 1.5rem

### Layout
```
┌─────────────────────────────────────────────────────────────┐
│  🤖 AgentKit  [═══ modelo] [⚙️] [☰ sesiones] [◷ métricas]   │
├─────────────────────────────────────────────────────────────┤
│  [Estado del modelo y proveedor]  [Notificaciones]          │
├─────────────────────────────────────────────────────────────┤
│  [CHAT - ocupa todo el ancho disponible]                    │
│  [Escribiendo... / Esperando modelo...]                     │
├─────────────────────────────────────────────────────────────┤
│  [Mensajes de usuario e IA con burbujas]                    │
│  [Métricas: tokens, contexto %, tiempo de respuesta]        │
├─────────────────────────────────────────────────────────────┤
│  [Input: texto | 🎤 voz | 📎 archivo] [Enviar]              │
└─────────────────────────────────────────────────────────────┘
```

### Principios
1. **Un solo elemento llamativo**: las burbujas de mensaje con gradiente sutil y borde de color por rol.
2. **Todo lo demás es silencioso**: bordes finos, sin sombras suaves, sin gradientes decorativos.
3. **Tipografía como diseño**: el monospace para mensajes es parte de la identidad "terminal de IA".
4. **Motion solo por acción del usuario**: abrir/cerrar settings, enviar mensaje, toggle sidebar.
5. **Vacío es invitación**: historial vacío muestra cómo empezar, no "no hay nada".
6. **Errores son direccionales**: no se disculpan, dicen qué pasó y cómo arreglarlo.

## Mejoras Core → GUI
- `askAgent()` emite `onCompactionStart`, `onCompactionEnd`, `onModelLoading`, `onProviderError`, `onMetrics`
- Métricas: `context_used`, `context_limit`, `context_percent`, `tokens_in`, `tokens_out`, `tokens_per_sec`, `response_time_ms`
- Configuración completa: `capabilities`, `mcpServers`, `terminal`, `web`, `documents`, `artifacts`, `filesystem`, `autoCompact`, `thresholdPercent`
- Soporte STT/TTS opcional (Web Speech API en el GUI)

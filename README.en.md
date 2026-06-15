# AgentBox Town

[中文](README.md) | **English**

AgentBox Town is an experimental AI virtual town simulator. It places many AI characters inside one persistent town, where each character has a location, schedule, relationships, memories, needs, emotions, action process, and long-term identity state.

The goal is not simple story generation. The project tries to make a small town run like a continuing social system: AI modules judge local decisions, while local rules enforce world constraints, knowledge boundaries, movement, mortality, persistence, and permission checks.

## Current Features

- 100+ character town simulation.
- Per-character memory, relationships, multi-dimensional emotions, needs, long-term goals, and identity core.
- Date, weather, location institutions, location chains, runtime location state, and daily plans.
- Event propagation, relationship dynamics, social processes, obligations, family sync, and profession services.
- Multi-key routing, batched parallel calls, retry handling, and per-Agent / per-character model settings.
- Folder-based saves with per-character files, memory files, and AG judgement files.
- Local AI support through OpenAI-compatible APIs such as Ollama, LM Studio, vLLM, and llama.cpp server.
- Browser UI, read-only monitor UI, and Expo mobile app.

## Run

On Windows, use:

```bat
start-ai-town-v2.cmd
```

Then open:

```text
http://localhost:8788/
```

LAN access:

- The server listens on `0.0.0.0` by default.
- The launcher prints `LAN: http://your-pc-ip:8788`.
- Open that address from a phone or another computer on the same Wi-Fi.
- If it does not load, allow Node.js or TCP `8788` through Windows Firewall.

Manual startup:

```bash
npm start
```

## First Setup

Open settings on first launch:

- Cloud AI: set API base URL, model, and API keys.
- Local AI: set an OpenAI-compatible `/v1` base URL; the API key can be empty.
- Per-key concurrency, batch size, auto interval, and virtual minutes per step are configurable.

Common local AI URLs:

- Ollama: `http://localhost:11434/v1`
- LM Studio: `http://localhost:1234/v1`
- vLLM / llama.cpp server: use the corresponding OpenAI-compatible `/v1` endpoint

Local settings are written to `ai-town-config.json`, which is ignored by Git.

## Main UI

- Save manager: create, load, and delete save folders.
- Town map: inspect places and character positions.
- Character panel: inspect needs, emotions, relationships, memories, goals, current action, and event queue.
- Settings panel: configure AI endpoint, models, key pool, concurrency, and per-Agent models.
- Call log: inspect model calls, keys, latency, success, failure, and retry state.
- Per-cycle flow: inspect the current Tick call chain and parallel stages.
- Relationship web: inspect family, acquaintance, coworker, classmate, and social relationships.

## Runtime Flow

The simulation core now runs in Node. The browser displays and controls the simulation; the server advances the world.

Each round roughly does this:

1. Load save and runtime state.
2. Life Engine handles simple local actions such as eating, sleeping, moving, and resting.
3. Context Agents update location, process, profession service, and social-pattern context.
4. Pre-judgement Agents run need intent, context rules, crisis triage, knowledge checks, and outcome checks.
5. Scheduler selects characters for the round.
6. AgentAction generates character actions.
7. TimePassage judges duration, remaining time, and cross-round process state.
8. WorldMaster and WorldGuard validate whether the action can happen in the current world.
9. StateSettlement applies needs, emotions, memories, relationships, and location effects.
10. Post Agents update event impact, information propagation, relationship dynamics, and social processes.
11. Node Core advances time, sleep, physiology, basic care, movement arrival, and mortality checks.
12. Save files are written back to the save folder.

At midnight, the server also runs social embedding, location institutions, daily plans, self narrative, personality consistency, and memory reflection.

## Key Files

- `ai-town-v2-server.js`: Node server, runtime controller, and AI proxy.
- `ai-town-node-core.js`: local time, physiology, movement, and mortality progression.
- `ai-town-life-engine.js`: simple life actions and plan execution.
- `ai-town-interruptions.js`: crisis interruption and low-state preference logic.
- `ai-town-memory-stream.js`: memory write, retrieval, and daily reflection.
- `ai-town-world-master.js` / `ai-town-world-guard.js`: action validation.
- `ai-town-v2.html`: desktop browser UI.
- `ai-town-monitor.html`: read-only monitor UI.
- `mobile-app/`: Expo mobile app.
- `scripts/`: local check scripts.

## Local Files

These are intentionally not uploaded:

- `ai-town-config.json`
- `.env`
- `saves/`
- `certs/`
- `node_modules/`
- `mobile-app/android/`
- `mobile-app/.gradle-local/`

## Checks

```bash
npm run check:all
npm run check:life
npm run check:life-engine
npm run check:memory
```

## Note

This is a local demo and research prototype, not a production system. Local guards constrain AI output, but simulation quality still depends on model capability, prompt quality, and API stability.

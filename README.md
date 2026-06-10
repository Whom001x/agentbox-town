# AgentBox Town

AgentBox Town is an experimental AI virtual town simulator. Each character lives inside an independent AgentBox with its own position, schedule, relationships, memories, needs, emotions, event queue, action process, and long-term personality state.

The project focuses on believable multi-agent town simulation rather than simple story generation. AI modules judge local decisions, while local guards enforce world rules, knowledge boundaries, movement, mortality, and persistence.

## Features

- Multi-agent virtual town with 100+ character support
- Per-character memory, relationships, emotions, needs, identity core, and long-term goals
- Weather, date, location institutions, location chains, and location runtime state
- Event propagation, relationship dynamics, social processes, obligations, and family sync
- Parallel AI task batching with configurable key pool and per-key concurrency
- Folder-based save system with per-character files and AG judgement files
- WorldGuard local validation to reduce hidden NPCs, omniscient knowledge, teleportation, and impossible actions

## Run

```bat
start-ai-town-v2.cmd
```

Then open:

```text
http://localhost:8788/
```

On first launch, configure your AI base URL, model, and API keys in the app settings.

## Configuration

`ai-town-config.json` is intentionally ignored by Git because it may contain API keys.

Use `ai-town-config.example.json` as a reference only. Do not commit real keys.

## Main Files

- `ai-town-v2.html` - frontend UI and simulation loop
- `ai-town-v2-server.js` - local Node.js API server and AI proxy
- `start-ai-town-v2.cmd` - Windows launcher
- `AI虚拟小镇V2项目说明.md` - project design notes

## Notes

This is a local demo and research prototype. It is not production hardened. AI outputs are constrained by prompts and local validation, but the simulator still depends on model quality and configured API reliability.

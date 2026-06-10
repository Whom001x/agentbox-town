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

## Per-Cycle Call Graph

GitHub renders the following Mermaid charts directly in the repository page. The call graph is split into smaller sections so GitHub's Mermaid renderer can lay it out reliably.

Main cycle:

```mermaid
flowchart TD
  A[Cycle Start] --> B[Snapshot Lock]
  B --> C[Weather Agent]
  C --> D[Location Event and Daily Plan]
  D --> E[Location Chain Agent]
  E --> F[Location Runtime and Social Pattern]
  F --> G[Process Manager Agent]
  G --> H[Pre-Judgement Agents]
  H --> I[Scheduler]
  I --> J[Agent Action]
  J --> K[Time Passage Agent]
  K --> L[State Settlement Agent]
  L --> M[WorldGuard and Reducer]
  M --> N[Event Impact Chain]
  N --> O[Post Agents]
  O --> P[Local Time Advance]
  P --> Q[Sleep and Basic Life]
  Q --> R[Time Decay Agent]
  R --> S[Movement and Location Influence]
  S --> T[Need and Emotion Coupling]
  T --> U[Mortality Check]
  U --> V[Family Sync]
  V --> W{New Day}
  W -->|No| X[Auto Save]
  W -->|Yes| Y[Daily Settlement]
  Y --> X
```

Pre-judgement fan-in:

```mermaid
flowchart LR
  A[Need Intent] --> F[Scheduler]
  B[Context Rule] --> F
  C[Crisis Triage] --> F
  D[Knowledge Judge] --> F
  E[Outcome Judge] --> F
  F --> G[Action Queue]
```

Event and post-action chain:

```mermaid
flowchart TD
  A[WorldGuard Approved Result] --> B[Event Impact Agent]
  B --> C[Information Propagation Agent]
  C --> D[Relationship Dynamics Agent]
  D --> E[Social Process Agent]
  E --> F[MultiDimensional State Agent]
  E --> G[Obligation Agent]
  E --> H[Reporter]
  F --> I[State Applied]
  G --> I
  H --> I
```

Midnight settlement:

```mermaid
flowchart TD
  A[Daily Structural Settlement] --> B[Social Embedding Agent]
  A --> C[Location Institution Agent]
  B --> D[Location Daily Agent]
  C --> D
  D --> E[Location Chain Agent]
  E --> F[Daily Planner]
  F --> G[Self Narrative Agent]
  G --> H[Personality Consistency Agent]
  H --> I[Daily Memory Decay]
  I --> J[Auto Save]
```

## Run

Requirements:

- Windows is recommended for `start-ai-town-v2.cmd`
- Node.js 18 or newer
- No npm dependencies are required

```bat
start-ai-town-v2.cmd
```

Then open:

```text
http://localhost:8788/
```

On first launch, configure your AI base URL, model, and API keys in the app settings.

Manual startup:

```bash
npm start
```

## Configuration

There are two supported configuration paths.

In-app configuration:

- Open `http://localhost:8788/`
- Open settings
- Fill in AI base URL, model, API keys, concurrency, tick interval, and batch size
- The server writes `ai-town-config.json`

Environment variables:

- Copy `.env.example` only as a reference; the server does not auto-load `.env`
- Start manually with `npm start` or `node ai-town-v2-server.js`
- `start-ai-town-v2.cmd` intentionally clears inherited AI environment variables so a fresh checkout opens in setup mode

Important local files:

- `ai-town-config.json` - generated local AI settings; ignored by Git
- `saves/` - local save folders; ignored by Git
- `.env` and `.env.local` - optional private environment files; ignored by Git

Main environment variables:

| Name | Purpose | Default |
| --- | --- | --- |
| `AI_TOWN_V2_PORT` | Local server port | `8788` |
| `AI_TOWN_API_KEYS` | Comma/newline/semicolon separated AI keys | empty |
| `AI_TOWN_BASE_URL` | OpenAI-compatible base URL | `https://api.openai.com/v1` |
| `AI_TOWN_MODEL` | Default model | `gpt-4.1-mini` |
| `AI_TOWN_MAX_CONCURRENT_PER_KEY` | Per-key request concurrency | `20` |
| `AI_TOWN_TIMEOUT_MS` | Upstream request timeout | `180000` |
| `AI_TOWN_MAX_REQUEST_BODY_BYTES` | Max local API body size | `10000000` |
| `AI_TOWN_RETRY_DELAY_MS` | Retry wait for temporary upstream errors | `300` |

Never commit real API keys.

## Main Files

- `ai-town-v2.html` - frontend UI and simulation loop
- `ai-town-v2-server.js` - local Node.js API server and AI proxy
- `start-ai-town-v2.cmd` - Windows launcher
- `package.json` - Node.js scripts and engine requirement
- `.env.example` - optional environment variable reference
- `ai-town-config.example.json` - local config file reference
- `AI虚拟小镇V2项目说明.md` - project design notes

## Notes

This is a local demo and research prototype. It is not production hardened. AI outputs are constrained by prompts and local validation, but the simulator still depends on model quality and configured API reliability.

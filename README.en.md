# AgentBox Town

[中文](README.md) | **English**

Changelog: [CHANGELOG.md](CHANGELOG.md)

AgentBox Town is a multi-agent virtual town simulator. It places many AI residents inside one persistent town world. Each resident has a location, schedule, relationships, memory, needs, emotions, long-term goals, self model, and action process.

The goal is not only to generate stories. The project aims to simulate a small social system where local rules handle world constraints, knowledge boundaries, movement, death, saves, and authority checks, while AI handles local judgement, subjective choices, and complex social events.

## Current Version

**V3.1 Identity Evolution Engine + V3.0.5 Character Genesis + V3.0 Cognitive Decision Engine**

V3.0.5 upgrades the setup stage. New residents now start with distinct personality foundations, cognitive profiles, behavior tendencies, life history, initial beliefs, habits, preferences, fears, goals, and relationship intent. These fields are saved and later feed into the V3 Cognitive Decision Engine.

V3.1 upgrades runtime identity growth. A resident does not become a different person after one event. Every midnight, recent experiences slowly update belief, habit, preference, selfModel, and cognitiveProfile. Repeated experiences can gradually shift risk tolerance, social drive, patience, confidence, and behavioral inertia.

Town creation now runs as:

```text
user input
↓
SetupBlueprint
↓
CharacterSeedAgent
↓
SetupAgentBatch
↓
CharacterConsistencyAgent
↓
setupMakeAgent
↓
Vector initialization
↓
save files
```

The V3.0 runtime decision flow remains:

Residents no longer act by directly mapping low needs to actions. The runtime now uses:

```text
character state
↓
CognitiveState
↓
candidate actions
↓
action vector matching
↓
mixed utility score
↓
softmax selection
↓
AgentAction
↓
WorldGuard / StateSettlement
↓
EventLog / MemoryGate / MemoryConsolidator
↓
DailyReflection / IdentityEvolution
↓
slow personality and memory update
```

## Capabilities

- Supports 100+ residents in one town simulation.
- Each resident has multidimensional needs, emotions, relationships, long-term goals, identity core, self model, and behavior weights.
- V3.1 long-term identity evolution: experience slowly forms beliefs, habits, preferences, self understanding, and cognitive profile drift.
- V3.0 cognitive decision making: `needs` affect attention, patience, risk tolerance, social tendency, and goal persistence instead of directly selecting actions.
- Supports Structured Memory, Vector Memory, MemoryGate, daily reflection, and slow personality updates.
- Supports local embedding models such as LM Studio at `http://127.0.0.1:12346/v1` with `text-embedding-bge-m3@q8_0`.
- Supports location institutions, location event chains, runtime location states, weather, dates, and daily plans.
- Supports event propagation, relationship inertia, social processes, obligations, family sync, and professional services.
- Supports multi-key routing, batched concurrency, retry loops, and per-Agent / per-role model configuration.
- Supports folder-based saves: every save is a folder, with agents, memories, and judgement files separated.
- Supports the PC browser UI, read-only monitor UI, and Expo mobile app.

## V3.0 Decision Model

### CognitiveState

New module:

```text
ai-town-cognitive-state.js
```

Input:

```text
needs
emotionVector
emotionCause
selfModel
goalRuntime
structuredMemory
relationshipMatrix
context
```

Output:

```json
{
  "perceptionWeights": {},
  "driveVector": {},
  "biasVector": {},
  "actionModifiers": {}
}
```

Example: hunger does not directly trigger eating. It changes cognition:

```json
{
  "patience": -0.3,
  "foodAttention": 0.7,
  "irritability": 0.2,
  "socialSeeking": 0.1
}
```

### Decision Weights

Each resident has:

```json
{
  "decisionWeights": {
    "memory": 0.7,
    "persona": 0.8,
    "emotion": 0.5,
    "novelty": 0.3,
    "goal": 0.9,
    "social": 0.4
  }
}
```

These weights are part of the calculation, not prompt decoration. In the same situation, a detective, elder, child, artist, and shop owner can naturally choose different actions.

### Action Vector Matching

Each candidate action has an `actionVector`:

```json
{
  "comfort": 0.8,
  "duty": 0.2,
  "social": 0.5,
  "risk": 0.3,
  "novelty": 0.1
}
```

The engine compares it with the resident's current `driveVector`.

### Mixed Score

V3.0 uses two groups:

```text
A = memory + persona + emotion + goal + novelty + social
B = safety * cost * distance * time * locationRule * availability

Score = A * B + Noise
```

`B` represents reality constraints. Risk, cost, distance, time, location rules, and availability cannot be fully overridden by personality or memory.

### Softmax Selection

The engine does not always choose the highest score. It uses Softmax. Personality affects temperature:

```text
cautious residents: lower temperature, more stable choices
impulsive residents: higher temperature, more random choices
```

## Memory System

Event and memory are separated:

```text
EventLog
↓
MemoryGate
↓
MemoryConsolidator
↓
Structured Memory / Vector Memory
```

Rules:

- Routine eating, sleeping, commuting, working, and class attendance only enter EventLog.
- Repeated patterns can become habits.
- Abnormal events become experience / episodic memory.
- High-impact events can form beliefs.
- Relationship events create relationshipMemory.
- Vector Memory is only associative recall. It is not a fact source and cannot directly change the world.

## V3.1 Identity Evolution

New module:

```text
ai-town-identity-evolution.js
```

It runs every midnight:

```text
EventLog / Structured Memory / EmotionCause / GoalRuntime / Relationship
↓
IdentityEvolution
↓
beliefMemory / habitMemory / preferenceMemory
↓
selfModel / cognitiveProfile / behaviorTendency
↓
next CognitiveState and Utility Scheduler
```

Rules:

- Ordinary eating, sleeping, commuting, working, and studying do not directly change identity.
- Repeated failure slightly increases caution and risk avoidance.
- Repeated success slightly increases confidence, patience, and goal persistence.
- Long-term help raises support-seeking, trust, and relationship preference.
- Long-term loneliness changes social tendency.
- Learning rate depends on life stage: children change fastest, elders slowest.
- Every applied change is written to `identityChangeLog`, so you can inspect why a resident changed.

## Run

On Windows:

```bat
start-ai-town-v2.cmd
```

Open:

```text
http://localhost:8788/
```

Manual start:

```bash
npm start
```

LAN access:

- The server listens on `0.0.0.0` by default.
- Use `http://YOUR_LAN_IP:8788/` on another device in the same Wi-Fi.
- If it cannot connect, allow Node.js or TCP `8788` through Windows Firewall.

## AI Configuration

Cloud AI:

```text
Base URL: https://api.openai.com/v1 or another compatible endpoint
Model: model name
API Key: your key
```

Local AI:

```text
Ollama: http://localhost:11434/v1
LM Studio: http://localhost:1234/v1
vLLM / llama.cpp server: compatible /v1 endpoint
```

Local vector model example:

```text
Vector Base URL: http://127.0.0.1:12346/v1
Vector Model: text-embedding-bge-m3@q8_0
```

Local configuration is written to `ai-town-config.json`, which is ignored by Git.

## Main UI

- Save manager: create, load, and delete saves.
- Town map: show locations and resident positions.
- Resident panel: inspect needs, emotions, relationships, memories, goals, actions, and event queues.
- Settings panel: configure AI endpoints, models, key pool, concurrency, and Agent models.
- Call log: inspect model calls, keys, duration, success, failure, and retries.
- Per-turn flow: inspect the Agent call chain and concurrency status.
- Relationship web: inspect family, familiar, coworker, classmate, and social relationships.
- Mobile app: landscape game-HUD style town monitor and interaction UI.

## Runtime Flow

The simulation core runs in Node. The browser mainly displays and controls it.

Per step:

1. Read save.
2. StateMigration fills selfModel, goalRuntime, emotionCause, and memory layers.
3. LifeEngine handles deterministic routine life actions.
4. CandidateBuilder selects residents that need thought.
5. MemoryRecall retrieves structuredMemory and vectorMemory.
6. PersonalityRuntime builds current personality state.
7. CognitiveState builds cognitive drives.
8. UtilityScheduler performs action-vector matching, mixed scoring, and Softmax selection.
9. AgentAction generates subjective action.
10. WorldGuard / WorldMaster checks whether the action can happen.
11. StateSettlement settles location, needs, emotions, relationships, and location effects.
12. EventLog records factual events.
13. MemoryGate decides whether an event enters long-term memory.
14. MemoryConsolidator creates structured and vector memory.
15. Save to the save folder.

Daily midnight jobs handle social embedding, location institutions, daily plans, self narrative, personality consistency, and reflection.

## Key Files

- `ai-town-v2-server.js`: Node server, runtime controller, and AI proxy.
- `ai-town-cognitive-state.js`: V3.0 cognitive state, action vectors, and reality constraints.
- `ai-town-utility-scheduler.js`: V3.0 action scoring and Softmax selection.
- `ai-town-memory-stream.js`: EventLog, MemoryGate, MemoryConsolidator, reflection, and retrieval.
- `ai-town-personality-runtime.js`: personality runtime state.
- `ai-town-life-engine.js`: deterministic routine actions and plan execution.
- `ai-town-node-core.js`: time, physiology, movement, death, and local world progression.
- `ai-town-world-master.js` / `ai-town-world-guard.js`: action grounding checks.
- `ai-town-v2.html`: PC browser UI.
- `mobile-app/`: Expo mobile app.
- `scripts/`: local check scripts.

## Checks

```bash
npm run check:cognitive-decision
npm run check:cognitive-loop
npm run check:memory-gate
npm run check:personality-runtime
npm run check:personality-loop
npm run check:utility-scheduler
npm run check:life
npm run check:life-engine
npm run check:all
```

## Ignored Local Files

- `ai-town-config.json`
- `.env`
- `saves/`
- `certs/`
- `node_modules/`
- `mobile-app/android/`
- `mobile-app/.gradle-local/`

## Note

This is a local demo and research prototype, not a production system. AI output is constrained by local guards, but simulation quality still depends on model capability, prompt quality, API stability, and save scale.

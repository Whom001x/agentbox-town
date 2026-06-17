# AgentBox Town

[中文](README.md) | **English**

Changelog: [CHANGELOG.md](CHANGELOG.md)

AgentBox Town is a multi-agent virtual town simulator. It places many AI residents inside one persistent town world. Each resident has a location, schedule, relationships, memory, needs, emotions, long-term goals, self model, and action process.

The goal is not only to generate stories. The project aims to simulate a small social system where local rules handle world constraints, knowledge boundaries, movement, death, saves, and authority checks, while AI handles local judgement, subjective choices, and complex social events.

## Current Version

**V3.3.5 Relationship Memory Formation + V3.3.4 Temporal Causal Graph + V3.3.3.1 Memory Importance Calibration + V3.3.3 Memory Gate + V3.3.2.1 Medical Recovery + V3.3.2 Context Boundary + V3.3.1 Social Feedback**

### V3.3.5 Relationship Memory Formation

Adds long-term relationship memory formation. `relationshipMatrix` still stores numeric relationship state, while meaningful interactions now pass through `MemoryImportanceGate` and can become `relationshipMemory` with target, relationship type, trust, familiarity, emotional tag, interaction count, last interaction time, source events, and relationship cause. Ordinary greetings, small talk, and passing by stay out of long-term memory; help, conflict, cooperation, promises, repair, and danger events create traceable relationship causes and influence future actions such as `contact_familiar`, `ask_help`, `avoid_person`, and `cooperate`.

### V3.3.4 Temporal Causal Graph

Adds a temporal causal graph layer. The world no longer stores only `EventLog`; high-strength events now create `causalGraph` chains such as `event -> action -> stateChange -> belief/goal/relationship`. Ordinary low-impact events do not create causal edges. Every edge enforces cause time before effect time, repeated similar chains reinforce `patterns`, daily Reflection reads causal chains to produce `lessonLearned` and `counterfactual`, and long-term memory can trace back through `sourceCausalChain`.

### V3.3.3.1 Memory Importance Calibration

Calibrates the long-term memory importance layer. `MemoryImportanceGate` now uses calibrated `V_event`, `V_emotion`, `V_relation`, and `V_goal`, with `(V + 1e-6)^w * contextFactor * timeFactor` for long-term write probability. The release adds log scaling / quantile normalization, emotion valence, type-specific temporal decay, and similar-memory compression to keep ordinary events, medical sightings, and system residue out of personality memory.

### V3.3.3 Memory Importance Gate

Long-term memory writes now use a multiplicative gate. Event strength, emotion delta, relationship impact, goal impact, and context must work together before an event can become belief, habit, preference, episodic, or relationship memory. Ordinary daily actions and low-impact medical sightings remain in EventLog only, while real help, conflict, promises, trust changes, and goal impact can enter long-term memory.

### V3.3.2.1 Medical Settlement & Recovery

Fixes the health loop. Health now uses `critical / poor / normal / healthy`, and the clinic performs medical assessment, queueing, treatment, and multi-day recovery. Doctors work day duty and night on-call; sleep provides only small recovery; `afterTreatmentCooldown` prevents residents from being pulled back into `seek_care` immediately after treatment.

### Runtime Reliability & Generation Status

Adds a global AI rate limiter with exponential backoff and jitter so multiple Agent calls do not hit provider limits at the same time. The main UI now shows generation status: red means still generating, green means ready to start.

### V3.3.2 Context Boundary & Runtime Compression

This release focuses on runtime context growth in large towns. The new `ContextBuilder` converts full world state into lightweight views for AgentAction, World Agents, Social Agents, and Scheduler. Default budgets are `worldAgent=12000`, `socialAgent=10000`, `scheduler=8000`, and `agentAction=6000`. Raw memory, vector embeddings, full `cognitiveState`, `debugDecision`, and `relationshipMatrix` no longer enter model prompts. Runtime also writes a `runtime/contextCache.json` summary cache, and `judgementBatchSize` now controls Node-side batching for large requests.

### V3.3.1 Social Feedback & Stability

Adds a social feedback stability layer. Events propagate through the information system, change the social field, and then modulate each resident's cognitive state and action scoring through `SocialFeedback`. Social influence does not overwrite personality or factual memory; it is regulated by `socialSensitivity` and `tanh` before affecting caution, curiosity, help-seeking, avoidance, and responsibility.

### V3.3 Social Dynamics

Adds social fields and probabilistic information propagation. Events are not automatically known by everyone; they spread through relationship strength, spatial proximity, trust, emotional intensity, information type, and social pressure. Medical, death, and disaster events spread more strongly while still preserving delay, distortion, and incomplete information.

### V3.2.1 Action Eligibility + V3.2 Cognitive State

V3.2.1 adds an eligibility layer before Scheduler so actions that do not fit age, identity, location, relationship, profession, or emergency conditions are removed before scoring. V3.2 merges needs, emotions, memories, goals, personality, and social feedback into `CognitiveState`, generating desires and cognitive bias before Utility Scheduler selects an action.

### V3.1.5 Character Genesis

Upgrades the setup stage. New residents now start with distinct identity foundations, `lifeHistorySeed`, cognitive profiles, behavior tendencies, birth beliefs, habits, preferences, meaningful episodic memory, self model, goal runtime, and relationship intent. These fields are saved and feed into the V3 Cognitive Decision Engine and V3.1 Identity Evolution from day one.

### V3.1 Identity Evolution

Upgrades runtime identity growth. A resident does not become a different person after one event. Every midnight, recent experiences slowly update belief, habit, preference, selfModel, and cognitiveProfile. Repeated experiences can gradually shift risk tolerance, social drive, patience, confidence, and behavioral inertia.

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

Minimum V3.1.5 resident genesis structure:

```text
lifeHistorySeed
beliefMemory
habitMemory
preferenceMemory
episodicMemory
selfModel
cognitiveProfile
goalRuntime
agentSchemaVersion: "3.1.5"
```

These fields are personality sources, not plot generation. Ordinary eating, sleeping, commuting, working, and studying are not written as identity memory.

### V3.0 Cognitive Decision Engine

The runtime decision flow remains:

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
- V3.3.4 temporal causal graph: high-strength events form `causalGraph` chains so Reflection and long-term memory can trace why an event changed future behavior.
- V3.3.3.1 memory importance calibration: distribution normalization, emotion valence, temporal decay, and similar-memory compression keep long-term memory growth stable.
- V3.3.3 multiplicative MemoryGate: event strength, emotion, relationship, goal, and context jointly decide whether an event enters long-term personality memory.
- V3.3.2.1 medical recovery loop: clinic capacity, doctor duty, treatment queue, recovery timeline, and after-treatment cooldown close the health loop.
- V3.3.2 context boundary: World/Social/Scheduler/AgentAction use specialized lightweight views instead of sending full agents, raw memory, vector embeddings, or debug fields into prompts.
- V3.3.1 social feedback stability: the social field modulates cognition and action scoring through `SocialFeedback` while `socialSensitivity` preserves personality continuity.
- V3.3 social dynamics: information spreads probabilistically through relationships, space, trust, and emotional intensity, forming fear, curiosity, rumors, trust, and social tension.
- V3.2.1 action eligibility: age, identity, profession, location, relationship, and emergency state filter invalid actions before scoring.
- V3.2 cognitive state field: `CognitiveState` turns needs, emotions, memory, goals, and personality into current psychological drive.
- Each resident has multidimensional needs, emotions, relationships, long-term goals, identity core, self model, and behavior weights.
- V3.1.5 character genesis: new residents are born with `lifeHistorySeed`, `beliefMemory`, `habitMemory`, `preferenceMemory`, `episodicMemory`, `selfModel`, and `goalRuntime`.
- V3.1 long-term identity evolution: experience slowly forms beliefs, habits, preferences, self understanding, and cognitive profile drift.
- V3.0 cognitive decision making: `needs` affect attention, patience, risk tolerance, social tendency, and goal persistence instead of directly selecting actions.
- Supports Structured Memory, Vector Memory, MemoryGate, daily reflection, and slow personality updates.
- Supports local embedding models such as LM Studio at `http://127.0.0.1:12346/v1` with `text-embedding-bge-m3@q8_0`.
- Supports global AI rate limiting, exponential backoff, jitter, key cooldown, and generation status indicators in the main UI.
- Supports location institutions, location event chains, runtime location states, weather, dates, and daily plans.
- Supports event propagation, relationship inertia, social processes, obligations, family sync, and professional services.
- Supports multi-key routing, batched concurrency, retry loops, and per-Agent / per-role model configuration.
- Supports `contextBudget` and `judgementBatchSize` to control prompt size and large-request batching.
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

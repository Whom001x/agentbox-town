"use strict";

const COGNITIVE_KERNEL_VERSION = "3.4.1-A.3";
const REQUIRED_COMMITTERS = [
  "memory",
  "longMemory",
  "needs",
  "emotion",
  "emotionCause",
  "action",
  "relationship",
  "identity",
  "causalGraph",
  "causalMemory",
  "expectationMemory",
  "causalCandidate"
];
const auditedTargets = new Set([
  "memory",
  "longMemory",
  "beliefMemory",
  "habitMemory",
  "preferenceMemory",
  "episodicMemory",
  "relationshipMemory",
  "reflectionMemory",
  "causalMemory",
  "needs",
  "emotion",
  "emotionCause",
  "action",
  "relationship",
  "identity",
  "expectationMemory",
  "causalCandidate"
]);
const committers = new Map();
const committerRegistry = new Map();

function num(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function registerCognitiveWriteCommitter(target, fn, metadata = {}) {
  if (!target || typeof fn !== "function") return;
  const key = String(target);
  committers.set(key, fn);
  committerRegistry.set(key, {
    target: key,
    version: metadata.version || COGNITIVE_KERNEL_VERSION,
    module: metadata.module || metadata.source || "unknown",
    registeredAt: new Date().toISOString()
  });
}

function clamp(value, min, max, fallback = min) {
  const number = num(value, fallback);
  return Math.max(min, Math.min(max, number));
}

function stablePart(value = "") {
  return String(value || "unknown")
    .replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]+/g, "_")
    .slice(0, 72);
}

function writeText(change = {}) {
  if (typeof change === "string") return change;
  return [
    change.text,
    change.summary,
    change.belief,
    change.habit,
    change.preference,
    change.event,
    change.observation,
    change.interpretation,
    change.beliefChange,
    change.learning?.causalRule,
    change.learning?.causalBelief
  ].filter(Boolean).join(" ");
}

function cognitiveTick(world = {}, write = {}, change = {}) {
  return num(change.tick ?? change.timestamp ?? change.clock ?? change.at ?? write.timestamp ?? world.clock ?? 0, 0);
}

function stampCognitivePayload(payload = {}, write = {}, world = {}) {
  if (!payload || typeof payload !== "object") return payload;
  const copy = Array.isArray(payload) ? payload.slice() : { ...payload };
  copy.source ||= String(write.source || "unknown");
  copy.confidence = copy.confidence == null ? num(write.confidence, 0.5) : copy.confidence;
  copy.tick = copy.tick == null ? cognitiveTick(world, write, copy) : copy.tick;
  copy.kernelVersion ||= COGNITIVE_KERNEL_VERSION;
  return copy;
}

function committerSnapshot() {
  return Object.fromEntries([...committerRegistry.entries()].map(([target, meta]) => [target, { ...meta }]));
}

function cognitiveKernelRuntimeStatus(required = REQUIRED_COMMITTERS) {
  const registeredTargets = [...committerRegistry.keys()].sort();
  const missing = required.filter(target => !committers.has(target));
  const mismatched = required
    .map(target => committerRegistry.get(target))
    .filter(meta => meta && meta.version !== COGNITIVE_KERNEL_VERSION)
    .map(meta => ({ target: meta.target, version: meta.version, expected: COGNITIVE_KERNEL_VERSION }));
  return {
    version: COGNITIVE_KERNEL_VERSION,
    ok: missing.length === 0 && mismatched.length === 0,
    requiredTargets: required.slice(),
    registeredTargets,
    missing,
    mismatched,
    committers: committerSnapshot()
  };
}

function assertCognitiveKernelRuntimeReady(world = {}, required = REQUIRED_COMMITTERS) {
  const status = cognitiveKernelRuntimeStatus(required);
  world.cognitiveKernelRuntime = status;
  if (!status.ok) {
    const error = new Error(`Cognitive kernel runtime check failed: missing=${status.missing.join(",") || "none"} mismatched=${status.mismatched.map(item => `${item.target}:${item.version}`).join(",") || "none"}`);
    error.status = 503;
    error.type = "kernel_runtime_not_ready";
    error.kernelStatus = status;
    throw error;
  }
  return status;
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function eventHashFor(agent = {}, detail = {}, clock = 0) {
  const tickWindow = Math.floor(num(clock, 0) / 180);
  const eventType = stablePart(detail.type || detail.actionType || detail.localAction || "event");
  const target = stablePart(detail.targetAgentId || detail.targetId || detail.place || detail.position || "");
  return `${stablePart(agent.id)}_${eventType}_${target}_${tickWindow}`;
}

function rejectionCache(world = {}) {
  world.cognitiveIntegrity ||= {};
  if (!Array.isArray(world.cognitiveIntegrity.rejectionCache)) world.cognitiveIntegrity.rejectionCache = [];
  return world.cognitiveIntegrity.rejectionCache;
}

function pruneRejectionCache(world = {}) {
  const clock = num(world.clock, 0);
  world.cognitiveIntegrity ||= {};
  world.cognitiveIntegrity.rejectionCache = rejectionCache(world).filter(item => num(item.expiresAt, 0) > clock);
  return world.cognitiveIntegrity.rejectionCache;
}

function isEventRejectedRecently(world = {}, agent = {}, detail = {}) {
  const clock = num(world.clock, detail.clock || 0);
  const hash = eventHashFor(agent, detail, clock);
  return pruneRejectionCache(world).some(item => item.hash === hash);
}

function rememberRejectedEvent(world = {}, agent = {}, event = {}, reason = "importance_failed") {
  const hash = event.eventHash || eventHashFor(agent, event, world.clock || event.clock || 0);
  const cache = pruneRejectionCache(world);
  const existing = cache.find(item => item.hash === hash);
  if (existing) {
    existing.reason = reason;
    existing.expiresAt = num(world.clock, event.clock || 0) + 3;
    return existing;
  }
  const item = {
    hash,
    agentId: agent.id || event.agentId || "",
    eventType: event.type || event.actionType || "",
    reason,
    expiresAt: num(world.clock, event.clock || 0) + 3
  };
  cache.unshift(item);
  world.cognitiveIntegrity.rejectionCache = cache.slice(0, 200);
  return item;
}

function sourceTrust(source = "") {
  const key = String(source || "").toLowerCase();
  if (/simulation|state|life-engine|node-runtime|world/.test(key)) return 0.95;
  if (/reflection/.test(key)) return 0.75;
  if (/local|engine|memory|causal/.test(key)) return 0.7;
  if (/llm|agent/.test(key)) return 0.55;
  return 0.5;
}

function invalidPerspective(text = "", agent = {}) {
  const value = String(text || "");
  if (!value) return false;
  if (/This person|Agent tends|Stable habit|Daily reflection|Followed plan|Because of/i.test(value)) return true;
  if (/该角色|该居民|这个人/.test(value)) return true;
  if (agent.name) {
    const name = escapeRegExp(agent.name);
    if (new RegExp(`观察到\\s*${name}|${name}\\s*刚|${name}\\s*正在`).test(value)) return true;
  }
  return false;
}

function sanitizeNumbers(value) {
  if (!value || typeof value !== "object") return value;
  const copy = Array.isArray(value) ? value.slice() : { ...value };
  Object.keys(copy).forEach(key => {
    if (typeof copy[key] === "number" && /need|health|hunger|hygiene|social|stress|comfort|safety|responsibility|strength|confidence|probability|progress/i.test(key)) {
      copy[key] = clamp(copy[key], 0, /progress|health|hunger|hygiene|social|stress|comfort|safety|responsibility/i.test(key) ? 100 : 1, copy[key]);
    } else if (copy[key] && typeof copy[key] === "object") {
      copy[key] = sanitizeNumbers(copy[key]);
    }
  });
  return copy;
}

function normalizeCognitiveWriteArgs(args) {
  if (args[0] && typeof args[0] === "object" && (args[0].payload !== undefined || args[0].target || args[0].agentId)) {
    const request = args[0];
    const world = request.world || {};
    const agent = request.agent || (Array.isArray(world.agents) ? world.agents.find(item => item.id === request.agentId) : null) || {};
    return {
      world,
      agent,
      write: {
        agentId: request.agentId || agent.id || "",
        source: request.source,
        target: request.target,
        operation: request.operation,
        change: request.payload,
        payload: request.payload,
        confidence: request.confidence,
        reason: request.reason,
        timestamp: request.timestamp
      },
      options: args[1] || request.options || {}
    };
  }
  const [world = {}, agent = {}, write = {}, options = {}] = args;
  const payload = write.payload !== undefined ? write.payload : write.change;
  return {
    world,
    agent,
    write: {
      ...write,
      agentId: write.agentId || agent?.id || "",
      operation: write.operation,
      change: payload,
      payload,
      timestamp: write.timestamp
    },
    options
  };
}

function appendWriteAudit(world = {}, agent = {}, write = {}, accepted = false, reason = "") {
  const entry = {
    tick: num(world.clock, write.timestamp ?? 0),
    agentId: write.agentId || agent?.id || "",
    source: String(write.source || ""),
    target: String(write.target || ""),
    accepted: Boolean(accepted),
    confidence: write.confidence,
    reason: String(reason || write.reason || "").slice(0, 180)
  };
  world.cognitiveWriteLog ||= [];
  world.cognitiveWriteLog.unshift(entry);
  world.cognitiveWriteLog = world.cognitiveWriteLog.slice(0, 1000);
  world.cognitiveIntegrity ||= {};
  world.cognitiveIntegrity.cognitiveWriteLog = world.cognitiveWriteLog.slice(0, 200);
  return entry;
}

function rejectWrite(world = {}, agent = {}, write = {}, reason = "rejected") {
  world.cognitiveIntegrity ||= {};
  const rejected = {
    rejected: true,
    source: write.source || "",
    target: write.target || "",
    reason
  };
  world.cognitiveIntegrity.lastRejectedWrite = rejected;
  world.cognitiveIntegrity.rejectedWrites ||= [];
  world.cognitiveIntegrity.rejectedWrites.unshift({
    ...rejected,
    agentId: write.agentId || agent?.id || "",
    tick: num(world.clock, write.timestamp ?? 0)
  });
  world.cognitiveIntegrity.rejectedWrites = world.cognitiveIntegrity.rejectedWrites.slice(0, 200);
  appendWriteAudit(world, agent, write, false, reason);
  return { ok: false, reason, write: null, rejected };
}

function guardCognitiveWrite(world = {}, agent = {}, write = {}) {
  const target = String(write.target || "");
  const source = String(write.source || "");
  const missing = [];
  if (!source) missing.push("source");
  if (!target) missing.push("target");
  if (write.confidence === undefined || write.confidence === null || !Number.isFinite(Number(write.confidence))) missing.push("confidence");
  if (write.change === undefined || write.change === null) missing.push("payload");
  if (missing.length) {
    return rejectWrite(world, agent, write, `missing_${missing.join("_")}`);
  }
  const confidence = clamp(write.confidence, 0, 1, sourceTrust(source));
  if (confidence < 0.2) return rejectWrite(world, agent, write, "low_confidence");
  if (target === "causalGraph" && !committers.has("causalGraph")) {
    return rejectWrite(world, agent, write, "missing_committer");
  }
  if (target === "causalMemory" && !committers.has("causalMemory")) {
    return rejectWrite(world, agent, write, "missing_committer");
  }

  let change = sanitizeNumbers(write.change);
  const clock = num(world.clock, 0);
  const changeTime = num(change.timestamp ?? change.clock ?? change.at ?? clock, clock);
  if (changeTime > clock + 1) return rejectWrite(world, agent, write, "future_write");

  if (target === "causalGraph" && change.fromTime != null && change.toTime != null && num(change.fromTime) >= num(change.toTime)) {
    return rejectWrite(world, agent, write, "future_causes_past");
  }

  const text = writeText(change);
  if (["action", "memory", "longMemory", "beliefMemory", "habitMemory", "preferenceMemory", "episodicMemory", "relationshipMemory", "reflectionMemory", "causalMemory"].includes(target)) {
    if (invalidPerspective(text, agent)) return rejectWrite(world, agent, write, "invalid_perspective");
  }
  if (target === "emotionCause") {
    const causes = Array.isArray(change.causes) ? change.causes : (change.cause ? [change.cause] : []);
    if (!causes.map(item => String(item || "").trim()).filter(Boolean).length) return rejectWrite(world, agent, write, "missing_emotion_cause");
    if (!source) return rejectWrite(world, agent, write, "missing_source");
    if (!Number.isFinite(Number(change.tick ?? change.at ?? change.timestamp ?? write.timestamp ?? world.clock))) return rejectWrite(world, agent, write, "missing_tick");
  }
  if (auditedTargets.has(target)) {
    change = stampCognitivePayload(change, write, world);
  }

  return {
    ok: true,
    reason: "accepted",
    write: {
      ...write,
      confidence,
      sourceTrust: sourceTrust(source),
      change,
      payload: change
    }
  };
}

function applyCognitiveChange(world = {}, agent = {}, write = {}) {
  const change = write.change;
  const customCommit = committers.get(String(write.target || ""));
  if (customCommit) {
    return customCommit({
      world,
      agent,
      agentId: write.agentId || agent?.id || "",
      source: write.source || "",
      target: write.target || "",
      payload: change,
      confidence: write.confidence,
      reason: write.reason || "",
      timestamp: write.timestamp
    });
  }
  if (write.target === "eventLog") {
    world.eventLog ||= [];
    agent.eventLog ||= [];
    world.eventLog.unshift(change);
    world.eventLog = world.eventLog.slice(0, 2000);
    agent.eventLog.unshift(change);
    agent.eventLog = agent.eventLog.slice(0, 120);
    return change;
  }
  if (write.target === "reflectionMemory") {
    agent.reflectionMemory ||= [];
    agent.reflectionMemory.unshift(change);
    agent.reflectionMemory = agent.reflectionMemory.slice(0, 40);
    return change;
  }
  if (write.target === "causalMemory") return rejectWrite(world, agent, write, "missing_committer");
  if (write.target === "causalGraph") return rejectWrite(world, agent, write, "missing_committer");
  return change;
}

function cognitiveWrite(...args) {
  const { world, agent, write, options } = normalizeCognitiveWriteArgs(args);
  const guarded = guardCognitiveWrite(world, agent, write);
  if (!guarded.ok) return guarded;
  appendWriteAudit(world, agent, guarded.write, true, guarded.write.reason || guarded.reason);
  if (options.apply === false) return guarded;
  return { ...guarded, applied: applyCognitiveChange(world, agent, guarded.write) };
}

function clampEmotionDelta(value, limit = 8) {
  const number = num(value, 0);
  return Math.max(-limit, Math.min(limit, number));
}

const needKeys = ["hunger", "hygiene", "health", "social", "responsibility", "stress", "comfort", "safety"];

function clampNeedDelta(value, limit = 20) {
  const number = num(value, 0);
  return Math.max(-limit, Math.min(limit, number));
}

registerCognitiveWriteCommitter("needs", ({ agent, payload }) => {
  if (!agent?.id) return null;
  agent.needs ||= {};
  const delta = payload?.delta && typeof payload.delta === "object" ? payload.delta : payload || {};
  Object.entries(delta).forEach(([key, value]) => {
    if (!needKeys.includes(key)) return;
    const before = num(agent.needs[key], 70);
    agent.needs[key] = clamp(before + clampNeedDelta(value), 0, 100, before);
  });
  return agent.needs;
}, { module: "cognitive-integrity" });

registerCognitiveWriteCommitter("emotion", ({ agent, payload }) => {
  agent.emotionVector ||= agent.emotions || {};
  Object.entries(payload?.delta || payload || {}).forEach(([key, value]) => {
    if (!/^[a-zA-Z_\-\u4e00-\u9fa5]+$/.test(String(key || ""))) return;
    const before = num(agent.emotionVector[key], 50);
    agent.emotionVector[key] = clamp(before + clampEmotionDelta(value), 0, 100, before);
  });
  agent.emotions = agent.emotionVector;
  return agent.emotionVector;
}, { module: "cognitive-integrity" });

registerCognitiveWriteCommitter("relationship", ({ world, agent, payload }) => {
  const targetId = String(payload?.to || payload?.targetAgentId || payload?.targetId || "");
  if (!agent?.id || !targetId) return null;
  if (Array.isArray(world?.agents) && !world.agents.some(item => item.id === targetId)) return null;
  agent.relationshipMatrix ||= {};
  agent.relationshipMatrix[targetId] ||= {};
  const allowed = ["trust", "intimacy", "respect", "debt", "resentment", "dependency", "rivalry", "familiarity"];
  const appliedDelta = {};
  allowed.forEach(key => {
    const delta = clamp(num(payload[key], 0), -4, 4, 0);
    if (!delta) return;
    const before = num(agent.relationshipMatrix[targetId][key], 0);
    agent.relationshipMatrix[targetId][key] = clamp(before + delta, 0, 100, before);
    appliedDelta[key] = delta;
  });
  agent.relationshipMatrix[targetId].lastReason = String(payload.reason || "relationship update").slice(0, 80);
  agent.relationshipMatrix[targetId].lastInteractionTime = num(world?.clock, payload.tick || payload.at || 0);
  return { targetId, appliedDelta, relationship: agent.relationshipMatrix[targetId] };
}, { module: "cognitive-integrity" });

registerCognitiveWriteCommitter("action", ({ payload }) => payload || null, { module: "cognitive-integrity" });

function requestNeedUpdate(world, agent, delta = {}, source = "state", reason = "needs update", confidence = 0.85) {
  return cognitiveWrite({
    world: world || { clock: 0, agents: agent?.id ? [agent] : [] },
    agent,
    agentId: agent?.id || "",
    source,
    target: "needs",
    payload: { delta },
    confidence,
    reason,
    timestamp: world?.clock || 0
  });
}

function requestEmotionUpdate(world, agent, delta = {}, source = "state", reason = "emotion update", confidence = 0.8) {
  return cognitiveWrite({
    world,
    agent,
    agentId: agent?.id || "",
    source,
    target: "emotion",
    payload: { delta },
    confidence,
    reason,
    timestamp: world?.clock || 0
  });
}

function ensurePriorCausalGraph(world = {}) {
  world.causalGraph ||= { nodes: [], edges: [], patterns: [], version: "3.4.1" };
  world.causalGraph.priorCausalGraph ||= [];
  const priors = [
    { from: "need:hunger", to: "action:seek_food", relation: "triggered", confidence: 0.9 },
    { from: "action:help_other", to: "relationship:trust_up", relation: "reinforced", confidence: 0.5 },
    { from: "state:sleep_debt", to: "state:stress_up", relation: "caused", confidence: 0.8 }
  ];
  const seen = new Set(world.causalGraph.priorCausalGraph.map(item => `${item.from}->${item.to}`));
  priors.forEach(item => {
    const key = `${item.from}->${item.to}`;
    if (!seen.has(key)) {
      world.causalGraph.priorCausalGraph.push({ ...item, strength: item.confidence, source: "prior", version: "3.4.1" });
      seen.add(key);
    }
  });
  return world.causalGraph.priorCausalGraph;
}

function behaviorEntropy(agent = {}, windowSize = 12) {
  const history = Array.isArray(agent.actionHistory) ? agent.actionHistory.slice(0, windowSize) : [];
  if (history.length < 4) return { repeatRate: 0, unique: history.length, total: history.length };
  const ids = history.map(item => String(item.actionId || item.id || item.type || item.action || "")).filter(Boolean);
  const counts = ids.reduce((map, id) => map.set(id, (map.get(id) || 0) + 1), new Map());
  const max = Math.max(...counts.values());
  return { repeatRate: max / Math.max(1, ids.length), unique: counts.size, total: ids.length };
}

function explorationRateFor(world = {}, agent = {}) {
  const base = clamp(world.config?.explorationRate ?? agent.explorationRate ?? 0.05, 0, 0.25, 0.05);
  const entropy = behaviorEntropy(agent);
  const threshold = clamp(world.config?.behaviorEntropyThreshold ?? 0.75, 0.4, 1, 0.75);
  if (entropy.repeatRate > threshold) return clamp(base + (entropy.repeatRate - threshold) * 0.5, base, 0.25, base);
  return base;
}

function seededRandom(seed = "") {
  let hash = 2166136261;
  const value = String(seed || "");
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 100000) / 100000;
}

function pickWithExploration(scored = [], seed = "", explorationRate = 0.05) {
  if (!scored.length) return null;
  const rate = clamp(explorationRate, 0, 0.25, 0.05);
  const top = { ...scored[0], probability: Number((1 - rate).toFixed(4)), explorationRate: rate, exploration: false };
  if (scored.length < 2 || seededRandom(`${seed}:explore`) >= rate) return top;
  const pool = scored.slice(1, Math.min(scored.length, 5));
  const index = Math.floor(seededRandom(`${seed}:choice`) * pool.length);
  return { ...pool[index], probability: Number((rate / pool.length).toFixed(4)), explorationRate: rate, exploration: true };
}

module.exports = {
  COGNITIVE_KERNEL_VERSION,
  REQUIRED_COMMITTERS,
  cognitiveWrite,
  guardCognitiveWrite,
  registerCognitiveWriteCommitter,
  cognitiveKernelRuntimeStatus,
  assertCognitiveKernelRuntimeReady,
  stampCognitivePayload,
  requestNeedUpdate,
  requestEmotionUpdate,
  ensurePriorCausalGraph,
  eventHashFor,
  isEventRejectedRecently,
  rememberRejectedEvent,
  behaviorEntropy,
  explorationRateFor,
  pickWithExploration
};

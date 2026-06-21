"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const REPORT_DIR = path.join(ROOT, "logs", "cognitive-reports");
const STABILITY_THRESHOLD = 0.8;
const TOP_PAIR_LIMIT = 5;
const SAMPLE_LIMIT = 20;

const VECTOR_SKIP_KEYS = new Set([
  "id",
  "agentId",
  "name",
  "source",
  "version",
  "stabilityLayerVersion",
  "causalLayerVersion",
  "timestamp",
  "at",
  "tick",
  "day",
  "enabled",
  "alpha",
  "kernelVersion"
]);

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function exists(filePath) {
  try {
    fs.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function isDirectory(filePath) {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function fileMtimeMs(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function saveRoots() {
  return unique([
    process.env.AI_TOWN_SAVE_DIR,
    path.join(ROOT, "saves"),
    path.join(path.dirname(ROOT), "agentbox-town-main", "saves")
  ]).filter(isDirectory);
}

function latestSaveIn(root) {
  const entries = fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(root, entry.name))
    .filter(dir => exists(path.join(dir, "world.json")))
    .map(dir => ({ dir, time: Math.max(fileMtimeMs(path.join(dir, "world.json")), fileMtimeMs(dir)) }))
    .sort((a, b) => b.time - a.time);
  return entries[0]?.dir || null;
}

function resolveSavePath() {
  const arg = process.argv[2] ? path.resolve(process.argv[2]) : "";
  if (arg) {
    if (exists(arg) && !isDirectory(arg) && path.basename(arg).toLowerCase() === "world.json") return path.dirname(arg);
    if (isDirectory(arg) && exists(path.join(arg, "world.json"))) return arg;
    if (isDirectory(arg)) {
      const nested = latestSaveIn(arg);
      if (nested) return nested;
    }
  }
  for (const root of saveRoots()) {
    const found = latestSaveIn(root);
    if (found) return found;
  }
  return null;
}

function naturalAgentSort(a, b) {
  const an = Number(String(a).match(/\d+/)?.[0] || 0);
  const bn = Number(String(b).match(/\d+/)?.[0] || 0);
  return an - bn || String(a).localeCompare(String(b));
}

function loadSplitAgents(saveDir) {
  const agentsDir = path.join(saveDir, "agents");
  if (!isDirectory(agentsDir)) return [];
  return fs.readdirSync(agentsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort(naturalAgentSort)
    .map(name => {
      const dir = path.join(agentsDir, name);
      const raw = {
        info: readJson(path.join(dir, "info.json")) || {},
        state: readJson(path.join(dir, "state.json")) || {},
        memory: readJson(path.join(dir, "memory.json")) || {},
        judgements: readJson(path.join(dir, "judgements.json")) || {},
        decisionState: readJson(path.join(dir, "decision-state.json")) || {}
      };
      const data = { ...raw.info, ...raw.memory, ...raw.judgements, ...raw.decisionState, ...raw.state };
      return {
        id: data.id || raw.info.id || raw.state.id || name,
        name: data.name || raw.info.name || raw.state.name || name,
        dir,
        raw,
        data
      };
    });
}

function loadEmbeddedAgents(world) {
  const source = world?.agents || [];
  const list = Array.isArray(source) ? source : Object.values(source);
  return list.map((agent, index) => ({
    id: agent.id || `agent_${index + 1}`,
    name: agent.name || agent.id || `agent_${index + 1}`,
    dir: "",
    raw: { info: agent, state: agent, memory: agent, judgements: {} },
    data: agent
  }));
}

function loadSave(saveDir) {
  const wrapper = readJson(path.join(saveDir, "world.json")) || {};
  const world = wrapper.world && typeof wrapper.world === "object" ? wrapper.world : wrapper;
  const splitAgents = loadSplitAgents(saveDir);
  const agents = splitAgents.length ? splitAgents : loadEmbeddedAgents(world);
  return { saveDir, wrapper, world, agents };
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [];
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 4) {
  if (!Number.isFinite(Number(value))) return null;
  return Number(Number(value).toFixed(digits));
}

function compactActionId(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.replace(/\s+/g, "_").slice(0, 80);
}

function actionFromItem(item) {
  if (!item) return "";
  if (typeof item === "string") return compactActionId(item);
  if (typeof item.action === "string") return compactActionId(item.action);
  if (item.action && typeof item.action === "object") return compactActionId(item.action.id || item.action.type || item.action.action);
  if (item.selectedAction && typeof item.selectedAction === "object") return compactActionId(item.selectedAction.id || item.selectedAction.type);
  if (item.utilitySelectedAction && typeof item.utilitySelectedAction === "object") return compactActionId(item.utilitySelectedAction.id || item.utilitySelectedAction.type);
  if (item.utilityAction && typeof item.utilityAction === "object") return compactActionId(item.utilityAction.id || item.utilityAction.type);
  return compactActionId(
    item.actionId ||
    item.actionType ||
    item.type ||
    item.id ||
    item.activity ||
    item.actionHint ||
    item.label
  );
}

function historyArrays(agent) {
  const raw = agent.raw || {};
  return [
    ["state.actionHistory", raw.state?.actionHistory],
    ["info.actionHistory", raw.info?.actionHistory],
    ["memory.actionHistory", raw.memory?.actionHistory],
    ["judgements.actionHistory", raw.judgements?.actionHistory],
    ["state.decisionHistory", raw.state?.decisionHistory],
    ["info.decisionHistory", raw.info?.decisionHistory],
    ["judgements.decisionHistory", raw.judgements?.decisionHistory],
    ["state.processHistory", raw.state?.processHistory],
    ["info.processHistory", raw.info?.processHistory]
  ].filter(([, value]) => Array.isArray(value));
}

function collectAgentActions(agent) {
  const actions = [];
  for (const [source, history] of historyArrays(agent)) {
    for (const item of history) {
      const action = actionFromItem(item);
      if (action) actions.push({ action, source });
    }
  }
  return actions;
}

function shannonEntropy(counts) {
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  if (!total) return 0;
  return [...counts.values()].reduce((sum, count) => {
    const p = count / total;
    return sum - p * Math.log2(p);
  }, 0);
}

function actionFrequencyReport(agents) {
  const totalCounts = new Map();
  const perAgent = [];
  let totalActions = 0;

  for (const agent of agents) {
    const actions = collectAgentActions(agent);
    if (!actions.length) continue;
    const counts = new Map();
    for (const item of actions) {
      counts.set(item.action, (counts.get(item.action) || 0) + 1);
      totalCounts.set(item.action, (totalCounts.get(item.action) || 0) + 1);
      totalActions += 1;
    }
    const agentTotal = actions.length;
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    perAgent.push({
      agentId: agent.id,
      name: agent.name,
      totalActions: agentTotal,
      uniqueActions: counts.size,
      entropy: round(shannonEntropy(counts)),
      topAction: top ? top[0] : null,
      topActionRatio: top ? round(top[1] / agentTotal) : null,
      sources: unique(actions.map(item => item.source))
    });
  }

  const frequency = Object.fromEntries([...totalCounts.entries()].sort((a, b) => b[1] - a[1]));
  const top = [...totalCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const entropy = shannonEntropy(totalCounts);
  return {
    status: totalActions ? "ok" : "insufficient_data",
    actionFrequency: frequency,
    entropy: round(entropy),
    normalizedEntropy: totalCounts.size > 1 ? round(entropy / Math.log2(totalCounts.size)) : 0,
    topAction: top ? top[0] : null,
    topActionRatio: top ? round(top[1] / totalActions) : null,
    totalActions,
    agentsWithHistory: perAgent.length,
    perAgent: perAgent.sort((a, b) => b.totalActions - a.totalActions).slice(0, SAMPLE_LIMIT),
    note: totalActions ? "" : "No structured actionHistory or decisionHistory arrays were found in the loaded save."
  };
}

function flattenNumbers(value, prefix = "", output = {}, depth = 0) {
  if (depth > 6 || value == null) return output;
  if (typeof value === "number" && Number.isFinite(value) && prefix) {
    output[prefix] = value;
    return output;
  }
  if (typeof value !== "object" || Array.isArray(value)) return output;
  for (const [key, child] of Object.entries(value)) {
    if (VECTOR_SKIP_KEYS.has(key)) continue;
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "number" && Number.isFinite(child)) output[nextPrefix] = child;
    else if (child && typeof child === "object" && !Array.isArray(child)) flattenNumbers(child, nextPrefix, output, depth + 1);
  }
  return output;
}

function vectorFromState(state) {
  if (!state || typeof state !== "object") return {};
  if (state.vector && typeof state.vector === "object") {
    const vector = flattenNumbers(state.vector);
    if (Object.keys(vector).length) return vector;
  }
  return flattenNumbers({
    emotionVector: state.emotionVector,
    needsVector: state.needsVector,
    driveVector: state.driveVector,
    biasVector: state.biasVector,
    socialPressure: state.socialPressure,
    projection: state.projection
  });
}

function firstStateWithVector(...candidates) {
  for (const candidate of candidates) {
    const vector = vectorFromState(candidate);
    if (Object.keys(vector).length) return { state: candidate, vector };
  }
  return { state: null, vector: {} };
}

function statePair(agent) {
  const raw = agent.raw || {};
  const current = firstStateWithVector(
    raw.state?.psychologicalState,
    raw.state?.cognitiveState?.psychologicalState,
    raw.info?.psychologicalState,
    raw.info?.cognitiveState?.psychologicalState,
    raw.memory?.psychologicalState,
    raw.memory?.cognitiveState?.psychologicalState,
    agent.data?.psychologicalState,
    agent.data?.cognitiveState?.psychologicalState
  );
  const currentState = current.state || {};
  const previous = firstStateWithVector(
    raw.state?.previousPsychologicalState,
    raw.state?.cognitiveState?.previousPsychologicalState,
    currentState.previousPsychologicalState,
    currentState.previousState,
    currentState.previous,
    raw.info?.previousPsychologicalState,
    raw.memory?.previousPsychologicalState,
    agent.data?.previousPsychologicalState
  );
  return {
    current: current.state,
    currentVector: current.vector,
    previous: previous.state,
    previousVector: previous.vector
  };
}

function dotProduct(a, b) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  let dot = 0;
  let av = 0;
  let bv = 0;
  for (const key of keys) {
    const x = number(a[key], 0);
    const y = number(b[key], 0);
    dot += x * y;
    av += x * x;
    bv += y * y;
  }
  if (!av || !bv) return null;
  return dot / (Math.sqrt(av) * Math.sqrt(bv));
}

function l2Distance(a, b) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  if (!keys.size) return null;
  let sum = 0;
  for (const key of keys) {
    const delta = number(a[key], 0) - number(b[key], 0);
    sum += delta * delta;
  }
  return Math.sqrt(sum / keys.size);
}

function stabilityReport(agents) {
  const samples = [];
  const missingCurrent = [];
  const missingPrevious = [];
  for (const agent of agents) {
    const pair = statePair(agent);
    if (!Object.keys(pair.currentVector).length) {
      missingCurrent.push(agent.id);
      continue;
    }
    if (!Object.keys(pair.previousVector).length) {
      missingPrevious.push(agent.id);
      continue;
    }
    const similarity = dotProduct(pair.currentVector, pair.previousVector);
    if (similarity == null) continue;
    samples.push({
      agentId: agent.id,
      name: agent.name,
      similarity,
      deltaMagnitude: l2Distance(pair.currentVector, pair.previousVector)
    });
  }
  const values = samples.map(item => item.similarity);
  const abnormal = samples
    .filter(item => item.similarity < STABILITY_THRESHOLD)
    .sort((a, b) => a.similarity - b.similarity)
    .map(item => ({
      agentId: item.agentId,
      name: item.name,
      similarity: round(item.similarity),
      deltaMagnitude: round(item.deltaMagnitude)
    }));
  return {
    status: values.length ? "ok" : "insufficient_data",
    avgStability: values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null,
    minStability: values.length ? round(Math.min(...values)) : null,
    abnormalJumpThreshold: STABILITY_THRESHOLD,
    abnormalJumps: abnormal,
    agentsWithCurrentState: agents.length - missingCurrent.length,
    agentsWithPreviousState: values.length,
    missingCurrentState: missingCurrent.slice(0, SAMPLE_LIMIT),
    missingPreviousState: missingPrevious.slice(0, SAMPLE_LIMIT),
    note: values.length ? "" : "No current+previous psychologicalState vectors were found."
  };
}

function vectorFromCounts(counts) {
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  if (!total) return {};
  return Object.fromEntries([...counts.entries()].map(([key, count]) => [key, count / total]));
}

function agentBehaviorVectors(agents) {
  return agents.map(agent => {
    const counts = new Map();
    for (const item of collectAgentActions(agent)) counts.set(item.action, (counts.get(item.action) || 0) + 1);
    return { agent, vector: vectorFromCounts(counts), total: [...counts.values()].reduce((sum, count) => sum + count, 0) };
  }).filter(item => item.total > 0);
}

function pairSummary(pair) {
  return {
    a: { agentId: pair.a.agent.id, name: pair.a.agent.name },
    b: { agentId: pair.b.agent.id, name: pair.b.agent.name },
    distance: round(pair.distance),
    similarity: round(pair.similarity)
  };
}

function divergenceReport(agents) {
  const vectors = agentBehaviorVectors(agents);
  const pairs = [];
  for (let i = 0; i < vectors.length; i += 1) {
    for (let j = i + 1; j < vectors.length; j += 1) {
      const similarity = dotProduct(vectors[i].vector, vectors[j].vector);
      if (similarity == null) continue;
      pairs.push({ a: vectors[i], b: vectors[j], similarity, distance: 1 - similarity });
    }
  }
  const mean = pairs.length ? pairs.reduce((sum, pair) => sum + pair.distance, 0) / pairs.length : null;
  return {
    status: pairs.length ? "ok" : "insufficient_data",
    meanDivergence: mean == null ? null : round(mean),
    agentsWithBehaviorVector: vectors.length,
    pairCount: pairs.length,
    mostSimilarAgents: pairs.slice().sort((a, b) => a.distance - b.distance).slice(0, TOP_PAIR_LIMIT).map(pairSummary),
    mostDifferentAgents: pairs.slice().sort((a, b) => b.distance - a.distance).slice(0, TOP_PAIR_LIMIT).map(pairSummary),
    note: pairs.length ? "" : "Agent behavior vectors require at least two agents with structured action history."
  };
}

function numericTick(item) {
  if (!item || typeof item !== "object") return null;
  const value = item.tick ?? item.at ?? item.time ?? item.createdAt ?? item.lastSeenAt ?? item.lastConfirmed ?? item.lastInteractionTime;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function memoryImportance(item) {
  if (!item || typeof item !== "object") return 0.5;
  const importance = Number(item.importance ?? item.strength ?? 0.5);
  const confidence = Number(item.confidence ?? 0.5);
  const safeImportance = Number.isFinite(importance) ? Math.max(0, importance) : 0.5;
  const safeConfidence = Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5;
  return safeImportance * safeConfidence;
}

function pushMemoryItems(output, layer, items) {
  for (const item of asArray(items)) {
    output.push({
      layer,
      tick: numericTick(item),
      weight: memoryImportance(item)
    });
  }
}

function worldMemoryEventsByAgent(world) {
  const map = new Map();
  for (const item of asArray(world?.cognitiveWriteLog)) {
    const target = String(item?.target || "");
    if (!/memory|belief|habit|preference|episodic|relationship|causal|reflection|expectation/i.test(target)) continue;
    const agentId = String(item?.agentId || "");
    if (!agentId) continue;
    if (!map.has(agentId)) map.set(agentId, []);
    map.get(agentId).push({
      layer: `cognitiveWriteLog.${target}`,
      tick: numericTick(item),
      weight: memoryImportance(item)
    });
  }
  return map;
}

function memoryEvents(agent, worldEvents = []) {
  const raw = agent.raw || {};
  const output = [...worldEvents];
  const sources = [raw.memory || {}, raw.info || {}, raw.state || {}];
  for (const source of sources) {
    pushMemoryItems(output, "episodicMemory", source.episodicMemory);
    pushMemoryItems(output, "beliefMemory", source.beliefMemory);
    pushMemoryItems(output, "habitMemory", source.habitMemory);
    pushMemoryItems(output, "preferenceMemory", source.preferenceMemory);
    pushMemoryItems(output, "relationshipMemory", source.relationshipMemory);
    pushMemoryItems(output, "reflectionMemory", source.reflectionMemory);
    pushMemoryItems(output, "expectationMemory", source.expectationMemory);
    pushMemoryItems(output, "emotionCause", source.emotionCause);
    pushMemoryItems(output, "eventLog", source.eventLog);
    for (const [layer, items] of Object.entries(source.memory || {})) pushMemoryItems(output, `memory.${layer}`, items);
    for (const [layer, items] of Object.entries(source.semanticMemory || {})) pushMemoryItems(output, `semanticMemory.${layer}`, items);
    for (const [layer, items] of Object.entries(source.structuredMemory || {})) pushMemoryItems(output, `structuredMemory.${layer}`, items);
  }
  return output;
}

function memorySummaryText(agent) {
  return String(
    agent.raw?.memory?.memorySummary ||
    agent.raw?.info?.memorySummary ||
    agent.raw?.state?.memorySummary ||
    agent.data?.memorySummary ||
    ""
  );
}

function timestampOf(state) {
  const parsed = Number(state?.timestamp ?? state?.tick ?? state?.at);
  return Number.isFinite(parsed) ? parsed : null;
}

function memoryImpactReport(agents, world) {
  const scored = [];
  let agentsWithSummary = 0;
  let totalMemoryEvents = 0;
  const byAgent = worldMemoryEventsByAgent(world);

  for (const agent of agents) {
    const pair = statePair(agent);
    const summary = memorySummaryText(agent);
    if (summary) agentsWithSummary += 1;
    const events = memoryEvents(agent, byAgent.get(agent.id) || []);
    totalMemoryEvents += events.length;
    if (!Object.keys(pair.currentVector).length || !Object.keys(pair.previousVector).length) continue;

    const currentTick = timestampOf(pair.current);
    const previousTick = timestampOf(pair.previous);
    const recentEvents = events.filter(event => {
      if (event.tick == null || currentTick == null || previousTick == null) return false;
      return event.tick > previousTick && event.tick <= currentTick;
    });
    const similarity = dotProduct(pair.currentVector, pair.previousVector);
    if (similarity == null) continue;
    const deltaS = 1 - similarity;
    const eventWeight = recentEvents.reduce((sum, event) => sum + event.weight, 0);
    const score = recentEvents.length ? deltaS * Math.log1p(eventWeight || recentEvents.length) : 0;
    scored.push({
      agentId: agent.id,
      name: agent.name,
      deltaS,
      recentMemoryEvents: recentEvents.length,
      eventWeight,
      memorySummaryLength: summary.length,
      score
    });
  }

  const active = scored.filter(item => item.recentMemoryEvents > 0);
  const avgScore = active.length ? active.reduce((sum, item) => sum + item.score, 0) / active.length : null;
  return {
    status: active.length ? "ok" : "insufficient_data",
    method: "For agents with S(t) and S(t-1), score = (1 - cosineSimilarity) * log1p(weighted memory events in (previousTick, currentTick]).",
    memoryInfluenceScore: avgScore == null ? null : round(avgScore),
    agentsWithStateDelta: scored.length,
    agentsWithRecentMemoryEvents: active.length,
    agentsWithMemorySummary: agentsWithSummary,
    totalMemoryEvents,
    topAgents: scored
      .sort((a, b) => b.score - a.score)
      .slice(0, SAMPLE_LIMIT)
      .map(item => ({
        agentId: item.agentId,
        name: item.name,
        score: round(item.score),
        deltaS: round(item.deltaS),
        recentMemoryEvents: item.recentMemoryEvents,
        eventWeight: round(item.eventWeight),
        memorySummaryLength: item.memorySummaryLength
      })),
    note: active.length ? "" : "Memory impact requires memory timestamps plus current and previous psychologicalState vectors with memory events in the observed tick window."
  };
}

function buildReport(save) {
  const agents = save.agents || [];
  return {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    source: {
      saveDir: save.saveDir,
      worldClock: save.world?.clock ?? null,
      clockText: save.wrapper?.meta?.clockText || "",
      day: save.wrapper?.meta?.day ?? null,
      agentCount: agents.length
    },
    guarantees: {
      projectModulesImported: false,
      simulationFilesWritten: false,
      reportFileOnly: true
    },
    coverage: {
      agents: agents.length,
      agentsWithActionHistory: agents.filter(agent => collectAgentActions(agent).length).length,
      agentsWithPsychologicalState: agents.filter(agent => Object.keys(statePair(agent).currentVector).length).length,
      agentsWithPreviousPsychologicalState: agents.filter(agent => Object.keys(statePair(agent).previousVector).length).length,
      agentsWithMemorySummary: agents.filter(agent => memorySummaryText(agent)).length
    },
    behaviorEntropy: actionFrequencyReport(agents),
    stateStability: stabilityReport(agents),
    agentDifferentiation: divergenceReport(agents),
    memoryImpact: memoryImpactReport(agents, save.world)
  };
}

function safeTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function main() {
  const saveDir = resolveSavePath();
  if (!saveDir) {
    console.error("No save with world.json found. Pass a save directory or set AI_TOWN_SAVE_DIR.");
    process.exit(1);
  }

  const save = loadSave(saveDir);
  const report = buildReport(save);
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const outPath = path.join(REPORT_DIR, `report-${safeTimestamp()}.json`);
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`Cognitive night report written: ${outPath}`);
  console.log(JSON.stringify({
    saveDir: report.source.saveDir,
    agentCount: report.source.agentCount,
    behaviorEntropy: report.behaviorEntropy.status,
    stateStability: report.stateStability.status,
    agentDifferentiation: report.agentDifferentiation.status,
    memoryImpact: report.memoryImpact.status
  }, null, 2));
}

main();

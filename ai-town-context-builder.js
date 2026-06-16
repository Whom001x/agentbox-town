"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_CONTEXT_BUDGET = {
  worldAgent: 12000,
  socialAgent: 10000,
  scheduler: 8000,
  agentAction: 6000
};

const FORBIDDEN_PROMPT_KEYS = new Set([
  "memory",
  "privateMemory",
  "rawMemory",
  "vectorMemory",
  "embedding",
  "embeddings",
  "relationshipMatrix",
  "cognitiveState",
  "debugDecision",
  "hiddenWorldState",
  "trainingSamples"
]);

function compactText(value = "", fallback = "", limit = 160) {
  const text = String(value ?? fallback ?? "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1))}...` : text;
}

function estimateContextTokens(value) {
  try {
    return Math.ceil(JSON.stringify(value || {}).length / 4);
  } catch {
    return 0;
  }
}

function summarizeNeeds(needs = {}) {
  const entries = Object.entries(needs || {})
    .map(([key, value]) => ({ key, value: Number(value ?? 50), pressure: Math.max(0, 100 - Number(value ?? 50)) }))
    .sort((a, b) => b.pressure - a.pressure);
  return {
    lowest: entries.slice(0, 3),
    stableCount: entries.filter(item => item.value >= 60).length
  };
}

function summarizeEmotion(emotion = {}) {
  return Object.entries(emotion || {})
    .map(([key, value]) => ({ key, value: Number(value ?? 0) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 4);
}

function summarizeGoal(agent = {}) {
  const runtime = agent.goalRuntime && typeof agent.goalRuntime === "object" ? agent.goalRuntime : null;
  if (runtime?.name || runtime?.title) {
    return {
      name: compactText(runtime.name || runtime.title, "", 100),
      priority: runtime.priority,
      progress: runtime.progress,
      frustration: runtime.frustration
    };
  }
  const goals = Array.isArray(agent.longTermGoals) ? agent.longTermGoals : [];
  const goal = goals[0] || {};
  return goal.title || goal.name ? {
    name: compactText(goal.title || goal.name, "", 100),
    priority: goal.priority,
    progress: goal.progress
  } : null;
}

function summarizePersonality(agent = {}) {
  const identity = agent.identityCore || {};
  const profile = agent.personalityProfile || {};
  const cognitive = agent.cognitiveProfile || {};
  return {
    identity: compactText(identity.identity || agent.selfModel?.selfImage || agent.job || "", "", 140),
    values: (identity.values || profile.values || agent.selfModel?.values || []).slice(0, 3),
    fears: (identity.fears || agent.selfModel?.fears || []).slice(0, 2),
    habits: (identity.habits || profile.habits || []).slice(0, 3),
    decisionWeights: agent.decisionWeights || null,
    cognitiveProfile: {
      riskTolerance: cognitive.riskTolerance,
      curiosity: cognitive.curiosity,
      routinePreference: cognitive.routinePreference,
      socialDrive: cognitive.socialDrive,
      empathy: cognitive.empathy,
      conflictAvoidance: cognitive.conflictAvoidance,
      patience: cognitive.patience,
      ambition: cognitive.ambition
    }
  };
}

function summarizeMemory(agent = {}, relevant = []) {
  const important = [];
  if (agent.memorySummary) important.push(compactText(agent.memorySummary, "", 180));
  const pools = [
    ...(Array.isArray(agent.beliefMemory) ? agent.beliefMemory : []),
    ...(Array.isArray(agent.habitMemory) ? agent.habitMemory : []),
    ...(Array.isArray(agent.preferenceMemory) ? agent.preferenceMemory : []),
    ...(Array.isArray(agent.episodicMemory) ? agent.episodicMemory : [])
  ];
  pools
    .map(item => ({
      text: compactText(item.belief || item.habit || item.preference || item.event || item.lesson || item.meaning || item.text, "", 130),
      score: Number(item.importance ?? item.strength ?? item.probability ?? 0)
    }))
    .filter(item => item.text)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .forEach(item => important.push(item.text));
  (Array.isArray(relevant) ? relevant : [])
    .slice(0, 4)
    .forEach(item => {
      const text = compactText(item.text || item.meaning || item.scene || "", "", 140);
      if (text) important.push(text);
    });
  return Array.from(new Set(important)).slice(0, 6);
}

function summarizeMemoryBias(agent = {}, memoryActionWeights = null) {
  const weights = memoryActionWeights || agent.memoryActionWeights || {};
  return {
    priorityDelta: weights.priorityDelta || 0,
    preferredActions: (weights.preferredActions || []).slice(0, 4),
    avoidPlaces: (weights.avoidPlaces || []).slice(0, 3),
    seekPlaces: (weights.seekPlaces || []).slice(0, 3),
    seekAgents: (weights.seekAgents || []).slice(0, 3),
    notes: (weights.notes || []).slice(0, 4)
  };
}

function summarizeSocialFeedback(agent = {}, world = {}) {
  const modifier = agent.agentSocialModifier || (world.agentSocialModifiers || []).find(item => item.agentId === agent.id) || {};
  return {
    fearModifier: modifier.fearModifier || 0,
    curiosityModifier: modifier.curiosityModifier || 0,
    trustModifier: modifier.trustModifier || 0,
    responsibilityModifier: modifier.responsibilityModifier || 0,
    avoidanceModifier: modifier.avoidanceModifier || 0,
    socialNeedModifier: modifier.socialNeedModifier || 0,
    sourceEvents: (modifier.sourceEvents || []).slice(0, 4)
  };
}

function summarizeActionCandidates(utility = {}, fallback = []) {
  const list = Array.isArray(utility.candidateActions) ? utility.candidateActions : fallback;
  return (Array.isArray(list) ? list : []).slice(0, 8).map(action => ({
    id: action.id || action.type || "",
    type: action.type || "",
    label: compactText(action.label || action.summary || "", "", 80),
    score: action.score,
    probability: action.probability,
    targetPlace: action.targetPlace,
    targetNeed: action.targetNeed,
    eligibility: action.eligibility || action.allowed
  }));
}

function generateAgentRuntimeSummary(agent = {}, world = {}, options = {}) {
  return {
    id: agent.id || "",
    name: agent.name || "",
    ageStage: agent.ageStage || "",
    profession: agent.job || agent.profession || "",
    location: agent.position || agent.place || "",
    lifeStatus: agent.lifeStatus || "alive",
    identity: compactText(agent.identityCore?.identity || agent.selfModel?.selfImage || agent.personalityProfile?.summary || "", "", 140),
    currentTask: compactText(agent.currentTask || "", "", 100),
    currentNeed: summarizeNeeds(agent.needs),
    currentEmotion: summarizeEmotion(agent.emotionVector || agent.emotions),
    activeGoal: summarizeGoal(agent),
    importantMemory: summarizeMemory(agent, options.relevantMemories),
    socialRole: compactText(agent.socialRole || agent.job || agent.ageStage || "", "", 80),
    socialFeedbackSummary: summarizeSocialFeedback(agent, world)
  };
}

function summarizePopulation(world = {}, agents = []) {
  const source = Array.isArray(agents) && agents.length ? agents : (world.agents || []);
  const living = source.filter(agent => agent && agent.lifeStatus !== "dead");
  const byStage = {};
  const byJob = {};
  living.forEach(agent => {
    const stage = agent.ageStage || "unknown";
    const job = agent.job || "unknown";
    byStage[stage] = (byStage[stage] || 0) + 1;
    byJob[job] = (byJob[job] || 0) + 1;
  });
  return {
    total: source.length,
    living: living.length,
    dead: source.length - living.length,
    byStage,
    topJobs: Object.entries(byJob).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([job, count]) => ({ job, count }))
  };
}

function summarizeLocations(world = {}) {
  const agents = world.agents || [];
  return (world.places || []).slice(0, 160).map(place => {
    const occupants = agents.filter(agent => agent.lifeStatus !== "dead" && (agent.position || agent.place) === place.id);
    return {
      id: place.id,
      name: place.name || place.id,
      type: place.type || "",
      visible: (place.visible || []).slice(0, 8),
      occupantCount: occupants.length,
      staffCount: occupants.filter(agent => /doctor|nurse|teacher|guard|staff|worker|医生|护士|老师|保安|店员|职员/.test(String(agent.job || ""))).length
    };
  });
}

function summarizeEvents(world = {}) {
  return {
    recentRecords: (world.records || []).slice(0, 12).map(item => ({
      title: compactText(item.title || "", "", 90),
      type: item.type || "",
      agents: (item.agents || []).slice(0, 6),
      clock: item.clock,
      body: compactText(item.body || item.summary || "", "", 140)
    })),
    recentImpacts: (world.eventImpacts || []).slice(0, 12).map(item => ({
      eventId: item.eventId || item.id || "",
      title: compactText(item.title || "", "", 90),
      place: item.place || "",
      severity: item.severity,
      knownCount: (item.knownBy || item.directKnownBy || []).length,
      summary: compactText(item.summary || item.fact || "", "", 140)
    }))
  };
}

function summarizeInformationFlows(world = {}) {
  return (world.informationFlows || []).slice(0, 20).map(flow => ({
    id: flow.id || flow.impactId || "",
    fact: compactText(flow.fact || flow.content || "", "", 140),
    source: flow.source || flow.informationPacket?.source || "",
    knownCount: (flow.knownBy || []).length,
    confidence: flow.confidence ?? flow.informationPacket?.confidence,
    distortionLevel: flow.distortionLevel ?? flow.informationPacket?.distortionLevel,
    emotionalWeight: flow.emotionalWeight ?? flow.informationPacket?.emotionalWeight,
    spreadDepth: flow.spreadDepth ?? flow.informationPacket?.spreadDepth
  }));
}

function compactSocialField(field = {}) {
  return {
    fearLevel: field?.fearLevel || 0,
    curiosityLevel: field?.curiosityLevel || 0,
    rumorDensity: field?.rumorDensity || 0,
    trustNetworkStrength: field?.trustNetworkStrength || 0,
    socialTension: field?.socialTension || 0,
    informationPressure: field?.informationPressure || 0
  };
}

function sanitizeForPrompt(value, options = {}) {
  const allowKeys = new Set(options.allowKeys || []);
  const seen = new WeakSet();
  function visit(input) {
    if (!input || typeof input !== "object") return input;
    if (seen.has(input)) return null;
    seen.add(input);
    if (Array.isArray(input)) return input.map(visit);
    const output = {};
    Object.entries(input).forEach(([key, entry]) => {
      if (FORBIDDEN_PROMPT_KEYS.has(key) && !allowKeys.has(key)) return;
      if (/embedding/i.test(key) && !allowKeys.has(key)) return;
      output[key] = visit(entry);
    });
    return output;
  }
  return visit(value);
}

function enforceBudget(context, budgetTokens, reducers = []) {
  let current = sanitizeForPrompt(context);
  const limit = Math.max(500, Number(budgetTokens || 6000));
  if (estimateContextTokens(current) <= limit) return { ...current, contextBudget: { limit, estimatedTokens: estimateContextTokens(current), compression: "none" } };
  for (const reducer of reducers) {
    current = sanitizeForPrompt(reducer(current));
    if (estimateContextTokens(current) <= limit) {
      return { ...current, contextBudget: { limit, estimatedTokens: estimateContextTokens(current), compression: "compressed" } };
    }
  }
  const minimal = sanitizeForPrompt({
    contextKind: current.contextKind,
    worldTime: current.worldTime,
    populationSummary: current.populationSummary,
    locationSummary: (current.locationSummary || []).slice(0, 30),
    eventSummary: {
      recentRecords: (current.eventSummary?.recentRecords || []).slice(0, 4),
      recentImpacts: (current.eventSummary?.recentImpacts || []).slice(0, 4)
    },
    socialField: current.socialField,
    agents: (current.agents || current.dueAgents || []).slice(0, 20),
    rule: current.rule,
    contextBudget: { limit, estimatedTokens: 0, compression: "minimal" }
  });
  minimal.contextBudget.estimatedTokens = estimateContextTokens(minimal);
  return minimal;
}

function worldTime(world = {}) {
  return {
    clock: world.clock || 0,
    calendar: world.weatherBox?.calendar || {},
    weather: world.weatherBox?.current || world.weatherBox?.weather || ""
  };
}

function buildWorldContext(input = {}) {
  const world = input.world || {};
  const agents = Array.isArray(input.agents) ? input.agents : [];
  const kind = input.kind || "worldAgent";
  const budget = input.budget || DEFAULT_CONTEXT_BUDGET[kind] || DEFAULT_CONTEXT_BUDGET.worldAgent;
  const selectedAgents = agents.slice(0, 80).map(agent => generateAgentRuntimeSummary(agent, world));
  const base = {
    contextKind: kind,
    worldTime: worldTime(world),
    populationSummary: summarizePopulation(world, agents),
    locationSummary: summarizeLocations(world),
    eventSummary: summarizeEvents(world),
    socialField: compactSocialField(world.socialField || {}),
    informationFlowSummary: summarizeInformationFlows(world),
    agents: selectedAgents,
    socialSummary: {
      processCount: (world.socialProcesses || []).length,
      relationshipDynamicsCount: (world.relationshipDynamics || []).length,
      feedbackCount: world.socialFeedbackState?.count || 0
    },
    rule: "World/social context is a lightweight runtime view. It does not include private memory, vector embeddings, raw relationships, full cognitive state, or debug traces."
  };
  return enforceBudget(base, budget, [
    ctx => ({ ...ctx, agents: (ctx.agents || []).slice(0, 40), locationSummary: (ctx.locationSummary || []).slice(0, 80) }),
    ctx => ({ ...ctx, agents: (ctx.agents || []).slice(0, 20), informationFlowSummary: (ctx.informationFlowSummary || []).slice(0, 8), locationSummary: (ctx.locationSummary || []).slice(0, 50) })
  ]);
}

function buildSchedulerContext(input = {}) {
  const world = input.world || {};
  const dueAgents = Array.isArray(input.dueAgents) ? input.dueAgents : [];
  const budget = input.budget || DEFAULT_CONTEXT_BUDGET.scheduler;
  const due = dueAgents.slice(0, 80).map(agent => {
    const utility = agent.utilityDecision || {};
    return {
      id: agent.id,
      name: agent.name,
      ageStage: agent.ageStage || "",
      profession: agent.job || "",
      location: agent.position || agent.place || "",
      needs: summarizeNeeds(agent.needs),
      emotionVector: agent.emotionVector || agent.emotions || {},
      goalRuntime: summarizeGoal(agent),
      personalityWeights: agent.decisionWeights || null,
      memoryBiasSummary: summarizeMemoryBias(agent, agent.memoryActionWeights),
      actionCandidates: summarizeActionCandidates(utility),
      schedulingPressure: agent.schedulingPressure || utility.priority || 0,
      activeProcess: agent.activeProcess ? {
        goal: compactText(agent.activeProcess.goal || "", "", 80),
        stage: agent.activeProcess.stage || "",
        progress: agent.activeProcess.progress
      } : null
    };
  });
  const base = {
    contextKind: "scheduler",
    worldTime: worldTime(world),
    maxActions: input.maxActions || 1,
    dueAgents: due,
    places: (world.places || []).slice(0, 120).map(place => ({ id: place.id, name: place.name || place.id, type: place.type || "" })),
    eventSummary: summarizeEvents(world),
    aiBatch: input.batchMeta || null,
    rule: "Scheduler context only contains decision necessities. Do not infer private memory, hidden facts, vector data, or raw relationship matrices."
  };
  return enforceBudget(base, budget, [
    ctx => ({ ...ctx, dueAgents: (ctx.dueAgents || []).slice(0, 40), places: (ctx.places || []).slice(0, 80) }),
    ctx => ({ ...ctx, dueAgents: (ctx.dueAgents || []).slice(0, 20), eventSummary: { recentRecords: [], recentImpacts: [] }, places: (ctx.places || []).slice(0, 40) })
  ]);
}

function buildAgentContext(input = {}) {
  const world = input.world || {};
  const agent = input.agent || {};
  const utility = input.utility || {};
  const relevantMemories = input.relevantMemories || [];
  const memoryActionWeights = input.memoryActionWeights || null;
  const place = input.place || {};
  const visibleAgents = input.visibleAgents || [];
  const budget = input.budget || DEFAULT_CONTEXT_BUDGET.agentAction;
  const base = {
    contextKind: "agentAction",
    clock: world.clock || 0,
    tickMinutes: input.tickMinutes || 30,
    worldTime: worldTime(world),
    agent: {
      id: agent.id,
      name: agent.name,
      ageStage: agent.ageStage || "",
      profession: agent.job || "",
      location: agent.position || agent.place || "",
      lifeStatus: agent.lifeStatus || "alive",
      currentTask: compactText(agent.currentTask || "", "", 100),
      needsSummary: summarizeNeeds(agent.needs),
      emotionSummary: summarizeEmotion(agent.emotionVector || agent.emotions),
      currentGoal: summarizeGoal(agent),
      personalityCore: summarizePersonality(agent),
      recentMemorySummary: summarizeMemory(agent, relevantMemories),
      socialFeedbackSummary: summarizeSocialFeedback(agent, world)
    },
    candidate: input.candidate || {},
    currentLocation: {
      id: place.id || "",
      name: place.name || place.id || "",
      type: place.type || "",
      visible: (place.visible || []).slice(0, 8),
      population: {
        otherCount: visibleAgents.length,
        visibleAgents: visibleAgents.slice(0, 10).map(item => generateAgentRuntimeSummary(item, world)),
        staff: visibleAgents
          .filter(item => /doctor|nurse|teacher|guard|staff|worker|医生|护士|老师|保安|店员|职员/.test(String(item.job || "")))
          .slice(0, 6)
          .map(item => ({ id: item.id, name: item.name, job: item.job }))
      }
    },
    visibleKnowledge: (agent.knownFacts || []).slice(0, 12).map(item => compactText(item.fact || item.text || item, "", 140)),
    currentPlanItem: input.planItem || null,
    interruption: input.interruption || null,
    decision: input.decision || null,
    socialField: compactSocialField(world.socialField || {}),
    socialFeedbackSummary: summarizeSocialFeedback(agent, world),
    candidateActions: summarizeActionCandidates(utility),
    vectorRecall: (utility.vectorRecall || []).slice(0, 4).map(item => ({
      scene: compactText(item.scene || item.text || "", "", 120),
      structuredType: item.structuredType,
      similarity: item.similarity,
      importance: item.importance,
      rule: "Associative recall only; not a fact source."
    })),
    memoryBiasSummary: summarizeMemoryBias(agent, memoryActionWeights),
    utilityDecision: {
      priority: utility.priority,
      priorityReason: compactText(utility.priorityReason || "", "", 120),
      selectedAction: utility.selectedAction ? {
        id: utility.selectedAction.id,
        type: utility.selectedAction.type,
        label: compactText(utility.selectedAction.label || "", "", 80),
        score: utility.selectedAction.score,
        probability: utility.selectedAction.probability
      } : null,
      actionEligibility: utility.actionEligibility ? {
        rawCount: utility.actionEligibility.rawCount,
        eligibleCount: utility.actionEligibility.eligibleCount
      } : null
    },
    previousInternalState: input.previousInternalState || null,
    previousIntent: input.previousIntent || null,
    guidance: input.guidance || {},
    rule: "AgentAction receives subjective decision context only. It cannot change world state directly and cannot use hidden facts, raw memory, vector embeddings, debug traces, or full relationship matrices."
  };
  return enforceBudget(base, budget, [
    ctx => ({ ...ctx, currentLocation: { ...ctx.currentLocation, population: { ...ctx.currentLocation.population, visibleAgents: ctx.currentLocation.population.visibleAgents.slice(0, 6) } }, candidateActions: (ctx.candidateActions || []).slice(0, 5) }),
    ctx => ({ ...ctx, vectorRecall: [], currentLocation: { ...ctx.currentLocation, population: { ...ctx.currentLocation.population, visibleAgents: ctx.currentLocation.population.visibleAgents.slice(0, 3) } }, agent: { ...ctx.agent, recentMemorySummary: ctx.agent.recentMemorySummary.slice(0, 3) } })
  ]);
}

function buildRuntimeSummaryCache(world = {}, agents = null) {
  const clock = world.clock || 0;
  if (world.runtimeContextCache?.tick === clock) return world.runtimeContextCache;
  const selectedAgents = Array.isArray(agents) ? agents : (world.agents || []);
  const cache = {
    version: "3.3.2",
    tick: clock,
    locationSummary: summarizeLocations(world),
    populationSummary: summarizePopulation(world, selectedAgents),
    socialSummary: {
      socialField: compactSocialField(world.socialField || {}),
      informationFlowSummary: summarizeInformationFlows(world),
      socialProcessCount: (world.socialProcesses || []).length
    },
    agentSummary: selectedAgents.slice(0, 500).map(agent => generateAgentRuntimeSummary(agent, world))
  };
  world.runtimeContextCache = cache;
  return cache;
}

function writeRuntimeContextCache(rootDir, cache) {
  if (!rootDir || !cache) return "";
  const dir = path.join(rootDir, "runtime");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "contextCache.json");
  fs.writeFileSync(file, JSON.stringify(cache, null, 2), "utf8");
  return file;
}

function findForbiddenPromptKeys(value, pathParts = []) {
  const found = [];
  const seen = new WeakSet();
  function visit(input, parts) {
    if (!input || typeof input !== "object") return;
    if (seen.has(input)) return;
    seen.add(input);
    if (Array.isArray(input)) {
      input.forEach((item, index) => visit(item, parts.concat(String(index))));
      return;
    }
    Object.entries(input).forEach(([key, entry]) => {
      if (FORBIDDEN_PROMPT_KEYS.has(key) || /embedding/i.test(key)) found.push(parts.concat(key).join("."));
      visit(entry, parts.concat(key));
    });
  }
  visit(value, pathParts);
  return found;
}

module.exports = {
  DEFAULT_CONTEXT_BUDGET,
  FORBIDDEN_PROMPT_KEYS,
  compactText,
  estimateContextTokens,
  sanitizeForPrompt,
  findForbiddenPromptKeys,
  generateAgentRuntimeSummary,
  buildAgentContext,
  buildWorldContext,
  buildSchedulerContext,
  buildRuntimeSummaryCache,
  writeRuntimeContextCache
};

"use strict";

const legacyLayers = ["short", "long", "emotional", "secret", "rumor"];
const semanticTypes = ["habit", "experience", "episodic", "belief", "relationship", "social", "preference", "goal"];
const structuredTypes = ["habit", "belief", "preference", "episodic", "social", "goal"];
const structuredAliases = {
  experience: "episodic",
  episodic: "episodic",
  relationship: "social",
  social: "social",
  habit: "habit",
  belief: "belief",
  preference: "preference",
  goal: "goal"
};
const routineActions = new Set([
  "eat",
  "meal",
  "sleep",
  "rest",
  "work",
  "study",
  "homework",
  "maintain",
  "commute",
  "plan_move",
  "plan_meal",
  "plan_sleep",
  "plan_rest",
  "plan_work",
  "plan_study",
  "plan_homework",
  "plan_maintain"
]);
const MEMORY_IMPORTANCE_EPSILON = 1e-6;
const defaultMemoryImportanceWeights = {
  event: 1.0,
  emotion: 1.5,
  relation: 1.3,
  goal: 1.2
};
const defaultNormalizationConfig = {
  method: "log",
  max: {
    event: 100,
    emotion: 50,
    relation: 50,
    goal: 100
  },
  sampleLimit: 512
};
const defaultMemoryDecayLambda = {
  episodic: 0.0028,
  belief: 0.00055,
  habit: 0.0002,
  relationship: 0.0008,
  social: 0.0008,
  preference: 0.00045,
  goal: 0.00045
};
const defaultContextFactors = {
  self: 1.0,
  personal: 1.0,
  direct: 1.0,
  close_relation: 0.8,
  family: 0.8,
  familiar: 0.5,
  same_place: 0.3,
  witness: 0.3,
  hearsay: 0.1,
  indirect: 0.1
};
const blockedMemoryPatterns = [
  /Followed plan/i,
  /Followed the plan/i,
  /Because of/i,
  /Daily reflection/i,
  /Received basic care at the clinic/i,
  /JSON Schema/i,
  /JSON指令|复杂的JSON|生成符合JSON/i
];

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function compactString(value, fallback = "", limit = 180) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, limit);
}

function uniqueStrings(values = [], limit = 8) {
  const seen = new Set();
  const output = [];
  values.flat().forEach(value => {
    const text = compactString(value, "", 120);
    if (!text || seen.has(text)) return;
    seen.add(text);
    output.push(text);
  });
  return output.slice(0, limit);
}

function normalizeRatio(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  if (number > 1) return clampNumber(number / (number <= 10 ? 10 : 100), 0, 1, fallback);
  return clampNumber(number, 0, 1, fallback);
}

function normalizedObjectValue(value, fallback = 0) {
  if (value == null) return fallback;
  if (typeof value === "number") return normalizeRatio(Math.abs(value), fallback);
  if (Array.isArray(value)) return normalizeRatio(value.reduce((sum, item) => sum + Math.abs(Number(item) || 0), 0), fallback);
  if (typeof value === "object") {
    const numbers = Object.values(value).map(item => Math.abs(Number(item) || 0)).filter(Number.isFinite);
    if (!numbers.length) return fallback;
    return normalizeRatio(Math.max(...numbers), fallback);
  }
  return normalizeRatio(value, fallback);
}

function normalizedDeltaValue(value, fallback = 0) {
  if (value == null) return fallback;
  if (typeof value === "number") return clampNumber(Math.abs(value) / 50, 0, 1, fallback);
  if (Array.isArray(value)) return clampNumber(value.reduce((sum, item) => sum + Math.abs(Number(item) || 0), 0) / 100, 0, 1, fallback);
  if (typeof value === "object") {
    const numbers = Object.values(value).map(item => Math.abs(Number(item) || 0)).filter(Number.isFinite);
    if (!numbers.length) return fallback;
    return clampNumber(Math.max(...numbers) / 50, 0, 1, fallback);
  }
  return normalizeRatio(value, fallback);
}

function memoryImportanceWeights(world = {}) {
  const config = world.config?.memoryImportanceWeights || world.memoryImportanceWeights || {};
  return {
    event: clampNumber(config.event, 0.1, 5, defaultMemoryImportanceWeights.event),
    emotion: clampNumber(config.emotion, 0.1, 5, defaultMemoryImportanceWeights.emotion),
    relation: clampNumber(config.relation, 0.1, 5, defaultMemoryImportanceWeights.relation),
    goal: clampNumber(config.goal, 0.1, 5, defaultMemoryImportanceWeights.goal)
  };
}

function memoryImportanceThreshold(world = {}) {
  return clampNumber(world.config?.memoryImportanceThreshold ?? world.memoryImportanceThreshold, 0, 1, 0.15);
}

function memoryNormalizationConfig(world = {}) {
  const config = world.config?.memoryNormalization || world.memoryNormalization || {};
  return {
    method: String(config.method || defaultNormalizationConfig.method).toLowerCase(),
    max: {
      ...defaultNormalizationConfig.max,
      ...(config.max || {})
    },
    sampleLimit: clampNumber(config.sampleLimit, 64, 5000, defaultNormalizationConfig.sampleLimit)
  };
}

function logScale(value, maxValue = 100) {
  const safeValue = Math.max(0, Number(value) || 0);
  const safeMax = Math.max(1, Number(maxValue) || 100);
  return clampNumber(Math.log1p(safeValue) / Math.log1p(safeMax), 0, 1, 0);
}

function calibrationState(world = {}) {
  world.memoryImportanceCalibration ||= {};
  world.memoryImportanceCalibration.dimensions ||= {};
  return world.memoryImportanceCalibration;
}

function quantileNormalize(world = {}, dimension = "event", rawValue = 0, fallback = 0) {
  const state = calibrationState(world);
  const values = Array.isArray(state.dimensions[dimension]) ? state.dimensions[dimension] : [];
  const value = Math.max(0, Number(rawValue) || 0);
  let rank = fallback;
  if (values.length >= 12) {
    const belowOrEqual = values.filter(item => Number(item || 0) <= value).length;
    rank = belowOrEqual / values.length;
  }
  values.push(value);
  const limit = memoryNormalizationConfig(world).sampleLimit;
  state.dimensions[dimension] = values.slice(-limit);
  return clampNumber(rank, 0, 1, fallback);
}

function distributionNormalize(world = {}, dimension = "event", rawValue = 0, fallback = 0) {
  const config = memoryNormalizationConfig(world);
  const value = Math.max(0, Number(rawValue) || 0);
  if (config.method === "quantile") {
    return quantileNormalize(world, dimension, value, logScale(value, config.max[dimension]));
  }
  return logScale(value, config.max[dimension]);
}

function rawDeltaMagnitude(value, fallback = 0) {
  if (value == null) return fallback;
  if (typeof value === "number") return Math.abs(value);
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + Math.abs(Number(item) || 0), 0);
  if (typeof value === "object") {
    const numbers = Object.values(value).map(item => Math.abs(Number(item) || 0)).filter(Number.isFinite);
    return numbers.length ? Math.max(...numbers) : fallback;
  }
  return Math.abs(Number(value) || fallback);
}

function emotionValenceFromEvent(event = {}) {
  const deltas = event.emotionDelta && typeof event.emotionDelta === "object" ? event.emotionDelta : {};
  const positiveKeys = ["happy", "hopeful", "calm", "curious"];
  const negativeKeys = ["anxious", "angry", "sad", "tired", "lonely"];
  const positiveImpact = positiveKeys.reduce((sum, key) => sum + Math.max(0, Number(deltas[key] || 0)), 0);
  const negativeEmotionRise = negativeKeys.reduce((sum, key) => sum + Math.max(0, Number(deltas[key] || 0)), 0);
  const positiveEmotionDrop = positiveKeys.reduce((sum, key) => sum + Math.max(0, -Number(deltas[key] || 0)), 0);
  const negativeImpact = negativeEmotionRise + positiveEmotionDrop;
  const explicit = event.emotionValence || {};
  const text = eventTextForGate(event);
  const successBoost = /success|achievement|bonding|helped|saved|完成|成功|帮助|信任|亲近/.test(text) ? 18 : 0;
  const fearBoost = /fear|trauma|loss|death|risk|danger|conflict|失败|恐惧|创伤|失去|死亡|风险|冲突/.test(text) ? 22 : 0;
  const positive = Math.max(positiveImpact + successBoost, rawDeltaMagnitude(explicit.positiveImpact, 0));
  const negative = Math.max(negativeImpact + fearBoost, rawDeltaMagnitude(explicit.negativeImpact, 0));
  const intensity = Math.max(rawDeltaMagnitude(event.emotionDelta, 0), rawDeltaMagnitude(explicit.intensity, 0), positive, negative, Number(event.emotionalIntensity || 0));
  return {
    positiveImpact: Number(distributionNormalize({}, "emotion", positive, 0).toFixed(3)),
    negativeImpact: Number(distributionNormalize({}, "emotion", negative, 0).toFixed(3)),
    intensity: Number(distributionNormalize({}, "emotion", intensity, 0).toFixed(3)),
    raw: { positive, negative, intensity }
  };
}

function emotionMemoryWeight(event = {}, valence = emotionValenceFromEvent(event)) {
  const text = eventTextForGate(event);
  const positive = Number(valence.positiveImpact || 0);
  const negative = Number(valence.negativeImpact || 0);
  const strongPositive = positive >= 0.62 || /success|bonding|achievement|完成|成功|帮助|信任|亲近/.test(text);
  const strongNegative = negative >= 0.62 || /fear|trauma|loss|death|risk|danger|conflict|恐惧|创伤|失去|死亡|风险|冲突/.test(text);
  if (strongPositive && positive >= negative) {
    return {
      belief: 1.08,
      preference: 1.16,
      safety: 0.96,
      label: "positive"
    };
  }
  if (strongNegative) {
    return {
      belief: 1.12,
      preference: 0.96,
      safety: 1.2,
      label: "negative"
    };
  }
  return {
    belief: 0.92,
    preference: 0.9,
    safety: 0.96,
    label: "ordinary"
  };
}

function memoryTypeForDecay(event = {}) {
  const hint = structuredTypeOf(event.memoryTypeHint || event.memoryType || "");
  if (hint === "social") return "relationship";
  return hint || "episodic";
}

function timeFactorForEvent(world = {}, event = {}, type = "episodic") {
  const clock = Number(world.clock || event.clock || 0);
  const eventClock = Number(event.clock ?? clock);
  const delta = Math.max(0, clock - eventClock);
  const config = world.config?.memoryDecayLambda || world.memoryDecayLambda || {};
  const lambda = clampNumber(config[type], 0, 1, defaultMemoryDecayLambda[type] ?? defaultMemoryDecayLambda.episodic);
  const factor = Math.exp(-lambda * delta);
  if (type === "relationship" || type === "social") {
    return clampNumber(factor * (0.75 + contextFactorForEvent({}, event) * 0.25), 0, 1, factor);
  }
  return clampNumber(factor, 0, 1, 1);
}

function isBlockedMemoryText(text = "") {
  const value = String(text || "");
  return blockedMemoryPatterns.some(pattern => pattern.test(value));
}

function relationStrength(agent = {}, targetAgentId = "") {
  if (!targetAgentId || targetAgentId === agent.id) return 0.55;
  const rel = agent.relationshipMatrix?.[targetAgentId] || agent.relations?.[targetAgentId] || agent.relationships?.[targetAgentId] || null;
  if (!rel) return 0.05;
  if (typeof rel === "number") return normalizeRatio(rel, 0.05);
  return normalizeRatio(Math.max(
    Number(rel.trust || 0),
    Number(rel.intimacy || 0),
    Number(rel.familiarity || 0),
    Number(rel.dependency || 0),
    Number(rel.respect || 0)
  ), 0.05);
}

function contextFactorForEvent(agent = {}, event = {}) {
  if (Number.isFinite(Number(event.contextFactor))) return clampNumber(event.contextFactor, 0, 1, 0.3);
  const scope = String(event.contextScope || event.knownByMode || "").trim();
  if (scope && Object.prototype.hasOwnProperty.call(defaultContextFactors, scope)) return defaultContextFactors[scope];
  if (!event.targetAgentId || event.targetAgentId === agent.id || event.agentId === agent.id) return 1.0;
  const relation = relationStrength(agent, event.targetAgentId);
  if (isDirectSocialEvent(event)) return relation >= 0.35 ? 0.8 : 0.65;
  if (relation >= 0.7) return 0.8;
  if (relation >= 0.35) return 0.5;
  if (event.samePlace || event.place === (agent.position || agent.place || "")) return 0.3;
  return 0.1;
}

function eventTextForGate(event = {}) {
  return String([
    event.summary,
    event.type,
    event.actionType,
    event.interruption?.type,
    event.planTitle,
    event.localAction
  ].filter(Boolean).join(" ")).toLowerCase();
}

function isDirectSocialEvent(event = {}, text = eventTextForGate(event)) {
  return Boolean(event.targetAgentId)
    && (/social|relationship|trust|helped|saved|betray|conflict|argument|promise|apolog/.test(text)
      || /邻居|朋友|家人|帮助|信任|冲突|争吵|承诺|道歉/.test(text));
}

function normalizedMemoryDimensions(world = {}, agent = {}, event = {}) {
  const routine = event.category === "routine";
  const text = eventTextForGate(event);
  const ownEvent = !event.targetAgentId || event.targetAgentId === agent.id || event.agentId === agent.id;
  const valence = emotionValenceFromEvent(event);
  const rawEvent = Number.isFinite(Number(event.eventImpact))
    ? Number(event.eventImpact)
    : clampNumber(event.abnormality, 0, 100, routine ? 4 : 25);
  const rawEmotion = Math.max(
    rawDeltaMagnitude(event.emotionDelta, 0),
    rawDeltaMagnitude(event.emotionValence?.intensity, 0),
    Number(event.emotionalIntensity || 0),
    valence.raw?.intensity || 0,
    routine ? 5 : 20
  );
  const rawRelation = event.relationshipDelta || event.relationDelta
    ? rawDeltaMagnitude(event.relationshipDelta ?? event.relationDelta, 0)
    : Number.isFinite(Number(event.relationImpact))
      ? Number(event.relationImpact)
      : ownEvent
        ? 35
        : relationStrength(agent, event.targetAgentId) * 100;
  const rawGoal = event.goalDelta
    ? rawDeltaMagnitude(event.goalDelta, 0)
    : Number.isFinite(Number(event.goalImpact))
      ? Number(event.goalImpact)
      : Number.isFinite(Number(event.futureImpact))
        ? Number(event.futureImpact) * (ownEvent ? 1 : 0.45)
        : (ownEvent ? 25 : 8);
  let V_event = distributionNormalize(world, "event", rawEvent, routine ? 0.04 : 0.25);
  let V_emotion = distributionNormalize(world, "emotion", rawEmotion, routine ? 0.05 : 0.2);
  let V_relation = distributionNormalize(world, "relation", rawRelation, ownEvent ? 0.35 : relationStrength(agent, event.targetAgentId));
  let V_goal = distributionNormalize(world, "goal", rawGoal, ownEvent ? 0.25 : 0.08);

  if (/death|dead|die|fatal/.test(text)) {
    V_event = Math.max(V_event, 1);
    V_emotion = Math.max(V_emotion, ownEvent ? 0.95 : 0.65);
    V_goal = Math.max(V_goal, ownEvent ? 0.9 : 0.35);
  }
  if (/crisis|injury|ill|sick|risk|danger/.test(text)) {
    V_event = Math.max(V_event, 0.75);
    V_emotion = Math.max(V_emotion, ownEvent ? 0.62 : 0.18);
    V_goal = Math.max(V_goal, ownEvent ? 0.62 : 0.16);
  }
  if (/hospital|clinic|doctor|medical/.test(text) && !ownEvent) {
    V_event = Math.max(V_event, 0.55);
    V_emotion = Math.min(Math.max(V_emotion, 0.12), 0.35);
    V_goal = Math.min(Math.max(V_goal, 0.08), 0.25);
  }
  if (/conflict|argument|fight|betray|promise/.test(text)) {
    V_event = Math.max(V_event, 0.72);
    V_emotion = Math.max(V_emotion, 0.52);
    V_relation = Math.max(V_relation, 0.65);
    V_goal = Math.max(V_goal, 0.38);
  }
  if (/helped|help|saved|care/.test(text) && event.targetAgentId) {
    V_event = Math.max(V_event, 0.72);
    V_relation = Math.max(V_relation, relationStrength(agent, event.targetAgentId), 0.68);
    V_emotion = Math.max(V_emotion, 0.52);
    V_goal = Math.max(V_goal, ownEvent ? 0.62 : 0.45);
  }
  if (isDirectSocialEvent(event, text)) {
    V_event = Math.max(V_event, 0.82);
    V_relation = Math.max(V_relation, 0.82);
    V_emotion = Math.max(V_emotion, 0.65);
    V_goal = Math.max(V_goal, 0.7);
  }
  if (event.interruption?.canOverridePlan) {
    const priority = normalizeRatio(event.interruption.priority, 0.7);
    V_event = Math.max(V_event, priority);
    V_emotion = Math.max(V_emotion, ["health", "safety"].includes(event.interruption.type) ? 0.72 : 0.55);
    V_goal = Math.max(V_goal, ["health", "safety"].includes(event.interruption.type) ? 0.85 : 0.62);
    V_relation = Math.max(V_relation, 0.55);
  }

  return {
    V_event: Number(clampNumber(V_event, 0, 1, 0).toFixed(3)),
    V_emotion: Number(clampNumber(V_emotion, 0, 1, 0).toFixed(3)),
    V_relation: Number(clampNumber(V_relation, 0, 1, 0).toFixed(3)),
    V_goal: Number(clampNumber(V_goal, 0, 1, 0).toFixed(3)),
    raw: {
      event: Number(rawEvent.toFixed(3)),
      emotion: Number(rawEmotion.toFixed(3)),
      relation: Number(rawRelation.toFixed(3)),
      goal: Number(rawGoal.toFixed(3))
    },
    emotionValence: valence
  };
}

function multiplicativeMemoryImportance(world = {}, agent = {}, event = {}) {
  const weights = memoryImportanceWeights(world);
  const dimensions = normalizedMemoryDimensions(world, agent, event);
  const contextFactor = contextFactorForEvent(agent, event);
  const memoryType = memoryTypeForDecay(event);
  const timeFactor = timeFactorForEvent(world, event, memoryType);
  const valence = dimensions.emotionValence || emotionValenceFromEvent(event);
  const emotionWeight = emotionMemoryWeight(event, valence);
  const importance = (
    (dimensions.V_event + MEMORY_IMPORTANCE_EPSILON) ** weights.event
    * (dimensions.V_emotion + MEMORY_IMPORTANCE_EPSILON) ** weights.emotion
    * (dimensions.V_relation + MEMORY_IMPORTANCE_EPSILON) ** weights.relation
    * (dimensions.V_goal + MEMORY_IMPORTANCE_EPSILON) ** weights.goal
  ) * contextFactor * timeFactor;
  return {
    importance: Number(clampNumber(importance, 0, 1, 0).toFixed(3)),
    dimensions,
    weights,
    contextFactor: Number(contextFactor.toFixed(3)),
    timeFactor: Number(timeFactor.toFixed(3)),
    memoryTypeForDecay: memoryType,
    emotionValence: valence,
    emotionMemoryWeight: emotionWeight
  };
}

function ensureSelfModel(agent = {}) {
  agent.selfModel ||= {};
  const identityCore = agent.identityCore || {};
  const profile = agent.personalityProfile || {};
  const goals = Array.isArray(agent.longTermGoals) ? agent.longTermGoals : [];
  const goalNames = goals.map(goal => goal?.name || goal?.title || goal?.text).filter(Boolean);
  const job = compactString(agent.job || agent.role || "小镇居民", "小镇居民", 40);
  const name = compactString(agent.name || "这个人", "这个人", 40);
  agent.selfModel.identity = compactString(
    agent.selfModel.identity || identityCore.identity || profile.identity || `${name}把自己理解为一个生活在小镇里的${job}`,
    `${name}把自己理解为一个生活在小镇里的${job}`,
    160
  );
  agent.selfModel.values = uniqueStrings([
    agent.selfModel.values,
    identityCore.values,
    profile.values,
    goalNames.slice(0, 2),
    job ? [`保持${job}身份里的基本责任`] : []
  ], 8);
  agent.selfModel.fears = uniqueStrings([
    agent.selfModel.fears,
    identityCore.fears,
    profile.fears,
    identityCore.avoidance
  ], 8);
  agent.selfModel.selfBeliefs = uniqueStrings([
    agent.selfModel.selfBeliefs,
    identityCore.selfBeliefs,
    identityCore.habits,
    profile.selfBeliefs
  ], 10);
  agent.selfModel.currentSelfView = compactString(
    agent.selfModel.currentSelfView || agent.selfNarrative || agent.reflection?.selfViewUpdate || "最近对自己的判断还比较稳定",
    "最近对自己的判断还比较稳定",
    180
  );
  agent.selfModel.selfImage = compactString(
    agent.selfModel.selfImage || agent.selfModel.currentSelfView || agent.selfModel.identity,
    agent.selfModel.currentSelfView || agent.selfModel.identity,
    180
  );
  agent.selfModel.competenceBeliefs = uniqueStrings([
    agent.selfModel.competenceBeliefs,
    profile.competenceBeliefs
  ], 8);
  agent.selfModel.lifeNarrative = compactString(
    agent.selfModel.lifeNarrative || agent.selfNarrative || agent.selfModel.currentSelfView || agent.selfModel.identity,
    agent.selfModel.currentSelfView || agent.selfModel.identity,
    260
  );
  agent.selfModel.selfConsistencyWeight = clampNumber(agent.selfModel.selfConsistencyWeight, 0, 1, 0.65);
  return agent.selfModel;
}

function normalizeGoalRuntime(agent = {}, world = {}) {
  const clock = Number(world?.clock || 0);
  const source = Array.isArray(agent.longTermGoals) && agent.longTermGoals.length
    ? agent.longTermGoals
    : (agent.longTermGoal || agent.goal ? [{ title: agent.longTermGoal || agent.goal, priority: 0.55, progress: 0.2 }] : []);
  const goals = source
    .map((goal, index) => {
      const name = compactString(goal?.name || goal?.title || goal?.text || goal?.goal || `长期目标 ${index + 1}`, "", 100);
      if (!name) return null;
      const lastProgressTime = goal.lastProgressTime ?? goal.updatedAt ?? goal.at ?? agent.planGeneratedAt ?? 0;
      const staleDays = Math.max(0, Math.floor((clock - Number(lastProgressTime || 0)) / 1440));
      const blockedBy = Array.isArray(goal.blockedBy) ? goal.blockedBy.map(item => compactString(item, "", 80)).filter(Boolean).slice(0, 6) : [];
      const frustration = clampNumber(
        normalizeRatio(goal.frustration, 0) + Math.min(0.35, staleDays * 0.025) + blockedBy.length * 0.04,
        0,
        1,
        0
      );
      const normalized = {
        ...goal,
        id: goal.id || `goal_${agent.id || "agent"}_${index + 1}`,
        name,
        title: goal.title || name,
        priority: normalizeRatio(goal.priority, 0.55),
        progress: normalizeRatio(goal.progress, 0.2),
        frustration,
        lastProgressTime,
        blockedBy
      };
      return normalized;
    })
    .filter(Boolean)
    .slice(0, 8);
  agent.goalRuntime = { goals, updatedAt: clock, source: "runtime-goal-normalizer" };
  if (goals.length) agent.longTermGoals = goals;
  return agent.goalRuntime;
}

function ensureEmotionCauses(agent = {}) {
  if (!Array.isArray(agent.emotionCause)) agent.emotionCause = [];
  agent.emotionCause = agent.emotionCause
    .filter(item => item && item.emotion && Array.isArray(item.causes))
    .slice(0, 40);
  return agent.emotionCause;
}

function recordEmotionCause(agent = {}, detail = {}) {
  if (!agent?.id) return null;
  ensureEmotionCauses(agent);
  const emotion = compactString(detail.emotion || "", "", 30);
  if (!emotion) return null;
  const causes = uniqueStrings(detail.causes || detail.cause || [], 5);
  if (!causes.length) return null;
  const item = {
    emotion,
    intensity: normalizeRatio(detail.intensity, 0.35),
    causes,
    source: detail.source || "runtime",
    at: Number(detail.at || 0),
    eventId: detail.eventId || ""
  };
  agent.emotionCause.unshift(item);
  agent.emotionCause = agent.emotionCause.slice(0, 40);
  return item;
}

function syncLongTermMemoryViews(agent = {}) {
  ensureMemory(agent);
  const structured = structuredMemoryForAgent(agent, 20);
  const emotionalImpact = item => {
    const valence = Number(item.valence || 0);
    if (valence < -10) return "negative";
    if (valence > 10) return "positive";
    return "mixed";
  };
  agent.episodicMemory = (structured.episodic || []).map(item => ({
    id: item.id || "",
    event: compactString(item.text || item.meaning, "", 180),
    meaning: compactString(item.meaning || item.text, "", 220),
    emotionalImpact: item.emotionalImpact || emotionalImpact(item),
    importance: normalizeRatio(item.importance, 0.4),
    at: item.at || 0,
    evidenceIds: Array.isArray(item.evidenceIds) ? item.evidenceIds.slice(0, 8) : []
  })).filter(item => item.event || item.meaning).slice(0, 30);
  agent.beliefMemory = (structured.belief || []).map(item => ({
    id: item.id || "",
    belief: compactString(item.meaning || item.text, "", 180),
    strength: normalizeRatio(item.strength, 0.5),
    confidence: normalizeRatio(item.confidence, Math.min(0.9, 0.35 + normalizeRatio(item.importance, 0.4) * 0.45)),
    sourceEvents: Array.isArray(item.sourceEvents) ? item.sourceEvents.slice(0, 8) : (Array.isArray(item.evidenceIds) ? item.evidenceIds.slice(0, 8) : []),
    createdAt: item.createdAt || item.at || 0,
    lastConfirmed: item.lastConfirmed || item.lastSeenAt || item.at || 0,
    importance: normalizeRatio(item.importance, 0.4),
    at: item.at || 0
  })).filter(item => item.belief).slice(0, 30);
  agent.habitMemory = (structured.habit || []).map(item => ({
    id: item.id || "",
    habit: compactString(item.meaning || item.text, "", 180),
    trigger: compactString(item.trigger || item.tags?.[1] || "相关情境", "相关情境", 80),
    action: compactString(item.action || item.meaning || item.text, "", 120),
    probability: normalizeRatio(item.probability, normalizeRatio(item.strength, 0.45)),
    sourceEvents: Array.isArray(item.sourceEvents) ? item.sourceEvents.slice(0, 8) : (Array.isArray(item.evidenceIds) ? item.evidenceIds.slice(0, 8) : []),
    createdAt: item.createdAt || item.at || 0,
    lastConfirmed: item.lastConfirmed || item.lastSeenAt || item.at || 0,
    strength: normalizeRatio(item.strength, 0.45),
    importance: normalizeRatio(item.importance, 0.3),
    at: item.at || 0
  })).filter(item => item.habit).slice(0, 30);
  agent.preferenceMemory = (structured.preference || []).map(item => {
    const text = compactString(item.meaning || item.text, "", 160);
    const negative = Number(item.valence || 0) < -5 || /不喜欢|讨厌|回避|避免|dislike|avoid/i.test(text);
    return {
      id: item.id || "",
      preference: compactString(item.preference || text, text, 160),
      like: negative ? [] : [text].filter(Boolean),
      dislike: negative ? [text].filter(Boolean) : [],
      strength: normalizeRatio(item.strength, 0.45),
      sourceEvents: Array.isArray(item.sourceEvents) ? item.sourceEvents.slice(0, 8) : (Array.isArray(item.evidenceIds) ? item.evidenceIds.slice(0, 8) : []),
      createdAt: item.createdAt || item.at || 0,
      lastConfirmed: item.lastConfirmed || item.lastSeenAt || item.at || 0,
      at: item.at || 0
    };
  }).filter(item => item.like.length || item.dislike.length).slice(0, 30);
  agent.relationshipMemory = (structured.social || []).map(item => ({
    id: item.id || "",
    target: item.target || "",
    relation: compactString(item.meaning || item.text, "", 180),
    event: compactString(item.text || item.meaning, "", 180),
    impact: Number(item.valence || 0) > 5 ? "positive" : Number(item.valence || 0) < -5 ? "negative" : "mixed",
    importance: normalizeRatio(item.importance, 0.4),
    at: item.at || 0,
    evidenceIds: Array.isArray(item.evidenceIds) ? item.evidenceIds.slice(0, 8) : []
  })).filter(item => item.relation || item.event).slice(0, 40);
  return {
    episodicMemory: agent.episodicMemory,
    beliefMemory: agent.beliefMemory,
    habitMemory: agent.habitMemory,
    preferenceMemory: agent.preferenceMemory,
    relationshipMemory: agent.relationshipMemory
  };
}

function ensureMemory(agent) {
  agent.memory ||= {};
  legacyLayers.forEach(layer => {
    if (!Array.isArray(agent.memory[layer])) agent.memory[layer] = [];
  });
  agent.semanticMemory ||= {};
  semanticTypes.forEach(type => {
    if (!Array.isArray(agent.semanticMemory[type])) agent.semanticMemory[type] = [];
  });
  agent.memoryProfile ||= { habits: {}, lastConsolidatedAt: 0 };
  agent.structuredMemory ||= {};
  structuredTypes.forEach(type => {
    if (!Array.isArray(agent.structuredMemory[type])) agent.structuredMemory[type] = [];
  });
  agent.vectorMemory ||= [];
  if (!Array.isArray(agent.vectorMemory)) agent.vectorMemory = [];
  ensureSelfModel(agent);
  ensureEmotionCauses(agent);
  return agent.memory;
}

function structuredTypeOf(type = "") {
  return structuredAliases[String(type || "").trim()] || "episodic";
}

function memoryVectorText(memory = {}) {
  return String([
    memory.scene,
    memory.text,
    memory.meaning,
    memory.type,
    memory.target,
    ...(Array.isArray(memory.tags) ? memory.tags : [])
  ].filter(Boolean).join(" ")).replace(/\s+/g, " ").trim().slice(0, 500);
}

function hashVector(text = "", dimensions = 64) {
  const vector = new Array(dimensions).fill(0);
  const source = String(text || "").toLowerCase();
  const tokens = source.match(/[a-z0-9_]+|[\u4e00-\u9fa5]{1,2}/g) || [];
  tokens.forEach((token, index) => {
    let hash = 2166136261;
    const value = `${token}:${index % 5}`;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const bucket = Math.abs(hash) % dimensions;
    vector[bucket] += hash % 2 === 0 ? 1 : -1;
  });
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map(value => Number((value / norm).toFixed(6)));
}

function cosineSimilarity(a = [], b = []) {
  const length = Math.min(a.length, b.length);
  if (!length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < length; i += 1) {
    dot += Number(a[i] || 0) * Number(b[i] || 0);
    na += Number(a[i] || 0) ** 2;
    nb += Number(b[i] || 0) ** 2;
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function syncStructuredMemory(agent, item = {}) {
  if (!agent?.id || !item?.id) return null;
  ensureMemory(agent);
  const type = structuredTypeOf(item.type);
  const store = agent.structuredMemory[type];
  const structured = {
    id: item.id,
    type,
    sourceType: item.type || type,
    at: item.at || 0,
    lastSeenAt: item.lastSeenAt || item.at || 0,
    text: item.text || item.meaning || "",
    meaning: item.meaning || item.text || "",
    importance: item.importance || 3,
    strength: item.strength || 50,
    confidence: normalizeRatio(item.confidence, 0.5),
    sourceEvents: Array.isArray(item.sourceEvents) ? item.sourceEvents.slice(0, 8) : (Array.isArray(item.evidenceIds) ? item.evidenceIds.slice(0, 8) : []),
    createdAt: item.createdAt || item.at || 0,
    lastConfirmed: item.lastConfirmed || item.lastSeenAt || item.at || 0,
    trigger: compactString(item.trigger || "", "", 100),
    action: compactString(item.action || "", "", 120),
    probability: item.probability == null ? undefined : normalizeRatio(item.probability, 0.5),
    preference: compactString(item.preference || "", "", 160),
    valence: item.valence || 0,
    target: item.target || "",
    evidenceIds: Array.isArray(item.evidenceIds) ? item.evidenceIds.slice(0, 8) : [],
    tags: Array.isArray(item.tags) ? item.tags.slice(0, 8) : [],
    decay: item.decay ?? 0,
    compressionKey: item.compressionKey || "",
    count: Number(item.count || 1),
    firstTime: item.firstTime ?? item.createdAt ?? item.at ?? 0,
    lastTime: item.lastTime ?? item.lastSeenAt ?? item.at ?? 0,
    averageImportance: item.averageImportance ?? item.importance ?? 3,
    summary: item.summary || item.meaning || item.text || ""
  };
  const existingIndex = store.findIndex(entry => entry.id === structured.id || (entry.text && entry.text === structured.text));
  if (existingIndex >= 0) store[existingIndex] = { ...store[existingIndex], ...structured };
  else store.unshift(structured);
  agent.structuredMemory[type] = store.slice(0, type === "habit" ? 50 : 70);
  return structured;
}

function appendVectorMemory(agent, memory = {}) {
  if (!agent?.id) return null;
  ensureMemory(agent);
  const scene = String(memory.scene || memoryVectorText(memory)).trim();
  if (!scene) return null;
  const sourceMemoryId = memory.sourceMemoryId || memory.id || "";
  const existing = sourceMemoryId ? agent.vectorMemory.find(item => item.sourceMemoryId === sourceMemoryId) : null;
  const item = {
    id: existing?.id || memory.vectorId || `vec_${agent.id}_${Number(memory.at || 0)}_${Math.random().toString(36).slice(2, 8)}`,
    agentId: agent.id,
    sourceMemoryId,
    structuredType: structuredTypeOf(memory.type),
    scene: scene.slice(0, 260),
    text: scene.slice(0, 260),
    at: Number(memory.at || 0),
    lastSeenAt: Number(memory.lastSeenAt || memory.at || 0),
    importance: clampNumber(memory.importance, 1, 5, 3),
    strength: clampNumber(memory.strength, 0, 100, 50),
    valence: clampNumber(memory.valence, -100, 100, 0),
    tags: Array.isArray(memory.tags) ? memory.tags.slice(0, 8) : [],
    vector: Array.isArray(memory.vector) ? memory.vector.slice(0, 4096) : hashVector(scene),
    source: memory.vectorSource || (Array.isArray(memory.vector) ? "vector-memory-external" : "vector-memory-local"),
    vectorModel: memory.vectorModel || "",
    vectorBaseUrl: memory.vectorBaseUrl || "",
    vectorDimensions: Array.isArray(memory.vector) ? Math.min(memory.vector.length, 4096) : 64,
    externalVectorAt: memory.externalVectorAt || 0,
    factAuthority: false,
    rule: "Vector memory is associative recall only; it is not a fact source and cannot decide actions by itself."
  };
  if (existing) Object.assign(existing, item);
  else agent.vectorMemory.unshift(item);
  agent.vectorMemory = agent.vectorMemory.slice(0, 180);
  return item;
}

function normalizedMemoryTextKey(text = "") {
  return String(text || "")
    .toLowerCase()
    .replace(/\d+/g, "")
    .replace(/[，。！？、,.!?:;"'「」『』（）()]/g, " ")
    .replace(/\b(agent|evt|mem|sem|vec)_[a-z0-9_]+\b/g, "")
    .replace(/周[一二三四五六日天]\s*\d{1,2}:\d{2}/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function memoryCompressionKey(memory = {}, type = "experience", text = "") {
  if (memory.compressionKey) return String(memory.compressionKey).slice(0, 140);
  const target = memory.target || "";
  const tags = Array.isArray(memory.tags) ? memory.tags.filter(Boolean).slice(0, 3).join(":") : "";
  const eventClass = memory.eventClass || memory.trigger || memory.action || "";
  const normalized = normalizedMemoryTextKey(text || memory.meaning || memory.text || "");
  return [type, target, tags || eventClass || normalized].filter(Boolean).join(":").slice(0, 160);
}

function structuredMemoryForAgent(agent = {}, perType = 8) {
  ensureMemory(agent);
  const result = Object.fromEntries(structuredTypes.map(type => [type, []]));
  structuredTypes.forEach(type => {
    result[type].push(...(Array.isArray(agent.structuredMemory[type]) ? agent.structuredMemory[type] : []));
  });
  Object.entries(agent.semanticMemory || {}).forEach(([type, items]) => {
    const structuredType = structuredTypeOf(type);
    if (!Array.isArray(items)) return;
    items.forEach(item => {
      result[structuredType].push({
        id: item.id || "",
        type: structuredType,
        sourceType: type,
        at: item.at || 0,
        lastSeenAt: item.lastSeenAt || item.at || 0,
        text: item.text || item.meaning || "",
        meaning: item.meaning || item.text || "",
        importance: item.importance || 3,
        strength: item.strength || 50,
        confidence: normalizeRatio(item.confidence, 0.5),
        sourceEvents: Array.isArray(item.sourceEvents) ? item.sourceEvents.slice(0, 8) : (Array.isArray(item.evidenceIds) ? item.evidenceIds.slice(0, 8) : []),
        createdAt: item.createdAt || item.at || 0,
        lastConfirmed: item.lastConfirmed || item.lastSeenAt || item.at || 0,
        trigger: item.trigger || "",
        action: item.action || "",
        probability: item.probability,
        preference: item.preference || "",
        valence: item.valence || 0,
        target: item.target || "",
        evidenceIds: Array.isArray(item.evidenceIds) ? item.evidenceIds.slice(0, 8) : [],
        tags: Array.isArray(item.tags) ? item.tags.slice(0, 8) : []
      });
    });
  });
  Object.keys(result).forEach(type => {
    const seen = new Set();
    result[type] = result[type]
      .filter(item => {
        const key = item.id || item.text;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => (Number(b.importance || 0) * Number(b.strength || 50)) - (Number(a.importance || 0) * Number(a.strength || 50)))
      .slice(0, perType);
  });
  return result;
}

function retrieveVectorMemories(agent, context = {}, limit = 5) {
  ensureMemory(agent);
  const queryText = String([
    context.type,
    context.place,
    context.title,
    context.reason,
    context.currentTask,
    context.need,
    context.emotion
  ].filter(Boolean).join(" ")).trim();
  if (!queryText || !agent.vectorMemory.length) return [];
  const firstVector = agent.vectorMemory.find(item => Array.isArray(item.vector) && item.vector.length)?.vector || [];
  const queryVector = Array.isArray(context.queryVector) && context.queryVector.length
    ? context.queryVector.slice(0, 4096)
    : hashVector(queryText, firstVector.length || 64);
  const queryTokens = new Set((queryText.toLowerCase().match(/[a-z0-9_]+|[\u4e00-\u9fa5]{1,2}/g) || []).filter(token => token.length > 0));
  return agent.vectorMemory
    .map(item => {
      const itemText = String(item.scene || item.text || "").toLowerCase();
      const itemTokens = itemText.match(/[a-z0-9_]+|[\u4e00-\u9fa5]{1,2}/g) || [];
      const lexicalHits = itemTokens.filter(token => queryTokens.has(token)).length;
      const lexicalSimilarity = Math.min(0.35, lexicalHits * 0.08);
      const similarity = Math.max(cosineSimilarity(queryVector, item.vector || []), lexicalSimilarity);
      const ageDays = Math.max(0, Math.floor((Number(context.clock || 0) - Number(item.lastSeenAt || item.at || 0)) / 1440));
      const decay = Math.exp(-ageDays / (item.structuredType === "habit" || item.structuredType === "belief" ? 90 : 21));
      const score = similarity * clampNumber(item.importance, 1, 5, 3) * decay;
      return { ...item, similarity: Number(similarity.toFixed(4)), lexicalHits, decay: Number(decay.toFixed(4)), score: Number(score.toFixed(4)) };
    })
    .filter(item => item.similarity > 0.02)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function ensureSemanticMemory(agent) {
  ensureMemory(agent);
  return agent.semanticMemory;
}

function ensureEventLog(world, agent = null) {
  if (world) {
    world.eventLog ||= [];
    if (!Array.isArray(world.eventLog)) world.eventLog = [];
  }
  if (agent) {
    agent.eventLog ||= [];
    if (!Array.isArray(agent.eventLog)) agent.eventLog = [];
  }
}

function appendLegacyMemory(agent, memory = {}) {
  if (!agent?.id) return null;
  ensureMemory(agent);
  const layer = legacyLayers.includes(memory.layer) ? memory.layer : "short";
  const text = String(memory.text || "").trim();
  if (!text || isRoutineEventLogText(text) || isBlockedMemoryText(text)) return null;
  const at = Number(memory.at || 0);
  const dedupeKey = memory.dedupeKey || `${layer}:${text}`;
  if (agent.memory[layer].some(item => item?.dedupeKey === dedupeKey || item?.text === text)) return null;
  const item = {
    id: memory.id || `mem_${agent.id}_${at}_${Math.random().toString(36).slice(2, 8)}`,
    at,
    layer,
    text: text.slice(0, 220),
    importance: clampNumber(memory.importance, 1, 5, 3),
    source: memory.source || "memory-stream",
    visibility: memory.visibility || "self",
    tags: Array.isArray(memory.tags) ? memory.tags.slice(0, 8) : [],
    dedupeKey
  };
  agent.memory[layer].unshift(item);
  agent.memory[layer] = agent.memory[layer].slice(0, layer === "short" ? 40 : 60);
  return item;
}

function appendSemanticMemory(agent, memory = {}) {
  if (!agent?.id) return null;
  const store = ensureSemanticMemory(agent);
  const type = semanticTypes.includes(memory.type) ? memory.type : "experience";
  const text = String(memory.text || memory.meaning || "").trim();
  if (!text || isBlockedMemoryText(text)) return null;
  const at = Number(memory.at || 0);
  const dedupeKey = memory.dedupeKey || `${type}:${text}`;
  const compressionKey = memoryCompressionKey(memory, type, text);
  const existing = store[type].find(item => item?.dedupeKey === dedupeKey || item?.text === text || (compressionKey && item?.compressionKey === compressionKey));
  if (existing) {
    const previousCount = Number(existing.count || 1);
    const nextCount = previousCount + 1;
    const incomingImportance = clampNumber(memory.importance, 1, 5, 3);
    const previousAverage = Number(existing.averageImportance || existing.importance || incomingImportance);
    existing.count = nextCount;
    existing.firstTime = Number(existing.firstTime ?? existing.createdAt ?? existing.at ?? at);
    existing.lastTime = Math.max(Number(existing.lastTime || existing.lastSeenAt || 0), at);
    existing.averageImportance = Number(((previousAverage * previousCount + incomingImportance) / nextCount).toFixed(3));
    existing.lastSeenAt = Math.max(Number(existing.lastSeenAt || 0), at);
    existing.lastConfirmed = Math.max(Number(existing.lastConfirmed || 0), at);
    existing.importance = Math.max(Number(existing.importance || 1), incomingImportance);
    existing.strength = clampNumber(Number(existing.strength || 45) + clampNumber(memory.strengthDelta, 1, 12, 3), 0, 100, 50);
    existing.confidence = Math.max(normalizeRatio(existing.confidence, 0.5), normalizeRatio(memory.confidence, 0.5));
    existing.sourceEvents = uniqueStrings([existing.sourceEvents, memory.sourceEvents, memory.evidenceIds], 8);
    existing.summary = existing.summary || existing.meaning || existing.text;
    existing.compressionKey ||= compressionKey;
    syncStructuredMemory(agent, existing);
    appendVectorMemory(agent, {
      ...existing,
      scene: memory.scene || memoryVectorText(existing),
      sourceMemoryId: existing.id
    });
    return existing;
  }
  const item = {
    id: memory.id || `sem_${agent.id}_${type}_${at}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    at,
    lastSeenAt: at,
    text: text.slice(0, 260),
    meaning: String(memory.meaning || text).slice(0, 260),
    importance: clampNumber(memory.importance, 1, 5, 3),
    strength: clampNumber(memory.strength, 0, 100, 50),
    confidence: normalizeRatio(memory.confidence, 0.5),
    sourceEvents: Array.isArray(memory.sourceEvents) ? memory.sourceEvents.slice(0, 8) : (Array.isArray(memory.evidenceIds) ? memory.evidenceIds.slice(0, 8) : []),
    createdAt: memory.createdAt || at,
    lastConfirmed: memory.lastConfirmed || at,
    trigger: compactString(memory.trigger || "", "", 100),
    action: compactString(memory.action || "", "", 120),
    probability: memory.probability == null ? undefined : normalizeRatio(memory.probability, 0.5),
    preference: compactString(memory.preference || "", "", 160),
    valence: clampNumber(memory.valence, -100, 100, 0),
    target: memory.target || "",
    source: memory.source || "memory-consolidator",
    evidenceIds: Array.isArray(memory.evidenceIds) ? memory.evidenceIds.slice(0, 8) : [],
    tags: Array.isArray(memory.tags) ? memory.tags.slice(0, 8) : [],
    dedupeKey,
    compressionKey,
    count: 1,
    firstTime: at,
    lastTime: at,
    averageImportance: clampNumber(memory.importance, 1, 5, 3),
    summary: String(memory.summary || memory.meaning || text).slice(0, 260)
  };
  store[type].unshift(item);
  store[type] = store[type].slice(0, type === "habit" ? 40 : 60);
  syncStructuredMemory(agent, item);
  appendVectorMemory(agent, {
    ...item,
    scene: memory.scene || memoryVectorText(item),
    sourceMemoryId: item.id
  });
  return item;
}

function appendMemory(agent, memory = {}) {
  if (semanticTypes.includes(memory.type) || memory.semantic === true) {
    return appendSemanticMemory(agent, memory);
  }
  return appendLegacyMemory(agent, memory);
}

function cleanReflectionText(text = "") {
  return String(text || "")
    .replace(/^(Daily reflection:\s*)+/i, "")
    .replace(/^Because of health, interrupted the plan:\s*/i, "身体不适，临时调整安排：")
    .replace(/^Because of hunger, interrupted the plan:\s*/i, "饱腹不足，临时调整安排：")
    .replace(/^Because of safety, interrupted the plan:\s*/i, "安全感不足，临时调整安排：")
    .replace(/^Followed the plan\s+"([^"]+)":\s*/i, "按计划「$1」：")
    .trim();
}

function isRoutineEventLogText(text = "") {
  const value = String(text || "");
  if (/^Followed the plan\s+"/i.test(value)) return true;
  if (/^Followed plan\s+/i.test(value)) return true;
  if (/按计划/.test(value) && /吃|饭|睡|上课|上班|通勤|回家|午休|日常|工作|学习/.test(value)) return true;
  return false;
}

function interruptionLabel(type = "") {
  return {
    health: "健康状态",
    hunger: "饱腹状态",
    safety: "安全感",
    fatigue: "疲惫",
    hygiene: "清洁",
    comfort: "舒适",
    emotion: "情绪"
  }[type] || type || "状态";
}

function routineKind(detail = {}) {
  const type = String(detail.type || "");
  const localAction = String(detail.plan?.localAction || "");
  if (/sleep/.test(type) || localAction === "sleep") return "sleep";
  if (/meal|eat|food|hunger/.test(type) || localAction === "meal") return "meal";
  if (/move|commute/.test(type) || localAction === "commute") return "commute";
  if (/work/.test(type) || localAction === "work") return "work";
  if (/study|class|homework/.test(type) || ["study", "homework"].includes(localAction)) return "study";
  if (/rest/.test(type) || localAction === "rest") return "rest";
  return "routine";
}

function habitText(agent, kind) {
  const name = agent?.name || "这个人";
  return {
    sleep: `${name}保持相对规律的休息习惯。`,
    meal: `${name}倾向在固定窗口处理吃饭和补充体力。`,
    commute: `${name}习惯按日程在住处、工作或学习地点之间移动。`,
    work: `${name}保持按时处理工作职责的习惯。`,
    study: `${name}保持按时上课或学习的习惯。`,
    rest: `${name}会用短暂休息维持生活节奏。`,
    routine: `${name}保持稳定的日常生活节奏。`
  }[kind] || `${name}保持稳定的日常生活节奏。`;
}

function eventMeaning(agent, event = {}) {
  const name = agent?.name || "这个人";
  const type = event.interruption?.type || event.type || "";
  if (type === "health" || /health|clinic|medical/.test(event.actionType || "")) {
    return `${name}最近经历健康波动，意识到身体状态会影响工作和日常安排。`;
  }
  if (type === "hunger" || /hunger|food|eat|meal/.test(event.actionType || "")) {
    return `${name}经历过饱腹不足带来的打断，更容易在可行时先处理吃饭。`;
  }
  if (type === "safety" || /safety|risk/.test(event.actionType || "")) {
    return `${name}经历过安全感不足的时刻，遇到风险时会更倾向先避开。`;
  }
  if (type === "fatigue" || /fatigue|rest/.test(event.actionType || "")) {
    return `${name}知道疲惫会拖慢行动，因此会更重视适时休息。`;
  }
  if (type === "hygiene") {
    return `${name}意识到清洁状态会影响舒适和社交意愿。`;
  }
  if (/conflict|argue|misunderstand|冲突|争吵|误会/.test(event.summary || "")) {
    return `${name}经历过人际摩擦，之后会更谨慎处理相关关系。`;
  }
  if (/help|care|救|帮|照顾/.test(event.summary || "")) {
    return `${name}记住了被帮助或求助的经验，未来更可能向可信的人寻求支持。`;
  }
  return `${name}经历了一次不同寻常的情况，并把它作为之后判断的参考。`;
}

function beliefFromEvent(agent, event = {}) {
  const name = agent?.name || "这个人";
  const type = event.interruption?.type || event.type || "";
  if (type === "health") return `${name}逐渐形成判断：健康比硬撑日程更重要。`;
  if (type === "safety") return `${name}逐渐形成判断：安全风险出现时应先避险。`;
  if (type === "hunger") return `${name}逐渐形成判断：长期忽视饱腹会影响后续安排。`;
  if (/help|care|救|帮|照顾/.test(event.summary || "")) return `${name}逐渐相信：遇到困难时可以向可信的人求助。`;
  return "";
}

function importanceFromEvent(event = {}) {
  const result = multiplicativeMemoryImportance({}, {}, event);
  const score = result.importance * 100;
  let importance = 1;
  if (result.importance >= 0.15) importance = 2;
  if (result.importance >= 0.25) importance = 3;
  if (result.importance >= 0.38) importance = 4;
  if (result.importance >= 0.55) importance = 5;
  return { score, importance, ...result };
}

function estimateEventSignals(detail = {}) {
  const interruption = detail.interruption || null;
  const routine = !interruption && isRoutineLifeDetail(detail);
  if (routine) return { abnormality: 4, emotionalIntensity: 5, futureImpact: 12 };
  if (!interruption) return { abnormality: 25, emotionalIntensity: 20, futureImpact: 25 };
  const priority = clampNumber(interruption.priority, 1, 100, 50);
  const hard = Boolean(interruption.canOverridePlan);
  return {
    abnormality: hard ? Math.max(70, priority) : Math.max(35, priority),
    emotionalIntensity: hard ? 72 : 45,
    futureImpact: ["health", "safety"].includes(interruption.type) ? 85 : hard ? 70 : 45
  };
}

function isRoutineLifeDetail(detail = {}) {
  if (detail.interruption) return false;
  const type = String(detail.type || "");
  const localAction = String(detail.plan?.localAction || "");
  return routineActions.has(type) || routineActions.has(localAction) || type.startsWith("plan_");
}

function memoryGate(world = {}, agent = {}, event = {}) {
  ensureMemory(agent);
  const routine = event.category === "routine";
  const kind = routineKind(event);
  const currentHabit = agent.memoryProfile?.habits?.[`habit:${kind}`] || {};
  const routineCount = routine ? Number(currentHabit.count || 0) + 1 : 0;
  const text = eventTextForGate(event);
  const model = multiplicativeMemoryImportance(world, agent, event);
  const baseThreshold = memoryImportanceThreshold(world);
  const threshold = !routine && model.emotionMemoryWeight?.label === "ordinary" ? Math.min(0.95, baseThreshold * 1.15) : baseThreshold;
  let importance = model.importance;
  let memoryType = "episodic";
  if (routine) {
    importance = routineCount >= 3 ? Math.max(threshold, Math.min(0.28, 0.14 + routineCount * 0.035)) : Math.min(threshold * 0.66, importance);
    memoryType = routineCount >= 3 ? "habit" : "";
  } else if ((isDirectSocialEvent(event, text) || /relationship|trust|betray|neighbor|friend|family|helped|saved|conflict|argument|promise/i.test(text)) && model.dimensions.V_relation >= 0.35) {
    memoryType = "social";
  } else if (event.interruption?.canOverridePlan && ["health", "safety"].includes(event.interruption.type)) {
    memoryType = "belief";
  } else if (importance >= 0.35 || /belief|value|realize|learned|important/i.test(text)) {
    memoryType = "belief";
  }

  const shouldRemember = routine ? routineCount >= 3 : (!isBlockedMemoryText(event.summary || "") && importance >= threshold);
  return {
    shouldRemember,
    importance: Number(clampNumber(importance, 0, 1, 0).toFixed(3)),
    memoryType,
    routine,
    routineKind: kind,
    routineCount,
    dimensions: model.dimensions,
    weights: model.weights,
    contextFactor: model.contextFactor,
    timeFactor: model.timeFactor,
    emotionValence: model.emotionValence,
    emotionMemoryWeight: model.emotionMemoryWeight,
    threshold,
    formula: "((V_event + epsilon)^w_event * (V_emotion + epsilon)^w_emotion * (V_relation + epsilon)^w_relation * (V_goal + epsilon)^w_goal) * contextFactor * timeFactor",
    personalityImpact: importance >= 0.45,
    reason: shouldRemember
      ? routine ? "repeated routine became habit" : "event has future behavioral impact"
      : "ordinary event stays in EventLog only"
  };
}

function updateHabit(agent, event = {}, gate = null) {
  ensureMemory(agent);
  const kind = routineKind(event);
  const key = `habit:${kind}`;
  const profile = agent.memoryProfile;
  profile.habits ||= {};
  const current = profile.habits[key] || { count: 0, firstSeenAt: event.clock || 0, lastSeenAt: 0 };
  current.count = Number(current.count || 0) + 1;
  current.lastSeenAt = event.clock || 0;
  current.kind = kind;
  current.text = habitText(agent, kind);
  profile.habits[key] = current;
  if (!gate?.shouldRemember) return null;
  return appendSemanticMemory(agent, {
    type: "habit",
    text: current.text,
    meaning: current.text,
    at: event.clock || 0,
    importance: current.count >= 4 ? 3 : 2,
    strength: clampNumber(35 + current.count * 5, 35, 85, 45),
    source: "memory-consolidator",
    evidenceIds: [event.id],
    tags: ["habit", kind],
    dedupeKey: key
  });
}

function memoryChangesFromEvent(agent, event = {}, gate = {}, meaning = "") {
  const changes = {
    beliefChange: null,
    habitChange: null,
    selfModelChange: null
  };
  if (!gate?.shouldRemember) return changes;
  if (gate.memoryType === "habit" || event.category === "routine") {
    changes.habitChange = {
      trigger: gate.routineKind || routineKind(event),
      delta: Number(Math.min(0.08, Math.max(0.02, Number(gate.importance || 0.5) * 0.08)).toFixed(3)),
      reason: "repeated routine became a habit cue"
    };
  }
  if (gate.memoryType === "belief" || gate.personalityImpact || Number(gate.importance || 0) >= 0.8) {
    const belief = beliefFromEvent(agent, event);
    if (belief) {
      changes.beliefChange = {
        belief,
        delta: Number(Math.min(0.12, Math.max(0.03, Number(gate.importance || 0.6) * 0.12)).toFixed(3)),
        reason: meaning || event.summary || event.type || "meaningful event"
      };
    }
  }
  if (gate.personalityImpact || Number(gate.importance || 0) >= 0.75) {
    changes.selfModelChange = {
      field: "currentSelfView",
      delta: Number(Math.min(0.08, Math.max(0.02, Number(gate.importance || 0.5) * 0.08)).toFixed(3)),
      reason: meaning || event.summary || event.type || "event may affect self understanding"
    };
  }
  return changes;
}

function consolidateEvent(world, agent, event = {}) {
  ensureMemory(agent);
  const gate = memoryGate(world, agent, event);
  event.memoryGate = gate;
  event.memoryChanges = memoryChangesFromEvent(agent, event, gate);
  if (event.category === "routine") {
    return updateHabit(agent, event, gate);
  }
  if (!gate.shouldRemember) return null;
  const importance = clampNumber(Math.ceil(gate.importance * 5), 1, 5, 3);
  event.memoryImportanceScore = gate.importance;
  const meaning = eventMeaning(agent, event);
  event.memoryChanges = memoryChangesFromEvent(agent, event, gate, meaning);
  const semanticType = gate.memoryType === "social" ? "relationship" : "experience";
  const experience = appendSemanticMemory(agent, {
    type: semanticType,
    text: meaning,
    meaning,
    at: event.clock || 0,
    importance,
    strength: clampNumber(45 + importance * 8, 40, 95, 60),
    valence: /健康|安全|不足|摩擦|风险|疲惫|打断/.test(meaning) ? -40 : 20,
    source: "memory-consolidator",
    evidenceIds: [event.id],
    tags: [semanticType, event.interruption?.type, event.actionType].filter(Boolean),
    dedupeKey: `${semanticType}:${agent.id}:${event.interruption?.type || event.actionType || event.type}`
  });
  const belief = gate.memoryType === "belief" || gate.personalityImpact || importance >= 4 ? beliefFromEvent(agent, event) : "";
  if (belief) {
    appendSemanticMemory(agent, {
      type: "belief",
      text: belief,
      meaning: belief,
      at: event.clock || 0,
      importance: Math.max(3, importance),
      strength: clampNumber(50 + importance * 8, 45, 95, 65),
      source: "memory-consolidator",
      evidenceIds: [event.id],
      tags: ["belief", event.interruption?.type].filter(Boolean),
      dedupeKey: `belief:${agent.id}:${event.interruption?.type || event.actionType || event.type}`
    });
  }
  if (semanticType === "relationship") {
    agent.relationshipMemory ||= [];
    agent.relationshipMemory.unshift({
      id: `rel_${event.id}`,
      target: event.targetAgentId || "",
      relation: meaning,
      event: event.summary || meaning,
      impact: /conflict|argument|fight|betray/i.test(event.summary || "") ? "negative" : "positive",
      importance: gate.importance,
      at: event.clock || 0,
      evidenceIds: [event.id]
    });
    agent.relationshipMemory = agent.relationshipMemory.slice(0, 40);
  }
  return experience;
}

function emotionCauseFromEvent(event = {}) {
  const type = event.interruption?.type || event.type || "";
  if (type === "health" || /health|clinic|medical/.test(event.actionType || "")) return { emotion: "anxious", intensity: 0.72 };
  if (type === "safety" || /safety|risk/.test(event.actionType || "")) return { emotion: "anxious", intensity: 0.78 };
  if (type === "hunger" || /hunger|food|eat|meal/.test(event.actionType || "")) return { emotion: "tired", intensity: 0.52 };
  if (type === "fatigue" || /fatigue|rest/.test(event.actionType || "")) return { emotion: "tired", intensity: 0.62 };
  if (type === "hygiene") return { emotion: "anxious", intensity: 0.35 };
  if (/conflict|argue|misunderstand|冲突|争吵|误会/.test(event.summary || "")) return { emotion: "angry", intensity: 0.58 };
  if (/help|care|帮助|照顾|求助/.test(event.summary || "")) return { emotion: "hopeful", intensity: 0.42 };
  if (event.category === "exception") return { emotion: "curious", intensity: 0.32 };
  return null;
}

function recordLifeEvent(world, agent, detail = {}) {
  if (!world || !agent?.id) return null;
  ensureEventLog(world, agent);
  ensureMemory(agent);
  const signals = estimateEventSignals(detail);
  const category = isRoutineLifeDetail(detail) ? "routine" : "exception";
  const clock = Number(world.clock || 0);
  const event = {
    id: detail.id || `evt_${agent.id}_${clock}_${Math.random().toString(36).slice(2, 8)}`,
    clock,
    agentId: agent.id,
    agentName: agent.name || agent.id,
    place: agent.position || agent.place || "",
    type: detail.type || "life",
    category,
    actionType: detail.type || "",
    summary: String(detail.summary || "").slice(0, 240),
    planTitle: detail.plan?.title || "",
    localAction: detail.plan?.localAction || "",
    targetAgentId: detail.targetAgentId || detail.targetId || "",
    contextScope: detail.contextScope || detail.knownByMode || "",
    contextFactor: detail.contextFactor,
    emotionDelta: detail.emotionDelta || null,
    relationshipDelta: detail.relationshipDelta || detail.relationDelta || detail.relationshipChange || null,
    relationImpact: detail.relationImpact ?? detail.relationshipImpact,
    goalImpact: detail.goalImpact,
    goalDelta: detail.goalDelta || null,
    interruption: detail.interruption ? {
      type: detail.interruption.type || "",
      priority: detail.interruption.priority || 0,
      canOverridePlan: Boolean(detail.interruption.canOverridePlan),
      reason: detail.interruption.reason || ""
    } : null,
    abnormality: signals.abnormality,
    emotionalIntensity: signals.emotionalIntensity,
    futureImpact: signals.futureImpact,
    source: detail.source || "life-engine"
  };
  world.eventLog.unshift(event);
  world.eventLog = world.eventLog.slice(0, 2000);
  agent.eventLog.unshift(event);
  agent.eventLog = agent.eventLog.slice(0, 120);
  const memory = consolidateEvent(world, agent, event);
  const cause = emotionCauseFromEvent(event);
  if (cause) {
    recordEmotionCause(agent, {
      ...cause,
      causes: [event.summary || event.planTitle || event.actionType || event.type],
      source: "event-log",
      at: clock,
      eventId: event.id
    });
  }
  syncLongTermMemoryViews(agent);
  normalizeGoalRuntime(agent, world);
  agent.memoryProfile.lastConsolidatedAt = clock;
  agent.memorySummary = buildMemorySummary(agent, world);
  return { event, memory };
}

function recordPlanMemory(world, agent, detail = {}) {
  return recordLifeEvent(world, agent, detail);
}

function semanticMemoryItems(agent = {}) {
  const store = ensureSemanticMemory(agent);
  const typeWeight = { belief: 1.5, experience: 1.35, episodic: 1.35, relationship: 1.3, social: 1.3, goal: 1.25, preference: 1.15, habit: 0.85 };
  return Object.entries(typeWeight).flatMap(([type, multiplier]) => {
    const items = Array.isArray(store[type]) ? store[type] : [];
    return items.map(item => {
      const importance = clampNumber(item.importance, 1, 5, 3);
      const strength = clampNumber(item.strength, 0, 100, 50) / 50;
      return { ...item, type, layer: type, scoreBase: importance * multiplier * strength };
    });
  });
}

function legacyMemoryItems(agent = {}) {
  ensureMemory(agent);
  return legacyLayers.flatMap(layer => {
    const items = Array.isArray(agent.memory[layer]) ? agent.memory[layer] : [];
    return items
      .filter(item => !isRoutineEventLogText(item?.text || item))
      .map(item => ({ ...item, layer, type: item.type || layer, scoreBase: clampNumber(item.importance, 1, 5, 3) }));
  });
}

function retrieveRelevantMemories(agent, context = {}, limit = 6) {
  ensureMemory(agent);
  const query = String([context.type, context.place, context.title, context.reason].filter(Boolean).join(" ")).toLowerCase();
  return [...semanticMemoryItems(agent), ...legacyMemoryItems(agent)]
    .map(item => {
      const text = String(item.text || item.meaning || "").toLowerCase();
      const relevance = query && text ? query.split(/\s+/).filter(token => token && text.includes(token)).length : 0;
      const recency = Math.max(0, 5 - Math.floor((Number(context.clock || 0) - Number(item.lastSeenAt || item.at || 0)) / 1440));
      const score = Number(item.scoreBase || item.importance || 1) * 2 + relevance * 3 + recency;
      return { ...item, text: item.text || item.meaning || "", score };
    })
    .filter(item => item.text)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function summarizeTopMemories(agent, clock = 0, limit = 8) {
  ensureMemory(agent);
  return [...semanticMemoryItems(agent), ...legacyMemoryItems(agent)]
    .map(item => {
      const ageDays = Math.max(0, Math.floor((Number(clock || 0) - Number(item.lastSeenAt || item.at || 0)) / 1440));
      const recency = Math.max(0, 5 - ageDays);
      const semanticBoost = semanticTypes.includes(item.type) ? 2 : 0;
      const score = Number(item.scoreBase || item.importance || 1) * 2 + recency + semanticBoost;
      return { ...item, text: item.text || item.meaning || "", score };
    })
    .filter(item => item.text && item.source !== "local-reflection")
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function recentMeaningfulEvents(world, agent, limit = 4) {
  const events = [
    ...(Array.isArray(agent?.eventLog) ? agent.eventLog : []),
    ...(Array.isArray(world?.eventLog) ? world.eventLog.filter(event => event.agentId === agent?.id) : [])
  ];
  const seen = new Set();
  return events
    .filter(event => event && event.category !== "routine")
    .filter(event => {
      if (seen.has(event.id)) return false;
      seen.add(event.id);
      return true;
    })
    .sort((a, b) => Number(b.clock || 0) - Number(a.clock || 0))
    .slice(0, limit);
}

function buildMemorySummary(agent, world = {}) {
  ensureMemory(agent);
  const store = agent.semanticMemory || {};
  const parts = [];
  const habits = (store.habit || []).slice(0, 2).map(item => item.text);
  const experiences = [...(store.experience || []), ...(store.episodic || [])].slice(0, 2).map(item => item.text);
  const preferences = (store.preference || []).slice(0, 1).map(item => item.text);
  const relationships = [...(store.relationship || []), ...(store.social || [])].slice(0, 1).map(item => item.text);
  const beliefs = (store.belief || []).slice(0, 2).map(item => item.text);
  const goals = (store.goal || []).slice(0, 1).map(item => item.text);
  if (habits.length) parts.push(`生活规律：${habits.join("；")}`);
  if (experiences.length) parts.push(`近期经历：${experiences.join("；")}`);
  if (preferences.length) parts.push(`偏好：${preferences.join("；")}`);
  if (relationships.length) parts.push(`关系变化：${relationships.join("；")}`);
  if (beliefs.length) parts.push(`形成判断：${beliefs.join("；")}`);
  if (goals.length) parts.push(`长期目标：${goals.join("；")}`);
  const events = recentMeaningfulEvents(world, agent, 2);
  if (!experiences.length && events.length) parts.push(`近期状态：${events.map(event => eventMeaning(agent, event)).join("；")}`);
  return parts.length ? `角色近期状态：${parts.join(" / ")}`.slice(0, 500) : "角色近期状态：生活节奏暂时稳定，尚未形成明显的新经验。";
}

function runDailyReflection(world, options = {}) {
  const clock = Number(world?.clock || 0);
  const day = Math.floor(clock / 1440);
  const updated = [];
  (world?.agents || []).forEach(agent => {
    if (!agent?.id || agent.lifeStatus === "dead") return;
    ensureMemory(agent);
    ensureSelfModel(agent);
    const goalRuntime = normalizeGoalRuntime(agent, world);
    syncLongTermMemoryViews(agent);
    agent.reflection ||= {};
    if (!options.force && agent.reflection.day === day) return;
    const meaningfulEvents = recentMeaningfulEvents(world, agent, 6);
    const memories = summarizeTopMemories(agent, clock, 8).filter(item => item.source !== "local-reflection");
    const mainTheme = memories[0]?.text || (meaningfulEvents[0] ? eventMeaning(agent, meaningfulEvents[0]) : "生活节奏暂时稳定");
    const learnedBeliefs = (agent.beliefMemory || []).slice(0, 3).map(item => item.belief).filter(Boolean);
    const newHabits = (agent.habitMemory || []).slice(0, 3).map(item => item.habit).filter(Boolean);
    const preferencesUpdated = (agent.preferenceMemory || [])
      .slice(0, 3)
      .map(item => [...(item.like || []), ...(item.dislike || [])].join(" / "))
      .filter(Boolean);
    const goalChanges = (goalRuntime.goals || [])
      .filter(goal => Number(goal.frustration || 0) >= 0.2 || Number(goal.progress || 0) > 0)
      .slice(0, 3)
      .map(goal => ({
        id: goal.id,
        name: goal.name,
        progress: Number(goal.progress || 0),
        frustration: Number(goal.frustration || 0),
        blockedBy: Array.isArray(goal.blockedBy) ? goal.blockedBy.slice(0, 3) : []
      }));
    const selfViewUpdate = compactString(
      learnedBeliefs[0]
        ? `最近更容易用“${learnedBeliefs[0]}”来理解自己的选择`
        : meaningfulEvents[0]
          ? `最近被“${eventMeaning(agent, meaningfulEvents[0])}”影响了自我判断`
          : "最近自我判断保持稳定，没有明显人格转向",
      "",
      220
    );
    agent.reflection = {
      day,
      at: clock,
      mainTheme: String(mainTheme).slice(0, 180),
      anchors: memories.slice(0, 3).map(item => String(item.text).slice(0, 140)),
      eventAnchors: meaningfulEvents.slice(0, 4).map(event => String(event.summary || eventMeaning(agent, event)).slice(0, 140)),
      learnedBeliefs,
      habitsUpdated: newHabits,
      newHabits,
      preferencesUpdated,
      goalChanges,
      selfViewUpdate,
      source: "local-reflection"
    };
    agent.selfModel.currentSelfView = selfViewUpdate;
    agent.selfModel.selfBeliefs = uniqueStrings([agent.selfModel.selfBeliefs, learnedBeliefs.slice(0, 2)], 10);
    agent.memorySummary = buildMemorySummary(agent, world);
    updated.push(agent.id);
  });
  world.memoryReflectionState ||= {};
  world.memoryReflectionState.lastRunClock = clock;
  world.memoryReflectionState.updatedAgents = updated.slice(0, 200);
  return updated;
}

module.exports = {
  ensureMemory,
  ensureSemanticMemory,
  ensureEventLog,
  appendMemory,
  appendSemanticMemory,
  appendVectorMemory,
  recordLifeEvent,
  recordPlanMemory,
  retrieveRelevantMemories,
  retrieveVectorMemories,
  structuredMemoryForAgent,
  syncLongTermMemoryViews,
  ensureSelfModel,
  normalizeGoalRuntime,
  ensureEmotionCauses,
  recordEmotionCause,
  summarizeTopMemories,
  buildMemorySummary,
  runDailyReflection,
  isRoutineEventLogText,
  consolidateEvent,
  memoryGate,
  importanceFromEvent
};

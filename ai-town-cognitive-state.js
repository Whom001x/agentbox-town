"use strict";

const {
  ensureSelfModel,
  normalizeGoalRuntime,
  structuredMemoryForAgent
} = require("./ai-town-memory-stream");

function num(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max, fallback = min) {
  const number = num(value, fallback);
  return Math.max(min, Math.min(max, number));
}

function textOf(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value || "");
  }
}

function includesAny(text, words) {
  const value = String(text || "").toLowerCase();
  return words.some(word => value.includes(String(word).toLowerCase()));
}

function stableNoise(seed = "", key = "") {
  let hash = 2166136261;
  const value = `${seed}:${key}`;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 1000) / 1000;
}

function add(vector, key, value) {
  if (!key || !Number.isFinite(Number(value))) return;
  vector[key] = Number((num(vector[key], 0) + Number(value)).toFixed(4));
}

function scale01(value, fallback = 0) {
  const number = num(value, fallback);
  if (number <= 1 && number >= 0) return number;
  return clamp(number / 100, 0, 1, fallback);
}

function normalizeWeights(weights = {}) {
  const keys = ["memory", "persona", "emotion", "novelty", "goal", "social"];
  const output = {};
  keys.forEach(key => {
    output[key] = Number(clamp(weights[key], 0.15, 1.2, 0.55).toFixed(3));
  });
  return output;
}

function defaultDecisionWeights(agent = {}) {
  const seed = `${agent.id || ""}:${agent.name || ""}`;
  const text = `${textOf(agent.identityCore)} ${textOf(agent.personalityProfile)} ${agent.job || ""} ${agent.ageStage || ""}`.toLowerCase();
  const weights = {
    memory: 0.55 + stableNoise(seed, "memory") * 0.18,
    persona: 0.55 + stableNoise(seed, "persona") * 0.22,
    emotion: 0.42 + stableNoise(seed, "emotion") * 0.2,
    novelty: 0.25 + stableNoise(seed, "novelty") * 0.2,
    goal: 0.55 + stableNoise(seed, "goal") * 0.25,
    social: 0.35 + stableNoise(seed, "social") * 0.25
  };
  if (includesAny(text, ["detective", "police", "investigator", "侦探", "警察", "调查"])) {
    weights.goal += 0.22;
    weights.novelty += 0.28;
    weights.persona += 0.16;
  }
  if (includesAny(text, ["artist", "writer", "painter", "艺术", "画家", "作家"])) {
    weights.novelty += 0.32;
    weights.memory += 0.1;
    weights.emotion += 0.08;
  }
  if (includesAny(text, ["baker", "shop", "cook", "面包", "店主", "厨师"])) {
    weights.goal += 0.14;
    weights.persona += 0.12;
    weights.novelty -= 0.08;
  }
  if (includesAny(text, ["child", "student", "kid", "儿童", "孩子", "学生"])) {
    weights.social += 0.28;
    weights.emotion += 0.14;
    weights.goal -= 0.05;
  }
  if (includesAny(text, ["elder", "old", "retired", "老人", "退休"])) {
    weights.memory += 0.18;
    weights.novelty -= 0.12;
    weights.emotion += 0.08;
  }
  if (includesAny(text, ["introvert", "quiet", "谨慎", "内向", "安静"])) {
    weights.persona += 0.16;
    weights.novelty -= 0.08;
  }
  if (includesAny(text, ["impulsive", "curious", "冲动", "好奇"])) {
    weights.novelty += 0.18;
    weights.emotion += 0.12;
  }
  return normalizeWeights(weights);
}

function ensureDecisionWeights(agent = {}) {
  agent.decisionWeights = normalizeWeights({
    ...defaultDecisionWeights(agent),
    ...(agent.decisionWeights && typeof agent.decisionWeights === "object" ? agent.decisionWeights : {})
  });
  return agent.decisionWeights;
}

function contextText(world = {}, agent = {}, context = {}) {
  const queue = Array.isArray(agent.eventQueue) ? agent.eventQueue.slice(0, 5).map(textOf).join(" ") : "";
  const recent = Array.isArray(world.records) ? world.records.slice(0, 5).map(record => `${record.title || ""} ${record.summary || ""} ${record.body || ""}`).join(" ") : "";
  return `${context.eventText || ""} ${context.summary || ""} ${agent.currentTask || ""} ${queue} ${recent}`.toLowerCase();
}

function relationshipSignals(agent = {}) {
  const rels = Object.values(agent.relationshipMatrix || agent.relationships || agent.relations || {});
  if (!rels.length) return { trust: 0, intimacy: 0, resentment: 0, dependency: 0, count: 0 };
  const total = rels.reduce((sum, rel) => {
    if (typeof rel === "number") {
      sum.trust += rel;
      sum.intimacy += rel * 0.45;
      return sum;
    }
    sum.trust += num(rel.trust, 0);
    sum.intimacy += num(rel.intimacy, 0);
    sum.resentment += num(rel.resentment, 0);
    sum.dependency += num(rel.dependency, 0);
    return sum;
  }, { trust: 0, intimacy: 0, resentment: 0, dependency: 0 });
  return {
    trust: total.trust / rels.length,
    intimacy: total.intimacy / rels.length,
    resentment: total.resentment / rels.length,
    dependency: total.dependency / rels.length,
    count: rels.length
  };
}

function hasOwn(obj = {}, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function profileValue(profile = {}, key, fallback = 0.5) {
  if (!hasOwn(profile, key)) return null;
  return scale01(profile[key], fallback);
}

function applyCognitiveProfile(agent = {}, driveVector = {}, biasVector = {}, perceptionWeights = {}) {
  const profile = agent.cognitiveProfile && typeof agent.cognitiveProfile === "object" ? agent.cognitiveProfile : {};
  const used = {};
  const riskTolerance = profileValue(profile, "riskTolerance");
  if (riskTolerance != null) {
    biasVector.riskTolerance = Number(clamp(num(biasVector.riskTolerance, 0.5) * 0.72 + riskTolerance * 0.28, 0.02, 0.98, 0.5).toFixed(3));
    used.riskTolerance = riskTolerance;
  }
  const curiosity = profileValue(profile, "curiosity");
  if (curiosity != null) {
    add(driveVector, "curiosity", curiosity * 0.32);
    add(driveVector, "observe", curiosity * 0.18);
    add(perceptionWeights, "novelty", curiosity * 0.22);
    biasVector.noveltySeeking = Number(clamp(num(biasVector.noveltySeeking, 0.35) + (curiosity - 0.5) * 0.32, 0.02, 0.98, 0.35).toFixed(3));
    used.curiosity = curiosity;
  }
  const routinePreference = profileValue(profile, "routinePreference");
  if (routinePreference != null) {
    add(driveVector, "order", routinePreference * 0.22);
    add(driveVector, "home", Math.max(0, routinePreference - 0.45) * 0.16);
    biasVector.goalPersistence = Number(clamp(num(biasVector.goalPersistence, 0.45) + (routinePreference - 0.5) * 0.22, 0.02, 0.98, 0.45).toFixed(3));
    biasVector.noveltySeeking = Number(clamp(num(biasVector.noveltySeeking, 0.35) - Math.max(0, routinePreference - 0.5) * 0.18, 0.02, 0.98, 0.35).toFixed(3));
    used.routinePreference = routinePreference;
  }
  const socialDrive = profileValue(profile, "socialDrive");
  if (socialDrive != null) {
    add(driveVector, "social", socialDrive * 0.28);
    add(driveVector, "support", socialDrive * 0.16);
    biasVector.socialSeeking = Number(clamp(num(biasVector.socialSeeking, 0) + (socialDrive - 0.5) * 0.45, -1, 1, 0).toFixed(3));
    used.socialDrive = socialDrive;
  }
  const ambition = profileValue(profile, "ambition");
  if (ambition != null) {
    add(driveVector, "duty", ambition * 0.22);
    add(driveVector, "goal", ambition * 0.24);
    biasVector.goalPersistence = Number(clamp(num(biasVector.goalPersistence, 0.45) + (ambition - 0.5) * 0.28, 0.02, 0.98, 0.45).toFixed(3));
    used.ambition = ambition;
  }
  const empathy = profileValue(profile, "empathy");
  if (empathy != null) {
    add(driveVector, "support", empathy * 0.24);
    add(driveVector, "social", empathy * 0.12);
    used.empathy = empathy;
  }
  const conflictAvoidance = profileValue(profile, "conflictAvoidance");
  if (conflictAvoidance != null) {
    add(driveVector, "safety", Math.max(0, conflictAvoidance - 0.4) * 0.18);
    add(biasVector, "avoidance", conflictAvoidance * 0.18);
    biasVector.riskTolerance = Number(clamp(num(biasVector.riskTolerance, 0.5) - Math.max(0, conflictAvoidance - 0.5) * 0.16, 0.02, 0.98, 0.5).toFixed(3));
    used.conflictAvoidance = conflictAvoidance;
  }
  const patience = profileValue(profile, "patience");
  if (patience != null) {
    biasVector.patience = Number(clamp(num(biasVector.patience, 0) + (patience - 0.5) * 0.6, -1, 1, 0).toFixed(3));
    biasVector.irritability = Number(clamp(num(biasVector.irritability, 0) - Math.max(0, patience - 0.5) * 0.18, 0, 1, 0).toFixed(3));
    used.patience = patience;
  }
  return used;
}

function memoryToCognition(agent = {}, world = {}) {
  const structured = structuredMemoryForAgent(agent, 10);
  const driveVector = {};
  const biasVector = {};
  const actionModifiers = {};
  const evidence = [];
  Object.entries(structured).forEach(([type, items]) => {
    items.forEach(item => {
      const text = `${item.text || ""} ${item.meaning || ""} ${(item.tags || []).join(" ")}`.toLowerCase();
      const strength = scale01(item.strength, 0.5);
      const importance = clamp(num(item.importance, 3) / 5, 0, 1, 0.6);
      const ageDays = Math.max(0, Math.floor((num(world.clock, 0) - num(item.lastSeenAt || item.at, 0)) / 1440));
      const decay = Math.exp(-ageDays / (["habit", "belief", "goal"].includes(type) ? 120 : 45));
      const weight = importance * strength * decay;
      if (!weight) return;
      if (includesAny(text, ["health", "clinic", "doctor", "sick", "medical", "身体", "健康"])) {
        add(driveVector, "care", weight * 0.65);
        add(driveVector, "recovery", weight * 0.55);
        add(biasVector, "healthConcern", weight);
      }
      if (includesAny(text, ["safe", "risk", "danger", "fear", "unsafe", "安全", "危险"])) {
        add(driveVector, "safety", weight * 0.8);
        add(biasVector, "riskTolerance", -weight * 0.4);
      }
      if (includesAny(text, ["quiet", "rest", "sleep", "home", "calm", "安静", "休息", "家"])) {
        add(driveVector, "comfort", weight * 0.55);
        add(driveVector, "home", weight * 0.45);
      }
      if (includesAny(text, ["trust", "friend", "family", "help", "neighbor", "朋友", "家人", "帮助"])) {
        add(driveVector, "social", weight * 0.45);
        add(driveVector, "support", weight * 0.45);
        add(biasVector, "trustExpectation", weight);
      }
      if (includesAny(text, ["work", "study", "class", "promise", "duty", "responsib", "工作", "学习", "责任"])) {
        add(driveVector, "duty", weight * 0.7);
        add(driveVector, "order", weight * 0.35);
        add(biasVector, "goalPersistence", weight * 0.45);
      }
      if (includesAny(text, ["curious", "observe", "novel", "art", "record", "好奇", "观察", "记录"])) {
        add(driveVector, "curiosity", weight * 0.55);
        add(driveVector, "observe", weight * 0.55);
        add(biasVector, "noveltySeeking", weight * 0.35);
      }
      if (type === "preference" && includesAny(text, ["avoid", "dislike", "回避", "不喜欢"])) {
        add(biasVector, "avoidance", weight);
      }
      if (evidence.length < 8 && (item.text || item.meaning)) {
        evidence.push({ type, text: String(item.text || item.meaning).slice(0, 120), weight: Number(weight.toFixed(3)) });
      }
    });
  });
  return { driveVector, biasVector, actionModifiers, evidence };
}

function cognitiveState(world = {}, agent = {}, context = {}) {
  const needs = agent.needs || {};
  const emotions = agent.emotionVector || agent.emotions || {};
  const emotionCause = Array.isArray(agent.emotionCause) ? agent.emotionCause : [];
  const selfModel = ensureSelfModel(agent);
  const goalRuntime = normalizeGoalRuntime(agent, world);
  const decisionWeights = ensureDecisionWeights(agent);
  const perceptionWeights = {};
  const driveVector = {};
  const biasVector = {
    patience: 0,
    foodAttention: 0,
    irritability: 0,
    socialSeeking: 0,
    riskTolerance: 0.5,
    goalPersistence: 0.5,
    noveltySeeking: 0.35,
    supportSeeking: 0.25
  };
  const actionModifiers = {};

  const hungerLow = clamp((100 - num(needs.hunger, 75)) / 100, 0, 1, 0);
  const healthLow = clamp((100 - num(needs.health, 80)) / 100, 0, 1, 0);
  const safetyLow = clamp((100 - num(needs.safety, 82)) / 100, 0, 1, 0);
  const socialLow = clamp((100 - num(needs.social, 70)) / 100, 0, 1, 0);
  const comfortLow = clamp((100 - num(needs.comfort, 70)) / 100, 0, 1, 0);
  const responsibilityLow = clamp((100 - num(needs.responsibility, 70)) / 100, 0, 1, 0);
  const stressLow = clamp((100 - num(needs.stress, 70)) / 100, 0, 1, 0);
  const hygieneLow = clamp((100 - num(needs.hygiene, 75)) / 100, 0, 1, 0);

  add(perceptionWeights, "body", healthLow * 0.9 + hungerLow * 0.35 + comfortLow * 0.25);
  add(perceptionWeights, "food", hungerLow);
  add(perceptionWeights, "threat", safetyLow + healthLow * 0.35);
  add(perceptionWeights, "social", socialLow);
  add(perceptionWeights, "duty", responsibilityLow);
  add(perceptionWeights, "comfort", comfortLow + hygieneLow * 0.3);

  add(driveVector, "comfort", hungerLow * 0.18 + comfortLow * 0.55 + stressLow * 0.2);
  add(driveVector, "food", hungerLow * 0.72);
  add(driveVector, "care", healthLow * 0.62);
  add(driveVector, "recovery", healthLow * 0.45 + comfortLow * 0.22);
  add(driveVector, "safety", safetyLow * 0.78 + healthLow * 0.18);
  add(driveVector, "social", socialLow * 0.42);
  add(driveVector, "support", socialLow * 0.22 + safetyLow * 0.2 + healthLow * 0.16);
  add(driveVector, "duty", responsibilityLow * 0.45);
  add(driveVector, "order", responsibilityLow * 0.25 + hygieneLow * 0.2);

  biasVector.patience = Number((-hungerLow * 0.32 - stressLow * 0.2 - healthLow * 0.12).toFixed(3));
  biasVector.foodAttention = Number((hungerLow * 0.72).toFixed(3));
  biasVector.irritability = Number((hungerLow * 0.18 + stressLow * 0.25 + num(emotions.angry, 0) / 220).toFixed(3));
  biasVector.socialSeeking = Number((socialLow * 0.35 + num(emotions.lonely, 0) / 260).toFixed(3));
  biasVector.riskTolerance = Number(clamp(0.52 - safetyLow * 0.35 - healthLow * 0.18 + num(emotions.happy, 0) / 500, 0.05, 0.95, 0.5).toFixed(3));
  biasVector.goalPersistence = Number(clamp(0.45 + responsibilityLow * 0.22 - hungerLow * 0.12 - healthLow * 0.1, 0.05, 0.95, 0.45).toFixed(3));
  biasVector.noveltySeeking = Number(clamp(0.28 + num(emotions.curious, 0) / 220 + num(emotions.hopeful, 0) / 420 - safetyLow * 0.18, 0.05, 0.95, 0.3).toFixed(3));
  biasVector.supportSeeking = Number(clamp(0.22 + socialLow * 0.28 + safetyLow * 0.22 + healthLow * 0.14, 0, 1, 0.2).toFixed(3));

  const text = `${textOf(agent.identityCore)} ${textOf(agent.personalityProfile)} ${textOf(selfModel)} ${agent.job || ""} ${agent.ageStage || ""}`.toLowerCase();
  if (includesAny(text, ["detective", "police", "investigator", "侦探", "调查", "警察"])) {
    add(driveVector, "curiosity", 0.36);
    add(driveVector, "observe", 0.32);
    add(driveVector, "duty", 0.28);
    biasVector.riskTolerance = clamp(biasVector.riskTolerance + 0.18, 0, 1, biasVector.riskTolerance);
  }
  if (includesAny(text, ["artist", "writer", "painter", "艺术", "画家", "作家"])) {
    add(driveVector, "curiosity", 0.34);
    add(driveVector, "observe", 0.36);
    biasVector.noveltySeeking = clamp(biasVector.noveltySeeking + 0.22, 0, 1, biasVector.noveltySeeking);
  }
  if (includesAny(text, ["baker", "shop", "cook", "面包", "店主", "厨师"])) {
    add(driveVector, "order", 0.28);
    add(driveVector, "home", 0.52);
    add(driveVector, "comfort", 0.18);
    add(driveVector, "safety", 0.16);
    add(driveVector, "duty", 0.18);
    biasVector.goalPersistence = clamp(biasVector.goalPersistence + 0.12, 0, 1, biasVector.goalPersistence);
  }
  if (includesAny(text, ["child", "kid", "student", "儿童", "孩子", "学生"])) {
    add(driveVector, "support", 0.76);
    add(driveVector, "social", 0.42);
    add(driveVector, "safety", 0.22);
    biasVector.supportSeeking = clamp(biasVector.supportSeeking + 0.25, 0, 1, biasVector.supportSeeking);
    biasVector.riskTolerance = clamp(biasVector.riskTolerance - 0.12, 0, 1, biasVector.riskTolerance);
  }
  if (includesAny(text, ["elder", "old", "retired", "老人", "退休"])) {
    add(driveVector, "safety", 0.34);
    add(driveVector, "comfort", 0.24);
    biasVector.riskTolerance = clamp(biasVector.riskTolerance - 0.22, 0, 1, biasVector.riskTolerance);
  }
  if (includesAny(text, ["introvert", "quiet", "内向", "安静"])) {
    add(driveVector, "comfort", 0.18);
    add(driveVector, "observe", 0.14);
    biasVector.socialSeeking = clamp(biasVector.socialSeeking - 0.12, -1, 1, biasVector.socialSeeking);
  }

  const profileSignals = applyCognitiveProfile(agent, driveVector, biasVector, perceptionWeights);

  const ctx = contextText(world, agent, context);
  if (includesAny(ctx, ["stranger", "unknown person", "陌生人", "可疑"])) {
    add(perceptionWeights, "threat", 0.36);
    add(perceptionWeights, "novelty", 0.34);
    add(driveVector, "safety", 0.28);
    add(driveVector, "curiosity", 0.24);
    add(driveVector, "observe", 0.22);
  }
  if (includesAny(ctx, ["night", "late", "evening", "晚上", "夜里"])) {
    add(perceptionWeights, "threat", 0.18);
    add(driveVector, "home", 0.16);
    biasVector.riskTolerance = clamp(biasVector.riskTolerance - 0.08, 0, 1, biasVector.riskTolerance);
  }

  const rel = relationshipSignals(agent);
  if (rel.count) {
    add(driveVector, "social", clamp(rel.intimacy / 100, 0, 1, 0) * 0.18);
    add(driveVector, "support", clamp(rel.trust / 100, 0, 1, 0) * 0.2);
    if (rel.resentment > 45) add(biasVector, "avoidance", rel.resentment / 180);
  }

  (goalRuntime.goals || []).slice(0, 5).forEach(goal => {
    const priority = clamp(num(goal.priority, 0.5), 0, 1, 0.5);
    const goalText = `${goal.name || ""} ${goal.title || ""} ${(goal.blockedBy || []).join(" ")}`.toLowerCase();
    add(driveVector, "duty", priority * 0.2);
    add(driveVector, "order", priority * 0.12);
    if (includesAny(goalText, ["health", "medical", "身体", "健康"])) add(driveVector, "care", priority * 0.3);
    if (includesAny(goalText, ["family", "friend", "social", "家人", "朋友"])) add(driveVector, "social", priority * 0.25);
  });

  const memorySignals = memoryToCognition(agent, world);
  Object.entries(memorySignals.driveVector).forEach(([key, value]) => add(driveVector, key, value));
  Object.entries(memorySignals.biasVector).forEach(([key, value]) => add(biasVector, key, value));
  Object.entries(memorySignals.actionModifiers).forEach(([key, value]) => add(actionModifiers, key, value));

  emotionCause.slice(0, 8).forEach(item => {
    const causeText = `${item.emotion || ""} ${(item.causes || []).join(" ")}`.toLowerCase();
    const intensity = scale01(item.intensity, 0.35);
    if (includesAny(causeText, ["health", "sick", "medical", "身体", "健康"])) add(driveVector, "care", intensity * 0.18);
    if (includesAny(causeText, ["promise", "work", "class", "study", "责任", "工作"])) add(driveVector, "duty", intensity * 0.16);
    if (includesAny(causeText, ["friend", "family", "help", "家人", "朋友"])) add(driveVector, "support", intensity * 0.16);
  });

  const result = {
    agentId: agent.id || "",
    decisionWeights,
    perceptionWeights,
    driveVector,
    biasVector,
    actionModifiers,
    memoryEvidence: memorySignals.evidence,
    relationshipSignals: rel,
    cognitiveProfile: profileSignals,
    source: "cognitive-state-v3"
  };
  agent.cognitiveState = result;
  return result;
}

const actionVectorTemplates = {
  continue_process: { duty: 0.8, order: 0.4, risk: 0.15 },
  seek_care: { care: 0.9, recovery: 0.72, safety: 0.42, support: 0.28, risk: 0.18, cost: 0.35, time: 0.35 },
  seek_safety: { safety: 0.92, home: 0.55, comfort: 0.38, risk: 0.08, cost: 0.22, time: 0.18 },
  eat_or_buy_food: { food: 0.92, comfort: 0.45, social: 0.12, cost: 0.2, time: 0.22, availability: 0.75 },
  rest: { comfort: 0.72, recovery: 0.7, home: 0.45, risk: 0.04, cost: 0.08, time: 0.25 },
  tidy_or_clean: { order: 0.62, comfort: 0.45, duty: 0.18, risk: 0.02, cost: 0.12, time: 0.18 },
  contact_familiar: { social: 0.78, support: 0.55, comfort: 0.18, risk: 0.12, cost: 0.14, time: 0.2, availability: 0.7 },
  follow_plan: { duty: 0.9, order: 0.48, goal: 0.55, risk: 0.1, cost: 0.18, time: 0.4 },
  observe_environment: { observe: 0.72, safety: 0.22, curiosity: 0.24, risk: 0.06, novelty: 0.15, cost: 0.06, time: 0.12 },
  think_and_plan: { order: 0.52, goal: 0.62, comfort: 0.18, curiosity: 0.12, risk: 0.02, cost: 0.05, time: 0.18 },
  walk_nearby: { novelty: 0.42, comfort: 0.34, curiosity: 0.36, risk: 0.28, cost: 0.2, time: 0.28 },
  return_home: { home: 0.92, safety: 0.68, comfort: 0.52, order: 0.38, risk: 0.08, cost: 0.16, time: 0.22 },
  follow_stranger: { curiosity: 0.86, observe: 0.72, duty: 0.38, novelty: 0.65, risk: 0.75, cost: 0.28, time: 0.38, availability: 0.45 },
  ask_guardian: { support: 1.05, social: 0.72, safety: 0.52, risk: 0.08, cost: 0.06, time: 0.14, availability: 1 },
  record_observation: { observe: 0.9, novelty: 0.58, curiosity: 0.62, comfort: 0.12, risk: 0.18, cost: 0.12, time: 0.22 }
};

function actionVector(action = {}) {
  const base = {
    ...(actionVectorTemplates[action.id] || {}),
    ...(action.actionVector && typeof action.actionVector === "object" ? action.actionVector : {})
  };
  if (action.targetNeed === "health") add(base, "care", 0.25);
  if (action.targetNeed === "safety") add(base, "safety", 0.25);
  if (action.targetNeed === "hunger") add(base, "food", 0.25);
  if (action.targetNeed === "social") add(base, "social", 0.2);
  if ((action.tags || []).includes("responsibility")) add(base, "duty", 0.18);
  return Object.fromEntries(Object.entries(base).map(([key, value]) => [key, Number(clamp(value, 0, 1.5, 0).toFixed(3))]));
}

function dotProduct(a = {}, b = {}) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let sum = 0;
  keys.forEach(key => {
    if (["risk", "cost", "time", "distance", "availability", "locationRule"].includes(key)) return;
    sum += num(a[key], 0) * num(b[key], 0);
  });
  return Number(sum.toFixed(4));
}

function actionMatch(cognitive = {}, action = {}) {
  const vector = action.actionVector || actionVector(action);
  return dotProduct(cognitive.driveVector || {}, vector);
}

function realityConstraint(cognitive = {}, action = {}, context = {}) {
  const vector = action.actionVector || actionVector(action);
  const epsilon = 0.05;
  const riskTolerance = clamp(cognitive.biasVector?.riskTolerance, 0.02, 1, 0.5);
  let availability = num(vector.availability, action.availability ?? 1);
  const threat = clamp(cognitive.perceptionWeights?.threat, 0, 1.5, 0);
  if (action.id === "think_and_plan" && threat > 0.35) availability *= 0.72;
  if (action.id === "return_home" && threat > 0.35) availability *= 1.08;
  const values = {
    safety: clamp(1 - num(vector.risk, 0) * (1 - riskTolerance), epsilon, 1, 1),
    cost: clamp(1 - num(vector.cost, 0) * 0.65, epsilon, 1, 1),
    distance: clamp(1 - num(context.distance, action.distance || 0) * 0.25, epsilon, 1, 1),
    time: clamp(1 - num(vector.time, 0) * 0.45, epsilon, 1, 1),
    locationRule: context.locationRuleBlocked ? 0.08 : 1,
    availability: clamp(availability, epsilon, 1, 1)
  };
  const weights = { safety: 1.15, cost: 0.55, distance: 0.35, time: 0.45, locationRule: 1.4, availability: 0.65 };
  const product = Object.entries(values).reduce((acc, [key, value]) => acc * (Math.max(value, epsilon) ** weights[key]), 1);
  return { value: Number(product.toFixed(4)), values, weights };
}

function cognitiveTemperature(agent = {}, cognitive = {}) {
  const text = `${textOf(agent.identityCore)} ${textOf(agent.personalityProfile)} ${textOf(agent.selfModel)}`.toLowerCase();
  let temperature = 0.65;
  if (includesAny(text, ["cautious", "careful", "谨慎", "稳重"])) temperature -= 0.22;
  if (includesAny(text, ["impulsive", "curious", "冲动", "好奇"])) temperature += 0.22;
  temperature += clamp(cognitive.biasVector?.irritability, 0, 1, 0) * 0.12;
  temperature += clamp(cognitive.biasVector?.noveltySeeking, 0, 1, 0) * 0.08;
  temperature -= (1 - clamp(cognitive.biasVector?.riskTolerance, 0, 1, 0.5)) * 0.08;
  return Number(clamp(temperature, 0.3, 1.0, 0.65).toFixed(3));
}

module.exports = {
  ensureDecisionWeights,
  defaultDecisionWeights,
  cognitiveState,
  actionVector,
  actionMatch,
  realityConstraint,
  cognitiveTemperature,
  dotProduct
};

"use strict";

const {
  ensureSelfModel,
  normalizeGoalRuntime,
  structuredMemoryForAgent
} = require("./ai-town-memory-stream");
const { socialFieldInfluenceForAgent } = require("./ai-town-social-field");
const { getSocialModifier } = require("./ai-town-social-feedback");
const { updateTemporalCausalMemory } = require("./ai-town-temporal-causal");

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

function blendNumber(prev, next, alpha) {
  return Number((num(prev, next) * alpha + num(next, prev) * (1 - alpha)).toFixed(4));
}

function blendVector(prev = {}, next = {}, alpha = 0.85) {
  const output = {};
  new Set([...Object.keys(prev || {}), ...Object.keys(next || {})]).forEach(key => {
    output[key] = blendNumber(prev?.[key], next?.[key], alpha);
  });
  return output;
}

function meanAbsDiff(prev = {}, next = {}) {
  const keys = [...new Set([...Object.keys(prev || {}), ...Object.keys(next || {})])];
  if (!keys.length) return 0;
  const sum = keys.reduce((total, key) => total + Math.abs(clamp(next?.[key], 0, 1, 0) - clamp(prev?.[key], 0, 1, 0)), 0);
  return sum / keys.length;
}

function scale01(value, fallback = 0) {
  const number = num(value, fallback);
  if (number <= 1 && number >= 0) return number;
  return clamp(number / 100, 0, 1, fallback);
}

function stageFromAgent(agent = {}) {
  const age = num(agent.ageYears ?? agent.age, 35);
  const text = `${agent.ageStage || ""} ${agent.job || ""} ${textOf(agent.identityCore)} ${textOf(agent.selfModel)}`.toLowerCase();
  if (age <= 12 || includesAny(text, ["child", "kid", "student child", "\u513f\u7ae5", "\u5b69\u5b50", "\u5c0f\u5b66\u751f"])) return "child";
  if (age <= 18 || includesAny(text, ["teen", "student", "\u9752\u5c11\u5e74", "\u5b66\u751f", "\u4e2d\u5b66\u751f"])) return "teen";
  if (age >= 65 || includesAny(text, ["elder", "old", "retired", "\u8001\u4eba", "\u8001\u5e74", "\u9000\u4f11"])) return "elder";
  return "adult";
}

function professionFromAgent(agent = {}) {
  const text = `${agent.job || ""} ${agent.ageStage || ""} ${textOf(agent.identityCore)} ${textOf(agent.selfModel)}`.toLowerCase();
  if (includesAny(text, ["doctor", "nurse", "clinic", "medical", "physician", "\u533b\u751f", "\u62a4\u58eb", "\u533b\u62a4", "\u8bca\u6240", "\u533b\u7597"])) return "medical";
  if (includesAny(text, ["shop", "store", "merchant", "seller", "baker", "breakfast", "cashier", "owner", "\u5e97\u4e3b", "\u8001\u677f", "\u5e97\u5458", "\u5c0f\u5356\u90e8", "\u65e9\u9910", "\u5546\u8d29", "\u552e\u8d27", "\u6536\u94f6", "\u9762\u5305"])) return "merchant";
  if (includesAny(text, ["teacher", "school", "class", "\u8001\u5e08", "\u6559\u5e08", "\u5b66\u6821"])) return "teacher";
  if (includesAny(text, ["student", "pupil", "\u5b66\u751f", "\u5c0f\u5b66\u751f", "\u4e2d\u5b66\u751f"])) return "student";
  if (includesAny(text, ["guard", "security", "police", "\u4fdd\u5b89", "\u8b66\u5bdf", "\u5de1\u903b"])) return "security";
  if (includesAny(text, ["detective", "investigator", "\u4fa6\u63a2", "\u8c03\u67e5"])) return "investigator";
  if (includesAny(text, ["artist", "writer", "painter", "\u827a\u672f", "\u753b\u5bb6", "\u4f5c\u5bb6", "\u8bb0\u5f55"])) return "artist";
  return "resident";
}

function actionIdOf(item = {}) {
  if (!item || typeof item !== "object") return String(item || "");
  return String(item.actionId || item.id || item.type || item.action || item.name || "");
}

function reflectionActionCalibration(agent = {}, context = {}) {
  const currentTask = String(agent.currentTask || context.currentTask || "").toLowerCase();
  const history = Array.isArray(agent.actionHistory) ? agent.actionHistory.slice(0, 16) : [];
  const ids = history.map(actionIdOf).filter(Boolean);
  const isReflection = id => includesAny(String(id).toLowerCase(), ["think_and_plan", "think", "plan", "reflect"]);
  let consecutiveReflection = 0;
  for (const id of ids) {
    if (!isReflection(id)) break;
    consecutiveReflection += 1;
  }
  if (includesAny(currentTask, ["think", "plan", "reflect", "pause", "\u601d\u8003", "\u8ba1\u5212", "\u6574\u7406\u601d\u8def"])) {
    consecutiveReflection += 1;
  }
  const reflectionCount = ids.filter(isReflection).length;
  const reflectionRatio = ids.length ? reflectionCount / ids.length : 0;
  const threshold = clamp(context.reflectionSaturationThreshold ?? 2, 1, 8, 2);
  const reflectionSaturation = clamp((consecutiveReflection - threshold) / 5 + Math.max(0, reflectionRatio - 0.6) * 1.2, 0, 1, 0);
  const goalClarity = clamp(
    num(agent.goalRuntime?.goals?.[0]?.clarity, 0)
      || num(agent.goalRuntime?.goals?.[0]?.priority, 0)
      || num(context.goalClarity, 0.45),
    0,
    1,
    0.45
  );
  const thoughtCompletionPressure = clamp(reflectionSaturation * 0.55 + goalClarity * Math.min(1, consecutiveReflection / 5) * 0.35, 0, 1, 0);
  const antiThinkPressure = clamp(Math.max(0, reflectionRatio - 0.6) * 1.8 + reflectionSaturation * 0.5, 0, 1, 0);
  const actionExecutionPressure = clamp(thoughtCompletionPressure * 0.72 + antiThinkPressure * 0.38, 0, 1, 0);
  return {
    consecutiveReflection,
    reflectionRatio: Number(reflectionRatio.toFixed(3)),
    reflectionSaturation: Number(reflectionSaturation.toFixed(3)),
    thoughtCompletionPressure: Number(thoughtCompletionPressure.toFixed(3)),
    actionExecutionPressure: Number(actionExecutionPressure.toFixed(3)),
    antiThinkPressure: Number(antiThinkPressure.toFixed(3))
  };
}

function runtimeContextProjection(agent = {}, context = {}) {
  const plan = context.plan || null;
  const interruption = context.interruption || null;
  const currentTask = String(agent.currentTask || "").slice(0, 120);
  const history = Array.isArray(agent.actionHistory) ? agent.actionHistory.slice(0, 12) : [];
  const ids = history.map(actionIdOf).filter(Boolean);
  const counts = ids.reduce((map, id) => map.set(id, (map.get(id) || 0) + 1), new Map());
  const repeatRate = ids.length >= 4 && counts.size ? Math.max(...counts.values()) / Math.max(1, ids.length) : 0;
  const curiosity = scale01(agent.cognitiveProfile?.curiosity, 0.5);
  const novelty = scale01(agent.cognitiveProfile?.noveltySeeking ?? agent.cognitiveProfile?.curiosity, curiosity);
  const uncertainty = scale01(context.uncertainty ?? interruption?.priority, 0);
  const thoughtAction = reflectionActionCalibration(agent, context);
  return {
    stage: stageFromAgent(agent),
    profession: professionFromAgent(agent),
    currentPlace: agent.position || agent.place || "",
    activeProcess: Boolean(agent.activeProcess),
    lifeStatus: agent.lifeStatus || "alive",
    terminalDead: Boolean(agent.terminalState?.dead),
    profile: {
      curiosity,
      riskTolerance: scale01(agent.cognitiveProfile?.riskTolerance, 0.5)
    },
    taskState: {
      currentTask,
      medicalDuty: includesAny(currentTask, ["clinic", "medical", "doctor", "诊所", "医院", "问诊", "看诊"]),
      businessDuty: includesAny(currentTask, ["shop", "store", "business", "customer", "店", "顾客", "补货"])
    },
    behavioralEntropy: {
      repeatRate: Number(repeatRate.toFixed(4)),
      unique: counts.size,
      total: ids.length
    },
    thoughtAction,
    explorationPressure: {
      base: scale01(agent.explorationRate, 0.05),
      threshold: scale01(context.behaviorEntropyThreshold ?? context.explorationThreshold, 0.75),
      curiosityDrive: curiosity,
      uncertainty,
      noveltyPressure: Number(clamp(novelty + thoughtAction.antiThinkPressure * 0.22, 0, 1, novelty).toFixed(3)),
      actionExecutionPressure: thoughtAction.actionExecutionPressure
    },
    relationship: {
      dependent: relationshipSignals(agent).dependency >= 70
    },
    plan: plan ? {
      title: String(plan.title || "").slice(0, 120),
      place: String(plan.place || "").slice(0, 80),
      localAction: String(plan.localAction || "").slice(0, 80),
      fixed: Boolean(plan.fixed)
    } : null,
    interruption: interruption ? {
      type: String(interruption.type || ""),
      priority: num(interruption.priority, 0),
      canOverridePlan: Boolean(interruption.canOverridePlan),
      reason: String(interruption.reason || "").slice(0, 120)
    } : null
  };
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
  const influenceVector = {};
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
        add(driveVector, "care", weight * 0.78);
        add(driveVector, "recovery", weight * 0.66);
        add(influenceVector, "healthConcern", weight * 0.72);
        add(biasVector, "healthConcern", weight);
      }
      if (includesAny(text, ["safe", "risk", "danger", "fear", "unsafe", "安全", "危险"])) {
        add(driveVector, "safety", weight * 0.96);
        add(influenceVector, "riskAvoidance", weight * 0.78);
        add(biasVector, "riskTolerance", -weight * 0.48);
      }
      if (includesAny(text, ["quiet", "rest", "sleep", "home", "calm", "安静", "休息", "家"])) {
        add(driveVector, "comfort", weight * 0.66);
        add(driveVector, "home", weight * 0.54);
        add(influenceVector, "comfortSeeking", weight * 0.58);
      }
      if (includesAny(text, ["trust", "friend", "family", "help", "neighbor", "朋友", "家人", "帮助"])) {
        add(driveVector, "social", weight * 0.62);
        add(driveVector, "support", weight * 0.6);
        add(influenceVector, "socialExpectation", weight * 0.72);
        add(biasVector, "trustExpectation", weight);
      }
      if (includesAny(text, ["work", "study", "class", "promise", "duty", "responsib", "工作", "学习", "责任"])) {
        add(driveVector, "duty", weight * 0.84);
        add(driveVector, "order", weight * 0.45);
        add(influenceVector, "responsibilityExpectation", weight * 0.7);
        add(biasVector, "goalPersistence", weight * 0.54);
      }
      if (includesAny(text, ["curious", "observe", "novel", "art", "record", "好奇", "观察", "记录"])) {
        add(driveVector, "curiosity", weight * 0.7);
        add(driveVector, "observe", weight * 0.68);
        add(influenceVector, "explorationRecall", weight * 0.68);
        add(biasVector, "noveltySeeking", weight * 0.42);
      }
      if (type === "preference" && includesAny(text, ["avoid", "dislike", "回避", "不喜欢"])) {
        add(biasVector, "avoidance", weight);
        add(influenceVector, "avoidance", weight * 0.72);
      }
      if (evidence.length < 8 && (item.text || item.meaning)) {
        evidence.push({ type, text: String(item.text || item.meaning).slice(0, 120), weight: Number(weight.toFixed(3)) });
      }
    });
  });
  return { driveVector, biasVector, influenceVector, actionModifiers, evidence };
}

function config01(value, fallback = 0.55) {
  if (value === undefined || value === null || value === "") return fallback;
  return scale01(value, fallback);
}

function cognitiveEngineConfig(world = {}) {
  const cfg = world?.config && typeof world.config === "object" ? world.config : {};
  return {
    enabled: cfg.cognitiveEngineEnabled !== false,
    memoryInfluence: config01(cfg.cognitiveMemoryInfluence, 0.55),
    beliefInfluence: config01(cfg.cognitiveBeliefInfluence, 0.6),
    emotionInfluence: config01(cfg.cognitiveEmotionInfluence, 0.55),
    goalInfluence: config01(cfg.cognitiveGoalInfluence, 0.6),
    personalityInfluence: config01(cfg.cognitivePersonalityInfluence, 0.55)
  };
}

function personalityPressureFromProfile(agent = {}) {
  const profile = agent.cognitiveProfile && typeof agent.cognitiveProfile === "object" ? agent.cognitiveProfile : {};
  const routine = scale01(profile.routinePreference, 0.5);
  const curiosity = scale01(profile.curiosity, 0.5);
  const social = scale01(profile.socialDrive, 0.5);
  const empathy = scale01(profile.empathy, 0.5);
  const ambition = scale01(profile.ambition, 0.5);
  const risk = scale01(profile.riskTolerance, 0.5);
  const conflictAvoidance = scale01(profile.conflictAvoidance, 0.5);
  return {
    routinePressure: Number(clamp(routine * 0.82 + (1 - curiosity) * 0.18, 0, 1, 0.5).toFixed(3)),
    explorationPressure: Number(clamp(curiosity * 0.78 + risk * 0.22, 0, 1, 0.5).toFixed(3)),
    socialActivation: Number(clamp(social * 0.68 + empathy * 0.32, 0, 1, 0.5).toFixed(3)),
    achievementDrive: Number(clamp(ambition, 0, 1, 0.5).toFixed(3)),
    safetyBias: Number(clamp((1 - risk) * 0.55 + conflictAvoidance * 0.45, 0, 1, 0.5).toFixed(3))
  };
}

function applyPersonalityProjection(driveVector = {}, biasVector = {}, pressure = {}) {
  const routine = clamp(num(pressure.routinePressure, 0.5), 0, 1, 0.5);
  const exploration = clamp(num(pressure.explorationPressure, 0.5), 0, 1, 0.5);
  const social = clamp(num(pressure.socialActivation, 0.5), 0, 1, 0.5);
  const achievement = clamp(num(pressure.achievementDrive, 0.5), 0, 1, 0.5);
  const safety = clamp(num(pressure.safetyBias, 0.5), 0, 1, 0.5);
  add(driveVector, "order", Math.max(0, routine - 0.5) * 0.28);
  add(driveVector, "home", Math.max(0, routine - 0.55) * 0.22);
  add(driveVector, "curiosity", Math.max(0, exploration - 0.45) * 0.44);
  add(driveVector, "observe", Math.max(0, exploration - 0.45) * 0.38);
  add(driveVector, "social", Math.max(0, social - 0.45) * 0.36);
  add(driveVector, "support", Math.max(0, social - 0.5) * 0.28);
  add(driveVector, "duty", Math.max(0, achievement - 0.45) * 0.34);
  add(driveVector, "goal", Math.max(0, achievement - 0.5) * 0.28);
  add(driveVector, "safety", Math.max(0, safety - 0.5) * 0.32);
  biasVector.noveltySeeking = Number(clamp(num(biasVector.noveltySeeking, 0.35) + (exploration - 0.5) * 0.16, 0.02, 0.98, 0.35).toFixed(3));
  biasVector.socialSeeking = Number(clamp(num(biasVector.socialSeeking, 0) + (social - 0.5) * 0.18, -1, 1, 0).toFixed(3));
  biasVector.goalPersistence = Number(clamp(num(biasVector.goalPersistence, 0.45) + (achievement - 0.5) * 0.16, 0.02, 0.98, 0.45).toFixed(3));
  biasVector.riskTolerance = Number(clamp(num(biasVector.riskTolerance, 0.5) - Math.max(0, safety - 0.5) * 0.12, 0.02, 0.98, 0.5).toFixed(3));
}

function buildMemoryInfluenceVector(memorySignals = {}, activeMemories = [], activation = 0) {
  const output = { ...(memorySignals.influenceVector || {}) };
  (Array.isArray(activeMemories) ? activeMemories : []).slice(0, 8).forEach(item => {
    const text = `${item.text || ""} ${item.meaning || ""} ${item.event || ""} ${item.myExperience || ""}`.toLowerCase();
    const importance = scale01(item.importance ?? item.strength ?? item.weight, 0.4);
    const novelty = scale01(item.novelty ?? item.eventSignificance?.novelty, 0.35);
    const emotionDelta = scale01(item.emotionDelta ?? item.emotionalImpact ?? item.eventSignificance?.emotionChange, 0.25);
    const predictionError = scale01(item.predictionError ?? item.expectationError ?? item.eventSignificance?.predictionError, 0.25);
    const surprise = clamp(importance * 0.35 + novelty * 0.25 + emotionDelta * 0.18 + predictionError * 0.22, 0, 1, 0);
    const weight = clamp(num(item.activation, 0), 0, 1, 0) * (0.28 + surprise * 0.72);
    if (!weight) return;
    add(output, "surprise", surprise * weight);
    add(output, "predictionError", predictionError * weight);
    if (includesAny(text, ["health", "clinic", "doctor", "sick", "medical"])) add(output, "healthConcern", weight);
    if (includesAny(text, ["safe", "risk", "danger", "fear", "unsafe", "fail", "blocked", "refused"])) {
      add(output, "riskAvoidance", weight);
      add(output, "avoidancePressure", predictionError * weight);
    }
    if (includesAny(text, ["quiet", "rest", "sleep", "home", "calm"])) add(output, "comfortSeeking", weight);
    if (includesAny(text, ["trust", "friend", "family", "help", "neighbor", "support", "care"])) {
      add(output, "socialExpectation", weight);
      add(output, "approachPressure", Math.max(surprise, emotionDelta) * weight * 0.6);
    }
    if (includesAny(text, ["work", "study", "class", "promise", "duty", "responsib", "finish", "complete"])) add(output, "responsibilityExpectation", weight);
    if (includesAny(text, ["curious", "observe", "novel", "art", "record", "new"])) add(output, "explorationRecall", weight);
  });
  if (activation > 0) add(output, "activation", activation * 0.55);
  return Object.fromEntries(Object.entries(output).map(([key, value]) => [key, Number(clamp(value, 0, 1, 0).toFixed(3))]));
}

function applyMemoryInfluenceProjection(driveVector = {}, biasVector = {}, vector = {}) {
  const surpriseBoost = 1 + num(vector.surprise, 0) * 0.65 + num(vector.predictionError, 0) * 0.55;
  add(driveVector, "care", num(vector.healthConcern, 0) * 0.2 * surpriseBoost);
  add(driveVector, "safety", num(vector.riskAvoidance, 0) * 0.2 * surpriseBoost);
  add(driveVector, "comfort", num(vector.comfortSeeking, 0) * 0.16 * surpriseBoost);
  add(driveVector, "social", (num(vector.socialExpectation, 0) * 0.22 + num(vector.approachPressure, 0) * 0.18) * surpriseBoost);
  add(driveVector, "support", (num(vector.socialExpectation, 0) * 0.18 + num(vector.approachPressure, 0) * 0.14) * surpriseBoost);
  add(driveVector, "duty", num(vector.responsibilityExpectation, 0) * 0.2 * surpriseBoost);
  add(driveVector, "curiosity", (num(vector.explorationRecall, 0) * 0.18 + num(vector.surprise, 0) * 0.12) * surpriseBoost);
  add(driveVector, "observe", (num(vector.explorationRecall, 0) * 0.16 + num(vector.predictionError, 0) * 0.1) * surpriseBoost);
  add(biasVector, "avoidance", (num(vector.riskAvoidance, 0) * 0.1 + num(vector.avoidancePressure, 0) * 0.12) * surpriseBoost);
  add(biasVector, "socialSeeking", (num(vector.socialExpectation, 0) * 0.1 + num(vector.approachPressure, 0) * 0.08) * surpriseBoost);
  add(biasVector, "noveltySeeking", num(vector.surprise, 0) * 0.08);
}

function causalExpectationFromBias(causalBias = {}, activeCausalMemory = []) {
  const active = (Array.isArray(activeCausalMemory) ? activeCausalMemory : []).slice(0, 6);
  const activation = active.length
    ? active.reduce((sum, item) => sum + clamp(num(item.activation ?? item.confidence, 0), 0, 1, 0), 0) / active.length
    : 0;
  let approach = 0;
  let avoidance = 0;
  active.forEach(item => {
    const text = `${item.learning?.causalRule || ""} ${item.learning?.causalBelief || ""} ${item.effect || ""} ${item.trigger || ""}`.toLowerCase();
    const weight = clamp(num(item.activation ?? item.confidence, 0), 0, 1, 0);
    if (includesAny(text, ["fail", "risk", "unsafe", "stress", "lonely", "tired", "conflict", "avoid"])) avoidance += weight;
    if (includesAny(text, ["reward", "success", "trust", "help", "recover", "support", "familiar", "improve"])) approach += weight;
  });
  if (active.length) {
    approach /= active.length;
    avoidance /= active.length;
  }
  const confidence = clamp(Math.max(num(causalBias.confidence, 0), activation), 0, 1, 0);
  const futureExpectationPressure = clamp(confidence * 0.45 + (approach + avoidance) * 0.28, 0, 1, 0);
  return {
    safetyExpectation: Number(clamp(num(causalBias.safetyBias, 0) * 0.72 + activation * 0.2 + avoidance * 0.18, 0, 1, 0).toFixed(3)),
    socialExpectation: Number(clamp(num(causalBias.socialBias, 0) * 0.72 + activation * 0.16 + approach * 0.18 - avoidance * 0.04, 0, 1, 0).toFixed(3)),
    responsibilityExpectation: Number(clamp(num(causalBias.responsibilityBias, 0) * 0.72 + activation * 0.18 + approach * 0.08, 0, 1, 0).toFixed(3)),
    futureExpectationPressure: Number(futureExpectationPressure.toFixed(3)),
    approachPressure: Number(clamp(approach * 0.55 + num(causalBias.socialBias, 0) * 0.16 + num(causalBias.responsibilityBias, 0) * 0.12, 0, 1, 0).toFixed(3)),
    avoidancePressure: Number(clamp(avoidance * 0.55 + num(causalBias.safetyBias, 0) * 0.18, 0, 1, 0).toFixed(3)),
    confidence: Number(confidence.toFixed(3))
  };
}

const attractorCenters = {
  routine: { order: 0.85, home: 0.78, comfort: 0.45, duty: 0.25 },
  social: { social: 0.82, support: 0.72, comfort: 0.22 },
  exploration: { curiosity: 0.86, observe: 0.78, novelty: 0.42 },
  safety: { safety: 0.88, care: 0.38, recovery: 0.3, home: 0.25 },
  achievement: { duty: 0.86, goal: 0.72, order: 0.38 }
};

function vectorDistance(a = {}, b = {}) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  if (!keys.size) return 0;
  let sum = 0;
  keys.forEach(key => {
    sum += (num(a[key], 0) - num(b[key], 0)) ** 2;
  });
  return Math.sqrt(sum / keys.size);
}

function normalizedScores(scores = {}) {
  const total = Object.values(scores).reduce((sum, value) => sum + Math.max(0.001, num(value, 0)), 0) || 1;
  return Object.fromEntries(Object.entries(scores).map(([key, value]) => [key, Number((Math.max(0.001, num(value, 0)) / total).toFixed(3))]));
}

function shiftedAttractorCenter(base = {}, driveVector = {}, towardWeight = 0, offsets = {}) {
  const weight = clamp(towardWeight, 0, 0.35, 0);
  const center = {};
  new Set([...Object.keys(base), ...Object.keys(offsets)]).forEach(axis => {
    const anchor = num(base[axis], 0);
    const shifted = anchor * (1 - weight) + num(driveVector[axis], anchor) * weight + num(offsets[axis], 0);
    center[axis] = Number(clamp(shifted, 0, 1, anchor).toFixed(3));
  });
  return center;
}

function buildAttractorLandscape(agent = {}, driveVector = {}, personalityPressure = {}, memoryInfluenceVector = {}, causalExpectationPressure = {}, rel = {}, thoughtAction = null) {
  const previous = agent.psychologicalState?.projection?.attractorLandscape || {};
  const previousDominant = previous.dominantAttractor || "";
  const previousStreak = num(previous.dominantStreak, 0);
  const transition = clamp(num(agent.psychologicalState?.projection?.transitionPressure?.total, 0), 0, 1, 0);
  const recent = (agent.actionHistory || []).slice(0, 8).map(actionIdOf);
  const routineActionRatio = recent.length
    ? recent.filter(id => ["return_home", "think_and_plan", "rest", "tidy_or_clean"].includes(id)).length / recent.length
    : 0;
  const calibration = thoughtAction || reflectionActionCalibration(agent);
  const reflectionSaturation = clamp(num(calibration.reflectionSaturation, 0), 0, 1, 0);
  const actionExecutionPressure = clamp(num(calibration.actionExecutionPressure, 0), 0, 1, 0);
  const thoughtCompletionPressure = clamp(num(calibration.thoughtCompletionPressure, 0), 0, 1, 0);
  const reflectionRatio = clamp(num(calibration.reflectionRatio, 0), 0, 1, 0);
  const conflict = clamp(num(rel.resentment, 0) / 100, 0, 1, 0);
  const trust = clamp((num(rel.trust, 0) + num(rel.intimacy, 0)) / 200, 0, 1, 0);
  const flatten = clamp(
    Math.max(0, routineActionRatio - 0.55) * 0.9
      + reflectionSaturation * 0.48
      + Math.max(0, reflectionRatio - 0.6) * 0.72
      + Math.max(0, num(previous.distribution?.routine, 0) - 0.8) * 0.7
      + (previousDominant === "routine" && previousStreak >= 4 ? 0.22 : 0),
    0,
    0.72,
    0
  );
  const depth = {
    routine: clamp(0.75 + num(personalityPressure.routinePressure, 0.5) * 0.45 + num(memoryInfluenceVector.comfortSeeking, 0) * 0.16 - flatten - reflectionSaturation * 0.18, 0.25, 1.35, 0.8),
    social: clamp(0.7 + num(personalityPressure.socialActivation, 0.5) * 0.5 + num(memoryInfluenceVector.socialExpectation, 0) * 0.22 + num(causalExpectationPressure.socialExpectation, 0) * 0.16 + trust * 0.12 - conflict * 0.1 + actionExecutionPressure * 0.16, 0.25, 1.35, 0.8),
    exploration: clamp(0.7 + num(personalityPressure.explorationPressure, 0.5) * 0.56 + num(memoryInfluenceVector.explorationRecall, 0) * 0.24 + transition * 0.35 + flatten * 0.42 + actionExecutionPressure * 0.18, 0.25, 1.35, 0.8),
    safety: clamp(0.7 + num(personalityPressure.safetyBias, 0.5) * 0.46 + num(memoryInfluenceVector.riskAvoidance, 0) * 0.22 + num(causalExpectationPressure.safetyExpectation, 0) * 0.18 + conflict * 0.12, 0.25, 1.35, 0.8),
    achievement: clamp(0.7 + num(personalityPressure.achievementDrive, 0.5) * 0.5 + num(memoryInfluenceVector.responsibilityExpectation, 0) * 0.24 + num(causalExpectationPressure.responsibilityExpectation, 0) * 0.18 + flatten * 0.18 + thoughtCompletionPressure * 0.18, 0.25, 1.35, 0.8)
  };
  const centers = {
    routine: shiftedAttractorCenter(attractorCenters.routine, driveVector, num(memoryInfluenceVector.comfortSeeking, 0) * 0.08, { comfort: num(personalityPressure.routinePressure, 0.5) * 0.025 }),
    social: shiftedAttractorCenter(attractorCenters.social, driveVector, trust * 0.12 + num(memoryInfluenceVector.socialExpectation, 0) * 0.08, { social: -conflict * 0.08, support: -conflict * 0.07, observe: conflict * 0.1, comfort: conflict * 0.04 }),
    exploration: shiftedAttractorCenter(attractorCenters.exploration, driveVector, transition * 0.08 + num(memoryInfluenceVector.explorationRecall, 0) * 0.1, { novelty: flatten * 0.08 + actionExecutionPressure * 0.04, observe: flatten * 0.05 + actionExecutionPressure * 0.04 }),
    safety: shiftedAttractorCenter(attractorCenters.safety, driveVector, num(memoryInfluenceVector.riskAvoidance, 0) * 0.08 + conflict * 0.06, { safety: num(causalExpectationPressure.safetyExpectation, 0) * 0.04 }),
    achievement: shiftedAttractorCenter(attractorCenters.achievement, driveVector, num(memoryInfluenceVector.responsibilityExpectation, 0) * 0.08, { goal: num(causalExpectationPressure.responsibilityExpectation, 0) * 0.04 + thoughtCompletionPressure * 0.05 })
  };
  const attractors = Object.fromEntries(Object.entries(centers).map(([key, centerVector]) => [
    key,
    {
      centerVector,
      strength: Number(clamp(1 / Math.max(0.1, depth[key]), 0.2, 2, 1).toFixed(3)),
      basinDepth: Number(depth[key].toFixed(3)),
      basinRadius: Number(clamp(0.35 + depth[key] * 0.25, 0.25, 0.75, 0.45).toFixed(3)),
      decayRate: Number(clamp(0.02 + (1 - depth[key]) * 0.02, 0.01, 0.05, 0.02).toFixed(3))
    }
  ]));
  const energies = {};
  Object.entries(attractors).forEach(([key, attractor]) => {
    energies[key] = vectorDistance(driveVector, attractor.centerVector) * Math.max(0.1, attractor.strength);
  });
  const dominantAttractor = Object.entries(energies).sort((a, b) => a[1] - b[1])[0]?.[0] || "routine";
  const memoryBias = {
    routine: num(memoryInfluenceVector.comfortSeeking, 0) * 0.08,
    social: num(memoryInfluenceVector.socialExpectation, 0) * 0.12,
    exploration: num(memoryInfluenceVector.explorationRecall, 0) * 0.12,
    safety: num(memoryInfluenceVector.riskAvoidance, 0) * 0.1,
    achievement: num(memoryInfluenceVector.responsibilityExpectation, 0) * 0.1
  };
  const rawScores = Object.fromEntries(Object.entries(energies).map(([key, energy]) => [
    key,
    clamp(
      (1 / (0.05 + energy))
        + memoryBias[key]
        + (key !== previousDominant ? transition * 0.18 : 0)
        + (["social", "exploration", "achievement"].includes(key) ? actionExecutionPressure * 0.22 : 0)
        - (key === "routine" ? reflectionSaturation * 0.26 : 0),
      0.001,
      100,
      0.001
    )
  ]));
  const distribution = normalizedScores(rawScores);
  return {
    attractors,
    energies: Object.fromEntries(Object.entries(energies).map(([key, value]) => [key, Number(value.toFixed(3))])),
    distribution,
    dominantAttractor,
    dominantStreak: dominantAttractor === previousDominant ? previousStreak + 1 : 1,
    transitionProbability: distribution,
    flattened: Number(flatten.toFixed(3)),
    reflectionSaturation: Number(reflectionSaturation.toFixed(3)),
    thoughtCompletionPressure: Number(thoughtCompletionPressure.toFixed(3)),
    actionExecutionPressure: Number(actionExecutionPressure.toFixed(3)),
    memoryCoupling: Number(clamp(Object.values(memoryBias).reduce((sum, value) => sum + value, 0), 0, 1, 0).toFixed(3)),
    mode: "multi-attractor"
  };
}

function applyAttractorLandscape(driveVector = {}, biasVector = {}, landscape = {}) {
  const distribution = landscape.distribution || {};
  const pull = {};
  const centers = Object.fromEntries(Object.entries(landscape.attractors || {}).map(([key, attractor]) => [key, attractor.centerVector || attractorCenters[key] || {}]));
  Object.entries(Object.keys(centers).length ? centers : attractorCenters).forEach(([key, center]) => {
    const weight = clamp(num(distribution[key], 0), 0, 1, 0) * 0.22;
    Object.entries(center).forEach(([axis, value]) => add(pull, axis, (value - num(driveVector[axis], 0)) * weight));
  });
  const flatten = num(landscape.flattened, 0);
  if (flatten > 0) {
    add(pull, "home", -flatten * 0.16);
    add(pull, "order", -flatten * 0.12);
    add(pull, "curiosity", flatten * 0.22);
    add(pull, "observe", flatten * 0.18);
    add(pull, "social", flatten * 0.12);
    add(pull, "goal", flatten * 0.1);
  }
  const actionPressure = num(landscape.actionExecutionPressure, 0);
  const reflectionSaturation = num(landscape.reflectionSaturation, 0);
  if (actionPressure > 0 || reflectionSaturation > 0) {
    add(pull, "order", -reflectionSaturation * 0.14);
    add(pull, "home", -reflectionSaturation * 0.08);
    add(pull, "goal", actionPressure * 0.18);
    add(pull, "duty", actionPressure * 0.16);
    add(pull, "curiosity", actionPressure * 0.16);
    add(pull, "observe", actionPressure * 0.14);
    add(pull, "social", actionPressure * 0.12);
    add(pull, "support", actionPressure * 0.08);
  }
  Object.entries(pull).forEach(([key, value]) => add(driveVector, key, clamp(value, -0.24, 0.24, 0)));
  add(biasVector, "noveltySeeking", num(distribution.exploration, 0) * 0.05 + flatten * 0.06);
  add(biasVector, "socialSeeking", num(distribution.social, 0) * 0.05);
  return Object.fromEntries(Object.entries(pull).map(([key, value]) => [key, Number(clamp(value, -0.24, 0.24, 0).toFixed(3))]));
}

function blendAttractorLandscape(prev = {}, next = {}, alpha = 0.86) {
  if (!next || typeof next !== "object") return prev || {};
  const distribution = blendVector(prev?.distribution, next.distribution, alpha);
  const transitionProbability = blendVector(prev?.transitionProbability, next.transitionProbability, alpha);
  const energies = blendVector(prev?.energies, next.energies, alpha);
  const dominantAttractor = Object.entries(distribution)
    .sort((a, b) => num(b[1], 0) - num(a[1], 0))[0]?.[0]
    || next.dominantAttractor
    || prev?.dominantAttractor
    || "routine";
  return {
    ...next,
    energies,
    distribution,
    transitionProbability,
    dominantAttractor,
    dominantStreak: dominantAttractor === prev?.dominantAttractor ? num(prev?.dominantStreak, 0) + 1 : 1,
    flattened: blendNumber(prev?.flattened, next.flattened, alpha),
    reflectionSaturation: blendNumber(prev?.reflectionSaturation, next.reflectionSaturation, alpha),
    thoughtCompletionPressure: blendNumber(prev?.thoughtCompletionPressure, next.thoughtCompletionPressure, alpha),
    actionExecutionPressure: blendNumber(prev?.actionExecutionPressure, next.actionExecutionPressure, alpha),
    memoryCoupling: blendNumber(prev?.memoryCoupling, next.memoryCoupling, alpha)
  };
}

function weightedInfluence(parts = []) {
  let weighted = 0;
  let total = 0;
  parts.forEach(part => {
    const weight = clamp(part?.weight, 0, 3, 0);
    if (!weight) return;
    weighted += clamp(part.value, 0, 1, 0) * weight;
    total += weight;
  });
  return Number(clamp(total ? weighted / total : 0, 0, 1, 0).toFixed(3));
}

function tokenize(text = "") {
  return (String(text || "").toLowerCase().match(/[a-z0-9_]+|[\u4e00-\u9fa5]{1,2}/g) || [])
    .filter(token => token.length > 1)
    .slice(0, 80);
}

function tokenRelevance(text = "", references = []) {
  const tokens = tokenize(references.join(" "));
  if (!tokens.length) return 0;
  const source = String(text || "").toLowerCase();
  const unique = [...new Set(tokens)];
  const hits = unique.filter(token => source.includes(token)).length;
  return clamp(hits / Math.max(3, unique.length), 0, 1, 0);
}

function emotionKeywords(emotions = {}, emotionCause = []) {
  const pairs = [
    ["tired", ["tired", "fatigue", "rest", "sleep", "累", "疲", "休息"]],
    ["anxious", ["anxious", "risk", "safe", "worry", "焦虑", "担心", "安全"]],
    ["angry", ["angry", "conflict", "argument", "愤怒", "争执", "冲突"]],
    ["sad", ["sad", "lonely", "loss", "难过", "孤独", "失落"]],
    ["lonely", ["lonely", "friend", "family", "孤独", "朋友", "家人"]],
    ["curious", ["curious", "observe", "novel", "好奇", "观察", "新鲜"]],
    ["hopeful", ["hope", "goal", "future", "希望", "目标", "以后"]]
  ];
  const words = [];
  pairs.forEach(([key, items]) => {
    if (scale01(emotions[key], 0) >= 0.45) words.push(...items);
  });
  emotionCause.slice(0, 6).forEach(item => {
    words.push(item.emotion || "");
    words.push(...(Array.isArray(item.causes) ? item.causes : []));
  });
  return words.filter(Boolean);
}

function flattenStructuredMemory(agent = {}, limit = 32) {
  const structured = structuredMemoryForAgent(agent, limit);
  const rows = [];
  Object.entries(structured).forEach(([type, items]) => {
    (Array.isArray(items) ? items : []).forEach(item => {
      const text = item.text || item.meaning || item.belief || item.habit || item.preference || "";
      if (!text) return;
      rows.push({
        ...item,
        type,
        text: String(text),
        meaning: item.meaning || String(text),
        importance: item.importance,
        strength: item.strength,
        at: item.at || item.createdAt || 0,
        lastSeenAt: item.lastSeenAt || item.lastConfirmed || item.at || 0
      });
    });
  });
  const seen = new Set();
  return rows.filter(item => {
    const key = `${item.type}:${item.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function activateMemories(world = {}, agent = {}, context = {}, driveVector = {}, emotions = {}, goalRuntime = {}) {
  const clock = num(world.clock, 0);
  const emotionCause = Array.isArray(agent.emotionCause) ? agent.emotionCause : [];
  const goalTexts = (goalRuntime.goals || []).map(goal => `${goal.name || ""} ${goal.title || ""} ${(goal.blockedBy || []).join(" ")}`);
  const contextRefs = [
    context.eventText || "",
    context.summary || "",
    context.plan?.title || "",
    context.plan?.localAction || "",
    context.interruption?.type || "",
    context.interruption?.reason || "",
    agent.currentTask || "",
    Object.entries(driveVector).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([key]) => key).join(" ")
  ];
  const emotionRefs = emotionKeywords(emotions, emotionCause);
  const rows = flattenStructuredMemory(agent, 36).map(item => {
    const text = `${item.text || ""} ${item.meaning || ""} ${(item.tags || []).join(" ")}`;
    const relevance = tokenRelevance(text, contextRefs);
    const emotionMatch = tokenRelevance(text, emotionRefs);
    const goalMatch = tokenRelevance(text, goalTexts);
    const ageDays = Math.max(0, Math.floor((clock - num(item.lastSeenAt || item.at, clock)) / 1440));
    const recency = Math.exp(-ageDays / (["habit", "belief", "preference"].includes(item.type) ? 120 : 45));
    const importance = clamp(num(item.importance, 3) / 5, 0, 1, 0.6);
    const strength = scale01(item.strength, 0.55);
    const activation = weightedInfluence([
      { value: relevance, weight: 0.38 },
      { value: emotionMatch, weight: 0.22 },
      { value: goalMatch, weight: 0.22 },
      { value: recency, weight: 0.1 },
      { value: importance * strength, weight: 0.28 }
    ]);
    return {
      id: item.id || "",
      type: item.type || "episodic",
      text: String(item.meaning || item.text || "").slice(0, 180),
      activation,
      relevance: Number(relevance.toFixed(3)),
      emotionMatch: Number(emotionMatch.toFixed(3)),
      goalMatch: Number(goalMatch.toFixed(3)),
      recency: Number(clamp(recency, 0, 1, 0).toFixed(3)),
      importance: Number(importance.toFixed(3)),
      factAuthority: false,
      rule: "Activated memory is a behavioral cue, not a world fact."
    };
  });
  return rows
    .filter(item => item.activation >= 0.12 || ["belief", "habit"].includes(item.type))
    .sort((a, b) => b.activation - a.activation)
    .slice(0, 8);
}

function activeBeliefsFromMemories(agent = {}, activeMemories = []) {
  const direct = Array.isArray(agent.beliefMemory) ? agent.beliefMemory : [];
  const activated = activeMemories.filter(item => item.type === "belief");
  const rows = [
    ...activated.map(item => ({
      id: item.id || "",
      belief: item.text || "",
      activation: item.activation,
      strength: item.importance || 0.5,
      source: "memory-activation"
    })),
    ...direct.map(item => ({
      id: item.id || "",
      belief: item.belief || item.text || item.meaning || "",
      activation: clamp(scale01(item.strength, 0.5) * 0.72 + scale01(item.importance, 0.45) * 0.28, 0, 1, 0.5),
      strength: scale01(item.strength, 0.5),
      source: item.source || "beliefMemory"
    }))
  ].filter(item => item.belief);
  const seen = new Set();
  return rows
    .filter(item => {
      const key = item.belief;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.activation - a.activation)
    .slice(0, 6)
    .map(item => ({
      ...item,
      belief: String(item.belief).slice(0, 160),
      activation: Number(clamp(item.activation, 0, 1, 0).toFixed(3)),
      strength: Number(clamp(item.strength, 0, 1, 0.5).toFixed(3))
    }));
}

function activeGoalsFromRuntime(goalRuntime = {}, context = {}) {
  const refs = [context.eventText || "", context.summary || "", context.plan?.title || "", context.interruption?.type || "", context.interruption?.reason || ""];
  return (goalRuntime.goals || []).slice(0, 8).map(goal => {
    const text = `${goal.name || ""} ${goal.title || ""} ${(goal.blockedBy || []).join(" ")}`;
    const priority = clamp(num(goal.priority, 0.5), 0, 1, 0.5);
    const frustration = clamp(num(goal.frustration, 0), 0, 1, 0);
    const progress = clamp(num(goal.progress, 0), 0, 1, 0);
    const relevance = tokenRelevance(text, refs);
    const activation = weightedInfluence([
      { value: priority, weight: 0.42 },
      { value: frustration, weight: 0.26 },
      { value: 1 - progress, weight: 0.16 },
      { value: relevance, weight: 0.2 }
    ]);
    return {
      id: goal.id || "",
      name: String(goal.name || goal.title || "").slice(0, 120),
      activation,
      priority: Number(priority.toFixed(3)),
      frustration: Number(frustration.toFixed(3)),
      progress: Number(progress.toFixed(3))
    };
  }).filter(goal => goal.name).sort((a, b) => b.activation - a.activation).slice(0, 5);
}

function pushDesire(list, id, desire, intensity, source, actionHints = []) {
  const value = clamp(intensity, 0, 1, 0);
  if (value < 0.08) return;
  list.push({
    id,
    desire,
    intensity: Number(value.toFixed(3)),
    source,
    actionHints: actionHints.slice(0, 4),
    rule: "Desire is not an action; settlement must still pass world constraints."
  });
}

function desireCandidatesFromState(state = {}, driveVector = {}, context = {}) {
  const desires = [];
  const causalBias = state.causalBias || {};
  pushDesire(desires, "keep_duty", "finish_or_continue_current_responsibility", state.responsibilityDrive * 0.75 + (context.plan ? 0.16 : 0) + num(causalBias.responsibilityBias, 0) * 0.1, "responsibilityDrive", ["follow_plan", "continue_process"]);
  pushDesire(desires, "recover_comfort", "return_to_a_more_comfortable_or_restful_state", state.comfortNeed * 0.78 + state.emotionalLoad * 0.12, "comfortNeed", ["rest", "return_home", "think_and_plan"]);
  pushDesire(desires, "reduce_risk", "avoid_or_check_current_risk", state.safetyConcern * 0.85 + num(causalBias.safetyBias, 0) * 0.1, "safetyConcern", ["seek_safety", "observe_environment", "return_home"]);
  pushDesire(desires, "seek_support", "contact_a_familiar_person_or_ask_for_help", state.socialNeed * 0.7 + state.safetyConcern * 0.12 + num(causalBias.socialBias, 0) * 0.12, "socialNeed", ["contact_familiar", "ask_guardian"]);
  pushDesire(desires, "observe_or_explore", "observe_the_environment_or_explore_carefully", state.curiosityDrive * 0.78, "curiosityDrive", ["observe_environment", "walk_nearby", "record_observation"]);
  pushDesire(desires, "eat", "find_a_reasonable_food_opportunity", clamp(num(driveVector.food, 0) / 1.1, 0, 1, 0), "body_attention", ["eat_or_buy_food"]);
  pushDesire(desires, "seek_care", "handle_body_or_health_concern", clamp(num(driveVector.care, 0) / 1.05, 0, 1, 0), "health_attention", ["seek_care", "rest"]);
  pushDesire(desires, "plan", "pause_and_adjust_next_step", state.selfPressure * 0.45 + state.emotionalLoad * 0.2, "selfPressure", ["think_and_plan", "observe_environment"]);
  return desires.sort((a, b) => b.intensity - a.intensity).slice(0, 8);
}

function thoughtCandidatesFromState(state = {}, activeMemories = [], activeBeliefs = [], activeCausalMemory = []) {
  const thoughts = [];
  const push = (trigger, thought, influence, intensity) => {
    const value = clamp(intensity, 0, 1, 0);
    if (value < 0.12) return;
    thoughts.push({ trigger, thought, influence, intensity: Number(value.toFixed(3)), factAuthority: false });
  };
  push("body_state", "body state pulls attention toward recovery", "comfortNeed", state.comfortNeed);
  push("responsibility", "current responsibility remains mentally active", "responsibilityDrive", state.responsibilityDrive);
  push("risk_signal", "possible risk narrows choices", "safetyConcern", state.safetyConcern);
  push("social_signal", "relationship needs become more noticeable", "socialNeed", state.socialNeed);
  push("curiosity", "unusual details become easier to notice", "curiosityDrive", state.curiosityDrive);
  const memory = activeMemories[0];
  if (memory) push("memory_activation", `similar memory activated: ${memory.text}`, `memoryActivation+${memory.activation}`, memory.activation);
  const belief = activeBeliefs[0];
  if (belief) push("belief_activation", `active belief: ${belief.belief}`, `beliefActivation+${belief.activation}`, belief.activation);
  const causal = activeCausalMemory[0];
  if (causal) push("causal_memory_activation", `causal memory activated: ${causal.causalRule}`, `causalBias+${causal.activation}`, causal.activation);
  return thoughts.sort((a, b) => b.intensity - a.intensity).slice(0, 8);
}

function appendThoughtStream(agent = {}, world = {}, thoughts = []) {
  if (!agent || !Array.isArray(thoughts) || !thoughts.length) return [];
  agent.thoughtStream = Array.isArray(agent.thoughtStream) ? agent.thoughtStream : [];
  const clock = num(world.clock, 0);
  const rows = thoughts.slice(0, 5).map(item => ({
    at: clock,
    timestamp: clock,
    trigger: item.trigger,
    thought: item.thought,
    influence: item.influence,
    intensity: item.intensity,
    factAuthority: false
  }));
  agent.thoughtStream.unshift(...rows);
  agent.thoughtStream = agent.thoughtStream.slice(0, 30);
  return rows;
}

function cognitiveState(world = {}, agent = {}, context = {}) {
  const needs = agent.needs || {};
  const emotions = agent.emotionVector || agent.emotions || {};
  const emotionCause = Array.isArray(agent.emotionCause) ? agent.emotionCause : [];
  const config = cognitiveEngineConfig(world);
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
  const needEmergencyFlag = agent.needEmergencyFlag || {
    health: num(needs.health, 80) < 20,
    hunger: num(needs.hunger, 75) < 10,
    safety: num(needs.safety, 82) < 20
  };
  const needDynamicsState = agent.needDynamicsState || null;

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
  if (needEmergencyFlag.hunger) add(driveVector, "food", 0.45);
  if (needEmergencyFlag.health) {
    add(driveVector, "care", 0.5);
    add(driveVector, "support", 0.2);
  }
  if (needEmergencyFlag.safety) {
    add(driveVector, "safety", 0.55);
    add(driveVector, "support", 0.18);
  }

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
  const personalityPressure = personalityPressureFromProfile(agent);
  applyPersonalityProjection(driveVector, biasVector, personalityPressure);

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

  const socialFieldInfluence = socialFieldInfluenceForAgent(world, agent);
  add(perceptionWeights, "socialField", socialFieldInfluence.socialField?.informationPressure || 0);
  add(perceptionWeights, "threat", socialFieldInfluence.safetyNeed * 0.42);
  add(perceptionWeights, "novelty", socialFieldInfluence.curiosity * 0.28);
  add(driveVector, "safety", socialFieldInfluence.safetyNeed * 0.38);
  add(driveVector, "observe", socialFieldInfluence.curiosity * 0.32);
  add(driveVector, "curiosity", socialFieldInfluence.curiosity * 0.22);
  add(driveVector, "comfort", socialFieldInfluence.comfortNeed * 0.26);
  add(biasVector, "avoidance", socialFieldInfluence.avoidance * 0.18);
  add(biasVector, "socialSeeking", socialFieldInfluence.socialActions * 0.16);
  biasVector.riskTolerance = Number(clamp(
    num(biasVector.riskTolerance, 0.5) - socialFieldInfluence.safetyNeed * 0.1 - socialFieldInfluence.avoidance * 0.08,
    0.02,
    0.98,
    0.5
  ).toFixed(3));
  actionModifiers.socialField = socialFieldInfluence.actionBias || {};

  const socialModifier = getSocialModifier(world, agent);
  const socialEffect = num(socialModifier.regulatedSocialEffect, 0);
  add(perceptionWeights, "socialFeedback", Math.abs(socialEffect));
  add(perceptionWeights, "threat", Math.max(0, socialModifier.fearModifier) * 0.32 + Math.max(0, socialModifier.avoidanceModifier) * 0.22);
  add(perceptionWeights, "novelty", Math.max(0, socialModifier.curiosityModifier) * 0.24);
  add(driveVector, "safety", Math.max(0, socialModifier.fearModifier) * 0.28 + Math.max(0, socialModifier.avoidanceModifier) * 0.18);
  add(driveVector, "observe", Math.max(0, socialModifier.curiosityModifier) * 0.24);
  add(driveVector, "curiosity", Math.max(0, socialModifier.curiosityModifier) * 0.2);
  add(driveVector, "support", Math.max(0, socialModifier.socialNeedModifier) * 0.2);
  add(driveVector, "social", socialModifier.socialNeedModifier * 0.16);
  add(driveVector, "duty", Math.max(0, socialModifier.responsibilityModifier) * 0.18);
  add(biasVector, "avoidance", Math.max(0, socialModifier.avoidanceModifier) * 0.24);
  add(biasVector, "socialSeeking", socialModifier.socialNeedModifier * 0.18);
  biasVector.riskTolerance = Number(clamp(
    num(biasVector.riskTolerance, 0.5) - Math.max(0, socialModifier.fearModifier) * 0.08 - Math.max(0, socialModifier.avoidanceModifier) * 0.1,
    0.02,
    0.98,
    0.5
  ).toFixed(3));
  actionModifiers.socialFeedback = socialModifier;

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

  const temporalCausal = config.enabled
    ? updateTemporalCausalMemory(world, agent, context)
    : { causalBias: { safetyBias: 0, socialBias: 0, responsibilityBias: 0, confidence: 0 }, activeCausalMemory: [] };
  const causalBias = temporalCausal.causalBias || { safetyBias: 0, socialBias: 0, responsibilityBias: 0, confidence: 0 };
  const activeCausalMemory = Array.isArray(temporalCausal.activeCausalMemory) ? temporalCausal.activeCausalMemory : [];
  const causalExpectationPressure = causalExpectationFromBias(causalBias, activeCausalMemory);
  add(perceptionWeights, "causalMemory", Math.max(num(causalBias.safetyBias, 0), num(causalBias.socialBias, 0), num(causalBias.responsibilityBias, 0)));
  add(driveVector, "safety", num(causalBias.safetyBias, 0) * 0.16);
  add(driveVector, "social", num(causalBias.socialBias, 0) * 0.18);
  add(driveVector, "support", num(causalBias.socialBias, 0) * 0.14);
  add(driveVector, "duty", num(causalBias.responsibilityBias, 0) * 0.16);
  add(driveVector, "order", num(causalBias.responsibilityBias, 0) * 0.08);
  add(driveVector, "safety", num(causalExpectationPressure.safetyExpectation, 0) * 0.12);
  add(driveVector, "social", num(causalExpectationPressure.socialExpectation, 0) * 0.12);
  add(driveVector, "duty", num(causalExpectationPressure.responsibilityExpectation, 0) * 0.12);
  add(driveVector, "observe", num(causalExpectationPressure.futureExpectationPressure, 0) * 0.1);
  add(driveVector, "safety", num(causalExpectationPressure.avoidancePressure, 0) * 0.14);
  add(driveVector, "social", num(causalExpectationPressure.approachPressure, 0) * 0.12);
  add(driveVector, "support", num(causalExpectationPressure.approachPressure, 0) * 0.1);
  add(driveVector, "curiosity", num(causalExpectationPressure.futureExpectationPressure, 0) * 0.08);
  add(biasVector, "socialSeeking", num(causalBias.socialBias, 0) * 0.12);
  add(biasVector, "avoidance", num(causalBias.safetyBias, 0) * 0.1 + num(causalExpectationPressure.avoidancePressure, 0) * 0.12);
  add(biasVector, "noveltySeeking", num(causalExpectationPressure.futureExpectationPressure, 0) * 0.06);
  biasVector.riskTolerance = Number(clamp(num(biasVector.riskTolerance, 0.5) - num(causalBias.safetyBias, 0) * 0.06, 0.02, 0.98, 0.5).toFixed(3));
  actionModifiers.causalMemory = causalBias;

  emotionCause.slice(0, 8).forEach(item => {
    const causeText = `${item.emotion || ""} ${(item.causes || []).join(" ")}`.toLowerCase();
    const intensity = scale01(item.intensity, 0.35);
    if (includesAny(causeText, ["health", "sick", "medical", "身体", "健康"])) add(driveVector, "care", intensity * 0.18);
    if (includesAny(causeText, ["promise", "work", "class", "study", "责任", "工作"])) add(driveVector, "duty", intensity * 0.16);
    if (includesAny(causeText, ["friend", "family", "help", "家人", "朋友"])) add(driveVector, "support", intensity * 0.16);
  });

  const activeMemories = config.enabled ? activateMemories(world, agent, context, driveVector, emotions, goalRuntime) : [];
  const activeBeliefs = config.enabled ? activeBeliefsFromMemories(agent, activeMemories) : [];
  const activeGoals = config.enabled ? activeGoalsFromRuntime(goalRuntime, context) : [];
  const runtimeContext = runtimeContextProjection(agent, context);
  const thoughtAction = runtimeContext.thoughtAction || reflectionActionCalibration(agent, context);
  add(driveVector, "order", -num(thoughtAction.reflectionSaturation, 0) * 0.18);
  add(driveVector, "home", -num(thoughtAction.antiThinkPressure, 0) * 0.1);
  add(driveVector, "goal", num(thoughtAction.thoughtCompletionPressure, 0) * 0.24);
  add(driveVector, "duty", num(thoughtAction.actionExecutionPressure, 0) * 0.2);
  add(driveVector, "curiosity", num(thoughtAction.antiThinkPressure, 0) * 0.2);
  add(driveVector, "observe", num(thoughtAction.actionExecutionPressure, 0) * 0.18);
  add(driveVector, "social", num(thoughtAction.antiThinkPressure, 0) * 0.16);
  add(driveVector, "support", num(thoughtAction.antiThinkPressure, 0) * 0.1);
  add(biasVector, "noveltySeeking", num(thoughtAction.antiThinkPressure, 0) * 0.1 + num(thoughtAction.actionExecutionPressure, 0) * 0.06);
  add(biasVector, "socialSeeking", num(thoughtAction.antiThinkPressure, 0) * 0.08);
  const beliefActivationRaw = activeBeliefs.length ? activeBeliefs.reduce((sum, item) => sum + item.activation, 0) / activeBeliefs.length : 0;
  const memoryActivation = activeMemories.length ? activeMemories.reduce((sum, item) => sum + item.activation, 0) / activeMemories.length : 0;
  const goalActivation = activeGoals.length ? activeGoals[0].activation : 0;
  const memoryInfluenceVector = buildMemoryInfluenceVector(memorySignals, activeMemories, memoryActivation);
  applyMemoryInfluenceProjection(driveVector, biasVector, memoryInfluenceVector);
  const attractorLandscape = buildAttractorLandscape(agent, driveVector, personalityPressure, memoryInfluenceVector, causalExpectationPressure, rel, thoughtAction);
  const attractorPull = applyAttractorLandscape(driveVector, biasVector, attractorLandscape);
  const personalityInfluence = weightedInfluence([
    { value: scale01(agent.cognitiveProfile?.ambition, 0.5), weight: 0.25 },
    { value: scale01(agent.cognitiveProfile?.routinePreference, 0.5), weight: 0.18 },
    { value: scale01(agent.cognitiveProfile?.empathy, 0.5), weight: 0.15 },
    { value: 1 - scale01(agent.cognitiveProfile?.conflictAvoidance, 0.5), weight: 0.12 }
  ]);
  const emotionLoad = weightedInfluence([
    { value: scale01(emotions.anxious, 0), weight: 0.25 },
    { value: scale01(emotions.angry, 0), weight: 0.18 },
    { value: scale01(emotions.sad, 0), weight: 0.18 },
    { value: scale01(emotions.tired, 0), weight: 0.2 },
    { value: scale01(emotions.lonely, 0), weight: 0.12 },
    { value: emotionCause.slice(0, 5).reduce((max, item) => Math.max(max, scale01(item.intensity, 0)), 0), weight: 0.18 }
  ]);
  const cognitiveScalars = {
    selfPressure: weightedInfluence([
      { value: stressLow, weight: 0.22 },
      { value: responsibilityLow, weight: 0.2 },
      { value: goalActivation, weight: config.goalInfluence },
      { value: beliefActivationRaw, weight: config.beliefInfluence * 0.35 },
      { value: emotionLoad, weight: config.emotionInfluence * 0.25 },
      { value: personalityInfluence, weight: config.personalityInfluence * 0.2 },
      { value: Math.abs(socialEffect), weight: 0.12 },
      { value: Math.max(num(causalBias.safetyBias, 0), num(causalBias.responsibilityBias, 0)), weight: 0.08 }
    ]),
    socialNeed: weightedInfluence([
      { value: socialLow, weight: 0.35 },
      { value: scale01(emotions.lonely, 0), weight: config.emotionInfluence * 0.28 },
      { value: clamp(num(driveVector.social, 0) / 1.5, 0, 1, 0), weight: 0.22 },
      { value: clamp(rel.count ? rel.intimacy / 100 : 0, 0, 1, 0), weight: config.beliefInfluence * 0.14 },
      { value: clamp((socialModifier.socialNeedModifier + 1) / 2, 0, 1, 0.5), weight: 0.12 },
      { value: num(causalBias.socialBias, 0), weight: 0.12 }
    ]),
    safetyConcern: weightedInfluence([
      { value: safetyLow, weight: 0.35 },
      { value: healthLow, weight: 0.18 },
      { value: clamp(num(perceptionWeights.threat, 0) / 1.5, 0, 1, 0), weight: 0.22 },
      { value: 1 - clamp(num(biasVector.riskTolerance, 0.5), 0, 1, 0.5), weight: config.personalityInfluence * 0.24 },
      { value: scale01(emotions.anxious, 0), weight: config.emotionInfluence * 0.16 },
      { value: clamp(Math.max(0, socialModifier.fearModifier) * 0.62 + Math.max(0, socialModifier.avoidanceModifier) * 0.38, 0, 1, 0), weight: 0.14 },
      { value: num(causalBias.safetyBias, 0), weight: 0.12 }
    ]),
    curiosityDrive: weightedInfluence([
      { value: clamp(num(driveVector.curiosity, 0) / 1.4, 0, 1, 0), weight: 0.32 },
      { value: clamp(num(driveVector.observe, 0) / 1.4, 0, 1, 0), weight: 0.22 },
      { value: scale01(agent.cognitiveProfile?.curiosity, 0.5), weight: config.personalityInfluence * 0.22 },
      { value: scale01(emotions.curious, 0), weight: config.emotionInfluence * 0.16 },
      { value: clamp(num(perceptionWeights.novelty, 0), 0, 1, 0), weight: 0.18 },
      { value: clamp((socialModifier.curiosityModifier + 1) / 2, 0, 1, 0.5), weight: 0.12 }
    ]),
    responsibilityDrive: weightedInfluence([
      { value: responsibilityLow, weight: 0.25 },
      { value: clamp(num(driveVector.duty, 0) / 1.5, 0, 1, 0), weight: 0.25 },
      { value: goalActivation, weight: config.goalInfluence * 0.28 },
      { value: clamp(num(biasVector.goalPersistence, 0.5), 0, 1, 0.5), weight: config.personalityInfluence * 0.22 },
      { value: beliefActivationRaw, weight: config.beliefInfluence * 0.18 },
      { value: clamp((socialModifier.responsibilityModifier + 1) / 2, 0, 1, 0.5), weight: 0.1 },
      { value: num(causalBias.responsibilityBias, 0), weight: 0.12 }
    ]),
    comfortNeed: weightedInfluence([
      { value: comfortLow, weight: 0.28 },
      { value: hungerLow, weight: 0.16 },
      { value: hygieneLow, weight: 0.12 },
      { value: healthLow, weight: 0.16 },
      { value: clamp(num(driveVector.comfort, 0) / 1.5, 0, 1, 0), weight: 0.22 },
      { value: scale01(emotions.tired, 0), weight: config.emotionInfluence * 0.2 },
      { value: memoryActivation, weight: config.memoryInfluence * 0.14 }
    ]),
    emotionalLoad: emotionLoad,
    beliefActivation: Number(clamp(beliefActivationRaw, 0, 1, 0).toFixed(3)),
    causalBias
  };
  const desireCandidates = config.enabled ? desireCandidatesFromState(cognitiveScalars, driveVector, context) : [];
  const thoughtCandidates = config.enabled ? thoughtCandidatesFromState(cognitiveScalars, activeMemories, activeBeliefs, activeCausalMemory) : [];
  const thoughtStream = appendThoughtStream(agent, world, thoughtCandidates);

  const result = {
    agentId: agent.id || "",
    timestamp: num(world.clock, 0),
    version: "3.2",
    stabilityLayerVersion: "3.4.2.3",
    causalLayerVersion: "3.3.7",
    enabled: config.enabled,
    decisionWeights,
    influenceWeights: config,
    ...cognitiveScalars,
    activeGoals,
    activeMemories,
    activeCausalMemory,
    activeBeliefs,
    desireCandidates,
    thoughtCandidates,
    thoughtStream,
    perceptionWeights,
    driveVector,
    biasVector,
    runtimeContext,
    actionModifiers,
    needDynamicsState,
    needEmergencyFlag,
    socialFieldInfluence,
    socialModifier,
    temporalCausal,
    personalityPressure,
    memoryInfluenceVector,
    causalExpectationPressure,
    attractorLandscape,
    attractorPull,
    memoryEvidence: memorySignals.evidence,
    relationshipSignals: rel,
    cognitiveProfile: profileSignals,
    source: "cognitive-state-v3"
  };
  result.psychologicalState = stabilizePsychologicalState(world, agent, result);
  agent.cognitiveState = result;
  agent.desireCandidates = desireCandidates;
  agent.activeBeliefs = activeBeliefs;
  agent.activeCausalMemory = activeCausalMemory;
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
  record_observation: { observe: 0.9, novelty: 0.58, curiosity: 0.62, comfort: 0.12, risk: 0.18, cost: 0.12, time: 0.22 },
  provide_care: { care: 0.82, support: 0.48, duty: 0.7, social: 0.22, risk: 0.22, cost: 0.24, time: 0.38, availability: 0.75 },
  serve_customers: { duty: 0.76, social: 0.48, order: 0.36, comfort: 0.12, risk: 0.12, cost: 0.18, time: 0.42, availability: 0.72 },
  check_inventory: { duty: 0.58, order: 0.74, comfort: 0.18, risk: 0.06, cost: 0.16, time: 0.28, availability: 0.75 }
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

function psychologicalStateConfig(world = {}) {
  const cfg = world.config?.psychologicalState || world.psychologicalState || {};
  const alpha = clamp(cfg.alpha ?? world.config?.psychologicalStateAlpha, 0.7, 0.95, 0.85);
  const byDimension = cfg.alphaByDimension || cfg.dimensionAlpha || {};
  return {
    enabled: cfg.enabled !== false,
    alpha,
    alphaByDimension: {
      identity: clamp(byDimension.identity ?? cfg.identityAlpha, 0.98, 0.995, 0.99),
      habit: clamp(byDimension.habit ?? cfg.habitAlpha, 0.9, 0.97, 0.94),
      emotion: clamp(byDimension.emotion ?? cfg.emotionAlpha, 0.7, 0.9, 0.82),
      need: clamp(byDimension.need ?? cfg.needAlpha, 0.8, 0.95, 0.88),
      social: clamp(byDimension.social ?? cfg.socialAlpha, 0.85, 0.95, 0.9),
      drive: clamp(byDimension.drive ?? cfg.driveAlpha, 0.8, 0.95, 0.86),
      bias: clamp(byDimension.bias ?? cfg.biasAlpha, 0.85, 0.97, 0.92),
      projection: clamp(byDimension.projection ?? cfg.projectionAlpha, 0.78, 0.95, 0.86),
      memory: clamp(byDimension.memory ?? cfg.memoryAlpha, 0.82, 0.95, 0.88),
      causal: clamp(byDimension.causal ?? cfg.causalAlpha, 0.85, 0.95, 0.9)
    }
  };
}

function buildPsychologicalInput(cognitive = {}, agent = {}, socialPressure = {}) {
  const runtimeContext = cognitive.runtimeContext || runtimeContextProjection(agent, {});
  const personalityPressure = cognitive.personalityPressure || personalityPressureFromProfile(agent);
  const memoryInfluenceVector = cognitive.memoryInfluenceVector || {};
  const causalExpectationPressure = cognitive.causalExpectationPressure || causalExpectationFromBias(cognitive.causalBias || {}, cognitive.activeCausalMemory || []);
  const attractorLandscape = cognitive.attractorLandscape || null;
  return {
    agentId: agent.id || "",
    emotionVector: Object.fromEntries(Object.entries(agent.emotionVector || agent.emotions || {})
      .map(([key, value]) => [key, Number(scale01(value, 0).toFixed(4))])),
    needsVector: Object.fromEntries(Object.entries(agent.needs || {})
      .map(([key, value]) => [key, Number(clamp((100 - num(value, 70)) / 100, 0, 1, 0).toFixed(4))])),
    driveVector: { ...(cognitive.driveVector || {}) },
    biasVector: { ...(cognitive.biasVector || {}) },
    socialPressure: {
      fear: scale01(socialPressure.fearLevel, 0),
      curiosity: scale01(socialPressure.curiosityLevel, 0),
      rumor: scale01(socialPressure.rumorDensity, 0),
      tension: scale01(socialPressure.socialTension, 0),
      information: scale01(socialPressure.informationPressure, 0)
    },
    projection: {
      selfPressure: scale01(cognitive.selfPressure, 0),
      socialNeed: scale01(cognitive.socialNeed, 0),
      goalPressure: scale01(cognitive.responsibilityDrive, 0),
      emotionalLoad: scale01(cognitive.emotionalLoad, 0),
      beliefActivation: scale01(cognitive.beliefActivation, 0),
      memoryActivation: Array.isArray(cognitive.activeMemories) && cognitive.activeMemories.length
        ? cognitive.activeMemories.reduce((sum, item) => sum + scale01(item.activation, 0), 0) / cognitive.activeMemories.length
        : 0,
      causal: {
        safetyBias: scale01(cognitive.causalBias?.safetyBias, 0),
        socialBias: scale01(cognitive.causalBias?.socialBias, 0),
        responsibilityBias: scale01(cognitive.causalBias?.responsibilityBias, 0)
      },
      personalityPressure,
      memoryInfluenceVector,
      causalExpectationPressure,
      attractorLandscape,
      runtimeContext,
      taskState: runtimeContext.taskState || {},
      thoughtAction: runtimeContext.thoughtAction || {},
      behavioralEntropy: runtimeContext.behavioralEntropy || { repeatRate: 0, unique: 0, total: 0 },
      explorationPressure: runtimeContext.explorationPressure || {},
      perceptionWeights: { ...(cognitive.perceptionWeights || {}) }
    }
  };
}

function psychologicalStateVector(state = {}) {
  return {
    ...state.emotionVector,
    ...Object.fromEntries(Object.entries(state.needsVector || {}).map(([key, value]) => [`need:${key}`, value])),
    ...Object.fromEntries(Object.entries(state.driveVector || {}).map(([key, value]) => [`drive:${key}`, value])),
    ...Object.fromEntries(Object.entries(state.biasVector || {}).map(([key, value]) => [`bias:${key}`, value])),
    ...Object.fromEntries(Object.entries(state.socialPressure || {}).map(([key, value]) => [`social:${key}`, value])),
    ...Object.fromEntries(Object.entries(state.projection?.personalityPressure || {}).map(([key, value]) => [`personality:${key}`, value])),
    ...Object.fromEntries(Object.entries(state.projection?.memoryInfluenceVector || {}).map(([key, value]) => [`memory:${key}`, value])),
    ...Object.fromEntries(Object.entries(state.projection?.causalExpectationPressure || {}).map(([key, value]) => [`causalExpectation:${key}`, value])),
    ...Object.fromEntries(Object.entries(state.projection?.attractorLandscape?.distribution || {}).map(([key, value]) => [`attractor:${key}`, value])),
    ...Object.fromEntries(Object.entries(state.projection?.attractorLandscape?.energies || {}).map(([key, value]) => [`attractorEnergy:${key}`, value])),
    ...Object.fromEntries(Object.keys(attractorCenters).map(key => [`dominantAttractor:${key}`, state.projection?.attractorLandscape?.dominantAttractor === key ? 1 : 0])),
    "projection:selfPressure": num(state.projection?.selfPressure, 0),
    "projection:socialNeed": num(state.projection?.socialNeed, 0),
    "projection:goalPressure": num(state.projection?.goalPressure, 0),
    "projection:emotionalLoad": num(state.projection?.emotionalLoad, 0),
    "projection:memoryActivation": num(state.projection?.memoryActivation, 0),
    "thought:reflectionSaturation": num(state.projection?.thoughtAction?.reflectionSaturation, 0),
    "thought:completionPressure": num(state.projection?.thoughtAction?.thoughtCompletionPressure, 0),
    "thought:actionExecutionPressure": num(state.projection?.thoughtAction?.actionExecutionPressure, 0),
    "attractor:flattened": num(state.projection?.attractorLandscape?.flattened, 0),
    "attractor:reflectionSaturation": num(state.projection?.attractorLandscape?.reflectionSaturation, 0),
    "attractor:actionExecutionPressure": num(state.projection?.attractorLandscape?.actionExecutionPressure, 0),
    "attractor:memoryCoupling": num(state.projection?.attractorLandscape?.memoryCoupling, 0),
    "transition:emotion": num(state.projection?.transitionPressure?.emotion, 0),
    "transition:need": num(state.projection?.transitionPressure?.need, 0),
    "transition:drive": num(state.projection?.transitionPressure?.drive, 0),
    "transition:memory": num(state.projection?.transitionPressure?.memory, 0),
    "transition:total": num(state.projection?.transitionPressure?.total, 0)
  };
}

function stabilizePsychologicalState(world = {}, agent = {}, cognitive = {}) {
  const config = psychologicalStateConfig(world);
  const input = buildPsychologicalInput(cognitive, agent, world.socialField || {});
  const previous = agent.psychologicalState || null;
  const alpha = config.alpha;
  const alphaByDimension = config.alphaByDimension || {};
  const transitionInput = previous ? {
    emotion: clamp(meanAbsDiff(previous.emotionVector, input.emotionVector) * 20, 0, 1, 0),
    need: clamp(meanAbsDiff(previous.needsVector, input.needsVector) * 20, 0, 1, 0),
    drive: clamp(meanAbsDiff(previous.driveVector, input.driveVector) * 16, 0, 1, 0),
    bias: clamp(meanAbsDiff(previous.biasVector, input.biasVector) * 20, 0, 1, 0),
    social: clamp(meanAbsDiff(previous.socialPressure, input.socialPressure) * 20, 0, 1, 0),
    memory: clamp(meanAbsDiff(previous.projection?.memoryInfluenceVector, input.projection.memoryInfluenceVector) * 16, 0, 1, 0),
    causal: clamp(meanAbsDiff(previous.projection?.causalExpectationPressure, input.projection.causalExpectationPressure) * 16, 0, 1, 0),
    attractor: clamp(meanAbsDiff(previous.projection?.attractorLandscape?.distribution, input.projection.attractorLandscape?.distribution) * 12, 0, 1, 0)
  } : { emotion: 0, need: 0, drive: 0, bias: 0, social: 0, memory: 0, causal: 0, attractor: 0 };
  transitionInput.total = clamp(
    transitionInput.emotion * 0.22
      + transitionInput.need * 0.2
      + transitionInput.drive * 0.22
      + transitionInput.bias * 0.1
      + transitionInput.social * 0.12
      + transitionInput.memory * 0.09
      + transitionInput.causal * 0.04
      + transitionInput.attractor * 0.01,
    0,
    1,
    0
  );
  const state = previous && config.enabled ? {
    emotionVector: blendVector(previous.emotionVector, input.emotionVector, alphaByDimension.emotion ?? alpha),
    needsVector: blendVector(previous.needsVector, input.needsVector, alphaByDimension.need ?? alpha),
    driveVector: blendVector(previous.driveVector, input.driveVector, alphaByDimension.drive ?? alpha),
    biasVector: blendVector(previous.biasVector, input.biasVector, alphaByDimension.bias ?? alpha),
    socialPressure: blendVector(previous.socialPressure, input.socialPressure, alphaByDimension.social ?? alpha)
    ,
    projection: {
      ...input.projection,
      selfPressure: blendNumber(previous.projection?.selfPressure, input.projection.selfPressure, alphaByDimension.projection ?? alpha),
      socialNeed: blendNumber(previous.projection?.socialNeed, input.projection.socialNeed, alphaByDimension.social ?? alpha),
      goalPressure: blendNumber(previous.projection?.goalPressure, input.projection.goalPressure, alphaByDimension.projection ?? alpha),
      emotionalLoad: blendNumber(previous.projection?.emotionalLoad, input.projection.emotionalLoad, alphaByDimension.emotion ?? alpha),
      beliefActivation: blendNumber(previous.projection?.beliefActivation, input.projection.beliefActivation, alphaByDimension.memory ?? alpha),
      memoryActivation: blendNumber(previous.projection?.memoryActivation, input.projection.memoryActivation, alphaByDimension.memory ?? alpha),
      causal: blendVector(previous.projection?.causal, input.projection.causal, alphaByDimension.causal ?? alpha),
      personalityPressure: blendVector(previous.projection?.personalityPressure, input.projection.personalityPressure, alphaByDimension.identity ?? alpha),
      memoryInfluenceVector: blendVector(previous.projection?.memoryInfluenceVector, input.projection.memoryInfluenceVector, alphaByDimension.memory ?? alpha),
      causalExpectationPressure: blendVector(previous.projection?.causalExpectationPressure, input.projection.causalExpectationPressure, alphaByDimension.causal ?? alpha),
      attractorLandscape: blendAttractorLandscape(previous.projection?.attractorLandscape, input.projection.attractorLandscape, alphaByDimension.drive ?? alpha),
      transitionPressure: blendVector(previous.projection?.transitionPressure, transitionInput, 0.35),
      runtimeContext: input.projection.runtimeContext,
      taskState: input.projection.taskState,
      thoughtAction: input.projection.thoughtAction,
      behavioralEntropy: input.projection.behavioralEntropy,
      explorationPressure: input.projection.explorationPressure,
      perceptionWeights: blendVector(previous.projection?.perceptionWeights, input.projection.perceptionWeights, alphaByDimension.projection ?? alpha)
    }
  } : {
    ...input,
    projection: {
      ...input.projection,
      transitionPressure: transitionInput
    }
  };
  const result = {
    agentId: agent.id || "",
    version: "3.4.2.3",
    timestamp: num(world.clock, 0),
    alpha,
    alphaByDimension,
    enabled: config.enabled,
    ...state,
    vector: psychologicalStateVector(state),
    source: "unified-psychological-state"
  };
  agent.previousPsychologicalState = previous;
  agent.psychologicalState = result;
  return result;
}

module.exports = {
  ensureDecisionWeights,
  defaultDecisionWeights,
  cognitiveEngineConfig,
  weightedInfluence,
  activateMemories,
  activeBeliefsFromMemories,
  desireCandidatesFromState,
  runtimeContextProjection,
  cognitiveState,
  stabilizePsychologicalState,
  psychologicalStateVector,
  actionVector,
  actionMatch,
  realityConstraint,
  cognitiveTemperature,
  dotProduct
};

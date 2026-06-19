"use strict";

const {
  buildMemorySummary,
  ensureMemory,
  ensureSelfModel,
  normalizeGoalRuntime,
  syncLongTermMemoryViews
} = require("./ai-town-memory-stream");
const { cognitiveWrite } = require("./ai-town-cognitive-integrity");

function num(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max, fallback = min) {
  const number = num(value, fallback);
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
    const text = compactString(value, "", 140);
    if (!text || seen.has(text)) return;
    seen.add(text);
    output.push(text);
  });
  return output.slice(0, limit);
}

function narrativeThemeHash(theme = "") {
  return String(theme || "stable")
    .toLowerCase()
    .replace(/[^a-z0-9_\-\u4e00-\u9fa5]+/g, "_")
    .slice(0, 80) || "stable";
}

function narrativeThemeUpdate(selfModel = {}, theme = "", clock = 0) {
  const hash = narrativeThemeHash(theme);
  const state = selfModel.narrativeHash && typeof selfModel.narrativeHash === "object"
    ? selfModel.narrativeHash
    : {};
  const lastAt = num(state[hash]?.lastAt, -Infinity);
  const repeatWindow = 30 * 1440;
  if (Number.isFinite(lastAt) && clock - lastAt < repeatWindow) {
    return {
      shouldAppend: false,
      narrativeHash: {
        ...state,
        [hash]: {
          hash,
          lastAt: clock,
          count: num(state[hash]?.count, 1) + 1,
          strength: clamp(num(state[hash]?.strength, 0.2) + 0.03, 0, 1, 0.2)
        }
      }
    };
  }
  return {
    shouldAppend: true,
    narrativeHash: {
      ...state,
      [hash]: {
        hash,
        lastAt: clock,
        count: num(state[hash]?.count, 0) + 1,
        strength: clamp(num(state[hash]?.strength, 0.2) + 0.05, 0, 1, 0.2)
      }
    }
  };
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
  const source = String(text || "").toLowerCase();
  return words.some(word => source.includes(String(word).toLowerCase()));
}

function learningRateForAgent(agent = {}) {
  const age = num(agent.ageYears ?? agent.age, 35);
  const stage = String(agent.ageStage || "").toLowerCase();
  if (age <= 12 || includesAny(stage, ["child", "儿童", "小学生"])) return 0.05;
  if ((age > 12 && age <= 18) || includesAny(stage, ["teen", "青少年", "中学生"])) return 0.03;
  if (age >= 65 || includesAny(stage, ["elder", "老人", "老年", "退休"])) return 0.005;
  return 0.01;
}

function eventImportance(event = {}) {
  const gated = event.memoryGate || {};
  if (Number.isFinite(Number(gated.importance))) return clamp(gated.importance, 0, 1, 0);
  const abnormality = clamp(event.abnormality, 0, 100, event.category === "routine" ? 4 : 25) / 100;
  const emotion = clamp(event.emotionalIntensity, 0, 100, event.category === "routine" ? 5 : 20) / 100;
  const future = clamp(event.futureImpact, 0, 100, event.category === "routine" ? 12 : 25) / 100;
  return clamp(abnormality * 0.35 + emotion * 0.25 + future * 0.4, 0, 1, 0.2);
}

function eventText(event = {}) {
  return `${event.summary || ""} ${event.type || ""} ${event.actionType || ""} ${event.planTitle || ""} ${event.localAction || ""} ${event.interruption?.type || ""} ${event.interruption?.reason || ""}`.toLowerCase();
}

function classifyEvent(event = {}) {
  const text = eventText(event);
  const types = new Set();
  if (event.category === "routine" && eventImportance(event) < 0.5) return ["routine"];
  if (includesAny(text, ["health", "clinic", "doctor", "medical", "sick", "身体", "健康", "诊所", "医生", "不适", "生病"])) types.add("health");
  if (includesAny(text, ["safety", "risk", "danger", "unsafe", "stranger", "安全", "风险", "危险", "陌生", "避险"])) types.add("safety");
  if (includesAny(text, ["fail", "failed", "unable", "missed", "blocked", "frustrat", "problem", "失败", "没能", "错过", "受阻", "拖延", "困难"])) types.add("failure");
  if (includesAny(text, ["success", "completed", "finished", "resolved", "progress", "solved", "完成", "解决", "成功", "推进", "兑现", "做到"])) types.add("success");
  if (includesAny(text, ["help", "helped", "care", "support", "neighbor", "friend", "family", "帮助", "照顾", "支持", "邻居", "朋友", "家人", "求助"])) types.add("helped");
  if (includesAny(text, ["conflict", "argument", "fight", "misunderstand", "betray", "冲突", "争吵", "误会", "背叛", "摩擦"])) types.add("conflict");
  if (includesAny(text, ["lonely", "alone", "isolated", "孤独", "独处", "没人", "冷清"])) types.add("lonely");
  if (includesAny(text, ["quiet", "calm", "rest", "recover", "安静", "冷静", "休息", "恢复"])) types.add("quiet");
  if (!types.size && eventImportance(event) >= 0.65) types.add("experience");
  return [...types];
}

function collectRecentEvents(world = {}, agent = {}, options = {}) {
  if (Array.isArray(options.recentEvents)) return options.recentEvents;
  const clock = num(world.clock, 0);
  const sinceClock = Number.isFinite(Number(options.sinceClock))
    ? Number(options.sinceClock)
    : Math.max(0, clock - 1440);
  const events = [
    ...(Array.isArray(agent.eventLog) ? agent.eventLog : []),
    ...(Array.isArray(world.eventLog) ? world.eventLog.filter(event => event.agentId === agent.id) : [])
  ];
  const seen = new Set();
  return events
    .filter(event => event && !seen.has(event.id) && seen.add(event.id))
    .filter(event => num(event.clock, clock) >= sinceClock && num(event.clock, clock) <= clock)
    .filter(event => event.category !== "routine" || eventImportance(event) >= 0.5 || event.memoryGate?.memoryType === "habit")
    .sort((a, b) => num(a.clock, 0) - num(b.clock, 0))
    .slice(-80);
}

function buildSignals(world = {}, agent = {}, recentEvents = []) {
  const signals = {};
  const add = (type, event, base = 0.5) => {
    const importance = eventImportance(event);
    const id = event.id || `${type}_${event.clock || world.clock || 0}`;
    signals[type] ||= { type, count: 0, impact: 0, sourceEvents: [], examples: [] };
    const signal = signals[type];
    signal.count += 1;
    signal.impact += Math.max(base, importance);
    if (!signal.sourceEvents.includes(id)) signal.sourceEvents.push(id);
    if (signal.examples.length < 3) signal.examples.push(compactString(event.summary || event.type || type, "", 140));
  };
  recentEvents.forEach(event => {
    classifyEvent(event).forEach(type => {
      if (type === "routine") return;
      add(type, event, type === "experience" ? 0.55 : 0.45);
    });
  });
  const lonely = clamp(num(agent.emotionVector?.lonely ?? agent.emotions?.lonely, 0), 0, 100, 0);
  const socialNeed = clamp(100 - num(agent.needs?.social, 75), 0, 100, 0);
  if (lonely >= 65 || socialNeed >= 55) {
    signals.lonely ||= { type: "lonely", count: 0, impact: 0, sourceEvents: [], examples: [] };
    signals.lonely.count += 1;
    signals.lonely.impact += Math.max(lonely, socialNeed) / 100;
    signals.lonely.examples.push("近期孤独或社交不足");
  }
  Object.values(signals).forEach(signal => {
    const repeatFactor = 1 + Math.min(0.75, Math.max(0, signal.count - 1) * 0.12);
    signal.impact = Number(clamp((signal.impact / Math.max(1, signal.count)) * repeatFactor, 0, 1, 0).toFixed(3));
    signal.sourceEvents = signal.sourceEvents.slice(0, 8);
  });
  return signals;
}

function ensureEvolutionSelfModel(agent = {}) {
  return ensureSelfModel(agent);
  void compactString(
    selfModel.selfImage || selfModel.currentSelfView || selfModel.identity,
    selfModel.identity || "自我理解保持稳定",
    180
  );
  void compactString(
    selfModel.lifeNarrative || agent.selfNarrative || selfModel.currentSelfView || selfModel.identity,
    selfModel.currentSelfView || "生活经历还在慢慢积累",
    260
  );
}

function appendIdentityMemory(agent, type, payload = {}, world = {}) {
  const text = compactString(payload.text || payload.meaning || payload.belief || payload.habit || payload.preference, "", 220);
  if (!text) return null;
  const at = num(world.clock, 0);
  const memory = {
    semantic: true,
    type,
    text,
    meaning: compactString(payload.meaning || text, text, 240),
    at,
    importance: clamp(Math.ceil(clamp(payload.impact, 0, 1, 0.55) * 5), 2, 5, 3),
    strength: clamp(payload.strength, 0, 100, 48),
    confidence: clamp(payload.confidence, 0, 1, 0.55),
    sourceEvents: Array.isArray(payload.sourceEvents) ? payload.sourceEvents.slice(0, 8) : [],
    evidenceIds: Array.isArray(payload.sourceEvents) ? payload.sourceEvents.slice(0, 8) : [],
    createdAt: at,
    lastConfirmed: at,
    trigger: payload.trigger || "",
    action: payload.action || "",
    probability: payload.probability,
    preference: payload.preference || "",
    valence: clamp(payload.valence, -100, 100, 0),
    source: "identity-evolution",
    tags: uniqueStrings([payload.tags || [], "identity-evolution", type], 8),
    dedupeKey: payload.dedupeKey || `identity:${agent.id}:${type}:${text}`
  };
  const result = cognitiveWrite({
    world,
    agent,
    agentId: agent.id,
    source: "identity-evolution",
    target: "memory",
    payload: memory,
    confidence: memory.confidence,
    reason: "identity evolution memory write",
    timestamp: at
  });
  return result.ok ? result.applied : null;
}

function driftTrait(target = {}, key, direction, impact, rate, changes) {
  const oldValue = clamp(target[key], 0, 1, 0.5);
  const delta = direction * impact * rate;
  const newValue = Number(clamp(oldValue + delta, 0, 1, oldValue).toFixed(4));
  target[key] = newValue;
  if (Math.abs(newValue - oldValue) >= 0.0005) {
    changes[key] = {
      old: Number(oldValue.toFixed(4)),
      new: newValue,
      delta: Number((newValue - oldValue).toFixed(4))
    };
  }
}

function applySignal(world = {}, agent = {}, signal = {}, context = {}) {
  const name = agent.name || "这个人";
  const impact = clamp(signal.impact, 0, 1, 0);
  const rate = context.learningRate;
  const beliefUpdates = [];
  const habitUpdates = [];
  const preferenceUpdates = [];
  const selfBeliefs = [];
  const competenceBeliefs = [];
  const fears = [];
  const personalityDrift = { cognitiveProfile: {}, behaviorTendency: {} };
  const sourceEvents = signal.sourceEvents || [];
  const strength = clamp(38 + impact * 42, 35, 86, 55);
  const confidence = clamp(0.35 + impact * 0.45 + Math.min(0.12, signal.count * 0.03), 0, 0.9, 0.5);

  agent.cognitiveProfile ||= {};
  agent.behaviorTendency ||= {};

  const addBelief = (belief, tags = []) => {
    const item = appendIdentityMemory(agent, "belief", {
      text: belief,
      meaning: belief,
      impact,
      strength,
      confidence,
      sourceEvents,
      valence: tags.includes("negative") ? -25 : 20,
      tags,
      dedupeKey: `identity:${agent.id}:belief:${tags[0] || signal.type}`
    }, world);
    if (item) beliefUpdates.push({
      id: item.id,
      belief,
      strength: Number((strength / 100).toFixed(3)),
      confidence: Number(confidence.toFixed(3)),
      sourceEvents
    });
  };
  const addHabit = (trigger, action, text, tags = []) => {
    const probability = clamp(0.25 + impact * 0.45 + Math.min(0.12, signal.count * 0.03), 0.2, 0.85, 0.4);
    const item = appendIdentityMemory(agent, "habit", {
      text,
      meaning: text,
      trigger,
      action,
      probability,
      impact,
      strength: clamp(probability * 100, 20, 90, 45),
      confidence,
      sourceEvents,
      tags,
      dedupeKey: `identity:${agent.id}:habit:${tags[0] || trigger || signal.type}`
    }, world);
    if (item) habitUpdates.push({
      id: item.id,
      trigger,
      action,
      probability: Number(probability.toFixed(3)),
      sourceEvents
    });
  };
  const addPreference = (preference, tags = [], valence = 15) => {
    const item = appendIdentityMemory(agent, "preference", {
      text: preference,
      meaning: preference,
      preference,
      impact,
      strength,
      confidence,
      sourceEvents,
      valence,
      tags,
      dedupeKey: `identity:${agent.id}:preference:${tags[0] || signal.type}`
    }, world);
    if (item) preferenceUpdates.push({
      id: item.id,
      preference,
      strength: Number((strength / 100).toFixed(3)),
      sourceEvents
    });
  };

  if (signal.type === "failure") {
    addBelief(`${name}逐渐相信：遇到连续受挫时，需要先降低风险再继续推进。`, ["failure", "caution", "negative"]);
    addHabit("连续受挫或事情受阻", "先停下来重新评估风险和步骤", `${name}在受挫后更倾向先评估风险，再继续行动。`, ["failure", "caution"]);
    fears.push("担心重复失败影响稳定生活");
    selfBeliefs.push("受挫时应该先稳住局面");
    driftTrait(agent.cognitiveProfile, "riskTolerance", -1, impact, rate, personalityDrift.cognitiveProfile);
    driftTrait(agent.cognitiveProfile, "conflictAvoidance", 1, impact * 0.7, rate, personalityDrift.cognitiveProfile);
    driftTrait(agent.behaviorTendency, "takeRisk", -1, impact, rate, personalityDrift.behaviorTendency);
    driftTrait(agent.behaviorTendency, "selfReflect", 1, impact * 0.8, rate, personalityDrift.behaviorTendency);
  } else if (signal.type === "success") {
    addBelief(`${name}逐渐相信：把问题拆开处理，事情是可以推进的。`, ["success", "competence"]);
    addHabit("遇到复杂问题", "先尝试拆分并推进一个小步骤", `${name}在顺利推进后更愿意把复杂事情拆成小步骤处理。`, ["success", "problem-solving"]);
    competenceBeliefs.push("我可以把困难拆开处理");
    selfBeliefs.push("持续尝试会带来进展");
    driftTrait(agent.cognitiveProfile, "ambition", 1, impact * 0.7, rate, personalityDrift.cognitiveProfile);
    driftTrait(agent.cognitiveProfile, "patience", 1, impact * 0.5, rate, personalityDrift.cognitiveProfile);
    driftTrait(agent.cognitiveProfile, "riskTolerance", 1, impact * 0.35, rate, personalityDrift.cognitiveProfile);
    driftTrait(agent.behaviorTendency, "persistOnGoal", 1, impact, rate, personalityDrift.behaviorTendency);
  } else if (signal.type === "helped") {
    addBelief(`${name}逐渐相信：可信的人在困难时可以依靠。`, ["helped", "trust"]);
    addHabit("遇到自己难以处理的困难", "优先向熟悉且可信的人求助", `${name}遇到困难时更愿意向熟悉且可信的人求助。`, ["helped", "support"]);
    addPreference("更愿意和曾提供帮助的人保持联系", ["helped", "social"], 25);
    selfBeliefs.push("求助不是软弱，而是解决问题的一部分");
    driftTrait(agent.cognitiveProfile, "empathy", 1, impact * 0.7, rate, personalityDrift.cognitiveProfile);
    driftTrait(agent.cognitiveProfile, "socialDrive", 1, impact * 0.55, rate, personalityDrift.cognitiveProfile);
    driftTrait(agent.behaviorTendency, "seekHelp", 1, impact, rate, personalityDrift.behaviorTendency);
    driftTrait(agent.behaviorTendency, "careForOthers", 1, impact * 0.7, rate, personalityDrift.behaviorTendency);
  } else if (signal.type === "lonely") {
    addBelief(`${name}逐渐意识到：长期缺少稳定联系会影响自己的状态。`, ["lonely", "social", "negative"]);
    addHabit("连续感到孤独或社交不足", "尝试联系熟悉的人或去有人气的地点", `${name}在孤独积累时更可能主动寻找熟悉的人或有人气的地点。`, ["lonely", "contact"]);
    addPreference("更偏好能产生稳定熟人联系的日常场景", ["lonely", "social"], 12);
    selfBeliefs.push("我需要保留一些稳定的人际联系");
    driftTrait(agent.cognitiveProfile, "socialDrive", 1, impact, rate, personalityDrift.cognitiveProfile);
    driftTrait(agent.behaviorTendency, "seekHelp", 1, impact * 0.45, rate, personalityDrift.behaviorTendency);
  } else if (signal.type === "health") {
    addBelief(`${name}逐渐形成判断：健康不能长期忽视。`, ["health", "care"]);
    addHabit("身体不适或健康下降", "先放慢节奏并考虑休息或求助", `${name}身体不适时更倾向先放慢节奏，必要时休息或求助。`, ["health", "recovery"]);
    addPreference("疲惫或不适时偏好安静、可恢复的地点", ["health", "quiet"], 10);
    selfBeliefs.push("身体状态会影响后续安排");
    driftTrait(agent.cognitiveProfile, "routinePreference", 1, impact * 0.45, rate, personalityDrift.cognitiveProfile);
    driftTrait(agent.cognitiveProfile, "riskTolerance", -1, impact * 0.55, rate, personalityDrift.cognitiveProfile);
    driftTrait(agent.behaviorTendency, "seekHelp", 1, impact * 0.45, rate, personalityDrift.behaviorTendency);
  } else if (signal.type === "safety") {
    addBelief(`${name}逐渐形成判断：风险不明时应该先确保安全。`, ["safety", "risk", "negative"]);
    addHabit("出现风险或陌生威胁", "先观察距离并保留退路", `${name}遇到风险不明的情况时更倾向先观察并保留退路。`, ["safety", "observe"]);
    fears.push("担心风险扩散到自己或熟悉的人");
    driftTrait(agent.cognitiveProfile, "riskTolerance", -1, impact, rate, personalityDrift.cognitiveProfile);
    driftTrait(agent.cognitiveProfile, "patience", 1, impact * 0.35, rate, personalityDrift.cognitiveProfile);
    driftTrait(agent.behaviorTendency, "takeRisk", -1, impact, rate, personalityDrift.behaviorTendency);
  } else if (signal.type === "conflict") {
    addBelief(`${name}逐渐相信：人际摩擦需要冷静处理，不能只凭情绪推进。`, ["conflict", "relationship", "negative"]);
    addHabit("发生误会或冲突", "先冷静并寻找可以澄清的证据", `${name}遇到误会或冲突时更倾向先冷静，再寻找澄清方式。`, ["conflict", "calm"]);
    addPreference("在紧张关系里更偏好留出距离和缓冲", ["conflict", "avoid"], -10);
    fears.push("担心关系失控");
    driftTrait(agent.cognitiveProfile, "conflictAvoidance", 1, impact, rate, personalityDrift.cognitiveProfile);
    driftTrait(agent.cognitiveProfile, "patience", 1, impact * 0.35, rate, personalityDrift.cognitiveProfile);
    driftTrait(agent.behaviorTendency, "avoidConflict", 1, impact, rate, personalityDrift.behaviorTendency);
  } else if (signal.type === "quiet") {
    addPreference("疲惫或压力后更喜欢安静环境", ["quiet", "rest"], 12);
    addHabit("压力或疲惫积累", "短暂远离噪声并恢复状态", `${name}在压力或疲惫积累后更倾向短暂远离噪声恢复。`, ["quiet", "recover"]);
    driftTrait(agent.cognitiveProfile, "routinePreference", 1, impact * 0.35, rate, personalityDrift.cognitiveProfile);
  } else if (signal.type === "experience") {
    addBelief(`${name}把最近一次异常经历当作之后判断的参考。`, ["experience"]);
    selfBeliefs.push("不同寻常的经历值得复盘");
    driftTrait(agent.behaviorTendency, "selfReflect", 1, impact * 0.5, rate, personalityDrift.behaviorTendency);
  }

  return {
    beliefUpdates,
    habitUpdates,
    preferenceUpdates,
    selfBeliefs,
    competenceBeliefs,
    fears,
    personalityDrift,
    sourceEvents
  };
}

function snapshotIdentity(agent = {}) {
  return {
    cognitiveProfile: { ...(agent.cognitiveProfile || {}) },
    behaviorTendency: { ...(agent.behaviorTendency || {}) },
    selfModel: {
      selfImage: agent.selfModel?.selfImage || "",
      currentSelfView: agent.selfModel?.currentSelfView || "",
      competenceBeliefs: Array.isArray(agent.selfModel?.competenceBeliefs) ? agent.selfModel.competenceBeliefs.slice(0, 6) : [],
      fears: Array.isArray(agent.selfModel?.fears) ? agent.selfModel.fears.slice(0, 6) : []
    }
  };
}

function hasMeaningfulChange(update = {}) {
  return Boolean(
    update.beliefUpdates?.length
    || update.habitUpdates?.length
    || update.preferenceUpdates?.length
    || Object.keys(update.personalityDrift?.cognitiveProfile || {}).length
    || Object.keys(update.personalityDrift?.behaviorTendency || {}).length
    || update.selfModelUpdate?.selfBeliefs?.length
    || update.selfModelUpdate?.competenceBeliefs?.length
    || update.selfModelUpdate?.fears?.length
  );
}

function evolveAgentIdentity(world = {}, agent = {}, options = {}) {
  if (!agent?.id || agent.lifeStatus === "dead" || agent.terminalState?.dead) {
    return { agentId: agent?.id || "", skipped: true, reason: "dead" };
  }
  ensureMemory(agent);
  const selfModel = ensureEvolutionSelfModel(agent);
  normalizeGoalRuntime(agent, world);
  const clock = num(world.clock, 0);
  const day = Math.floor(clock / 1440);
  agent.identityEvolution ||= {};
  if (!options.force && agent.identityEvolution.day === day) {
    return { agentId: agent.id, skipped: true, reason: "already-ran" };
  }

  const recentEvents = collectRecentEvents(world, agent, {
    ...options,
    sinceClock: options.sinceClock ?? agent.identityEvolution.lastRunClock
  });
  const signals = buildSignals(world, agent, recentEvents);
  const oldState = snapshotIdentity(agent);
  const learningRate = learningRateForAgent(agent);
  const merged = {
    agentId: agent.id,
    beliefUpdates: [],
    habitUpdates: [],
    preferenceUpdates: [],
    selfModelUpdate: { selfBeliefs: [], competenceBeliefs: [], fears: [] },
    personalityDrift: { cognitiveProfile: {}, behaviorTendency: {} },
    sourceEvents: [],
    signals: Object.values(signals).map(signal => ({
      type: signal.type,
      count: signal.count,
      impact: signal.impact,
      sourceEvents: signal.sourceEvents
    }))
  };

  Object.values(signals).forEach(signal => {
    const update = applySignal(world, agent, signal, { learningRate });
    merged.beliefUpdates.push(...update.beliefUpdates);
    merged.habitUpdates.push(...update.habitUpdates);
    merged.preferenceUpdates.push(...update.preferenceUpdates);
    merged.selfModelUpdate.selfBeliefs.push(...update.selfBeliefs);
    merged.selfModelUpdate.competenceBeliefs.push(...update.competenceBeliefs);
    merged.selfModelUpdate.fears.push(...update.fears);
    Object.assign(merged.personalityDrift.cognitiveProfile, update.personalityDrift.cognitiveProfile);
    Object.assign(merged.personalityDrift.behaviorTendency, update.personalityDrift.behaviorTendency);
    merged.sourceEvents.push(...update.sourceEvents);
  });

  merged.selfModelUpdate.selfBeliefs = uniqueStrings(merged.selfModelUpdate.selfBeliefs, 6);
  merged.selfModelUpdate.competenceBeliefs = uniqueStrings(merged.selfModelUpdate.competenceBeliefs, 6);
  merged.selfModelUpdate.fears = uniqueStrings(merged.selfModelUpdate.fears, 6);
  merged.sourceEvents = uniqueStrings(merged.sourceEvents, 12);
  const applied = hasMeaningfulChange(merged);
  const identityPayload = {
    selfBeliefs: [],
    competenceBeliefs: [],
    fears: [],
    currentSelfView: "",
    selfImage: "",
    lifeNarrative: "",
    narrativeHash: null
  };

  if (merged.selfModelUpdate.selfBeliefs.length) {
    identityPayload.selfBeliefs = uniqueStrings([selfModel.selfBeliefs, merged.selfModelUpdate.selfBeliefs], 12);
  }
  if (merged.selfModelUpdate.competenceBeliefs.length) {
    identityPayload.competenceBeliefs = uniqueStrings([selfModel.competenceBeliefs, merged.selfModelUpdate.competenceBeliefs], 8);
  }
  if (merged.selfModelUpdate.fears.length) {
    identityPayload.fears = uniqueStrings([selfModel.fears, merged.selfModelUpdate.fears], 8);
  }
  if (applied) {
    const theme = merged.signals.slice(0, 3).map(item => item.type).join(" / ") || "stable";
    identityPayload.currentSelfView = compactString(
      merged.selfModelUpdate.competenceBeliefs[0]
        ? `最近的经历让${agent.name || "这个人"}更相信：${merged.selfModelUpdate.competenceBeliefs[0]}。`
        : merged.selfModelUpdate.selfBeliefs[0]
          ? `最近的经历让${agent.name || "这个人"}更重视：${merged.selfModelUpdate.selfBeliefs[0]}。`
          : `${agent.name || "这个人"}的人格倾向因 ${theme} 经历出现了轻微调整。`,
      selfModel.currentSelfView,
      220
    );
    identityPayload.selfImage = compactString(selfModel.selfImage || identityPayload.currentSelfView, identityPayload.currentSelfView, 180);
    const narrativeUpdate = narrativeThemeUpdate(selfModel, theme, clock);
    identityPayload.narrativeHash = narrativeUpdate.narrativeHash;
    if (narrativeUpdate.shouldAppend) {
      identityPayload.lifeNarrative = compactString(
        `${selfModel.lifeNarrative || selfModel.identity || ""} 最近的${theme}经历正在缓慢影响其判断方式。`,
        identityPayload.currentSelfView,
        260
      );
    }
    cognitiveWrite({
      world,
      agent,
      agentId: agent.id,
      source: "identity-evolution",
      target: "identity",
      payload: { selfModel: identityPayload, sourceEvents: merged.sourceEvents },
      confidence: 0.72,
      reason: "identity evolution self model update",
      timestamp: clock
    });
  }

  syncLongTermMemoryViews(agent);
  agent.memorySummary = buildMemorySummary(agent, world);
  agent.identityEvolution = {
    day,
    at: clock,
    lastRunClock: clock,
    learningRate,
    signals: merged.signals,
    source: "identity-evolution-v3.1"
  };

  const newState = snapshotIdentity(agent);
  const result = {
    ...merged,
    selfModelUpdate: {
      ...merged.selfModelUpdate,
      currentSelfView: selfModel.currentSelfView,
      selfImage: selfModel.selfImage,
      lifeNarrative: selfModel.lifeNarrative
    },
    learningRate,
    applied,
    oldState,
    newState,
    reason: applied
      ? `daily identity evolution from ${merged.signals.map(item => item.type).join(", ") || "recent events"}`
      : "no meaningful identity signal"
  };

  if (applied) {
    const log = {
      agentId: agent.id,
      agentName: agent.name || agent.id,
      oldState,
      newState,
      reason: result.reason,
      sourceEvent: merged.sourceEvents[0] || "",
      sourceEvents: merged.sourceEvents,
      at: clock,
      day,
      learningRate,
      source: "identity-evolution-v3.1"
    };
    agent.identityChangeLog ||= [];
    agent.identityChangeLog.unshift(log);
    agent.identityChangeLog = agent.identityChangeLog.slice(0, 40);
    world.identityChangeLog ||= [];
    world.identityChangeLog.unshift(log);
    world.identityChangeLog = world.identityChangeLog.slice(0, 300);
  }

  return result;
}

function runIdentityEvolution(world = {}, options = {}) {
  const clock = num(world.clock, 0);
  const day = Math.floor(clock / 1440);
  world.identityEvolutionState ||= {};
  if (!options.force && world.identityEvolutionState.day === day) {
    return {
      ...(world.identityEvolutionState.lastResult || { day, updatedAgents: [] }),
      skipped: true,
      reason: "already-ran"
    };
  }
  const results = [];
  (world.agents || []).forEach(agent => {
    const result = evolveAgentIdentity(world, agent, options);
    results.push(result);
  });
  const updatedAgents = results.filter(item => item.applied).map(item => item.agentId);
  const summary = {
    day,
    at: clock,
    updatedAgents: updatedAgents.slice(0, 200),
    checkedAgents: results.length,
    appliedCount: updatedAgents.length,
    source: "identity-evolution-v3.1"
  };
  world.identityEvolutionState = {
    day,
    lastRunClock: clock,
    updatedAgents: summary.updatedAgents,
    checkedAgents: summary.checkedAgents,
    appliedCount: summary.appliedCount,
    lastResult: summary,
    rule: "Daily 0:00 only. EventLog evidence slowly updates belief, habit, preference, selfModel and cognitiveProfile; no single event instantly rewrites personality."
  };
  return { ...summary, results };
}

module.exports = {
  runIdentityEvolution,
  evolveAgentIdentity,
  learningRateForAgent,
  collectRecentEvents,
  buildSignals,
  classifyEvent
};

"use strict";

function num(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max, fallback = min) {
  const number = num(value, fallback);
  return Math.max(min, Math.min(max, number));
}

function clamp01(value, fallback = 0.5) {
  return Number(clamp(value, 0, 1, fallback).toFixed(3));
}

function compact(value, fallback = "", limit = 160) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, limit);
}

function unique(values = [], limit = 8) {
  const seen = new Set();
  const out = [];
  values.flat(Infinity).forEach(value => {
    const text = compact(value, "", 140);
    if (!text || seen.has(text)) return;
    seen.add(text);
    out.push(text);
  });
  return out.slice(0, limit);
}

function hashString(value = "") {
  let hash = 2166136261;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stableRandom(seed = "", key = "") {
  return (hashString(`${seed}:${key}`) % 10000) / 10000;
}

function jitter(base, seed, key, amount = 0.18) {
  return clamp01(base + (stableRandom(seed, key) - 0.5) * amount, base);
}

function ageStageFromYears(ageYears) {
  const age = num(ageYears, 36);
  if (age < 13) return "child";
  if (age < 19) return "teen";
  if (age >= 65) return "elder";
  return "adult";
}

function roleKind(job = "") {
  const text = String(job || "").toLowerCase();
  if (/student|pupil|child|kid|学生|小学|中学|高中|儿童/.test(text)) return "student";
  if (/teacher|老师|教师|校长|教育/.test(text)) return "teacher";
  if (/doctor|nurse|clinic|医生|护士|医护|诊所|医院/.test(text)) return "medical";
  if (/shop|store|vendor|restaurant|baker|cook|店|铺|早餐|小卖|餐|厨|摊/.test(text)) return "service";
  if (/guard|police|security|保安|警|巡逻/.test(text)) return "security";
  if (/artist|writer|painter|designer|艺术|画|写作|设计/.test(text)) return "creative";
  if (/farmer|garden|农|菜地|种植/.test(text)) return "farmer";
  if (/elder|retired|老人|退休/.test(text)) return "elder";
  if (/worker|staff|office|factory|clerk|commuter|freelance|上班|上班族|职员|工人|工作者|通勤|零工|办事|会计/.test(text)) return "worker";
  return "resident";
}

const stageBase = {
  child: {
    values: ["家人", "安全", "被照看"],
    fears: ["和熟悉的人走散", "被大人误解"],
    beliefs: ["遇到不确定的事应该先找可信的大人"],
    habits: ["先观察熟悉的人怎么做"],
    likes: ["熟悉而安全的地方"],
    dislikes: ["太吵或太陌生的环境"],
    goal: "在家人和学校之间获得稳定感"
  },
  teen: {
    values: ["同伴", "成长", "被认可"],
    fears: ["让老师或家人失望", "被同伴排斥"],
    beliefs: ["自己的选择会影响别人怎么看自己"],
    habits: ["做决定前会参考同伴和老师的反应"],
    likes: ["有同龄人但不过分压迫的环境"],
    dislikes: ["被公开批评"],
    goal: "找到自己的方向并维持学业稳定"
  },
  adult: {
    values: ["责任", "关系", "稳定生活"],
    fears: ["生活节奏失控", "答应的事情做不好"],
    beliefs: ["稳定地承担责任能让生活更可控"],
    habits: ["先处理眼前最确定的责任"],
    likes: ["秩序清楚的安排"],
    dislikes: ["临时变化太多"],
    goal: "把工作、关系和日常生活维持在可持续状态"
  },
  elder: {
    values: ["健康", "熟人关系", "生活节奏"],
    fears: ["身体状态突然变差", "没人知道自己需要帮助"],
    beliefs: ["健康和安全比逞强更重要"],
    habits: ["行动前会先判断身体和路况是否稳妥"],
    likes: ["安静熟悉、有人能照应的地方"],
    dislikes: ["拥挤和赶时间"],
    goal: "保持身体稳定并维持熟人联系"
  }
};

const roleBase = {
  student: {
    values: ["学习", "同伴", "被老师认可"],
    beliefs: ["学习安排会影响当天能不能安心"],
    habits: ["先看课程和作业再决定别的事"],
    likes: ["同学在附近的地方"],
    dislikes: ["突然被打断学习节奏"],
    tendency: { socialDrive: 0.64, curiosity: 0.66, routinePreference: 0.45, patience: 0.48, ambition: 0.52 }
  },
  teacher: {
    values: ["学生", "秩序", "责任"],
    beliefs: ["有人掉队时应该先弄清原因"],
    habits: ["先确认学生和课程安排"],
    likes: ["有秩序的教室和办公室"],
    dislikes: ["信息混乱又没人说明"],
    tendency: { empathy: 0.68, patience: 0.66, routinePreference: 0.62, conflictAvoidance: 0.58, ambition: 0.56 }
  },
  medical: {
    values: ["健康", "判断", "照护"],
    beliefs: ["小问题拖久了也可能变成风险"],
    habits: ["先确认症状和严重程度"],
    likes: ["流程清楚、信息准确的环境"],
    dislikes: ["没有依据的判断"],
    tendency: { empathy: 0.72, patience: 0.66, riskTolerance: 0.38, routinePreference: 0.58, socialDrive: 0.56, healthAwareness: 0.78, riskAwareness: 0.66 }
  },
  service: {
    values: ["熟客", "口碑", "秩序"],
    beliefs: ["稳定待人会让关系慢慢变可靠"],
    habits: ["先观察店里秩序和熟人状态"],
    likes: ["有人来往但不混乱的地方"],
    dislikes: ["无准备的拥挤"],
    tendency: { socialDrive: 0.7, patience: 0.58, routinePreference: 0.62, empathy: 0.58, conflictAvoidance: 0.56 }
  },
  security: {
    values: ["安全", "规则", "责任"],
    beliefs: ["可疑情况需要先确认而不是立刻断言"],
    habits: ["先观察风险源和可撤离路线"],
    likes: ["视野清楚的地点"],
    dislikes: ["含糊的危险信号"],
    tendency: { riskTolerance: 0.56, patience: 0.6, routinePreference: 0.58, conflictAvoidance: 0.42, ambition: 0.48, riskAwareness: 0.78, safetyAwareness: 0.82 }
  },
  creative: {
    values: ["观察", "表达", "自由"],
    beliefs: ["细节会改变自己对生活的理解"],
    habits: ["遇到新鲜场景会先观察和记录"],
    likes: ["安静但有细节的环境"],
    dislikes: ["完全重复又没有空间的安排"],
    tendency: { curiosity: 0.78, routinePreference: 0.34, socialDrive: 0.48, ambition: 0.5, patience: 0.54 }
  },
  farmer: {
    values: ["季节", "土地", "耐心"],
    beliefs: ["事情要看天气、时令和身体节奏"],
    habits: ["先看环境变化再安排体力活"],
    likes: ["开阔熟悉的地方"],
    dislikes: ["急躁催促"],
    tendency: { patience: 0.7, routinePreference: 0.66, riskTolerance: 0.42, empathy: 0.54, curiosity: 0.45 }
  },
  elder: {
    values: ["健康", "熟人", "经验"],
    beliefs: ["熟人之间的照应比逞强更可靠"],
    habits: ["行动前先确认身体是否能承受"],
    likes: ["节奏慢、熟人能找到自己的地方"],
    dislikes: ["赶时间和陌生冲突"],
    tendency: { routinePreference: 0.74, patience: 0.68, riskTolerance: 0.28, socialDrive: 0.46, conflictAvoidance: 0.72 }
  },
  worker: {
    values: ["工作", "信用", "稳定"],
    beliefs: ["按时完成责任会减少后面的麻烦"],
    habits: ["先处理最明确的工作或家庭责任"],
    likes: ["明确的时间表"],
    dislikes: ["临时返工和说不清的要求"],
    tendency: { ambition: 0.58, routinePreference: 0.62, patience: 0.56, socialDrive: 0.42, conflictAvoidance: 0.54 }
  },
  resident: {
    values: ["稳定", "熟人", "日常秩序"],
    beliefs: ["生活稳定来自小事的持续处理"],
    habits: ["先把当天最确定的小事安排好"],
    likes: ["熟悉、压力低的地方"],
    dislikes: ["突然变化太多"],
    tendency: { routinePreference: 0.56, patience: 0.54, socialDrive: 0.48, curiosity: 0.46, conflictAvoidance: 0.54 }
  }
};

function mergedProfile(stage, role, seed) {
  const stageBias = stage === "child" ? { riskTolerance: 0.34, curiosity: 0.66, routinePreference: 0.46, socialDrive: 0.58, ambition: 0.36, empathy: 0.52, conflictAvoidance: 0.58, patience: 0.42 }
    : stage === "teen" ? { riskTolerance: 0.46, curiosity: 0.62, routinePreference: 0.42, socialDrive: 0.66, ambition: 0.52, empathy: 0.48, conflictAvoidance: 0.48, patience: 0.44 }
      : stage === "elder" ? { riskTolerance: 0.28, curiosity: 0.4, routinePreference: 0.72, socialDrive: 0.44, ambition: 0.34, empathy: 0.58, conflictAvoidance: 0.7, patience: 0.66 }
        : { riskTolerance: 0.48, curiosity: 0.5, routinePreference: 0.56, socialDrive: 0.5, ambition: 0.54, empathy: 0.54, conflictAvoidance: 0.54, patience: 0.56 };
  const roleBias = roleBase[role]?.tendency || {};
  const keys = ["riskTolerance", "curiosity", "routinePreference", "socialDrive", "ambition", "empathy", "conflictAvoidance", "patience", "healthAwareness", "riskAwareness", "safetyAwareness"];
  return Object.fromEntries(keys.map(key => {
    const stageValue = stageBias[key] === undefined ? 0.5 : stageBias[key];
    const base = roleBias[key] === undefined ? stageValue : (stageValue * 0.45 + roleBias[key] * 0.55);
    return [key, jitter(base, seed, key, 0.22)];
  }));
}

function decisionWeightsFromProfile(profile = {}, seed = "") {
  const memory = 0.42 + profile.routinePreference * 0.24 + profile.patience * 0.12 + stableRandom(seed, "memory") * 0.1;
  const persona = 0.44 + profile.routinePreference * 0.18 + profile.conflictAvoidance * 0.14 + stableRandom(seed, "persona") * 0.12;
  const emotion = 0.32 + (1 - profile.patience) * 0.24 + (1 - profile.routinePreference) * 0.08 + stableRandom(seed, "emotion") * 0.1;
  const goal = 0.4 + profile.ambition * 0.32 + profile.routinePreference * 0.08 + stableRandom(seed, "goal") * 0.12;
  const novelty = 0.22 + profile.curiosity * 0.36 + profile.riskTolerance * 0.12 - profile.routinePreference * 0.08 + stableRandom(seed, "novelty") * 0.08;
  const social = 0.24 + profile.socialDrive * 0.36 + profile.empathy * 0.12 + stableRandom(seed, "social") * 0.08;
  return {
    memory: clamp01(memory, 0.55),
    persona: clamp01(persona, 0.55),
    emotion: clamp01(emotion, 0.45),
    goal: clamp01(goal, 0.55),
    novelty: clamp01(novelty, 0.3),
    social: clamp01(social, 0.45),
    memoryWeight: clamp01(memory, 0.55),
    identityWeight: clamp01(persona, 0.55),
    personalityWeight: clamp01(persona, 0.55),
    emotionWeight: clamp01(emotion, 0.45),
    goalWeight: clamp01(goal, 0.55),
    noveltyWeight: clamp01(novelty, 0.3),
    socialWeight: clamp01(social, 0.45)
  };
}

function behaviorTendencyFromProfile(profile = {}) {
  return {
    keepRoutine: clamp01(profile.routinePreference),
    seekHelp: clamp01(profile.socialDrive * 0.45 + profile.empathy * 0.35 + profile.conflictAvoidance * 0.15),
    explore: clamp01(profile.curiosity * 0.62 + profile.riskTolerance * 0.18),
    avoidConflict: clamp01(profile.conflictAvoidance),
    persistOnGoal: clamp01(profile.ambition * 0.55 + profile.patience * 0.25),
    careForOthers: clamp01(profile.empathy * 0.7 + profile.socialDrive * 0.16),
    takeRisk: clamp01(profile.riskTolerance * 0.75 + profile.curiosity * 0.12),
    selfReflect: clamp01(profile.memoryWeight || profile.routinePreference * 0.25 + profile.curiosity * 0.28 + profile.patience * 0.18)
  };
}

function makeStructuredItem(agentId, type, index, text, options = {}) {
  const id = compact(options.id || `seed_${agentId}_${type}_${index + 1}`, "", 80);
  const at = num(options.at, 0);
  return {
    id,
    type,
    sourceType: type,
    at,
    lastSeenAt: num(options.lastSeenAt, at),
    text: compact(text, "", 180),
    meaning: compact(options.meaning || text, "", 220),
    importance: clamp(options.importance, 1, 5, 3),
    strength: clamp(options.strength, 0, 100, 58),
    confidence: clamp01(options.confidence, 0.58),
    source: options.source || "character-genesis",
    sourceEvents: Array.isArray(options.sourceEvents) ? options.sourceEvents.slice(0, 8) : [],
    createdAt: num(options.createdAt, at),
    lastConfirmed: num(options.lastConfirmed, at),
    trigger: compact(options.trigger || "", "", 80),
    action: compact(options.action || "", "", 120),
    probability: options.probability == null ? undefined : clamp01(options.probability, 0.5),
    preference: compact(options.preference || "", "", 120),
    lesson: compact(options.lesson || "", "", 180),
    emotionalImpact: options.emotionalImpact == null ? undefined : clamp01(options.emotionalImpact, 0.25),
    valence: clamp(options.valence, -100, 100, 0),
    target: options.target || "",
    tags: unique(options.tags || ["genesis"], 8),
    evidenceIds: []
  };
}

function makeVectorItem(agentId, item, index) {
  const scene = compact(item.meaning || item.text, "", 240);
  return {
    id: `vec_${agentId}_genesis_${index + 1}`,
    agentId,
    sourceMemoryId: item.id || "",
    structuredType: item.type || "episodic",
    scene,
    text: scene,
    at: 0,
    lastSeenAt: 0,
    importance: clamp(item.importance, 1, 5, 3),
    strength: clamp(item.strength, 0, 100, 55),
    valence: clamp(item.valence, -100, 100, 0),
    tags: unique([item.tags || [], "genesis"], 8),
    source: "vector-memory-local-pending",
    factAuthority: false,
    rule: "Vector memory is associative recall only; it is not a fact source and cannot decide actions by itself."
  };
}

function stageDescription(stage) {
  if (stage === "child") return "依赖家庭并保持探索";
  if (stage === "teen") return "在身份探索和同伴影响之间摇摆";
  if (stage === "elder") return "更重视健康、回忆和传承";
  return "在事业、关系和责任之间维持平衡";
}

function roleSourceText(role, job) {
  return {
    student: "学习和同伴环境",
    teacher: "教育和照看学生的经验",
    medical: "照护和健康判断经验",
    service: "和熟客、营业秩序打交道的经验",
    security: "维护安全和规则边界的经验",
    creative: "观察生活细节和表达的经验",
    farmer: "跟随季节、天气和体力节奏的经验",
    elder: "长期生活经验和身体节奏变化",
    worker: "按时完成工作和家庭责任的经验",
    resident: `${job || "日常生活"}里的稳定责任`
  }[role] || `${job || "日常生活"}里的稳定责任`;
}

function lifeHistorySeedFor(stage, role, job, values = [], beliefs = [], habits = [], likes = [], goal = "") {
  const roleSource = roleSourceText(role, job);
  const value = values[0] || "稳定";
  const belief = beliefs[0] || "先判断再行动";
  const habit = habits[0] || "先稳定节奏";
  const like = likes[0] || "熟悉环境";
  const goalText = goal || "维持稳定生活";
  return {
    childhood: [{
      event: `从小在熟悉关系里学习到“${value}”很重要。`,
      impact: `更容易把${value}作为判断事情轻重的依据。`,
      ageRange: "0-12"
    }],
    youth: [{
      event: `成长过程中反复接触${roleSource}，逐渐形成“${belief}”的判断。`,
      impact: "遇到新情况时不会只按需求反应，而会先用已有判断过滤。",
      ageRange: stage === "child" ? "尚未完全进入青年阶段" : "13-22"
    }],
    adulthood: [{
      event: stage === "child" || stage === "teen"
        ? `尚未长期承担成年职业责任，但已经从身边人那里观察到${job || "日常责任"}的稳定要求。`
        : `长期围绕${job || "小镇居民"}身份处理日常责任，因此形成“${habit}”的倾向。`,
      impact: stage === "child" || stage === "teen"
        ? "对责任的理解仍依赖家庭、学校和熟人环境。"
        : "职责、关系和个人状态会一起影响行动选择。",
      ageRange: stage === "elder" ? "23-64" : stage === "adult" ? "23-现在" : "未来阶段"
    }],
    recent: [{
      event: `最近仍围绕“${goalText}”维持生活节奏，并偏好${like}。`,
      impact: "当前目标、地点选择和社交方式会受这个稳定来源影响。",
      ageRange: "近期"
    }]
  };
}

function flattenLifeHistorySeed(seed = {}) {
  return ["childhood", "youth", "adulthood", "recent"].flatMap(section => (
    Array.isArray(seed[section])
      ? seed[section].map((item, index) => ({ ...item, section, index }))
      : []
  ));
}

function memoryViewsFromSeed(agentId, lifeHistorySeed, beliefs = [], habits = [], likes = [], dislikes = [], profile = {}, role = "resident") {
  const lifeEvents = flattenLifeHistorySeed(lifeHistorySeed);
  const sourceFor = (type, index) => [`life_seed_${agentId}_${type}_${index + 1}`];
  const episodicMemory = lifeEvents.slice(0, 4).map((item, index) => ({
    id: `seed_${agentId}_episodic_${index + 1}`,
    type: "episodic",
    event: compact(item.event, "", 180),
    lesson: compact(item.impact || "这段经历会影响之后的判断。", "", 180),
    meaning: compact(item.impact || item.event, "", 220),
    emotionalImpact: Number(clamp01(0.18 + index * 0.04, 0.25)),
    importance: Number(clamp01(0.55 + index * 0.03, 0.6)),
    source: "lifeHistorySeed",
    sourceEvents: sourceFor("episodic", index),
    ageRange: item.ageRange || "",
    section: item.section || ""
  }));
  const beliefMemory = unique(beliefs, 3).map((belief, index) => ({
    id: `seed_${agentId}_belief_${index + 1}`,
    type: "belief",
    belief: compact(belief, "", 160),
    strength: Number(clamp01(0.58 + profile.routinePreference * 0.18 + index * 0.02, 0.68)),
    confidence: Number(clamp01(0.52 + profile.patience * 0.18, 0.62)),
    source: role === "medical" ? "职业经历" : role === "teacher" ? "教育经历" : role === "security" ? "职责经验" : "人生经历",
    sourceEvents: sourceFor("belief", index),
    createdAt: 0,
    lastConfirmed: 0
  }));
  const habitMemory = unique(habits, 3).map((habit, index) => ({
    id: `seed_${agentId}_habit_${index + 1}`,
    type: "habit",
    trigger: index === 0 ? "压力或信息不完整时" : index === 1 ? "需要做选择时" : "日常节奏被打断时",
    action: compact(habit, "", 140),
    habit: compact(habit, "", 160),
    probability: Number(clamp01(0.46 + profile.routinePreference * 0.26 + profile.patience * 0.1 - index * 0.03, 0.58)),
    strength: Number(clamp01(0.5 + profile.routinePreference * 0.25, 0.62)),
    source: "长期行为模式",
    sourceEvents: sourceFor("habit", index)
  }));
  const preferenceMemory = [
    ...unique(likes, 2).map((preference, index) => ({
      id: `seed_${agentId}_preference_like_${index + 1}`,
      type: "preference",
      preference: compact(preference, "", 140),
      strength: Number(clamp01(0.5 + profile.socialDrive * 0.12 + profile.routinePreference * 0.12, 0.6)),
      valence: 20,
      source: "生活偏好",
      sourceEvents: sourceFor("preference_like", index)
    })),
    ...unique(dislikes, 1).map((preference, index) => ({
      id: `seed_${agentId}_preference_dislike_${index + 1}`,
      type: "preference",
      preference: `不喜欢${compact(preference, "", 120)}`,
      strength: Number(clamp01(0.42 + profile.conflictAvoidance * 0.18, 0.52)),
      valence: -15,
      source: "回避偏好",
      sourceEvents: sourceFor("preference_dislike", index)
    }))
  ];
  return { episodicMemory, beliefMemory, habitMemory, preferenceMemory };
}

function structuredMemoryFromViews(agentId, views = {}, goal = "", profile = {}) {
  return {
    episodic: (views.episodicMemory || []).map((item, index) => makeStructuredItem(agentId, "episodic", index, item.event, {
      meaning: item.lesson || item.meaning || item.event,
      importance: 3.1 + clamp(item.importance, 0, 1, 0.55),
      strength: 55 + Math.round(clamp(item.importance, 0, 1, 0.55) * 18),
      emotionalImpact: item.emotionalImpact,
      lesson: item.lesson,
      source: item.source || "lifeHistorySeed",
      sourceEvents: item.sourceEvents || [],
      tags: ["genesis", "lifeHistorySeed", item.section].filter(Boolean),
      valence: 4
    })),
    belief: (views.beliefMemory || []).map((item, index) => makeStructuredItem(agentId, "belief", index, item.belief, {
      importance: 3.2,
      strength: Math.round(clamp(item.strength, 0, 1, 0.6) * 100),
      confidence: item.confidence,
      source: item.source || "character-genesis",
      sourceEvents: item.sourceEvents || [],
      tags: ["genesis", "belief"],
      valence: 3
    })),
    habit: (views.habitMemory || []).map((item, index) => makeStructuredItem(agentId, "habit", index, item.habit || item.action, {
      importance: 3,
      strength: Math.round(clamp(item.strength, 0, 1, 0.58) * 100),
      trigger: item.trigger,
      action: item.action,
      probability: item.probability,
      source: item.source || "character-genesis",
      sourceEvents: item.sourceEvents || [],
      tags: ["genesis", "habit"],
      valence: 2
    })),
    preference: (views.preferenceMemory || []).map((item, index) => makeStructuredItem(agentId, "preference", index, item.preference, {
      importance: 2.6,
      strength: Math.round(clamp(item.strength, 0, 1, 0.55) * 100),
      preference: item.preference,
      source: item.source || "character-genesis",
      sourceEvents: item.sourceEvents || [],
      tags: ["genesis", "preference"],
      valence: item.valence == null ? 12 : item.valence
    })),
    social: [],
    goal: [makeStructuredItem(agentId, "goal", 0, goal, { importance: 3.1, strength: 56 + Math.round(profile.ambition * 18), valence: 5, tags: ["genesis", "goal"] })]
  };
}

function characterSeedForSlot(slot = {}, context = {}) {
  const ageYears = num(slot.ageYears || slot.existing?.ageYears || slot.existing?.age || String(slot.ageRange || "").match(/\d+/)?.[0], 36);
  const stage = ageStageFromYears(ageYears);
  const role = roleKind(slot.roleHint || slot.existing?.job || "");
  const agentId = compact(slot.id || `agent_${num(slot.index, 0) + 1}`, "agent", 80);
  const job = compact(slot.roleHint || slot.existing?.job || "小镇居民", "小镇居民", 40);
  const seed = `${context.premise || context.townSetting || ""}:${agentId}:${job}:${ageYears}`;
  const stageData = stageBase[stage] || stageBase.adult;
  const roleData = roleBase[role] || roleBase.resident;
  const profile = mergedProfile(stage, role, seed);
  const decisionWeights = decisionWeightsFromProfile(profile, seed);
  const behaviorTendency = behaviorTendencyFromProfile({ ...profile, memoryWeight: decisionWeights.memory });
  const values = unique([stageData.values, roleData.values], 5);
  const fears = unique([stageData.fears, roleData.dislikes?.map(item => `陷入${item}`)], 5);
  const beliefs = unique([roleData.beliefs, stageData.beliefs], 5);
  const habits = unique([roleData.habits, stageData.habits], 5);
  const likes = unique([roleData.likes, stageData.likes], 5);
  const dislikes = unique([roleData.dislikes, stageData.dislikes], 5);
  const goal = compact(slot.existing?.goal || stageData.goal || "维持稳定生活", "维持稳定生活", 80);
  const lifeHistorySeed = lifeHistorySeedFor(stage, role, job, values, beliefs, habits, likes, goal);
  const lifeHistory = {
    stage,
    stageTheme: stageDescription(stage),
    summary: `{name}在${job}身份中形成了重视${values[0] || "稳定"}的生活底色。`,
    episodes: flattenLifeHistorySeed(lifeHistorySeed).slice(0, 4).map(item => `{name}${item.event.replace(/^从小|^成长过程中|^长期|^最近仍/, "")}`)
  };
  const memoryViews = memoryViewsFromSeed(agentId, lifeHistorySeed, beliefs, habits, likes, dislikes, profile, role);
  const structuredMemory = structuredMemoryFromViews(agentId, memoryViews, goal, profile);
  const vectorMemory = [...structuredMemory.episodic, ...structuredMemory.belief.slice(0, 1), ...structuredMemory.preference.slice(0, 1)]
    .map((item, index) => makeVectorItem(agentId, item, index));
  return {
    id: agentId,
    source: "CharacterSeedAgent",
    agentSchemaVersion: "3.1.5",
    ageYears,
    ageStage: stage,
    roleKind: role,
    goal,
    identityCore: {
      identity: `{name}把自己理解为一个生活在小镇里的${job}`,
      values,
      fears,
      habits,
      selfBeliefs: beliefs,
      avoidance: dislikes,
      biases: {
        dutyFirst: Math.round((profile.ambition * 0.45 + profile.routinePreference * 0.35) * 100),
        riskAvoidance: Math.round((1 - profile.riskTolerance) * 100),
        askForHelp: Math.round(behaviorTendency.seekHelp * 100),
        familyAttachment: stage === "child" ? 78 : stage === "elder" ? 64 : 52,
        conflictAvoidance: Math.round(profile.conflictAvoidance * 100),
        statusConcern: Math.round((profile.ambition * 0.35 + profile.socialDrive * 0.25) * 100)
      }
    },
    cognitiveProfile: profile,
    decisionWeights,
    behaviorTendency,
    lifeHistorySeed,
    lifeHistory,
    initialBeliefs: beliefs,
    initialHabits: habits,
    preferences: { like: likes, dislike: dislikes },
    episodicMemory: memoryViews.episodicMemory,
    beliefMemory: memoryViews.beliefMemory,
    habitMemory: memoryViews.habitMemory,
    preferenceMemory: memoryViews.preferenceMemory,
    structuredMemory,
    vectorMemory,
    personalityProfile: {
      values,
      habits,
      avoidance: dislikes,
      fears,
      decisionBias: `更倾向于${profile.routinePreference >= 0.6 ? "保持稳定节奏" : profile.curiosity >= 0.62 ? "先观察新变化" : "在稳定和尝试之间折中"}`,
      identityBiases: {
        dutyFirst: Math.round((profile.ambition * 0.45 + profile.routinePreference * 0.35) * 100),
        riskAvoidance: Math.round((1 - profile.riskTolerance) * 100),
        askForHelp: Math.round(behaviorTendency.seekHelp * 100),
        familyAttachment: stage === "child" ? 78 : stage === "elder" ? 64 : 52,
        conflictAvoidance: Math.round(profile.conflictAvoidance * 100),
        statusConcern: Math.round((profile.ambition * 0.35 + profile.socialDrive * 0.25) * 100)
      }
    },
    selfModel: {
      identity: `{name}把自己理解为一个生活在小镇里的${job}`,
      values,
      fears,
      selfBeliefs: beliefs,
      selfImage: `我是一个重视${values[0] || "稳定"}的${job || "小镇居民"}`,
      strengths: unique([
        profile.patience >= 0.62 ? "耐心" : "",
        profile.empathy >= 0.62 ? "愿意照顾别人" : "",
        profile.routinePreference >= 0.62 ? "生活节奏稳定" : "",
        profile.curiosity >= 0.62 ? "观察力强" : ""
      ], 4),
      concerns: unique([
        profile.riskTolerance <= 0.4 ? "担心风险失控" : "",
        profile.conflictAvoidance >= 0.62 ? "担心冲突扩大" : "",
        fears[0]
      ], 4),
      lifeNarrative: `{name}的性格主要来自${roleSourceText(role, job)}：${flattenLifeHistorySeed(lifeHistorySeed).slice(0, 2).map(item => item.impact).join("；")}`,
      competenceBeliefs: [],
      currentSelfView: "刚进入小镇生活，正在按照已有习惯理解自己的处境",
      selfConsistencyWeight: clamp01(0.5 + profile.routinePreference * 0.25 + profile.patience * 0.12, 0.65)
    },
    goalRuntime: {
      goals: [{ id: `goal_${agentId}_1`, name: goal, title: goal, priority: clamp01(0.45 + profile.ambition * 0.35, 0.58), progress: 0.18, frustration: 0, lastProgressTime: 0, blockedBy: [] }],
      updatedAt: 0,
      source: "character-genesis-v3.1.5"
    },
    logs: [`CharacterSeedAgent prepared ${agentId}`]
  };
}

function buildCharacterSeeds(slots = [], context = {}) {
  return (Array.isArray(slots) ? slots : []).map(slot => characterSeedForSlot(slot, context));
}

function resolveNameText(value, agent = {}) {
  return compact(value, "", 260)
    .replace(/\{name\}/g, compact(agent.name || agent.id || "这个人", "这个人", 40))
    .replace(/\{job\}/g, compact(agent.job || "小镇居民", "小镇居民", 40));
}

function resolveStructuredMemory(memory = {}, agent = {}) {
  const result = { habit: [], belief: [], preference: [], episodic: [], social: [], goal: [] };
  Object.keys(result).forEach(type => {
    const rows = Array.isArray(memory[type]) ? memory[type] : [];
    result[type] = rows.map((item, index) => ({
      ...item,
      id: item.id || `seed_${agent.id}_${type}_${index + 1}`,
      type,
      sourceType: item.sourceType || type,
      text: resolveNameText(item.text || item.meaning, agent),
      meaning: resolveNameText(item.meaning || item.text, agent),
      importance: clamp(item.importance, 1, 5, 3),
      strength: clamp(item.strength, 0, 100, 55),
      confidence: clamp01(item.confidence, 0.58),
      source: item.source || "character-genesis",
      sourceEvents: Array.isArray(item.sourceEvents) ? item.sourceEvents.slice(0, 8) : [],
      createdAt: num(item.createdAt, 0),
      lastConfirmed: num(item.lastConfirmed, item.lastSeenAt || item.at || 0),
      trigger: resolveNameText(item.trigger || "", agent),
      action: resolveNameText(item.action || "", agent),
      probability: item.probability == null ? undefined : clamp01(item.probability, 0.5),
      preference: resolveNameText(item.preference || "", agent),
      lesson: resolveNameText(item.lesson || "", agent),
      emotionalImpact: item.emotionalImpact == null ? undefined : clamp01(item.emotionalImpact, 0.25),
      valence: clamp(item.valence, -100, 100, 0),
      tags: unique([item.tags || [], "genesis"], 8),
      evidenceIds: Array.isArray(item.evidenceIds) ? item.evidenceIds.slice(0, 8) : []
    }));
  });
  return result;
}

function mergeMemoryLayers(existing = {}, extra = {}) {
  const result = { habit: [], belief: [], preference: [], episodic: [], social: [], goal: [] };
  Object.keys(result).forEach(type => {
    const seen = new Set();
    result[type] = [...(Array.isArray(existing[type]) ? existing[type] : []), ...(Array.isArray(extra[type]) ? extra[type] : [])]
      .filter(item => {
        const key = item?.id || item?.text || item?.meaning;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 40);
  });
  return result;
}

function mergeViewItems(existing = [], extra = [], limit = 30) {
  const seen = new Set();
  return [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(extra) ? extra : [])]
    .filter(item => {
      const key = item?.id || item?.belief || item?.habit || item?.preference || item?.event || item?.meaning || item?.text;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function resolveLifeHistorySeed(seed = {}, agent = {}) {
  const output = { childhood: [], youth: [], adulthood: [], recent: [] };
  Object.keys(output).forEach(section => {
    output[section] = (Array.isArray(seed?.[section]) ? seed[section] : [])
      .map(item => ({
        event: resolveNameText(item?.event || "", agent),
        impact: resolveNameText(item?.impact || "", agent),
        ageRange: compact(item?.ageRange || "", "", 40)
      }))
      .filter(item => item.event || item.impact)
      .slice(0, 4);
  });
  return output;
}

function viewMemoryFromStructured(agent = {}) {
  const structured = agent.structuredMemory || {};
  const episodicMemory = (structured.episodic || []).map(item => ({
    id: item.id || "",
    type: "episodic",
    event: item.text || item.event || "",
    lesson: item.lesson || item.meaning || "",
    meaning: item.meaning || item.lesson || item.text || "",
    emotionalImpact: item.emotionalImpact == null ? 0.25 : item.emotionalImpact,
    importance: clamp01(Number(item.importance || 3) / 5, 0.6),
    source: item.source || "character-genesis",
    sourceEvents: Array.isArray(item.sourceEvents) ? item.sourceEvents.slice(0, 8) : []
  }));
  const beliefMemory = (structured.belief || []).map(item => ({
    id: item.id || "",
    type: "belief",
    belief: item.meaning || item.text || "",
    strength: clamp01(Number(item.strength || 60) / 100, 0.6),
    confidence: clamp01(item.confidence, 0.58),
    source: item.source || "character-genesis",
    sourceEvents: Array.isArray(item.sourceEvents) ? item.sourceEvents.slice(0, 8) : []
  }));
  const habitMemory = (structured.habit || []).map(item => ({
    id: item.id || "",
    type: "habit",
    trigger: item.trigger || "相关情境",
    action: item.action || item.meaning || item.text || "",
    habit: item.meaning || item.text || item.action || "",
    probability: clamp01(item.probability, clamp01(Number(item.strength || 58) / 100, 0.58)),
    strength: clamp01(Number(item.strength || 58) / 100, 0.58),
    source: item.source || "character-genesis",
    sourceEvents: Array.isArray(item.sourceEvents) ? item.sourceEvents.slice(0, 8) : []
  }));
  const preferenceMemory = (structured.preference || []).map(item => ({
    id: item.id || "",
    type: "preference",
    preference: item.preference || item.meaning || item.text || "",
    strength: clamp01(Number(item.strength || 55) / 100, 0.55),
    valence: clamp(item.valence, -100, 100, 0),
    source: item.source || "character-genesis",
    sourceEvents: Array.isArray(item.sourceEvents) ? item.sourceEvents.slice(0, 8) : []
  }));
  return { episodicMemory, beliefMemory, habitMemory, preferenceMemory };
}

function mergeCharacterSeed(agent = {}, seed = {}) {
  if (!agent || typeof agent !== "object") return agent;
  const source = seed && typeof seed === "object" ? seed : {};
  const identityCore = source.identityCore || {};
  const personalityProfile = source.personalityProfile || {};
  const structured = resolveStructuredMemory(source.structuredMemory || {}, agent);
  const nameAware = value => resolveNameText(value, agent);
  agent.cognitiveProfile = {
    ...(source.cognitiveProfile || {}),
    ...(agent.cognitiveProfile && typeof agent.cognitiveProfile === "object" ? agent.cognitiveProfile : {})
  };
  agent.decisionWeights = {
    ...(source.decisionWeights || {}),
    ...(agent.decisionWeights && typeof agent.decisionWeights === "object" ? agent.decisionWeights : {})
  };
  agent.behaviorTendency = {
    ...(source.behaviorTendency || {}),
    ...(agent.behaviorTendency && typeof agent.behaviorTendency === "object" ? agent.behaviorTendency : {})
  };
  agent.lifeHistorySeed = resolveLifeHistorySeed(
    agent.lifeHistorySeed && Object.keys(agent.lifeHistorySeed).length ? agent.lifeHistorySeed : source.lifeHistorySeed,
    agent
  );
  agent.lifeHistory = {
    ...(source.lifeHistory || {}),
    ...(agent.lifeHistory && typeof agent.lifeHistory === "object" ? agent.lifeHistory : {})
  };
  if (agent.lifeHistory.summary) agent.lifeHistory.summary = nameAware(agent.lifeHistory.summary);
  if (Array.isArray(agent.lifeHistory.episodes)) agent.lifeHistory.episodes = agent.lifeHistory.episodes.map(nameAware).slice(0, 6);
  agent.initialBeliefs = unique([source.initialBeliefs, agent.initialBeliefs], 8).map(nameAware);
  agent.initialHabits = unique([source.initialHabits, agent.initialHabits], 8).map(nameAware);
  const sourcePrefs = source.preferences || {};
  const agentPrefs = agent.preferences || {};
  agent.preferences = {
    like: unique([sourcePrefs.like, agentPrefs.like], 8).map(nameAware),
    dislike: unique([sourcePrefs.dislike, agentPrefs.dislike], 8).map(nameAware)
  };
  agent.identityCore = {
    ...(agent.identityCore || {}),
    identity: nameAware(agent.identityCore?.identity || identityCore.identity || `${agent.name || "这个人"}把自己理解为小镇居民`),
    values: unique([identityCore.values, agent.identityCore?.values], 8).map(nameAware),
    fears: unique([identityCore.fears, agent.identityCore?.fears], 8).map(nameAware),
    habits: unique([identityCore.habits, source.initialHabits, agent.identityCore?.habits], 8).map(nameAware),
    selfBeliefs: unique([identityCore.selfBeliefs, source.initialBeliefs, agent.identityCore?.selfBeliefs], 10).map(nameAware),
    avoidance: unique([identityCore.avoidance, source.preferences?.dislike, agent.identityCore?.avoidance], 8).map(nameAware),
    biases: {
      ...(identityCore.biases || {}),
      ...(agent.identityCore?.biases || {})
    }
  };
  agent.personalityProfile = {
    ...(personalityProfile || {}),
    ...(agent.personalityProfile || {}),
    values: unique([personalityProfile.values, agent.personalityProfile?.values, agent.identityCore.values], 8).map(nameAware),
    habits: unique([personalityProfile.habits, agent.personalityProfile?.habits, agent.identityCore.habits], 8).map(nameAware),
    avoidance: unique([personalityProfile.avoidance, agent.personalityProfile?.avoidance, agent.identityCore.avoidance], 8).map(nameAware),
    fears: unique([personalityProfile.fears, agent.personalityProfile?.fears, agent.identityCore.fears], 8).map(nameAware),
    decisionBias: nameAware(agent.personalityProfile?.decisionBias || personalityProfile.decisionBias || "")
  };
  agent.selfModel = {
    ...(source.selfModel || {}),
    ...(agent.selfModel || {}),
    identity: nameAware(agent.selfModel?.identity || source.selfModel?.identity || agent.identityCore.identity),
    values: unique([source.selfModel?.values, agent.selfModel?.values, agent.identityCore.values], 8).map(nameAware),
    fears: unique([source.selfModel?.fears, agent.selfModel?.fears, agent.identityCore.fears], 8).map(nameAware),
    selfBeliefs: unique([source.selfModel?.selfBeliefs, agent.selfModel?.selfBeliefs, agent.identityCore.selfBeliefs], 10).map(nameAware),
    currentSelfView: nameAware(agent.selfModel?.currentSelfView || source.selfModel?.currentSelfView || ""),
    selfImage: nameAware(agent.selfModel?.selfImage || source.selfModel?.selfImage || agent.identityCore.identity),
    strengths: unique([source.selfModel?.strengths, agent.selfModel?.strengths], 8).map(nameAware),
    concerns: unique([source.selfModel?.concerns, agent.selfModel?.concerns, agent.identityCore.fears], 8).map(nameAware),
    lifeNarrative: nameAware(agent.selfModel?.lifeNarrative || source.selfModel?.lifeNarrative || agent.lifeHistory?.summary || ""),
    competenceBeliefs: unique([source.selfModel?.competenceBeliefs, agent.selfModel?.competenceBeliefs], 8).map(nameAware),
    selfConsistencyWeight: clamp01(agent.selfModel?.selfConsistencyWeight ?? source.selfModel?.selfConsistencyWeight, 0.65)
  };
  agent.structuredMemory = mergeMemoryLayers(agent.structuredMemory || {}, structured);
  const structuredViews = viewMemoryFromStructured(agent);
  agent.episodicMemory = mergeViewItems(agent.episodicMemory, source.episodicMemory || structuredViews.episodicMemory, 30).map(item => ({
    ...item,
    event: nameAware(item.event || item.text || item.meaning || ""),
    lesson: nameAware(item.lesson || item.meaning || ""),
    meaning: nameAware(item.meaning || item.lesson || item.event || "")
  })).filter(item => item.event || item.meaning);
  agent.beliefMemory = mergeViewItems(agent.beliefMemory, source.beliefMemory || structuredViews.beliefMemory, 30).map(item => ({
    ...item,
    belief: nameAware(item.belief || item.text || item.meaning || ""),
    strength: clamp01(item.strength, 0.6),
    source: item.source || "character-genesis",
    sourceEvents: Array.isArray(item.sourceEvents) ? item.sourceEvents.slice(0, 8) : []
  })).filter(item => item.belief);
  agent.habitMemory = mergeViewItems(agent.habitMemory, source.habitMemory || structuredViews.habitMemory, 30).map(item => ({
    ...item,
    trigger: nameAware(item.trigger || "相关情境"),
    action: nameAware(item.action || item.habit || item.text || item.meaning || ""),
    habit: nameAware(item.habit || item.action || item.text || item.meaning || ""),
    probability: clamp01(item.probability, 0.58),
    source: item.source || "character-genesis",
    sourceEvents: Array.isArray(item.sourceEvents) ? item.sourceEvents.slice(0, 8) : []
  })).filter(item => item.habit || item.action);
  agent.preferenceMemory = mergeViewItems(agent.preferenceMemory, source.preferenceMemory || structuredViews.preferenceMemory, 30).map(item => ({
    ...item,
    preference: nameAware(item.preference || item.text || item.meaning || ""),
    strength: clamp01(item.strength, 0.55),
    source: item.source || "character-genesis",
    sourceEvents: Array.isArray(item.sourceEvents) ? item.sourceEvents.slice(0, 8) : []
  })).filter(item => item.preference);
  agent.semanticMemory ||= {};
  Object.entries(agent.structuredMemory).forEach(([type, items]) => {
    if (!Array.isArray(agent.semanticMemory[type])) agent.semanticMemory[type] = [];
    const existing = new Set(agent.semanticMemory[type].map(item => item.id || item.text));
    items.forEach(item => {
      const key = item.id || item.text;
      if (existing.has(key)) return;
      agent.semanticMemory[type].push({ ...item });
      existing.add(key);
    });
    agent.semanticMemory[type] = agent.semanticMemory[type].slice(0, 40);
  });
  const vectors = Array.isArray(source.vectorMemory) ? source.vectorMemory : [];
  const existingVectors = Array.isArray(agent.vectorMemory) ? agent.vectorMemory : [];
  agent.vectorMemory = [...existingVectors, ...vectors.map((item, index) => ({
    ...item,
    id: item.id || `vec_${agent.id}_genesis_${index + 1}`,
    agentId: agent.id,
    scene: nameAware(item.scene || item.text || ""),
    text: nameAware(item.text || item.scene || ""),
    factAuthority: false
  }))].slice(0, 180);
  if (!agent.goal && source.goal) agent.goal = nameAware(source.goal);
  if (!agent.longTermGoals && agent.goal) {
    agent.longTermGoals = [{ title: agent.goal, progress: 0.2, priority: 0.55, horizon: "month" }];
  }
  agent.goalRuntime = source.goalRuntime || agent.goalRuntime || {
    goals: (agent.longTermGoals || []).slice(0, 3).map((goal, index) => ({
      id: goal.id || `goal_${agent.id}_${index + 1}`,
      name: goal.name || goal.title || agent.goal || "维持稳定生活",
      title: goal.title || goal.name || agent.goal || "维持稳定生活",
      priority: clamp01(goal.priority, 0.55),
      progress: clamp01(goal.progress, 0.2),
      frustration: clamp01(goal.frustration, 0),
      lastProgressTime: goal.lastProgressTime || 0,
      blockedBy: Array.isArray(goal.blockedBy) ? goal.blockedBy.slice(0, 6) : []
    })),
    updatedAt: 0,
    source: "character-genesis-v3.1.5"
  };
  agent.agentSchemaVersion = "3.1.5";
  agent.characterGenesis = {
    version: "v3.1.5",
    source: source.source || "CharacterSeedAgent",
    roleKind: source.roleKind || roleKind(agent.job),
    ageStage: source.ageStage || agent.ageStage || ageStageFromYears(agent.ageYears),
    createdAt: source.createdAt || ""
  };
  return agent;
}

function mergeCharacterSeeds(agents = [], seeds = []) {
  const byId = new Map((Array.isArray(seeds) ? seeds : []).map(seed => [seed.id, seed]));
  const output = (Array.isArray(agents) ? agents : []).map(agent => mergeCharacterSeed(agent, byId.get(agent.id) || {}));
  return { agents: output, seedCount: byId.size };
}

function relationshipExpectation(type = "", relation = {}) {
  const text = String(type || relation.type || "").toLowerCase();
  if (/family|guardian|家|照顾|监护/.test(text)) return "互相照应";
  if (/class|student|teacher|同学|师生|学校/.test(text)) return "维持学习和提醒";
  if (/cowork|work|同事|同行/.test(text)) return "合作完成日常责任";
  if (/neighbor|邻|同住/.test(text)) return "保持熟人边界和必要照应";
  if (/regular|shop|熟客|顾客/.test(text)) return "维持熟人往来";
  return "保持基本熟悉和有限信任";
}

function applyRelationshipIntents(agents = []) {
  const byId = new Map((Array.isArray(agents) ? agents : []).map(agent => [agent.id, agent]));
  agents.forEach(agent => {
    const rels = agent.relationshipMatrix || {};
    agent.relationshipIntent = Object.entries(rels)
      .map(([targetId, relation]) => {
        const target = byId.get(targetId);
        if (!target) return null;
        return {
          with: targetId,
          name: target.name || targetId,
          reason: compact(relation.type || "熟人", "熟人", 60),
          expectation: relationshipExpectation(relation.type, relation),
          trust: clamp(relation.trust, 0, 100, 50),
          intimacy: clamp(relation.intimacy, 0, 100, 35)
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b.trust + b.intimacy) - (a.trust + a.intimacy))
      .slice(0, 12);
  });
  return agents;
}

const GENESIS_REBUILD_KEYS = [
  "identityCore",
  "personalityProfile",
  "selfModel",
  "cognitiveProfile",
  "decisionWeights",
  "behaviorTendency",
  "lifeHistorySeed",
  "lifeHistory",
  "initialBeliefs",
  "initialHabits",
  "preferences",
  "episodicMemory",
  "beliefMemory",
  "habitMemory",
  "preferenceMemory",
  "goalRuntime",
  "structuredMemory",
  "semanticMemory",
  "vectorMemory",
  "characterGenesis"
];

function hasAnyText(value, terms = []) {
  const text = JSON.stringify(value || "");
  return terms.some(term => text.includes(term));
}

function roleAllowsSchoolMemory(role) {
  return role === "student" || role === "teacher";
}

function genesisNeedsRebuild(agent = {}, role = "", stage = "") {
  const previousRole = agent.characterGenesis?.roleKind || agent.roleKind || "";
  const previousStage = agent.characterGenesis?.ageStage || agent.ageStage || "";
  if (previousRole && previousRole !== role) return true;
  if (previousStage && previousStage !== stage) return true;
  const genesisText = {
    identityCore: agent.identityCore,
    selfModel: agent.selfModel,
    lifeHistorySeed: agent.lifeHistorySeed,
    beliefMemory: agent.beliefMemory,
    habitMemory: agent.habitMemory,
    preferenceMemory: agent.preferenceMemory,
    episodicMemory: agent.episodicMemory
  };
  if (!roleAllowsSchoolMemory(role) && hasAnyText(genesisText, ["课程", "作业", "同学", "学习安排", "学校安排"])) return true;
  return false;
}

function clearGenesisFields(agent = {}) {
  GENESIS_REBUILD_KEYS.forEach(key => {
    delete agent[key];
  });
  return agent;
}

function placeText(place = {}) {
  return `${place.id || ""} ${place.name || ""} ${place.type || ""}`.toLowerCase();
}

function findPlaceId(places = [], terms = []) {
  const found = places.find(place => terms.some(term => placeText(place).includes(term)));
  return found?.id || "";
}

function placeHas(place = {}, terms = []) {
  const text = placeText(place);
  return terms.some(term => text.includes(term));
}

function preferredPlaceForRole(role = "", stage = "", places = []) {
  if (role === "student" || role === "teacher") return findPlaceId(places, ["school", "学校", "小学", "中学", "校园"]);
  if (role === "medical") return findPlaceId(places, ["clinic", "诊所", "医院", "卫生"]);
  if (role === "service") return findPlaceId(places, ["store", "shop", "market", "breakfast", "小卖", "商店", "市场", "早餐", "摊"]);
  if (role === "security") return findPlaceId(places, ["office", "square", "镇务", "办公", "广场"]);
  if (role === "worker") return findPlaceId(places, ["office", "factory", "办公", "工厂", "单位"]) || findPlaceId(places, ["apartment", "home", "居民", "住宅"]);
  if (role === "elder" || stage === "elder") return findPlaceId(places, ["apartment", "home", "居民", "住宅"]) || findPlaceId(places, ["square", "广场", "公园"]);
  return findPlaceId(places, ["apartment", "home", "居民", "住宅"]) || findPlaceId(places, ["square", "广场"]);
}

function normalizeInitialPlace(agent = {}, role = "", stage = "", places = [], issues = []) {
  const currentId = agent.place || agent.position;
  const current = places.find(place => place.id === currentId);
  if (!current) return;
  const atSchool = placeHas(current, ["school", "学校", "小学", "中学", "校园"]);
  const atClinic = placeHas(current, ["clinic", "诊所", "医院", "卫生"]);
  const shouldMoveFromSchool = atSchool && !roleAllowsSchoolMemory(role);
  const shouldMoveFromClinic = atClinic && role !== "medical" && role !== "elder" && stage !== "elder";
  const serviceAtClinic = atClinic && role === "service";
  if (!shouldMoveFromSchool && !shouldMoveFromClinic && !serviceAtClinic) return;
  const fallback = preferredPlaceForRole(role, stage, places);
  if (!fallback || fallback === currentId) return;
  issues.push({
    type: "role_place_mismatch",
    agentId: agent.id,
    severity: "medium",
    note: `${currentId} -> ${fallback}`
  });
  agent.place = fallback;
  agent.position = fallback;
}

function runCharacterConsistencyAgent(agents = [], context = {}) {
  const places = Array.isArray(context.places) ? context.places : [];
  const placeIds = new Set(places.map(place => place.id).filter(Boolean));
  const issues = [];
  const fixed = (Array.isArray(agents) ? agents : []).map((agent, index) => {
    const next = { ...agent };
    const age = num(next.ageYears || next.age, 36);
    const stage = ageStageFromYears(age);
    const role = roleKind(next.job);
    const rebuildGenesis = genesisNeedsRebuild(next, role, stage);
    next.ageYears = clamp(age, 1, 100, 36);
    next.ageStage = stage;
    if (placeIds.size && !placeIds.has(next.place || next.position)) {
      const fallback = places[index % places.length]?.id || "square";
      issues.push({ type: "invalid_place", agentId: next.id, severity: "medium", note: `${next.place || next.position} -> ${fallback}` });
      next.place = fallback;
      next.position = fallback;
    }
    if (stage === "child" && !/student|学生|儿童|孩子|小学/.test(String(next.job || "").toLowerCase())) {
      issues.push({ type: "age_job_mismatch", agentId: next.id, severity: "low", note: "child job normalized toward student-like role" });
      next.job = next.job || "学生";
    }
    if ((role === "medical" || role === "teacher" || role === "security") && stage === "child") {
      issues.push({ type: "age_job_mismatch", agentId: next.id, severity: "medium", note: "professional role is too young" });
    }
    normalizeInitialPlace(next, role, stage, places, issues);
    const seed = characterSeedForSlot({
      id: next.id,
      index,
      roleHint: next.job,
      ageYears: next.ageYears,
      existing: next
    }, context);
    if (rebuildGenesis) {
      issues.push({ type: "genesis_role_mismatch", agentId: next.id, severity: "medium", note: `rebuilt ${next.characterGenesis?.roleKind || next.roleKind || "unknown"} -> ${role}` });
      clearGenesisFields(next);
    }
    mergeCharacterSeed(next, seed);
    if (!next.longTermGoals || !Array.isArray(next.longTermGoals) || !next.longTermGoals.length) {
      next.longTermGoals = [{ title: next.goal || seed.goal || "维持稳定生活", progress: 0.2, priority: 0.55, horizon: "month" }];
    }
    return next;
  });
  applyRelationshipIntents(fixed);
  return {
    agents: fixed,
    issues,
    logs: [{ title: "CharacterConsistencyAgent", body: `checked ${fixed.length} agents, issues ${issues.length}` }]
  };
}

module.exports = {
  ageStageFromYears,
  roleKind,
  characterSeedForSlot,
  buildCharacterSeeds,
  mergeCharacterSeed,
  mergeCharacterSeeds,
  applyRelationshipIntents,
  runCharacterConsistencyAgent
};

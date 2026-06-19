"use strict";

const {
  actionVector,
  realityConstraint,
  dotProduct
} = require("./ai-town-cognitive-state");
const { pickWithExploration } = require("./ai-town-cognitive-integrity");

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
  return JSON.stringify(value);
}

function includesAny(text, words) {
  const value = String(text || "").toLowerCase();
  return words.some(word => value.includes(String(word).toLowerCase()));
}

function psychologicalStateFrom(value = {}, extras = {}) {
  if (extras?.psychologicalState) return extras.psychologicalState;
  if (extras?.cognitiveState?.psychologicalState) return extras.cognitiveState.psychologicalState;
  if (value?.psychologicalState) return value.psychologicalState;
  if (value?.projection && (value.driveVector || value.needsVector || value.biasVector)) return value;
  return null;
}

function requirePsychologicalState(name, value = {}, extras = {}) {
  const state = psychologicalStateFrom(value, extras);
  if (!state) throw new Error("V3.4.2.1 " + name + " requires psychologicalState");
  return state;
}

function runtimeContextFromState(state = {}) {
  return state.projection?.runtimeContext || {};
}

function agentIdFromState(state = {}) {
  return String(state.agentId || state.projection?.runtimeContext?.agentId || "");
}

function maxVectorValue(vector = {}) {
  return Object.values(vector || {}).reduce((max, value) => Math.max(max, clamp(value, 0, 1.5, 0)), 0);
}

function agentPriority(state = {}, _agent = {}, extras = {}) {
  const psychologicalState = requirePsychologicalState("agentPriority", state, extras);
  const projection = psychologicalState.projection || {};
  const runtimeContext = runtimeContextFromState(psychologicalState);
  const components = {
    need: maxVectorValue(psychologicalState.needsVector || {}) * 38,
    drive: maxVectorValue(psychologicalState.driveVector || {}) * 30,
    emotion: clamp(num(projection.emotionalLoad, 0), 0, 1, 0) * 18,
    social: clamp(num(projection.socialNeed, 0), 0, 1, 0) * 10,
    goal: clamp(num(projection.goalPressure, 0), 0, 1, 0) * 12,
    crisis: runtimeContext.interruption?.canOverridePlan ? clamp(num(runtimeContext.interruption.priority, 0), 0, 100, 0) * 0.55 : 0
  };
  const priority = Math.round(Object.values(components).reduce((sum, value) => sum + value, 0));
  const reason = Object.entries(components).sort((a, b) => b[1] - a[1])[0]?.[0] || "psychologicalState";
  return { priority, components, reason, interruption: runtimeContext.interruption || null, source: "psychologicalState" };
}

function legacyCandidateActions(state = {}, _agent = {}, extras = {}) {
  const psychologicalState = requirePsychologicalState("legacyCandidateActions", state, extras);
  return candidateActions(psychologicalState);
}

function lifeStageOf(state = {}) {
  return runtimeContextFromState(psychologicalStateFrom(state) || state).stage || "adult";
}

function professionKind(state = {}) {
  return runtimeContextFromState(psychologicalStateFrom(state) || state).profession || "resident";
}

function isDependentAdult(state = {}) {
  return Boolean(runtimeContextFromState(psychologicalStateFrom(state) || state).relationship?.dependent);
}

function businessPlaceId(place = "") {
  return /breakfast|shop|store|market|restaurant|bakery|小卖部|早餐|商店|店|市场|餐馆|面包/.test(String(place || "").toLowerCase());
}

function clinicPlaceId(place = "") {
  return /clinic|hospital|medical|诊所|医院|卫生/.test(String(place || "").toLowerCase());
}

function schoolPlaceId(place = "") {
  return /school|class|campus|学校|教室|课堂/.test(String(place || "").toLowerCase());
}

function emergencyStateFromContext(context = {}) {
  const interruption = context.interruption || null;
  return {
    health: interruption?.type === "health",
    safety: interruption?.type === "safety",
    hunger: interruption?.type === "hunger",
    any: Boolean(interruption?.canOverridePlan)
  };
}

const actionConstraintRegistry = {
  continue_process: { ageRule: ["child", "teen", "adult", "elder"], identityRule: "has active process", locationRule: "current process location", relationshipRule: "none", emergencyRule: "can be interrupted only by crisis" },
  seek_care: { ageRule: ["child", "teen", "adult", "elder"], identityRule: "all", locationRule: "clinic reachable", relationshipRule: "none", emergencyRule: "health raises priority" },
  seek_safety: { ageRule: ["child", "teen", "adult", "elder"], identityRule: "all", locationRule: "safe place reachable", relationshipRule: "none", emergencyRule: "safety raises priority" },
  eat_or_buy_food: { ageRule: ["child", "teen", "adult", "elder"], identityRule: "all", locationRule: "food reachable or reasonable window", relationshipRule: "none", emergencyRule: "hunger can override routine" },
  rest: { ageRule: ["child", "teen", "adult", "elder"], identityRule: "all", locationRule: "rest-capable place preferred", relationshipRule: "none", emergencyRule: "fatigue or health raises priority" },
  tidy_or_clean: { ageRule: ["teen", "adult", "elder"], identityRule: "basic self-care capable", locationRule: "current place allows small tidying", relationshipRule: "none", emergencyRule: "blocked by urgent crisis" },
  contact_familiar: { ageRule: ["child", "teen", "adult", "elder"], identityRule: "has or can reasonably contact familiar person", locationRule: "communication possible", relationshipRule: "familiar relationship preferred", emergencyRule: "support can respond to crisis" },
  follow_plan: { ageRule: ["child", "teen", "adult", "elder"], identityRule: "has current plan", locationRule: "plan location", relationshipRule: "none", emergencyRule: "health/safety crisis may override" },
  observe_environment: { ageRule: ["child", "teen", "adult", "elder"], identityRule: "all", locationRule: "current visible environment", relationshipRule: "none", emergencyRule: "safe fallback action" },
  think_and_plan: { ageRule: ["child", "teen", "adult", "elder"], identityRule: "all", locationRule: "any", relationshipRule: "none", emergencyRule: "safe fallback action" },
  walk_nearby: { ageRule: ["teen", "adult", "elder"], identityRule: "can move independently", locationRule: "safe walkable place", relationshipRule: "none", emergencyRule: "blocked by safety crisis" },
  return_home: { ageRule: ["child", "teen", "adult", "elder"], identityRule: "all", locationRule: "home reachable", relationshipRule: "none", emergencyRule: "safety/comfort action" },
  follow_stranger: { ageRule: ["adult"], identityRule: "investigator/security/artist adult only", locationRule: "public visible target", relationshipRule: "none", emergencyRule: "blocked by severe safety crisis" },
  ask_guardian: { ageRule: ["child", "teen", "dependentAdult"], identityRule: "dependent role only", locationRule: "communication possible", relationshipRule: "guardian or high-dependency trusted relation", emergencyRule: "support action" },
  record_observation: { ageRule: ["teen", "adult", "elder"], identityRule: "observer/artist/investigator or safe observer", locationRule: "visible environment", relationshipRule: "none", emergencyRule: "blocked by severe crisis for dependents" },
  provide_care: { ageRule: ["adult", "elder"], identityRule: "medical profession only", locationRule: "clinic or medical duty", relationshipRule: "service relation", emergencyRule: "allowed for care duty" },
  serve_customers: { ageRule: ["adult", "elder"], identityRule: "merchant profession only", locationRule: "business place", relationshipRule: "customer context", emergencyRule: "blocked by personal health/safety crisis" },
  check_inventory: { ageRule: ["adult", "elder"], identityRule: "merchant profession only", locationRule: "business place", relationshipRule: "none", emergencyRule: "blocked by personal crisis" }
};

function actionConstraintsFor(actionId = "") {
  return actionConstraintRegistry[actionId] || { ageRule: ["child", "teen", "adult", "elder"], identityRule: "all", locationRule: "any", relationshipRule: "none", emergencyRule: "none" };
}

function shouldAskGuardian(state = {}) {
  const stage = lifeStageOf(state);
  if (stage === "child" || stage === "teen") return true;
  return isDependentAdult(state);
}

function professionEligibilityBias(_state = {}, action = {}, context = {}) {
  const profession = context.profession || "resident";
  const stage = context.stage || "adult";
  let bias = 0;
  if (profession === "medical" && ["seek_care", "provide_care"].includes(action.id)) bias += 6;
  if (profession === "merchant" && ["serve_customers", "check_inventory"].includes(action.id)) bias += 8;
  if (profession === "merchant" && action.id === "follow_plan") bias += 3;
  if (profession === "teacher" && action.id === "follow_plan") bias += 4;
  if (profession === "security" && ["seek_safety", "observe_environment"].includes(action.id)) bias += 4;
  if (profession === "investigator" && ["observe_environment", "follow_stranger", "record_observation"].includes(action.id)) bias += 5;
  if (profession === "artist" && ["record_observation", "observe_environment"].includes(action.id)) bias += 4;
  if ((stage === "child" || stage === "teen") && ["ask_guardian", "seek_safety", "follow_plan"].includes(action.id)) bias += 4;
  if (stage === "elder" && ["seek_care", "seek_safety", "rest", "return_home"].includes(action.id)) bias += 4;
  if (stage === "adult" && ["follow_plan", "contact_familiar"].includes(action.id)) bias += 2;
  return bias;
}

function actionEligibility(S = {}, candidate = {}) {
  const legacy = arguments.length >= 4;
  const action = legacy ? arguments[2] : candidate;
  const extras = legacy ? (arguments[3] || {}) : (arguments[2] || {});
  const state = psychologicalStateFrom(S, extras);
  const runtimeContext = extras.runtimeContext || state?.projection?.runtimeContext || null;
  if (!runtimeContext) {
    return {
      allowed: false,
      reason: "missing S(t) runtimeContext",
      reasons: ["missing S(t) runtimeContext"],
      constraints: action.actionConstraints || actionConstraintsFor(action.id),
      stage: "unknown",
      profession: "unknown",
      bias: 0
    };
  }
  const constraints = action.actionConstraints || actionConstraintsFor(action.id);
  const stage = runtimeContext.stage || "adult";
  const profession = runtimeContext.profession || "resident";
  const currentPlace = runtimeContext.currentPlace || "";
  const plan = runtimeContext.plan || null;
  const interruption = runtimeContext.interruption || null;
  const profile = runtimeContext.profile || {};
  const taskState = runtimeContext.taskState || {};
  const emergency = emergencyStateFromContext(runtimeContext);
  const reasons = [];
  const deny = reason => ({ allowed: false, reason, reasons: [reason], constraints, stage, profession, bias: 0 });
  if (runtimeContext.lifeStatus === "dead" || runtimeContext.terminalDead) return deny("dead agent");
  if (action.id === "continue_process" && !runtimeContext.activeProcess) return deny("no active process");
  if (action.id === "follow_plan" && !plan) return deny("no current plan");
  if (action.id === "ask_guardian" && !(stage === "child" || stage === "teen" || runtimeContext.relationship?.dependent)) return deny("not child, teen, or dependent adult");
  if (action.id === "follow_stranger") {
    if (stage !== "adult") return deny("only independent adults may consider following a stranger");
    if (!["investigator", "security", "artist"].includes(profession) && num(profile.curiosity, 0.5) < 0.78) return deny("identity is not investigator/security/observer");
    if (emergency.safety || num(interruption?.priority, 0) >= 75) return deny("safety crisis blocks following stranger");
  }
  if (action.id === "provide_care") {
    if (profession !== "medical") return deny("not medical profession");
    if (!clinicPlaceId(currentPlace) && !clinicPlaceId(plan?.place || "") && !taskState.medicalDuty) {
      return deny("not at clinic or medical duty context");
    }
  }
  if (["serve_customers", "check_inventory"].includes(action.id)) {
    if (profession !== "merchant") return deny("not merchant profession");
    if (!businessPlaceId(currentPlace) && !businessPlaceId(plan?.place || "") && !taskState.businessDuty) {
      return deny("not at business place or business duty context");
    }
    if (emergency.health || emergency.safety) return deny("personal health or safety crisis blocks business duty");
  }
  if (action.id === "walk_nearby") {
    if (stage === "child") return deny("child cannot independently wander");
    if (emergency.safety) return deny("safety crisis blocks walking nearby");
    if ((stage === "teen" || profession === "student") && plan?.fixed && /study|class|school|上课|学习/.test(String(plan.localAction || plan.title || ""))) {
      return deny("student fixed class blocks wandering");
    }
  }
  if (action.id === "eat_or_buy_food" && (stage === "child" || stage === "teen" || profession === "student")) {
    if (plan?.fixed && /study|class|school|上课|学习/.test(String(plan.localAction || plan.title || "")) && !emergency.hunger) {
      return deny("student fixed class blocks ordinary eating");
    }
  }
  if (action.id === "record_observation") {
    if (stage === "child") return deny("child observation should use observe_environment or ask_guardian");
    if (emergency.safety && !["investigator", "security"].includes(profession)) return deny("safety crisis blocks recording observation");
  }
  if (action.id === "tidy_or_clean" && stage === "child") return deny("child should not be assigned independent cleaning action");
  if (action.id === "tidy_or_clean" && !/apartment|home|clinic|school|shop|store|breakfast|office|business/.test(String(currentPlace || "").toLowerCase())) {
    return deny("current place does not support tidying or cleaning");
  }
  reasons.push("eligible");
  const bias = professionEligibilityBias(null, action, { stage, profession });
  return {
    allowed: true,
    reason: reasons.join("; "),
    reasons,
    constraints,
    stage,
    profession,
    bias,
    rule: "Eligibility removes impossible actions before cognitive scoring."
  };
}

function filterEligibleActions(S = {}, actions = []) {
  const legacy = arguments.length >= 4;
  const list = legacy ? arguments[2] : actions;
  const extras = legacy ? (arguments[3] || {}) : (arguments[2] || {});
  const state = psychologicalStateFrom(S, extras) || (extras.runtimeContext ? { projection: { runtimeContext: extras.runtimeContext } } : null);
  const runtimeContext = extras.runtimeContext || state?.projection?.runtimeContext || null;
  if (!runtimeContext) throw new Error("V3.4.2 action eligibility requires S(t) runtimeContext");
  const allowed = [];
  const removed = [];
  list.forEach(action => {
    const check = actionEligibility(state, action, { runtimeContext });
    if (check.allowed) {
      allowed.push({
        ...action,
        actionConstraints: check.constraints,
        eligibility: check,
        eligibilityBias: check.bias
      });
    } else {
      removed.push({
        id: action.id,
        label: action.label,
        reason: check.reason,
        constraints: check.constraints,
        stage: check.stage,
        profession: check.profession
      });
    }
  });
  return {
    actions: dedupeActions(allowed),
    removed,
    rawCount: list.length,
    eligibleCount: allowed.length,
    invalidActionRate: 0,
    rule: "Invalid actions are removed before Cognitive Score and Softmax."
  };
}

function candidateActions(S = {}) {
  const extras = arguments.length >= 3 ? (arguments[2] || {}) : (arguments[1] || {});
  const state = psychologicalStateFrom(S, extras);
  if (!state) throw new Error("V3.4.2 candidateActions requires psychologicalState");
  const drives = state.driveVector || {};
  const needs = state.needsVector || {};
  const bias = state.biasVector || {};
  const actions = [];
  const push = action => {
    const item = {
      id: action.id,
      label: action.label,
      type: action.type || "observe",
      targetNeed: action.targetNeed || "",
      targetPlace: action.targetPlace || "",
      tags: action.tags || [],
      base: num(action.base, 0),
      cost: num(action.cost, 0),
      risk: num(action.risk, 0),
      availability: action.availability,
      distance: action.distance,
      reason: action.reason || "",
      source: ["S_state"],
      features: action.features || {
        urgency: num(action.urgency, 0),
        relevance: num(action.relevance, 0),
        feasibility: num(action.availability, 1)
      },
      actionConstraints: action.actionConstraints || actionConstraintsFor(action.id)
    };
    item.actionVector = action.actionVector || actionVector(item);
    actions.push(item);
  };
  const urge = key => clamp(num(drives[key], 0), 0, 1.5, 0);
  const need = key => clamp(num(needs[key], 0), 0, 1, 0);
  const relevanceFrom = (...keys) => clamp(keys.reduce((max, key) => Math.max(max, urge(key), need(key)), 0), 0, 1, 0);
  const maybePush = (condition, action) => {
    if (condition) push({
      ...action,
      urgency: action.urgency ?? relevanceFrom(action.targetNeed, ...(action.tags || [])),
      relevance: action.relevance ?? relevanceFrom(...(action.tags || []), action.targetNeed),
      availability: action.availability ?? 1
    });
  };
  if (urge("duty") > 0.12 || urge("order") > 0.12) {
    push({ id: "continue_process", label: "continue unfinished process", type: "react", tags: ["process", "responsibility", "duty"], base: 12, urgency: urge("duty"), relevance: urge("duty"), reason: "S_state" });
  }
  maybePush(urge("care") > 0.08 || need("health") > 0.15, { id: "seek_care", label: "handle health condition", type: "move", targetNeed: "health", targetPlace: "clinic", tags: ["health", "care", "help"], base: 8, cost: 12, risk: 6, reason: "S_state" });
  maybePush(urge("safety") > 0.08 || need("safety") > 0.12, { id: "seek_safety", label: "move to a safer place", type: "move", targetNeed: "safety", targetPlace: "apartment", tags: ["safety", "home"], base: 8, cost: 10, risk: 4, reason: "S_state" });
  maybePush(urge("food") > 0.08 || need("hunger") > 0.12, { id: "eat_or_buy_food", label: "find food or eat", type: "move", targetNeed: "hunger", targetPlace: "breakfast", tags: ["hunger", "food"], base: 7, cost: 8, risk: 2, reason: "S_state" });
  maybePush(urge("comfort") > 0.08 || urge("recovery") > 0.08 || need("comfort") > 0.12, { id: "rest", label: "rest and recover", type: "wait", targetNeed: "comfort", targetPlace: "apartment", tags: ["rest", "tired", "comfort"], base: 7, cost: 4, reason: "S_state" });
  maybePush(urge("order") > 0.08 || need("hygiene") > 0.12, { id: "tidy_or_clean", label: "tidy and clean up", type: "react", targetNeed: "hygiene", tags: ["clean", "tidy", "comfort"], base: 5, cost: 4, reason: "S_state" });
  maybePush(urge("social") > 0.08 || urge("support") > 0.08 || need("social") > 0.12, { id: "contact_familiar", label: "contact a familiar person", type: "talk", targetNeed: "social", tags: ["social", "relationship", "help"], base: 6, cost: 7, reason: "S_state" });
  maybePush(urge("duty") > 0.08 || urge("order") > 0.08, { id: "follow_plan", label: "continue daily plan", type: "work", tags: ["plan", "responsibility", "duty"], base: 10, cost: 5, reason: "S_state" });
  maybePush(urge("observe") > 0.08 || urge("curiosity") > 0.08 || num(bias.noveltySeeking, 0) > 0.25, { id: "observe_environment", label: "observe environment", type: "observe", tags: ["observe", "low_risk"], base: 6, cost: 1, reason: "S_state" });
  maybePush(urge("order") > 0.08 || urge("duty") > 0.08, { id: "think_and_plan", label: "think and adjust plan", type: "plan", tags: ["think", "goal", "order"], base: 6, cost: 2, reason: "S_state" });
  maybePush(urge("curiosity") > 0.16 || num(bias.noveltySeeking, 0) > 0.42, { id: "walk_nearby", label: "walk nearby", type: "move", tags: ["walk", "comfort", "explore", "curiosity"], base: 4, cost: 6, risk: 3, reason: "S_state" });
  maybePush(urge("home") > 0.08 || urge("safety") > 0.12 || urge("comfort") > 0.12, { id: "return_home", label: "return home", type: "move", targetPlace: "apartment", tags: ["home", "safety", "comfort"], base: 9, cost: 5, risk: 2, reason: "S_state" });
  maybePush(urge("curiosity") > 0.3 && num(bias.riskTolerance, 0.5) > 0.45, { id: "follow_stranger", label: "follow and observe from distance", type: "move", tags: ["observe", "novelty", "risk", "curiosity"], base: 3, cost: 9, risk: 16, availability: 0.45, reason: "S_state" });
  maybePush(urge("support") > 0.16 || num(bias.supportSeeking, 0) > 0.32, { id: "ask_guardian", label: "ask a trusted guardian or familiar adult", type: "talk", tags: ["support", "social", "safety"], base: 7, cost: 5, risk: 2, reason: "S_state" });
  maybePush(urge("observe") > 0.16 || urge("curiosity") > 0.16, { id: "record_observation", label: "record observation", type: "observe", tags: ["observe", "novelty", "art", "curiosity"], base: 4, cost: 3, risk: 4, reason: "S_state" });
  maybePush(urge("care") > 0.12 || urge("duty") > 0.12, { id: "provide_care", label: "handle medical or care duty", type: "work", targetPlace: "clinic", tags: ["medical", "care", "work", "profession", "duty"], base: 6, cost: 6, risk: 4, availability: 0.75, reason: "S_state" });
  maybePush(urge("duty") > 0.12 || urge("social") > 0.12, { id: "serve_customers", label: "handle shop customers", type: "work", tags: ["business", "customer", "work", "profession", "duty", "social"], base: 6, cost: 5, risk: 2, availability: 0.72, reason: "S_state" });
  maybePush(urge("order") > 0.12 || urge("duty") > 0.1, { id: "check_inventory", label: "check stock and supplies", type: "react", tags: ["business", "restock", "order", "profession"], base: 5, cost: 4, risk: 1, availability: 0.75, reason: "S_state" });
  return dedupeActions(actions);
}

function dedupeActions(actions = []) {
  const seen = new Set();
  return actions.filter(action => {
    if (!action?.id || seen.has(action.id)) return false;
    seen.add(action.id);
    return true;
  });
}

function relevance(text, action) {
  const source = String(text || "").toLowerCase();
  const tags = [action.id, action.label, action.targetNeed, action.targetPlace, ...(action.tags || [])].filter(Boolean);
  if (!source || !tags.length) return 0;
  let hits = 0;
  tags.forEach(tag => {
    if (source.includes(String(tag).toLowerCase())) hits += 1;
  });
  const cnHints = {
    rest: ["累", "疲惫", "休息", "安静", "恢复"],
    seek_care: ["健康", "身体", "诊所", "医生", "不适"],
    seek_safety: ["安全", "风险", "避开", "害怕"],
    eat_or_buy_food: ["饱腹", "吃饭", "早餐", "食物", "饿"],
    contact_familiar: ["朋友", "家人", "信任", "求助", "聊天"],
    follow_plan: ["职责", "工作", "上课", "计划", "责任"],
    think_and_plan: ["目标", "未来", "计划", "思考"]
  }[action.id] || [];
  cnHints.forEach(word => {
    if (source.includes(word)) hits += 1;
  });
  return clamp(hits / Math.max(1, tags.length / 2), 0, 1, 0);
}

function structuredMemoryBias(state = {}, action = {}, _world = {}) {
  const psychologicalState = requirePsychologicalState("structuredMemoryBias", state);
  const features = stateUtilityFeatures(psychologicalState, action);
  return {
    score: Number((features.MemoryBias * 10).toFixed(2)),
    details: [{ source: "psychologicalState.projection.memoryActivation", bias: Number((features.MemoryBias * 10).toFixed(2)) }]
  };
}

function personalityBias(state = {}, action = {}) {
  const psychologicalState = requirePsychologicalState("personalityBias", state);
  const vector = action.actionVector || actionVector(action);
  const bias = psychologicalState.biasVector || {};
  const value = clamp(
    num(vector.curiosity, 0) * num(bias.noveltySeeking, 0)
      + num(vector.safety, 0) * (1 - num(bias.riskTolerance, 0.5))
      + num(vector.duty, 0) * num(bias.goalPersistence, 0.5),
    0,
    1.5,
    0
  );
  return Number((value * 10).toFixed(2));
}

function emotionBias(state = {}, action = {}) {
  const psychologicalState = requirePsychologicalState("emotionBias", state);
  const vector = action.actionVector || actionVector(action);
  const emotions = psychologicalState.emotionVector || {};
  const value = clamp(
    num(vector.recovery, 0) * num(emotions.tired, 0)
      + num(vector.social, 0) * num(emotions.lonely, 0)
      + num(vector.safety, 0) * num(emotions.anxious, 0),
    0,
    1.5,
    0
  );
  return Number((value * 10).toFixed(2));
}

function socialBias(state = {}, _agent = {}, action = {}) {
  const psychologicalState = requirePsychologicalState("socialBias", state);
  const features = stateUtilityFeatures(psychologicalState, action);
  return Number((features.SocialField * 10).toFixed(2));
}

function relationshipMemoryBias(state = {}, action = {}) {
  const psychologicalState = requirePsychologicalState("relationshipMemoryBias", state);
  const features = stateUtilityFeatures(psychologicalState, action);
  return {
    score: Number((features.SocialField * 10).toFixed(2)),
    details: [{ source: "psychologicalState.projection.socialNeed", bias: Number((features.SocialField * 10).toFixed(2)) }]
  };
}

function needDrive(state = {}, action = {}) {
  const psychologicalState = requirePsychologicalState("needDrive", state);
  const need = action.targetNeed;
  const drive = need ? clamp(num(psychologicalState.needsVector?.[need], 0), 0, 1, 0) : maxVectorValue(psychologicalState.needsVector || {});
  return Number((drive * 55).toFixed(2));
}

function contextFit(state = {}, _agent = {}, action = {}, _extras = {}) {
  const psychologicalState = requirePsychologicalState("contextFit", state);
  const runtimeContext = runtimeContextFromState(psychologicalState);
  let score = 0;
  if (action.targetPlace && action.targetPlace === runtimeContext.currentPlace) score += 8;
  if (runtimeContext.plan && action.id === "follow_plan") score += runtimeContext.plan.fixed ? 26 : 14;
  if (runtimeContext.activeProcess && action.id === "continue_process") score += 35;
  return score;
}

function vectorBonus(_vectorRecall = [], _action = {}) {
  return { raw: 0, details: [], source: "disabled-v3.4.2.1-closure" };
}

function cognitiveFitForAction(cognitive = {}, action = {}) {
  const desires = Array.isArray(cognitive.desireCandidates) ? cognitive.desireCandidates : [];
  if (!desires.length || !action?.id) return 0;
  let total = 0;
  let max = 0;
  desires.forEach(desire => {
    const hints = Array.isArray(desire.actionHints) ? desire.actionHints : [];
    const hinted = hints.includes(action.id) ? 0.9 : 0;
    const semantic = relevance(`${desire.desire || ""} ${desire.id || ""} ${desire.source || ""}`, action) * 0.7;
    const fit = Math.max(hinted, semantic) * clamp(num(desire.intensity, 0), 0, 1, 0);
    total += fit;
    max = Math.max(max, fit);
  });
  return Number(clamp(max * 0.68 + (total / Math.max(1, desires.length)) * 0.32, 0, 1, 0).toFixed(3));
}

function unifiedUtilityWeights(cognitive = {}) {
  return {
    need: 0.8,
    goal: 0.55,
    memory: 0.55,
    social: 0.35,
    causal: 0.08
  };
}

function explorationRateFromState(state = {}) {
  const projection = state.projection || {};
  const entropy = projection.behavioralEntropy || {};
  const pressure = projection.explorationPressure || {};
  const base = clamp(num(pressure.base, 0.05), 0, 0.25, 0.05);
  const threshold = clamp(num(pressure.threshold, 0.75), 0.4, 1, 0.75);
  const repeatRate = clamp(num(entropy.repeatRate, 0), 0, 1, 0);
  const curiosity = clamp(num(pressure.curiosityDrive, 0), 0, 1, 0);
  const uncertainty = clamp(num(pressure.uncertainty, 0), 0, 1, 0);
  const novelty = clamp(num(pressure.noveltyPressure, 0), 0, 1, 0);
  const entropyBoost = repeatRate > threshold ? (repeatRate - threshold) * 0.5 : 0;
  const pressureBoost = curiosity * 0.015 + uncertainty * 0.02 + novelty * 0.015;
  return Number(clamp(base + entropyBoost + pressureBoost, 0, 0.25, base).toFixed(4));
}

function stateUtilityFeatures(state = {}, action = {}) {
  const vector = action.actionVector || actionVector(action);
  const needs = state.needsVector || {};
  const drives = state.driveVector || {};
  const socialPressure = state.socialPressure || {};
  const projection = state.projection || {};
  const causal = projection.causal || {};
  const driveMatch = clamp(dotProduct(drives, vector) / 2.5, 0, 1, 0);
  const needScore = clamp(Math.max(
    action.targetNeed ? num(needs[action.targetNeed], 0) : 0,
    driveMatch
  ), 0, 1, 0);
  const goalAlignment = clamp(
    (num(vector.goal, 0) + num(vector.duty, 0) + num(vector.order, 0))
    * (num(projection.goalPressure, 0) * 0.55 + num(projection.selfPressure, 0) * 0.25 + 0.2),
    0,
    1,
    0
  );
  const memoryBias = clamp(
    (num(projection.memoryActivation, 0) * 0.5 + num(projection.beliefActivation, 0) * 0.35 + driveMatch * 0.15)
    * (0.75 + num(projection.emotionalLoad, 0) * 0.25),
    0,
    1,
    0
  );
  const socialField = clamp(
    num(vector.social, 0) * num(projection.socialNeed, 0)
    + num(vector.support, 0) * num(projection.socialNeed, 0) * 0.7
    + num(vector.safety, 0) * (num(socialPressure.fear, 0) + num(socialPressure.tension, 0)) * 0.5
    + (num(vector.observe, 0) + num(vector.curiosity, 0)) * (num(socialPressure.curiosity, 0) + num(socialPressure.information, 0)) * 0.35,
    0,
    1,
    0
  );
  const causalScore = clamp(
    num(vector.safety, 0) * num(causal.safetyBias, 0)
    + (num(vector.social, 0) + num(vector.support, 0)) * num(causal.socialBias, 0)
    + (num(vector.duty, 0) + num(vector.order, 0)) * num(causal.responsibilityBias, 0),
    0,
    1,
    0
  );
  return {
    Need: Number(needScore.toFixed(3)),
    GoalAlignment: Number(goalAlignment.toFixed(3)),
    MemoryBias: Number(memoryBias.toFixed(3)),
    SocialField: Number(socialField.toFixed(3)),
    CausalScore: Number(causalScore.toFixed(3))
  };
}

function memoryInfluenceAgent(state = {}, _agent = {}, extras = {}) {
  const psychologicalState = requirePsychologicalState("memoryInfluenceAgent", state, extras);
  const activation = clamp(num(psychologicalState.projection?.memoryActivation, 0), 0, 1, 0);
  return {
    agentId: agentIdFromState(psychologicalState),
    memoryBias: [],
    activation,
    rule: "V3.4.2.1 memory influence is only available through S(t).projection.memoryActivation."
  };
}

function memoryInfluenceBias(memoryInfluence = {}, action = {}) {
  const matches = (memoryInfluence.memoryBias || []).filter(item => item.action === action.id);
  if (!matches.length) return { score: 0, details: [] };
  const score = matches.reduce((sum, item) => sum + num(item.weight, 0), 0);
  return {
    score: Number(score.toFixed(2)),
    details: matches.slice(0, 4).map(item => ({
      action: item.action,
      weight: Number(item.weight || 0),
      reason: (item.reasons || [])[0] || "",
      sourceType: item.sourceType || "memory"
    }))
  };
}

function goalBias(state = {}, _agent = {}, action = {}) {
  const psychologicalState = requirePsychologicalState("goalBias", state);
  const features = stateUtilityFeatures(psychologicalState, action);
  return {
    score: Number((features.GoalAlignment * 10).toFixed(2)),
    details: [{ source: "psychologicalState.projection.goalPressure", bias: Number((features.GoalAlignment * 10).toFixed(2)) }],
    runtime: { source: "psychologicalState" }
  };
}

function selfConsistencyBias(state = {}, _agent = {}, action = {}, _extras = {}) {
  const psychologicalState = requirePsychologicalState("selfConsistencyBias", state);
  const features = stateUtilityFeatures(psychologicalState, action);
  const score = Number(((features.GoalAlignment * 0.55 + features.MemoryBias * 0.45) * 10).toFixed(2));
  return {
    score,
    details: [{ source: "psychologicalState.projection", bias: score }],
    selfModel: { source: "psychologicalState" }
  };
}

function scoreAction(S = {}, candidate = {}) {
  const legacy = arguments.length >= 4;
  const action = legacy ? arguments[2] : candidate;
  const extras = legacy ? (arguments[3] || {}) : (arguments[2] || {});
  const state = psychologicalStateFrom(S, extras);
  if (!state) throw new Error("V3.4.2 utility requires psychologicalState");
  const aVector = action.actionVector || actionVector(action);
  const features = stateUtilityFeatures(state, { ...action, actionVector: aVector });
  const weights = unifiedUtilityWeights();
  const weightTotal = Math.max(0.001, weights.need + weights.goal + weights.memory + weights.social + weights.causal);
  const unifiedU = (
    weights.need * features.Need
    + weights.goal * features.GoalAlignment
    + weights.memory * features.MemoryBias
    + weights.social * features.SocialField
    + weights.causal * features.CausalScore
  ) / weightTotal;
  const fitVector = {
    driveVector: state.driveVector || {},
    biasVector: state.biasVector || {},
    perceptionWeights: state.projection?.perceptionWeights || {}
  };
  const cognitiveFit = 0;
  const constraint = realityConstraint(fitVector, { ...action, actionVector: aVector }, {});
  const eligibilityBias = num(action.eligibilityBias || action.eligibility?.bias, 0);
  const noveltyValue = clamp((aVector.novelty || 0) * 0.55 + (aVector.curiosity || 0) * 0.35 + num(state.biasVector?.noveltySeeking, 0.35) * 0.35, 0, 1, 0.2);
  const feasibility = clamp(num(action.features?.feasibility, action.availability ?? constraint.value), 0.05, 1, 1);
  const score = (unifiedU * 0.88 + cognitiveFit * 0.08 + eligibilityBias / 100 * 0.04) * feasibility * constraint.value * 100;
  return {
    ...action,
    actionVector: aVector,
    score: Number(score.toFixed(2)),
    components: {
      base: action.base,
      cognitiveMatch: Number(dotProduct(state.driveVector || {}, aVector).toFixed(3)),
      cognitiveFit: Number((cognitiveFit * 10).toFixed(2)),
      cognitiveFitValue: Number(cognitiveFit.toFixed(3)),
      needDrive: Number((features.Need * 10).toFixed(2)),
      memoryBias: Number((features.MemoryBias * 10).toFixed(2)),
      structuredMemoryBias: 0,
      memoryInfluence: Number((features.MemoryBias * 10).toFixed(2)),
      personalityBias: 0,
      personaValue: 0,
      emotionBias: 0,
      emotionValue: 0,
      socialBias: Number((features.SocialField * 10).toFixed(2)),
      relationshipMemoryBias: 0,
      socialFieldBias: Number((features.SocialField * 10).toFixed(2)),
      socialFeedbackBias: 0,
      socialFeedbackGamma: 0,
      socialFeedbackWeighted: 0,
      socialFeedbackValue: 0,
      socialValue: features.SocialField,
      causalBias: Number((features.CausalScore * 10).toFixed(2)),
      causalValue: features.CausalScore,
      causalWeight: Number(weights.causal.toFixed(3)),
      goalBias: Number((features.GoalAlignment * 10).toFixed(2)),
      goalValue: features.GoalAlignment,
      selfConsistency: 0,
      eligibilityBias: Number(eligibilityBias.toFixed(2)),
      contextFit: 0,
      contextValue: 0,
      noveltyValue: Number(noveltyValue.toFixed(3)),
      vectorBonus: 0,
      compensatoryA: Number(unifiedU.toFixed(3)),
      unifiedUtility: Number(unifiedU.toFixed(3)),
      utilityFeatures: features,
      utilityWeights: weights,
      realityB: constraint.value,
      feasibility: Number(feasibility.toFixed(3)),
      noise: 0,
      cost: action.cost,
      risk: action.risk
    },
    memoryDetails: [],
    memoryInfluenceDetails: [],
    relationshipMemoryDetails: [],
    personalityRuntime: {
      socialDrive: state.projection?.socialNeed || 0,
      riskTolerance: state.biasVector?.riskTolerance,
      responsibilityDrive: state.projection?.goalPressure || 0,
      source: "psychologicalState"
    },
    cognitiveState: { psychologicalState: state, source: "psychologicalState-only" },
    socialFieldBias: { score: Number((features.SocialField * 10).toFixed(2)), source: "psychologicalState" },
    socialFeedbackBias: { score: 0, source: "psychologicalState" },
    causalBias: { score: Number((features.CausalScore * 10).toFixed(2)), value: features.CausalScore, source: "psychologicalState" },
    realityConstraint: constraint,
    goalDetails: [],
    selfConsistencyDetails: [],
    vectorDetails: [],
    vectorCap: 0
  };
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

function softmaxPick(scored = [], seed = "", temperature = 18) {
  if (!scored.length) return null;
  const maxScore = Math.max(...scored.map(item => item.score));
  const scale = temperature <= 2 ? Math.max(0.3, temperature) * 18 : Math.max(1, temperature);
  const weights = scored.map(item => Math.exp((item.score - maxScore) / scale));
  const total = weights.reduce((sum, value) => sum + value, 0) || 1;
  let cursor = seededRandom(seed) * total;
  for (let i = 0; i < scored.length; i += 1) {
    cursor -= weights[i];
    if (cursor <= 0) return { ...scored[i], probability: Number((weights[i] / total).toFixed(4)) };
  }
  return { ...scored[0], probability: Number((weights[0] / total).toFixed(4)) };
}

function decisionTraceFor(action = null) {
  if (!action) {
    return {
      chosenAction: "",
      scoreBreakdown: { need: 0, memory: 0, personality: 0, goal: 0, emotion: 0, social: 0, socialField: 0, socialFeedback: 0, causal: 0, consistency: 0, cognitiveFit: 0, eligibility: 0 }
    };
  }
  const components = action.components || {};
  return {
    chosenAction: action.id || "",
    score: action.score || 0,
    probability: action.probability || 0,
    scoreBreakdown: {
      need: Number(components.needDrive || 0),
      memory: Number(components.memoryBias || 0),
      personality: Number(components.personalityBias || 0),
      goal: Number(components.goalBias || 0),
      emotion: Number(components.emotionBias || 0),
      social: Number(components.socialBias || 0),
      socialField: Number(components.socialFieldBias || 0),
      socialFeedback: Number(components.socialFeedbackWeighted || 0),
      causal: Number(components.causalBias || 0),
      consistency: Number(components.selfConsistency || 0),
      eligibility: Number(components.eligibilityBias || 0),
      context: Number(components.contextFit || 0),
      cognitiveFit: Number(components.cognitiveFit || 0),
      actionMatch: Number(components.cognitiveMatch || 0),
      vector: Number(components.vectorBonus || 0),
      reality: Number(components.realityB || 0),
      cost: Number(components.cost || 0),
      risk: Number(components.risk || 0)
    }
  };
}

function debugDecisionFor(action = null) {
  const trace = decisionTraceFor(action);
  const needDynamicsState = action?.cognitiveState?.needDynamicsState || null;
  return {
    action: trace.chosenAction,
    reasons: {
      need: trace.scoreBreakdown.need,
      memory: trace.scoreBreakdown.memory,
      personality: trace.scoreBreakdown.personality,
      goal: trace.scoreBreakdown.goal,
      emotion: trace.scoreBreakdown.emotion,
      social: trace.scoreBreakdown.social,
      socialField: trace.scoreBreakdown.socialField,
      socialFeedback: trace.scoreBreakdown.socialFeedback,
      causal: trace.scoreBreakdown.causal,
      consistency: trace.scoreBreakdown.consistency,
      eligibility: trace.scoreBreakdown.eligibility,
      context: trace.scoreBreakdown.context,
      cognitiveFit: trace.scoreBreakdown.cognitiveFit,
      risk: trace.scoreBreakdown.risk
    },
    needEmergencyFlag: action?.cognitiveState?.needEmergencyFlag || {},
    needDynamics: needDynamicsState ? {
      modes: needDynamicsState.modes,
      delta: needDynamicsState.delta,
      context: needDynamicsState.context
    } : null,
    score: trace.score || 0,
    probability: trace.probability || 0
  };
}

function utilityDecision(S = {}) {
  const legacyAgent = arguments.length >= 3 ? arguments[1] : null;
  const extras = arguments.length >= 3 ? (arguments[2] || {}) : (arguments[1] || {});
  const cognitive = extras.cognitiveState || null;
  const psychologicalState = psychologicalStateFrom(S, extras) || cognitive?.psychologicalState || null;
  if (!psychologicalState) throw new Error("V3.4.2 utilityDecision requires precomputed psychologicalState");
  const agentId = agentIdFromState(psychologicalState) || String(legacyAgent?.id || "");
  const tick = num(psychologicalState.timestamp, 0);
  const rawActions = candidateActions(psychologicalState);
  const runtimeContext = psychologicalState.projection?.runtimeContext || null;
  if (!runtimeContext) throw new Error("V3.4.2 utilityDecision requires psychologicalState.projection.runtimeContext");
  const actionEligibilityResult = filterEligibleActions(psychologicalState, rawActions, { runtimeContext });
  const actions = actionEligibilityResult.actions;
  const scored = actions
    .map(action => scoreAction(psychologicalState, action))
    .sort((a, b) => b.score - a.score);
  if (!scored.length) {
    return {
      agentId,
      status: "NO_VALID_CANDIDATE",
      priority: 0,
      priorityComponents: { psychologicalState: 0 },
      priorityReason: "no_valid_candidate",
      selectedAction: null,
      candidateActions: [],
      actionEligibility: actionEligibilityResult,
      vectorRecall: [],
      structuredMemory: {},
      cognitiveState: { psychologicalState },
      psychologicalState,
      desireCandidates: [],
      activeBeliefs: [],
      thoughtStream: [],
      selectionTemperature: null,
      explorationRate: explorationRateFromState(psychologicalState),
      personalityRuntime: { source: "psychologicalState" },
      memoryInfluence: { agentId, memoryBias: [], rule: "V3.4.2.1 decision path reads unified psychological state only." },
      goalRuntime: null,
      selfModel: null,
      decisionTrace: decisionTraceFor(null),
      debugDecision: debugDecisionFor(null),
      plan: null,
      interruption: null,
      rule: "V3.4.2.1 no fallback candidate generation."
    };
  }
  const temperature = 0.65;
  const explorationRate = explorationRateFromState(psychologicalState);
  const priority = Math.round(Math.max(...scored.map(action => action.score || 0), 0));
  const selected = pickWithExploration(scored, `${agentId}:${tick}:S:${temperature}`, explorationRate);
  const decisionTrace = decisionTraceFor(selected);
  const debugDecision = debugDecisionFor(selected);
  return {
    agentId,
    priority,
    priorityComponents: { psychologicalState: priority },
    priorityReason: "psychologicalState",
    selectedAction: selected,
    candidateActions: scored.slice(0, 12),
    actionEligibility: actionEligibilityResult,
    vectorRecall: [],
    structuredMemory: {},
    cognitiveState: { psychologicalState },
    psychologicalState,
    desireCandidates: [],
    activeBeliefs: [],
    thoughtStream: [],
    selectionTemperature: temperature,
    explorationRate,
    personalityRuntime: { source: "psychologicalState" },
    memoryInfluence: { agentId, memoryBias: [], rule: "V3.4.2 decision path reads unified psychological state only." },
    goalRuntime: null,
    selfModel: null,
    decisionTrace,
    debugDecision,
    plan: null,
    interruption: null,
    rule: "V3.4.2 score is S(t)-only: psychologicalState -> state candidates -> frozen utility -> selection."
  };
}

module.exports = {
  agentPriority,
  candidateActions,
  actionConstraintsFor,
  actionEligibility,
  filterEligibleActions,
  lifeStageOf,
  professionKind,
  memoryInfluenceAgent,
  actionVector,
  realityConstraint,
  goalBias,
  selfConsistencyBias,
  cognitiveFitForAction,
  explorationRateFromState,
  scoreAction,
  softmaxPick,
  decisionTraceFor,
  debugDecisionFor,
  utilityDecision
};

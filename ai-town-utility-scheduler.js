"use strict";

const { currentPlanItem } = require("./ai-town-planner");
const { detectInterruption } = require("./ai-town-interruptions");
const {
  structuredMemoryForAgent,
  retrieveVectorMemories,
  ensureSelfModel,
  normalizeGoalRuntime
} = require("./ai-town-memory-stream");
const {
  personalityRuntime,
  personalityRuntimeBias
} = require("./ai-town-personality-runtime");
const {
  cognitiveState,
  actionVector,
  actionMatch,
  realityConstraint,
  cognitiveTemperature
} = require("./ai-town-cognitive-state");
const { socialFieldBiasForAction } = require("./ai-town-social-field");
const { socialFeedbackBiasForAction } = require("./ai-town-social-feedback");

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

function ageWeights(agent = {}) {
  const age = num(agent.ageYears ?? agent.age, 35);
  const stage = String(agent.ageStage || "");
  const child = age <= 12 || /儿童|小学生|child/.test(stage);
  const teen = (age > 12 && age <= 18) || /青少年|学生|teen/.test(stage);
  const elder = age >= 65 || /老人|老年|elder/.test(stage);
  return {
    hunger: child ? 1.35 : teen ? 1.2 : 1,
    safety: child || elder ? 1.35 : 1,
    health: elder ? 1.45 : child ? 1.15 : 1,
    responsibility: teen ? 1.25 : 1,
    comfort: elder ? 1.2 : 1,
    social: teen ? 1.15 : 1,
    stress: 1,
    hygiene: 1
  };
}

function needPressure(agent = {}) {
  const needs = agent.needs || {};
  const weights = ageWeights(agent);
  const keys = ["hunger", "hygiene", "health", "social", "responsibility", "stress", "comfort", "safety"];
  return keys.reduce((sum, key) => {
    const drive = clamp((100 - num(needs[key], 75)) / 100, 0, 1, 0);
    return sum + drive * 30 * (weights[key] || 1);
  }, 0);
}

function emotionalInstability(agent = {}) {
  const e = agent.emotionVector || agent.emotions || {};
  return (
    clamp(num(e.anxious, 0) - 45, 0, 55, 0) * 0.35
    + clamp(num(e.angry, 0) - 45, 0, 55, 0) * 0.32
    + clamp(num(e.sad, 0) - 45, 0, 55, 0) * 0.25
    + clamp(num(e.tired, 0) - 50, 0, 50, 0) * 0.25
    + clamp(num(e.lonely, 0) - 50, 0, 50, 0) * 0.2
  );
}

function obligationPressure(agent = {}) {
  const obligations = [
    ...(Array.isArray(agent.activeObligations) ? agent.activeObligations : []),
    ...(Array.isArray(agent.obligations) ? agent.obligations : [])
  ];
  return obligations.slice(0, 5).reduce((sum, item) => sum + clamp(item.pressure || item.priority || 20, 0, 100, 20) * 0.12, 0);
}

function crisisPressure(agent = {}, interruption = null) {
  if (!interruption) return 0;
  return clamp(interruption.priority, 0, 100, 60) * (interruption.canOverridePlan ? 1.1 : 0.65);
}

function unfinishedProcessPressure(agent = {}) {
  if (!agent.activeProcess) return 0;
  const progress = clamp(agent.activeProcess.progress, 0, 100, 0);
  return 18 + (100 - progress) * 0.12;
}

function agentPriority(world, agent, extras = {}) {
  if (!agent?.id || agent.lifeStatus === "dead" || agent.terminalState?.dead) {
    return { priority: 0, components: {}, reason: "dead" };
  }
  const interruption = extras.interruption || detectInterruption(world, agent);
  const components = {
    crisis: crisisPressure(agent, interruption),
    needPressure: needPressure(agent),
    activeObligation: obligationPressure(agent),
    emotionalInstability: emotionalInstability(agent),
    unfinishedProcess: unfinishedProcessPressure(agent)
  };
  const priority = Object.values(components).reduce((sum, value) => sum + value, 0);
  const reason = Object.entries(components).sort((a, b) => b[1] - a[1])[0]?.[0] || "low_pressure";
  return { priority: Math.round(priority), components, reason, interruption };
}

function legacyCandidateActions(world, agent, extras = {}) {
  const plan = extras.plan || currentPlanItem(world, agent);
  const interruption = extras.interruption || detectInterruption(world, agent);
  const needs = agent.needs || {};
  const actions = [];
  const push = action => actions.push({
    id: action.id,
    label: action.label,
    type: action.type || "observe",
    targetNeed: action.targetNeed || "",
    targetPlace: action.targetPlace || "",
    tags: action.tags || [],
    base: num(action.base, 0),
    cost: num(action.cost, 0),
    risk: num(action.risk, 0),
    reason: action.reason || ""
  });
  if (agent.activeProcess) push({ id: "continue_process", label: "继续未完成过程", type: "react", tags: ["process", "responsibility"], base: 28, reason: "activeProcess" });
  if (interruption?.type === "health" || num(needs.health, 100) < 45) push({ id: "seek_care", label: "处理健康问题", type: "move", targetNeed: "health", targetPlace: "clinic", tags: ["health", "care", "help"], base: 32, cost: 12, risk: 6, reason: "health" });
  if (interruption?.type === "safety" || num(needs.safety, 100) < 45) push({ id: "seek_safety", label: "寻找安全地点", type: "move", targetNeed: "safety", targetPlace: "apartment", tags: ["safety", "home"], base: 32, cost: 10, risk: 4, reason: "safety" });
  if (interruption?.type === "hunger" || num(needs.hunger, 100) < 48) push({ id: "eat_or_buy_food", label: "找机会吃饭", type: "move", targetNeed: "hunger", targetPlace: "breakfast", tags: ["hunger", "food"], base: 24, cost: 8, risk: 2, reason: "hunger" });
  if (num(agent.energy, 70) < 35 || num((agent.emotionVector || agent.emotions || {}).tired, 0) > 65) push({ id: "rest", label: "休息恢复", type: "wait", targetNeed: "comfort", targetPlace: "apartment", tags: ["rest", "tired", "comfort"], base: 20, cost: 4, reason: "fatigue" });
  if (num(needs.hygiene, 100) < 45) push({ id: "tidy_or_clean", label: "整理和清洁", type: "react", targetNeed: "hygiene", tags: ["clean", "tidy", "comfort"], base: 18, cost: 4, reason: "hygiene" });
  if (num(needs.social, 100) < 50) push({ id: "contact_familiar", label: "联系熟悉的人", type: "talk", targetNeed: "social", tags: ["social", "relationship", "help"], base: 18, cost: 7, reason: "social" });
  if (plan) push({ id: "follow_plan", label: plan.title || "继续今日计划", type: /move|commute/.test(plan.localAction || "") ? "move" : "work", targetPlace: plan.place || "", tags: ["plan", "responsibility", plan.localAction || ""], base: num(plan.priority, plan.fixed ? 30 : 18), cost: 5, reason: "dailyPlan" });
  push({ id: "observe_environment", label: "观察环境", type: "observe", tags: ["observe", "low_risk"], base: 8, cost: 1, reason: "ordinary_life" });
  push({ id: "think_and_plan", label: "思考和调整计划", type: "plan", tags: ["think", "goal"], base: 9, cost: 2, reason: "ordinary_life" });
  push({ id: "walk_nearby", label: "小范围散步", type: "move", tags: ["walk", "comfort", "explore"], base: 7, cost: 6, risk: 3, reason: "ordinary_life" });
  return dedupeActions(actions);
}

function lifeStageOf(agent = {}) {
  const age = num(agent.ageYears ?? agent.age, 35);
  const text = `${agent.ageStage || ""} ${agent.job || ""} ${textOf(agent.identityCore)} ${textOf(agent.selfModel)}`.toLowerCase();
  if (age <= 12 || /child|kid|儿童|孩子|小学生/.test(text)) return "child";
  if (age <= 18 || /teen|student|少年|中学生|学生/.test(text)) return "teen";
  if (age >= 65 || /elder|retired|老人|老年|退休/.test(text)) return "elder";
  return "adult";
}

function professionKind(agent = {}) {
  const text = `${agent.job || ""} ${agent.ageStage || ""} ${textOf(agent.identityCore)} ${textOf(agent.selfModel)}`.toLowerCase();
  if (/doctor|nurse|clinic|medical|physician|医生|护士|医护|诊所|医疗/.test(text)) return "medical";
  if (/shop|store|merchant|seller|baker|breakfast|cashier|owner|店主|老板|店员|小卖部|早餐|商贩|售货|收银|面包/.test(text)) return "merchant";
  if (/teacher|school|class|老师|教师|学校/.test(text)) return "teacher";
  if (/student|pupil|学生|小学生|中学生/.test(text)) return "student";
  if (/guard|security|police|保安|警察|巡逻/.test(text)) return "security";
  if (/detective|investigator|侦探|调查/.test(text)) return "investigator";
  if (/artist|writer|painter|艺术|画家|作家|记录/.test(text)) return "artist";
  return "resident";
}

function isDependentAdult(agent = {}) {
  const stage = lifeStageOf(agent);
  if (stage !== "adult" && stage !== "elder") return false;
  const text = `${textOf(agent.identityCore)} ${textOf(agent.selfModel)} ${agent.currentTask || ""}`.toLowerCase();
  if (/dependent|needs help|requires care|依赖|需要照顾|被照顾|需要帮助|生活不能自理/.test(text)) return true;
  const rels = Object.values(agent.relationshipMatrix || {});
  return rels.some(rel => num(rel.dependency, 0) >= 70 && num(rel.trust, 0) >= 60);
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

function emergencyState(agent = {}, interruption = null) {
  const needs = agent.needs || {};
  return {
    health: interruption?.type === "health" || num(needs.health, 100) <= 30,
    safety: interruption?.type === "safety" || num(needs.safety, 100) <= 32,
    hunger: interruption?.type === "hunger" || num(needs.hunger, 100) <= 30,
    any: Boolean(interruption?.canOverridePlan) || num(needs.health, 100) <= 30 || num(needs.safety, 100) <= 32 || num(needs.hunger, 100) <= 30
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

function shouldAskGuardian(agent = {}) {
  const stage = lifeStageOf(agent);
  if (stage === "child" || stage === "teen") return true;
  return isDependentAdult(agent);
}

function professionEligibilityBias(agent = {}, action = {}, context = {}) {
  const profession = context.profession || professionKind(agent);
  const stage = context.stage || lifeStageOf(agent);
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

function actionEligibility(world = {}, agent = {}, action = {}, extras = {}) {
  const constraints = action.actionConstraints || actionConstraintsFor(action.id);
  const stage = lifeStageOf(agent);
  const profession = professionKind(agent);
  const currentPlace = agent.position || agent.place || "";
  const plan = extras.plan || null;
  const interruption = extras.interruption || null;
  const emergency = emergencyState(agent, interruption);
  const reasons = [];
  const deny = reason => ({ allowed: false, reason, reasons: [reason], constraints, stage, profession, bias: 0 });
  if (!agent?.id || agent.lifeStatus === "dead" || agent.terminalState?.dead) return deny("dead agent");
  if (action.id === "continue_process" && !agent.activeProcess) return deny("no active process");
  if (action.id === "follow_plan" && !plan) return deny("no current plan");
  if (action.id === "ask_guardian" && !shouldAskGuardianV321(agent)) return deny("not child, teen, or dependent adult");
  if (action.id === "follow_stranger") {
    if (stage !== "adult") return deny("only independent adults may consider following a stranger");
    if (!["investigator", "security", "artist"].includes(profession) && scaleProfile(agent, "curiosity", 0.5) < 0.78) return deny("identity is not investigator/security/observer");
    if (emergency.safety || num(interruption?.priority, 0) >= 75) return deny("safety crisis blocks following stranger");
  }
  if (action.id === "provide_care") {
    if (profession !== "medical") return deny("not medical profession");
    if (!clinicPlaceId(currentPlace) && !clinicPlaceId(plan?.place || "") && !/clinic|medical|doctor|诊所|医院|问诊|看诊/.test(String(agent.currentTask || "").toLowerCase())) {
      return deny("not at clinic or medical duty context");
    }
  }
  if (["serve_customers", "check_inventory"].includes(action.id)) {
    if (profession !== "merchant") return deny("not merchant profession");
    if (!businessPlaceId(currentPlace) && !businessPlaceId(plan?.place || "") && !/shop|store|business|customer|店|顾客|补货/.test(String(agent.currentTask || "").toLowerCase())) {
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
  reasons.push("eligible");
  const bias = professionEligibilityBias(agent, action, { stage, profession });
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

function scaleProfile(agent = {}, key, fallback = 0.5) {
  const value = agent.cognitiveProfile?.[key];
  if (value == null) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n <= 1 && n >= 0 ? n : clamp(n / 100, 0, 1, fallback);
}

function filterEligibleActions(world = {}, agent = {}, actions = [], extras = {}) {
  const allowed = [];
  const removed = [];
  actions.forEach(action => {
    const check = actionEligibility(world, agent, action, extras);
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
    rawCount: actions.length,
    eligibleCount: allowed.length,
    invalidActionRate: 0,
    rule: "Invalid actions are removed before Cognitive Score and Softmax."
  };
}

function candidateActions(world, agent, extras = {}) {
  const plan = extras.plan || currentPlanItem(world, agent);
  const interruption = extras.interruption || detectInterruption(world, agent);
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
      actionConstraints: action.actionConstraints || actionConstraintsFor(action.id)
    };
    item.actionVector = action.actionVector || actionVector(item);
    actions.push(item);
  };
  if (agent.activeProcess) {
    push({ id: "continue_process", label: "continue unfinished process", type: "react", tags: ["process", "responsibility"], base: 12, reason: "activeProcess" });
  }
  push({ id: "seek_care", label: "handle health condition", type: "move", targetNeed: "health", targetPlace: "clinic", tags: ["health", "care", "help"], base: 8, cost: 12, risk: 6, reason: "possible_action" });
  push({ id: "seek_safety", label: "move to a safer place", type: "move", targetNeed: "safety", targetPlace: "apartment", tags: ["safety", "home"], base: 8, cost: 10, risk: 4, reason: "possible_action" });
  push({ id: "eat_or_buy_food", label: "find food or eat", type: "move", targetNeed: "hunger", targetPlace: "breakfast", tags: ["hunger", "food"], base: 7, cost: 8, risk: 2, reason: "possible_action" });
  push({ id: "rest", label: "rest and recover", type: "wait", targetNeed: "comfort", targetPlace: "apartment", tags: ["rest", "tired", "comfort"], base: 7, cost: 4, availability: (agent.position || agent.place) === "apartment" ? 1 : 0.48, reason: "possible_action" });
  push({ id: "tidy_or_clean", label: "tidy and clean up", type: "react", targetNeed: "hygiene", tags: ["clean", "tidy", "comfort"], base: 5, cost: 4, reason: "possible_action" });
  push({ id: "contact_familiar", label: "contact a familiar person", type: "talk", targetNeed: "social", tags: ["social", "relationship", "help"], base: 6, cost: 7, reason: "possible_action" });
  if (plan) {
    push({ id: "follow_plan", label: plan.title || "continue daily plan", type: /move|commute/.test(plan.localAction || "") ? "move" : "work", targetPlace: plan.place || "", tags: ["plan", "responsibility", plan.localAction || ""], base: num(plan.priority, plan.fixed ? 18 : 10), cost: 5, reason: "dailyPlan" });
  }
  push({ id: "observe_environment", label: "observe environment", type: "observe", tags: ["observe", "low_risk"], base: 6, cost: 1, reason: "possible_action" });
  push({ id: "think_and_plan", label: "think and adjust plan", type: "plan", tags: ["think", "goal"], base: 6, cost: 2, reason: "possible_action" });
  push({ id: "walk_nearby", label: "walk nearby", type: "move", tags: ["walk", "comfort", "explore"], base: 4, cost: 6, risk: 3, reason: "possible_action" });
  push({ id: "return_home", label: "return home", type: "move", targetPlace: "apartment", tags: ["home", "safety", "comfort"], base: 9, cost: 5, risk: 2, reason: "possible_action" });
  push({ id: "follow_stranger", label: "follow and observe from distance", type: "move", tags: ["observe", "novelty", "risk"], base: 3, cost: 9, risk: 16, availability: interruption?.type === "safety" ? 0.55 : 0.45, reason: "possible_action" });
  push({ id: "ask_guardian", label: "ask a trusted guardian or familiar adult", type: "talk", tags: ["support", "social", "safety"], base: 7, cost: 5, risk: 2, reason: "dependent_role" });
  push({ id: "record_observation", label: "record observation", type: "observe", tags: ["observe", "novelty", "art"], base: 4, cost: 3, risk: 4, reason: "possible_action" });
  push({ id: "provide_care", label: "handle medical or care duty", type: "work", targetPlace: "clinic", tags: ["medical", "care", "work", "profession"], base: 6, cost: 6, risk: 4, availability: clinicPlaceId(agent.position || agent.place || plan?.place || "") ? 0.95 : 0.45, reason: "profession_candidate" });
  push({ id: "serve_customers", label: "handle shop customers", type: "work", targetPlace: agent.position || agent.place || "", tags: ["business", "customer", "work", "profession"], base: 6, cost: 5, risk: 2, availability: businessPlaceId(agent.position || agent.place || plan?.place || "") ? 0.9 : 0.45, reason: "profession_candidate" });
  push({ id: "check_inventory", label: "check stock and supplies", type: "react", targetPlace: agent.position || agent.place || "", tags: ["business", "restock", "order", "profession"], base: 5, cost: 4, risk: 1, availability: businessPlaceId(agent.position || agent.place || plan?.place || "") ? 0.9 : 0.45, reason: "profession_candidate" });
  return dedupeActions(actions);
}

function shouldAskGuardian(agent = {}) {
  const age = num(agent.ageYears ?? agent.age, 35);
  const text = `${agent.job || ""} ${agent.ageStage || ""} ${textOf(agent.identityCore)} ${textOf(agent.selfModel)}`.toLowerCase();
  if (age <= 18) return true;
  if (/child|kid|teen|student|guardian|dependent|学生|儿童|孩子|少年|监护/.test(text)) return true;
  const rels = Object.values(agent.relationshipMatrix || {});
  return rels.some(rel => num(rel.dependency, 0) >= 70 && num(rel.trust, 0) >= 60);
}

function shouldAskGuardianV321(agent = {}) {
  const stage = lifeStageOf(agent);
  if (stage === "child" || stage === "teen") return true;
  return isDependentAdult(agent);
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

function structuredMemoryBias(agent, action, world = {}) {
  const memories = structuredMemoryForAgent(agent, 10);
  const clock = num(world.clock, 0);
  let score = 0;
  const details = [];
  Object.entries(memories).forEach(([type, items]) => {
    items.forEach(item => {
      const rel = relevance(`${item.text || ""} ${item.meaning || ""} ${(item.tags || []).join(" ")}`, action);
      if (!rel) return;
      const ageDays = Math.max(0, Math.floor((clock - num(item.lastSeenAt || item.at, 0)) / 1440));
      const halfLife = ["habit", "belief", "goal"].includes(type) ? 90 : type === "social" ? 45 : 21;
      const decay = Math.exp(-ageDays / halfLife);
      const emotionalStrength = clamp(Math.abs(num(item.valence, 0)) / 100 + num(item.strength, 50) / 100, 0.2, 1.8, 1);
      const bias = num(item.importance, 3) * emotionalStrength * rel * decay;
      score += bias;
      details.push({ type, text: String(item.text || item.meaning || "").slice(0, 80), relevance: Number(rel.toFixed(2)), bias: Number(bias.toFixed(2)) });
    });
  });
  return { score: Number(score.toFixed(2)), details: details.sort((a, b) => b.bias - a.bias).slice(0, 4) };
}

function personalityBias(agent, action) {
  const text = `${textOf(agent.identityCore)} ${textOf(agent.personalityProfile)}`;
  let score = 0;
  if (includesAny(text, ["内向", "安静", "回避", "谨慎", "introvert"]) && includesAny(action.id, ["rest", "observe", "think"])) score += 9;
  if (includesAny(text, ["内向", "安静", "回避", "谨慎", "introvert"]) && includesAny(action.id, ["contact", "walk"])) score -= 4;
  if (includesAny(text, ["外向", "开朗", "社交", "热心", "extrovert"]) && includesAny(action.id, ["contact", "walk"])) score += 8;
  if (includesAny(text, ["责任", "守时", "认真", "负责"]) && action.id === "follow_plan") score += 10;
  if (includesAny(text, ["怕麻烦", "不求助", "独立"]) && includesAny(action.id, ["seek_care", "contact"])) score -= 5;
  if (includesAny(text, ["家庭", "照顾", "牵挂"]) && action.id === "contact_familiar") score += 5;
  return score;
}

function emotionBias(agent, action) {
  const e = agent.emotionVector || agent.emotions || {};
  let score = 0;
  if (num(e.tired, 0) > 60 && ["rest", "seek_care", "think_and_plan"].includes(action.id)) score += (num(e.tired, 0) - 55) * 0.35;
  if (num(e.lonely, 0) > 55 && ["contact_familiar", "walk_nearby"].includes(action.id)) score += (num(e.lonely, 0) - 50) * 0.32;
  if (num(e.anxious, 0) > 55 && ["seek_safety", "seek_care", "contact_familiar", "observe_environment"].includes(action.id)) score += (num(e.anxious, 0) - 50) * 0.25;
  if (num(e.angry, 0) > 60 && action.id === "contact_familiar") score -= (num(e.angry, 0) - 55) * 0.18;
  if (num(e.happy, 0) > 60 && ["walk_nearby", "contact_familiar"].includes(action.id)) score += (num(e.happy, 0) - 55) * 0.18;
  if (num(e.hopeful, 0) > 60 && ["think_and_plan", "follow_plan", "walk_nearby"].includes(action.id)) score += (num(e.hopeful, 0) - 55) * 0.16;
  return score;
}

function socialBias(world, agent, action) {
  if (!["contact_familiar", "seek_care", "follow_plan"].includes(action.id)) return 0;
  const rels = Object.values(agent.relationshipMatrix || {});
  if (!rels.length) return action.id === "contact_familiar" ? -4 : 0;
  const best = rels.reduce((max, rel) => Math.max(max,
    num(rel.trust, 0) * 0.2 + num(rel.intimacy, 0) * 0.18 + num(rel.dependency, 0) * 0.12 + num(rel.debt, 0) * 0.08 - num(rel.resentment, 0) * 0.2
  ), 0);
  return action.id === "contact_familiar" ? best : best * 0.25;
}

function relationshipMemoryBias(agent = {}, action = {}) {
  const memories = Array.isArray(agent.relationshipMemory) ? agent.relationshipMemory : [];
  if (!memories.length || !action?.id) return { score: 0, details: [] };
  let score = 0;
  const details = [];
  memories.slice(0, 20).forEach(memory => {
    const type = String(memory.relationshipType || memory.impact || "").toLowerCase();
    const tag = String(memory.emotionalTag || memory.impact || "").toLowerCase();
    const trust = clamp(num(memory.trust, 0.45), 0, 1, 0.45);
    const familiarity = clamp(num(memory.familiarity, 0.35), 0, 1, 0.35);
    const strength = clamp(num(memory.strength, memory.importance || 0.4), 0, 1, 0.4);
    const interactions = Math.min(1.8, 0.85 + Math.log1p(num(memory.interactionCount, 1)) * 0.18);
    const base = (trust * 0.55 + familiarity * 0.25 + strength * 0.2) * interactions * 12;
    let delta = 0;
    if (tag === "positive" || /help|cooperation|promise|repair/.test(type)) {
      if (["contact_familiar", "ask_guardian"].includes(action.id)) delta += base;
      if (["follow_plan", "continue_process"].includes(action.id) && /cooperation|promise/.test(type)) delta += base * 0.45;
      if (action.id === "cooperate") delta += base * 1.2;
    }
    if (tag === "negative" || /conflict|crisis/.test(type)) {
      if (["contact_familiar", "ask_guardian"].includes(action.id)) delta -= base * 0.65;
      if (["seek_safety", "observe_environment", "think_and_plan"].includes(action.id)) delta += base * 0.35;
      if (action.id === "avoid_person") delta += base;
    }
    if (!delta) return;
    score += delta;
    details.push({
      targetAgentId: memory.targetAgentId || "",
      type: memory.relationshipType || memory.impact || "",
      tag: memory.emotionalTag || memory.impact || "",
      bias: Number(delta.toFixed(2)),
      reason: String(memory.effect || memory.relation || memory.event || "").slice(0, 80)
    });
  });
  return { score: Number(score.toFixed(2)), details: details.sort((a, b) => Math.abs(b.bias) - Math.abs(a.bias)).slice(0, 4) };
}

function needDrive(agent, action) {
  const needs = agent.needs || {};
  const weights = ageWeights(agent);
  const need = action.targetNeed;
  if (!need) return 0;
  const drive = clamp((100 - num(needs[need], 75)) / 100, 0, 1, 0);
  return drive * 55 * (weights[need] || 1);
}

function contextFit(world, agent, action, extras = {}) {
  const plan = extras.plan || currentPlanItem(world, agent);
  const currentPlace = agent.position || agent.place || "";
  let score = 0;
  if (action.targetPlace && action.targetPlace === currentPlace) score += 8;
  if (plan && action.id === "follow_plan") score += plan.fixed ? 26 : 14;
  if (agent.activeProcess && action.id === "continue_process") score += 35;
  if (action.id === "seek_care") {
    const cooldownUntil = Number(agent.medicalState?.afterTreatmentCooldownUntil || 0);
    const health = num(agent.needs?.health, 100);
    if (cooldownUntil > Number(world?.clock || 0) && health > 20) {
      score -= health >= 40 ? 24 : 10;
    }
  }
  const job = `${agent.job || ""} ${agent.ageStage || ""}`;
  if (/学生|小学生|中学生/.test(job) && plan?.localAction === "study" && !["follow_plan", "seek_care", "seek_safety"].includes(action.id)) score -= 12;
  if (agent.isSleeping && !["seek_care", "seek_safety"].includes(action.id)) score -= 40;
  return score;
}

function vectorBonus(vectorRecall = [], action) {
  let raw = 0;
  const details = [];
  vectorRecall.forEach(item => {
    const rel = relevance(`${item.scene || ""} ${(item.tags || []).join(" ")}`, action);
    if (!rel) return;
    const bonus = num(item.similarity, 0) * num(item.importance, 3) * rel * 3;
    raw += bonus;
    details.push({ scene: String(item.scene || "").slice(0, 80), similarity: item.similarity, bonus: Number(bonus.toFixed(2)) });
  });
  return { raw, details: details.sort((a, b) => b.bonus - a.bonus).slice(0, 3) };
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

function addMemoryBias(memoryBias, action, weight, reason, sourceType = "memory") {
  if (!action || !Number.isFinite(Number(weight))) return;
  const existing = memoryBias.find(item => item.action === action);
  if (existing) {
    existing.weight = Number((existing.weight + Number(weight)).toFixed(2));
    if (reason && !existing.reasons.includes(reason)) existing.reasons.push(reason);
    return;
  }
  memoryBias.push({
    action,
    weight: Number(Number(weight).toFixed(2)),
    reasons: reason ? [String(reason).slice(0, 120)] : [],
    sourceType
  });
}

function memoryInfluenceAgent(world = {}, agent = {}) {
  const structured = structuredMemoryForAgent(agent, 12);
  const memoryBias = [];
  Object.entries(structured).forEach(([type, items]) => {
    items.forEach(item => {
      const text = `${item.text || ""} ${item.meaning || ""} ${(item.tags || []).join(" ")}`.toLowerCase();
      const importance = clamp(num(item.importance, 3), 1, 5, 3) / 5;
      const strength = clamp(num(item.strength, 50), 0, 100, 50) / 100;
      const ageDays = Math.max(0, Math.floor((num(world.clock, 0) - num(item.lastSeenAt || item.at, 0)) / 1440));
      const halfLife = ["habit", "belief", "goal"].includes(type) ? 120 : type === "social" ? 60 : 30;
      const decay = Math.exp(-ageDays / halfLife);
      const base = 8 + importance * 18 + strength * 12;
      const weight = base * decay;
      const reason = item.meaning || item.text || type;
      if (/health|clinic|doctor|medical|鍋ュ悍|韬綋|璇婃墍|鍖荤敓|鍖婚櫌/.test(text)) {
        addMemoryBias(memoryBias, "seek_care", weight * 0.9, reason, type);
        addMemoryBias(memoryBias, "ignore_health", -weight * 0.8, reason, type);
      }
      if (/safety|risk|danger|unsafe|瀹夊叏|椋庨櫓|鍗遍櫓|閬块櫓/.test(text)) {
        addMemoryBias(memoryBias, "seek_safety", weight * 0.9, reason, type);
        addMemoryBias(memoryBias, "walk_nearby", -weight * 0.35, reason, type);
      }
      if (/hunger|food|meal|eat|breakfast|楗|鍚冮キ|椋熺墿|鏃╅/.test(text)) {
        addMemoryBias(memoryBias, "eat_or_buy_food", weight * 0.85, reason, type);
      }
      if (/family|friend|neighbor|trust|help|瀹朵汉|鏈嬪弸|閭诲眳|淇′换|甯姪|姹傚姪/.test(text)) {
        addMemoryBias(memoryBias, "contact_familiar", weight * 0.75, reason, type);
      }
      if (/responsib|promise|work|study|class|守信|责任|承诺|宸ヤ綔|瀛︿範|涓婅|璐ｄ换|鎵胯/.test(text)) {
        addMemoryBias(memoryBias, "follow_plan", weight * 0.8, reason, type);
        addMemoryBias(memoryBias, "continue_process", weight * 0.45, reason, type);
      }
      if (/rest|sleep|quiet|calm|tired|浼戞伅|鐫¤|瀹夐潤|鐤叉儷|鎭㈠/.test(text)) {
        addMemoryBias(memoryBias, "rest", weight * 0.65, reason, type);
        addMemoryBias(memoryBias, "observe_environment", weight * 0.2, reason, type);
      }
      if (/goal|future|plan|鐩爣|鏈潵|璁″垝/.test(text)) {
        addMemoryBias(memoryBias, "think_and_plan", weight * 0.6, reason, type);
      }
      if (type === "preference" && /explore|walk|curious|散步|探索|好奇/.test(text)) {
        addMemoryBias(memoryBias, "walk_nearby", weight * 0.45, reason, type);
      }
    });
  });
  memoryBias.sort((a, b) => Math.abs(Number(b.weight || 0)) - Math.abs(Number(a.weight || 0)));
  const result = {
    agentId: agent.id || "",
    memoryBias: memoryBias.slice(0, 24),
    rule: "MemoryInfluence turns long-term memory into soft action bias. It is not a fact source and cannot settle world state."
  };
  agent.memoryInfluence = result;
  return result;
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

function goalBias(world = {}, agent = {}, action = {}) {
  const runtime = normalizeGoalRuntime(agent, world);
  let score = 0;
  const details = [];
  (runtime.goals || []).forEach(goal => {
    const text = `${goal.name || ""} ${goal.title || ""} ${(goal.blockedBy || []).join(" ")}`.toLowerCase();
    let rel = relevance(text, action);
    if (/health|鍋ュ悍|韬綋/.test(text) && action.id === "seek_care") rel = Math.max(rel, 0.9);
    if (/family|瀹跺涵|瀹朵汉/.test(text) && action.id === "contact_familiar") rel = Math.max(rel, 0.75);
    if (/work|study|class|责任|宸ヤ綔|瀛︿範|涓婅|璐ｄ换/.test(text) && ["follow_plan", "continue_process"].includes(action.id)) rel = Math.max(rel, 0.8);
    if (/stable|stability|稳定|绋冲畾|生活/.test(text) && ["follow_plan", "rest", "think_and_plan"].includes(action.id)) rel = Math.max(rel, 0.45);
    if (!rel && action.id === "think_and_plan" && num(goal.frustration, 0) > 0.35) rel = 0.35;
    if (!rel) return;
    const bias = clamp(num(goal.priority, 0.5), 0, 1, 0.5) * (0.75 + clamp(num(goal.frustration, 0), 0, 1, 0)) * rel * 28;
    score += bias;
    details.push({
      goal: String(goal.name || goal.title || "").slice(0, 80),
      relevance: Number(rel.toFixed(2)),
      frustration: Number(num(goal.frustration, 0).toFixed(2)),
      bias: Number(bias.toFixed(2))
    });
  });
  return { score: Number(score.toFixed(2)), details: details.sort((a, b) => b.bias - a.bias).slice(0, 4), runtime };
}

function selfConsistencyBias(world = {}, agent = {}, action = {}, extras = {}) {
  const selfModel = ensureSelfModel(agent);
  const text = `${selfModel.identity || ""} ${(selfModel.values || []).join(" ")} ${(selfModel.fears || []).join(" ")} ${(selfModel.selfBeliefs || []).join(" ")} ${selfModel.currentSelfView || ""}`.toLowerCase();
  const weight = clamp(num(selfModel.selfConsistencyWeight, 0.65), 0, 1, 0.65);
  let score = 0;
  const details = [];
  const add = (value, reason) => {
    const delta = value * weight;
    score += delta;
    details.push({ reason, bias: Number(delta.toFixed(2)) });
  };
  const hasDuty = extras.plan?.fixed || agent.activeProcess || obligationPressure(agent) > 6;
  if (/reliable|responsib|promise|守信|可靠|责任|承诺|璐ｄ换|鎵胯/.test(text)) {
    if (["follow_plan", "continue_process"].includes(action.id)) add(18, "self-belief: reliable/responsible");
    if (hasDuty && ["walk_nearby", "observe_environment", "think_and_plan"].includes(action.id)) add(-10, "self-belief conflicts with drifting away from duty");
  }
  if (/family|care|瀹跺涵|瀹朵汉|照顾|鐓ч【/.test(text) && action.id === "contact_familiar") {
    add(10, "self-value: family/care");
  }
  if (/health|身体|鍋ュ悍|韬綋/.test(text) && ["seek_care", "rest"].includes(action.id)) {
    add(12, "self-belief: health matters");
  }
  if (/fear|risk|unsafe|失去|害怕|椋庨櫓|瀹夊叏/.test(text)) {
    if (["seek_safety", "observe_environment"].includes(action.id)) add(8, "self-fear: avoid risk");
    if (action.id === "walk_nearby") add(-5, "self-fear resists risky wandering");
  }
  if (/quiet|alone|introvert|安静|独处|瀹夐潤|鍐呭悜/.test(text) && ["rest", "observe_environment", "think_and_plan"].includes(action.id)) {
    add(6, "self-preference: quiet");
  }
  return { score: Number(score.toFixed(2)), details: details.sort((a, b) => Math.abs(b.bias) - Math.abs(a.bias)).slice(0, 4), selfModel };
}

function scoreAction(world, agent, action, extras = {}) {
  const vectorRecall = extras.vectorRecall || [];
  const memory = structuredMemoryBias(agent, action, world);
  const memoryInfluence = extras.memoryInfluence || memoryInfluenceAgent(world, agent);
  const influence = memoryInfluenceBias(memoryInfluence, action);
  const personalityState = extras.personalityRuntime || personalityRuntime(world, agent, extras);
  const personality = personalityRuntimeBias(personalityState, action);
  const cognitive = extras.cognitiveState || cognitiveState(world, agent, extras.context || {});
  const aVector = action.actionVector || actionVector(action);
  const match = actionMatch(cognitive, { ...action, actionVector: aVector });
  const cognitiveFit = cognitiveFitForAction(cognitive, action);
  const constraint = realityConstraint(cognitive, { ...action, actionVector: aVector }, extras.context || {});
  const goal = goalBias(world, agent, action);
  const selfConsistency = selfConsistencyBias(world, agent, action, extras);
  const vector = vectorBonus(vectorRecall, action);
  const weights = cognitive.decisionWeights || {};
  const emotion = emotionBias(agent, action);
  const social = socialBias(world, agent, action);
  const relationshipMemory = relationshipMemoryBias(agent, action);
  const socialField = socialFieldBiasForAction(world, agent, action);
  const socialFeedback = socialFeedbackBiasForAction(world, agent, action);
  const socialFeedbackWeightedScore = num(socialFeedback.gamma, 0.65) * num(socialFeedback.score, 0);
  const context = contextFit(world, agent, action, extras);
  const eligibilityBias = num(action.eligibilityBias || action.eligibility?.bias, 0);
  const memoryValue = clamp(0.5 + (memory.score * 2.5 + influence.score * 0.08) / 20, 0, 1, 0.5);
  const personaValue = clamp(0.5 + (personality + selfConsistency.score) / 45, 0, 1, 0.5);
  const emotionValue = clamp(0.5 + emotion / 35, 0, 1, 0.5);
  const goalValue = clamp(0.5 + goal.score / 38, 0, 1, 0.5);
  const socialValue = clamp(0.5 + (social + relationshipMemory.score + socialField.score) / 35, 0, 1, 0.5);
  const socialFeedbackValue = clamp(0.5 + socialFeedbackWeightedScore / 35, 0, 1, 0.5);
  const noveltyValue = clamp((aVector.novelty || 0) * 0.55 + (aVector.curiosity || 0) * 0.35 + num(cognitive.biasVector?.noveltySeeking, 0.35) * 0.35, 0, 1, 0.2);
  const vectorCap = 0.2;
  const vectorValue = Math.min(clamp(vector.raw / 8, 0, 1, 0), vectorCap);
  const contextValue = clamp(0.45 + match / 4 + cognitiveFit * 0.22 + context / 80 + eligibilityBias / 100 + num(action.base, 0) / 80, 0, 1, 0.5);
  const weightTotal = Math.max(0.001,
    num(weights.memory, 0.55)
    + num(weights.persona, 0.55)
    + num(weights.emotion, 0.45)
    + num(weights.goal, 0.55)
    + num(weights.novelty, 0.3)
    + num(weights.social, 0.35)
    + num(weights.social, 0.35) * 0.35
  );
  const compensatory =
    (num(weights.memory, 0.55) * memoryValue
      + num(weights.persona, 0.55) * personaValue
      + num(weights.emotion, 0.45) * emotionValue
      + num(weights.goal, 0.55) * goalValue
      + num(weights.novelty, 0.3) * noveltyValue
      + num(weights.social, 0.35) * socialValue
      + num(weights.social, 0.35) * 0.35 * socialFeedbackValue) / weightTotal;
  const combinedA = clamp(compensatory * 0.78 + contextValue * 0.22 + vectorValue, 0, 1.2, 0.5);
  const noise = (seededRandom(`${agent.id}:${world?.clock || 0}:${action.id}:v3`) - 0.5) * cognitiveTemperature(agent, cognitive) * 1.2;
  const score = combinedA * constraint.value * 100 + noise;
  return {
    ...action,
    actionVector: aVector,
    score: Number(score.toFixed(2)),
    components: {
      base: action.base,
      cognitiveMatch: Number(match.toFixed(3)),
      cognitiveFit: Number((cognitiveFit * 10).toFixed(2)),
      cognitiveFitValue: Number(cognitiveFit.toFixed(3)),
      needDrive: Number((match * 5).toFixed(2)),
      memoryBias: Number((memoryValue * 10).toFixed(2)),
      structuredMemoryBias: Number(memory.score.toFixed(2)),
      memoryInfluence: Number((Math.max(0, memoryValue - 0.5) * 20).toFixed(2)),
      personalityBias: Number(personality.toFixed(2)),
      personaValue: Number(personaValue.toFixed(3)),
      emotionBias: Number(emotion.toFixed(2)),
      emotionValue: Number(emotionValue.toFixed(3)),
      socialBias: Number(social.toFixed(2)),
      relationshipMemoryBias: Number(relationshipMemory.score.toFixed(2)),
      socialFieldBias: Number(socialField.score.toFixed(2)),
      socialFeedbackBias: Number(socialFeedback.score.toFixed(2)),
      socialFeedbackGamma: Number(num(socialFeedback.gamma, 0.65).toFixed(3)),
      socialFeedbackWeighted: Number(socialFeedbackWeightedScore.toFixed(2)),
      socialFeedbackValue: Number(socialFeedbackValue.toFixed(3)),
      socialValue: Number(socialValue.toFixed(3)),
      goalBias: Number(goal.score.toFixed(2)),
      goalValue: Number(goalValue.toFixed(3)),
      selfConsistency: Number(selfConsistency.score.toFixed(2)),
      eligibilityBias: Number(eligibilityBias.toFixed(2)),
      contextFit: Number(context.toFixed(2)),
      contextValue: Number(contextValue.toFixed(3)),
      noveltyValue: Number(noveltyValue.toFixed(3)),
      vectorBonus: Number(vectorValue.toFixed(3)),
      compensatoryA: Number(combinedA.toFixed(3)),
      realityB: constraint.value,
      noise: Number(noise.toFixed(3)),
      cost: action.cost,
      risk: action.risk
    },
    memoryDetails: memory.details,
    memoryInfluenceDetails: influence.details,
    relationshipMemoryDetails: relationshipMemory.details,
    personalityRuntime: {
      socialDrive: personalityState.socialDrive,
      riskTolerance: personalityState.riskTolerance,
      responsibilityDrive: personalityState.responsibilityDrive,
      source: personalityState.source
    },
    cognitiveState: {
      decisionWeights: cognitive.decisionWeights,
      timestamp: cognitive.timestamp,
      version: cognitive.version,
      enabled: cognitive.enabled,
      selfPressure: cognitive.selfPressure,
      socialNeed: cognitive.socialNeed,
      safetyConcern: cognitive.safetyConcern,
      curiosityDrive: cognitive.curiosityDrive,
      responsibilityDrive: cognitive.responsibilityDrive,
      comfortNeed: cognitive.comfortNeed,
      emotionalLoad: cognitive.emotionalLoad,
      beliefActivation: cognitive.beliefActivation,
      activeGoals: cognitive.activeGoals,
      activeMemories: cognitive.activeMemories,
      activeBeliefs: cognitive.activeBeliefs,
      desireCandidates: cognitive.desireCandidates,
      thoughtCandidates: cognitive.thoughtCandidates,
      perceptionWeights: cognitive.perceptionWeights,
      driveVector: cognitive.driveVector,
      biasVector: cognitive.biasVector,
      needDynamicsState: cognitive.needDynamicsState,
      needEmergencyFlag: cognitive.needEmergencyFlag,
      cognitiveProfile: cognitive.cognitiveProfile,
      socialModifier: cognitive.socialModifier,
      source: cognitive.source
    },
    socialFieldBias: socialField,
    socialFeedbackBias: socialFeedback,
    realityConstraint: constraint,
    goalDetails: goal.details,
    selfConsistencyDetails: selfConsistency.details,
    vectorDetails: vector.details,
    vectorCap
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
      scoreBreakdown: { need: 0, memory: 0, personality: 0, goal: 0, emotion: 0, social: 0, socialField: 0, socialFeedback: 0, consistency: 0, cognitiveFit: 0, eligibility: 0 }
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

function utilityDecision(world, agent, extras = {}) {
  const selfModel = ensureSelfModel(agent);
  const goalRuntime = normalizeGoalRuntime(agent, world);
  const memoryInfluence = extras.memoryInfluence || memoryInfluenceAgent(world, agent);
  const plan = extras.plan || currentPlanItem(world, agent);
  const interruption = extras.interruption || detectInterruption(world, agent);
  const personalityState = extras.personalityRuntime || personalityRuntime(world, agent, { plan, interruption, memoryInfluence });
  const cognitive = extras.cognitiveState || cognitiveState(world, agent, { plan, interruption, eventText: extras.eventText || "" });
  const priority = agentPriority(world, agent, { interruption });
  const vectorEnabled = world?.config?.vectorMemoryEnabled !== false;
  const vectorLimit = clamp(world?.config?.vectorMaxRecall, 1, 20, 6);
  const vectorRecall = vectorEnabled ? retrieveVectorMemories(agent, {
    clock: world?.clock || 0,
    type: interruption?.type || plan?.localAction || agent.currentTask || "",
    place: agent.position || agent.place || plan?.place || "",
    title: plan?.title || "",
    reason: interruption?.reason || "",
    currentTask: agent.currentTask || "",
    need: JSON.stringify(agent.needs || {}),
    emotion: JSON.stringify(agent.emotionVector || agent.emotions || {}),
    queryVector: extras.vectorQueryVector || extras.queryVector || null
  }, vectorLimit) : [];
  const rawActions = candidateActions(world, agent, { plan, interruption });
  const actionEligibilityResult = filterEligibleActions(world, agent, rawActions, { plan, interruption });
  const actions = actionEligibilityResult.actions;
  const scored = actions
    .map(action => scoreAction(world, agent, action, { plan, interruption, vectorRecall, memoryInfluence, personalityRuntime: personalityState, cognitiveState: cognitive }))
    .sort((a, b) => b.score - a.score);
  const temperature = cognitiveTemperature(agent, cognitive);
  const selected = softmaxPick(scored, `${agent.id}:${world?.clock || 0}:${priority.reason}`, temperature);
  const decisionTrace = decisionTraceFor(selected);
  const debugDecision = debugDecisionFor(selected);
  agent.debugDecision = debugDecision;
  return {
    agentId: agent.id,
    priority: priority.priority,
    priorityComponents: priority.components,
    priorityReason: priority.reason,
    selectedAction: selected,
    candidateActions: scored.slice(0, 12),
    actionEligibility: actionEligibilityResult,
    vectorRecall,
    structuredMemory: structuredMemoryForAgent(agent, 6),
    cognitiveState: cognitive,
    desireCandidates: cognitive.desireCandidates || [],
    activeBeliefs: cognitive.activeBeliefs || [],
    thoughtStream: cognitive.thoughtStream || [],
    selectionTemperature: temperature,
    personalityRuntime: personalityState,
    memoryInfluence,
    goalRuntime,
    selfModel,
    decisionTrace,
    debugDecision,
    plan,
    interruption,
    rule: "V3 score uses CognitiveState -> actionVector match -> mixed utility -> softmax. Needs shape attention, patience, risk and drive vectors; they do not directly select actions. AgentAction still makes the subjective choice, WorldMaster and StateSettlement decide what becomes real."
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
  personalityRuntime,
  personalityRuntimeBias,
  cognitiveState,
  actionVector,
  actionMatch,
  realityConstraint,
  cognitiveTemperature,
  goalBias,
  selfConsistencyBias,
  cognitiveFitForAction,
  scoreAction,
  softmaxPick,
  decisionTraceFor,
  debugDecisionFor,
  utilityDecision
};

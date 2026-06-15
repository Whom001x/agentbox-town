"use strict";

const { clamp, placeId } = require("./ai-town-sim-utils");

const NEED_KEYS = ["hunger", "hygiene", "health", "social", "responsibility", "stress", "comfort", "safety"];
const EMOTION_KEYS = ["happy", "anxious", "angry", "sad", "tired", "lonely", "hopeful", "calm", "curious"];
const ROUTE_ORDER = { accepted: 0, process: 1, downgrade: 2, blocked: 3 };

function visibleAgents(world, agent) {
  const here = placeId(agent);
  return (world?.agents || []).filter(item => item?.id && item.id !== agent.id && item.lifeStatus !== "dead" && placeId(item) === here);
}

function hasMedicalStaff(world, agent) {
  return visibleAgents(world, agent).some(item => /doctor|nurse|medical|clinic|医生|护士|医护|诊所|药房/.test(String(item.job || "")));
}

function hasServiceStaff(world, agent) {
  return visibleAgents(world, agent).some(item => /teacher|doctor|nurse|shop|store|staff|worker|guard|老师|教师|医生|护士|店|职员|保安|店员|老板|工作人员/.test(String(item.job || "")));
}

function judgeAction(world, agent, aiResult = {}, context = {}) {
  const action = aiResult?.action || {};
  const text = `${action.type || ""} ${action.summary || ""} ${action.currentTask || ""} ${context?.decision?.actionHint || ""}`;
  const here = placeId(agent);
  const result = {
    allowed: true,
    route: "accepted",
    reason: "ordinary_action",
    requiredFollowups: [],
    needDelta: {},
    emotionDelta: {},
    memoryWrites: [],
    visibleWitnesses: visibleAgents(world, agent).slice(0, 8).map(item => item.id)
  };

  if (agent?.lifeStatus === "dead" || agent?.terminalState?.dead) {
    result.allowed = false;
    result.route = "blocked";
    result.reason = "dead_agent";
    return result;
  }
  if (/死亡|复活|全镇|所有人都知道|瞬间|teleport|revive|everyone knows|dead/.test(text)) {
    result.allowed = false;
    result.route = "downgrade";
    result.reason = "forbidden_world_change";
    return result;
  }
  if (/clinic|medical|doctor|nurse|treat|diagnose|诊所|医院|医生|护士|治疗|看诊|检查/.test(text)) {
    if (here !== "clinic") {
      result.route = "process";
      result.reason = "must_reach_clinic_first";
      result.requiredFollowups.push("go_to_clinic");
      return result;
    }
    if (!hasMedicalStaff(world, agent)) {
      result.route = "process";
      result.reason = "waiting_for_medical_staff";
      result.requiredFollowups.push("wait_for_staff");
      result.needDelta = { safety: 2, stress: 1 };
      return result;
    }
    result.reason = "basic_medical_service_available";
    result.needDelta = { health: 6, safety: 4, stress: 3, comfort: 2 };
    result.memoryWrites.push({ layer: "short", text: "Received basic care at the clinic.", importance: 3 });
    return result;
  }
  if (/buy|sell|shop|store|purchase|买|卖|小卖部|商店|购买/.test(text)) {
    if (!/store|market|breakfast|restaurant/.test(here) && !hasServiceStaff(world, agent)) {
      result.route = "process";
      result.reason = "service_not_available_here";
      result.requiredFollowups.push("go_to_service_place");
      return result;
    }
    result.needDelta = { hunger: 8, comfort: 2 };
    result.reason = "basic_service_available";
    return result;
  }
  return result;
}

function normalizeDelta(delta = {}, keys = NEED_KEYS, limit = 8) {
  const result = {};
  Object.entries(delta || {}).forEach(([key, value]) => {
    if (!keys.includes(key)) return;
    const number = clamp(value, -limit, limit, 0);
    if (number) result[key] = number;
  });
  return result;
}

function mergeDelta(a = {}, b = {}, keys = NEED_KEYS, limit = 8) {
  const result = {};
  keys.forEach(key => {
    const value = clamp(Number(a[key] || 0) + Number(b[key] || 0), -limit, limit, 0);
    if (value) result[key] = value;
  });
  return result;
}

function normalizeMemoryWrites(items = []) {
  return (Array.isArray(items) ? items : [])
    .map(item => ({
      layer: ["short", "long", "emotional", "secret", "rumor"].includes(item?.layer) ? item.layer : "short",
      text: String(item?.text || "").slice(0, 180),
      importance: clamp(item?.importance, 1, 5, 3)
    }))
    .filter(item => item.text)
    .slice(0, 3);
}

function normalizeWorldMasterJudgement(raw = {}, fallback = {}) {
  const route = Object.prototype.hasOwnProperty.call(ROUTE_ORDER, raw.route) ? raw.route : fallback.route || "accepted";
  return {
    allowed: raw.allowed === undefined ? fallback.allowed !== false : raw.allowed !== false,
    route,
    reason: String(raw.reason || fallback.reason || "world_master_checked").slice(0, 160),
    requiredFollowups: Array.from(new Set([
      ...(Array.isArray(fallback.requiredFollowups) ? fallback.requiredFollowups : []),
      ...(Array.isArray(raw.requiredFollowups) ? raw.requiredFollowups : [])
    ].map(item => String(item || "").slice(0, 60)).filter(Boolean))).slice(0, 6),
    needDelta: normalizeDelta(raw.needDelta || fallback.needDelta || {}, NEED_KEYS, 8),
    emotionDelta: normalizeDelta(raw.emotionDelta || fallback.emotionDelta || {}, EMOTION_KEYS, 8),
    memoryWrites: normalizeMemoryWrites(raw.memoryWrites || fallback.memoryWrites || []),
    visibleWitnesses: Array.isArray(fallback.visibleWitnesses) ? fallback.visibleWitnesses.slice(0, 8) : []
  };
}

function mergeWorldMasterJudgement(local = {}, ai = {}) {
  const normalizedLocal = normalizeWorldMasterJudgement(local);
  if (!ai || typeof ai !== "object" || !Object.keys(ai).length) return normalizedLocal;
  const normalizedAi = normalizeWorldMasterJudgement(ai, normalizedLocal);
  const localHardBlock = normalizedLocal.allowed === false || normalizedLocal.route === "blocked" || ["dead_agent", "forbidden_world_change"].includes(normalizedLocal.reason);
  if (localHardBlock) {
    return {
      ...normalizedLocal,
      reason: [normalizedLocal.reason, normalizedAi.reason].filter(Boolean).join(" | ").slice(0, 180),
      requiredFollowups: Array.from(new Set([...(normalizedLocal.requiredFollowups || []), ...(normalizedAi.requiredFollowups || [])])).slice(0, 6)
    };
  }
  const route = ROUTE_ORDER[normalizedAi.route] > ROUTE_ORDER[normalizedLocal.route] ? normalizedAi.route : normalizedLocal.route;
  return {
    allowed: normalizedLocal.allowed !== false && normalizedAi.allowed !== false && route !== "blocked",
    route,
    reason: [normalizedLocal.reason, normalizedAi.reason].filter(Boolean).join(" | ").slice(0, 180),
    requiredFollowups: Array.from(new Set([...(normalizedLocal.requiredFollowups || []), ...(normalizedAi.requiredFollowups || [])])).slice(0, 6),
    needDelta: mergeDelta(normalizedLocal.needDelta, normalizedAi.needDelta, NEED_KEYS, 8),
    emotionDelta: mergeDelta(normalizedLocal.emotionDelta, normalizedAi.emotionDelta, EMOTION_KEYS, 8),
    memoryWrites: [...normalizeMemoryWrites(normalizedLocal.memoryWrites), ...normalizeMemoryWrites(normalizedAi.memoryWrites)].slice(0, 3),
    visibleWitnesses: normalizedLocal.visibleWitnesses || []
  };
}

function applyWorldMasterPatch(agent, judgement) {
  if (!judgement || !agent?.id) return;
  agent.worldMasterJudgement = {
    at: judgement.at || 0,
    allowed: judgement.allowed,
    route: judgement.route,
    reason: judgement.reason,
    requiredFollowups: judgement.requiredFollowups || []
  };
}

module.exports = {
  judgeAction,
  normalizeWorldMasterJudgement,
  mergeWorldMasterJudgement,
  applyWorldMasterPatch
};

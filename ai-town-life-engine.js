"use strict";

const { currentPlanItem, ensureDailyPlans, findPlace } = require("./ai-town-planner");
const { detectInterruption } = require("./ai-town-interruptions");
const { recordLifeEvent } = require("./ai-town-memory-stream");
const { clamp, placeId, isAlive } = require("./ai-town-sim-utils");

function adjustNeeds(agent, delta = {}) {
  agent.needs ||= {};
  Object.entries(delta).forEach(([key, value]) => {
    const before = Number(agent.needs[key] ?? 70);
    agent.needs[key] = clamp(before + Number(value || 0), 0, 100, before);
  });
}

function adjustEmotion(agent, delta = {}) {
  agent.emotionVector ||= agent.emotions || {};
  Object.entries(delta).forEach(([key, value]) => {
    const before = Number(agent.emotionVector[key] ?? 50);
    agent.emotionVector[key] = clamp(before + Number(value || 0), 0, 100, before);
  });
  agent.emotions = agent.emotionVector;
}

function startMovement(world, agent, to, reason, minutes = 30) {
  if (!to || to === placeId(agent) || agent.movement) return false;
  agent.movement = {
    from: placeId(agent),
    to,
    departAt: world.clock || 0,
    startedAt: world.clock || 0,
    arriveAt: Number(world.clock || 0) + clamp(minutes, 5, 120, 30),
    reason
  };
  return true;
}

function foodPlaces(world) {
  return ["apartment", "breakfast", "restaurant", "store", "market"].filter(id => (world.places || []).some(place => place.id === id));
}

function nearestFoodPlace(world, agent) {
  const current = placeId(agent);
  const options = foodPlaces(world);
  if (options.includes(current)) return current;
  return options[0] || findPlace(world, ["apartment", "home"], current || "apartment");
}

function canEatAt(world, agent) {
  return nearestFoodPlace(world, agent) === placeId(agent);
}

function placeName(world, id) {
  const place = (world?.places || []).find(item => item?.id === id);
  return place?.name || id || "当前位置";
}

function localSummary(agent, text) {
  return `${agent.name || agent.id}：${text}`;
}

function executeInterruption(world, agent, interruption) {
  const here = placeId(agent);
  const home = findPlace(world, ["apartment", "home", "residence"], here || "apartment");
  const clinic = findPlace(world, ["clinic", "hospital", "medical"], home);
  const safePlace = home || findPlace(world, ["square", "school", "office"], here);
  let action = null;

  if (interruption.type === "hunger") {
    const food = nearestFoodPlace(world, agent);
    if (food && food !== here) {
      startMovement(world, agent, food, "life_hunger");
      agent.currentTask = "去吃点东西";
      action = { type: "move_for_food", summary: localSummary(agent, `去${placeName(world, food)}吃点东西`) };
    } else {
      adjustNeeds(agent, { hunger: 32, comfort: 3, stress: 2 });
      adjustEmotion(agent, { angry: -2, tired: -1, calm: 1 });
      agent.currentTask = "简单吃点东西";
      action = { type: "eat", summary: localSummary(agent, "简单吃点东西") };
    }
  } else if (interruption.type === "health") {
    if (clinic && clinic !== here) {
      startMovement(world, agent, clinic, "life_health");
      agent.currentTask = "去诊所看看";
      action = { type: "move_for_health", summary: localSummary(agent, `去${placeName(world, clinic)}看看身体状况`) };
    } else {
      adjustNeeds(agent, { health: 4, safety: 4, comfort: 2, stress: 2 });
      agent.currentTask = "休息观察身体";
      action = { type: "health_rest", summary: localSummary(agent, "停下来休息，观察身体状况") };
    }
  } else if (interruption.type === "safety") {
    if (safePlace && safePlace !== here) {
      startMovement(world, agent, safePlace, "life_safety");
      agent.currentTask = "去更安全的地方";
      action = { type: "move_for_safety", summary: localSummary(agent, `去${placeName(world, safePlace)}避开风险`) };
    } else {
      adjustNeeds(agent, { safety: 8, comfort: 2, stress: 2 });
      agent.currentTask = "留在原地避开风险";
      action = { type: "stay_safe", summary: localSummary(agent, "留在原地，避开明显风险") };
    }
  } else if (interruption.type === "fatigue") {
    if (home && home !== here) {
      startMovement(world, agent, home, "life_fatigue");
      agent.currentTask = "回家休息";
      action = { type: "move_for_rest", summary: localSummary(agent, "回家休息") };
    } else {
      agent.energy = clamp(Number(agent.energy ?? 50) + 10, 0, 100, 50);
      adjustNeeds(agent, { comfort: 5, stress: 4 });
      adjustEmotion(agent, { tired: -4, calm: 2 });
      agent.currentTask = "短暂休息";
      action = { type: "rest", summary: localSummary(agent, "短暂休息一下") };
    }
  } else if (interruption.type === "hygiene") {
    if (home && home !== here) {
      startMovement(world, agent, home, "life_hygiene");
      agent.currentTask = "回家收拾一下";
      action = { type: "move_for_hygiene", summary: localSummary(agent, "回家洗漱整理") };
    } else {
      adjustNeeds(agent, { hygiene: 28, comfort: 4, social: 1 });
      agent.currentTask = "洗漱整理";
      action = { type: "clean_up", summary: localSummary(agent, "简单洗漱整理") };
    }
  }

  if (action) {
    recordLifeEvent(world, agent, {
      interruption,
      summary: action.summary,
      type: action.type,
      importance: interruption.priority >= 85 ? 4 : 3
    });
  }
  return action;
}

function planNeedsAi(plan) {
  const text = `${plan?.title || ""} ${plan?.localAction || ""}`;
  return /talk|chat|argue|apolog|comfort|conflict|visit|discuss|negotiate|teach_one|diagnose|relationship|rumor|secret|对话|聊天|争吵|道歉|安慰|冲突|商量|诊断|关系|流言/.test(text);
}

function executePlan(world, agent, plan) {
  if (!plan) return null;
  if (planNeedsAi(plan)) return null;
  const here = placeId(agent);
  if (plan.place && plan.place !== here) {
    startMovement(world, agent, plan.place, "daily_plan");
    agent.currentTask = `前往${plan.title}`;
    const action = { type: "plan_move", summary: localSummary(agent, `去${placeName(world, plan.place)}处理「${plan.title}」`), plan };
    recordLifeEvent(world, agent, { plan, summary: action.summary, type: action.type, importance: plan.fixed ? 3 : 2 });
    return action;
  }

  const localAction = String(plan.localAction || "maintain");
  if (localAction === "meal" && canEatAt(world, agent)) {
    adjustNeeds(agent, { hunger: 22, comfort: 3, stress: 1 });
  } else if (localAction === "sleep") {
    agent.isSleeping = true;
    agent.energy = clamp(Number(agent.energy ?? 60) + 8, 0, 100, 60);
    adjustNeeds(agent, { stress: 3, comfort: 2, hunger: -1 });
  } else if (localAction === "rest") {
    agent.energy = clamp(Number(agent.energy ?? 60) + 5, 0, 100, 60);
    adjustNeeds(agent, { stress: 2, comfort: 3 });
  } else if (["work", "study", "homework", "maintain"].includes(localAction)) {
    adjustNeeds(agent, { responsibility: plan.fixed ? 2 : 1, stress: -0.5, hunger: -0.5 });
  }
  agent.currentTask = plan.title;
  const action = { type: `plan_${localAction}`, summary: localSummary(agent, `按计划进行「${plan.title}」`), plan };
  recordLifeEvent(world, agent, { plan, summary: action.summary, type: action.type, importance: plan.fixed ? 3 : 2 });
  return action;
}

function runLifeEngine(world, options = {}) {
  ensureDailyPlans(world);
  const localActions = [];
  const aiCandidates = [];
  const handledIds = new Set();
  const maxLocalActions = clamp(options.maxLocalActions, 1, 10000, 10000);

  for (const agent of world.agents || []) {
    if (!isAlive(agent)) continue;
    if (localActions.length >= maxLocalActions) break;
    if (agent.movement) continue;
    const interruption = detectInterruption(world, agent);
    const plan = currentPlanItem(world, agent);
    let action = null;

    if (interruption?.canOverridePlan) action = executeInterruption(world, agent, interruption);
    if (!action && plan) action = executePlan(world, agent, plan);

    if (action) {
      handledIds.add(agent.id);
      localActions.push({
        agentId: agent.id,
        agentName: agent.name || agent.id,
        clock: world.clock || 0,
        interruption,
        plan,
        ...action
      });
    } else if (interruption || planNeedsAi(plan)) {
      aiCandidates.push({ agentId: agent.id, interruption, plan });
    }
  }

  world.lifeEngineState ||= {};
  world.lifeEngineState.lastRunClock = world.clock || 0;
  world.lifeEngineState.localActions = localActions.slice(0, 80);
  world.lifeEngineState.aiCandidates = aiCandidates.slice(0, 80);
  return {
    localActions,
    aiCandidates,
    handledIds: Array.from(handledIds)
  };
}

module.exports = {
  runLifeEngine,
  executeInterruption,
  executePlan
};

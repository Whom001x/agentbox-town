"use strict";

const { currentPlanItem } = require("./ai-town-planner");
const { detectInterruption } = require("./ai-town-interruptions");
const { retrieveRelevantMemories } = require("./ai-town-memory-stream");

function num(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function needsComplexAi(plan, interruption, agent) {
  const text = `${plan?.title || ""} ${plan?.localAction || ""} ${interruption?.actionHint || ""} ${agent?.currentTask || ""}`;
  return /talk|chat|argue|apolog|comfort|conflict|visit|discuss|negotiate|diagnose|relationship|rumor|secret|对话|聊天|争吵|道歉|安慰|冲突|商量|诊断|关系|流言/.test(text);
}

function aggregateDecision(world, agent, extras = {}) {
  if (!agent?.id || agent.lifeStatus === "dead" || agent.terminalState?.dead) {
    return { route: "skip", priority: 0, reason: "dead", actionHint: "skip" };
  }
  if (agent.movement) {
    return { route: "skip", priority: 20, reason: "movement_in_progress", actionHint: "continue_movement" };
  }
  const plan = extras.plan || currentPlanItem(world, agent);
  const interruption = extras.interruption || detectInterruption(world, agent);
  const memories = retrieveRelevantMemories(agent, {
    clock: world?.clock || 0,
    type: interruption?.type || plan?.localAction || "",
    place: plan?.place || agent.position || "",
    title: plan?.title || "",
    reason: interruption?.reason || ""
  }, 5);
  const eventBoost = Array.isArray(agent.eventQueue) && agent.eventQueue.length ? 18 : 0;
  const processBoost = agent.activeProcess ? 16 : 0;
  const memoryBoost = memories.reduce((sum, item) => sum + Math.min(8, num(item.importance, 1)), 0);
  const planPriority = plan ? num(plan.priority, plan.fixed ? 75 : 45) : 0;
  const interruptionPriority = interruption ? num(interruption.priority, 0) : 0;
  const priority = Math.max(planPriority, interruptionPriority, eventBoost, processBoost) + Math.min(18, memoryBoost);

  let route = "skip";
  let actionHint = "idle";
  let reason = "no_due_decision";
  if (interruption) {
    actionHint = interruption.actionHint || interruption.type;
    reason = `${interruption.type}_interrupt`;
    route = needsComplexAi(plan, interruption, agent) ? "ai" : "local";
  } else if (agent.activeProcess) {
    route = "ai";
    actionHint = "continue_process";
    reason = "active_process";
  } else if (Array.isArray(agent.eventQueue) && agent.eventQueue.length) {
    route = "ai";
    actionHint = "handle_event_queue";
    reason = "event_queue";
  } else if (plan) {
    actionHint = plan.localAction || "follow_plan";
    reason = plan.fixed ? "fixed_plan" : "daily_plan";
    route = needsComplexAi(plan, null, agent) ? "ai" : "local";
  }

  if (route === "local" && extras.localAlreadyHandled) route = "skip";
  if (route === "ai" && /clinic|diagnose|medical|doctor|nurse|service|诊所|医生|护士|治疗|服务/.test(`${actionHint} ${plan?.title || ""}`)) {
    route = "worldMaster";
  }
  return {
    route,
    priority: Math.round(priority),
    actionHint,
    reason,
    plan,
    interruption,
    relevantMemories: memories
  };
}

module.exports = {
  aggregateDecision
};

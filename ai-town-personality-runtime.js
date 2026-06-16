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

function add(map, key, value) {
  if (!key || !Number.isFinite(Number(value))) return;
  map[key] = Number((num(map[key], 0) + Number(value)).toFixed(2));
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

function relationshipStats(agent = {}) {
  const values = Object.values(agent.relationshipMatrix || agent.relationships || agent.relations || {});
  if (!values.length) return { trust: 0, intimacy: 0, resentment: 0, dependency: 0, count: 0 };
  const totals = values.reduce((sum, rel) => {
    if (typeof rel === "number") {
      sum.trust += rel;
      sum.intimacy += rel * 0.5;
      return sum;
    }
    sum.trust += num(rel.trust, 0);
    sum.intimacy += num(rel.intimacy, 0);
    sum.resentment += num(rel.resentment, 0);
    sum.dependency += num(rel.dependency, 0);
    return sum;
  }, { trust: 0, intimacy: 0, resentment: 0, dependency: 0 });
  return {
    trust: totals.trust / values.length,
    intimacy: totals.intimacy / values.length,
    resentment: totals.resentment / values.length,
    dependency: totals.dependency / values.length,
    count: values.length
  };
}

function memoryRuntimeSignals(agent = {}) {
  const structured = structuredMemoryForAgent(agent, 8);
  const actionBias = {};
  const avoidance = {};
  const evidence = [];
  Object.entries(structured).forEach(([type, items]) => {
    items.forEach(item => {
      const text = `${item.text || ""} ${item.meaning || ""} ${(item.tags || []).join(" ")}`.toLowerCase();
      const strength = clamp(num(item.strength, 50), 0, 100, 50) / 100;
      const importance = clamp(num(item.importance, 3), 1, 5, 3) / 5;
      const weight = 6 + strength * 12 + importance * 10;
      if (includesAny(text, ["health", "clinic", "doctor", "sick", "medical"])) add(actionBias, "seek_care", weight);
      if (includesAny(text, ["safe", "risk", "danger", "fear"])) {
        add(actionBias, "seek_safety", weight);
        add(avoidance, "walk_nearby", weight * 0.45);
      }
      if (includesAny(text, ["rest", "sleep", "quiet", "tired", "recover"])) add(actionBias, "rest", weight * 0.8);
      if (includesAny(text, ["friend", "family", "trust", "help", "neighbor"])) add(actionBias, "contact_familiar", weight * 0.75);
      if (includesAny(text, ["work", "study", "class", "promise", "duty", "responsib"])) add(actionBias, "follow_plan", weight * 0.85);
      if (includesAny(text, ["goal", "future", "plan"])) add(actionBias, "think_and_plan", weight * 0.65);
      if (evidence.length < 6 && (item.text || item.meaning)) {
        evidence.push({ type, text: String(item.text || item.meaning).slice(0, 120), weight: Number(weight.toFixed(2)) });
      }
    });
  });
  return { actionBias, avoidance, evidence };
}

function personalityRuntime(world = {}, agent = {}, extras = {}) {
  const selfModel = ensureSelfModel(agent);
  const goals = normalizeGoalRuntime(agent, world);
  const emotions = agent.emotionVector || agent.emotions || {};
  const emotionCauses = Array.isArray(agent.emotionCause) ? agent.emotionCause.slice(0, 8) : [];
  const relations = relationshipStats(agent);
  const memorySignals = memoryRuntimeSignals(agent);
  const actionBias = { ...memorySignals.actionBias };
  const avoidance = { ...memorySignals.avoidance };
  const motivation = {};
  const text = `${textOf(agent.identityCore)} ${textOf(agent.personalityProfile)} ${textOf(selfModel)}`.toLowerCase();

  let socialDrive = 0.35 + clamp((100 - num(agent.needs?.social, 70)) / 100, 0, 1, 0) * 0.35;
  let riskTolerance = 0.45;
  let responsibilityDrive = 0.35 + clamp((100 - num(agent.needs?.responsibility, 75)) / 100, 0, 1, 0) * 0.25;

  if (includesAny(text, ["introvert", "quiet", "cautious", "alone"])) {
    add(actionBias, "rest", 10);
    add(actionBias, "think_and_plan", 8);
    add(actionBias, "observe_environment", 7);
    add(avoidance, "contact_familiar", 5);
    socialDrive -= 0.12;
    riskTolerance -= 0.08;
  }
  if (includesAny(text, ["extrovert", "social", "open", "warm"])) {
    add(actionBias, "contact_familiar", 11);
    add(actionBias, "walk_nearby", 7);
    socialDrive += 0.18;
  }
  if (includesAny(text, ["reliable", "responsib", "promise", "duty", "stable"])) {
    add(actionBias, "follow_plan", 12);
    add(actionBias, "continue_process", 8);
    add(avoidance, "walk_nearby", 4);
    responsibilityDrive += 0.24;
  }
  if (includesAny(text, ["health", "body", "medical"])) {
    add(actionBias, "seek_care", 10);
    add(actionBias, "rest", 6);
  }
  if (includesAny(text, ["family", "care"])) {
    add(actionBias, "contact_familiar", 7);
    socialDrive += 0.08;
  }
  if (includesAny(text, ["fear", "unsafe", "loss", "risk"])) {
    add(actionBias, "seek_safety", 8);
    add(avoidance, "walk_nearby", 5);
    riskTolerance -= 0.12;
  }

  const tired = num(emotions.tired, 0);
  const lonely = num(emotions.lonely, 0);
  const anxious = num(emotions.anxious, 0);
  const angry = num(emotions.angry, 0);
  const hopeful = num(emotions.hopeful, 0);
  if (tired > 55) {
    add(actionBias, "rest", (tired - 50) * 0.35);
    motivation.recovery = clamp((tired - 40) / 60, 0, 1, 0);
  }
  if (lonely > 50) {
    add(actionBias, "contact_familiar", (lonely - 45) * 0.28);
    socialDrive += (lonely - 50) / 220;
  }
  if (anxious > 50) {
    add(actionBias, "seek_safety", (anxious - 45) * 0.22);
    add(actionBias, "observe_environment", (anxious - 45) * 0.12);
    riskTolerance -= (anxious - 50) / 260;
  }
  if (angry > 60) {
    add(avoidance, "contact_familiar", (angry - 55) * 0.18);
    riskTolerance += (angry - 60) / 320;
  }
  if (hopeful > 55) {
    add(actionBias, "think_and_plan", (hopeful - 50) * 0.18);
    add(actionBias, "follow_plan", (hopeful - 50) * 0.12);
  }

  (goals.goals || []).forEach(goal => {
    const textGoal = `${goal.name || ""} ${goal.title || ""} ${(goal.blockedBy || []).join(" ")}`.toLowerCase();
    const weight = clamp(num(goal.priority, 0.5), 0, 1, 0.5) * 18;
    if (includesAny(textGoal, ["health", "medical"])) add(actionBias, "seek_care", weight);
    if (includesAny(textGoal, ["family", "friend", "social"])) add(actionBias, "contact_familiar", weight * 0.75);
    if (includesAny(textGoal, ["work", "study", "class", "duty"])) add(actionBias, "follow_plan", weight);
    if (num(goal.frustration, 0) > 0.35) add(actionBias, "think_and_plan", weight * 0.45);
  });

  if (relations.count) {
    socialDrive += clamp(relations.trust / 100, 0, 1, 0) * 0.15;
    if (relations.resentment > 45) add(avoidance, "contact_familiar", 8);
    if (relations.dependency > 40 || relations.trust > 60) add(actionBias, "contact_familiar", 6);
  } else {
    socialDrive -= 0.08;
  }

  if (emotionCauses.some(item => /health|sick|medical|body/i.test(`${item.emotion} ${(item.causes || []).join(" ")}`))) {
    add(actionBias, "seek_care", 6);
  }
  if (emotionCauses.some(item => /promise|work|study|duty/i.test(`${item.emotion} ${(item.causes || []).join(" ")}`))) {
    add(actionBias, "follow_plan", 5);
  }

  motivation.health = clamp((100 - num(agent.needs?.health, 75)) / 100, 0, 1, 0);
  motivation.safety = clamp((100 - num(agent.needs?.safety, 80)) / 100, 0, 1, 0);
  motivation.social = clamp(socialDrive, 0, 1, 0);
  motivation.responsibility = clamp(responsibilityDrive, 0, 1, 0);
  motivation.goal = clamp((goals.goals || []).reduce((max, goal) => Math.max(max, num(goal.priority, 0)), 0), 0, 1, 0);

  const result = {
    agentId: agent.id || "",
    actionBias,
    avoidance,
    motivation,
    socialDrive: Number(clamp(socialDrive, 0, 1, 0).toFixed(3)),
    riskTolerance: Number(clamp(riskTolerance, 0, 1, 0).toFixed(3)),
    responsibilityDrive: Number(clamp(responsibilityDrive, 0, 1, 0).toFixed(3)),
    currentSelfView: selfModel.currentSelfView || "",
    evidence: memorySignals.evidence,
    source: "personality-runtime-v2.5.1"
  };
  agent.personalityRuntime = result;
  return result;
}

function personalityRuntimeBias(runtime = {}, action = {}) {
  const id = action.id || "";
  const tags = new Set([id, action.targetNeed, action.targetPlace, ...(action.tags || [])].filter(Boolean));
  let score = num(runtime.actionBias?.[id], 0) - num(runtime.avoidance?.[id], 0);
  if (tags.has("social")) score += num(runtime.socialDrive, 0.35) * 8 - 3;
  if (tags.has("responsibility") || id === "follow_plan") score += num(runtime.responsibilityDrive, 0.35) * 9;
  if (tags.has("health")) score += num(runtime.motivation?.health, 0) * 8;
  if (tags.has("safety")) score += num(runtime.motivation?.safety, 0) * 8;
  if ((action.risk || 0) > 0) score -= (1 - num(runtime.riskTolerance, 0.45)) * num(action.risk, 0);
  return Number(score.toFixed(2));
}

module.exports = {
  personalityRuntime,
  personalityRuntimeBias
};

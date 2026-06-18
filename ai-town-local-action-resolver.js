"use strict";

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max, fallback = min) {
  const n = num(value, fallback);
  return Math.max(min, Math.min(max, n));
}

function textOf(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function placeId(agent = {}) {
  return String(agent.position || agent.place || agent.location || "");
}

function findPlace(world = {}, patterns = [], fallback = "") {
  const places = Array.isArray(world.places) ? world.places : [];
  for (const pattern of patterns) {
    const match = places.find(place => pattern.test(`${place.id || ""} ${place.name || ""} ${place.type || ""}`));
    if (match?.id) return String(match.id);
  }
  return fallback;
}

function candidateAction(candidate = {}) {
  return candidate.utilityDecision?.selectedAction
    || candidate.decision?.selectedAction
    || candidate.utilityAction
    || candidate.action
    || null;
}

function familiarTarget(agent = {}) {
  const entries = Object.entries(agent.relationshipMatrix || agent.relations || {})
    .map(([id, rel]) => {
      const trust = typeof rel === "number" ? rel : num(rel?.trust ?? rel?.affinity ?? rel?.familiarity, 0);
      const familiarity = typeof rel === "number" ? rel : num(rel?.familiarity ?? rel?.intimacy ?? rel?.trust, 0);
      return { id, score: trust * 0.65 + familiarity * 0.35 };
    })
    .filter(item => item.id && item.id !== agent.id)
    .sort((a, b) => b.score - a.score);
  return entries[0]?.id || "";
}

function baseAction(agent, actionId, fields = {}) {
  const summary = fields.summary || "我先选择一个低风险的小行动，保持当前生活节奏。";
  const task = fields.currentTask || summary;
  const reason = fields.reason || actionId || "local_policy";
  return {
    action: {
      type: fields.type || "wait",
      actionId,
      summary,
      newLocation: fields.newLocation || "",
      mood: fields.mood || "谨慎",
      internalState: {
        desire: fields.desire || task,
        thought: fields.thought || "我先根据当前状态做一个稳妥选择。",
        worry: fields.worry || "",
        expectation: fields.expectation || "希望先把当前状态稳定下来。",
        hesitation: fields.hesitation || "",
        preference: fields.preference || "",
        interpretation: fields.interpretation || "这是我基于当前可见状态做出的临时判断。"
      },
      intent: {
        want: task,
        reason,
        emotion: fields.intentEmotion || "平稳"
      },
      emotionDelta: fields.emotionDelta || {},
      needDelta: fields.needDelta || {},
      currentTask: task,
      actionSteps: fields.actionSteps || [
        { title: task, status: "doing", reason }
      ],
      processUpdate: fields.processUpdate || {
        goal: task,
        stage: fields.stage || "execute",
        progressDelta: clamp(fields.progressDelta, 0, 35, 10),
        currentStep: task,
        completedSteps: [],
        blockedBy: "",
        finished: false
      },
      memory: fields.memory || {
        layer: "short",
        text: summary,
        importance: 1
      },
      relationChanges: fields.relationChanges || [],
      newEvents: fields.newEvents || [],
      sourceType: "local",
      source: "local_policy",
      reason,
      confidence: clamp(fields.confidence, 0, 1, 0.65)
    }
  };
}

function actionFromSelected(world = {}, agent = {}, selected = null, plan = null) {
  if (!selected?.id) return null;
  const targetPlace = selected.targetPlace || plan?.place || "";
  const current = placeId(agent);
  if (selected.id === "seek_care") {
    const clinic = findPlace(world, [/clinic|medical|doctor|诊所|医院|医务/], targetPlace);
    return baseAction(agent, "seek_care", {
      type: clinic && clinic !== current ? "move" : "wait",
      newLocation: clinic && clinic !== current ? clinic : "",
      summary: clinic && clinic !== current ? "我先去诊所处理身体不适。" : "我先在当前地点等待医疗处理或观察身体状态。",
      currentTask: "处理健康问题",
      reason: "health_low",
      confidence: 0.72
    });
  }
  if (selected.id === "seek_safety" || selected.id === "return_home") {
    const home = findPlace(world, [/apartment|home|house|residence|宿舍|家|公寓|住宅/], targetPlace || agent.homePlace || agent.home);
    return baseAction(agent, "seek_safety", {
      type: home && home !== current ? "move" : "wait",
      newLocation: home && home !== current ? home : "",
      summary: home && home !== current ? "我先去更安全熟悉的地方。" : "我先留在当前较安全的位置，避免继续冒险。",
      currentTask: "优先保证安全",
      reason: "safety_low",
      confidence: 0.72
    });
  }
  if (selected.id === "eat_or_buy_food") {
    const food = findPlace(world, [/breakfast|restaurant|market|shop|store|food|bakery|早餐|餐馆|市场|商店|小卖|面包/], targetPlace);
    return baseAction(agent, "eat_or_buy_food", {
      type: food && food !== current ? "move" : "wait",
      newLocation: food && food !== current ? food : "",
      summary: food && food !== current ? "我先找一个能吃东西的地方。" : "我先处理饱腹问题，等待合适的进食机会。",
      currentTask: "处理饱腹问题",
      reason: "hunger_low",
      confidence: 0.68
    });
  }
  if (selected.id === "rest") {
    const home = findPlace(world, [/apartment|home|house|residence|宿舍|家|公寓|住宅/], targetPlace || agent.homePlace || agent.home || current);
    return baseAction(agent, "rest", {
      type: home && home !== current ? "move" : "wait",
      newLocation: home && home !== current ? home : "",
      summary: home && home !== current ? "我先回到适合休息的地方。" : "我先暂停下来恢复精力。",
      currentTask: "休息恢复",
      reason: "energy_low",
      confidence: 0.66
    });
  }
  if (selected.id === "tidy_or_clean") {
    return baseAction(agent, "tidy_or_clean", {
      type: "react",
      summary: "我先整理清洁身边能处理的部分。",
      currentTask: "整理和清洁",
      reason: "hygiene_low",
      confidence: 0.62
    });
  }
  if (selected.id === "contact_familiar") {
    const target = familiarTarget(agent);
    return baseAction(agent, "contact_familiar", {
      type: "talk",
      summary: target ? "我先联系一个熟悉的人确认情况。" : "我先尝试寻找可以联系的熟人。",
      currentTask: "联系熟悉的人",
      reason: "social_low",
      confidence: 0.58,
      relationChanges: target ? [{ to: target, delta: 0, reason: "local contact attempt" }] : []
    });
  }
  if (selected.id === "follow_plan" || selected.id === "continue_process") {
    const target = targetPlace || "";
    return baseAction(agent, selected.id, {
      type: selected.type || (/move|commute/.test(String(plan?.localAction || "")) ? "move" : "work"),
      newLocation: target && target !== current ? target : "",
      summary: plan?.title ? `我继续推进计划：${String(plan.title).slice(0, 40)}。` : "我继续推进当前未完成的安排。",
      currentTask: plan?.title || selected.label || "继续当前安排",
      reason: selected.id === "continue_process" ? "active_process" : "plan_follow",
      confidence: 0.6
    });
  }
  if (selected.id === "walk_nearby") {
    return baseAction(agent, "walk_nearby", {
      type: "move",
      summary: "我先在附近做低风险移动，观察周围情况。",
      currentTask: "附近走动",
      reason: "low_risk_exploration",
      confidence: 0.54
    });
  }
  return null;
}

function resolveLocalAction(world = {}, agent = {}, candidate = {}, options = {}) {
  const needs = agent.needs || {};
  const emotion = agent.emotionVector || agent.emotions || {};
  const plan = candidate.currentPlanItem || candidate.plan || null;
  const interruption = candidate.interruption || null;
  const selected = candidateAction(candidate);
  const current = placeId(agent);
  const clinic = findPlace(world, [/clinic|medical|doctor|诊所|医院|医务/], "clinic");
  const home = findPlace(world, [/apartment|home|house|residence|宿舍|家|公寓|住宅/], agent.homePlace || agent.home || current);
  const food = findPlace(world, [/breakfast|restaurant|market|shop|store|food|bakery|早餐|餐馆|市场|商店|小卖|面包/], "breakfast");

  let resolved = null;
  if (interruption?.type === "health" || num(needs.health, 100) < 20) {
    resolved = actionFromSelected(world, agent, { id: "seek_care", targetPlace: clinic, type: "move" }, plan);
  } else if (interruption?.type === "safety" || num(needs.safety, 100) < 20) {
    resolved = actionFromSelected(world, agent, { id: "seek_safety", targetPlace: home, type: "move" }, plan);
  } else if (interruption?.type === "hunger" || num(needs.hunger, 100) < 10) {
    resolved = actionFromSelected(world, agent, { id: "eat_or_buy_food", targetPlace: food, type: "move" }, plan);
  } else if (selected) {
    resolved = actionFromSelected(world, agent, selected, plan);
  }

  if (!resolved && (num(agent.energy, 70) < 35 || num(emotion.tired, 0) > 65 || num(needs.comfort, 100) < 35)) {
    resolved = actionFromSelected(world, agent, { id: "rest", targetPlace: home, type: "wait" }, plan);
  }
  if (!resolved && num(needs.hunger, 100) < 45) {
    resolved = actionFromSelected(world, agent, { id: "eat_or_buy_food", targetPlace: food, type: "move" }, plan);
  }
  if (!resolved && num(needs.hygiene, 100) < 45) {
    resolved = actionFromSelected(world, agent, { id: "tidy_or_clean", type: "react" }, plan);
  }
  if (!resolved && plan) {
    resolved = actionFromSelected(world, agent, { id: "follow_plan", type: /move|commute/.test(String(plan.localAction || "")) ? "move" : "work", targetPlace: plan.place || "" }, plan);
  }
  if (!resolved && num(needs.social, 100) < 45) {
    resolved = actionFromSelected(world, agent, { id: "contact_familiar", type: "talk" }, plan);
  }
  if (!resolved) {
    resolved = baseAction(agent, "observe_environment", {
      type: "observe",
      summary: "我先观察当前环境，保持低风险行动。",
      currentTask: "观察环境",
      reason: "safe_observation",
      confidence: 0.5
    });
  }

  resolved.action.sourceType = "local";
  resolved.action.source = "local_policy";
  resolved.action.recovery = {
    reason: resolved.action.reason || "local_policy",
    attempts: clamp(options.attempts, 0, 10, 0),
    errors: Array.isArray(options.errors) ? options.errors.slice(-3).map(error => ({
      type: String(error?.type || "unknown").slice(0, 60)
    })) : []
  };
  resolved.recovery = {
    sourceType: "local",
    source: "local_policy",
    reason: resolved.action.reason || "local_policy",
    attempts: resolved.action.recovery.attempts,
    errors: resolved.action.recovery.errors,
    selectedUtilityAction: selected ? {
      id: selected.id || "",
      type: selected.type || "",
      score: selected.score
    } : null
  };
  return resolved;
}

module.exports = {
  resolveLocalAction
};

"use strict";

const layers = ["short", "long", "emotional", "secret", "rumor"];

function ensureMemory(agent) {
  agent.memory ||= {};
  layers.forEach(layer => {
    if (!Array.isArray(agent.memory[layer])) agent.memory[layer] = [];
  });
  return agent.memory;
}

function appendMemory(agent, memory = {}) {
  if (!agent?.id) return null;
  const store = ensureMemory(agent);
  const layer = layers.includes(memory.layer) ? memory.layer : "short";
  const text = String(memory.text || "").trim();
  if (!text) return null;
  const at = Number(memory.at || 0);
  const dedupeKey = memory.dedupeKey || `${layer}:${text}`;
  if (store[layer].some(item => item?.dedupeKey === dedupeKey || item?.text === text)) return null;
  const item = {
    id: memory.id || `mem_${agent.id}_${at}_${Math.random().toString(36).slice(2, 8)}`,
    at,
    layer,
    text: text.slice(0, 220),
    importance: Math.max(1, Math.min(5, Number(memory.importance || 3))),
    source: memory.source || "memory-stream",
    visibility: memory.visibility || "self",
    tags: Array.isArray(memory.tags) ? memory.tags.slice(0, 8) : [],
    dedupeKey
  };
  store[layer].unshift(item);
  store[layer] = store[layer].slice(0, layer === "short" ? 40 : 60);
  return item;
}

function cleanReflectionText(text = "") {
  return String(text || "")
    .replace(/^(Daily reflection:\s*)+/i, "")
    .replace(/^Because of health, interrupted the plan:\s*/i, "身体不适，临时调整安排：")
    .replace(/^Because of hunger, interrupted the plan:\s*/i, "饱腹不足，临时调整安排：")
    .replace(/^Because of safety, interrupted the plan:\s*/i, "安全感不足，临时调整安排：")
    .replace(/^Followed the plan\s+"([^"]+)":\s*/i, "按计划「$1」：")
    .trim();
}

function interruptionLabel(type = "") {
  return {
    health: "身体状态",
    hunger: "饱腹状态",
    safety: "安全感",
    fatigue: "疲惫",
    hygiene: "清洁",
    comfort: "舒适",
    emotion: "情绪"
  }[type] || type || "状态";
}

function shouldSkipRoutineMemory(detail = {}) {
  if (detail.interruption) return false;
  const type = String(detail.type || "");
  const importance = Number(detail.importance || 2);
  return importance <= 2 && /plan_maintain|plan_work|plan_study/.test(type);
}

function recordPlanMemory(world, agent, detail = {}) {
  if (shouldSkipRoutineMemory(detail)) return null;
  const plan = detail.plan;
  const interruption = detail.interruption;
  const summary = String(detail.summary || "").trim();
  if (!summary) return null;
  const prefix = interruption
    ? `${interruptionLabel(interruption.type)}太低，临时调整安排`
    : plan
      ? `按计划「${plan.title}」`
      : "完成一件日常小事";
  return appendMemory(agent, {
    at: world?.clock || 0,
    layer: detail.layer || "short",
    text: cleanReflectionText(`${prefix}：${summary}`),
    importance: detail.importance || (interruption ? 4 : 2),
    source: detail.source || "life-engine",
    tags: [detail.type || "life", interruption?.type, plan?.localAction].filter(Boolean),
    dedupeKey: `${world?.clock || 0}:${agent?.id}:${detail.type || "life"}:${plan?.title || interruption?.type || summary}`
  });
}

function retrieveRelevantMemories(agent, context = {}, limit = 6) {
  const memory = ensureMemory(agent);
  const query = String([context.type, context.place, context.title, context.reason].filter(Boolean).join(" ")).toLowerCase();
  return layers
    .flatMap(layer => memory[layer].map(item => ({ ...item, layer })))
    .map(item => {
      const text = String(item.text || "").toLowerCase();
      const relevance = query && text ? query.split(/\s+/).filter(token => token && text.includes(token)).length : 0;
      const recency = Math.max(0, 5 - Math.floor((Number(context.clock || 0) - Number(item.at || 0)) / 1440));
      const score = Number(item.importance || 1) * 2 + relevance * 3 + recency;
      return { ...item, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function summarizeTopMemories(agent, clock = 0, limit = 8) {
  const memory = ensureMemory(agent);
  return layers
    .flatMap(layer => memory[layer].map(item => ({ ...item, layer })))
    .map(item => {
      const ageDays = Math.max(0, Math.floor((Number(clock || 0) - Number(item.at || 0)) / 1440));
      const recency = Math.max(0, 5 - ageDays);
      const score = Number(item.importance || 1) * 2 + recency + (item.layer === "emotional" ? 2 : 0);
      return { ...item, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function runDailyReflection(world, options = {}) {
  const clock = Number(world?.clock || 0);
  const day = Math.floor(clock / 1440);
  const updated = [];
  (world?.agents || []).forEach(agent => {
    if (!agent?.id || agent.lifeStatus === "dead") return;
    agent.reflection ||= {};
    if (!options.force && agent.reflection.day === day) return;
    const memories = summarizeTopMemories(agent, clock, 12)
      .filter(item => item.source !== "local-reflection")
      .slice(0, 8);
    const stressors = memories.filter(item => /health|clinic|hunger|safety|conflict|death|help|病|诊所|饿|安全|冲突|死亡|求助/.test(`${item.text || ""} ${item.tags?.join(" ") || ""}`));
    const anchors = memories.slice(0, 3).map(item => cleanReflectionText(item.text)).filter(Boolean);
    const mainTheme = cleanReflectionText(stressors[0]?.text || anchors[0] || "普通日常继续推进");
    agent.reflection = {
      day,
      at: clock,
      mainTheme: String(mainTheme).slice(0, 180),
      anchors: anchors.map(text => String(text).slice(0, 140)),
      needsAttention: stressors.slice(0, 4).map(item => cleanReflectionText(item.text).slice(0, 140)),
      source: "local-reflection"
    };
    agent.memorySummary = [
      agent.reflection.mainTheme,
      ...agent.reflection.anchors.slice(0, 2)
    ].filter(Boolean).join(" / ").slice(0, 360);
    if (stressors.length) {
      appendMemory(agent, {
        at: clock,
        layer: "long",
        text: `今日反思：${agent.reflection.mainTheme}`,
        importance: 4,
        source: "local-reflection",
        tags: ["reflection"],
        dedupeKey: `reflection:${agent.id}:${day}`
      });
    }
    updated.push(agent.id);
  });
  world.memoryReflectionState ||= {};
  world.memoryReflectionState.lastRunClock = clock;
  world.memoryReflectionState.updatedAgents = updated.slice(0, 200);
  return updated;
}

module.exports = {
  ensureMemory,
  appendMemory,
  recordPlanMemory,
  retrieveRelevantMemories,
  summarizeTopMemories,
  runDailyReflection
};

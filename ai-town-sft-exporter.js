const fs = require("fs");
const path = require("path");

const defaultSystemPrompt = [
  "你是一个生活在 AI 小镇里的居民行动模型。",
  "你只能根据角色自己知道的信息、当前地点、可见人物、记忆、需求、情绪、身份和场景规则行动。",
  "你不能使用上帝视角，不能凭空知道别人内心、全镇日志、未公开事件或未来结果。",
  "你必须输出严格 JSON，字段只能描述一个小行动、移动意图、行动步骤、过程更新、记忆和轻微状态变化。"
].join("");

function stableJson(value) {
  return JSON.stringify(value, null, 0);
}

function compactString(value, max = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function compactObject(value, maxText = 240) {
  if (Array.isArray(value)) return value.slice(0, 12).map(item => compactObject(item, Math.max(80, Math.floor(maxText / 2))));
  if (!value || typeof value !== "object") return typeof value === "string" ? compactString(value, maxText) : value;
  const output = {};
  Object.entries(value).forEach(([key, item]) => {
    if (item === undefined || typeof item === "function" || typeof item === "symbol") return;
    if (typeof item === "string") output[key] = compactString(item, maxText);
    else if (Array.isArray(item)) output[key] = item.slice(0, 10).map(entry => compactObject(entry, Math.max(80, Math.floor(maxText / 2))));
    else if (item && typeof item === "object") output[key] = compactObject(item, Math.max(80, Math.floor(maxText / 2)));
    else output[key] = item;
  });
  return output;
}

function isDeadAgent(agent) {
  return agent?.lifeStatus === "dead" || agent?.terminalState?.dead === true;
}

function agentById(world, id) {
  return (world?.agents || []).find(agent => agent?.id === id) || null;
}

function placeName(world, id) {
  const place = (world?.places || []).find(item => item?.id === id);
  return place?.name || id || "";
}

function memoryDigest(agent) {
  const memory = agent?.memory || {};
  const pick = layer => Array.isArray(memory[layer])
    ? memory[layer].slice(0, layer === "short" ? 5 : 3).map(item => compactString(item?.text || item, 120)).filter(Boolean)
    : [];
  return {
    summary: compactString(agent?.memorySummary || "", 240),
    short: pick("short"),
    long: pick("long"),
    emotional: pick("emotional"),
    rumor: pick("rumor")
  };
}

function agentContextFromWorld(world, agent, source = {}) {
  const position = agent?.position || agent?.place || "";
  const visibleAgents = (world?.agents || [])
    .filter(item => item?.id && item.id !== agent.id && !isDeadAgent(item) && (item.position || item.place || "") === position)
    .slice(0, 12)
    .map(item => ({
      id: item.id,
      name: item.name,
      job: item.job || "",
      currentTask: item.currentTask || "",
      lifeStatus: item.lifeStatus || "alive"
    }));
  return compactObject({
    task: "agentAction",
    clock: world?.clock || 0,
    time: source.time || "",
    calendar: world?.weatherBox?.calendar || {},
    weather: world?.weatherBox?.current || world?.weatherBox || {},
    agent: {
      id: agent.id,
      name: agent.name,
      job: agent.job || "",
      ageYears: agent.ageYears ?? agent.age ?? null,
      ageStage: agent.ageStage || "",
      lifeStatus: agent.lifeStatus || "alive",
      position,
      placeName: placeName(world, position),
      currentTask: agent.currentTask || "",
      needs: agent.needs || {},
      emotionVector: agent.emotionVector || agent.emotions || {},
      energy: agent.energy,
      isSleeping: Boolean(agent.isSleeping),
      activeProcess: agent.activeProcess || null,
      eventQueue: Array.isArray(agent.eventQueue) ? agent.eventQueue.slice(0, 5) : [],
      longTermGoals: Array.isArray(agent.longTermGoals) ? agent.longTermGoals.slice(0, 3) : [],
      identityCore: agent.identityCore || null,
      personalityProfile: agent.personalityProfile || null
    },
    currentLocation: {
      id: position,
      name: placeName(world, position),
      visibleAgents
    },
    visibleAgents,
    memory: memoryDigest(agent),
    intentState: agent.intentState || null,
    contextJudgement: agent.contextJudgement || null,
    crisisTriage: agent.crisisTriage || null,
    knowledgeJudgement: agent.knowledgeJudgement || null,
    outcomeJudgement: agent.outcomeJudgement || null,
    recentRecords: Array.isArray(world?.records) ? world.records.slice(0, 8) : [],
    source
  });
}

function normalizeAction(action = {}) {
  return compactObject({
    action: {
      type: action.type || "wait",
      summary: action.summary || action.currentTask || "",
      currentTask: action.currentTask || action.summary || "",
      newLocation: action.newLocation || "",
      mood: action.mood || "",
      expectedMinutes: Number(action.expectedMinutes || action.spentMinutes || 0) || undefined,
      emotionDelta: action.emotionDelta || {},
      needDelta: action.needDelta || {},
      actionSteps: Array.isArray(action.actionSteps) ? action.actionSteps.slice(0, 4) : [],
      processUpdate: action.processUpdate || null,
      memory: action.memory || null,
      relationChanges: Array.isArray(action.relationChanges) ? action.relationChanges.slice(0, 4) : [],
      newEvents: Array.isArray(action.newEvents) ? action.newEvents.slice(0, 3) : []
    }
  });
}

function hasBadTrainingText(text) {
  return /JSON 修复兜底|格式错误|越权|系统修正|已死亡|不能继续行动|AI 返回格式错误|停下整理思路/.test(String(text || ""));
}

function isGoodActionSample(sample) {
  const action = sample?.output?.action || sample?.action || {};
  const text = `${action.type || ""} ${action.summary || ""} ${action.currentTask || ""}`;
  if (!action || typeof action !== "object") return false;
  if (hasBadTrainingText(text)) return false;
  if (!compactString(action.summary || action.currentTask, 20)) return false;
  return true;
}

function makeConversation(input, output, systemPrompt = defaultSystemPrompt) {
  return {
    conversations: [
      { role: "system", content: systemPrompt },
      { role: "user", content: stableJson(input) },
      { role: "assistant", content: stableJson(output) }
    ]
  };
}

function samplesFromStoredTraining(world, options = {}) {
  const systemPrompt = options.systemPrompt || defaultSystemPrompt;
  return (Array.isArray(world?.trainingSamples) ? world.trainingSamples : [])
    .filter(isGoodActionSample)
    .map(sample => makeConversation(sample.input || {}, normalizeAction(sample.output?.action || sample.action || {}), systemPrompt));
}

function samplesFromRecords(world, options = {}) {
  const systemPrompt = options.systemPrompt || defaultSystemPrompt;
  const records = Array.isArray(world?.records) ? world.records : [];
  return records
    .filter(record => record?.type === "node_agent_action" || record?.type === "action")
    .map(record => {
      const agentId = Array.isArray(record.agents) ? record.agents[0] : record.agentId;
      const agent = agentById(world, agentId);
      if (!agent || isDeadAgent(agent)) return null;
      const summary = compactString(record.body || record.summary || record.title, 260);
      if (hasBadTrainingText(summary)) return null;
      const input = agentContextFromWorld(world, agent, {
        kind: "record-fallback",
        recordTitle: record.title || "",
        recordClock: record.clock || 0,
        time: record.time || ""
      });
      const output = normalizeAction({
        type: "daily_action",
        summary,
        currentTask: agent.currentTask || summary,
        newLocation: ""
      });
      return makeConversation(input, output, systemPrompt);
    })
    .filter(Boolean);
}

function exportTownSft(world, options = {}) {
  const limit = Math.max(1, Math.min(100000, Number(options.limit || 5000)));
  const includeFallback = options.includeFallback !== false;
  const stored = samplesFromStoredTraining(world, options);
  const fallback = includeFallback ? samplesFromRecords(world, options) : [];
  const seen = new Set();
  const samples = [];
  [...stored, ...fallback].forEach(sample => {
    const key = stableJson(sample.conversations);
    if (seen.has(key)) return;
    seen.add(key);
    samples.push(sample);
  });
  return samples.slice(0, limit);
}

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${rows.map(row => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

module.exports = {
  defaultSystemPrompt,
  agentContextFromWorld,
  normalizeAction,
  exportTownSft,
  writeJsonl
};

"use strict";

const nodeTypes = new Set(["event", "stateChange", "action", "belief", "goal", "relationship"]);
const edgeRelations = new Set(["caused", "reinforced", "weakened", "triggered", "prevented"]);

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function normalizeRatio(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  if (number > 1) return clampNumber(number / (number <= 10 ? 10 : 100), 0, 1, fallback);
  return clampNumber(number, 0, 1, fallback);
}

function normalizeImpact(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  if (number > 1) return clampNumber(number / 100, 0, 1, fallback);
  return clampNumber(number, 0, 1, fallback);
}

function compactString(value, fallback = "", limit = 180) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, limit);
}

function stableIdPart(value = "") {
  return String(value || "unknown")
    .replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]+/g, "_")
    .slice(0, 80);
}

function rawMagnitude(value, fallback = 0) {
  if (value == null) return fallback;
  if (typeof value === "number") return Math.abs(value);
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + Math.abs(Number(item) || 0), 0);
  if (typeof value === "object") {
    const numbers = Object.values(value)
      .map(item => Math.abs(Number(item) || 0))
      .filter(Number.isFinite);
    return numbers.length ? Math.max(...numbers) : fallback;
  }
  return Math.abs(Number(value) || fallback);
}

function eventText(event = {}) {
  return String([
    event.summary,
    event.type,
    event.actionType,
    event.localAction,
    event.planTitle,
    event.interruption?.type
  ].filter(Boolean).join(" ")).toLowerCase();
}

function causalCategory(event = {}) {
  const text = eventText(event);
  if (/rain|weather|storm|雨|天气|暴雨/.test(text)) return "weather";
  if (/health|clinic|doctor|medical|sick|ill|健康|诊所|医生|生病/.test(text)) return "health";
  if (/safety|risk|danger|stranger|unsafe|安全|风险|陌生人|危险/.test(text)) return "safety";
  if (/help|care|trust|promise|saved|帮助|照顾|信任|承诺/.test(text)) return "support";
  if (/conflict|argument|fight|betray|冲突|争吵|背叛/.test(text)) return "conflict";
  if (/goal|work|study|business|customer|目标|工作|学习|客流|备货/.test(text)) return "goal";
  if (event.category === "routine") return "routine";
  return "general";
}

function causalInputs(input = {}) {
  const eventImpact = Number.isFinite(Number(input.eventImpact))
    ? Number(input.eventImpact)
    : Number.isFinite(Number(input.abnormality))
      ? Number(input.abnormality)
      : input.interruption?.canOverridePlan
        ? clampNumber(input.interruption.priority, 1, 100, 70)
        : 12;
  const emotionChange = Number.isFinite(Number(input.emotionChange))
    ? Number(input.emotionChange)
    : Math.max(rawMagnitude(input.emotionDelta, 0), Number(input.emotionalIntensity || 0));
  const goalChange = Number.isFinite(Number(input.goalChange))
    ? Number(input.goalChange)
    : Math.max(rawMagnitude(input.goalDelta, 0), Number(input.goalImpact || 0), Number(input.futureImpact || 0));
  let relationshipChange = Number.isFinite(Number(input.relationshipChange))
    ? Number(input.relationshipChange)
    : Math.max(rawMagnitude(input.relationshipDelta ?? input.relationDelta, 0), Number(input.relationImpact || 0));
  if (relationshipChange <= 0) relationshipChange = input.targetAgentId ? 18 : 42;
  return { eventImpact, emotionChange, goalChange, relationshipChange };
}

function causalStrength(input = {}) {
  const values = causalInputs(input);
  const eventImpact = normalizeImpact(values.eventImpact, 0.12);
  const emotionChange = normalizeImpact(values.emotionChange, 0.08);
  const goalChange = normalizeImpact(values.goalChange, 0.08);
  const relationshipChange = normalizeImpact(values.relationshipChange, input.targetAgentId ? 0.18 : 0.42);
  const epsilon = 0.03;
  const weights = { event: 1.1, emotion: 1.0, goal: 1.05, relationship: 0.65 };
  const weightTotal = weights.event + weights.emotion + weights.goal + weights.relationship;
  const geometric = (
    (eventImpact + epsilon) ** weights.event
    * (emotionChange + epsilon) ** weights.emotion
    * (goalChange + epsilon) ** weights.goal
    * (relationshipChange + epsilon) ** weights.relationship
  ) ** (1 / weightTotal);
  const result = clampNumber(geometric, 0, 1, 0);
  return {
    strength: Number(result.toFixed(3)),
    dimensions: {
      eventImpact: Number(eventImpact.toFixed(3)),
      emotionChange: Number(emotionChange.toFixed(3)),
      goalChange: Number(goalChange.toFixed(3)),
      relationshipChange: Number(relationshipChange.toFixed(3))
    },
    raw: values
  };
}

function causalThreshold(world = {}) {
  return clampNumber(world.config?.causalGraphThreshold ?? world.causalGraphThreshold, 0, 1, 0.32);
}

function causalGraphLimits(world = {}) {
  const config = world.config?.causalGraphLimits || world.causalGraphLimits || {};
  return {
    nodes: clampNumber(config.nodes, 100, 20000, 3000),
    edges: clampNumber(config.edges, 100, 30000, 5000),
    patterns: clampNumber(config.patterns, 50, 5000, 600)
  };
}

function ensureCausalGraph(world = {}) {
  world.causalGraph ||= {};
  if (!Array.isArray(world.causalGraph.nodes)) world.causalGraph.nodes = [];
  if (!Array.isArray(world.causalGraph.edges)) world.causalGraph.edges = [];
  if (!Array.isArray(world.causalGraph.patterns)) world.causalGraph.patterns = [];
  world.causalGraph.version ||= "3.3.4";
  return world.causalGraph;
}

function upsertNode(graph, node = {}) {
  if (!graph || !node.id || !nodeTypes.has(node.type)) return null;
  const timestamp = Number(node.timestamp);
  const normalized = {
    ...node,
    timestamp: Number.isFinite(timestamp) ? timestamp : 0,
    label: compactString(node.label || node.summary || node.id, node.id, 180),
    causalCategory: compactString(node.causalCategory || "", "", 40)
  };
  const existing = graph.nodes.find(item => item.id === normalized.id);
  if (existing) {
    Object.assign(existing, { ...normalized, firstSeen: existing.firstSeen ?? normalized.timestamp });
    return existing;
  }
  graph.nodes.push(normalized);
  return normalized;
}

function nodeById(graph, id) {
  return graph?.nodes?.find(node => node.id === id) || null;
}

function patternKeyFor(edge, fromNode, toNode) {
  return [
    edge.relation,
    fromNode.type,
    fromNode.causalCategory || fromNode.kind || "",
    toNode.type,
    toNode.causalCategory || toNode.kind || ""
  ].join(":");
}

function reinforcePattern(graph, edge, fromNode, toNode) {
  const key = edge.patternKey || patternKeyFor(edge, fromNode, toNode);
  let pattern = graph.patterns.find(item => item.key === key);
  const reinforcement = clampNumber(edge.strength, 0, 1, 0) * 0.08;
  if (!pattern) {
    pattern = {
      key,
      relation: edge.relation,
      count: 0,
      strength: 0,
      firstSeen: edge.timestamp,
      lastSeen: edge.timestamp,
      examples: []
    };
    graph.patterns.push(pattern);
  }
  pattern.count += 1;
  pattern.lastSeen = edge.timestamp;
  pattern.strength = Number(clampNumber(Math.max(pattern.strength, edge.strength) + reinforcement, 0, 1, edge.strength).toFixed(3));
  if (pattern.examples.length < 5) pattern.examples.push(edge.id);
  edge.patternKey = key;
  edge.reinforcementCount = pattern.count;
  edge.strength = Number(Math.max(edge.strength, pattern.strength).toFixed(3));
  graph.edges
    .filter(item => item.patternKey === key)
    .forEach(item => {
      item.strength = Number(Math.max(Number(item.strength || 0), pattern.strength).toFixed(3));
      item.reinforcementCount = Math.max(Number(item.reinforcementCount || 1), pattern.count);
    });
  return pattern;
}

function addEdge(graph, edge = {}) {
  if (!graph || !edge.from || !edge.to || !edgeRelations.has(edge.relation)) return null;
  const fromNode = nodeById(graph, edge.from);
  const toNode = nodeById(graph, edge.to);
  if (!fromNode || !toNode) return null;
  if (Number(fromNode.timestamp) >= Number(toNode.timestamp)) {
    toNode.timestamp = Number(fromNode.timestamp) + 0.001;
  }
  const existing = graph.edges.find(item => item.from === edge.from && item.to === edge.to && item.relation === edge.relation);
  const normalized = {
    id: edge.id || `cedge_${stableIdPart(edge.from)}_${stableIdPart(edge.to)}_${edge.relation}`,
    from: edge.from,
    to: edge.to,
    relation: edge.relation,
    strength: Number(clampNumber(edge.strength, 0, 1, 0.3).toFixed(3)),
    confidence: Number(clampNumber(edge.confidence, 0, 1, 0.65).toFixed(3)),
    timestamp: Number(edge.timestamp || toNode.timestamp),
    agentId: edge.agentId || fromNode.agentId || toNode.agentId || "",
    eventId: edge.eventId || fromNode.eventId || toNode.eventId || "",
    chainId: edge.chainId || "",
    note: compactString(edge.note || "", "", 160)
  };
  if (Number(fromNode.timestamp) >= normalized.timestamp) normalized.timestamp = Number(fromNode.timestamp) + 0.001;
  if (existing) {
    existing.strength = Number(Math.max(Number(existing.strength || 0), normalized.strength).toFixed(3));
    existing.confidence = Number(Math.max(Number(existing.confidence || 0), normalized.confidence).toFixed(3));
    existing.timestamp = Math.max(Number(existing.timestamp || 0), normalized.timestamp);
    reinforcePattern(graph, existing, fromNode, toNode);
    return existing;
  }
  reinforcePattern(graph, normalized, fromNode, toNode);
  graph.edges.push(normalized);
  return normalized;
}

function pruneGraph(world = {}) {
  const graph = ensureCausalGraph(world);
  const limits = causalGraphLimits(world);
  graph.nodes.sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
  graph.edges.sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
  graph.patterns.sort((a, b) => Number(a.lastSeen || 0) - Number(b.lastSeen || 0));
  if (graph.nodes.length > limits.nodes) graph.nodes = graph.nodes.slice(-limits.nodes);
  const nodeIds = new Set(graph.nodes.map(node => node.id));
  graph.edges = graph.edges.filter(edge => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  if (graph.edges.length > limits.edges) graph.edges = graph.edges.slice(-limits.edges);
  if (graph.patterns.length > limits.patterns) graph.patterns = graph.patterns.slice(-limits.patterns);
  return graph;
}

function actionName(event = {}) {
  return compactString(event.localAction || event.actionType || event.type || "action", "action", 80);
}

function stateChangeNodesForEvent(event = {}, agent = {}, baseTime = 0, strength = 0) {
  const category = causalCategory(event);
  const nodes = [];
  if (event.interruption?.type) {
    nodes.push({
      type: "stateChange",
      kind: `${event.interruption.type}_pressure`,
      label: `${event.interruption.type} pressure changed`,
      causalCategory: event.interruption.type
    });
  }
  if (rawMagnitude(event.emotionDelta, 0) > 0 || Number(event.emotionalIntensity || 0) > 0) {
    nodes.push({
      type: "stateChange",
      kind: "emotion",
      label: "emotion state changed",
      causalCategory: "emotion"
    });
  }
  if (rawMagnitude(event.goalDelta, 0) > 0 || Number(event.goalImpact || 0) > 0) {
    nodes.push({
      type: "goal",
      kind: "goalImpact",
      label: "goal pressure changed",
      causalCategory: "goal"
    });
  }
  if (rawMagnitude(event.relationshipDelta ?? event.relationDelta, 0) > 0 || Number(event.relationImpact || 0) > 0 || event.targetAgentId) {
    nodes.push({
      type: "relationship",
      kind: "relationshipImpact",
      label: "relationship interpretation changed",
      causalCategory: category === "conflict" ? "conflict" : "relationship"
    });
  }
  if (!nodes.length && strength >= 0.45) {
    nodes.push({
      type: "stateChange",
      kind: category,
      label: `${category} state changed`,
      causalCategory: category
    });
  }
  return nodes.map((node, index) => ({
    id: `cnode_${node.type}_${stableIdPart(event.id)}_${index}`,
    timestamp: baseTime + 0.002 + index * 0.001,
    agentId: agent.id || event.agentId || "",
    eventId: event.id,
    ...node
  }));
}

function analyzeEventImpact(world = {}, agent = {}, event = {}, options = {}) {
  if (!world || !event?.id) return null;
  const result = causalStrength(event);
  const threshold = causalThreshold(world);
  const force = Boolean(options.force);
  if (!force && result.strength <= threshold) {
    event.causalGraph = {
      strength: result.strength,
      threshold,
      skipped: true,
      reason: "causalStrength below threshold"
    };
    return null;
  }
  const graph = ensureCausalGraph(world);
  const baseTime = Number(event.clock ?? world.clock ?? 0);
  const category = causalCategory(event);
  const chainId = event.causalGraph?.chainId || `chain_${stableIdPart(event.id)}`;
  const nodeIds = [];
  const edgeIds = [];
  const eventNode = upsertNode(graph, {
    id: `cnode_event_${stableIdPart(event.id)}`,
    type: "event",
    timestamp: baseTime,
    label: event.summary || event.type || event.id,
    agentId: agent.id || event.agentId || "",
    eventId: event.id,
    place: event.place || agent.position || agent.place || "",
    causalCategory: category
  });
  if (eventNode) nodeIds.push(eventNode.id);
  const actionNode = upsertNode(graph, {
    id: `cnode_action_${stableIdPart(event.id)}`,
    type: "action",
    timestamp: baseTime + 0.001,
    label: actionName(event),
    agentId: agent.id || event.agentId || "",
    eventId: event.id,
    causalCategory: category,
    kind: actionName(event)
  });
  if (actionNode) nodeIds.push(actionNode.id);
  const firstEdge = addEdge(graph, {
    from: eventNode?.id,
    to: actionNode?.id,
    relation: "triggered",
    strength: result.strength,
    confidence: 0.72,
    timestamp: baseTime + 0.001,
    agentId: agent.id || event.agentId || "",
    eventId: event.id,
    chainId
  });
  if (firstEdge) edgeIds.push(firstEdge.id);
  stateChangeNodesForEvent(event, agent, baseTime, result.strength).forEach(node => {
    const stateNode = upsertNode(graph, node);
    if (!stateNode) return;
    nodeIds.push(stateNode.id);
    const relation = stateNode.type === "relationship" && category === "conflict" ? "weakened" : "caused";
    const edge = addEdge(graph, {
      from: actionNode?.id || eventNode?.id,
      to: stateNode.id,
      relation,
      strength: Math.max(result.strength, stateNode.type === "goal" ? normalizeImpact(event.goalImpact || rawMagnitude(event.goalDelta, 0), 0.3) : 0),
      confidence: 0.68,
      timestamp: stateNode.timestamp,
      agentId: agent.id || event.agentId || "",
      eventId: event.id,
      chainId
    });
    if (edge) edgeIds.push(edge.id);
  });
  pruneGraph(world);
  event.causalGraph = {
    strength: result.strength,
    threshold,
    skipped: false,
    chainId,
    nodeIds,
    edgeIds,
    dimensions: result.dimensions,
    category
  };
  world.causalGraphState = {
    version: "3.3.4",
    updatedAt: Number(world.clock || event.clock || 0),
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    patternCount: graph.patterns.length
  };
  return event.causalGraph;
}

function connectMemoryCause(world = {}, agent = {}, event = {}, memory = null) {
  if (!world || !event?.id) return null;
  const gate = event.memoryGate || {};
  if (!gate.shouldRemember && !memory) return event.causalGraph || null;
  if (!event.causalGraph || event.causalGraph.skipped) analyzeEventImpact(world, agent, event, { force: true });
  const graph = ensureCausalGraph(world);
  const baseTime = Number(event.clock ?? world.clock ?? 0);
  const chainId = event.causalGraph?.chainId || `chain_${stableIdPart(event.id)}`;
  const candidateCauseIds = (event.causalGraph?.nodeIds || [])
    .map(id => nodeById(graph, id))
    .filter(Boolean)
    .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
  const causeNode = candidateCauseIds.find(node => ["stateChange", "goal", "relationship", "action"].includes(node.type)) || candidateCauseIds[0];
  if (!causeNode) return event.causalGraph || null;
  const memoryNodes = [];
  const strength = Math.max(Number(event.causalGraph?.strength || 0), Number(gate.importance || 0));
  const changes = event.memoryChanges || {};
  if (changes.beliefChange?.belief || gate.memoryType === "belief") {
    memoryNodes.push({
      type: "belief",
      kind: "belief",
      label: changes.beliefChange?.belief || memory?.meaning || memory?.text || "belief updated",
      causalCategory: "belief",
      relation: "reinforced"
    });
  }
  if (changes.habitChange || gate.memoryType === "habit") {
    memoryNodes.push({
      type: "belief",
      kind: "habit",
      label: changes.habitChange?.reason || memory?.meaning || memory?.text || "habit cue reinforced",
      causalCategory: "habit",
      relation: "reinforced"
    });
  }
  if (gate.memoryType === "social" || memory?.type === "relationship") {
    memoryNodes.push({
      type: "relationship",
      kind: "relationshipMemory",
      label: memory?.meaning || memory?.text || "relationship memory changed",
      causalCategory: "relationship",
      relation: causalCategory(event) === "conflict" ? "weakened" : "reinforced"
    });
  }
  if (memory && !memoryNodes.length) {
    memoryNodes.push({
      type: "belief",
      kind: "episodic",
      label: memory.meaning || memory.text || "experience became a reference",
      causalCategory: "episodic",
      relation: "reinforced"
    });
  }
  const memoryNodeIds = [];
  const memoryEdgeIds = [];
  memoryNodes.forEach((node, index) => {
    const target = upsertNode(graph, {
      id: `cnode_${node.type}_${stableIdPart(event.id)}_memory_${index}`,
      timestamp: baseTime + 0.004 + index * 0.001,
      agentId: agent.id || event.agentId || "",
      eventId: event.id,
      ...node
    });
    if (!target) return;
    memoryNodeIds.push(target.id);
    const edge = addEdge(graph, {
      from: causeNode.id,
      to: target.id,
      relation: node.relation,
      strength,
      confidence: 0.64,
      timestamp: target.timestamp,
      agentId: agent.id || event.agentId || "",
      eventId: event.id,
      chainId,
      note: "memory update from causal chain"
    });
    if (edge) memoryEdgeIds.push(edge.id);
  });
  if (memory && typeof memory === "object") {
    memory.sourceCausalChain = chainId;
    memory.source = memory.source || "causal-graph";
  }
  event.causalGraph = {
    ...(event.causalGraph || {}),
    skipped: false,
    chainId,
    memoryNodeIds,
    memoryEdgeIds
  };
  pruneGraph(world);
  world.causalGraphState = {
    version: "3.3.4",
    updatedAt: Number(world.clock || event.clock || 0),
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    patternCount: graph.patterns.length
  };
  return event.causalGraph;
}

function lessonForCategory(category = "general") {
  return {
    health: "身体状态会改变后续安排，需要更早处理健康信号",
    safety: "安全风险会改变行动优先级，需要先确认环境",
    support: "可靠帮助会增强之后求助和合作的倾向",
    conflict: "关系冲突会削弱信任，需要降低误解和冲突升级",
    weather: "天气变化会影响地点和事务安排，需要提前准备",
    goal: "目标受阻时需要调整计划或资源分配",
    routine: "重复行为会逐渐形成稳定习惯",
    general: "事件的后果会成为之后判断的参考"
  }[category] || "事件的后果会成为之后判断的参考";
}

function counterfactualForCategory(category = "general") {
  return {
    health: "如果更早休息或就医，计划中断可能更轻",
    safety: "如果提前避开风险地点，后续焦虑可能更低",
    support: "如果主动沟通需求，合作关系可能更稳定",
    conflict: "如果先澄清信息，关系损耗可能更小",
    weather: "如果提前观察天气，备货和出行会更稳",
    goal: "如果提前拆分目标，阻塞带来的挫败可能更低",
    routine: "如果重复模式继续出现，它会更像习惯",
    general: "如果提前识别条件，结果可能更可控"
  }[category] || "如果提前识别条件，结果可能更可控";
}

function causalReflectionAnchors(world = {}, agent = {}, limit = 3) {
  const graph = world?.causalGraph;
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return [];
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const agentId = agent?.id || "";
  const chains = new Map();
  graph.edges
    .filter(edge => !agentId || edge.agentId === agentId)
    .filter(edge => Number(edge.strength || 0) >= 0.35)
    .forEach(edge => {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      if (!from || !to) return;
      if (Number(from.timestamp || 0) >= Number(to.timestamp || 0)) return;
      const key = edge.chainId || edge.eventId || edge.id;
      const current = chains.get(key) || {
        chainId: key,
        eventId: edge.eventId,
        strength: 0,
        timestamp: 0,
        category: to.causalCategory || from.causalCategory || "general",
        nodes: [],
        edges: []
      };
      current.strength = Math.max(current.strength, Number(edge.strength || 0));
      current.timestamp = Math.max(current.timestamp, Number(edge.timestamp || 0));
      current.category = current.category === "general" ? (to.causalCategory || from.causalCategory || "general") : current.category;
      current.nodes.push(from, to);
      current.edges.push(edge);
      chains.set(key, current);
    });
  return [...chains.values()]
    .sort((a, b) => (b.strength - a.strength) || (b.timestamp - a.timestamp))
    .slice(0, limit)
    .map(chain => {
      const nodeLabels = [];
      const seen = new Set();
      chain.nodes.forEach(node => {
        if (seen.has(node.id)) return;
        seen.add(node.id);
        nodeLabels.push(compactString(node.label, node.id, 80));
      });
      return {
        chainId: chain.chainId,
        eventId: chain.eventId,
        strength: Number(chain.strength.toFixed(3)),
        category: chain.category || "general",
        nodes: nodeLabels.slice(0, 5),
        relations: chain.edges.map(edge => edge.relation).slice(0, 5),
        lessonLearned: lessonForCategory(chain.category || "general"),
        counterfactual: counterfactualForCategory(chain.category || "general")
      };
    });
}

module.exports = {
  ensureCausalGraph,
  causalStrength,
  analyzeEventImpact,
  connectMemoryCause,
  causalReflectionAnchors,
  pruneGraph
};

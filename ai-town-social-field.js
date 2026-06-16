"use strict";

function num(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max, fallback = min) {
  const number = num(value, fallback);
  return Math.max(min, Math.min(max, number));
}

function clamp01(value, fallback = 0) {
  return clamp(value, 0, 1, fallback);
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

function seededRandom(seed = "") {
  let hash = 2166136261;
  const value = String(seed || "");
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 100000) / 100000;
}

function stableId(prefix = "id", parts = []) {
  const value = parts.map(part => String(part || "")).join("|");
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

function agentPlace(agent = {}) {
  return String(agent.position || agent.place || agent.currentLocation || "");
}

function agentName(world = {}, id = "") {
  return (world.agents || []).find(agent => agent.id === id)?.name || id;
}

function validAgentMap(world = {}) {
  return new Map((world.agents || [])
    .filter(agent => agent?.id && agent.lifeStatus !== "dead" && !agent.terminalState?.dead)
    .map(agent => [agent.id, agent]));
}

function relationStrengthBetween(a = {}, b = {}) {
  const relA = a.relationshipMatrix?.[b.id] || a.relationships?.[b.id] || {};
  const relB = b.relationshipMatrix?.[a.id] || b.relationships?.[a.id] || {};
  const read = (rel, key) => typeof rel === "number" ? rel : num(rel[key], 0);
  const trust = Math.max(read(relA, "trust"), read(relB, "trust"));
  const intimacy = Math.max(read(relA, "intimacy"), read(relB, "intimacy"));
  const dependency = Math.max(read(relA, "dependency"), read(relB, "dependency"));
  const respect = Math.max(read(relA, "respect"), read(relB, "respect"));
  const debt = Math.max(read(relA, "debt"), read(relB, "debt"));
  const resentment = Math.max(read(relA, "resentment"), read(relB, "resentment"));
  return clamp01((trust * 0.34 + intimacy * 0.26 + dependency * 0.14 + respect * 0.12 + debt * 0.08 - resentment * 0.18) / 100);
}

function relationTrustBetween(a = {}, b = {}) {
  const relA = a.relationshipMatrix?.[b.id] || a.relationships?.[b.id] || {};
  const relB = b.relationshipMatrix?.[a.id] || b.relationships?.[a.id] || {};
  const read = rel => typeof rel === "number" ? rel : Math.max(num(rel.trust, 0), num(rel.respect, 0) * 0.7);
  return clamp01(Math.max(read(relA), read(relB)) / 100);
}

function sharesHousehold(world = {}, aId = "", bId = "") {
  return (world.households || []).some(group => {
    const members = group.members || group.agentIds || group.ids || [];
    return members.includes(aId) && members.includes(bId);
  });
}

function sharedGroupStrength(world = {}, aId = "", bId = "") {
  let score = 0;
  (world.groups || []).forEach(group => {
    const members = group.members || group.agentIds || group.ids || [];
    if (members.includes(aId) && members.includes(bId)) score = Math.max(score, 0.55);
  });
  if (sharesHousehold(world, aId, bId)) score = Math.max(score, 0.9);
  return score;
}

function channelForPair(world = {}, from = {}, to = {}, eventPlace = "") {
  if (agentPlace(from) && agentPlace(from) === agentPlace(to)) return "same_place";
  if (eventPlace && agentPlace(to) === eventPlace) return "same_place";
  if (sharesHousehold(world, from.id, to.id)) return "family";
  const fromJob = `${from.job || ""} ${from.ageStage || ""}`.toLowerCase();
  const toJob = `${to.job || ""} ${to.ageStage || ""}`.toLowerCase();
  if (/student|school|class|学生|学校/.test(fromJob + toJob) && sharedGroupStrength(world, from.id, to.id) >= 0.5) return "classmate";
  if (sharedGroupStrength(world, from.id, to.id) >= 0.5) return "coworker";
  if (relationStrengthBetween(from, to) >= 0.35) return "friend";
  if (agentPlace(from) && agentPlace(to) && agentPlace(from) === agentPlace(to)) return "neighbor";
  return "";
}

function spatialProximity(world = {}, from = {}, to = {}, eventPlace = "") {
  if (agentPlace(from) && agentPlace(from) === agentPlace(to)) return 1;
  if (eventPlace && agentPlace(to) === eventPlace) return 0.72;
  if (eventPlace && agentPlace(from) === eventPlace) return 0.55;
  if (sharesHousehold(world, from.id, to.id)) return 0.68;
  return sharedGroupStrength(world, from.id, to.id) * 0.55;
}

function informationTypeProfile(impact = {}) {
  const text = `${impact.type || ""} ${impact.title || ""} ${impact.summary || ""} ${impact.fact || ""} ${impact.place || ""}`.toLowerCase();
  const severity = clamp(num(impact.severity, 2), 0, 5, 2) / 5;
  const critical = Boolean(impact.critical || impact.publicEmergency)
    || severity >= 0.82
    || includesAny(text, ["death", "dead", "critical", "emergency", "medical", "clinic", "hospital", "disaster", "fire", "violence", "死亡", "去世", "急症", "医疗", "诊所", "医院", "灾害"]);
  if (critical && includesAny(text, ["death", "dead", "死亡", "去世"])) {
    return { type: "death", weight: 1, emotionalWeight: Math.max(0.86, severity), critical: true, public: false };
  }
  if (critical) {
    return { type: "critical", weight: 0.92, emotionalWeight: Math.max(0.78, severity), critical: true, public: Boolean(impact.public || impact.publicLevel >= 80) };
  }
  if (includesAny(text, ["conflict", "misunderstanding", "argument", "secret", "rumor", "冲突", "误会", "争吵", "隐瞒", "流言"])) {
    return { type: "social", weight: 0.72, emotionalWeight: Math.max(0.56, severity), critical: false, public: false };
  }
  if (includesAny(text, ["help", "sick", "health", "late", "missing", "求助", "不适", "健康", "迟到"])) {
    return { type: "concern", weight: 0.58, emotionalWeight: Math.max(0.45, severity), critical: false, public: false };
  }
  if (includesAny(text, ["work", "class", "shop", "service", "上课", "工作", "服务", "小卖部"])) {
    return { type: "routine_public", weight: 0.35, emotionalWeight: Math.max(0.22, severity), critical: false, public: Boolean(impact.public || impact.publicLevel >= 70) };
  }
  return { type: "ordinary", weight: 0.22, emotionalWeight: Math.max(0.12, severity), critical: false, public: Boolean(impact.public || impact.publicLevel >= 85) };
}

function packetForImpact(impact = {}, profile = {}) {
  const content = String(impact.fact || impact.summary || impact.title || "observed event").slice(0, 180);
  return {
    content,
    source: impact.sourceAgentId || impact.source || "",
    confidence: profile.critical ? 0.88 : 0.72,
    distortionLevel: profile.type === "ordinary" ? 0.06 : profile.type === "social" ? 0.16 : 0.1,
    emotionalWeight: profile.emotionalWeight,
    informationType: profile.type,
    spreadDepth: 0
  };
}

function candidateRecipients(world = {}, from = {}, eventPlace = "") {
  const agents = Array.from(validAgentMap(world).values());
  return agents
    .filter(agent => agent.id !== from.id)
    .map(agent => {
      const relation = relationStrengthBetween(from, agent);
      const group = sharedGroupStrength(world, from.id, agent.id);
      const space = spatialProximity(world, from, agent, eventPlace);
      const channel = channelForPair(world, from, agent, eventPlace);
      const reachable = channel || space >= 0.68 || relation >= 0.28 || group >= 0.5;
      return { agent, relation, group, space, channel };
    })
    .filter(item => item.agent?.id && item.channel && (item.relation >= 0.12 || item.group >= 0.5 || item.space >= 0.55));
}

function propagationProbability(world = {}, from = {}, to = {}, impact = {}, profile = {}, depth = 1) {
  const field = world.socialField || {};
  const relationshipStrength = relationStrengthBetween(from, to);
  const trustLevel = relationTrustBetween(from, to);
  const spatial = spatialProximity(world, from, to, impact.place || "");
  const emotionalIntensity = profile.emotionalWeight;
  const informationTypeWeight = profile.weight;
  const socialFieldPressure = clamp01(num(field.informationPressure, 0) * 0.55 + num(field.rumorDensity, 0) * 0.3 + num(field.socialTension, 0) * 0.15);
  let probability =
    relationshipStrength * 0.24
    + spatial * 0.2
    + trustLevel * 0.16
    + emotionalIntensity * 0.14
    + informationTypeWeight * 0.18
    + socialFieldPressure * 0.08;
  probability *= Math.pow(0.72, Math.max(0, depth - 1));
  if (profile.critical && (spatial >= 0.72 || relationshipStrength >= 0.55 || /doctor|nurse|medical|clinic|医生|护士|医疗|诊所/.test(String(to.job || "").toLowerCase()))) {
    probability = Math.max(probability, depth === 1 ? 0.96 : 0.82);
  }
  if (profile.public && impact.publicLevel >= 80) probability = Math.max(probability, 0.72);
  return clamp01(probability);
}

function propagationDelay(channel = "", depth = 1, seed = "") {
  const jitter = Math.round(seededRandom(seed) * 20);
  const base = {
    same_place: 0,
    family: 18,
    classmate: 25,
    coworker: 30,
    neighbor: 35,
    friend: 45,
    broadcast: 8
  }[channel] ?? 60;
  return base + Math.max(0, depth - 1) * 45 + jitter;
}

function propagateInformation(world = {}, eventImpacts = [], options = {}) {
  const agents = validAgentMap(world);
  const clock = num(world.clock, 0);
  const flows = [];
  const affected = new Set();
  const impacts = (Array.isArray(eventImpacts) ? eventImpacts : []).slice(0, options.maxImpacts || 24);
  impacts.forEach((impact, impactIndex) => {
    const profile = informationTypeProfile(impact);
    const packet = packetForImpact(impact, profile);
    const source = String(impact.sourceAgentId || impact.source || packet.source || "");
    const direct = Array.from(new Set([
      source,
      ...((Array.isArray(impact.directKnownBy) ? impact.directKnownBy : impact.knownBy) || [])
    ].filter(id => agents.has(id)))).slice(0, profile.critical ? 10 : 7);
    if (!direct.length) return;
    const known = new Set(direct);
    const transmissions = [];
    let frontier = direct;
    const maxDepth = profile.critical ? 3 : profile.type === "social" ? 3 : 2;
    for (let depth = 1; depth <= maxDepth && frontier.length; depth += 1) {
      const nextFrontier = [];
      frontier.forEach(fromId => {
        const from = agents.get(fromId);
        if (!from) return;
        candidateRecipients(world, from, impact.place || "").forEach(candidate => {
          const to = candidate.agent;
          if (!to || known.has(to.id)) return;
          const probability = propagationProbability(world, from, to, impact, profile, depth);
          const seed = `${clock}:${impact.eventId || impact.id || impactIndex}:${from.id}:${to.id}:${depth}`;
          if (seededRandom(seed) > probability) return;
          const channel = candidate.channel || "friend";
          const distortion = clamp01(packet.distortionLevel + depth * 0.07 + (1 - relationTrustBetween(from, to)) * 0.09 + seededRandom(`${seed}:distortion`) * 0.04);
          const confidence = clamp01(packet.confidence - distortion * 0.45 - (depth - 1) * 0.08, 0.2);
          known.add(to.id);
          affected.add(to.id);
          nextFrontier.push(to.id);
          transmissions.push({
            from: from.id,
            to: to.id,
            channel,
            probability: Number(probability.toFixed(3)),
            delayMinutes: propagationDelay(channel, depth, seed),
            distortion: Number((distortion * 100).toFixed(1)),
            informationPacket: {
              ...packet,
              confidence: Number(confidence.toFixed(3)),
              distortionLevel: Number(distortion.toFixed(3)),
              spreadDepth: depth
            }
          });
        });
      });
      frontier = nextFrontier.slice(0, profile.critical ? 10 : 6);
    }
    direct.forEach(id => affected.add(id));
    const knownBy = Array.from(known).slice(0, profile.critical ? 16 : 10);
    flows.push({
      id: stableId("flow", [clock, impact.eventId || impact.id || impact.title, packet.content, knownBy.join(",")]),
      impactId: String(impact.eventId || impact.id || impact.title || `impact-${impactIndex}`),
      fact: packet.content,
      source: source || direct[0],
      knownBy,
      directKnownBy: direct,
      transmissions: transmissions.slice(0, profile.critical ? 24 : 12),
      rumorRisk: Math.round(clamp01(profile.emotionalWeight * 0.45 + packet.distortionLevel * 0.45 + num(world.socialField?.rumorDensity, 0) * 0.1) * 100),
      public: Boolean(profile.public),
      informationPacket: {
        ...packet,
        confidence: Number(packet.confidence.toFixed(3)),
        distortionLevel: Number(packet.distortionLevel.toFixed(3)),
        spreadDepth: transmissions.reduce((max, item) => Math.max(max, item.informationPacket?.spreadDepth || 0), 0)
      },
      propagationModel: "probabilistic-social-field-v3.3",
      at: clock,
      sourceModule: "ai-town-social-field"
    });
  });
  return {
    informationFlows: flows,
    affectedAgents: Array.from(affected).map(id => ({ id, name: agentName(world, id) })).slice(0, 80),
    informationFlowGraph: buildInformationFlowGraph(flows),
    rule: "Information spreads probabilistically through finite social channels. The local model may delay, decay, and distort packets."
  };
}

function relationNetworkStrength(world = {}) {
  const agents = world.agents || [];
  let total = 0;
  let count = 0;
  agents.forEach(agent => {
    Object.values(agent.relationshipMatrix || {}).forEach(rel => {
      if (typeof rel === "number") {
        total += rel / 100;
      } else {
        total += clamp01((num(rel.trust, 0) * 0.45 + num(rel.intimacy, 0) * 0.28 + num(rel.respect, 0) * 0.18 - num(rel.resentment, 0) * 0.18) / 100);
      }
      count += 1;
    });
  });
  return count ? clamp01(total / count) : 0.35;
}

function locationDensity(world = {}) {
  const agents = (world.agents || []).filter(agent => agent?.id && agent.lifeStatus !== "dead");
  const counts = {};
  agents.forEach(agent => {
    const place = agentPlace(agent) || "unknown";
    counts[place] = (counts[place] || 0) + 1;
  });
  const max = Math.max(1, ...Object.values(counts));
  const result = {};
  Object.entries(counts).forEach(([place, count]) => {
    result[place] = clamp01(count / Math.max(4, max));
  });
  return result;
}

function socialProcessTension(world = {}) {
  const processes = world.socialProcesses || [];
  if (!processes.length) return 0;
  return clamp01(processes.slice(0, 20).reduce((sum, item) => sum + clamp(num(item.tension, 0), 0, 100, 0) / 100, 0) / Math.min(20, processes.length));
}

function flowSignals(flows = []) {
  const recent = (flows || []).slice(0, 60);
  if (!recent.length) return { rumor: 0, fear: 0, curiosity: 0, pressure: 0, emotional: 0 };
  let knownCount = 0;
  let distortion = 0;
  let emotional = 0;
  let critical = 0;
  let depth = 0;
  recent.forEach(flow => {
    const packet = flow.informationPacket || {};
    knownCount += (flow.knownBy || []).length;
    distortion += clamp01(num(packet.distortionLevel, num(flow.rumorRisk, 0) / 100));
    emotional += clamp01(num(packet.emotionalWeight, num(flow.rumorRisk, 0) / 100));
    if (["death", "critical"].includes(packet.informationType) || num(flow.rumorRisk, 0) > 70) critical += 1;
    depth += clamp(num(packet.spreadDepth, (flow.transmissions || []).length ? 1 : 0), 0, 5, 0) / 5;
  });
  const divisor = recent.length || 1;
  return {
    rumor: clamp01((distortion / divisor) * 0.62 + Math.min(1, knownCount / 100) * 0.24 + Math.min(1, recent.length / 30) * 0.14),
    fear: clamp01((critical / divisor) * 0.58 + (emotional / divisor) * 0.42),
    curiosity: clamp01(Math.min(1, knownCount / 80) * 0.42 + (depth / divisor) * 0.36 + (distortion / divisor) * 0.22),
    pressure: clamp01(Math.min(1, knownCount / 70) * 0.45 + Math.min(1, recent.length / 24) * 0.35 + (emotional / divisor) * 0.2),
    emotional: clamp01(emotional / divisor)
  };
}

function eventSignals(world = {}, eventImpacts = []) {
  const recentText = [
    ...(eventImpacts || []).slice(0, 20),
    ...(world.records || []).slice(0, 20),
    ...(world.eventLog || []).slice(0, 20)
  ].map(item => `${item.type || ""} ${item.title || ""} ${item.summary || ""} ${item.body || ""}`).join(" ").toLowerCase();
  return {
    fear: includesAny(recentText, ["death", "critical", "medical", "unsafe", "danger", "死亡", "急症", "危险"]) ? 0.35 : 0,
    curiosity: includesAny(recentText, ["strange", "rumor", "unknown", "conflict", "陌生", "流言", "冲突"]) ? 0.28 : 0,
    tension: includesAny(recentText, ["conflict", "argument", "misunderstanding", "冲突", "误会", "争吵"]) ? 0.32 : 0
  };
}

function buildLocationFields(world = {}, globalField = {}) {
  const density = locationDensity(world);
  const fields = {};
  const placeIds = new Set([
    ...Object.keys(density),
    ...(world.places || []).map(place => place.id).filter(Boolean)
  ]);
  placeIds.forEach(placeId => {
    const localFlows = (world.informationFlows || []).filter(flow => {
      const text = `${flow.place || ""} ${flow.fact || ""}`.toLowerCase();
      return text.includes(String(placeId).toLowerCase());
    });
    const flow = flowSignals(localFlows);
    fields[placeId] = {
      fearLevel: Number(clamp01(globalField.fearLevel * 0.55 + flow.fear * 0.3 + num(density[placeId], 0) * 0.15).toFixed(3)),
      curiosityLevel: Number(clamp01(globalField.curiosityLevel * 0.45 + flow.curiosity * 0.35 + num(density[placeId], 0) * 0.2).toFixed(3)),
      rumorDensity: Number(clamp01(globalField.rumorDensity * 0.5 + flow.rumor * 0.35 + num(density[placeId], 0) * 0.15).toFixed(3)),
      trustNetworkStrength: Number(clamp01(globalField.trustNetworkStrength).toFixed(3)),
      socialTension: Number(clamp01(globalField.socialTension * 0.75 + flow.fear * 0.15 + num(density[placeId], 0) * 0.1).toFixed(3)),
      informationPressure: Number(clamp01(globalField.informationPressure * 0.55 + flow.pressure * 0.35 + num(density[placeId], 0) * 0.1).toFixed(3)),
      locationDensity: Number(num(density[placeId], 0).toFixed(3))
    };
  });
  return fields;
}

function computeSocialField(world = {}, inputs = {}) {
  const flows = [
    ...(Array.isArray(inputs.informationFlows) ? inputs.informationFlows : []),
    ...(Array.isArray(world.informationFlows) ? world.informationFlows : [])
  ];
  const flow = flowSignals(flows);
  const event = eventSignals(world, inputs.eventImpacts || []);
  const trust = relationNetworkStrength(world);
  const tension = socialProcessTension(world);
  const globalField = {
    version: "3.3",
    timestamp: num(world.clock, 0),
    fearLevel: Number(clamp01(flow.fear * 0.55 + event.fear * 0.3 + tension * 0.15).toFixed(3)),
    curiosityLevel: Number(clamp01(flow.curiosity * 0.5 + event.curiosity * 0.25 + flow.rumor * 0.25).toFixed(3)),
    rumorDensity: Number(clamp01(flow.rumor).toFixed(3)),
    trustNetworkStrength: Number(clamp01(trust).toFixed(3)),
    socialTension: Number(clamp01(tension * 0.55 + event.tension * 0.3 + flow.fear * 0.15).toFixed(3)),
    informationPressure: Number(clamp01(flow.pressure).toFixed(3)),
    source: "social-field-v3.3"
  };
  globalField.locationFields = buildLocationFields(world, globalField);
  return globalField;
}

function buildInformationFlowGraph(flows = []) {
  const nodes = new Map();
  const edges = [];
  (flows || []).slice(0, 80).forEach(flow => {
    (flow.knownBy || []).forEach(id => nodes.set(id, { id, knownCount: num(nodes.get(id)?.knownCount, 0) + 1 }));
    (flow.transmissions || []).forEach(tx => {
      if (!tx.from || !tx.to) return;
      nodes.set(tx.from, { id: tx.from, knownCount: num(nodes.get(tx.from)?.knownCount, 0) + 1 });
      nodes.set(tx.to, { id: tx.to, knownCount: num(nodes.get(tx.to)?.knownCount, 0) + 1 });
      edges.push({
        from: tx.from,
        to: tx.to,
        channel: tx.channel || "friend",
        probability: num(tx.probability, 0),
        delayMinutes: num(tx.delayMinutes, 0),
        distortion: num(tx.distortion, 0),
        impactId: flow.impactId || flow.id || ""
      });
    });
  });
  return {
    nodes: Array.from(nodes.values()).slice(0, 120),
    edges: edges.slice(0, 180),
    edgeCount: edges.length,
    source: "social-field-v3.3"
  };
}

function updateSocialField(world = {}, inputs = {}) {
  const socialField = computeSocialField(world, inputs);
  world.socialField = socialField;
  world.informationFlowGraph = buildInformationFlowGraph(world.informationFlows || []);
  const affectedSet = new Set([
    ...((inputs.affectedAgents || []).map(item => item.id || item).filter(Boolean)),
    ...((inputs.informationFlows || []).flatMap(flow => flow.knownBy || []))
  ]);
  world.socialDynamicsState = {
    version: "3.3",
    updatedAt: num(world.clock, 0),
    socialFieldSnapshot: {
      fearLevel: socialField.fearLevel,
      curiosityLevel: socialField.curiosityLevel,
      rumorDensity: socialField.rumorDensity,
      trustNetworkStrength: socialField.trustNetworkStrength,
      socialTension: socialField.socialTension,
      informationPressure: socialField.informationPressure
    },
    informationFlowGraph: world.informationFlowGraph,
    affectedAgents: Array.from(affectedSet).slice(0, 80).map(id => ({ id, name: agentName(world, id) })),
    behaviorDelta: socialFieldBehaviorDelta(socialField),
    source: "social-field-v3.3"
  };
  world.socialFieldHistory ||= [];
  world.socialFieldHistory.unshift({
    at: num(world.clock, 0),
    snapshot: world.socialDynamicsState.socialFieldSnapshot
  });
  world.socialFieldHistory = world.socialFieldHistory.slice(0, 72);
  return socialField;
}

function localFieldForAgent(world = {}, agent = {}) {
  const globalField = world.socialField || computeSocialField(world);
  const local = globalField.locationFields?.[agentPlace(agent)] || {};
  return {
    fearLevel: clamp01(num(globalField.fearLevel, 0) * 0.65 + num(local.fearLevel, globalField.fearLevel) * 0.35),
    curiosityLevel: clamp01(num(globalField.curiosityLevel, 0) * 0.6 + num(local.curiosityLevel, globalField.curiosityLevel) * 0.4),
    rumorDensity: clamp01(num(globalField.rumorDensity, 0) * 0.6 + num(local.rumorDensity, globalField.rumorDensity) * 0.4),
    trustNetworkStrength: clamp01(num(globalField.trustNetworkStrength, 0.35) * 0.75 + num(local.trustNetworkStrength, globalField.trustNetworkStrength) * 0.25),
    socialTension: clamp01(num(globalField.socialTension, 0) * 0.65 + num(local.socialTension, globalField.socialTension) * 0.35),
    informationPressure: clamp01(num(globalField.informationPressure, 0) * 0.6 + num(local.informationPressure, globalField.informationPressure) * 0.4),
    locationField: local
  };
}

function socialFieldBehaviorDelta(field = {}) {
  return {
    safetyNeed: Number(clamp01(num(field.fearLevel, 0) * 0.55 + num(field.socialTension, 0) * 0.24).toFixed(3)),
    curiosity: Number(clamp01(num(field.rumorDensity, 0) * 0.46 + num(field.curiosityLevel, 0) * 0.42 + num(field.informationPressure, 0) * 0.12).toFixed(3)),
    avoidance: Number(clamp01(num(field.socialTension, 0) * 0.48 + num(field.fearLevel, 0) * 0.34 + (1 - num(field.trustNetworkStrength, 0.5)) * 0.18).toFixed(3)),
    socialActions: Number(clamp((num(field.trustNetworkStrength, 0.5) - 0.5) * 0.42 - num(field.socialTension, 0) * 0.22 + num(field.informationPressure, 0) * 0.16, -1, 1, 0).toFixed(3)),
    comfortNeed: Number(clamp01(num(field.fearLevel, 0) * 0.22 + num(field.socialTension, 0) * 0.18).toFixed(3))
  };
}

function socialFieldInfluenceForAgent(world = {}, agent = {}) {
  const field = localFieldForAgent(world, agent);
  const delta = socialFieldBehaviorDelta(field);
  return {
    socialField: {
      fearLevel: Number(field.fearLevel.toFixed(3)),
      curiosityLevel: Number(field.curiosityLevel.toFixed(3)),
      rumorDensity: Number(field.rumorDensity.toFixed(3)),
      trustNetworkStrength: Number(field.trustNetworkStrength.toFixed(3)),
      socialTension: Number(field.socialTension.toFixed(3)),
      informationPressure: Number(field.informationPressure.toFixed(3))
    },
    ...delta,
    actionBias: {
      seek_safety: delta.safetyNeed * 0.8 + delta.avoidance * 0.18,
      return_home: delta.safetyNeed * 0.5 + delta.comfortNeed * 0.28,
      observe_environment: delta.curiosity * 0.42 + delta.avoidance * 0.16,
      contact_familiar: Math.max(0, delta.socialActions) * 0.42 + delta.safetyNeed * 0.18,
      walk_nearby: delta.curiosity * 0.24 - delta.avoidance * 0.36,
      follow_stranger: delta.curiosity * 0.22 - delta.safetyNeed * 0.62,
      rest: delta.comfortNeed * 0.42 + delta.avoidance * 0.16
    },
    source: "social-field-influence-v3.3"
  };
}

function socialFieldBiasForAction(world = {}, agent = {}, action = {}) {
  const influence = socialFieldInfluenceForAgent(world, agent);
  const direct = num(influence.actionBias?.[action.id], 0);
  const tags = `${action.id || ""} ${action.type || ""} ${(action.tags || []).join(" ")} ${action.targetNeed || ""}`.toLowerCase();
  const fearImpact = includesAny(tags, ["safety", "home", "care"]) ? influence.safetyNeed : includesAny(tags, ["risk", "stranger", "walk"]) ? -influence.safetyNeed : 0;
  const curiosityImpact = includesAny(tags, ["observe", "novelty", "record", "talk"]) ? influence.curiosity : 0;
  const trustImpact = includesAny(tags, ["social", "support", "care", "customer"]) ? influence.socialActions : 0;
  const tensionImpact = includesAny(tags, ["rest", "home", "observe"]) ? influence.avoidance * 0.35 : includesAny(tags, ["stranger", "walk", "contact"]) ? -influence.avoidance * 0.22 : 0;
  const raw = direct * 14 + fearImpact * 8 + curiosityImpact * 6 + trustImpact * 7 + tensionImpact * 8;
  return {
    score: Number(clamp(raw, -16, 16, 0).toFixed(2)),
    field: influence.socialField,
    components: {
      fearImpact: Number(fearImpact.toFixed(3)),
      curiosityImpact: Number(curiosityImpact.toFixed(3)),
      trustImpact: Number(trustImpact.toFixed(3)),
      tensionImpact: Number(tensionImpact.toFixed(3)),
      direct: Number(direct.toFixed(3))
    },
    behaviorDelta: {
      safetyNeed: influence.safetyNeed,
      curiosity: influence.curiosity,
      avoidance: influence.avoidance,
      socialActions: influence.socialActions
    },
    source: "social-field-bias-v3.3"
  };
}

module.exports = {
  computeSocialField,
  updateSocialField,
  propagateInformation,
  buildInformationFlowGraph,
  socialFieldInfluenceForAgent,
  socialFieldBiasForAction,
  socialFieldBehaviorDelta,
  informationTypeProfile,
  propagationProbability
};

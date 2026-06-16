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

function unique(items = []) {
  return Array.from(new Set(items.filter(Boolean).map(String)));
}

function agentPlace(agent = {}) {
  return String(agent.position || agent.place || agent.currentLocation || "");
}

function safeTanh(value) {
  return Math.tanh(clamp(value, -4, 4, 0));
}

function identitySocialSensitivity(agent = {}) {
  const identity = agent.identityCore || {};
  const profile = agent.cognitiveProfile || {};
  const self = agent.selfModel || {};
  const direct = identity.socialSensitivity ?? profile.socialSensitivity ?? self.socialSensitivity;
  if (direct !== undefined && direct !== null && direct !== "") {
    return Number(clamp(direct, 0.1, 1.5, 0.65).toFixed(3));
  }
  const text = `${textOf(identity)} ${textOf(profile)} ${textOf(self)} ${agent.job || ""} ${agent.ageStage || ""}`.toLowerCase();
  let value = 0.65;
  if (includesAny(text, ["sensitive", "empathy", "social", "care", "teacher", "doctor", "family", "敏感", "共情", "社交", "照顾", "老师", "医生", "家人"])) value += 0.22;
  if (includesAny(text, ["guard", "security", "leader", "public", "保安", "镇务", "公共"])) value += 0.12;
  if (includesAny(text, ["introvert", "quiet", "avoid", "alone", "内向", "安静", "回避", "独处"])) value -= 0.16;
  if (includesAny(text, ["stoic", "independent", "冷静", "独立", "稳定"])) value -= 0.1;
  value += (clamp01(profile.empathy, 0.5) - 0.5) * 0.22;
  value += (clamp01(profile.socialDrive, 0.5) - 0.5) * 0.16;
  value -= (clamp01(profile.riskTolerance, 0.5) - 0.5) * 0.08;
  return Number(clamp(value, 0.1, 1.5, 0.65).toFixed(3));
}

function socialSusceptibility(agent = {}) {
  return identitySocialSensitivity(agent);
}

function flowCategory(flow = {}) {
  const packetType = String(flow.informationPacket?.informationType || "").toLowerCase();
  if (["death", "critical"].includes(packetType)) return "community_fear";
  if (packetType === "social") return "community_conflict";
  if (packetType === "concern") return "care_concern";
  const text = `${flow.fact || ""} ${flow.summary || ""} ${flow.impactId || ""}`.toLowerCase();
  if (includesAny(text, ["death", "dead", "critical", "medical", "hospital", "clinic", "unsafe", "死亡", "急症", "医疗", "医院", "诊所", "危险"])) return "community_fear";
  if (includesAny(text, ["conflict", "argument", "misunderstanding", "rumor", "secret", "冲突", "争吵", "误会", "流言", "隐瞒"])) return "community_conflict";
  if (includesAny(text, ["work", "class", "public", "duty", "office", "school", "工作", "上课", "公共", "责任"])) return "public_responsibility";
  if (includesAny(text, ["help", "care", "sick", "family", "friend", "帮助", "照顾", "不适", "家人", "朋友"])) return "care_concern";
  if (includesAny(text, ["strange", "unknown", "news", "notice", "陌生", "消息", "通知"])) return "public_curiosity";
  return "public_curiosity";
}

function fieldResonance(field = {}, category = "") {
  if (category === "community_fear") return clamp01(num(field.fearLevel, 0) * 0.65 + num(field.socialTension, 0) * 0.25 + num(field.informationPressure, 0) * 0.1);
  if (category === "community_conflict") return clamp01(num(field.socialTension, 0) * 0.55 + num(field.rumorDensity, 0) * 0.3 + num(field.fearLevel, 0) * 0.15);
  if (category === "public_curiosity") return clamp01(num(field.curiosityLevel, 0) * 0.55 + num(field.rumorDensity, 0) * 0.28 + num(field.informationPressure, 0) * 0.17);
  if (category === "public_responsibility") return clamp01(num(field.informationPressure, 0) * 0.5 + num(field.trustNetworkStrength, 0.35) * 0.25 + num(field.socialTension, 0) * 0.15);
  if (category === "care_concern") return clamp01(num(field.fearLevel, 0) * 0.28 + num(field.informationPressure, 0) * 0.32 + num(field.trustNetworkStrength, 0.35) * 0.22);
  return clamp01(num(field.informationPressure, 0));
}

function localSocialField(world = {}, agent = {}) {
  const global = world.socialField || {};
  const local = global.locationFields?.[agentPlace(agent)] || {};
  return {
    fearLevel: clamp01(num(global.fearLevel, 0) * 0.65 + num(local.fearLevel, global.fearLevel) * 0.35),
    curiosityLevel: clamp01(num(global.curiosityLevel, 0) * 0.62 + num(local.curiosityLevel, global.curiosityLevel) * 0.38),
    rumorDensity: clamp01(num(global.rumorDensity, 0) * 0.62 + num(local.rumorDensity, global.rumorDensity) * 0.38),
    trustNetworkStrength: clamp01(num(global.trustNetworkStrength, 0.35) * 0.72 + num(local.trustNetworkStrength, global.trustNetworkStrength) * 0.28),
    socialTension: clamp01(num(global.socialTension, 0) * 0.65 + num(local.socialTension, global.socialTension) * 0.35),
    informationPressure: clamp01(num(global.informationPressure, 0) * 0.62 + num(local.informationPressure, global.informationPressure) * 0.38)
  };
}

function relationTrustAverage(agent = {}) {
  const rels = Object.values(agent.relationshipMatrix || {});
  if (!rels.length) return 0.35;
  const total = rels.reduce((sum, rel) => {
    if (typeof rel === "number") return sum + clamp01(rel / 100);
    return sum + clamp01((num(rel.trust, 0) * 0.48 + num(rel.intimacy, 0) * 0.24 + num(rel.respect, 0) * 0.18 - num(rel.resentment, 0) * 0.2) / 100);
  }, 0);
  return clamp01(total / rels.length);
}

function knownStrengthForAgent(flow = {}, agentId = "") {
  const known = Array.isArray(flow.knownBy) ? flow.knownBy : [];
  if (!known.includes(agentId)) return 0;
  const direct = Array.isArray(flow.directKnownBy) ? flow.directKnownBy : [];
  if (direct.includes(agentId) || flow.source === agentId || flow.informationPacket?.source === agentId) return 1;
  const tx = (flow.transmissions || []).find(item => item.to === agentId || item.from === agentId);
  if (!tx) return 0.45;
  const depth = clamp(tx.informationPacket?.spreadDepth, 1, 5, 1);
  const confidence = clamp01(tx.informationPacket?.confidence, 0.65);
  return clamp01(confidence * (0.78 ** Math.max(0, depth - 1)));
}

function impressionFromFlow(world = {}, agent = {}, flow = {}) {
  const agentId = agent.id || "";
  const knownStrength = knownStrengthForAgent(flow, agentId);
  if (!knownStrength) return null;
  const category = flowCategory(flow);
  const packet = flow.informationPacket || {};
  const emotionalImpact = clamp01(num(packet.emotionalWeight, num(flow.rumorRisk, 0) / 100));
  const confidence = clamp01(packet.confidence, 0.7);
  const distortion = clamp01(packet.distortionLevel, num(flow.rumorRisk, 0) / 100);
  const resonance = fieldResonance(localSocialField(world, agent), category);
  const strength = clamp01((emotionalImpact * 0.36 + confidence * 0.22 + knownStrength * 0.28 + resonance * 0.14) * (1 + distortion * 0.12));
  const relatedAgents = unique([
    flow.source,
    flow.informationPacket?.source,
    ...(flow.knownBy || []),
    ...(flow.transmissions || []).flatMap(item => [item.from, item.to])
  ]).filter(id => id !== agentId).slice(0, 12);
  return {
    eventId: String(flow.impactId || flow.id || `${category}-${num(world.clock, 0)}`),
    category,
    emotionalImpact: Number(emotionalImpact.toFixed(3)),
    strength: Number(strength.toFixed(3)),
    decayRate: category === "community_fear" ? 0.08 : category === "community_conflict" ? 0.1 : category === "public_responsibility" ? 0.065 : 0.12,
    lastUpdate: num(world.clock, 0),
    relatedAgents,
    source: "social-feedback-v3.3.1"
  };
}

function decayImpression(world = {}, agent = {}, impression = {}) {
  const clock = num(world.clock, 0);
  const deltaHours = Math.max(0, (clock - num(impression.lastUpdate, clock)) / 60);
  const category = String(impression.category || "public_curiosity");
  const resonance = fieldResonance(localSocialField(world, agent), category);
  const lambda = clamp(num(impression.decayRate, 0.1) * (1 - resonance * 0.55), 0.015, 0.5, 0.1);
  const strength = clamp01(num(impression.strength, 0) * Math.exp(-lambda * deltaHours));
  return {
    ...impression,
    strength: Number(strength.toFixed(3)),
    lastUpdate: clock
  };
}

function consolidateSocialImpressions(items = []) {
  const groups = new Map();
  items
    .filter(item => item && num(item.strength, 0) >= 0.05)
    .forEach(item => {
      const key = String(item.category || "public_curiosity");
      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, {
          eventId: item.eventId || key,
          category: key,
          emotionalImpact: num(item.emotionalImpact, 0),
          strength: num(item.strength, 0),
          decayRate: num(item.decayRate, 0.1),
          lastUpdate: num(item.lastUpdate, 0),
          relatedAgents: unique(item.relatedAgents || []),
          sourceEvents: unique([item.eventId, ...(item.sourceEvents || [])]),
          source: "social-feedback-v3.3.1"
        });
        return;
      }
      existing.eventId = `${key}_aggregate`;
      existing.emotionalImpact = Math.max(existing.emotionalImpact, num(item.emotionalImpact, 0));
      existing.strength = clamp01(Math.max(existing.strength, num(item.strength, 0)) + num(item.strength, 0) * 0.32);
      existing.decayRate = Math.min(existing.decayRate, num(item.decayRate, existing.decayRate));
      existing.lastUpdate = Math.max(existing.lastUpdate, num(item.lastUpdate, 0));
      existing.relatedAgents = unique([...existing.relatedAgents, ...(item.relatedAgents || [])]).slice(0, 16);
      existing.sourceEvents = unique([...existing.sourceEvents, item.eventId, ...(item.sourceEvents || [])]).slice(0, 20);
    });
  return Array.from(groups.values())
    .sort((a, b) => num(b.strength, 0) - num(a.strength, 0))
    .slice(0, 12)
    .map(item => ({
      ...item,
      emotionalImpact: Number(clamp01(item.emotionalImpact).toFixed(3)),
      strength: Number(clamp01(item.strength).toFixed(3)),
      decayRate: Number(clamp(item.decayRate, 0.015, 0.5, 0.1).toFixed(3))
    }));
}

function updateSocialImpressions(world = {}, agent = {}) {
  const existing = Array.isArray(agent.socialImpressions)
    ? agent.socialImpressions
    : Array.isArray(agent.socialImpression) ? agent.socialImpression : [];
  const decayed = existing.map(item => decayImpression(world, agent, item));
  const seen = new Set(decayed.flatMap(item => [item.eventId, ...(item.sourceEvents || [])]).filter(Boolean));
  const incoming = (world.informationFlows || [])
    .slice(0, 40)
    .map(flow => impressionFromFlow(world, agent, flow))
    .filter(Boolean)
    .filter(item => {
      if (seen.has(item.eventId)) return false;
      seen.add(item.eventId);
      return true;
    });
  const consolidated = consolidateSocialImpressions([...decayed, ...incoming]);
  agent.socialImpressions = consolidated;
  agent.socialImpression = consolidated;
  return consolidated;
}

function impressionStrength(impressions = [], category = "") {
  return clamp01(impressions
    .filter(item => item.category === category)
    .reduce((sum, item) => sum + num(item.strength, 0) * (0.55 + num(item.emotionalImpact, 0) * 0.45), 0));
}

function socialRegulation(raw = {}, sensitivity = 0.65) {
  const weights = {
    fearModifier: 0.95,
    curiosityModifier: 0.72,
    trustModifier: 0.62,
    responsibilityModifier: 0.58,
    avoidanceModifier: 0.86,
    socialNeedModifier: 0.55
  };
  const regulated = {};
  Object.entries(weights).forEach(([key, weight]) => {
    regulated[key] = Number(clamp(safeTanh(num(raw[key], 0) * weight) * sensitivity, -1, 1, 0).toFixed(3));
  });
  const combined = Object.entries(weights).reduce((sum, [key, weight]) => sum + num(raw[key], 0) * weight, 0);
  regulated.regulatedSocialEffect = Number(clamp(safeTanh(combined) * sensitivity, -1, 1, 0).toFixed(3));
  return regulated;
}

function buildSocialModifier(world = {}, agent = {}, options = {}) {
  const impressions = options.skipUpdate ? (agent.socialImpressions || agent.socialImpression || []) : updateSocialImpressions(world, agent);
  const field = localSocialField(world, agent);
  const sensitivity = socialSensitivity(agent);
  const trustAverage = relationTrustAverage(agent);
  const fear = impressionStrength(impressions, "community_fear");
  const conflict = impressionStrength(impressions, "community_conflict");
  const curiosity = impressionStrength(impressions, "public_curiosity");
  const responsibility = impressionStrength(impressions, "public_responsibility");
  const care = impressionStrength(impressions, "care_concern");
  const raw = {
    fearModifier: field.fearLevel * 0.58 + fear * 0.42 + field.socialTension * 0.12,
    curiosityModifier: field.curiosityLevel * 0.48 + field.rumorDensity * 0.28 + curiosity * 0.32,
    trustModifier: (field.trustNetworkStrength - 0.5) * 0.7 + (trustAverage - 0.5) * 0.36 - conflict * 0.26,
    responsibilityModifier: field.informationPressure * 0.2 + responsibility * 0.48 + care * 0.25,
    avoidanceModifier: field.socialTension * 0.46 + field.fearLevel * 0.34 + conflict * 0.32 + fear * 0.22 - clamp01(agent.cognitiveProfile?.riskTolerance, 0.5) * 0.14,
    socialNeedModifier: field.curiosityLevel * 0.18 + care * 0.24 + Math.max(0, trustAverage - 0.45) * 0.22 - Math.max(0, 0.45 - field.trustNetworkStrength) * 0.28 - conflict * 0.12
  };
  const regulated = socialRegulation(raw, sensitivity);
  const sourceEvents = unique(impressions.flatMap(item => item.sourceEvents?.length ? item.sourceEvents : [item.eventId])).slice(0, 20);
  const modifier = {
    agentId: agent.id || "",
    fearModifier: regulated.fearModifier,
    curiosityModifier: regulated.curiosityModifier,
    trustModifier: regulated.trustModifier,
    responsibilityModifier: regulated.responsibilityModifier,
    avoidanceModifier: regulated.avoidanceModifier,
    socialNeedModifier: regulated.socialNeedModifier,
    socialSensitivity: sensitivity,
    socialSusceptibility: sensitivity,
    regulatedSocialEffect: regulated.regulatedSocialEffect,
    sourceEvents,
    impressionCount: impressions.length,
    source: "social-feedback-v3.3.1"
  };
  agent.agentSocialModifier = modifier;
  return modifier;
}

function socialSensitivity(agent = {}) {
  return identitySocialSensitivity(agent);
}

function getSocialModifier(world = {}, agent = {}, options = {}) {
  if (!options.force && agent.agentSocialModifier && agent.agentSocialModifier.source === "social-feedback-v3.3.1") {
    return agent.agentSocialModifier;
  }
  return buildSocialModifier(world, agent, options);
}

function updateSocialFeedback(world = {}, options = {}) {
  const agents = (world.agents || []).filter(agent => agent?.id && agent.lifeStatus !== "dead" && !agent.terminalState?.dead);
  const modifiers = agents.map(agent => buildSocialModifier(world, agent, options));
  world.agentSocialModifiers = modifiers;
  world.socialFeedbackState = {
    version: "3.3.1",
    updatedAt: num(world.clock, 0),
    count: modifiers.length,
    modifiers: modifiers.slice(0, 120),
    impressionCount: agents.reduce((sum, agent) => sum + (agent.socialImpressions || []).length, 0),
    strongest: modifiers
      .slice()
      .sort((a, b) => Math.abs(num(b.regulatedSocialEffect, 0)) - Math.abs(num(a.regulatedSocialEffect, 0)))
      .slice(0, 12),
    source: "social-feedback-v3.3.1"
  };
  return world.socialFeedbackState;
}

function socialFeedbackBiasForAction(world = {}, agent = {}, action = {}) {
  const modifier = getSocialModifier(world, agent);
  const id = String(action.id || "");
  const tags = `${id} ${action.type || ""} ${(action.tags || []).join(" ")} ${action.targetNeed || ""}`.toLowerCase();
  let raw = 0;
  if (["seek_safety", "return_home"].includes(id) || includesAny(tags, ["safety", "home"])) raw += modifier.fearModifier * 0.55 + modifier.avoidanceModifier * 0.36;
  if (["rest", "observe_environment", "think_and_plan"].includes(id)) raw += modifier.avoidanceModifier * 0.18 + modifier.fearModifier * 0.08;
  if (["walk_nearby", "follow_stranger"].includes(id) || includesAny(tags, ["risk", "stranger", "walk"])) raw += modifier.curiosityModifier * 0.22 - modifier.fearModifier * 0.48 - modifier.avoidanceModifier * 0.42;
  if (["observe_environment", "record_observation"].includes(id) || includesAny(tags, ["observe", "novelty"])) raw += modifier.curiosityModifier * 0.46 + modifier.avoidanceModifier * 0.08;
  if (["contact_familiar", "ask_guardian"].includes(id) || includesAny(tags, ["social", "support"])) raw += modifier.socialNeedModifier * 0.42 + modifier.trustModifier * 0.34 + modifier.fearModifier * 0.12;
  if (["follow_plan", "continue_process", "provide_care", "serve_customers", "check_inventory"].includes(id) || includesAny(tags, ["work", "duty", "care", "business"])) raw += modifier.responsibilityModifier * 0.45 + modifier.trustModifier * 0.12;
  const score = clamp(raw * 14, -14, 14, 0);
  return {
    score: Number(score.toFixed(2)),
    gamma: modifier.socialSusceptibility,
    modifier,
    source: "social-feedback-bias-v3.3.1"
  };
}

module.exports = {
  socialSensitivity,
  socialSusceptibility,
  updateSocialImpressions,
  buildSocialModifier,
  getSocialModifier,
  updateSocialFeedback,
  socialFeedbackBiasForAction,
  socialRegulation,
  flowCategory,
  fieldResonance
};

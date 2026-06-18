"use strict";

const DEFAULT_DECAY_LAMBDA = 0.00035;
const DEFAULT_CAUSAL_WEIGHT = 0.12;
const MAX_CAUSAL_WEIGHT = 0.2;
const MAX_CAUSAL_MEMORY = 40;

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

function compactText(value = "", fallback = "", limit = 180) {
  const text = String(value ?? fallback ?? "").replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, limit);
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

function eventText(event = {}) {
  return [
    event.id,
    event.type,
    event.actionType,
    event.localAction,
    event.planTitle,
    event.summary,
    event.interruption?.type,
    event.interruption?.reason
  ].filter(Boolean).join(" ").toLowerCase();
}

function includesAny(text = "", words = []) {
  const value = String(text || "").toLowerCase();
  return words.some(word => value.includes(String(word).toLowerCase()));
}

function magnitude(value, fallback = 0) {
  if (value == null) return fallback;
  if (typeof value === "number") return Math.abs(value);
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + Math.abs(Number(item) || 0), 0);
  if (typeof value === "object") {
    const values = Object.values(value).map(item => Math.abs(Number(item) || 0)).filter(Number.isFinite);
    return values.length ? Math.max(...values) : fallback;
  }
  return Math.abs(Number(value) || fallback);
}

function normalizePercent(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  if (number <= 1 && number >= 0) return number;
  if (Math.abs(number) <= 10) return clamp01(Math.abs(number) / 10, fallback);
  return clamp01(Math.abs(number) / 100, fallback);
}

function stableIdPart(value = "") {
  return String(value || "unknown")
    .replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]+/g, "_")
    .slice(0, 72);
}

function ensureCausalMemory(agent = {}) {
  if (!Array.isArray(agent.causalMemory)) agent.causalMemory = [];
  agent.temporalCausalState ||= {};
  if (!Array.isArray(agent.temporalCausalState.processedEventIds)) {
    agent.temporalCausalState.processedEventIds = [];
  }
  return agent.causalMemory;
}

function causalConfig(world = {}) {
  const cfg = world.config?.temporalCausal || world.temporalCausal || {};
  return {
    enabled: cfg.enabled !== false && world.config?.temporalCausalEnabled !== false,
    threshold: clamp(cfg.threshold ?? world.config?.causalMemoryThreshold, 0.005, 0.4, 0.035),
    decayLambda: clamp(cfg.decayLambda ?? world.config?.causalMemoryDecayLambda, 0, 0.01, DEFAULT_DECAY_LAMBDA),
    maxMemory: Math.round(clamp(cfg.maxMemory ?? world.config?.causalMemoryMax, 8, 200, MAX_CAUSAL_MEMORY)),
    causalWeight: clamp(world.config?.causalWeight ?? cfg.causalWeight, 0, MAX_CAUSAL_WEIGHT, DEFAULT_CAUSAL_WEIGHT)
  };
}

function collectAgentEvents(world = {}, agent = {}, extraEvent = null) {
  const rows = [];
  const push = event => {
    if (!event || typeof event !== "object") return;
    if (event.agentId && agent.id && event.agentId !== agent.id) return;
    rows.push(event);
  };
  if (extraEvent) push(extraEvent);
  (Array.isArray(agent.eventLog) ? agent.eventLog : []).forEach(push);
  (Array.isArray(world.eventLog) ? world.eventLog : []).forEach(push);
  const seen = new Set();
  return rows
    .filter(event => {
      const id = String(event.id || `${event.clock}:${event.summary || event.type || ""}`);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .sort((a, b) => num(a.clock ?? a.timestamp, 0) - num(b.clock ?? b.timestamp, 0))
    .slice(-120);
}

function isWorkLike(event = {}) {
  const text = eventText(event);
  return includesAny(text, [
    "work",
    "shift",
    "office",
    "study",
    "class",
    "duty",
    "responsibility",
    "follow_plan",
    "continue_process"
  ]);
}

function isSocialContact(event = {}) {
  const text = eventText(event);
  return includesAny(text, [
    "contact_familiar",
    "ask_guardian",
    "talk",
    "social",
    "friend",
    "family",
    "help",
    "support",
    "relationship",
    "cooperate"
  ]);
}

function isHealthCare(event = {}) {
  const text = eventText(event);
  return includesAny(text, ["seek_care", "clinic", "doctor", "health", "medical", "sick", "ill"]);
}

function isSafetyResponse(event = {}) {
  const text = eventText(event);
  return includesAny(text, ["seek_safety", "danger", "unsafe", "risk", "stranger", "threat", "return_home"]);
}

function isRelationshipSupport(event = {}) {
  const text = eventText(event);
  return includesAny(text, ["help", "assist", "support", "care", "trust", "cooperate", "promise", "conflict"]);
}

function isOrdinaryFoodEvent(event = {}) {
  const text = eventText(event);
  if (!includesAny(text, ["eat", "meal", "food", "breakfast", "plan_meal"])) return false;
  const highStateChange = magnitude(event.emotionDelta) >= 12
    || magnitude(event.relationshipDelta || event.relationDelta) >= 8
    || magnitude(event.goalDelta) >= 12
    || num(event.goalImpact, 0) >= 45
    || num(event.interruption?.priority, 0) >= 70;
  return !highStateChange;
}

function eventImpact(event = {}, chainBoost = 0) {
  const interruption = event.interruption || {};
  const base = Math.max(
    normalizePercent(event.abnormality, event.category === "routine" ? 0.04 : 0.25),
    normalizePercent(event.futureImpact, 0),
    normalizePercent(event.goalImpact, 0),
    normalizePercent(interruption.priority, 0) * (interruption.canOverridePlan ? 1 : 0.65),
    normalizePercent(magnitude(event.healthChange), 0),
    chainBoost
  );
  return clamp01(base, 0);
}

function emotionChange(event = {}, context = {}) {
  return Math.max(
    clamp01(magnitude(event.emotionDelta) / 45, 0),
    clamp01(magnitude(context.emotionDelta) / 45, 0),
    normalizePercent(event.emotionalIntensity, 0)
  );
}

function needChange(event = {}, context = {}) {
  return Math.max(
    clamp01(magnitude(event.needDelta) / 35, 0),
    clamp01(magnitude(context.needDelta) / 35, 0),
    clamp01(magnitude(event.healthChange) / 35, 0)
  );
}

function relationshipImpact(agent = {}, event = {}, fallback = 0.08) {
  const delta = event.relationshipDelta || event.relationDelta || {};
  const explicit = Math.max(
    clamp01(magnitude(delta) / 35, 0),
    normalizePercent(event.relationshipImpact ?? event.relationImpact, 0)
  );
  if (explicit > 0) return explicit;
  if (!event.targetAgentId || event.targetAgentId === agent.id) return fallback;
  const rel = agent.relationshipMatrix?.[event.targetAgentId] || agent.relationships?.[event.targetAgentId] || {};
  if (typeof rel === "number") return normalizePercent(rel, fallback);
  return Math.max(
    normalizePercent(rel.trust, fallback),
    normalizePercent(rel.intimacy, fallback),
    normalizePercent(rel.familiarity, fallback),
    fallback
  );
}

function temporalCausalStrength(input = {}) {
  const dimensions = {
    eventImpact: clamp01(input.eventImpact, 0),
    emotionChange: clamp01(input.emotionChange, 0),
    relationshipImpact: clamp01(input.relationshipImpact, 0),
    repeatCount: clamp01(num(input.repeatCount, 0) / 5, 0),
    confidence: clamp01(input.confidence, 0.55)
  };
  const strength = dimensions.eventImpact
    * dimensions.emotionChange
    * dimensions.relationshipImpact
    * Math.max(0.05, dimensions.repeatCount)
    * dimensions.confidence;
  return {
    strength: Number(clamp01(strength, 0).toFixed(3)),
    dimensions: Object.fromEntries(Object.entries(dimensions).map(([key, value]) => [key, Number(value.toFixed(3))])),
    rawRepeatCount: Math.max(0, num(input.repeatCount, 0))
  };
}

function repeatCountFor(events = [], index = 0, predicate = () => false, windowMinutes = 720) {
  const event = events[index] || {};
  const clock = num(event.clock ?? event.timestamp, 0);
  return events
    .slice(0, index + 1)
    .filter(item => clock - num(item.clock ?? item.timestamp, clock) <= windowMinutes)
    .filter(predicate)
    .length;
}

function priorEvents(events = [], index = 0, minutes = 720) {
  const event = events[index] || {};
  const clock = num(event.clock ?? event.timestamp, 0);
  return events
    .slice(0, index)
    .filter(item => clock - num(item.clock ?? item.timestamp, clock) <= minutes);
}

function socialDepletionSignal(events = [], agent = {}) {
  const fromEvents = events.reduce((sum, event) => {
    const delta = event.needDelta || {};
    const emotion = event.emotionDelta || {};
    const socialDrop = Math.max(0, -num(delta.social, 0)) / 35;
    const lonelinessRise = Math.max(0, num(emotion.lonely, 0)) / 35;
    const tiredRise = Math.max(0, num(emotion.tired, 0)) / 45;
    return sum + Math.max(socialDrop, lonelinessRise, tiredRise * 0.5);
  }, 0);
  const currentLow = clamp01((100 - num(agent.needs?.social, 70)) / 100, 0);
  const lonely = normalizePercent(agent.emotionVector?.lonely ?? agent.emotions?.lonely, 0);
  return clamp01(fromEvents / Math.max(1, events.length) + currentLow * 0.45 + lonely * 0.35, 0);
}

function chainFromEvent(world = {}, agent = {}, events = [], index = 0, context = {}) {
  const event = events[index] || {};
  const text = eventText(event);
  if (isOrdinaryFoodEvent(event)) return null;

  const previous = priorEvents(events, index, 720);
  const workEvents = previous.filter(isWorkLike);
  const socialSignal = socialDepletionSignal([...workEvents, event], agent);
  if (isSocialContact(event) && workEvents.length >= 3 && socialSignal >= 0.22) {
    const repeatCount = workEvents.length;
    const impact = eventImpact(event, clamp01(0.35 + workEvents.length * 0.08, 0));
    const emotion = Math.max(emotionChange(event, context), socialSignal);
    const relation = Math.max(relationshipImpact(agent, event, 0.32), 0.38);
    const confidence = clamp01(0.48 + Math.min(0.24, repeatCount * 0.04) + emotion * 0.12, 0.55);
    return {
      category: "work_social_recovery",
      triggerKey: "long_work_social_depletion",
      trigger: {
        event: compactText(workEvents[0]?.summary || workEvents[0]?.type || "long work period", "long work period", 160),
        context: compactText(event.summary || "contacted a familiar person after long work", "", 180)
      },
      cause: {
        stateChange: "social_depletion_after_long_work",
        factors: ["work_duration", "social_need_drop", "loneliness_or_fatigue"].filter(Boolean)
      },
      effect: {
        emotionChange: "loneliness_or_tiredness_changed",
        needChange: "social_or_comfort_need_changed",
        behaviorChange: compactText(event.type || event.actionType || "contact_familiar", "contact_familiar", 80)
      },
      learning: {
        causalRule: "Long focused work periods can lower social and comfort state.",
        causalBelief: "Contacting a familiar person can help me recover from social depletion.",
        confidence
      },
      sourceEvents: [...workEvents.slice(-5).map(item => item.id).filter(Boolean), event.id].filter(Boolean),
      eventImpact: impact,
      emotionChange: emotion,
      relationshipImpact: relation,
      repeatCount
    };
  }

  if (isHealthCare(event)) {
    const healthEvents = previous.filter(isHealthCare);
    const state = Math.max(needChange(event, context), normalizePercent(100 - num(agent.needs?.health, 80), 0));
    if (state >= 0.35 && healthEvents.length >= 1) {
      const repeatCount = healthEvents.length + 1;
      return {
        category: "health_care_response",
        triggerKey: "health_decline_care",
        trigger: {
          event: compactText(healthEvents[0]?.summary || "health state changed", "", 160),
          context: compactText(event.summary || "handled health concern", "", 180)
        },
        cause: {
          stateChange: "health_pressure",
          factors: ["health_need", "fatigue", "care_response"]
        },
        effect: {
          emotionChange: "anxiety_or_tiredness_changed",
          needChange: "health_need_changed",
          behaviorChange: compactText(event.type || event.actionType || "seek_care", "seek_care", 80)
        },
        learning: {
          causalRule: "Repeated health pressure tends to disrupt ordinary plans.",
          causalBelief: "Handling health concerns early is safer than ignoring them.",
          confidence: clamp01(0.5 + state * 0.18, 0.55)
        },
        sourceEvents: [...healthEvents.slice(-4).map(item => item.id).filter(Boolean), event.id].filter(Boolean),
        eventImpact: eventImpact(event, 0.55),
        emotionChange: Math.max(emotionChange(event, context), state),
        relationshipImpact: relationshipImpact(agent, event, 0.35),
        repeatCount
      };
    }
  }

  if (isSafetyResponse(event)) {
    const safetyEvents = previous.filter(isSafetyResponse);
    const state = Math.max(needChange(event, context), normalizePercent(100 - num(agent.needs?.safety, 82), 0));
    if (state >= 0.3 && safetyEvents.length >= 1) {
      const repeatCount = safetyEvents.length + 1;
      return {
        category: "safety_response",
        triggerKey: "risk_safety_response",
        trigger: {
          event: compactText(safetyEvents[0]?.summary || "risk signal appeared", "", 160),
          context: compactText(event.summary || "responded to risk", "", 180)
        },
        cause: {
          stateChange: "safety_pressure",
          factors: ["risk_signal", "safety_need", "avoidance"]
        },
        effect: {
          emotionChange: "anxiety_or_caution_changed",
          needChange: "safety_need_changed",
          behaviorChange: compactText(event.type || event.actionType || "seek_safety", "seek_safety", 80)
        },
        learning: {
          causalRule: "Risk signals make careful checking more useful.",
          causalBelief: "When I feel unsafe, confirming the environment helps me stay stable.",
          confidence: clamp01(0.48 + state * 0.18, 0.55)
        },
        sourceEvents: [...safetyEvents.slice(-4).map(item => item.id).filter(Boolean), event.id].filter(Boolean),
        eventImpact: eventImpact(event, 0.5),
        emotionChange: Math.max(emotionChange(event, context), state),
        relationshipImpact: relationshipImpact(agent, event, 0.28),
        repeatCount
      };
    }
  }

  if (isRelationshipSupport(event) && magnitude(event.relationshipDelta || event.relationDelta) >= 8) {
    const similar = previous.filter(isRelationshipSupport);
    const repeatCount = similar.length + 1;
    if (repeatCount >= 2 || magnitude(event.emotionDelta) >= 18) {
      return {
        category: "relationship_support",
        triggerKey: "relationship_interaction",
        trigger: {
          event: compactText(event.summary || "relationship interaction", "", 160),
          context: compactText(event.targetAgentId || "", "", 80)
        },
        cause: {
          stateChange: "relationship_trust_changed",
          factors: ["trust_delta", "interaction", "emotion_delta"]
        },
        effect: {
          emotionChange: "trust_related_emotion_changed",
          needChange: "social_need_changed",
          behaviorChange: compactText(event.type || event.actionType || "relationship_action", "relationship_action", 80)
        },
        learning: {
          causalRule: "Meaningful help or conflict changes later relationship expectations.",
          causalBelief: "People who repeatedly support me are more reliable to approach.",
          confidence: clamp01(0.5 + relationshipImpact(agent, event, 0.35) * 0.18, 0.55)
        },
        sourceEvents: [event.id].filter(Boolean),
        eventImpact: eventImpact(event, 0.45),
        emotionChange: Math.max(emotionChange(event, context), 0.35),
        relationshipImpact: relationshipImpact(agent, event, 0.35),
        repeatCount
      };
    }
  }

  const repeated = repeatCountFor(events, index, item => {
    const itemText = eventText(item);
    return itemText && text && itemText !== text && itemText.split(/\s+/).some(token => token.length > 3 && text.includes(token));
  });
  const impact = eventImpact(event);
  const state = Math.max(needChange(event, context), emotionChange(event, context));
  if (impact >= 0.65 && state >= 0.45 && repeated >= 2) {
    return {
      category: "general_temporal_pattern",
      triggerKey: stableIdPart(event.type || event.actionType || "general"),
      trigger: {
        event: compactText(event.summary || event.type || "important repeated event", "", 160),
        context: compactText(event.place || agent.position || "", "", 80)
      },
      cause: {
        stateChange: "important_repeated_state_change",
        factors: ["event_impact", "state_change", "repeat_pattern"]
      },
      effect: {
        emotionChange: "emotion_changed",
        needChange: "need_changed",
        behaviorChange: compactText(event.type || event.actionType || "response", "response", 80)
      },
      learning: {
        causalRule: "Repeated high-impact events can predict similar state changes.",
        causalBelief: "I should treat repeated high-impact patterns as useful caution.",
        confidence: 0.55
      },
      sourceEvents: [event.id].filter(Boolean),
      eventImpact: impact,
      emotionChange: state,
      relationshipImpact: relationshipImpact(agent, event, 0.32),
      repeatCount: repeated
    };
  }

  return null;
}

function decayCausalMemory(world = {}, agent = {}) {
  const memories = ensureCausalMemory(agent);
  const cfg = causalConfig(world);
  const clock = num(world.clock, 0);
  memories.forEach(memory => {
    const last = num(memory.lastDecayAt ?? memory.lastConfirmed ?? memory.timestamp, clock);
    const delta = Math.max(0, clock - last);
    const lambda = clamp(num(memory.decayRate, cfg.decayLambda), 0, 0.01, cfg.decayLambda);
    const current = clamp01(memory.learning?.confidence ?? memory.confidence, 0.5);
    const next = clamp01(current * Math.exp(-lambda * delta), current);
    memory.learning ||= {};
    memory.learning.confidence = Number(next.toFixed(3));
    memory.confidence = memory.learning.confidence;
    memory.lastDecayAt = clock;
  });
  agent.causalMemory = memories
    .filter(memory => clamp01(memory.learning?.confidence ?? memory.confidence, 0) >= 0.05)
    .sort((a, b) => {
      const ac = clamp01(a.learning?.confidence ?? a.confidence, 0);
      const bc = clamp01(b.learning?.confidence ?? b.confidence, 0);
      return bc - ac || num(b.lastConfirmed, 0) - num(a.lastConfirmed, 0);
    })
    .slice(0, cfg.maxMemory);
  return agent.causalMemory;
}

function upsertCausalMemory(world = {}, agent = {}, chain = {}, event = {}) {
  const memories = ensureCausalMemory(agent);
  const clock = num(event.clock ?? world.clock, 0);
  const strengthResult = temporalCausalStrength(chain);
  const stateChange = Math.max(clamp01(chain.emotionChange, 0), needChange(event), chain.category === "work_social_recovery" ? 0.4 : 0);
  const repeatFactor = clamp01(num(chain.repeatCount, 0) / 5, 0);
  const causalImportance = clamp01(
    strengthResult.strength * 0.55
      + clamp01(chain.eventImpact, 0) * stateChange * repeatFactor * 0.65,
    0
  );
  const threshold = causalConfig(world).threshold;
  if (chain.eventImpact < 0.35 || stateChange < 0.22 || chain.repeatCount < 2 || causalImportance < threshold) {
    return { memory: null, skipped: true, causalImportance, strength: strengthResult };
  }

  const key = `${chain.category}:${chain.triggerKey}`;
  const existing = memories.find(item => item.causalKey === key);
  if (existing) {
    existing.repeatCount = Math.max(1, num(existing.repeatCount, 1)) + 1;
    existing.lastConfirmed = clock;
    existing.sourceEvents = Array.from(new Set([...(existing.sourceEvents || []), ...(chain.sourceEvents || [])])).slice(-20);
    existing.causalStrength = Number(Math.max(num(existing.causalStrength, 0), strengthResult.strength).toFixed(3));
    existing.causalImportance = Number(Math.max(num(existing.causalImportance, 0), causalImportance).toFixed(3));
    existing.learning ||= {};
    existing.learning.causalRule = chain.learning.causalRule;
    existing.learning.causalBelief = chain.learning.causalBelief;
    const reinforcement = 0.08
      + Math.sqrt(Math.max(0, strengthResult.strength)) * 0.18
      + Math.min(0.1, existing.repeatCount * 0.008);
    existing.learning.confidence = Number(clamp01(
      clamp01(existing.learning.confidence, 0.5) + reinforcement,
      0
    ).toFixed(3));
    existing.confidence = existing.learning.confidence;
    existing.effect = chain.effect;
    existing.cause = chain.cause;
    existing.trigger = chain.trigger;
    existing.lastDecayAt = clock;
    return { memory: existing, updated: true, causalImportance, strength: strengthResult };
  }

  const confidence = Number(clamp01(chain.learning.confidence, 0.55).toFixed(3));
  const memory = {
    id: `causal_${stableIdPart(agent.id)}_${clock}_${stableIdPart(chain.triggerKey)}`,
    timestamp: clock,
    causalKey: key,
    category: chain.category,
    trigger: chain.trigger,
    cause: chain.cause,
    effect: chain.effect,
    learning: {
      causalRule: compactText(chain.learning.causalRule, "", 180),
      causalBelief: compactText(chain.learning.causalBelief, "", 180),
      confidence
    },
    confidence,
    causalStrength: strengthResult.strength,
    causalImportance: Number(causalImportance.toFixed(3)),
    repeatCount: Math.max(1, num(chain.repeatCount, 1)),
    lastConfirmed: clock,
    lastDecayAt: clock,
    decayRate: causalConfig(world).decayLambda,
    sourceEvents: Array.from(new Set(chain.sourceEvents || [])).slice(-20),
    factAuthority: false,
    rule: "Causal memory is a soft learned tendency; it cannot directly choose actions or settle facts."
  };
  memories.unshift(memory);
  agent.causalMemory = memories.slice(0, causalConfig(world).maxMemory);
  return { memory, created: true, causalImportance, strength: strengthResult };
}

function updateTemporalCausalMemory(world = {}, agent = {}, context = {}) {
  if (!world || !agent?.id) return { causalBias: emptyCausalBias(), activeCausalMemory: [] };
  const cfg = causalConfig(world);
  ensureCausalMemory(agent);
  decayCausalMemory(world, agent);
  if (!cfg.enabled) return causalMemoryInfluence(world, agent, context);

  const extraEvent = context.event && typeof context.event === "object" ? context.event : null;
  const events = collectAgentEvents(world, agent, extraEvent);
  const processed = new Set(agent.temporalCausalState.processedEventIds || []);
  const updates = [];
  events.forEach((event, index) => {
    const id = String(event.id || `${event.clock}:${event.summary || event.type || ""}`);
    if (processed.has(id) && !context.force) return;
    const chain = chainFromEvent(world, agent, events, index, context);
    if (chain) {
      const result = upsertCausalMemory(world, agent, chain, event);
      if (!result.skipped) {
        event.temporalCausal = {
          memoryId: result.memory?.id || "",
          category: chain.category,
          causalImportance: Number(num(result.causalImportance, 0).toFixed(3)),
          causalStrength: result.strength?.strength ?? 0
        };
      }
      updates.push({ eventId: id, category: chain.category, ...result });
    }
    processed.add(id);
  });
  agent.temporalCausalState.processedEventIds = Array.from(processed).slice(-240);
  agent.temporalCausalState.lastUpdatedAt = num(world.clock, 0);
  const influence = causalMemoryInfluence(world, agent, context, { skipDecay: true });
  return {
    ...influence,
    updates: updates.map(item => ({
      eventId: item.eventId,
      category: item.category,
      created: Boolean(item.created),
      updated: Boolean(item.updated),
      skipped: Boolean(item.skipped),
      causalImportance: Number(num(item.causalImportance, 0).toFixed(3)),
      strength: item.strength?.strength ?? 0
    })),
    source: "temporal-causal-v3.3.7"
  };
}

function emptyCausalBias() {
  return {
    safetyBias: 0,
    socialBias: 0,
    responsibilityBias: 0,
    confidence: 0
  };
}

function relevance(text = "", refs = []) {
  const value = String(text || "").toLowerCase();
  const tokens = String(refs.join(" ") || "")
    .toLowerCase()
    .match(/[a-z0-9_]+|[\u4e00-\u9fa5]{1,2}/g) || [];
  const unique = [...new Set(tokens.filter(token => token.length > 1))].slice(0, 40);
  if (!unique.length) return 0;
  const hits = unique.filter(token => value.includes(token)).length;
  return clamp01(hits / Math.max(3, unique.length), 0);
}

function causalMemoryInfluence(world = {}, agent = {}, context = {}, options = {}) {
  ensureCausalMemory(agent);
  if (!options.skipDecay) decayCausalMemory(world, agent);
  const clock = num(world.clock, 0);
  const refs = [
    context.eventText || "",
    context.summary || "",
    context.plan?.title || "",
    context.plan?.localAction || "",
    context.interruption?.type || "",
    textOf(agent.cognitiveState?.driveVector || {}),
    textOf(agent.needs || {}),
    textOf(agent.emotionVector || agent.emotions || {})
  ];
  const active = (agent.causalMemory || [])
    .map(memory => {
      const confidence = clamp01(memory.learning?.confidence ?? memory.confidence, 0);
      const ageDays = Math.max(0, (clock - num(memory.lastConfirmed ?? memory.timestamp, clock)) / 1440);
      const recency = Math.exp(-ageDays / 90);
      const text = `${memory.category || ""} ${memory.trigger?.event || ""} ${memory.trigger?.context || ""} ${memory.cause?.stateChange || ""} ${memory.effect?.behaviorChange || ""} ${memory.learning?.causalRule || ""} ${memory.learning?.causalBelief || ""}`;
      const rel = relevance(text, refs);
      const activation = clamp01(confidence * 0.58 + recency * 0.16 + rel * 0.26, 0);
      return {
        id: memory.id || "",
        category: memory.category || "general",
        causalRule: memory.learning?.causalRule || "",
        causalBelief: memory.learning?.causalBelief || "",
        confidence: Number(confidence.toFixed(3)),
        activation: Number(activation.toFixed(3)),
        repeatCount: num(memory.repeatCount, 1),
        sourceEvents: (memory.sourceEvents || []).slice(-6),
        factAuthority: false
      };
    })
    .filter(item => item.activation >= 0.18 || item.confidence >= 0.62)
    .sort((a, b) => b.activation - a.activation)
    .slice(0, 6);

  const bias = emptyCausalBias();
  active.forEach(item => {
    const weight = clamp01(item.activation * item.confidence, 0);
    if (item.category === "work_social_recovery") {
      bias.socialBias += weight * 0.72;
      bias.responsibilityBias += weight * 0.18;
    } else if (item.category === "health_care_response") {
      bias.safetyBias += weight * 0.42;
      bias.responsibilityBias += weight * 0.14;
    } else if (item.category === "safety_response") {
      bias.safetyBias += weight * 0.72;
    } else if (item.category === "relationship_support") {
      bias.socialBias += weight * 0.58;
    } else {
      bias.responsibilityBias += weight * 0.22;
    }
    bias.confidence = Math.max(bias.confidence, item.confidence);
  });
  Object.keys(bias).forEach(key => {
    bias[key] = Number(clamp01(bias[key], 0).toFixed(3));
  });
  return {
    agentId: agent.id || "",
    causalBias: bias,
    activeCausalMemory: active,
    source: "temporal-causal-v3.3.7",
    rule: "Causal bias is a soft tendency from repeated experience. It is not an action selector."
  };
}

function causalWeight(world = {}) {
  return causalConfig(world).causalWeight;
}

function causalBiasForAction(world = {}, agent = {}, action = {}, cognitive = {}) {
  const influence = cognitive.causalBias
    ? { causalBias: cognitive.causalBias, activeCausalMemory: cognitive.activeCausalMemory || [] }
    : causalMemoryInfluence(world, agent, {});
  const bias = influence.causalBias || emptyCausalBias();
  const memories = influence.activeCausalMemory || [];
  const id = String(action.id || action.type || "");
  let score = 0;
  const details = [];
  const add = (value, reason) => {
    const delta = num(value, 0);
    if (!delta) return;
    score += delta;
    details.push({ reason, bias: Number(delta.toFixed(2)) });
  };

  if (["contact_familiar", "ask_guardian"].includes(id)) add(bias.socialBias * 12, "causal social recovery");
  if (id === "rest") add(bias.socialBias * 2.5, "causal recovery cue");
  if (["follow_plan", "continue_process"].includes(id)) {
    add(bias.responsibilityBias * 8, "causal responsibility pattern");
    if (memories.some(item => item.category === "work_social_recovery")) add(-bias.socialBias * 3.5, "causal overwork caution");
  }
  if (["seek_safety", "return_home"].includes(id)) add(bias.safetyBias * 10, "causal safety pattern");
  if (["observe_environment", "think_and_plan"].includes(id)) add(bias.safetyBias * 4 + bias.responsibilityBias * 2, "causal checking pattern");
  if (id === "seek_care") add(bias.safetyBias * 5, "causal health/safety pattern");
  if (["walk_nearby", "follow_stranger"].includes(id)) add(-bias.safetyBias * (id === "follow_stranger" ? 12 : 5), "causal risk caution");

  const cappedScore = clamp(score, -12, 12, 0);
  return {
    score: Number(cappedScore.toFixed(2)),
    value: Number(clamp01(0.5 + cappedScore / 30, 0.5).toFixed(3)),
    weight: causalWeight(world),
    details: details.sort((a, b) => Math.abs(b.bias) - Math.abs(a.bias)).slice(0, 4),
    causalBias: bias,
    activeCausalMemory: memories.slice(0, 3),
    rule: "Causal action bias is capped and remains subordinate to personality, memory, emotion, goals and context."
  };
}

module.exports = {
  ensureCausalMemory,
  temporalCausalStrength,
  updateTemporalCausalMemory,
  causalMemoryInfluence,
  causalBiasForAction,
  causalWeight
};

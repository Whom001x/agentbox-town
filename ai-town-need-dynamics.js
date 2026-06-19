"use strict";

const { requestNeedUpdate } = require("./ai-town-cognitive-integrity");

const NEED_KEYS = ["hunger", "hygiene", "health", "social", "responsibility", "stress", "comfort", "safety"];

const DEFAULT_NEEDS = {
  hunger: 72,
  hygiene: 78,
  health: 82,
  social: 68,
  responsibility: 62,
  stress: 72,
  comfort: 76,
  safety: 82
};

const BASE_THRESHOLDS = {
  hunger: 30,
  hygiene: 25,
  health: 30,
  social: 25,
  responsibility: 25,
  stress: 30,
  comfort: 25,
  safety: 30
};

const LIFE_STAGE = {
  child: {
    recovery: 1.16,
    activity: 1.1,
    thresholds: { safety: 40 }
  },
  teen: {
    recovery: 1.05,
    activity: 1,
    thresholds: {}
  },
  adult: {
    recovery: 1,
    activity: 1,
    thresholds: {}
  },
  elder: {
    recovery: 0.72,
    activity: 0.8,
    thresholds: { health: 40, safety: 45 }
  }
};

const ACTIVITY_EFFICIENCY = {
  eat: { hunger: 0.34, comfort: 0.05, stress: 0.04 },
  meal: { hunger: 0.3, comfort: 0.05, stress: 0.03 },
  emergency_food: { hunger: 0.46, health: 0.04, stress: 0.05, comfort: 0.03 },
  clean: { hygiene: 0.45, comfort: 0.1, social: 0.02 },
  home_recover: { hygiene: 0.18, comfort: 0.16, stress: 0.1, safety: 0.08 },
  rest: { comfort: 0.18, stress: 0.14, health: 0.04 },
  sleep: { stress: 0.08, comfort: 0.06, health: 0.03 },
  health_rest: { health: 0.08, safety: 0.05, comfort: 0.05, stress: 0.04 },
  clinic_care: { health: 0.32, safety: 0.12, stress: 0.1, comfort: 0.06 },
  safety: { safety: 0.28, comfort: 0.06, stress: 0.06 },
  social: { social: 0.35, stress: 0.08 },
  work: { responsibility: 0.35 },
  study: { responsibility: 0.32 },
  wait: { stress: 0.05, comfort: 0.04 },
  observe: { safety: 0.05, stress: 0.02 }
};

const ACTIVITY_COSTS = {
  sleep: { hunger: -1 },
  work: { stress: -3, hunger: -0.5 },
  study: { stress: -2, hunger: -0.5 },
  wait_blocked: { comfort: -1, stress: -1 }
};

const HOMEOSTASIS_EXPONENT = {
  hunger: null,
  hygiene: 1.4,
  health: 2,
  social: 1.2,
  responsibility: 1.1,
  stress: 1,
  comfort: 1.5,
  safety: 1.3
};

function clamp(value, min, max, fallback = min) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

function currentNeeds(agent = {}) {
  const needs = agent.needs && typeof agent.needs === "object" ? agent.needs : {};
  const normalized = {};
  NEED_KEYS.forEach(key => {
    normalized[key] = clamp(needs[key], 0, 100, DEFAULT_NEEDS[key]);
  });
  return normalized;
}

function agentAgeStage(agent = {}) {
  const explicit = String(agent.ageStage || "").toLowerCase();
  if (["child", "teen", "adult", "elder"].includes(explicit)) return explicit;
  const text = `${agent.job || ""} ${agent.profession || ""} ${agent.role || ""}`.toLowerCase();
  if (/child|kid|pupil|elementary/.test(text) || /儿童|孩子|小学生|幼儿/.test(text)) return "child";
  if (/teen|student|middle|high school/.test(text) || /青少年|中学生|高中生|初中生|学生/.test(text)) return "teen";
  if (/elder|old|retired/.test(text) || /老人|老年|退休|独居老人/.test(text)) return "elder";
  const age = Number(agent.ageYears ?? agent.age ?? 35);
  if (age < 13) return "child";
  if (age < 20) return "teen";
  if (age >= 65) return "elder";
  return "adult";
}

function lifeStageProfile(agent = {}) {
  return LIFE_STAGE[agentAgeStage(agent)] || LIFE_STAGE.adult;
}

function thresholdFor(agent = {}, key = "") {
  const profile = lifeStageProfile(agent);
  return profile.thresholds?.[key] ?? BASE_THRESHOLDS[key] ?? 30;
}

function needSafeguard(value, threshold) {
  const safeThreshold = Math.max(1, Number(threshold) || 1);
  const current = clamp(value, 0, 100, 100);
  if (current >= safeThreshold) return 1;
  const ratio = clamp(current / safeThreshold, 0, 1, 0);
  return clamp(1 - ((1 - ratio) ** 2), 0.05, 1, 1);
}

function needHomeostasisFactor(value, key = "health") {
  const exponent = HOMEOSTASIS_EXPONENT[key];
  if (exponent == null) return 1;
  const current = clamp(value, 0, 100, 100) / 100;
  return clamp(1 - (current ** exponent), 0, 1, 0);
}

function environmentQualityForComfort(ctx = {}) {
  if (ctx.badWeather || ctx.danger) return { label: "bad", factor: 0.5 };
  if (ctx.isHome || ["clinic", "restaurant", "breakfast", "park"].includes(ctx.place)) return { label: "good", factor: 1.2 };
  return { label: "normal", factor: 1 };
}

function recoveryEnvironmentModifier(key = "", ctx = {}) {
  if (key === "comfort") return environmentQualityForComfort(ctx).factor;
  return 1;
}

function maintenanceCostFor(key = "", value = 0) {
  if (key === "health" && Number(value) > 80) return (Number(value) - 80) * 0.005;
  return 0;
}

function valueFromProfile(source = {}, key = "", fallback = null) {
  const value = Number(source?.[key]);
  return Number.isFinite(value) ? clamp(value, 0, 1, value) : fallback;
}

function ensureNeedElasticity(agent = {}) {
  const existing = agent.needElasticity && typeof agent.needElasticity === "object" ? agent.needElasticity : {};
  const profile = agent.cognitiveProfile || {};
  const socialDrive = valueFromProfile(profile, "socialDrive", 0.5);
  const routine = valueFromProfile(profile, "routinePreference", 0.5);
  const conflictAvoidance = valueFromProfile(profile, "conflictAvoidance", 0.5);
  const riskTolerance = valueFromProfile(profile, "riskTolerance", 0.5);
  const patience = valueFromProfile(profile, "patience", 0.5);
  const fallback = {
    hunger: 1,
    hygiene: 1,
    health: 1,
    social: 0.85 + socialDrive * 0.5,
    responsibility: 0.9 + valueFromProfile(profile, "ambition", 0.5) * 0.25,
    stress: 1.15 - patience * 0.35 - routine * 0.15,
    comfort: 0.9 + routine * 0.25,
    safety: 0.9 + conflictAvoidance * 0.35 - riskTolerance * 0.2
  };
  if (/独居老人|retired elder|elder/i.test(`${agent.job || ""} ${agent.ageStage || ""}`)) {
    fallback.social += 0.12;
    fallback.safety += 0.1;
  }
  const normalized = {};
  NEED_KEYS.forEach(key => {
    normalized[key] = round(clamp(existing[key] ?? fallback[key] ?? 1, 0.5, 1.5, 1), 3);
  });
  agent.needElasticity = normalized;
  return normalized;
}

function placeId(agent = {}) {
  return agent.position || agent.place || "";
}

function clockHour(world = {}) {
  const minute = Number(world.clock || 0) % 1440;
  return Math.floor(minute / 60);
}

function isMealWindow(world = {}) {
  const hour = clockHour(world);
  return hour === 7 || hour === 12 || hour === 18 || (hour >= 11 && hour <= 13) || (hour >= 17 && hour <= 19);
}

function isFoodPlace(place = "") {
  return ["apartment", "home", "residence", "breakfast", "restaurant", "store", "market"].includes(String(place || ""));
}

function hasActiveTask(world = {}, agent = {}) {
  if (agent.activeProcess) return true;
  const pressure = [
    ...(Array.isArray(agent.activeObligations) ? agent.activeObligations : []),
    ...(Array.isArray(agent.obligations) ? agent.obligations : [])
  ].some(item => Number(item.pressure || item.priority || 0) >= 45);
  if (pressure) return true;
  const current = agent.currentPlanItem || null;
  if (current?.fixed || Number(current?.priority || 0) >= 70) return true;
  const minute = Number(world.clock || 0) % 1440;
  return Array.isArray(agent.dailyPlan) && agent.dailyPlan.some(item => {
    const start = Number(item.startMinute ?? item.start ?? item.from ?? NaN);
    const end = Number(item.endMinute ?? item.end ?? item.to ?? NaN);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
    return minute >= start && minute < end && (item.fixed || Number(item.priority || 0) >= 70);
  });
}

function samePlaceOtherCount(world = {}, agent = {}) {
  const here = placeId(agent);
  if (!here) return 0;
  return (world.agents || []).filter(item => item?.id && item.id !== agent.id && item.lifeStatus !== "dead" && placeId(item) === here).length;
}

function placeEffects(world = {}, agent = {}) {
  const here = placeId(agent);
  const place = (world.places || []).find(item => item?.id === here) || {};
  return [
    ...(Array.isArray(place.effects) ? place.effects : []),
    ...(Array.isArray(world.locationBoxes?.[here]?.effects) ? world.locationBoxes[here].effects : [])
  ];
}

function weatherBad(world = {}) {
  const condition = `${world.weatherBox?.current?.condition || world.weather?.condition || ""}`;
  const temperature = Number(world.weatherBox?.current?.temperature ?? world.weather?.temperature ?? 24);
  return /storm|thunder|snow|heat|cold|rainstorm|雷|暴|雪|酷热|严寒/.test(condition) || temperature >= 33 || temperature <= 3;
}

function dangerousPlace(world = {}, agent = {}) {
  return placeEffects(world, agent).some(effect => {
    const text = `${effect.type || ""} ${effect.text || ""}`;
    return /river_risk|unsafe_quiet|low_visibility|safety_low|danger|risk|危险|不安全/.test(text);
  });
}

function needContext(world = {}, agent = {}, options = {}) {
  const here = placeId(agent);
  const hour = clockHour(world);
  const isHome = /apartment|home|residence|house/.test(here);
  const isClinic = /clinic|hospital|medical/.test(here);
  const danger = Boolean(options.danger ?? dangerousPlace(world, agent));
  return {
    minutes: clamp(options.minutes ?? options.minutesPassed ?? world.config?.virtualMinutesPerPulse ?? 30, 1, 240, 30),
    hour,
    place: here,
    isHome,
    isClinic,
    isSleeping: Boolean(options.isSleeping ?? agent.isSleeping),
    energy: clamp(agent.energy ?? 70, 0, 100, 70),
    sleepQuality: clamp(agent.sleepQuality ?? 75, 0, 100, 75),
    hasTask: Boolean(options.hasTask ?? hasActiveTask(world, agent)),
    badWeather: Boolean(options.badWeather ?? weatherBad(world)),
    danger,
    mealWindow: Boolean(options.mealWindow ?? isMealWindow(world)),
    foodAvailable: Boolean(options.foodAvailable ?? isFoodPlace(here)),
    samePlaceOthers: Number(options.samePlaceOthers ?? samePlaceOtherCount(world, agent)),
    clinicStaffAvailable: Boolean(options.clinicStaffAvailable ?? Number(world.clinicRuntime?.staffAvailable || 0) > 0)
  };
}

function baseDynamicsFor(key, needs = {}, ctx = {}) {
  const sleeping = Boolean(ctx.isSleeping);
  switch (key) {
    case "hunger":
      return { decay: sleeping ? 0.5 : 2.0, regen: 0 };
    case "hygiene":
      return sleeping ? { decay: 0.2, regen: 1.0 } : { decay: 1.2, regen: ctx.isHome ? 0.35 : 0.2 };
    case "health": {
      if (ctx.energy < 20) return { decay: 0.8, regen: sleeping ? 0.05 : 0 };
      if (ctx.energy < 50) return { decay: 0.3, regen: sleeping ? 0.1 : 0.05 };
      return { decay: 0, regen: sleeping ? 0.16 : 0.12 };
    }
    case "social":
      if (ctx.isHome) {
        if (ctx.samePlaceOthers > 3) return { decay: 0.55, regen: 0.75 };
        if (ctx.samePlaceOthers > 0) return { decay: 0.75, regen: 0.45 };
        return { decay: 1.2, regen: 0.1 };
      }
      return { decay: 0.3, regen: ctx.samePlaceOthers > 0 ? 0.4 : 0.15 };
    case "responsibility":
      return ctx.hasTask ? { decay: 2.5, regen: 0 } : { decay: 0.3, regen: 0.5 };
    case "stress":
      return ctx.hasTask ? { decay: 1.5, regen: 0.2 } : { decay: 0.25, regen: sleeping ? 1.0 : 0.9 };
    case "comfort":
      return ctx.badWeather ? { decay: 1.5, regen: sleeping ? 0.35 : 0 } : { decay: sleeping ? 0.05 : 0.4, regen: (ctx.isHome ? 0.35 : 0.2) + (sleeping ? 0.75 : 0) };
    case "safety":
      return ctx.danger ? { decay: 2, regen: 0 } : { decay: ctx.isHome ? 0.25 : 0.2, regen: ctx.isHome ? 1.0 : 0.8 };
    default:
      return { decay: 0, regen: 0 };
  }
}

function adjustedBaseDynamics(key, needs = {}, ctx = {}) {
  const base = baseDynamicsFor(key, needs, ctx);
  let decay = base.decay;
  let regen = base.regen;
  if (key === "health" && ctx.isClinic) regen += ctx.clinicStaffAvailable ? 1.5 : 0.4;
  if (key === "responsibility" && ["school", "office", "factory", "clinic", "store", "market", "police"].includes(ctx.place) && ctx.hasTask) {
    regen += 0.8;
  }
  if (key === "stress" && ["clinic", "breakfast", "restaurant"].includes(ctx.place) && !ctx.hasTask) {
    regen += 0.35;
  }
  const survivalMode = Number(needs.hunger ?? 100) < 20;
  const healthCrisisMode = Number(needs.health ?? 100) < 20;
  if (survivalMode && !["hunger", "health", "safety"].includes(key)) decay *= 0.8;
  if (healthCrisisMode) decay *= 0.9;
  if (healthCrisisMode && key === "social") decay += 0.2;
  return { decay, regen, survivalMode, healthCrisisMode };
}

function activityDelta(agent = {}, kind = "", options = {}) {
  const needs = currentNeeds(agent);
  const profile = lifeStageProfile(agent);
  const activityFactor = clamp(options.activityFactor ?? profile.activity, 0.4, 1.4, 1);
  const efficiencies = {
    ...(ACTIVITY_EFFICIENCY[kind] || {}),
    ...(options.efficiency || {})
  };
  const costs = {
    ...(ACTIVITY_COSTS[kind] || {}),
    ...(options.costs || {})
  };
  const minimum = options.minimum || {};
  const maximum = options.maximum || {};
  const result = {};
  Object.entries(efficiencies).forEach(([key, efficiency]) => {
    if (!NEED_KEYS.includes(key)) return;
    const before = Number(needs[key] ?? DEFAULT_NEEDS[key]);
    const missing = Math.max(0, 100 - before);
    const gain = missing * Number(efficiency || 0) * activityFactor;
    result[key] = (result[key] || 0) + gain;
  });
  Object.entries(costs).forEach(([key, value]) => {
    if (!NEED_KEYS.includes(key)) return;
    result[key] = (result[key] || 0) + Number(value || 0);
  });
  Object.entries(minimum).forEach(([key, value]) => {
    if (!NEED_KEYS.includes(key)) return;
    if (Number(result[key] || 0) > 0) result[key] = Math.max(Number(result[key] || 0), Number(value || 0));
  });
  Object.entries(maximum).forEach(([key, value]) => {
    if (!NEED_KEYS.includes(key)) return;
    if (Number(result[key] || 0) > 0) result[key] = Math.min(Number(result[key] || 0), Number(value || 0));
  });
  NEED_KEYS.forEach(key => {
    if (result[key] != null) result[key] = round(result[key], 2);
  });
  return result;
}

function applyNeedDelta(agent = {}, delta = {}, options = {}) {
  const world = options.world || { clock: Number(options.clock || 0), agents: agent?.id ? [agent] : [] };
  const write = requestNeedUpdate(
    world,
    agent,
    delta,
    options.source || "need-dynamics",
    options.reason || "need dynamics update",
    options.confidence ?? 0.9
  );
  return write.ok ? write.applied : currentNeeds(agent);
}

function applyNeedActivity(agent = {}, kind = "", options = {}) {
  const delta = activityDelta(agent, kind, options);
  applyNeedDelta(agent, delta, {
    world: options.world,
    clock: options.clock,
    source: options.source || "need-activity",
    reason: `need activity ${kind}`,
    confidence: options.confidence ?? 0.9
  });
  return delta;
}

function computeNeedDynamics(world = {}, agent = {}, options = {}) {
  const needs = { ...currentNeeds(agent) };
  const ctx = needContext(world, agent, options);
  const hours = Math.max(1 / 60, ctx.minutes / 60);
  const profile = lifeStageProfile(agent);
  const elasticity = ensureNeedElasticity(agent);
  const values = {};
  const delta = {};
  const components = {};
  const homeostasis = {};
  const activityEffects = options.activityEffects || {};
  NEED_KEYS.forEach(key => {
    const base = adjustedBaseDynamics(key, needs, ctx);
    const threshold = thresholdFor(agent, key);
    const safeguard = needSafeguard(needs[key], threshold);
    const homeostasisFactor = needHomeostasisFactor(needs[key], key);
    const environmentModifier = recoveryEnvironmentModifier(key, ctx);
    const recoveryModifier = profile.recovery;
    const upperStabilityDecay = needs[key] > 90 ? (needs[key] - 90) * 0.04 : 0;
    const maintenanceCost = maintenanceCostFor(key, needs[key]);
    const activity = Number(activityEffects[key] || 0);
    const effectiveRecovery = base.regen * recoveryModifier * homeostasisFactor * environmentModifier;
    const effectiveDecay = (base.decay + upperStabilityDecay + maintenanceCost) * safeguard * elasticity[key];
    const natural = (effectiveRecovery - effectiveDecay) * hours;
    const total = natural + activity;
    const after = clamp(needs[key] + total, 0, 100, needs[key]);
    values[key] = { before: round(needs[key], 2), after: round(after, 2), delta: round(after - needs[key], 2) };
    delta[key] = values[key].delta;
    homeostasis[key] = {
      currentValue: round(needs[key], 2),
      exponent: HOMEOSTASIS_EXPONENT[key],
      homeostasisFactor: round(homeostasisFactor, 3),
      effectiveRecovery: round(effectiveRecovery, 3),
      maintenanceCost: round(maintenanceCost, 3),
      environmentQuality: key === "comfort" ? environmentQualityForComfort(ctx).label : "normal"
    };
    components[key] = {
      baseDecay: round(base.decay, 3),
      baseRegen: round(base.regen, 3),
      recoveryModifier: round(recoveryModifier, 3),
      homeostasisFactor: round(homeostasisFactor, 3),
      effectiveRecovery: round(effectiveRecovery, 3),
      environmentModifier: round(environmentModifier, 3),
      maintenanceCost: round(maintenanceCost, 3),
      effectiveDecay: round(effectiveDecay, 3),
      upperStabilityDecay: round(upperStabilityDecay, 3),
      safeguard: round(safeguard, 3),
      elasticity: round(elasticity[key], 3),
      natural: round(natural, 3),
      activity: round(activity, 3),
      threshold
    };
  });
  const emergencyFlag = {
    health: needs.health < 20,
    hunger: needs.hunger < 10,
    safety: needs.safety < 20
  };
  return {
    version: "3.3.5.1-need-dynamics",
    agentId: agent.id || "",
    timestamp: Number(world.clock || 0),
    minutes: ctx.minutes,
    context: {
      place: ctx.place,
      isSleeping: ctx.isSleeping,
      hasTask: ctx.hasTask,
      badWeather: ctx.badWeather,
      danger: ctx.danger,
      mealWindow: ctx.mealWindow,
      foodAvailable: ctx.foodAvailable,
      samePlaceOthers: ctx.samePlaceOthers,
      lifeStage: agentAgeStage(agent)
    },
    modes: {
      survivalMode: needs.hunger < 20,
      healthCrisisMode: needs.health < 20
    },
    needElasticity: elasticity,
    values,
    delta,
    components,
    homeostasis,
    needEmergencyFlag: emergencyFlag,
    hasEmergency: Object.values(emergencyFlag).some(Boolean)
  };
}

function applyNeedDynamics(world = {}, agent = {}, options = {}) {
  const state = computeNeedDynamics(world, agent, options);
  applyNeedDelta(agent, state.delta, {
    world,
    source: "need-dynamics",
    reason: "base need dynamics settlement",
    confidence: 0.92
  });
  agent.needDynamicsState = state;
  agent.needHomeostasisState = state.homeostasis;
  agent.needEmergencyFlag = state.needEmergencyFlag;
  return state;
}

function applyNeedDynamicsForWorld(world = {}, minutes = null, options = {}) {
  const states = [];
  const tickMinutes = minutes ?? world.config?.virtualMinutesPerPulse ?? 30;
  for (const agent of world.agents || []) {
    if (!agent?.id || agent.lifeStatus === "dead" || agent.terminalState?.dead) continue;
    states.push(applyNeedDynamics(world, agent, { ...options, minutes: tickMinutes }));
  }
  world.needDynamicsState = {
    version: "3.3.5.1-need-dynamics",
    updatedAt: Number(world.clock || 0),
    minutes: tickMinutes,
      agents: states.length,
      averages: averageNeeds(world.agents || []),
      emergencyCount: states.filter(item => item.hasEmergency).length
  };
  world.needHomeostasisState = {
    version: "3.3.5.1-need-homeostasis",
    updatedAt: Number(world.clock || 0),
    minutes: tickMinutes,
    agents: states.length,
    needs: NEED_KEYS,
    averages: averageNeeds(world.agents || []),
    emergencyCount: states.filter(item => item.hasEmergency).length,
    agentStates: states.map(state => ({
      agentId: state.agentId,
      timestamp: state.timestamp,
      values: Object.fromEntries(NEED_KEYS.map(key => [key, state.values?.[key]?.after ?? 0])),
      homeostasis: state.homeostasis
    }))
  };
  return world.needDynamicsState;
}

function averageNeeds(agents = []) {
  const alive = agents.filter(agent => agent?.id && agent.lifeStatus !== "dead");
  const totals = Object.fromEntries(NEED_KEYS.map(key => [key, 0]));
  alive.forEach(agent => {
    const needs = currentNeeds(agent);
    NEED_KEYS.forEach(key => { totals[key] += Number(needs[key] || 0); });
  });
  const count = Math.max(1, alive.length);
  return Object.fromEntries(NEED_KEYS.map(key => [key, round(totals[key] / count, 2)]));
}

module.exports = {
  NEED_KEYS,
  DEFAULT_NEEDS,
  computeNeedDynamics,
  applyNeedDynamics,
  applyNeedDynamicsForWorld,
  activityDelta,
  applyNeedActivity,
  applyNeedDelta,
  ensureNeedElasticity,
  needSafeguard,
  needHomeostasisFactor,
  lifeStageProfile,
  agentAgeStage,
  averageNeeds
};

"use strict";

const START_DATE = new Date(2026, 5, 9);
const solarTerms = ["小寒", "大寒", "立春", "雨水", "惊蛰", "春分", "清明", "谷雨", "立夏", "小满", "芒种", "夏至", "小暑", "大暑", "立秋", "处暑", "白露", "秋分", "寒露", "霜降", "立冬", "小雪", "大雪", "冬至"];
const needKeys = ["hunger", "hygiene", "health", "social", "responsibility", "stress", "comfort", "safety"];
const emotionDefaults = { happy: 45, anxious: 25, angry: 10, sad: 15, tired: 25, lonely: 20, hopeful: 45, calm: 45, curious: 30 };

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function minutesToClock(total) {
  const safeTotal = Math.max(0, Number(total) || 0);
  const day = Math.floor(safeTotal / 1440) + 1;
  const minuteOfDay = safeTotal % 1440;
  const h = Math.floor(minuteOfDay / 60);
  const m = minuteOfDay % 60;
  const dayName = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][(day - 1) % 7];
  return { day, h, m, text: `${dayName} ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` };
}

function calendarForClock(total) {
  const time = minutesToClock(total);
  const date = new Date(START_DATE);
  date.setDate(START_DATE.getDate() + time.day - 1);
  const weekday = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()];
  const month = date.getMonth() + 1;
  const season = month <= 2 || month === 12 ? "冬季" : month <= 5 ? "春季" : month <= 8 ? "夏季" : "秋季";
  const termIndex = Math.min(23, Math.max(0, Math.floor(((month - 1) * 2) + (date.getDate() >= 15 ? 1 : 0))));
  let lunar = "农历估算";
  try {
    lunar = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", { month: "long", day: "numeric" }).format(date);
  } catch {}
  return {
    day: time.day,
    h: time.h,
    m: time.m,
    iso: `${date.getFullYear()}-${String(month).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
    weekday,
    lunar,
    season,
    solarTerm: solarTerms[termIndex],
    text: `${date.getFullYear()}-${String(month).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${weekday}`
  };
}

function hhmmToMinutes(text) {
  const [h, m] = String(text || "").split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
  return h * 60 + m;
}

function isWithinSleepWindow(clockMinute, window = {}) {
  const minuteOfDay = clockMinute % 1440;
  const start = hhmmToMinutes(window.start || "23:00");
  const end = hhmmToMinutes(window.end || "06:30");
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  if (start > end) return minuteOfDay >= start || minuteOfDay < end;
  return minuteOfDay >= start && minuteOfDay < end;
}

function isDead(agent) {
  return agent?.lifeStatus === "dead";
}

function pushRecord(world, title, body, type = "node_runtime", agents = []) {
  world.records ||= [];
  const time = minutesToClock(world.clock || 0).text;
  world.records.unshift({ title, body, type, agents, time, clock: world.clock || 0, source: "node-core-v1" });
  world.records = world.records.slice(0, 300);
}

function pushLog(world, title, body, type = "node_runtime") {
  world.logs ||= [];
  const time = minutesToClock(world.clock || 0).text;
  world.logs.unshift({ title, body, type, time, clock: world.clock || 0, source: "node-core-v1" });
  world.logs = world.logs.slice(0, 200);
}

function ensureAgentShape(agent) {
  agent.needs ||= { hunger: 72, hygiene: 78, health: 82, social: 68, responsibility: 62, stress: 72, comfort: 76, safety: 82 };
  needKeys.forEach(key => { if (!Number.isFinite(Number(agent.needs[key]))) agent.needs[key] = 70; });
  agent.emotionVector ||= agent.emotions || { ...emotionDefaults };
  Object.keys(emotionDefaults).forEach(key => { if (!Number.isFinite(Number(agent.emotionVector[key]))) agent.emotionVector[key] = emotionDefaults[key]; });
  agent.emotions = agent.emotionVector;
  agent.previousNeeds ||= { ...agent.needs };
  agent.previousEmotionVector ||= { ...agent.emotionVector };
  agent.lifeStatus ||= "alive";
  agent.currentTask ||= "维持当前生活安排";
  agent.energy = clamp(agent.energy ?? 70, 0, 100);
  agent.sleepQuality = clamp(agent.sleepQuality ?? 75, 0, 100);
  agent.sleepWindow ||= { start: "23:00", end: "06:30", canWakeFor: ["emergency"] };
  agent.memory ||= { short: [], long: [], emotional: [], secret: [], rumor: [] };
  return agent;
}

function adjustNeeds(agent, changes) {
  ensureAgentShape(agent);
  Object.entries(changes || {}).forEach(([key, delta]) => {
    if (!needKeys.includes(key)) return;
    agent.needs[key] = clamp(Number(agent.needs[key] ?? 70) + Number(delta || 0), 0, 100);
  });
}

function adjustEmotion(agent, changes) {
  ensureAgentShape(agent);
  Object.entries(changes || {}).forEach(([key, delta]) => {
    if (!Object.prototype.hasOwnProperty.call(emotionDefaults, key)) return;
    agent.emotionVector[key] = clamp(Number(agent.emotionVector[key] ?? emotionDefaults[key]) + Number(delta || 0), 0, 100);
  });
  agent.emotions = agent.emotionVector;
}

function decayMultiplier(currentValue, strength = 1.5) {
  const value = clamp(currentValue, 0, 100);
  const missing = (100 - value) / 100;
  return 1 + missing * strength;
}

function needPressure(value, threshold) {
  const safeValue = clamp(value, 0, 100);
  const safeThreshold = Math.max(1, Number(threshold) || 1);
  if (safeValue >= safeThreshold) return 0;
  return (safeThreshold - safeValue) / safeThreshold;
}

function sleepProfile(job = "") {
  if (job.includes("早餐店")) return { start: "21:30", end: "04:30", canWakeFor: ["emergency", "family"] };
  if (job.includes("小学生") || job.includes("幼儿")) return { start: "21:30", end: "06:40", canWakeFor: ["emergency", "family"] };
  if (job.includes("高中生") || job.includes("初中生") || job.includes("学生")) return { start: "23:00", end: "06:30", canWakeFor: ["emergency", "family"] };
  if (job.includes("医生")) return { start: "23:30", end: "07:00", canWakeFor: ["emergency", "clinic"] };
  if (job.includes("护士")) return { start: "22:30", end: "06:00", canWakeFor: ["emergency", "clinic", "family"] };
  if (job.includes("老人") || job.includes("退休")) return { start: "21:30", end: "06:00", canWakeFor: ["emergency", "family"] };
  return { start: "23:00", end: "06:30", canWakeFor: ["emergency"] };
}

function updateSleepStates(world, minutesPassed) {
  const minute = world.clock % 1440;
  (world.agents || []).forEach(agent => {
    if (isDead(agent)) return;
    ensureAgentShape(agent);
    if (!agent.sleepWindow) agent.sleepWindow = sleepProfile(agent.job || "");
    const shouldSleep = isWithinSleepWindow(minute, agent.sleepWindow);
    const tooHungryToSleep = shouldSleep && Number(agent.needs?.hunger ?? 100) <= 12;
    agent.isSleeping = shouldSleep && !tooHungryToSleep;
    if (agent.isSleeping) {
      agent.energy = clamp(agent.energy + minutesPassed * 0.18, 0, 100);
      agent.sleepQuality = clamp(agent.sleepQuality + minutesPassed * 0.08, 0, 100);
      const restQuality = clamp(Number(agent.sleepQuality || 75) / 100, 0.35, 1);
      const restRecovery = Number(agent.needs?.health ?? 100) < 70
        ? (minutesPassed / 60) * 0.5 * restQuality * ageRecoveryFactor(agent)
        : 0;
      adjustNeeds(agent, { stress: minutesPassed * 0.035, comfort: minutesPassed * 0.025, hunger: -minutesPassed * 0.006, health: restRecovery });
      adjustEmotion(agent, { calm: minutesPassed * 0.025, tired: -minutesPassed * 0.05 });
      agent.currentTask = "睡眠休息";
    } else {
      agent.energy = clamp(agent.energy - minutesPassed * 0.035, 0, 100);
      if (tooHungryToSleep && foodAvailableAt(agent, world.clock || 0)) {
        adjustNeeds(agent, { hunger: 16, comfort: 2, stress: 1 });
        agent.currentTask = "半夜醒来简单吃点东西";
      }
    }
  });
}

function timeDecayChanges(agent, minutesPassed) {
  const hours = Math.max(0, minutesPassed) / 60;
  const job = String(agent.job || "");
  const age = Number(agent.age || 0);
  const teenOrChild = /\u5b66\u751f|\u513f\u7ae5|\u5e7c\u513f|student|child|teen/i.test(job) || ["child", "teen"].includes(agent.ageStage) || (age > 0 && age < 18);
  const elder = /\u8001\u4eba|\u9000\u4f11|elder|retired/i.test(job) || agent.ageStage === "elder" || age >= 65;
  const baseHungerRate = teenOrChild ? 3.0 : elder ? 2.1 : 2.5;
  const baseHealthRate = elder ? 0.45 : 0.18;
  const baseSafetyRate = 0.18;
  return {
    hunger: -hours * baseHungerRate * decayMultiplier(agent.needs?.hunger, 1.2),
    hygiene: -hours * (teenOrChild ? 0.9 : 0.7),
    health: -hours * baseHealthRate * decayMultiplier(agent.needs?.health, 2.0),
    social: -hours * 0.35,
    responsibility: -hours * (/\u5b66\u751f|\u8001\u5e08|\u533b\u751f|\u62a4\u58eb|\u804c\u5458|\u5de5\u4eba|\u5e97\u5458|\u5e97\u4e3b|worker|teacher|doctor|nurse|staff/i.test(job) ? 0.65 : 0.35),
    stress: -hours * 0.75,
    comfort: -hours * 0.55,
    safety: -hours * baseSafetyRate * decayMultiplier(agent.needs?.safety, 2.5)
  };
}

function applyTimeDecay(world, minutesPassed) {
  (world.agents || []).forEach(agent => {
    if (isDead(agent) || agent.isSleeping) return;
    ensureAgentShape(agent);
    adjustNeeds(agent, timeDecayChanges(agent, minutesPassed));
    const hungerPressure = needPressure(agent.needs.hunger, 60);
    const stressPressure = needPressure(agent.needs.stress, 55);
    const socialPressure = needPressure(agent.needs.social, 45);
    const healthPressure = needPressure(agent.needs.health, 50);
    const safetyPressure = needPressure(agent.needs.safety, 55);
    adjustEmotion(agent, {
      tired: hungerPressure * 3 + healthPressure * 2,
      angry: hungerPressure * 1.5,
      calm: -(hungerPressure * 2 + stressPressure * 2 + safetyPressure * 2.5),
      anxious: stressPressure * 3 + healthPressure * 1.5 + safetyPressure * 4,
      hopeful: -(stressPressure * 1.5 + healthPressure * 1.5),
      lonely: socialPressure * 2.5,
      sad: socialPressure * 1.2
    });
  });
}

function applyPassiveNeedRecovery(world, minutesPassed) {
  const hours = Math.max(0, minutesPassed) / 60;
  const minuteOfDay = Number(world.clock || 0) % 1440;
  const isMorning = minuteOfDay >= 360 && minuteOfDay <= 540;
  const isEvening = minuteOfDay >= 1080 && minuteOfDay <= 1380;
  (world.agents || []).forEach(agent => {
    if (isDead(agent) || agent.isSleeping) return;
    ensureAgentShape(agent);
    const here = placeId(agent);
    const job = String(agent.job || "");
    const changes = {};
    if (here === "apartment") changes.hygiene = hours * ((isMorning || isEvening) ? 5.0 : 1.2);
    if (["school", "office", "factory", "clinic", "store", "market", "breakfast", "restaurant", "police"].includes(here)) {
      changes.responsibility = hours * (/\u5b66\u751f|\u8001\u5e08|\u533b\u751f|\u62a4\u58eb|\u804c\u5458|\u5de5\u4eba|\u5e97\u5458|\u5e97\u4e3b|worker|teacher|doctor|nurse|staff/i.test(job) ? 2.5 : 1.1);
    }
    if (["school", "market", "square", "park", "breakfast", "store", "restaurant", "clinic"].includes(here)) changes.social = hours * 1.6;
    if (here === "clinic" && isMedicalWorker(agent)) changes.responsibility = Math.max(changes.responsibility || 0, hours * 2.0);
    const wellFed = Number(agent.needs?.hunger ?? 0) > 60;
    const stableStress = Number(agent.needs?.stress ?? 0) > 45;
    const safeEnough = Number(agent.needs?.safety ?? 0) > 45;
    const health = Number(agent.needs?.health ?? 100);
    if (wellFed && stableStress && safeEnough && health > 0 && health < 95) {
      changes.health = Math.max(changes.health || 0, hours * (here === "apartment" ? 0.8 : 0.25));
    }
    if (here === "clinic" && health > 0 && health < 70) {
      const assessment = medicalAssessment(agent);
      const staffAvailable = clinicCareAvailableFor(world, agent) || Number(world.clinicRuntime?.staffAvailable || 0) > 0;
      const clinicRate = assessment.severity === "critical" ? 2.5 : assessment.severity === "poor" ? 1.6 : 0.6;
      const waitingRate = staffAvailable ? clinicRate : 0.4;
      changes.health = Math.max(changes.health || 0, hours * waitingRate * ageRecoveryFactor(agent));
      changes.safety = Math.max(changes.safety || 0, hours * 2);
      changes.stress = Math.max(changes.stress || 0, hours * 2);
    }
    if (Object.keys(changes).length) adjustNeeds(agent, changes);
  });
}

function foodAvailableAt(agent, clockMinute = null) {
  const here = agent.position || agent.place || "";
  if (["apartment", "breakfast", "store", "restaurant", "market"].includes(here)) return true;
  const hour = Number.isFinite(Number(clockMinute)) ? Math.floor((Number(clockMinute) % 1440) / 60) : null;
  const lunchWindow = hour === null || (hour >= 11 && hour <= 13);
  const shiftMealWindow = hour === null || (hour >= 11 && hour <= 13) || (hour >= 17 && hour <= 19);
  if (["school", "kindergarten"].includes(here)) return lunchWindow;
  if (["office", "factory", "police", "clinic", "warehouse", "library"].includes(here)) return shiftMealWindow;
  return false;
}

function isMealWindow(hour) {
  return (hour >= 7 && hour <= 9)
    || (hour >= 11 && hour <= 13)
    || (hour >= 17 && hour <= 19);
}

function shouldSeekFood(agent, world) {
  const hunger = Number(agent.needs?.hunger ?? 70);
  const hour = Math.floor((Number(world.clock || 0) % 1440) / 60);
  return (isMealWindow(hour) && hunger < 55) || hunger < 30;
}

function clinicCareAvailableFor(world, agent) {
  if ((agent.position || agent.place) !== "clinic") return false;
  return (world.agents || []).some(item => item.id !== agent.id && item.position === "clinic" && isMedicalWorker(item) && !isDead(item));
}

function placeId(agent) {
  return agent?.position || agent?.place || "";
}

function placeName(world, id) {
  const place = (world.places || []).find(item => item?.id === id);
  return place?.name || id || "未知地点";
}

function isMedicalWorker(agent) {
  const job = `${agent?.job || ""} ${agent?.profession || ""} ${agent?.role || ""}`.toLowerCase();
  return /doctor|nurse|clinic|medical|pharmacy/.test(job)
    || job.includes("医生")
    || job.includes("护士")
    || job.includes("医护")
    || job.includes("护理")
    || job.includes("药房")
    || job.includes("卫生")
    || /鍖荤敓|鎶ゅ＋|鍖绘姢|鎶ょ悊/i.test(job);
}

function agentAgeStage(agent) {
  const age = Number(agent?.age || agent?.ageYears || 0);
  if (agent?.ageStage) return agent.ageStage;
  if (age && age < 13) return "child";
  if (age && age < 18) return "teen";
  if (age >= 65) return "elder";
  return "adult";
}

function ageRecoveryFactor(agent) {
  const stage = agentAgeStage(agent);
  if (stage === "child") return 1.25;
  if (stage === "teen") return 1.1;
  if (stage === "elder") return 0.65;
  return 1;
}

function healthState(health) {
  const value = clamp(health, 0, 100);
  if (value < 20) return "critical";
  if (value < 40) return "poor";
  if (value < 70) return "normal";
  return "healthy";
}

function medicalAssessment(agent) {
  const health = Number(agent?.needs?.health ?? 100);
  const stress = Number(agent?.needs?.stress ?? 70);
  const severity = healthState(health);
  const diseaseState = agent?.diseaseState || agent?.medicalState?.diseaseState || "";
  const recentEvents = Array.isArray(agent?.recentEvents) ? agent.recentEvents.slice(-5) : [];
  const diseaseFlag = Boolean(diseaseState) && !/none|healthy|clear/i.test(String(diseaseState));
  const treatmentRequired = severity === "critical"
    || severity === "poor"
    || diseaseFlag
    || (severity === "normal" && stress < 35);
  const recoveryPlan = severity === "critical"
    ? "urgent_treatment"
    : severity === "poor"
      ? "clinic_treatment"
      : severity === "normal"
        ? "rest_and_observe"
        : "maintain_health";
  return {
    severity,
    treatmentRequired,
    recoveryPlan,
    inputs: {
      health: clamp(health, 0, 100),
      ageStage: agentAgeStage(agent),
      stress: clamp(stress, 0, 100),
      diseaseState,
      recentEvents
    }
  };
}

function medicalTreatmentEffect(agent, assessment, options = {}) {
  const health = Number(agent?.needs?.health ?? 100);
  const severity = assessment?.severity || healthState(health);
  const ranges = {
    critical: [15, 25],
    poor: [5, 15],
    normal: [1, 3],
    healthy: [0, 0]
  };
  const [min, max] = ranges[severity] || ranges.normal;
  if (max <= 0) return 0;
  const deficit = clamp((100 - health) / 100, 0, 1);
  const staffFactor = clamp(Number(options.staffFactor ?? 1), 0.65, 1.2);
  const timeFactor = clamp(Number(options.timeFactor ?? 1), 0.25, 1.5);
  const amount = (min + (max - min) * deficit) * ageRecoveryFactor(agent) * staffFactor * timeFactor;
  return Number(clamp(amount, min * 0.55, max).toFixed(2));
}

function ensureClinicRuntime(world) {
  world.clinicRuntime ||= {};
  world.clinicRuntime.medicalCapacity = Number(world.clinicRuntime.medicalCapacity || 0);
  world.clinicRuntime.currentPatients ||= [];
  world.clinicRuntime.staffAvailable = Number(world.clinicRuntime.staffAvailable || 0);
  world.clinicRuntime.treatmentQueue ||= [];
  return world.clinicRuntime;
}

function updateClinicRuntime(world) {
  const runtime = ensureClinicRuntime(world);
  const agents = Array.isArray(world.agents) ? world.agents : [];
  const patients = agents
    .filter(agent => !isDead(agent) && placeId(agent) === "clinic" && Number(agent.needs?.health ?? 100) < 70)
    .sort((a, b) => Number(a.needs?.health ?? 100) - Number(b.needs?.health ?? 100));
  const staff = agents.filter(agent => !isDead(agent) && placeId(agent) === "clinic" && isMedicalWorker(agent));
  runtime.currentPatients = patients.map(agent => agent.id);
  runtime.staffAvailable = staff.length;
  runtime.medicalCapacity = Math.max(0, staff.length * 6);
  runtime.treatmentQueue = patients.map(agent => agent.id);
  runtime.updatedAt = world.clock || 0;
  return runtime;
}

function assignMedicalDuty(world, agent, mode) {
  if (!agent || isDead(agent)) return false;
  ensureAgentShape(agent);
  if (Number(agent.needs?.health ?? 100) < 15) return false;
  agent.movement = null;
  agent.position = "clinic";
  agent.place = "clinic";
  agent.isSleeping = false;
  agent.currentTask = mode === "on_call" ? "夜间应急值守诊所" : "诊所值班接诊";
  agent.medicalDutyState = {
    mode,
    assignedAt: world.clock || 0,
    until: (world.clock || 0) + (mode === "on_call" ? 180 : 720)
  };
  return true;
}

function doctorDutySystem(world) {
  const agents = Array.isArray(world.agents) ? world.agents : [];
  const staff = agents.filter(agent => !isDead(agent) && isMedicalWorker(agent));
  if (!staff.length) {
    updateClinicRuntime(world);
    return;
  }
  const minute = Number(world.clock || 0) % 1440;
  const hour = Math.floor(minute / 60);
  const isDayShift = hour >= 7 && hour < 19;
  const clinicPatients = agents.filter(agent => !isDead(agent) && placeId(agent) === "clinic" && Number(agent.needs?.health ?? 100) < 40);
  const currentStaff = staff.filter(agent => placeId(agent) === "clinic");
  const targetStaff = isDayShift ? Math.min(staff.length, Math.max(1, Math.ceil(staff.length / 2))) : (clinicPatients.length ? 1 : 0);
  let assigned = currentStaff.length;
  if (assigned < targetStaff) {
    const candidates = staff
      .filter(agent => placeId(agent) !== "clinic")
      .sort((a, b) => Number(b.needs?.health ?? 100) - Number(a.needs?.health ?? 100));
    for (const candidate of candidates) {
      if (assigned >= targetStaff) break;
      if (assignMedicalDuty(world, candidate, isDayShift ? "day_shift" : "on_call")) assigned += 1;
    }
  }
  updateClinicRuntime(world);
}

function scheduleRecoveryTimeline(world, agent, assessment) {
  agent.medicalState ||= {};
  const severity = assessment?.severity || healthState(agent.needs?.health);
  const base = severity === "critical" ? [10, 8, 5] : severity === "poor" ? [6, 4, 2] : [2, 1];
  const factor = ageRecoveryFactor(agent);
  const day = minutesToClock(world.clock || 0).day;
  agent.medicalState.recoveryTimeline = {
    startedAt: world.clock || 0,
    lastAppliedDay: day,
    steps: base.map(value => Number((value * factor).toFixed(2))),
    severity
  };
}

function applyRecoveryTimeline(world) {
  const day = minutesToClock(world.clock || 0).day;
  (world.agents || []).forEach(agent => {
    if (isDead(agent)) return;
    const timeline = agent.medicalState?.recoveryTimeline;
    if (!timeline || !Array.isArray(timeline.steps) || !timeline.steps.length) return;
    if (Number(timeline.lastAppliedDay || 0) >= day) return;
    const health = Number(agent.needs?.health ?? 100);
    if (health >= 70) {
      delete agent.medicalState.recoveryTimeline;
      return;
    }
    const amount = Number(timeline.steps.shift() || 0);
    if (amount > 0) {
      adjustNeeds(agent, { health: amount, comfort: 2, stress: 2 });
      agent.currentTask = "按医嘱恢复身体";
    }
    timeline.lastAppliedDay = day;
    if (!timeline.steps.length || Number(agent.needs?.health ?? 100) >= 70) delete agent.medicalState.recoveryTimeline;
  });
}

function isClinicLinked(world, agent) {
  if (placeId(agent) === "clinic") return true;
  return (Array.isArray(world.groups) ? world.groups : []).some(group => {
    const members = Array.isArray(group.members) ? group.members : [];
    if (!members.includes(agent?.id)) return false;
    return /clinic|medical|诊所|医院|医护|鍖荤枟/.test(`${group.type || ""} ${group.place || ""}`);
  });
}

function nearbyAliveAgents(world, agent) {
  const here = placeId(agent);
  const samePlace = (world.agents || []).filter(item => item?.id && item.id !== agent.id && !isDead(item) && placeId(item) === here);
  const cap = here === "apartment" ? 5 : here === "clinic" ? 12 : here === "school" ? 8 : 6;
  return samePlace
    .map(item => ({
      item,
      score: Math.max(householdScore(world, agent, item), sharedGroupScore(world, agent, item), relationScore(agent, item), isMedicalWorker(item) ? 70 : 0)
    }))
    .filter(entry => here !== "apartment" || entry.score >= 35)
    .sort((a, b) => b.score - a.score)
    .slice(0, cap)
    .map(entry => entry.item);
}

function relationScore(a, b) {
  const rel = a?.relationshipMatrix?.[b?.id] || a?.relations?.[b?.id] || a?.relationships?.[b?.id] || 0;
  if (typeof rel === "number") return rel;
  return Math.max(
    Number(rel.trust || 0),
    Number(rel.intimacy || 0),
    Number(rel.familiarity || 0),
    Number(rel.dependency || 0)
  );
}

function sharedGroupScore(world, a, b) {
  const groups = Array.isArray(world.groups) ? world.groups : [];
  return groups.reduce((score, group) => {
    const members = Array.isArray(group.members) ? group.members : [];
    if (!members.includes(a?.id) || !members.includes(b?.id)) return score;
    const type = String(group.type || "");
    if (/family|household/.test(type)) return Math.max(score, 95);
    if (/class|student|teacher|school|authority/.test(type)) return Math.max(score, 75);
    if (/cowork|work|office|clinic/.test(type)) return Math.max(score, 70);
    if (/neighbor|regular/.test(type)) return Math.max(score, 55);
    return Math.max(score, 35);
  }, 0);
}

function householdScore(world, a, b) {
  const households = Array.isArray(world.households) ? world.households : [];
  return households.some(household => {
    const members = Array.isArray(household.members) ? household.members : [];
    return members.includes(a?.id) && members.includes(b?.id);
  }) ? 100 : 0;
}

function careNetworkAgents(world, patient, level, nearby = []) {
  if (level === "mild") return [];
  const nearbyIds = new Set(nearby.map(item => item.id));
  const all = (world.agents || []).filter(item => item?.id && item.id !== patient.id && !isDead(item));
  const severity = level === "critical" ? 100 : level === "urgent" ? 85 : 65;
  const patientAtClinic = placeId(patient) === "clinic";
  return all
    .map(agent => {
      const samePlace = nearbyIds.has(agent.id) ? 82 : 0;
      const household = householdScore(world, patient, agent);
      const group = sharedGroupScore(world, patient, agent);
      const rel = relationScore(patient, agent);
      const clinicLinked = isMedicalWorker(agent) && (patientAtClinic || isClinicLinked(world, agent));
      const medical = clinicLinked
        ? (patientAtClinic ? 96 : level === "critical" ? Math.max(72, Math.min(90, Math.max(group, rel))) : Math.max(group, rel))
        : 0;
      const score = Math.max(samePlace, medical, household, group, rel);
      return { agent, score, samePlace: Boolean(samePlace), medical: Boolean(medical) };
    })
    .filter(item => item.score >= (level === "alert" ? 70 : 50))
    .sort((a, b) => {
      if (b.samePlace !== a.samePlace) return Number(b.samePlace) - Number(a.samePlace);
      if (b.medical !== a.medical) return Number(b.medical) - Number(a.medical);
      return b.score - a.score;
    })
    .slice(0, level === "critical" ? 8 : 5)
    .map(item => {
      item.agent.alertPriority = Math.max(severity, item.score);
      return item.agent;
    });
}

function addEvent(agent, event) {
  agent.eventQueue ||= [];
  const key = `${event.type || ""}:${event.targetId || ""}:${event.clock || ""}`;
  if (agent.eventQueue.some(item => item.key === key)) return false;
  agent.eventQueue.unshift({ key, ...event });
  agent.eventQueue = agent.eventQueue.slice(0, 12);
  return true;
}

function addMemory(agent, text, importance = 3, layer = "short", clock = 0, dedupeKey = "") {
  ensureAgentShape(agent);
  agent.memoryDedupe ||= {};
  if (dedupeKey && agent.memoryDedupe[dedupeKey]) return;
  agent.memory[layer] ||= [];
  if (agent.memory[layer].some(item => item?.text === text || (dedupeKey && item?.dedupeKey === dedupeKey))) return;
  agent.memory[layer].unshift({ text, importance, at: clock, source: "node-medical-escalation", dedupeKey: dedupeKey || undefined });
  agent.memory[layer] = agent.memory[layer].slice(0, 30);
  if (dedupeKey) {
    agent.memoryDedupe[dedupeKey] = clock || 0;
    const entries = Object.entries(agent.memoryDedupe);
    if (entries.length > 200) agent.memoryDedupe = Object.fromEntries(entries.slice(-120));
  }
}

function notifyNearbyForMedicalHelp(world, patient, level) {
  const nearby = nearbyAliveAgents(world, patient);
  const clock = world.clock || 0;
  const recipients = careNetworkAgents(world, patient, level, nearby);
  recipients.forEach(observer => {
    const isNearby = placeId(observer) === placeId(patient);
    const isDoctor = isMedicalWorker(observer);
    addEvent(observer, {
      type: "health_alert",
      targetId: patient.id,
      targetName: patient.name,
      level,
      priority: observer.alertPriority || (level === "critical" ? 100 : level === "urgent" ? 90 : 70),
      place: placeId(patient),
      clock,
      knownByMode: isNearby ? "seen" : isDoctor ? "medical_call" : "social_contact",
      summary: isNearby
        ? `${patient.name}身体明显不适，需要附近的人帮忙确认情况并考虑送往诊所。`
        : isDoctor
          ? `${patient.name}出现${level}级健康状况，需要医护尽快回到诊所或安排救助。`
          : `${patient.name}出现健康状况，关系网络中有人把消息传到了这里，需要确认是否能帮忙。`
    });
    addMemory(observer, isNearby
      ? `${minutesToClock(clock).text}，在${placeId(patient)}看到${patient.name}身体不适，需要帮助。`
      : `${minutesToClock(clock).text}，得知${patient.name}身体不适，需要医疗或熟人帮助。`, level === "critical" ? 5 : 4, "short", clock, `medical:${patient.id}:${level}:${Math.floor(clock / 360)}`);
    if (isDoctor && placeId(observer) !== "clinic" && (level === "critical" || level === "urgent")) {
      observer.movement ||= {
        from: placeId(observer),
        to: "clinic",
        startedAt: clock,
        arriveAt: clock + (level === "critical" ? 20 : 35),
        reason: "medical_alert"
      };
      observer.activeProcess ||= {
        goal: "返回诊所处理急症",
        stage: "return_to_clinic",
        currentStep: `收到${patient.name}的健康求助，准备回诊所处理`,
        progress: 5,
        blockedBy: "needs_travel_to_clinic",
        updatedAt: clock
      };
      observer.currentTask = "收到医疗求助，准备返回诊所";
    }
  });
  patient.medicalState ||= {};
  patient.medicalState.knownBy = Array.from(new Set([...(patient.medicalState.knownBy || []), ...recipients.map(item => item.id)]));
  patient.medicalState.nearbyKnownBy = nearby.map(item => item.id);
  patient.medicalState.medicalKnownBy = recipients.filter(isMedicalWorker).map(item => item.id);
  if (nearby.length || recipients.length) patient.medicalState.discoveredAt ||= clock;
  return nearby;
}

function applyMedicalEscalation(world, minutesPassed) {
  world.medicalEscalations ||= [];
  world.basicLifeDone ||= {};
  const now = minutesToClock(world.clock || 0);
  const slot = `${now.day}-${now.h}`;
  const runtime = updateClinicRuntime(world);
  const staff = (world.agents || []).filter(agent => !isDead(agent) && placeId(agent) === "clinic" && isMedicalWorker(agent));
  const treatmentOrder = new Map((runtime.treatmentQueue || []).map((id, index) => [id, index]));
  const capacity = Number(runtime.medicalCapacity || 0);
  (world.agents || []).forEach(agent => {
    if (isDead(agent)) return;
    ensureAgentShape(agent);
    const health = Number(agent.needs?.health ?? 100);
    const here = placeId(agent);
    const assessment = medicalAssessment(agent);
    const level = assessment.severity;
    agent.terminalState ||= { criticalMinutes: 0, lastReasons: [], since: world.clock || 0 };
    agent.medicalState ||= { knownBy: [], undiscoveredMinutes: 0, lastLevel: "none" };
    agent.medicalState.lastLevel = level;
    agent.medicalState.lastCheckedAt = world.clock || 0;
    agent.medicalState.assessment = {
      severity: level,
      treatmentRequired: assessment.treatmentRequired,
      recoveryPlan: assessment.recoveryPlan,
      checkedAt: world.clock || 0
    };

    if (level === "healthy") {
      if (agent.lifeStatus === "critical") agent.lifeStatus = "alive";
      agent.terminalState.criticalMinutes = 0;
      agent.terminalState.healthZeroMinutes = 0;
      agent.medicalState.undiscoveredMinutes = 0;
      return;
    }

    const shouldNotifyMedical = assessment.treatmentRequired || level === "critical" || level === "poor" || here === "clinic";
    const nearby = shouldNotifyMedical ? notifyNearbyForMedicalHelp(world, agent, level) : [];
    const knownCount = Array.isArray(agent.medicalState.knownBy) ? agent.medicalState.knownBy.length : 0;
    if (!nearby.length && !knownCount && here !== "clinic") {
      agent.medicalState.undiscoveredMinutes = Number(agent.medicalState.undiscoveredMinutes || 0) + Number(minutesPassed || 0);
    } else {
      agent.medicalState.undiscoveredMinutes = 0;
    }

    if (level === "critical") {
      agent.lifeStatus = "critical";
      agent.isSleeping = false;
    }

    if (here === "clinic") {
      const key = `medical-care-${slot}-${agent.id}`;
      const queueIndex = treatmentOrder.has(agent.id) ? treatmentOrder.get(agent.id) : capacity;
      const canTreat = staff.length > 0 && queueIndex < capacity;
      const shouldTreat = assessment.treatmentRequired || level === "normal";
      if (canTreat && shouldTreat && !world.basicLifeDone[key]) {
        const effect = medicalTreatmentEffect(agent, assessment, {
          staffFactor: Math.min(1.2, 0.85 + staff.length * 0.08),
          timeFactor: clamp(Number(minutesPassed || 60) / 60, 0.5, 1.2)
        });
        adjustNeeds(agent, {
          health: effect,
          safety: level === "critical" ? 12 : 8,
          stress: level === "critical" ? 12 : 8,
          comfort: level === "critical" ? 8 : 5,
          hunger: agent.needs.hunger <= 5 ? 12 : 0
        });
        if (agent.needs.health > 20 && agent.lifeStatus === "critical") agent.lifeStatus = "alive";
        agent.currentTask = "在诊所接受治疗";
        agent.medicalState.treatedAt = world.clock || 0;
        agent.medicalState.afterTreatmentCooldownUntil = (world.clock || 0) + (Number(agent.needs.health || 0) >= 40 ? 720 : 360);
        agent.terminalState.healthZeroMinutes = 0;
        scheduleRecoveryTimeline(world, agent, assessment);
        world.basicLifeDone[key] = true;
        pushRecord(world, "医疗治疗", `${agent.name}在诊所完成${level}级健康处理，健康恢复${effect}。`, "medical", [agent.id, ...staff.slice(0, 3).map(item => item.id)]);
      } else if (!staff.length) {
        adjustNeeds(agent, { safety: 2, stress: 2, comfort: 1, health: level === "critical" ? 1.5 : 0.5 });
        agent.currentTask = "在诊所候诊观察";
        const waitKey = `medical-wait-${slot}-${agent.id}`;
        if (!world.basicLifeDone[waitKey]) {
          pushRecord(world, "候诊等待", `${agent.name}已经到诊所，但暂时没有可见医护，只能等待处理。`, "medical", [agent.id]);
          world.basicLifeDone[waitKey] = true;
        }
      } else {
        adjustNeeds(agent, { safety: 1, stress: 1, comfort: 1, health: 0.5 });
        agent.currentTask = "在诊所排队候诊";
      }
      return;
    }

    if (level === "normal" && !assessment.treatmentRequired) {
      if (!agent.currentTask) agent.currentTask = "身体状态一般，放慢节奏";
      return;
    }

    if (level === "critical" || level === "poor") {
      agent.activeProcess ||= {
        goal: "寻求医疗帮助",
        stage: nearby.length ? "ask_nearby_help" : "not_yet_discovered",
        currentStep: nearby.length ? "向附近的人求助，准备前往诊所" : "身体不适但附近无人发现",
        progress: level === "critical" ? 20 : 10,
        blockedBy: nearby.length ? "waiting_for_escort" : "undiscovered",
        updatedAt: world.clock || 0
      };
      agent.currentTask = level === "critical"
        ? (nearby.length ? "请求附近人帮助前往诊所" : "身体严重不适，等待被发现")
        : "身体较差，准备就医或休养";
      if (!agent.movement && (level === "critical" || health < 30 || nearby.length)) {
        const escort = nearby.find(item => isMedicalWorker(item)) || nearby[0];
        agent.movement = {
          from: here,
          to: "clinic",
          departAt: world.clock || 0,
          arriveAt: (world.clock || 0) + (level === "critical" ? 20 : 35),
          reason: level === "critical" ? "medical_escort" : "medical_visit",
          escortBy: escort?.id || ""
        };
        agent.activeProcess = {
          ...(agent.activeProcess || {}),
          goal: "寻求医疗帮助",
          stage: "go_to_clinic",
          currentStep: escort ? `${escort.name}正在协助前往诊所` : "前往诊所检查身体",
          progress: Math.max(Number(agent.activeProcess?.progress || 0), level === "critical" ? 45 : 30),
          blockedBy: "",
          updatedAt: world.clock || 0
        };
        if (escort && !isDead(escort)) escort.currentTask = `协助${agent.name}前往诊所`;
        pushRecord(world, level === "critical" ? "送医协助" : "就医安排", escort
          ? `${agent.name}身体不适，${escort.name}协助前往诊所。`
          : `${agent.name}身体较差，准备前往诊所。`, "medical", [agent.id, ...nearby.slice(0, 4).map(item => item.id)]);
      }
      const key = `medical-alert-${slot}-${agent.id}`;
      if (!world.basicLifeDone[key]) {
        world.medicalEscalations.unshift({
          id: `medical-${world.clock || 0}-${agent.id}`,
          patientId: agent.id,
          patientName: agent.name,
          level,
          place: here,
          knownBy: nearby.map(item => item.id),
          clock: world.clock || 0,
          status: nearby.length ? "known_by_nearby" : "undiscovered"
        });
        world.medicalEscalations = world.medicalEscalations.slice(0, 200);
        pushRecord(world, "医疗求助", nearby.length
          ? `${agent.name}身体不适，附近的${nearby.map(item => item.name).slice(0, 4).join("、")}已经注意到。`
          : `${agent.name}身体不适，但附近暂时无人发现。`, "medical", [agent.id, ...nearby.slice(0, 6).map(item => item.id)]);
        world.basicLifeDone[key] = true;
      }
    }
  });
  updateClinicRuntime(world);
}

function applyBasicLifeMaintenance(world) {
  const now = minutesToClock(world.clock || 0);
  world.basicLifeDone ||= {};
  const mealWindow = isMealWindow(now.h);
  const emergencyFoodSlot = Math.floor(Number(world.clock || 0) / 180);
  const opportunityFoodSlot = Math.floor(Number(world.clock || 0) / 120);
  (world.agents || []).forEach(agent => {
    if (isDead(agent) || agent.isSleeping) return;
    ensureAgentShape(agent);
    const mealPeriod = now.h <= 9 ? "breakfast" : now.h <= 13 ? "lunch" : now.h <= 19 ? "dinner" : "offmeal";
    const slot = `${now.day}-${mealPeriod}-${agent.id}`;
    const beforeHunger = Number(agent.needs.hunger || 0);
    const canEatHere = foodAvailableAt(agent, world.clock || 0);
    const emergencyFoodKey = `emergency-food-${emergencyFoodSlot}-${agent.id}`;
    const opportunityFoodKey = `opportunity-food-${opportunityFoodSlot}-${agent.id}`;
    const shouldEatMeal = mealWindow && canEatHere && shouldSeekFood(agent, world) && !world.basicLifeDone[`meal-${slot}`];
    const shouldEatOpportunity = !mealWindow && canEatHere && beforeHunger < 45 && !world.basicLifeDone[opportunityFoodKey];
    const shouldEatEmergency = canEatHere && beforeHunger <= 20 && !world.basicLifeDone[emergencyFoodKey];
    if (shouldEatMeal || shouldEatOpportunity || shouldEatEmergency) {
      const hungerGain = beforeHunger <= 8 ? 55 : beforeHunger < 25 ? 45 : beforeHunger < 45 ? 35 : 22;
      adjustNeeds(agent, { hunger: hungerGain, comfort: 3, stress: 2 });
      if (beforeHunger < 35 || !agent.currentTask || ["维持当前生活安排", "开始一天的日常安排"].includes(agent.currentTask)) {
        agent.currentTask = "补充食物";
      }
      world.basicLifeDone[shouldEatMeal ? `meal-${slot}` : shouldEatOpportunity ? opportunityFoodKey : emergencyFoodKey] = true;
      if (beforeHunger < 35) {
        pushRecord(world, "基础进食", `${agent.name}饥饿明显，按当前地点条件补充了食物。`, "survival", [agent.id]);
      }
    }
    if (clinicCareAvailableFor(world, agent) && (agent.needs.hunger <= 5 || agent.needs.stress <= 5) && !world.basicLifeDone[`clinic-${slot}`]) {
      adjustNeeds(agent, { hunger: agent.needs.hunger <= 5 ? 12 : 0, safety: 6, stress: 5, comfort: 3 });
      agent.currentTask = "基础急救";
      world.basicLifeDone[`clinic-${slot}`] = true;
      pushRecord(world, "基础救治", `${agent.name}在诊所有医护在场，获得最低限度照护。`, "survival", [agent.id]);
    }
    if (beforeHunger < 20 && !canEatHere && !agent.movement && placeId(agent) !== "apartment") {
      agent.movement = {
        from: placeId(agent),
        to: "apartment",
        departAt: world.clock || 0,
        arriveAt: (world.clock || 0) + 30,
        reason: "hunger_return_home"
      };
      agent.currentTask = "太饿了，先回家吃饭";
      pushRecord(world, "饥饿求生", `${agent.name}饥饿过低，暂停普通安排并回家找食物。`, "survival", [agent.id]);
    }
  });
  if (Object.keys(world.basicLifeDone).length > 600) {
    world.basicLifeDone = Object.fromEntries(Object.entries(world.basicLifeDone).slice(-300));
  }
}

function advanceMovement(world) {
  (world.agents || []).forEach(agent => {
    if (isDead(agent)) {
      agent.movement = null;
      return;
    }
    if (!agent.movement) return;
    if ((world.clock || 0) >= Number(agent.movement.arriveAt || 0)) {
      const from = agent.movement.from || agent.position;
      const target = agent.movement.to || agent.position;
      agent.position = target;
      agent.place = target;
      agent.movement = null;
      pushRecord(world, `${agent.name} 到达`, `${agent.name}从${placeName(world, from)}到达${placeName(world, agent.position)}。`, "move", [agent.id]);
    }
  });
}

function evaluateMortality(world) {
  (world.agents || []).forEach(agent => {
    if (isDead(agent)) return;
    ensureAgentShape(agent);
    const n = agent.needs || {};
    const critical = ["health", "hunger", "safety", "stress"].filter(key => Number(n[key] ?? 100) <= 0);
    if (!critical.length) {
      if (agent.lifeStatus === "critical") agent.lifeStatus = "alive";
      return;
    }
    agent.terminalState ||= { criticalMinutes: 0, lastReasons: [], since: world.clock || 0 };
    agent.terminalState.criticalMinutes = Number(agent.terminalState.criticalMinutes || 0) + Number(world.config?.virtualMinutesPerPulse || 30);
    agent.terminalState.lastReasons = critical;
    agent.lifeStatus = "critical";
    if ((n.health ?? 100) <= 0 && agent.terminalState.criticalMinutes >= 1440) {
      agent.lifeStatus = "dead";
      agent.deathAt = world.clock || 0;
      agent.deathCause = "健康归零且长期未恢复";
      pushRecord(world, "死亡", `${agent.name}因健康长期归零死亡。`, "death", [agent.id]);
    }
  });
}

function evaluateMortalityV2(world) {
  (world.agents || []).forEach(agent => {
    if (isDead(agent)) return;
    ensureAgentShape(agent);
    const n = agent.needs || {};
    const critical = ["health", "hunger", "safety"].filter(key => Number(n[key] ?? 100) <= 0);
    agent.terminalState ||= { criticalMinutes: 0, lastReasons: [], since: world.clock || 0 };
    if (Number(n.health ?? 100) > 30 && agent.lifeStatus === "critical") {
      agent.lifeStatus = "alive";
      agent.terminalState.criticalMinutes = 0;
      agent.terminalState.healthZeroMinutes = 0;
    }
    if (!critical.length) {
      if (agent.lifeStatus === "critical") agent.lifeStatus = "alive";
      agent.terminalState.healthZeroMinutes = 0;
      agent.terminalState.hungerZeroMinutes = 0;
      agent.terminalState.safetyZeroMinutes = 0;
      return;
    }
    const tickMinutes = Number(world.config?.virtualMinutesPerPulse || 30);
    agent.terminalState.criticalMinutes = Number(agent.terminalState.criticalMinutes || 0) + tickMinutes;
    agent.terminalState.healthZeroMinutes = Number(n.health ?? 100) <= 0 ? Number(agent.terminalState.healthZeroMinutes || 0) + tickMinutes : 0;
    agent.terminalState.hungerZeroMinutes = Number(n.hunger ?? 100) <= 0 ? Number(agent.terminalState.hungerZeroMinutes || 0) + tickMinutes : 0;
    agent.terminalState.safetyZeroMinutes = Number(n.safety ?? 100) <= 0 ? Number(agent.terminalState.safetyZeroMinutes || 0) + tickMinutes : 0;
    agent.terminalState.lastReasons = critical;
    agent.lifeStatus = "critical";
    const medical = agent.medicalState || {};
    const hasRescue = placeId(agent) === "clinic"
      || Number(medical.treatedAt || 0) >= Number((world.clock || 0) - 1440)
      || (Array.isArray(medical.knownBy) && medical.knownBy.length > 0)
      || (agent.activeProcess && /medical|clinic|help|escort|医疗|诊所|求助/.test(`${agent.activeProcess.goal || ""} ${agent.activeProcess.stage || ""} ${agent.activeProcess.blockedBy || ""}`));
    const undiscoveredMinutes = Number(medical.undiscoveredMinutes || 0);
    const healthZeroMinutes = Number(agent.terminalState.healthZeroMinutes || 0);
    if ((n.health ?? 100) <= 0 && !hasRescue && healthZeroMinutes >= 1440 && undiscoveredMinutes >= 720) {
      agent.lifeStatus = "dead";
      agent.deathAt = world.clock || 0;
      agent.deathCause = "健康归零且长期无人发现或救治";
      pushRecord(world, "死亡", `${agent.name}因健康归零且长期无人发现或救治死亡。`, "death", [agent.id]);
    }
  });
}

function evaluateMortalityByCause(world) {
  (world.agents || []).forEach(agent => {
    if (isDead(agent)) return;
    ensureAgentShape(agent);
    const n = agent.needs || {};
    const critical = ["health", "hunger", "safety", "stress"].filter(key => Number(n[key] ?? 100) <= 0);
    agent.terminalState ||= { criticalMinutes: 0, lastReasons: [], since: world.clock || 0 };
    if (!critical.length) {
      if (agent.lifeStatus === "critical") agent.lifeStatus = "alive";
      agent.terminalState.criticalMinutes = 0;
      agent.terminalState.healthZeroMinutes = 0;
      agent.terminalState.hungerZeroMinutes = 0;
      agent.terminalState.safetyZeroMinutes = 0;
      return;
    }

    const tickMinutes = Number(world.config?.virtualMinutesPerPulse || 30);
    agent.terminalState.criticalMinutes = Number(agent.terminalState.criticalMinutes || 0) + tickMinutes;
    agent.terminalState.healthZeroMinutes = Number(n.health ?? 100) <= 0 ? Number(agent.terminalState.healthZeroMinutes || 0) + tickMinutes : 0;
    agent.terminalState.hungerZeroMinutes = Number(n.hunger ?? 100) <= 0 ? Number(agent.terminalState.hungerZeroMinutes || 0) + tickMinutes : 0;
    agent.terminalState.safetyZeroMinutes = Number(n.safety ?? 100) <= 0 ? Number(agent.terminalState.safetyZeroMinutes || 0) + tickMinutes : 0;
    agent.terminalState.lastReasons = critical;
    agent.lifeStatus = "critical";

    const medical = agent.medicalState || {};
    const treatedAt = Number(medical.treatedAt || 0);
    const hasRescue = placeId(agent) === "clinic"
      || (treatedAt > 0 && treatedAt >= Number((world.clock || 0) - 1440))
      || (Array.isArray(medical.knownBy) && medical.knownBy.length > 0)
      || (agent.activeProcess && /medical|clinic|help|escort/.test(`${agent.activeProcess.goal || ""} ${agent.activeProcess.stage || ""} ${agent.activeProcess.blockedBy || ""}`));
    agent.terminalState.undiscoveredRiskMinutes = hasRescue ? 0 : Number(agent.terminalState.undiscoveredRiskMinutes || 0) + tickMinutes;
    const undiscoveredMinutes = Math.max(Number(medical.undiscoveredMinutes || 0), Number(agent.terminalState.undiscoveredRiskMinutes || 0));
    const healthZeroMinutes = Number(agent.terminalState.healthZeroMinutes || 0);
    const hungerZeroMinutes = Number(agent.terminalState.hungerZeroMinutes || 0);
    const safetyZeroMinutes = Number(agent.terminalState.safetyZeroMinutes || 0);
    let deathCause = "";
    let deathBody = "";

    if ((n.safety ?? 100) <= 0 && safetyZeroMinutes >= 180 && undiscoveredMinutes >= 30) {
      deathCause = "safety_zero_unrescued";
      deathBody = `${agent.name} died after safety stayed at zero without timely rescue.`;
    } else if ((n.health ?? 100) <= 0 && !hasRescue && healthZeroMinutes >= 1440 && undiscoveredMinutes >= 720) {
      deathCause = "health_zero_unrescued";
      deathBody = `${agent.name} died after health stayed at zero without discovery or treatment.`;
    } else if ((n.hunger ?? 100) <= 0 && hungerZeroMinutes >= 2880 && undiscoveredMinutes >= 720) {
      deathCause = "hunger_zero_long_term";
      deathBody = `${agent.name} died after long-term hunger without timely rescue.`;
    }

    if (deathCause) {
      agent.lifeStatus = "dead";
      agent.deathAt = world.clock || 0;
      agent.deathCause = deathCause;
      agent.movement = null;
      pushRecord(world, "death", deathBody, "death", [agent.id]);
    }
  });
}

function nodeStepPayload(payload, options = {}) {
  const next = JSON.parse(JSON.stringify(payload || {}));
  const world = next.world || next;
  world.config ||= {};
  const minutes = clamp(options.minutes || world.config.virtualMinutesPerPulse || 30, 1, 240);
  world.clock = Number(world.clock || 0) + minutes;
  world.weatherBox ||= {};
  world.weatherBox.calendar = calendarForClock(world.clock);
  (world.agents || []).forEach(agent => {
    ensureAgentShape(agent);
    agent.previousNeeds = { ...(agent.needs || {}) };
    agent.previousEmotionVector = { ...(agent.emotionVector || {}) };
  });
  updateSleepStates(world, minutes);
  doctorDutySystem(world);
  advanceMovement(world);
  applyTimeDecay(world, minutes);
  applyPassiveNeedRecovery(world, minutes);
  applyRecoveryTimeline(world);
  applyBasicLifeMaintenance(world);
  applyMedicalEscalation(world, minutes);
  evaluateMortalityByCause(world);
  pushLog(world, "Node Core Tick", `纯 Node 核心推进 ${minutes} 分钟：睡眠、生理、基础维护、移动和死亡检查已结算。`);
  next.world = world;
  next.savedAt = new Date().toISOString();
  next.meta ||= {};
  next.meta.updatedAt = new Date().toISOString();
  next.meta.clockText = minutesToClock(world.clock).text;
  next.meta.day = minutesToClock(world.clock).day;
  next.meta.agentCount = Array.isArray(world.agents) ? world.agents.length : 0;
  return { payload: next, summary: { clock: world.clock, clockText: next.meta.clockText, agentCount: next.meta.agentCount, minutes } };
}

module.exports = {
  nodeStepPayload,
  minutesToClock,
  calendarForClock
};

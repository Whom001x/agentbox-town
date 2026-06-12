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
    agent.isSleeping = shouldSleep;
    if (shouldSleep) {
      agent.energy = clamp(agent.energy + minutesPassed * 0.18, 0, 100);
      agent.sleepQuality = clamp(agent.sleepQuality + minutesPassed * 0.08, 0, 100);
      adjustNeeds(agent, { stress: minutesPassed * 0.035, comfort: minutesPassed * 0.025, hunger: -minutesPassed * 0.018 });
      adjustEmotion(agent, { calm: minutesPassed * 0.025, tired: -minutesPassed * 0.05 });
      agent.currentTask = "睡眠休息";
    } else {
      agent.energy = clamp(agent.energy - minutesPassed * 0.035, 0, 100);
    }
  });
}

function timeDecayChanges(agent, minutesPassed) {
  const hours = Math.max(0, minutesPassed) / 60;
  const job = String(agent.job || "");
  const teenOrChild = /学生|儿童|幼儿/.test(job) || ["child", "teen"].includes(agent.ageStage);
  const elder = /老人|退休/.test(job) || agent.ageStage === "elder";
  return {
    hunger: -hours * (teenOrChild ? 6.2 : elder ? 4.2 : 5.0),
    hygiene: -hours * (teenOrChild ? 3.2 : 2.6),
    health: -hours * (elder ? 1.4 : 0.55),
    social: -hours * 1.5,
    responsibility: -hours * (/学生|老师|医生|护士|职员|工人/.test(job) ? 2.2 : 1.2),
    stress: -hours * 1.8,
    comfort: -hours * 1.4,
    safety: -hours * 0.45
  };
}

function applyTimeDecay(world, minutesPassed) {
  (world.agents || []).forEach(agent => {
    if (isDead(agent) || agent.isSleeping) return;
    ensureAgentShape(agent);
    adjustNeeds(agent, timeDecayChanges(agent, minutesPassed));
    if (agent.needs.hunger < 22) adjustEmotion(agent, { tired: 1, angry: 0.6, calm: -0.8 });
    if (agent.needs.stress < 28) adjustEmotion(agent, { anxious: 1.2, calm: -1.1 });
    if (agent.needs.social < 22) adjustEmotion(agent, { lonely: 1.2, sad: 0.6 });
    if (agent.needs.health < 30) adjustEmotion(agent, { tired: 1.5, hopeful: -0.8 });
  });
}

function foodAvailableAt(agent) {
  return ["apartment", "breakfast", "store", "restaurant"].includes(agent.position || agent.place || "");
}

function clinicCareAvailableFor(world, agent) {
  if ((agent.position || agent.place) !== "clinic") return false;
  return (world.agents || []).some(item => item.id !== agent.id && item.position === "clinic" && /医生|护士|医护|护理/.test(String(item.job || "")) && !isDead(item));
}

function placeId(agent) {
  return agent?.position || agent?.place || "";
}

function isMedicalWorker(agent) {
  const job = String(agent?.job || "");
  return /医生|护士|医护|护理|doctor|nurse|clinic|鍖荤敓|鎶ゅ＋|鍖绘姢|鎶ょ悊/.test(job);
}

function nearbyAliveAgents(world, agent) {
  const here = placeId(agent);
  return (world.agents || []).filter(item => item?.id && item.id !== agent.id && !isDead(item) && placeId(item) === here);
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
  return all
    .map(agent => {
      const samePlace = nearbyIds.has(agent.id) ? 100 : 0;
      const medical = isMedicalWorker(agent) ? (level === "critical" ? 100 : 82) : 0;
      const household = householdScore(world, patient, agent);
      const group = sharedGroupScore(world, patient, agent);
      const rel = relationScore(patient, agent);
      const score = Math.max(samePlace, medical, household, group, rel);
      return { agent, score, samePlace: Boolean(samePlace), medical: Boolean(medical) };
    })
    .filter(item => item.score >= (level === "alert" ? 70 : 50))
    .sort((a, b) => {
      if (b.samePlace !== a.samePlace) return Number(b.samePlace) - Number(a.samePlace);
      if (b.medical !== a.medical) return Number(b.medical) - Number(a.medical);
      return b.score - a.score;
    })
    .slice(0, level === "critical" ? 12 : 6)
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

function addMemory(agent, text, importance = 3, layer = "short", clock = 0) {
  ensureAgentShape(agent);
  agent.memory[layer] ||= [];
  if (agent.memory[layer].some(item => item?.text === text)) return;
  agent.memory[layer].unshift({ text, importance, at: clock, source: "node-medical-escalation" });
  agent.memory[layer] = agent.memory[layer].slice(0, 30);
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
      : `${minutesToClock(clock).text}，得知${patient.name}身体不适，需要医疗或熟人帮助。`, level === "critical" ? 5 : 4, "short", clock);
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
  (world.agents || []).forEach(agent => {
    if (isDead(agent)) return;
    ensureAgentShape(agent);
    const health = Number(agent.needs?.health ?? 100);
    const here = placeId(agent);
    agent.terminalState ||= { criticalMinutes: 0, lastReasons: [], since: world.clock || 0 };
    agent.medicalState ||= { knownBy: [], undiscoveredMinutes: 0, lastLevel: "none" };
    if (health > 30) {
      agent.medicalState.lastLevel = "none";
      agent.medicalState.undiscoveredMinutes = 0;
      return;
    }
    const level = health <= 0 ? "critical" : health <= 8 ? "urgent" : health <= 15 ? "alert" : "mild";
    agent.medicalState.lastLevel = level;
    agent.medicalState.lastCheckedAt = world.clock || 0;
    const nearby = notifyNearbyForMedicalHelp(world, agent, level);
    const knownCount = Array.isArray(agent.medicalState.knownBy) ? agent.medicalState.knownBy.length : 0;
    if (!nearby.length && !knownCount && here !== "clinic") {
      agent.medicalState.undiscoveredMinutes = Number(agent.medicalState.undiscoveredMinutes || 0) + Number(minutesPassed || 0);
    } else {
      agent.medicalState.undiscoveredMinutes = 0;
    }
    if (level === "mild") {
      if (!agent.currentTask) agent.currentTask = "身体不适，放慢节奏";
      return;
    }
    agent.lifeStatus = health <= 8 ? "critical" : agent.lifeStatus;
    agent.isSleeping = false;
    if (here === "clinic") {
      const staff = nearby.filter(isMedicalWorker);
      if (staff.length) {
        const key = `medical-care-${slot}-${agent.id}`;
        if (!world.basicLifeDone[key]) {
          adjustNeeds(agent, { health: health <= 0 ? 18 : 14, safety: 8, stress: 8, comfort: 5, hunger: agent.needs.hunger <= 5 ? 10 : 0 });
          agent.currentTask = "在诊所接受基础救治";
          agent.medicalState.treatedAt = world.clock || 0;
          agent.terminalState.healthZeroMinutes = 0;
          world.basicLifeDone[key] = true;
          pushRecord(world, "基础救治", `${agent.name}在诊所有医护在场，获得基础救治。`, "medical", [agent.id, ...staff.slice(0, 3).map(item => item.id)]);
        }
      } else {
        adjustNeeds(agent, { safety: 2, stress: 2, health: health <= 0 ? 1 : 0 });
        agent.currentTask = "在诊所等待医护处理";
        pushRecord(world, "候诊等待", `${agent.name}已经到诊所，但暂时没有可见医护，只能等待处理。`, "medical", [agent.id]);
      }
      return;
    }
    if (health <= 8) {
      agent.activeProcess ||= {
        goal: "寻求医疗帮助",
        stage: nearby.length ? "ask_nearby_help" : "not_yet_discovered",
        currentStep: nearby.length ? "向附近的人求助，准备前往诊所" : "身体不适但附近无人发现",
        progress: 10,
        blockedBy: nearby.length ? "waiting_for_escort" : "undiscovered",
        updatedAt: world.clock || 0
      };
      agent.currentTask = nearby.length ? "请求附近人帮助前往诊所" : "身体严重不适，等待被发现";
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
          ? `${agent.name}身体严重不适，附近的${nearby.map(item => item.name).slice(0, 4).join("、")}已经注意到。`
          : `${agent.name}身体严重不适，但附近暂时无人发现。`, "medical", [agent.id, ...nearby.slice(0, 6).map(item => item.id)]);
        world.basicLifeDone[key] = true;
      }
    }
  });
}

function applyBasicLifeMaintenance(world) {
  const now = minutesToClock(world.clock || 0);
  world.basicLifeDone ||= {};
  const mealWindow = [7, 12, 18].includes(now.h);
  (world.agents || []).forEach(agent => {
    if (isDead(agent) || agent.isSleeping) return;
    ensureAgentShape(agent);
    const slot = `${now.day}-${now.h}-${agent.id}`;
    if (mealWindow && foodAvailableAt(agent) && agent.needs.hunger < 75 && !world.basicLifeDone[`meal-${slot}`]) {
      adjustNeeds(agent, { hunger: 22, comfort: 3, stress: 2 });
      agent.currentTask = "补充食物";
      world.basicLifeDone[`meal-${slot}`] = true;
      pushRecord(world, "基础进食", `${agent.name}按当前地点条件补充了食物。`, "survival", [agent.id]);
    }
    if (clinicCareAvailableFor(world, agent) && (agent.needs.health <= 25 || agent.needs.hunger <= 5 || agent.needs.stress <= 5) && !world.basicLifeDone[`clinic-${slot}`]) {
      adjustNeeds(agent, { hunger: agent.needs.hunger <= 5 ? 12 : 0, health: 10, safety: 6, stress: 5, comfort: 3 });
      agent.currentTask = "基础急救";
      world.basicLifeDone[`clinic-${slot}`] = true;
      pushRecord(world, "基础救治", `${agent.name}在诊所有医护在场，获得最低限度照护。`, "survival", [agent.id]);
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
      agent.position = agent.movement.to || agent.position;
      agent.movement = null;
      pushRecord(world, `${agent.name} 到达`, `${agent.name}从${from}到达${agent.position}。`, "move", [agent.id]);
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
    agent.terminalState.criticalMinutes = Number(agent.terminalState.criticalMinutes || 0) + Number(world.config?.virtualMinutesPerPulse || 60);
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
    const critical = ["health", "hunger", "safety", "stress"].filter(key => Number(n[key] ?? 100) <= 0);
    agent.terminalState ||= { criticalMinutes: 0, lastReasons: [], since: world.clock || 0 };
    if (!critical.length) {
      if (agent.lifeStatus === "critical") agent.lifeStatus = "alive";
      agent.terminalState.healthZeroMinutes = 0;
      agent.terminalState.hungerZeroMinutes = 0;
      agent.terminalState.safetyZeroMinutes = 0;
      agent.terminalState.stressZeroMinutes = 0;
      return;
    }
    const tickMinutes = Number(world.config?.virtualMinutesPerPulse || 60);
    agent.terminalState.criticalMinutes = Number(agent.terminalState.criticalMinutes || 0) + tickMinutes;
    agent.terminalState.healthZeroMinutes = Number(n.health ?? 100) <= 0 ? Number(agent.terminalState.healthZeroMinutes || 0) + tickMinutes : 0;
    agent.terminalState.hungerZeroMinutes = Number(n.hunger ?? 100) <= 0 ? Number(agent.terminalState.hungerZeroMinutes || 0) + tickMinutes : 0;
    agent.terminalState.safetyZeroMinutes = Number(n.safety ?? 100) <= 0 ? Number(agent.terminalState.safetyZeroMinutes || 0) + tickMinutes : 0;
    agent.terminalState.stressZeroMinutes = Number(n.stress ?? 100) <= 0 ? Number(agent.terminalState.stressZeroMinutes || 0) + tickMinutes : 0;
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

function nodeStepPayload(payload, options = {}) {
  const next = JSON.parse(JSON.stringify(payload || {}));
  const world = next.world || next;
  world.config ||= {};
  const minutes = clamp(options.minutes || world.config.virtualMinutesPerPulse || 60, 1, 240);
  world.clock = Number(world.clock || 0) + minutes;
  world.weatherBox ||= {};
  world.weatherBox.calendar = calendarForClock(world.clock);
  (world.agents || []).forEach(agent => {
    ensureAgentShape(agent);
    agent.previousNeeds = { ...(agent.needs || {}) };
    agent.previousEmotionVector = { ...(agent.emotionVector || {}) };
  });
  updateSleepStates(world, minutes);
  applyTimeDecay(world, minutes);
  applyBasicLifeMaintenance(world);
  applyMedicalEscalation(world, minutes);
  advanceMovement(world);
  evaluateMortalityV2(world);
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

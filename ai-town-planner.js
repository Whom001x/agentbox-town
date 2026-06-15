"use strict";

const { clamp, placeId } = require("./ai-town-sim-utils");

function minuteOfDay(clock = 0) {
  return ((Number(clock || 0) % 1440) + 1440) % 1440;
}

function dayOf(clock = 0) {
  return Math.floor(Number(clock || 0) / 1440);
}

function hhmmToMinute(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return clamp(hour, 0, 23, 0) * 60 + clamp(minute, 0, 59, 0);
}

function minuteToHHMM(value) {
  const minute = clamp(value, 0, 1439, 0);
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function placeExists(world, id) {
  return Boolean(id && Array.isArray(world?.places) && world.places.some(place => place.id === id));
}

function findPlace(world, candidates, fallback = "apartment") {
  const places = Array.isArray(world?.places) ? world.places : [];
  for (const id of candidates) {
    if (places.some(place => place.id === id)) return id;
  }
  const pattern = new RegExp(candidates.map(item => String(item).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i");
  const found = places.find(place => pattern.test(`${place.id || ""} ${place.name || ""} ${place.type || ""}`));
  return found?.id || (placeExists(world, fallback) ? fallback : places[0]?.id || fallback);
}

function inferRole(agent = {}) {
  const job = String(agent.job || "");
  const age = Number(agent.ageYears ?? agent.age ?? 0);
  if (/student|school|pupil|kid/i.test(job) || /学生|小学|中学|高中/.test(job) || agent.ageStage === "child" || agent.ageStage === "teen" || (age > 0 && age < 18)) return "student";
  if (/teacher|school/i.test(job) || /老师|教师|校工/.test(job)) return "teacher";
  if (/doctor|nurse|medical|clinic/i.test(job) || /医生|护士|医护|药房|诊所/.test(job)) return "medical";
  if (/shop|store|vendor|breakfast|restaurant|owner/i.test(job) || /店|摊|餐|小卖部|早餐/.test(job)) return "shop";
  if (/guard|police|security/i.test(job) || /保安|警/.test(job)) return "service";
  if (/worker|office|factory|staff|employee|commuter/i.test(job) || /工人|上班|职员|镇务/.test(job)) return "worker";
  if (/elder|retired/i.test(job) || /老人|退休/.test(job) || age >= 65 || agent.ageStage === "elder") return "elder";
  return "resident";
}

function block(start, end, place, title, options = {}) {
  return {
    start,
    end,
    place,
    title,
    fixed: Boolean(options.fixed),
    priority: clamp(options.priority, 1, 100, 50),
    interruptible: options.interruptible !== false,
    localAction: options.localAction || "maintain"
  };
}

function fallbackDailyPlan(world, agent = {}) {
  const home = findPlace(world, ["apartment", "home", "residence"], placeId(agent) || "apartment");
  const school = findPlace(world, ["school", "kindergarten"], home);
  const clinic = findPlace(world, ["clinic", "hospital", "medical"], home);
  const store = findPlace(world, ["store", "market", "shop", "breakfast", "restaurant"], home);
  const office = findPlace(world, ["office", "factory", "work", "warehouse"], home);
  const square = findPlace(world, ["square", "park", "plaza"], home);
  const role = inferRole(agent);

  if (role === "student") {
    return [
      block("06:30", "07:30", home, "morning routine and breakfast", { fixed: true, priority: 70, localAction: "meal" }),
      block("07:30", "08:00", school, "go to school", { fixed: true, priority: 80, localAction: "commute" }),
      block("08:00", "12:00", school, "attend class", { fixed: true, priority: 85, localAction: "study" }),
      block("12:00", "13:00", school, "lunch break", { fixed: true, priority: 75, localAction: "meal" }),
      block("13:00", "16:30", school, "afternoon class", { fixed: true, priority: 85, localAction: "study" }),
      block("16:30", "18:00", home, "return home and rest", { fixed: true, priority: 70, localAction: "commute" }),
      block("18:00", "20:30", home, "dinner and homework", { fixed: true, priority: 70, localAction: "homework" }),
      block("21:30", "06:30", home, "sleep", { fixed: true, priority: 90, localAction: "sleep", interruptible: false })
    ];
  }
  if (role === "teacher") {
    return [
      block("06:30", "07:30", home, "morning routine and breakfast", { fixed: true, priority: 65, localAction: "meal" }),
      block("07:30", "08:00", school, "go to school", { fixed: true, priority: 80, localAction: "commute" }),
      block("08:00", "12:00", school, "teach morning classes", { fixed: true, priority: 85, localAction: "work" }),
      block("12:00", "13:00", school, "lunch and brief rest", { fixed: true, priority: 70, localAction: "meal" }),
      block("13:00", "17:00", school, "teach and prepare lessons", { fixed: true, priority: 85, localAction: "work" }),
      block("17:00", "18:30", home, "return home", { fixed: true, priority: 65, localAction: "commute" }),
      block("18:30", "22:30", home, "dinner and family time", { fixed: false, priority: 55, localAction: "rest" }),
      block("23:00", "06:30", home, "sleep", { fixed: true, priority: 90, localAction: "sleep", interruptible: false })
    ];
  }
  if (role === "medical") {
    return [
      block("06:30", "07:30", home, "breakfast and prepare for shift", { fixed: true, priority: 70, localAction: "meal" }),
      block("07:30", "08:00", clinic, "go to clinic", { fixed: true, priority: 85, localAction: "commute" }),
      block("08:00", "12:00", clinic, "clinic duty", { fixed: true, priority: 90, localAction: "work" }),
      block("12:00", "13:00", clinic, "lunch during shift", { fixed: true, priority: 70, localAction: "meal" }),
      block("13:00", "18:00", clinic, "afternoon clinic duty", { fixed: true, priority: 90, localAction: "work" }),
      block("18:00", "19:00", home, "return home and dinner", { fixed: true, priority: 70, localAction: "commute" }),
      block("19:00", "22:30", home, "rest", { fixed: false, priority: 55, localAction: "rest" }),
      block("23:00", "06:30", home, "sleep", { fixed: true, priority: 90, localAction: "sleep", interruptible: false })
    ];
  }
  if (role === "shop") {
    return [
      block("05:30", "06:30", home, "early breakfast and prepare", { fixed: true, priority: 70, localAction: "meal" }),
      block("06:30", "07:00", store, "open shop", { fixed: true, priority: 85, localAction: "commute" }),
      block("07:00", "12:00", store, "serve customers", { fixed: true, priority: 85, localAction: "work" }),
      block("12:00", "13:00", store, "lunch and restock", { fixed: true, priority: 70, localAction: "meal" }),
      block("13:00", "18:30", store, "shop duty", { fixed: true, priority: 85, localAction: "work" }),
      block("18:30", "20:00", home, "return home and dinner", { fixed: true, priority: 65, localAction: "commute" }),
      block("21:30", "05:30", home, "sleep", { fixed: true, priority: 90, localAction: "sleep", interruptible: false })
    ];
  }
  if (role === "worker" || role === "service") {
    return [
      block("06:30", "07:30", home, "morning routine and breakfast", { fixed: true, priority: 70, localAction: "meal" }),
      block("07:30", "08:30", office, "go to work", { fixed: true, priority: 80, localAction: "commute" }),
      block("08:30", "12:00", office, "morning work", { fixed: true, priority: 85, localAction: "work" }),
      block("12:00", "13:00", office, "lunch break", { fixed: true, priority: 70, localAction: "meal" }),
      block("13:00", "18:00", office, "afternoon work", { fixed: true, priority: 85, localAction: "work" }),
      block("18:00", "19:00", home, "return home and dinner", { fixed: true, priority: 70, localAction: "commute" }),
      block("19:00", "22:30", home, "rest or errands", { fixed: false, priority: 50, localAction: "rest" }),
      block("23:00", "06:30", home, "sleep", { fixed: true, priority: 90, localAction: "sleep", interruptible: false })
    ];
  }
  if (role === "elder") {
    return [
      block("06:30", "08:00", home, "wake up and breakfast", { fixed: true, priority: 70, localAction: "meal" }),
      block("08:00", "10:00", square, "morning walk", { fixed: false, priority: 45, localAction: "commute" }),
      block("10:00", "12:00", home, "rest at home", { fixed: false, priority: 55, localAction: "rest" }),
      block("12:00", "13:00", home, "lunch", { fixed: true, priority: 70, localAction: "meal" }),
      block("13:00", "16:00", home, "nap and quiet activity", { fixed: false, priority: 55, localAction: "rest" }),
      block("16:00", "18:00", square, "meet neighbors", { fixed: false, priority: 45, localAction: "commute" }),
      block("18:00", "20:00", home, "dinner and evening rest", { fixed: true, priority: 70, localAction: "meal" }),
      block("21:30", "06:30", home, "sleep", { fixed: true, priority: 90, localAction: "sleep", interruptible: false })
    ];
  }
  return [
    block("07:00", "08:00", home, "morning routine and breakfast", { fixed: true, priority: 65, localAction: "meal" }),
    block("09:00", "11:30", square, "daily errands", { fixed: false, priority: 45, localAction: "commute" }),
    block("12:00", "13:00", home, "lunch", { fixed: true, priority: 70, localAction: "meal" }),
    block("14:00", "17:30", placeId(agent) || square, "ordinary afternoon", { fixed: false, priority: 40, localAction: "maintain" }),
    block("18:00", "20:00", home, "dinner and rest", { fixed: true, priority: 70, localAction: "meal" }),
    block("23:00", "07:00", home, "sleep", { fixed: true, priority: 90, localAction: "sleep", interruptible: false })
  ];
}

function normalizeDailyPlan(rawPlan, world, agent) {
  const raw = Array.isArray(rawPlan) ? rawPlan : [];
  const fallbackPlace = placeId(agent) || findPlace(world, ["apartment", "home"], "apartment");
  return raw
    .map((item, index) => {
      const start = item.start || item.time || item.from || "";
      const startMinute = hhmmToMinute(start);
      if (startMinute === null) return null;
      const end = item.end || item.to || minuteToHHMM(Math.min(1439, startMinute + 60));
      let endMinute = hhmmToMinute(end);
      if (endMinute === null) endMinute = Math.min(1439, startMinute + 60);
      const place = placeExists(world, item.place) ? item.place : fallbackPlace;
      return {
        start: minuteToHHMM(startMinute),
        end: minuteToHHMM(endMinute),
        place,
        title: String(item.title || item.summary || item.task || `plan ${index + 1}`).slice(0, 80),
        fixed: Boolean(item.fixed),
        priority: clamp(item.priority, 1, 100, item.fixed ? 75 : 50),
        interruptible: item.interruptible !== false,
        localAction: item.localAction || item.actionType || "maintain"
      };
    })
    .filter(Boolean)
    .sort((a, b) => hhmmToMinute(a.start) - hhmmToMinute(b.start))
    .slice(0, 24);
}

function ensureDailyPlans(world, options = {}) {
  const today = dayOf(world?.clock || 0);
  const refreshed = [];
  (world?.agents || []).forEach(agent => {
    if (!agent?.id || agent.lifeStatus === "dead") return;
    const existing = normalizeDailyPlan(agent.dailyPlan || [], world, agent);
    const stale = agent.dailyPlanDay !== today || existing.length < 4 || options.force;
    if (stale) {
      agent.dailyPlan = fallbackDailyPlan(world, agent);
      agent.dailyPlanDay = today;
      agent.planGeneratedAt = world.clock || 0;
      refreshed.push(agent.id);
    } else {
      agent.dailyPlan = existing;
      agent.dailyPlanDay = today;
    }
  });
  return refreshed;
}

function currentPlanItem(world, agent) {
  const plans = normalizeDailyPlan(agent?.dailyPlan || [], world, agent);
  const minute = minuteOfDay(world?.clock || 0);
  return plans.find(item => {
    const start = hhmmToMinute(item.start);
    const end = hhmmToMinute(item.end);
    if (start === null || end === null) return false;
    if (end <= start) return minute >= start || minute < end;
    return minute >= start && minute < end;
  }) || null;
}

module.exports = {
  dayOf,
  hhmmToMinute,
  minuteToHHMM,
  normalizeDailyPlan,
  fallbackDailyPlan,
  ensureDailyPlans,
  currentPlanItem,
  inferRole,
  findPlace
};

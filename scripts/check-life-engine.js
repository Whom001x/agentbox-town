"use strict";

const assert = require("node:assert/strict");
const { ensureDailyPlans, currentPlanItem } = require("../ai-town-planner");
const { detectInterruption } = require("../ai-town-interruptions");
const { runLifeEngine } = require("../ai-town-life-engine");

function worldWith(agent, clock = 8 * 60) {
  return {
    clock,
    places: [
      { id: "apartment", name: "Apartment" },
      { id: "school", name: "School" },
      { id: "clinic", name: "Clinic" },
      { id: "office", name: "Office" },
      { id: "store", name: "Store" },
      { id: "square", name: "Square" }
    ],
    agents: [agent],
    records: [],
    logs: []
  };
}

function agent(overrides = {}) {
  return {
    id: "agent_1",
    name: "Test Agent",
    job: "student",
    ageYears: 12,
    position: "apartment",
    needs: {
      hunger: 75,
      hygiene: 75,
      health: 80,
      social: 70,
      responsibility: 70,
      stress: 70,
      comfort: 70,
      safety: 80
    },
    emotionVector: {},
    memory: { short: [], long: [], emotional: [], secret: [], rumor: [] },
    ...overrides
  };
}

function testDailyPlanGenerated() {
  const a = agent();
  const world = worldWith(a, 8 * 60);
  const ids = ensureDailyPlans(world);
  assert.deepEqual(ids, ["agent_1"]);
  assert.ok(a.dailyPlan.length >= 4);
  assert.ok(currentPlanItem(world, a));
}

function testHungerInterruptionHandledLocally() {
  const a = agent({ position: "square", needs: { hunger: 8, health: 80, safety: 80 } });
  const world = worldWith(a, 10 * 60);
  const interruption = detectInterruption(world, a);
  assert.equal(interruption.type, "hunger");
  assert.equal(interruption.canOverridePlan, true);
  const result = runLifeEngine(world);
  assert.equal(result.handledIds.includes("agent_1"), true);
  assert.ok(a.movement || a.needs.hunger > 8);
}

function testModerateSafetyDoesNotOverridePlan() {
  const a = agent({ position: "apartment", needs: { hunger: 80, health: 80, safety: 32 } });
  a.dailyPlan = [{ start: "08:00", end: "09:00", place: "school", title: "attend class", fixed: true, priority: 80, localAction: "study" }];
  a.dailyPlanDay = 0;
  const world = worldWith(a, 8 * 60);
  const interruption = detectInterruption(world, a);
  assert.equal(interruption.type, "safety");
  assert.equal(interruption.canOverridePlan, false);
  const result = runLifeEngine(world);
  assert.equal(result.handledIds.includes("agent_1"), true);
  assert.equal(a.movement.to, "school");
  assert.equal(a.movement.reason, "daily_plan");
}

function testCriticalSafetyOverridesPlan() {
  const a = agent({ position: "school", needs: { hunger: 80, health: 80, safety: 18 } });
  a.dailyPlan = [{ start: "08:00", end: "09:00", place: "school", title: "attend class", fixed: true, priority: 80, localAction: "study" }];
  a.dailyPlanDay = 0;
  const world = worldWith(a, 8 * 60);
  const interruption = detectInterruption(world, a);
  assert.equal(interruption.type, "safety");
  assert.equal(interruption.canOverridePlan, true);
  const result = runLifeEngine(world);
  assert.equal(result.handledIds.includes("agent_1"), true);
  assert.notEqual(a.currentTask, "attend class");
}

function testPlanMovementHandledLocally() {
  const a = agent({ position: "apartment" });
  a.dailyPlan = [{ start: "08:00", end: "09:00", place: "school", title: "attend class", fixed: true, priority: 80, localAction: "study" }];
  a.dailyPlanDay = 0;
  const world = worldWith(a, 8 * 60);
  const result = runLifeEngine(world);
  assert.equal(result.handledIds.includes("agent_1"), true);
  assert.equal(a.movement.to, "school");
}

function testComplexPlanStaysForAi() {
  const a = agent({ position: "school" });
  a.dailyPlan = [
    { start: "06:00", end: "07:00", place: "apartment", title: "breakfast", fixed: true, priority: 60, localAction: "meal" },
    { start: "08:00", end: "09:00", place: "school", title: "talk with teacher about conflict", fixed: false, priority: 80, localAction: "talk" },
    { start: "12:00", end: "13:00", place: "school", title: "lunch", fixed: true, priority: 60, localAction: "meal" },
    { start: "18:00", end: "19:00", place: "apartment", title: "dinner", fixed: true, priority: 60, localAction: "meal" }
  ];
  a.dailyPlanDay = 0;
  const world = worldWith(a, 8 * 60);
  const result = runLifeEngine(world);
  assert.equal(result.handledIds.includes("agent_1"), false);
  assert.equal(result.aiCandidates[0].agentId, "agent_1");
}

const tests = [
  testDailyPlanGenerated,
  testHungerInterruptionHandledLocally,
  testModerateSafetyDoesNotOverridePlan,
  testCriticalSafetyOverridesPlan,
  testPlanMovementHandledLocally,
  testComplexPlanStaysForAi
];

for (const test of tests) {
  test();
  console.log(`PASS ${test.name}`);
}

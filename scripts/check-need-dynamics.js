"use strict";

const assert = require("node:assert/strict");
const { nodeStepPayload } = require("../ai-town-node-core");
const {
  activityDelta,
  averageNeeds,
  computeNeedDynamics,
  needSafeguard
} = require("../ai-town-need-dynamics");

function needs(overrides = {}) {
  return {
    hunger: 76,
    hygiene: 76,
    health: 82,
    social: 68,
    responsibility: 68,
    stress: 74,
    comfort: 76,
    safety: 84,
    ...overrides
  };
}

function agent(id, overrides = {}) {
  return {
    id,
    name: overrides.name || id,
    ageStage: overrides.ageStage || "adult",
    age: overrides.age || 35,
    job: overrides.job || "resident",
    position: overrides.position || "apartment",
    place: overrides.place || overrides.position || "apartment",
    cognitiveProfile: overrides.cognitiveProfile || {
      socialDrive: 0.45,
      routinePreference: 0.55,
      conflictAvoidance: 0.5,
      riskTolerance: 0.45,
      patience: 0.55,
      ambition: 0.45
    },
    needs: needs(overrides.needs),
    emotionVector: {},
    memory: { short: [], long: [], emotional: [], secret: [], rumor: [] },
    lifeStatus: "alive",
    ...overrides
  };
}

function world(agents, clock = 8 * 60) {
  return {
    clock,
    config: { virtualMinutesPerPulse: 30 },
    places: [
      { id: "apartment", name: "Apartment" },
      { id: "clinic", name: "Clinic" },
      { id: "school", name: "School" },
      { id: "office", name: "Office" },
      { id: "store", name: "Store" },
      { id: "square", name: "Square" },
      { id: "park", name: "Park" }
    ],
    agents,
    records: [],
    logs: []
  };
}

function step(input, minutes = 30) {
  return nodeStepPayload({ world: input }, { minutes }).payload.world;
}

function aliveAgents(state) {
  return state.agents.filter(item => item.lifeStatus !== "dead");
}

function testSafeguardSlowsLowValueDecay() {
  assert.equal(needSafeguard(30, 30), 1);
  assert.ok(needSafeguard(15, 30) < 1);
  assert.ok(needSafeguard(5, 30) < needSafeguard(15, 30));
  assert.ok(needSafeguard(5, 30) > 0);
}

function testDynamicActivityRecoveryUsesMissingValue() {
  const hungry = agent("hungry", { needs: { hunger: 20 } });
  const almostFull = agent("full", { needs: { hunger: 80 } });
  const hungryDelta = activityDelta(hungry, "meal");
  const fullDelta = activityDelta(almostFull, "meal");
  assert.ok(hungryDelta.hunger > fullDelta.hunger, "lower hunger should recover more from the same meal");
  assert.ok(fullDelta.hunger < 10, "high hunger should not receive a large fixed refill");
}

function testEmergencyFlagsAreNarrow() {
  const state = computeNeedDynamics(world([]), agent("a", { needs: { hunger: 15, health: 25, safety: 25 } }), { minutes: 30 });
  assert.equal(state.hasEmergency, false, "moderate low needs should not force emergency mode");
  const emergency = computeNeedDynamics(world([]), agent("b", { needs: { hunger: 8, health: 25, safety: 25 } }), { minutes: 30 });
  assert.equal(emergency.needEmergencyFlag.hunger, true);
  assert.equal(emergency.hasEmergency, true);
}

function buildPopulation(count = 50) {
  const agents = [
    agent("doctor_1", { job: "doctor", position: "clinic", place: "clinic", needs: { health: 86 } }),
    agent("nurse_1", { job: "nurse", position: "clinic", place: "clinic", needs: { health: 84 } })
  ];
  for (let i = agents.length; i < count; i += 1) {
    const stage = i % 10 === 0 ? "elder" : i % 8 === 0 ? "child" : i % 6 === 0 ? "teen" : "adult";
    const age = stage === "elder" ? 72 : stage === "child" ? 9 : stage === "teen" ? 16 : 34;
    const position = i % 7 === 0 ? "school" : i % 5 === 0 ? "office" : "apartment";
    agents.push(agent(`resident_${i}`, {
      ageStage: stage,
      age,
      job: stage === "child" ? "student" : stage === "elder" ? "retired elder" : "resident",
      position,
      place: position,
      needs: {
        hunger: 58 + (i % 20),
        hygiene: 58 + (i % 18),
        health: stage === "elder" ? 62 : 70 + (i % 14),
        social: 50 + (i % 25),
        responsibility: 48 + (i % 30),
        stress: 58 + (i % 20),
        comfort: 60 + (i % 16),
        safety: stage === "child" ? 62 : 72
      }
    }));
  }
  return agents;
}

function testLongRunNeedStability() {
  let state = world(buildPopulation(), 6 * 60);
  for (let i = 0; i < 200; i += 1) state = step(state, 30);
  const alive = aliveAgents(state);
  const avg = averageNeeds(alive);
  assert.equal(alive.length, 50, "death count should remain zero");
  assert.ok(avg.health >= 60 && avg.health <= 90, `health average out of range: ${avg.health}`);
  for (const [key, value] of Object.entries(avg)) {
    assert.ok(value >= 40 && value <= 90, `${key} average out of range: ${value}`);
  }
  assert.ok(state.needDynamicsState, "world should expose NeedDynamicsState");
  assert.equal(typeof state.needDynamicsState.emergencyCount, "number");
}

const tests = [
  testSafeguardSlowsLowValueDecay,
  testDynamicActivityRecoveryUsesMissingValue,
  testEmergencyFlagsAreNarrow,
  testLongRunNeedStability
];

for (const test of tests) {
  test();
  console.log(`PASS ${test.name}`);
}

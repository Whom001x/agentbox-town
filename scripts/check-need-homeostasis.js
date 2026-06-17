"use strict";

const assert = require("node:assert/strict");
const { nodeStepPayload } = require("../ai-town-node-core");
const {
  averageNeeds,
  computeNeedDynamics,
  needHomeostasisFactor
} = require("../ai-town-need-dynamics");

function needs(overrides = {}) {
  return {
    hunger: 74,
    hygiene: 72,
    health: 78,
    social: 66,
    responsibility: 66,
    stress: 72,
    comfort: 72,
    safety: 78,
    ...overrides
  };
}

function agent(id, overrides = {}) {
  return {
    id,
    name: overrides.name || id,
    ageStage: overrides.ageStage || "adult",
    age: overrides.age || 36,
    job: overrides.job || "resident",
    position: overrides.position || "apartment",
    place: overrides.place || overrides.position || "apartment",
    cognitiveProfile: {
      socialDrive: 0.45,
      routinePreference: 0.55,
      conflictAvoidance: 0.5,
      riskTolerance: 0.45,
      patience: 0.55,
      ambition: 0.45,
      ...(overrides.cognitiveProfile || {})
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

function alive(state) {
  return state.agents.filter(item => item.lifeStatus !== "dead");
}

function buildPopulation(count = 50) {
  const agents = [
    agent("doctor_1", { job: "doctor", position: "clinic", place: "clinic", needs: { health: 82, comfort: 74 } }),
    agent("nurse_1", { job: "nurse", position: "clinic", place: "clinic", needs: { health: 80, comfort: 72 } })
  ];
  for (let i = agents.length; i < count; i += 1) {
    const stage = i % 10 === 0 ? "elder" : i % 8 === 0 ? "child" : i % 6 === 0 ? "teen" : "adult";
    const position = i % 7 === 0 ? "school" : i % 5 === 0 ? "office" : "apartment";
    agents.push(agent(`resident_${i}`, {
      ageStage: stage,
      age: stage === "elder" ? 72 : stage === "child" ? 9 : stage === "teen" ? 16 : 34,
      job: stage === "child" ? "student" : stage === "elder" ? "retired elder" : "resident",
      position,
      place: position,
      needs: {
        hunger: 58 + (i % 18),
        hygiene: 55 + (i % 20),
        health: stage === "elder" ? 60 : 66 + (i % 18),
        social: 48 + (i % 25),
        responsibility: 48 + (i % 30),
        stress: 58 + (i % 20),
        comfort: 58 + (i % 22),
        safety: stage === "child" ? 62 : 70
      }
    }));
  }
  return agents;
}

function testCurveValues() {
  assert.equal(needHomeostasisFactor(0, "health"), 1);
  assert.ok(Math.abs(needHomeostasisFactor(50, "health") - 0.75) < 0.001);
  assert.ok(needHomeostasisFactor(95, "health") < 0.1);
  assert.equal(needHomeostasisFactor(95, "hunger"), 1, "hunger should not use the natural recovery curve");
}

function testLowHealthRecoversFasterThanHighHealth() {
  const low = agent("low", { needs: { health: 20 }, energy: 70 });
  const high = agent("high", { needs: { health: 90 }, energy: 70 });
  const lowState = computeNeedDynamics(world([low]), low, { minutes: 60 });
  const highState = computeNeedDynamics(world([high]), high, { minutes: 60 });
  assert.ok(
    lowState.components.health.effectiveRecovery > highState.components.health.effectiveRecovery,
    "low health should receive stronger natural recovery than high health"
  );
  assert.ok(
    highState.components.health.maintenanceCost > 0,
    "health over 80 should pay a small maintenance cost"
  );
}

function testHighHealthDoesNotKeepRisingFor24h() {
  let state = world([agent("healthy", { needs: { health: 95, comfort: 88 }, energy: 80 })], 8 * 60);
  for (let i = 0; i < 24; i += 1) state = step(state, 60);
  const health = Number(state.agents[0].needs.health);
  assert.ok(health <= 95, `high health should not rise above starting value, got ${health}`);
  assert.ok(state.needHomeostasisState, "world should expose needHomeostasisState");
}

function testPopulationHomeostasis() {
  let state = world(buildPopulation(), 6 * 60);
  for (let i = 0; i < 200; i += 1) state = step(state, 30);
  const avg = averageNeeds(alive(state));
  assert.equal(alive(state).length, 50, "death count should remain zero");
  assert.ok(avg.health >= 70 && avg.health <= 90, `health average out of range: ${avg.health}`);
  assert.ok(avg.comfort >= 60 && avg.comfort <= 90, `comfort average out of range: ${avg.comfort}`);
  assert.equal(state.needDynamicsState.emergencyCount, 0, "emergencyCount should remain zero");
  assert.equal(state.needHomeostasisState.agentStates.length, 50, "homeostasis state should include every alive agent");
  assert.ok(state.needHomeostasisState.agentStates[0].homeostasis.health.effectiveRecovery >= 0);
}

const tests = [
  testCurveValues,
  testLowHealthRecoversFasterThanHighHealth,
  testHighHealthDoesNotKeepRisingFor24h,
  testPopulationHomeostasis
];

for (const test of tests) {
  test();
  console.log(`PASS ${test.name}`);
}

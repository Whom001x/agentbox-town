"use strict";

const assert = require("node:assert/strict");
const { nodeStepPayload } = require("../ai-town-node-core");

function baseAgent(overrides = {}) {
  return {
    id: overrides.id || "agent-1",
    name: overrides.name || "Test Agent",
    age: 35,
    ageStage: "adult",
    job: "worker",
    position: "warehouse",
    needs: {
      hunger: 72,
      hygiene: 78,
      health: 82,
      social: 68,
      responsibility: 62,
      stress: 72,
      comfort: 76,
      safety: 82,
      ...(overrides.needs || {})
    },
    emotionVector: {
      happy: 45,
      anxious: 25,
      angry: 10,
      sad: 15,
      tired: 25,
      lonely: 20,
      hopeful: 45,
      calm: 45,
      curious: 30
    },
    medicalState: { knownBy: [], undiscoveredMinutes: 0, ...(overrides.medicalState || {}) },
    ...overrides
  };
}

function baseWorld(agents, overrides = {}) {
  return {
    clock: overrides.clock ?? 600,
    config: { virtualMinutesPerPulse: overrides.minutes ?? 60 },
    agents,
    places: [
      { id: "warehouse", name: "Warehouse" },
      { id: "clinic", name: "Clinic" }
    ],
    records: [],
    logs: [],
    basicLifeDone: {},
    ...overrides
  };
}

function step(world, minutes = 60) {
  return nodeStepPayload({ world }, { minutes }).payload.world;
}

function runFor(world, totalMinutes, stepMinutes = 60) {
  let current = world;
  for (let elapsed = 0; elapsed < totalMinutes; elapsed += stepMinutes) {
    current = step(current, Math.min(stepMinutes, totalMinutes - elapsed));
  }
  return current;
}

function testHealthyAdultDoesNotDieInOneDayWithoutFood() {
  const agent = baseAgent({ needs: { hunger: 5 }, position: "warehouse" });
  const world = runFor(baseWorld([agent], { clock: 600 }), 1440, 60);
  assert.notEqual(world.agents[0].lifeStatus, "dead");
}

function testLongHungerEntersRiskButDoesNotInstantlyKill() {
  const agent = baseAgent({
    needs: { hunger: 0, health: 50 },
    position: "park",
    medicalState: { knownBy: [], undiscoveredMinutes: 720 }
  });
  const world = runFor(baseWorld([agent], { clock: 600 }), 1440, 60);
  assert.notEqual(world.agents[0].lifeStatus, "dead");
  assert.ok(world.agents[0].needs.hunger > 0 || world.agents[0].movement?.reason === "hunger_return_home");
}

function testSafetyZeroCanKillWithinHoursWhenUndiscovered() {
  const agent = baseAgent({
    needs: { safety: 0, health: 50 },
    medicalState: { knownBy: [], undiscoveredMinutes: 60 }
  });
  const world = runFor(baseWorld([agent], { clock: 600 }), 180, 60);
  assert.equal(world.agents[0].lifeStatus, "dead");
  assert.equal(world.agents[0].deathCause, "safety_zero_unrescued");
}

function testClinicWithMedicalWorkerTreatsLowHealth() {
  const patient = baseAgent({
    id: "patient",
    name: "Patient",
    position: "clinic",
    needs: { health: 0, hunger: 40 },
    medicalState: { knownBy: [], undiscoveredMinutes: 0 }
  });
  const doctor = baseAgent({
    id: "doctor",
    name: "Doctor",
    job: "doctor",
    position: "clinic"
  });
  const world = step(baseWorld([patient, doctor], { clock: 600 }), 60);
  const updated = world.agents.find(agent => agent.id === "patient");
  assert.notEqual(updated.lifeStatus, "dead");
  assert.ok(updated.needs.health > 0);
}

function testSleepingAgentDoesNotKeepOrdinaryMovementAfterDeath() {
  const agent = baseAgent({
    needs: { safety: 0 },
    medicalState: { knownBy: [], undiscoveredMinutes: 60 },
    movement: { from: "warehouse", to: "clinic", arriveAt: 10000 }
  });
  const world = runFor(baseWorld([agent], { clock: 600 }), 180, 60);
  assert.equal(world.agents[0].lifeStatus, "dead");
  assert.equal(world.agents[0].movement, null);
}

function testStressZeroDoesNotCauseCriticalOrDeath() {
  const agent = baseAgent({
    needs: { stress: 0, health: 80, hunger: 80, safety: 80 },
    medicalState: { knownBy: [], undiscoveredMinutes: 1440 }
  });
  const world = runFor(baseWorld([agent], { clock: 600 }), 1440, 60);
  assert.notEqual(world.agents[0].lifeStatus, "critical");
  assert.notEqual(world.agents[0].lifeStatus, "dead");
}

function testLowHungerOutsideFoodStartsReturnHome() {
  const agent = baseAgent({
    position: "park",
    needs: { hunger: 18, health: 80, safety: 80 }
  });
  const world = step(baseWorld([agent], { clock: 600 }), 60);
  assert.equal(world.agents[0].movement?.to, "apartment");
  assert.equal(world.agents[0].movement?.reason, "hunger_return_home");
}

function testHealthRecoversWhenFedStableAndSafe() {
  const agent = baseAgent({
    position: "apartment",
    needs: { hunger: 80, stress: 80, safety: 80, health: 50 }
  });
  const world = runFor(baseWorld([agent], { clock: 600 }), 240, 60);
  assert.ok(world.agents[0].needs.health > 50);
}

function testMovementArrivalSyncsPositionAndPlace() {
  const agent = baseAgent({
    position: "warehouse",
    place: "warehouse",
    movement: {
      from: "warehouse",
      to: "clinic",
      departAt: 600,
      arriveAt: 630,
      reason: "medical_visit"
    }
  });
  const world = step(baseWorld([agent], { clock: 600 }), 60);
  assert.equal(world.agents[0].position, "clinic");
  assert.equal(world.agents[0].place, "clinic");
  assert.equal(world.agents[0].movement, null);
}

const tests = [
  testHealthyAdultDoesNotDieInOneDayWithoutFood,
  testLongHungerEntersRiskButDoesNotInstantlyKill,
  testSafetyZeroCanKillWithinHoursWhenUndiscovered,
  testClinicWithMedicalWorkerTreatsLowHealth,
  testSleepingAgentDoesNotKeepOrdinaryMovementAfterDeath,
  testStressZeroDoesNotCauseCriticalOrDeath,
  testLowHungerOutsideFoodStartsReturnHome,
  testHealthRecoversWhenFedStableAndSafe,
  testMovementArrivalSyncsPositionAndPlace
];

for (const test of tests) {
  test();
  console.log(`PASS ${test.name}`);
}

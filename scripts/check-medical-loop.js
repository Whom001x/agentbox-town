"use strict";

const assert = require("node:assert/strict");
const { nodeStepPayload } = require("../ai-town-node-core");

function needs(overrides = {}) {
  return {
    hunger: 80,
    hygiene: 75,
    health: 80,
    social: 70,
    responsibility: 70,
    stress: 75,
    comfort: 75,
    safety: 80,
    ...overrides
  };
}

function agent(id, overrides = {}) {
  return {
    id,
    name: overrides.name || id,
    ageStage: overrides.ageStage || "adult",
    age: overrides.age || 35,
    job: overrides.job || "居民",
    position: overrides.position || "apartment",
    place: overrides.place || overrides.position || "apartment",
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
    config: { virtualMinutesPerPulse: 60 },
    places: [
      { id: "apartment", name: "居民楼" },
      { id: "clinic", name: "诊所" }
    ],
    agents,
    records: [],
    logs: []
  };
}

function step(input, minutes = 60) {
  return nodeStepPayload({ world: input }, { minutes }).payload.world;
}

function healthOf(worldState, id) {
  return Number(worldState.agents.find(item => item.id === id).needs.health);
}

function testPoorPatientGetsTreatment() {
  const patient = agent("patient", { position: "clinic", place: "clinic", needs: { health: 25 } });
  const doctor = agent("doctor", { job: "医护人员", position: "apartment", place: "apartment" });
  const after = step(world([patient, doctor], 8 * 60));
  const treated = after.agents.find(item => item.id === "patient");
  assert.ok(healthOf(after, "patient") > 25, "poor patient should recover in clinic");
  assert.ok(Number(treated.medicalState?.treatedAt || 0) > 0, "treatedAt should be written");
  assert.ok(Number(after.clinicRuntime?.staffAvailable || 0) >= 1, "doctor duty should make staff available");
  assert.ok(Object.keys(after.basicLifeDone || {}).some(key => key.startsWith("medical-care-")), "medical-care key should be recorded");
}

function testCriticalPatientGetsLargeTreatmentEffect() {
  const patient = agent("patient", { position: "clinic", place: "clinic", needs: { health: 10 } });
  const doctor = agent("doctor", { job: "医生", position: "clinic", place: "clinic" });
  const after = step(world([patient, doctor], 10 * 60));
  assert.ok(healthOf(after, "patient") >= 25, "critical treatment should add at least about 15 health");
  assert.ok(after.agents.find(item => item.id === "patient").medicalState?.recoveryTimeline, "recovery timeline should be scheduled");
}

function testSleepRestRecoveryIsSmall() {
  const sleeper = agent("sleeper", { position: "apartment", place: "apartment", needs: { health: 50 }, sleepWindow: { start: "23:00", end: "06:30" } });
  const after = step(world([sleeper], 23 * 60));
  const delta = healthOf(after, "sleeper") - 50;
  assert.ok(delta > 0, "sleep should restore a small amount of health");
  assert.ok(delta < 2, "sleep should not massively restore health in one tick");
}

function testHundredTickStability() {
  const agents = [
    agent("doctor_1", { job: "医护人员", position: "apartment", place: "apartment" }),
    agent("doctor_2", { job: "护士", position: "apartment", place: "apartment" })
  ];
  for (let i = 0; i < 6; i += 1) {
    agents.push(agent(`patient_${i}`, { position: "clinic", place: "clinic", ageStage: i % 2 ? "elder" : "adult", age: i % 2 ? 72 : 38, needs: { health: 22 + i } }));
  }
  for (let i = agents.length; i < 50; i += 1) {
    agents.push(agent(`resident_${i}`, { position: "apartment", place: "apartment", needs: { health: 80 } }));
  }
  let state = world(agents, 8 * 60);
  for (let i = 0; i < 100; i += 1) state = step(state);
  const alive = state.agents.filter(item => item.lifeStatus !== "dead");
  const lowHealth = alive.filter(item => Number(item.needs?.health ?? 100) < 20);
  const clinicPopulation = alive.filter(item => (item.position || item.place) === "clinic").length;
  const careCount = Object.keys(state.basicLifeDone || {}).filter(key => key.startsWith("medical-care-")).length;
  const treatedCount = alive.filter(item => Number(item.medicalState?.treatedAt || 0) > 0).length;
  assert.equal(lowHealth.length, 0, "health <20 should be zero after stability run");
  assert.ok(clinicPopulation / alive.length < 0.2, "clinic population should remain below 20%");
  assert.ok(careCount > 0, "medicalCareCount should grow");
  assert.ok(treatedCount > 0, "treatedAt should be written on treated agents");
}

const tests = [
  testPoorPatientGetsTreatment,
  testCriticalPatientGetsLargeTreatmentEffect,
  testSleepRestRecoveryIsSmall,
  testHundredTickStability
];

for (const test of tests) {
  test();
  console.log(`PASS ${test.name}`);
}

"use strict";

const assert = require("node:assert/strict");
const { nodeStepPayload } = require("../ai-town-node-core");
const {
  activityDelta,
  averageNeeds,
  computeNeedDynamics
} = require("../ai-town-need-dynamics");

function baseNeeds(overrides = {}) {
  return {
    hunger: 68,
    hygiene: 70,
    health: 68,
    social: 64,
    responsibility: 64,
    stress: 70,
    comfort: 72,
    safety: 68,
    ...overrides
  };
}

function agent(id, ageStage, overrides = {}) {
  const age = ageStage === "child" ? 9 : ageStage === "teen" ? 16 : ageStage === "elder" ? 73 : 36;
  return {
    id,
    name: id,
    ageStage,
    age,
    job: ageStage === "child" || ageStage === "teen" ? "student" : ageStage === "elder" ? "retired elder" : "resident",
    position: overrides.position || "apartment",
    place: overrides.place || overrides.position || "apartment",
    cognitiveProfile: {
      socialDrive: ageStage === "child" ? 0.65 : 0.45,
      routinePreference: ageStage === "elder" ? 0.75 : 0.5,
      conflictAvoidance: ageStage === "elder" ? 0.68 : 0.5,
      riskTolerance: ageStage === "child" ? 0.35 : 0.5,
      patience: ageStage === "elder" ? 0.6 : 0.5,
      ambition: 0.4
    },
    needs: baseNeeds(overrides.needs),
    emotionVector: {},
    memory: { short: [], long: [], emotional: [], secret: [], rumor: [] },
    lifeStatus: "alive",
    ...overrides
  };
}

function world(agents, clock = 10 * 60) {
  return {
    clock,
    config: { virtualMinutesPerPulse: 30 },
    places: [
      { id: "apartment", name: "Apartment" },
      { id: "school", name: "School" },
      { id: "office", name: "Office" },
      { id: "clinic", name: "Clinic" },
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

function testAgeDoesNotAmplifyBaseDecay() {
  const adult = agent("adult", "adult", { needs: { safety: 35 } });
  const elder = agent("elder", "elder", { needs: { safety: 35 } });
  const adultState = computeNeedDynamics(world([adult]), adult, { minutes: 60, danger: true });
  const elderState = computeNeedDynamics(world([elder]), elder, { minutes: 60, danger: true });
  assert.ok(
    elderState.components.safety.safeguard < adultState.components.safety.safeguard,
    "elder should get threshold protection instead of raw decay amplification"
  );
  assert.ok(
    Math.abs(elderState.components.safety.baseDecay - adultState.components.safety.baseDecay) < 0.001,
    "age stage must not multiply base decay directly"
  );
}

function testActivityRecoveryUsesLifeStage() {
  const child = agent("child", "child", { needs: { hunger: 30 } });
  const adult = agent("adult", "adult", { needs: { hunger: 30 } });
  const elder = agent("elder", "elder", { needs: { hunger: 30 } });
  assert.ok(activityDelta(child, "meal").hunger > activityDelta(adult, "meal").hunger);
  assert.ok(activityDelta(elder, "meal").hunger < activityDelta(adult, "meal").hunger);
}

function testElderGroupDoesNotCollapse() {
  const agents = [
    agent("doctor", "adult", { job: "doctor", position: "clinic", place: "clinic", needs: { health: 82 } })
  ];
  for (let i = 0; i < 12; i += 1) {
    agents.push(agent(`elder_${i}`, "elder", {
      needs: {
        hunger: 56 + (i % 8),
        hygiene: 58 + (i % 8),
        health: 50 + (i % 12),
        social: 52 + (i % 10),
        responsibility: 54,
        stress: 58 + (i % 8),
        comfort: 60,
        safety: 62
      }
    }));
  }
  let state = world(agents, 7 * 60);
  for (let i = 0; i < 500; i += 1) state = step(state, 30);
  const elders = state.agents.filter(item => item.ageStage === "elder" && item.lifeStatus !== "dead");
  assert.equal(elders.length, 12, "elder group should not die in stability test");
  const collapsed = elders.filter(item => Number(item.needs?.health ?? 0) < 30 || Number(item.needs?.safety ?? 0) < 30);
  assert.equal(collapsed.length, 0, "elder group should not all drift into low survival state");
  const avg = averageNeeds(elders);
  assert.ok(avg.health >= 45, `elder health average too low: ${avg.health}`);
}

const tests = [
  testAgeDoesNotAmplifyBaseDecay,
  testActivityRecoveryUsesLifeStage,
  testElderGroupDoesNotCollapse
];

for (const test of tests) {
  test();
  console.log(`PASS ${test.name}`);
}

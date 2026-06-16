"use strict";

const assert = require("node:assert/strict");
const { recordLifeEvent } = require("../ai-town-memory-stream");
const {
  personalityRuntime,
  personalityRuntimeBias
} = require("../ai-town-personality-runtime");
const { utilityDecision } = require("../ai-town-utility-scheduler");

function agent(overrides = {}) {
  return {
    id: "agent_1",
    name: "Qian Fangyi",
    job: "doctor",
    ageYears: 34,
    position: "clinic",
    needs: {
      hunger: 80,
      hygiene: 80,
      health: 32,
      social: 42,
      responsibility: 45,
      stress: 55,
      comfort: 65,
      safety: 78,
      ...(overrides.needs || {})
    },
    emotionVector: {
      happy: 42,
      anxious: 64,
      angry: 10,
      sad: 15,
      tired: 68,
      lonely: 58,
      hopeful: 45,
      ...(overrides.emotionVector || {})
    },
    identityCore: {
      identity: "a reliable but introvert doctor",
      values: ["responsibility", "health"],
      fears: ["losing stable life"]
    },
    personalityProfile: {
      identity: "introvert, cautious, reliable"
    },
    selfModel: {
      identity: "I am reliable",
      values: ["responsibility", "health"],
      fears: ["risk"],
      selfBeliefs: ["I keep promises"],
      currentSelfView: "I try to keep work stable",
      selfConsistencyWeight: 0.9
    },
    longTermGoals: [
      { title: "Keep health stable enough to work", priority: 8, progress: 20, blockedBy: ["health"] }
    ],
    relationshipMatrix: {
      agent_2: { trust: 72, intimacy: 50, dependency: 35, resentment: 0 }
    },
    memory: { short: [], long: [], emotional: [], secret: [], rumor: [] },
    ...overrides
  };
}

function world(a, clock = 900) {
  return {
    clock,
    config: { vectorMemoryEnabled: true, vectorMaxRecall: 6 },
    places: [{ id: "clinic" }, { id: "apartment" }, { id: "office" }],
    agents: [a],
    eventLog: []
  };
}

function testRuntimeShapeAndRanges() {
  const a = agent();
  const w = world(a);
  recordLifeEvent(w, a, {
    type: "health_rest",
    interruption: { type: "health", priority: 96, canOverridePlan: true, reason: "health critical" },
    summary: "Qian Fangyi stopped work because health affected her shift."
  });
  const runtime = personalityRuntime(w, a);
  assert.equal(runtime.source, "personality-runtime-v2.5.1");
  assert.ok(runtime.actionBias.seek_care > 0);
  assert.ok(runtime.actionBias.rest > 0);
  assert.ok(runtime.socialDrive >= 0 && runtime.socialDrive <= 1);
  assert.ok(runtime.riskTolerance >= 0 && runtime.riskTolerance <= 1);
  assert.ok(runtime.responsibilityDrive >= 0 && runtime.responsibilityDrive <= 1);
}

function testRuntimeBiasAffectsActions() {
  const a = agent({ needs: { health: 80, responsibility: 40 } });
  const w = world(a);
  const runtime = personalityRuntime(w, a);
  const follow = personalityRuntimeBias(runtime, { id: "follow_plan", tags: ["responsibility"], risk: 0 });
  const walk = personalityRuntimeBias(runtime, { id: "walk_nearby", tags: ["walk"], risk: 4 });
  assert.ok(follow > walk);
}

function testUtilityExposesTraceAndDebugDecision() {
  const a = agent();
  const w = world(a);
  const decision = utilityDecision(w, a);
  assert.ok(decision.personalityRuntime);
  assert.ok(decision.decisionTrace);
  assert.ok(decision.debugDecision);
  assert.equal(decision.decisionTrace.chosenAction, decision.selectedAction.id);
  assert.equal(typeof decision.decisionTrace.scoreBreakdown.personality, "number");
  assert.equal(a.debugDecision.action, decision.selectedAction.id);
}

[
  testRuntimeShapeAndRanges,
  testRuntimeBiasAffectsActions,
  testUtilityExposesTraceAndDebugDecision
].forEach(test => {
  test();
  console.log(`PASS ${test.name}`);
});

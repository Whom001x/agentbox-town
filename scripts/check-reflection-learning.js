"use strict";

const assert = require("node:assert/strict");
const {
  predictionErrorEngine,
  recordLifeEvent,
  reflectionImportanceForEvent,
  runDailyReflection
} = require("../ai-town-memory-stream");

function agent(overrides = {}) {
  return {
    id: "agent_reflect",
    name: "Reflection Tester",
    position: "apartment",
    needs: { hunger: 80, hygiene: 80, health: 80, social: 60, responsibility: 60, stress: 40, comfort: 70, safety: 80 },
    emotionVector: { lonely: 60, stress: 45, calm: 35, happy: 35 },
    cognitiveProfile: {
      curiosity: 0.5,
      empathy: 0.5,
      socialDrive: 0.5,
      ambition: 0.5,
      routinePreference: 0.5,
      patience: 0.5
    },
    memory: { short: [], long: [], emotional: [], secret: [], rumor: [] },
    relationshipMatrix: {
      friend: { trust: 70, intimacy: 60, familiarity: 80 }
    },
    ...overrides
  };
}

function world(a, clock = 1440) {
  return {
    clock,
    config: {
      reflectionLearning: {
        cooldown: 100,
        importanceThreshold: 0.6,
        predictionErrorThreshold: 0.7,
        earlyPredictionErrorThreshold: 0.8,
        emotionDeltaThreshold: 0.35
      }
    },
    agents: [a, { id: "friend", name: "Friend", position: "apartment", needs: {}, emotionVector: {} }],
    places: [{ id: "apartment" }],
    eventLog: []
  };
}

function failedContactEvent(id = "failed_contact") {
  return {
    id,
    type: "contact_familiar",
    summary: "contacted a familiar friend but was rejected",
    targetAgentId: "friend",
    expectedOutcome: "response",
    expectedProbability: 0.8,
    actualOutcome: "rejected",
    expectedEmotionVector: { lonely: 30, stress: 35, calm: 60, happy: 55 },
    actualEmotionVector: { lonely: 85, stress: 70, calm: 20, happy: 15 },
    emotionDelta: { lonely: 32, stress: 22, calm: -18 },
    relationshipDelta: { trust: -0.22, intimacy: -0.12 },
    goalImpact: 45,
    contextScope: "direct"
  };
}

function testRoutineDoesNotTriggerLlmReflection() {
  const a = agent();
  const w = world(a);
  const result = recordLifeEvent(w, a, {
    id: "routine_meal",
    type: "plan_meal",
    plan: { title: "meal", localAction: "meal" },
    summary: "ordinary meal"
  });
  assert.equal(result.event.predictionErrorDetail.llmReflectionEligible, false);
  runDailyReflection(w, { force: true });
  assert.equal((a.reflectionMemory || []).length, 0);
}

function testPredictionFailureProducesError() {
  const a = agent();
  const w = world(a);
  const result = recordLifeEvent(w, a, failedContactEvent());
  assert.ok(result.event.predictionError > 0.7);
  assert.equal(result.event.predictionErrorDetail.layer, "rule");
  assert.equal(a.expectationMemory[0].eventType, "contact_familiar");
}

function testHighErrorChangesBelief() {
  const a = agent();
  const w = world(a);
  recordLifeEvent(w, a, failedContactEvent());
  runDailyReflection(w, { force: true });
  assert.equal(a.reflectionMemory.length, 1);
  assert.match(a.reflectionMemory[0].beliefChange, /重新评估|判断/);
  assert.ok(a.beliefMemory.some(item => /重新评估|判断/.test(item.belief)));
  assert.ok(Math.abs(a.decisionBias.contact_familiar) > 0);
}

function testWrongBeliefCanDecay() {
  const a = agent();
  const w = world(a);
  recordLifeEvent(w, a, failedContactEvent());
  runDailyReflection(w, { force: true });
  const beforeConfidence = a.beliefValidation.contact_familiar.confidence;
  const beforeBias = Math.abs(a.decisionBias.contact_familiar);
  w.clock += 200;
  recordLifeEvent(w, a, {
    id: "successful_contact",
    type: "contact_familiar",
    summary: "contacted a familiar friend and received a warm response",
    targetAgentId: "friend",
    expectedOutcome: "response",
    expectedProbability: 0.8,
    actualOutcome: "responded",
    emotionDelta: { lonely: -18, calm: 16, happy: 12 },
    relationshipDelta: { trust: 0.16 },
    goalImpact: 35,
    contextScope: "direct"
  });
  assert.ok(a.beliefValidation.contact_familiar.confidence < beforeConfidence);
  assert.ok(Math.abs(a.decisionBias.contact_familiar) < beforeBias);
}

function testPersonalityChangesImportanceWeights() {
  const social = agent({
    cognitiveProfile: { curiosity: 0.4, empathy: 0.9, socialDrive: 0.95, ambition: 0.4, routinePreference: 0.3, patience: 0.4 }
  });
  const rational = agent({
    cognitiveProfile: { curiosity: 0.4, empathy: 0.2, socialDrive: 0.2, ambition: 0.4, routinePreference: 0.95, patience: 0.9 }
  });
  const event = {
    id: "same_event",
    clock: 1440,
    type: "contact_familiar",
    actionType: "contact_familiar",
    category: "exception",
    targetAgentId: "friend",
    summary: "friend rejected a request",
    emotionDelta: { lonely: 18 },
    relationshipDelta: { trust: -0.24 },
    goalImpact: 25,
    abnormality: 60,
    emotionalIntensity: 45,
    futureImpact: 40,
    expectedOutcome: "response",
    expectedProbability: 0.8,
    actualOutcome: "rejected"
  };
  const socialPrediction = predictionErrorEngine(world(social), social, { ...event });
  const rationalPrediction = predictionErrorEngine(world(rational), rational, { ...event });
  const socialImportance = reflectionImportanceForEvent(world(social), social, event, socialPrediction);
  const rationalImportance = reflectionImportanceForEvent(world(rational), rational, event, rationalPrediction);
  assert.notEqual(socialImportance.importance, rationalImportance.importance);
  assert.ok(socialImportance.weights.relationship > rationalImportance.weights.relationship);
  assert.ok(rationalImportance.weights.prediction > socialImportance.weights.prediction);
}

[
  testRoutineDoesNotTriggerLlmReflection,
  testPredictionFailureProducesError,
  testHighErrorChangesBelief,
  testWrongBeliefCanDecay,
  testPersonalityChangesImportanceWeights
].forEach(test => {
  test();
  console.log(`PASS ${test.name}`);
});

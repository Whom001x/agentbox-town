"use strict";

const assert = require("node:assert/strict");
const { recordLifeEvent } = require("../ai-town-memory-stream");
const {
  temporalCausalStrength,
  updateTemporalCausalMemory,
  causalMemoryInfluence,
  causalBiasForAction
} = require("../ai-town-temporal-causal");
const { cognitiveState } = require("../ai-town-cognitive-state");
const { utilityDecision } = require("../ai-town-utility-scheduler");

function baseAgent(overrides = {}) {
  return {
    id: "agent_tc",
    name: "Temporal Tester",
    job: "office worker",
    ageYears: 34,
    position: "office",
    needs: {
      hunger: 76,
      hygiene: 78,
      health: 78,
      social: 42,
      responsibility: 58,
      stress: 58,
      comfort: 58,
      safety: 80,
      ...(overrides.needs || {})
    },
    emotionVector: {
      happy: 40,
      anxious: 30,
      angry: 8,
      sad: 16,
      tired: 58,
      lonely: 66,
      hopeful: 42,
      calm: 42,
      curious: 30,
      ...(overrides.emotionVector || {})
    },
    identityCore: { identity: "stable responsible resident", values: ["responsibility"], socialSensitivity: 0.7 },
    selfModel: { identity: "I try to keep promises", values: ["responsibility"], selfBeliefs: ["I should finish important work"] },
    cognitiveProfile: {
      riskTolerance: 0.45,
      curiosity: 0.36,
      routinePreference: 0.62,
      socialDrive: 0.56,
      ambition: 0.68,
      empathy: 0.52,
      conflictAvoidance: 0.48,
      patience: 0.58
    },
    relationshipMatrix: {
      friend_1: { trust: 78, intimacy: 68, familiarity: 72 }
    },
    memory: { short: [], long: [], emotional: [], secret: [], rumor: [] },
    semanticMemory: { habit: [], experience: [], belief: [], relationship: [], preference: [], goal: [] },
    goalRuntime: {
      goals: [{ id: "goal_work", name: "keep work and life stable", priority: 0.72, progress: 0.4, frustration: 0.22 }]
    },
    ...overrides
  };
}

function baseWorld(agent, clock = 8 * 60) {
  return {
    clock,
    config: {
      vectorMemoryEnabled: false,
      cognitiveEngineEnabled: true,
      temporalCausal: { threshold: 0.03, decayLambda: 0.0002 },
      causalWeight: 0.12
    },
    places: [{ id: "office" }, { id: "apartment" }, { id: "clinic" }, { id: "square" }],
    agents: [agent, { id: "friend_1", name: "Friend", position: "square", needs: {}, emotionVector: {} }],
    eventLog: []
  };
}

function decide(world, agent, context = {}) {
  const state = cognitiveState(world, agent, context);
  return utilityDecision(state.psychologicalState);
}

function workEvent(index) {
  return {
    id: `work_${index}`,
    type: "work",
    plan: { title: "focused office work", localAction: "work", place: "office" },
    summary: `focused work block ${index} continued with little social contact`,
    needDelta: { social: -7, comfort: -3, responsibility: -3 },
    emotionDelta: { tired: 8, lonely: 7 },
    goalImpact: 58,
    contextScope: "self"
  };
}

function contactEvent(id = "contact_after_work") {
  return {
    id,
    type: "contact_familiar",
    summary: "after a long work stretch, contacted a familiar friend to recover social balance",
    targetAgentId: "friend_1",
    relationshipDelta: { trust: 9, intimacy: 5 },
    needDelta: { social: 14, comfort: 4 },
    emotionDelta: { lonely: -14, hopeful: 10, calm: 5 },
    goalImpact: 42,
    contextScope: "self"
  };
}

function runWorkSocialChain(world, agent, cycle = 0) {
  for (let i = 0; i < 5; i += 1) {
    world.clock = 8 * 60 + cycle * 1440 + i * 120;
    recordLifeEvent(world, agent, workEvent(`${cycle}_${i}`));
  }
  world.clock = 18 * 60 + cycle * 1440;
  return recordLifeEvent(world, agent, contactEvent(`contact_${cycle}`));
}

function testStrengthFormulaIsBounded() {
  const low = temporalCausalStrength({
    eventImpact: 0.2,
    emotionChange: 0.2,
    relationshipImpact: 0.2,
    repeatCount: 1,
    confidence: 0.5
  });
  const high = temporalCausalStrength({
    eventImpact: 0.8,
    emotionChange: 0.7,
    relationshipImpact: 0.6,
    repeatCount: 5,
    confidence: 0.8
  });
  assert.ok(high.strength > low.strength);
  assert.ok(high.strength <= 1);
  assert.equal(typeof high.dimensions.repeatCount, "number");
}

function testWorkSocialChainCreatesCausalMemory() {
  const agent = baseAgent();
  const world = baseWorld(agent);
  const result = runWorkSocialChain(world, agent);
  assert.ok(result.temporalCausal, "recordLifeEvent should return temporal causal result");
  const memory = (agent.causalMemory || []).find(item => item.category === "work_social_recovery");
  assert.ok(memory, "work -> social depletion -> contact chain should create causalMemory");
  assert.match(memory.learning.causalRule, /work|工作/i);
  assert.match(memory.learning.causalBelief, /familiar|social|熟悉|社交/i);
  assert.ok(memory.learning.confidence > 0.45);
  assert.ok(memory.causalStrength > 0);
}

function testRepeatReinforcesConfidence() {
  const agent = baseAgent();
  const world = baseWorld(agent);
  runWorkSocialChain(world, agent, 0);
  const first = agent.causalMemory.find(item => item.category === "work_social_recovery").learning.confidence;
  for (let cycle = 1; cycle < 5; cycle += 1) runWorkSocialChain(world, agent, cycle);
  const memory = agent.causalMemory.find(item => item.category === "work_social_recovery");
  assert.ok(memory.repeatCount >= 5, "repeat count should reinforce the pattern");
  assert.ok(memory.learning.confidence > first, "confidence should increase after repeated chains");
}

function testOrdinaryEatingDoesNotCreateCausalMemory() {
  const agent = baseAgent({ needs: { social: 70 }, emotionVector: { lonely: 15, tired: 25 } });
  const world = baseWorld(agent);
  recordLifeEvent(world, agent, {
    id: "ordinary_meal",
    type: "plan_meal",
    plan: { title: "ordinary meal", localAction: "plan_meal", place: "breakfast" },
    summary: "ate an ordinary meal during the day",
    needDelta: { hunger: 18 },
    emotionDelta: { calm: 1 },
    contextScope: "self"
  });
  updateTemporalCausalMemory(world, agent, { force: true });
  assert.equal((agent.causalMemory || []).length, 0, "ordinary eating should not create causalMemory");
}

function testCognitiveAndSchedulerCarryCausalBias() {
  const agent = baseAgent();
  const world = baseWorld(agent);
  runWorkSocialChain(world, agent);
  const state = cognitiveState(world, agent, { eventText: "long work made social contact feel useful" });
  assert.ok(state.causalBias.socialBias > 0, "causal social bias should be visible in CognitiveState");
  assert.ok(state.activeCausalMemory.length >= 1);
  const contactBias = causalBiasForAction(world, agent, { id: "contact_familiar" }, state);
  const workBias = causalBiasForAction(world, agent, { id: "follow_plan" }, state);
  assert.ok(contactBias.score > workBias.score, "work-social causal memory should softly favor contact over more work");

  const decision = decide(world, agent, { eventText: "long work made social contact feel useful" });
  assert.ok(decision.candidateActions.some(action => typeof action.components?.causalBias === "number"));
  assert.equal(typeof decision.decisionTrace.scoreBreakdown.causal, "number");
  assert.ok(decision.candidateActions.every(action => action.components.causalWeight <= 0.2));
}

function testInfluenceDecaysButPersists() {
  const agent = baseAgent();
  const world = baseWorld(agent);
  runWorkSocialChain(world, agent);
  const before = causalMemoryInfluence(world, agent).causalBias.socialBias;
  world.clock += 24 * 60;
  const after = causalMemoryInfluence(world, agent).causalBias.socialBias;
  assert.ok(after < before, "causal influence should decay over time");
  assert.ok(after > 0, "one day should not erase a reinforced causal memory immediately");
}

[
  testStrengthFormulaIsBounded,
  testWorkSocialChainCreatesCausalMemory,
  testRepeatReinforcesConfidence,
  testOrdinaryEatingDoesNotCreateCausalMemory,
  testCognitiveAndSchedulerCarryCausalBias,
  testInfluenceDecaysButPersists
].forEach(test => {
  test();
  console.log(`PASS ${test.name}`);
});

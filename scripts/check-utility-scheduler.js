"use strict";

const assert = require("node:assert/strict");
const {
  recordLifeEvent,
  structuredMemoryForAgent,
  retrieveVectorMemories
} = require("../ai-town-memory-stream");
const { cognitiveState } = require("../ai-town-cognitive-state");
const { utilityDecision } = require("../ai-town-utility-scheduler");

function baseAgent(overrides = {}) {
  return {
    id: "agent_1",
    name: "钱芳仪",
    job: "上班族",
    ageYears: 34,
    position: "office",
    needs: {
      hunger: 80,
      hygiene: 75,
      health: 80,
      social: 70,
      responsibility: 70,
      stress: 65,
      comfort: 65,
      safety: 80,
      ...(overrides.needs || {})
    },
    emotionVector: {
      happy: 45,
      anxious: 35,
      angry: 10,
      sad: 10,
      tired: 40,
      lonely: 30,
      hopeful: 45,
      calm: 50,
      curious: 35,
      ...(overrides.emotionVector || {})
    },
    memory: { short: [], long: [], emotional: [], secret: [], rumor: [] },
    semanticMemory: { habit: [], experience: [], belief: [], relationship: [], preference: [], goal: [] },
    relationshipMatrix: {},
    ...overrides
  };
}

function baseWorld(agent, clock = 600) {
  return {
    clock,
    config: { vectorMemoryEnabled: true, vectorMaxRecall: 6 },
    places: [{ id: "office" }, { id: "clinic" }, { id: "apartment" }, { id: "breakfast" }],
    agents: [agent],
    eventLog: []
  };
}

function decide(world, agent) {
  const state = cognitiveState(world, agent);
  return utilityDecision(state.psychologicalState);
}

function testMemoryConsolidatorDualOutput() {
  const agent = baseAgent();
  const world = baseWorld(agent, 900);
  recordLifeEvent(world, agent, {
    type: "health_rest",
    interruption: { type: "health", priority: 95, canOverridePlan: true, reason: "health is critical" },
    summary: "钱芳仪停下来观察身体状态"
  });
  const structured = structuredMemoryForAgent(agent);
  assert.ok(structured.episodic.length >= 1, "experience must be exposed as episodic structured memory");
  assert.ok(structured.belief.length >= 1, "belief must be structured memory");
  assert.ok(agent.vectorMemory.length >= 1, "structured memory should create vector recall entries");
  assert.equal(agent.vectorMemory[0].factAuthority, false);
}

function testVectorRecallIsAssociative() {
  const agent = baseAgent();
  const world = baseWorld(agent, 900);
  recordLifeEvent(world, agent, {
    type: "health_rest",
    interruption: { type: "health", priority: 95, canOverridePlan: true, reason: "health is critical" },
    summary: "钱芳仪停下来观察身体状态"
  });
  const recalls = retrieveVectorMemories(agent, { clock: world.clock, type: "health", place: "clinic", reason: "身体不适" }, 4);
  assert.ok(recalls.length >= 1);
  assert.equal(recalls[0].factAuthority, false);
}

function testUtilityPrioritizesHealthWhenLow() {
  const agent = baseAgent({ needs: { health: 18 }, emotionVector: { anxious: 75, tired: 70 } });
  const world = baseWorld(agent, 9 * 60);
  recordLifeEvent(world, agent, {
    type: "health_rest",
    interruption: { type: "health", priority: 95, canOverridePlan: true, reason: "health is critical" },
    summary: "钱芳仪停下来观察身体状态"
  });
  const decision = decide(world, agent);
  assert.ok(decision.priority > 20);
  assert.ok(decision.candidateActions.some(action => action.id === "seek_care"));
  const care = decision.candidateActions.find(action => action.id === "seek_care");
  assert.ok(care.score >= decision.candidateActions[decision.candidateActions.length - 1].score);
}

function testVectorBonusCapped() {
  const agent = baseAgent({ needs: { health: 30 } });
  const world = baseWorld(agent, 900);
  for (let i = 0; i < 10; i += 1) {
    recordLifeEvent(world, agent, {
      type: "health_rest",
      interruption: { type: "health", priority: 90, canOverridePlan: true, reason: `health ${i}` },
      summary: `钱芳仪第 ${i} 次因身体不适考虑诊所`
    });
  }
  const decision = decide(world, agent);
  const care = decision.candidateActions.find(action => action.id === "seek_care");
  assert.equal(care.components.vectorBonus, 0);
  assert.equal(care.vectorCap, 0);
}

[
  testMemoryConsolidatorDualOutput,
  testVectorRecallIsAssociative,
  testUtilityPrioritizesHealthWhenLow,
  testVectorBonusCapped
].forEach(test => {
  test();
  console.log(`PASS ${test.name}`);
});

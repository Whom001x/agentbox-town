"use strict";

const assert = require("node:assert/strict");
const {
  recordLifeEvent,
  runDailyReflection
} = require("../ai-town-memory-stream");

function baseAgent() {
  return {
    id: "agent_1",
    name: "钱芳仪",
    position: "clinic",
    needs: { hunger: 80, health: 72, safety: 80, social: 65, stress: 60 },
    memory: { short: [], long: [], emotional: [], secret: [], rumor: [] }
  };
}

function baseWorld(agent) {
  return {
    clock: 1440,
    config: { causalGraphThreshold: 0.32 },
    agents: [agent],
    places: [{ id: "clinic" }],
    eventLog: []
  };
}

function testReflectionKeepsCausalFields() {
  const agent = baseAgent();
  const world = baseWorld(agent);
  recordLifeEvent(world, agent, {
    id: "health_reflection_1",
    type: "health_rest",
    interruption: { type: "health", priority: 94, canOverridePlan: true, reason: "health critical" },
    summary: "钱芳仪身体不适，因此调整安排并接受治疗。",
    emotionDelta: { anxious: 30, tired: 20 },
    goalImpact: 78,
    contextScope: "self"
  });
  const updated = runDailyReflection(world, { force: true });
  assert.deepEqual(updated, [agent.id]);
  assert.ok(Array.isArray(agent.reflection.causalAnchors));
  assert.ok(agent.reflection.causalAnchors.length >= 1);
  assert.ok(agent.reflection.lessonLearned);
  assert.ok(agent.reflection.counterfactual);
  assert.equal(/Daily reflection/i.test(JSON.stringify(agent.reflection)), false);
}

function testReflectionDoesNotInventCausalChains() {
  const agent = baseAgent();
  const world = baseWorld(agent);
  recordLifeEvent(world, agent, {
    id: "ordinary_reflection_1",
    type: "observe",
    summary: "钱芳仪看见普通路人经过。",
    abnormality: 5,
    emotionalIntensity: 4,
    futureImpact: 5,
    emotionDelta: { calm: 1 },
    contextScope: "same_place"
  });
  runDailyReflection(world, { force: true });
  assert.ok(Array.isArray(agent.reflection.causalAnchors));
  assert.equal(agent.reflection.causalAnchors.length, 0);
}

[
  testReflectionKeepsCausalFields,
  testReflectionDoesNotInventCausalChains
].forEach(test => {
  test();
  console.log(`PASS ${test.name}`);
});

"use strict";

const assert = require("node:assert/strict");
const {
  recordLifeEvent,
  runDailyReflection,
  retrieveRelevantMemories
} = require("../ai-town-memory-stream");

function baseAgent(overrides = {}) {
  return {
    id: "agent_1",
    name: "钱芳仪",
    position: "apartment",
    needs: { hunger: 80, health: 80, safety: 80, stress: 80 },
    memory: { short: [], long: [], emotional: [], secret: [], rumor: [] },
    ...overrides
  };
}

function baseWorld(agent, clock = 600) {
  return {
    clock,
    places: [{ id: "apartment" }, { id: "clinic" }],
    agents: [agent],
    eventLog: []
  };
}

function testRoutineStaysEventLogUntilHabitForms() {
  const agent = baseAgent();
  const world = baseWorld(agent);
  recordLifeEvent(world, agent, {
    type: "plan_sleep",
    plan: { title: "sleep", localAction: "sleep" },
    summary: "钱芳仪按计划休息"
  });
  assert.equal(world.eventLog.length, 1);
  assert.equal(agent.memory.short.length, 0);
  assert.equal(agent.memory.long.length, 0);
  assert.equal(agent.semanticMemory.habit.length, 0);
  assert.equal(world.eventLog[0].memoryGate.shouldRemember, false);
  recordLifeEvent(world, agent, {
    type: "plan_sleep",
    plan: { title: "sleep", localAction: "sleep" },
    summary: "routine sleep"
  });
  recordLifeEvent(world, agent, {
    type: "plan_sleep",
    plan: { title: "sleep", localAction: "sleep" },
    summary: "routine sleep"
  });
  assert.equal(world.eventLog.length, 3);
  assert.equal(agent.semanticMemory.habit.length, 1);
  assert.equal(world.eventLog[0].memoryGate.memoryType, "habit");
  assert.match(agent.semanticMemory.habit[0].text, /规律|休息|生活节奏/);
}

function testExceptionBecomesExperienceAndBelief() {
  const agent = baseAgent();
  const world = baseWorld(agent, 800);
  recordLifeEvent(world, agent, {
    type: "health_rest",
    interruption: { type: "health", priority: 95, canOverridePlan: true, reason: "health is critical" },
    summary: "钱芳仪停下来观察身体状态"
  });
  assert.equal(world.eventLog.length, 1);
  assert.equal(agent.memory.short.length, 0);
  assert.ok(agent.semanticMemory.experience.length >= 1);
  assert.ok(agent.semanticMemory.belief.length >= 1);
  assert.match(agent.semanticMemory.experience[0].text, /健康|身体/);
  assert.match(agent.semanticMemory.belief[0].text, /健康/);
}

function testReflectionDoesNotSummarizeReflection() {
  const agent = baseAgent();
  const world = baseWorld(agent, 1440);
  recordLifeEvent(world, agent, {
    type: "health_rest",
    interruption: { type: "health", priority: 95, canOverridePlan: true, reason: "health is critical" },
    summary: "钱芳仪停下来观察身体状态"
  });
  runDailyReflection(world, { force: true });
  runDailyReflection(world, { force: true });
  assert.equal(agent.memory.long.some(item => /Daily reflection/i.test(item.text || "")), false);
  assert.equal(/Daily reflection/i.test(agent.memorySummary), false);
  assert.match(agent.memorySummary, /角色近期状态/);
}

function testRelevantMemoryUsesSemanticMeaning() {
  const agent = baseAgent();
  const world = baseWorld(agent, 1600);
  recordLifeEvent(world, agent, {
    type: "health_rest",
    interruption: { type: "health", priority: 95, canOverridePlan: true, reason: "health is critical" },
    summary: "钱芳仪停下来观察身体状态"
  });
  const memories = retrieveRelevantMemories(agent, { clock: world.clock, type: "clinic", reason: "health" }, 4);
  assert.ok(memories.some(item => item.type === "experience" || item.type === "belief"));
  assert.equal(memories.some(item => /^Followed/i.test(item.text)), false);
}

[
  testRoutineStaysEventLogUntilHabitForms,
  testExceptionBecomesExperienceAndBelief,
  testReflectionDoesNotSummarizeReflection,
  testRelevantMemoryUsesSemanticMeaning
].forEach(test => {
  test();
  console.log(`PASS ${test.name}`);
});

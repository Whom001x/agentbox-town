"use strict";

const assert = require("node:assert/strict");
const {
  cleanHabitMemory,
  recordLifeEvent,
  runDailyReflection
} = require("../ai-town-memory-stream");

function makeAgent(overrides = {}) {
  return {
    id: "agent_stability",
    name: "Stability Tester",
    position: "apartment",
    needs: { hunger: 80, hygiene: 80, health: 80, social: 70, responsibility: 60, stress: 40, comfort: 70, safety: 80 },
    memory: { short: [], long: [], emotional: [], secret: [], rumor: [] },
    semanticMemory: { habit: [], experience: [], episodic: [], belief: [], relationship: [], social: [], preference: [], goal: [] },
    structuredMemory: { habit: [], belief: [], preference: [], episodic: [], social: [], goal: [] },
    relationshipMatrix: {
      partner: { trust: 72, intimacy: 70, familiarity: 85 }
    },
    selfModel: {
      identity: "I keep a steady life",
      values: ["responsibility"],
      selfBeliefs: ["I keep commitments"]
    },
    ...overrides
  };
}

function makeWorld(agent, clock = 0) {
  return {
    clock,
    config: {
      memoryQuality: {
        routineHabitThreshold: 5,
        memoryValueThreshold: 0.08,
        causalCandidateThreshold: 0.01,
        maxCausalCandidates: 20,
        relationshipWriteCooldown: 100
      }
    },
    agents: [agent, { id: "partner", name: "Partner", position: "apartment", needs: {}, emotionVector: {} }],
    places: [{ id: "apartment" }, { id: "clinic" }],
    eventLog: []
  };
}

function sleepEvent(id) {
  return {
    id,
    type: "plan_sleep",
    plan: { title: "sleep", localAction: "sleep" },
    summary: "routine sleep"
  };
}

function testStableSleepCreatesOneHabit() {
  const agent = makeAgent();
  const world = makeWorld(agent);
  for (let day = 0; day < 5; day += 1) {
    world.clock = day * 1440 + 22 * 60;
    recordLifeEvent(world, agent, sleepEvent(`sleep_stable_${day}`));
  }
  assert.equal(agent.habitMemory.length, 1);
  assert.equal(agent.habitMemory[0].trigger, "sleep");
  assert.ok(agent.semanticMemory.habit[0].count >= 5);
}

function testRandomSleepDoesNotCreateHabit() {
  const agent = makeAgent();
  const world = makeWorld(agent);
  [1320, 3000, 4210, 6200, 7600].forEach((clock, index) => {
    world.clock = clock;
    recordLifeEvent(world, agent, sleepEvent(`sleep_random_${index}`));
  });
  assert.equal(agent.habitMemory.length, 0);
  assert.equal(agent.semanticMemory.habit.length, 0);
}

function testDailyRelationshipSummary() {
  const agent = makeAgent();
  const world = makeWorld(agent, 600);
  for (let index = 0; index < 5; index += 1) {
    world.clock = 600 + index * 20;
    recordLifeEvent(world, agent, {
      id: `partner_support_${index}`,
      type: "relationship_support",
      summary: "partner offered meaningful support during stress",
      targetAgentId: "partner",
      relationshipDelta: { trust: 0.18, intimacy: 0.12 },
      emotionDelta: { hopeful: 18, calm: 8 },
      goalImpact: 35,
      contextScope: "direct"
    });
  }
  assert.equal(agent.relationshipMemory.length, 0);
  assert.equal(agent.relationshipBuffer.length, 1);
  world.clock = 1440;
  runDailyReflection(world);
  assert.equal(agent.relationshipMemory.length, 1);
  assert.ok(agent.relationshipMemory[0].interactionCount >= 5);
  assert.equal(agent.dailyRelationshipSummary[0].events, 5);
}

function testCausalCandidatePoolEvictsPastTwenty() {
  const agent = makeAgent();
  const world = makeWorld(agent, 0);
  for (let index = 0; index < 25; index += 1) {
    world.clock = index + 1;
    recordLifeEvent(world, agent, {
      id: `causal_${index}`,
      type: `unusual_event_${index}`,
      summary: `unusual event ${index} changed state`,
      needDelta: { social: -8 - index },
      emotionDelta: { lonely: 12 + index },
      goalImpact: 35,
      causalPotential: 0.5,
      contextScope: "self"
    });
  }
  assert.ok(agent.causalCandidates.length <= 20);
  assert.ok(agent.causalCandidates.every(item => item.trigger && item.effect && item.repeatCount >= 1 && Number.isFinite(item.lastSeen)));
}

function testSpecialOneOffHabitIsProtected() {
  const agent = makeAgent();
  agent.semanticMemory = {
    habit: [
      { id: "generic_sleep", type: "habit", text: "I sleep on time", trigger: "sleep", tags: ["habit", "sleep"], count: 1 },
      { id: "tavern_write", type: "habit", text: "I write at the tavern when lonely", trigger: "writing", tags: ["habit", "writing", "tavern"], count: 1 }
    ],
    experience: [],
    episodic: [],
    belief: [],
    relationship: [],
    social: [],
    preference: [],
    goal: []
  };
  agent.structuredMemory = { habit: [], belief: [], preference: [], episodic: [], social: [], goal: [] };
  const report = cleanHabitMemory(agent);
  assert.equal(report.removed, 1);
  assert.equal(agent.semanticMemory.habit.length, 1);
  assert.equal(agent.semanticMemory.habit[0].id, "tavern_write");
}

[
  testStableSleepCreatesOneHabit,
  testRandomSleepDoesNotCreateHabit,
  testDailyRelationshipSummary,
  testCausalCandidatePoolEvictsPastTwenty,
  testSpecialOneOffHabitIsProtected
].forEach(test => {
  test();
  console.log(`PASS ${test.name}`);
});

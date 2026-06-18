const assert = require("node:assert/strict");
const {
  ensureSelfModel,
  recordLifeEvent,
  runDailyReflection
} = require("../ai-town-memory-stream");

function makeAgent(overrides = {}) {
  return {
    id: "agent_quality_1",
    name: "Memory Quality Tester",
    position: "apartment",
    needs: { hunger: 80, hygiene: 80, health: 80, social: 70, responsibility: 60, stress: 40, comfort: 70, safety: 80 },
    memory: { short: [], long: [], emotional: [], secret: [], rumor: [] },
    relationshipMatrix: {
      agent_friend: { trust: 55, intimacy: 35, familiarity: 60 }
    },
    selfModel: {
      identity: "I am a stable town resident",
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
        causalCandidateThreshold: 0.12
      }
    },
    places: [{ id: "apartment" }, { id: "clinic" }],
    agents: [agent],
    eventLog: []
  };
}

function tick(world, minutes = 60) {
  world.clock += minutes;
}

function testHundredRoutineDoesNotCreateHundredHabits() {
  const agent = makeAgent();
  const world = makeWorld(agent);
  for (let index = 0; index < 100; index += 1) {
    recordLifeEvent(world, agent, {
      type: "plan_work",
      plan: { title: "shop duty", localAction: "work" },
      summary: "routine shop duty"
    });
    tick(world);
  }
  assert.equal(world.eventLog.length, 100);
  assert.ok(agent.semanticMemory.habit.length <= 1);
  assert.ok(world.eventLog.filter(event => event.memoryGate.shouldRemember).length <= 1);
  assert.ok(world.eventLog.every(event => event.memoryGate.eventCategory === "routine"));
}

function testRepeatedSleepCompressesToOneHabit() {
  const agent = makeAgent();
  const world = makeWorld(agent);
  for (let index = 0; index < 5; index += 1) {
    world.clock = index * 1440 + 22 * 60;
    recordLifeEvent(world, agent, {
      id: `stable_sleep_${index}`,
      type: "plan_sleep",
      plan: { title: "sleep", localAction: "sleep" },
      summary: "routine sleep"
    });
  }
  assert.equal(agent.semanticMemory.habit.length, 1);
  assert.equal(agent.habitMemory.length, 1);
  assert.equal(world.eventLog.filter(event => event.memoryGate.memoryType === "habit" && event.memoryGate.shouldRemember).length, 1);
}

function testCrisisCreatesEpisodicMemory() {
  const agent = makeAgent();
  const world = makeWorld(agent, 600);
  const result = recordLifeEvent(world, agent, {
    type: "health_rest",
    interruption: { type: "health", priority: 96, canOverridePlan: true, reason: "critical health" },
    summary: "health crisis interrupted the day",
    emotionDelta: { anxious: 32, tired: 20 },
    needDelta: { health: -22 },
    goalImpact: 70
  });
  assert.equal(result.event.memoryGate.eventCategory, "crisis");
  assert.equal(result.event.memoryGate.shouldRemember, true);
  assert.ok(agent.semanticMemory.experience.length >= 1);
  assert.ok(agent.episodicMemory.length >= 1);
}

function testRelationshipEventCreatesRelationshipMemory() {
  const agent = makeAgent();
  const world = makeWorld(agent, 900);
  const result = recordLifeEvent(world, agent, {
    type: "social_support",
    targetAgentId: "agent_friend",
    summary: "friend offered support during a difficult moment",
    emotionDelta: { hopeful: 15, calm: 8 },
    relationshipDelta: { trust: 0.2, affinity: 0.15 },
    goalImpact: 25,
    contextScope: "close_relation"
  });
  assert.equal(result.event.memoryGate.eventCategory, "relationship");
  assert.equal(result.event.memoryGate.memoryType, "social");
  assert.equal(result.event.memoryGate.shouldRemember, true);
  assert.equal(agent.relationshipMemory.length, 0);
  assert.equal(agent.relationshipBuffer.length, 1);
  world.clock = 1440;
  runDailyReflection(world);
  assert.equal(agent.relationshipMemory.length, 1);
}

function testCausalCandidateBeforeCausalMemory() {
  const agent = makeAgent();
  const world = makeWorld(agent, 1200);
  const result = recordLifeEvent(world, agent, {
    type: "plan_work",
    plan: { title: "long work shift", localAction: "work" },
    summary: "long routine work raised loneliness",
    emotionDelta: { lonely: 12, tired: 6 },
    needDelta: { social: -12 },
    goalImpact: 25
  });
  assert.equal(result.event.category, "routine");
  assert.equal(result.event.memoryGate.shouldRemember, false);
  assert.ok(Array.isArray(agent.causalCandidates));
  assert.ok(agent.causalCandidates.length >= 1);
  assert.equal((agent.causalMemory || []).length, 0);
}

function testSelfModelSanitizer() {
  const agent = makeAgent({
    selfModel: {
      identity: "I am a stable town resident",
      values: ["responsibility"],
      selfBeliefs: ["????bad template????", "I keep commitments"],
      lifeNarrative: "same theme repeats. same theme repeats. another point."
    }
  });
  ensureSelfModel(agent);
  assert.ok(!JSON.stringify(agent.selfModel).includes("????"));
  assert.equal((agent.selfModel.lifeNarrative.match(/same theme repeats/g) || []).length, 1);
}

[
  testHundredRoutineDoesNotCreateHundredHabits,
  testRepeatedSleepCompressesToOneHabit,
  testCrisisCreatesEpisodicMemory,
  testRelationshipEventCreatesRelationshipMemory,
  testCausalCandidateBeforeCausalMemory,
  testSelfModelSanitizer
].forEach(test => {
  test();
  console.log(`PASS ${test.name}`);
});

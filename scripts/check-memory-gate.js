"use strict";

const assert = require("node:assert/strict");
const {
  recordLifeEvent,
  memoryGate
} = require("../ai-town-memory-stream");

function agent(overrides = {}) {
  return {
    id: "agent_1",
    name: "Qian Fangyi",
    position: "apartment",
    needs: { hunger: 80, health: 80, safety: 80, social: 70 },
    memory: { short: [], long: [], emotional: [], secret: [], rumor: [] },
    relationshipMatrix: {},
    ...overrides
  };
}

function world(a, clock = 600) {
  return {
    clock,
    places: [{ id: "apartment" }, { id: "clinic" }],
    agents: [a],
    eventLog: []
  };
}

function testSingleRoutineOnlyEventLog() {
  const a = agent();
  const w = world(a);
  const result = recordLifeEvent(w, a, {
    type: "plan_sleep",
    plan: { title: "sleep", localAction: "sleep" },
    summary: "Followed plan sleep"
  });
  assert.equal(w.eventLog.length, 1);
  assert.equal(result.event.memoryGate.shouldRemember, false);
  assert.ok(result.event.memoryGate.importance < 0.3);
  assert.equal(a.semanticMemory.habit.length, 0);
  assert.equal(a.vectorMemory.length, 0);
}

function testRepeatedRoutineBecomesHabit() {
  const a = agent();
  const w = world(a);
  for (let i = 0; i < 3; i += 1) {
    recordLifeEvent(w, a, {
      type: "plan_sleep",
      plan: { title: "sleep", localAction: "sleep" },
      summary: "Followed plan sleep"
    });
  }
  assert.equal(w.eventLog.length, 3);
  assert.equal(w.eventLog[0].memoryGate.shouldRemember, true);
  assert.equal(w.eventLog[0].memoryGate.memoryType, "habit");
  assert.equal(a.semanticMemory.habit.length, 1);
}

function testMajorHealthEventCreatesExperienceAndBelief() {
  const a = agent();
  const w = world(a);
  recordLifeEvent(w, a, {
    type: "health_rest",
    interruption: { type: "health", priority: 96, canOverridePlan: true, reason: "health critical" },
    summary: "Qian Fangyi stopped work because she felt sick."
  });
  assert.equal(w.eventLog[0].memoryGate.shouldRemember, true);
  assert.ok(w.eventLog[0].memoryGate.importance >= 0.15);
  assert.ok(w.eventLog[0].memoryGate.dimensions.V_emotion > 0);
  assert.ok(w.eventLog[0].memoryGate.dimensions.V_goal > 0);
  assert.ok(a.semanticMemory.experience.length >= 1);
}

function testRelationshipEventCreatesRelationshipMemory() {
  const a = agent();
  const w = world(a);
  recordLifeEvent(w, a, {
    type: "social_help",
    summary: "A neighbor helped Qian Fangyi reach the clinic and she trusted that person more.",
    targetAgentId: "agent_2"
  });
  assert.equal(w.eventLog[0].memoryGate.shouldRemember, true);
  assert.equal(w.eventLog[0].memoryGate.memoryType, "social");
  assert.ok(a.semanticMemory.relationship.length >= 1);
  assert.ok(a.relationshipMemory.length >= 1);
}

function testMemoryGateDirectOutputShape() {
  const a = agent();
  const gate = memoryGate(world(a), a, {
    category: "exception",
    type: "minor_observation",
    summary: "looked around the room",
    abnormality: 10,
    emotionalIntensity: 10,
    futureImpact: 10
  });
  assert.equal(typeof gate.shouldRemember, "boolean");
  assert.equal(typeof gate.importance, "number");
  assert.equal(typeof gate.memoryType, "string");
}

[
  testSingleRoutineOnlyEventLog,
  testRepeatedRoutineBecomesHabit,
  testMajorHealthEventCreatesExperienceAndBelief,
  testRelationshipEventCreatesRelationshipMemory,
  testMemoryGateDirectOutputShape
].forEach(test => {
  test();
  console.log(`PASS ${test.name}`);
});

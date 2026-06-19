"use strict";

const assert = require("node:assert/strict");
const {
  cognitiveWrite,
  ensurePriorCausalGraph,
  eventHashFor,
  isEventRejectedRecently
} = require("../ai-town-cognitive-integrity");
const { cognitiveState } = require("../ai-town-cognitive-state");
const { recordLifeEvent } = require("../ai-town-memory-stream");
const { explorationRateFromState, utilityDecision } = require("../ai-town-utility-scheduler");

function agent(overrides = {}) {
  return {
    id: "agent_1",
    name: "Wang",
    ageYears: 35,
    job: "worker",
    position: "home",
    needs: { hunger: 80, hygiene: 80, health: 80, social: 80, responsibility: 70, stress: 40, comfort: 75, safety: 85 },
    emotionVector: { anxious: 20, lonely: 20, tired: 20, happy: 50, calm: 60 },
    memory: { short: [], long: [], emotional: [], secret: [], rumor: [] },
    semanticMemory: { habit: [], experience: [], belief: [], relationship: [], preference: [], goal: [] },
    ...overrides
  };
}

function world(a, overrides = {}) {
  return {
    clock: 300,
    config: { explorationRate: 0.05 },
    agents: [a],
    places: [{ id: "home" }, { id: "work" }, { id: "clinic" }],
    eventLog: [],
    ...overrides
  };
}

function testReflectionCannotBypassGuard() {
  const a = agent();
  const w = world(a);
  const result = cognitiveWrite({
    world: w,
    agent: a,
    agentId: a.id,
    source: "reflection",
    target: "reflectionMemory",
    payload: { observation: "This person learned a lesson.", at: w.clock },
    reason: "bad reflection",
    confidence: 0.8,
    timestamp: w.clock
  });
  assert.equal(result.ok, false);
  assert.equal(a.reflectionMemory, undefined);
  assert.equal(w.cognitiveIntegrity.lastRejectedWrite.rejected, true);
}

function testWrongCausalEdgeRejected() {
  const a = agent();
  const w = world(a);
  const result = cognitiveWrite({
    world: w,
    agent: a,
    agentId: a.id,
    source: "simulation",
    target: "causalGraph",
    payload: { fromTime: 20, toTime: 10, edge: { from: "future", to: "past" } },
    reason: "bad edge",
    confidence: 0.9,
    timestamp: w.clock
  });
  assert.equal(result.ok, false);
  assert.equal(w.causalGraph, undefined);
}

function testAcceptedWriteAudit() {
  const a = agent();
  const w = world(a);
  const result = cognitiveWrite({
    world: w,
    agent: a,
    agentId: a.id,
    source: "simulation",
    target: "eventLog",
    payload: { type: "check", summary: "我记录了一次有效检查。", at: w.clock },
    reason: "audit check",
    confidence: 0.9,
    timestamp: w.clock
  });
  assert.equal(result.ok, true);
  assert.equal(w.cognitiveWriteLog[0].accepted, true);
  assert.equal(w.eventLog.length, 1);
}

function testMissingRequiredFieldsRejected() {
  const a = agent();
  const w = world(a);
  const result = cognitiveWrite({
    world: w,
    agent: a,
    target: "eventLog",
    payload: { type: "bad" },
    confidence: 0.9
  });
  assert.equal(result.ok, false);
  assert.equal(w.cognitiveIntegrity.lastRejectedWrite.rejected, true);
  assert.match(w.cognitiveIntegrity.lastRejectedWrite.reason, /missing_source/);
}

function testDecisionBiasUsesKernel() {
  const a = agent({ decisionBias: {} });
  const w = world(a);
  require("../ai-town-memory-stream");
  const result = cognitiveWrite({
    world: w,
    agent: a,
    agentId: a.id,
    source: "reflection",
    target: "decisionBias",
    payload: { eventType: "ask_help", value: 0.4 },
    confidence: 0.8,
    reason: "test decision bias",
    timestamp: w.clock
  });
  assert.equal(result.ok, true);
  assert.equal(a.decisionBias.ask_help, 0.4);
}

function testRoutineRejectionCache() {
  const a = agent();
  const w = world(a);
  const detail = {
    type: "observe",
    summary: "noticed a chair",
    emotionDelta: {},
    needDelta: {}
  };
  recordLifeEvent(w, a, detail);
  const hash = eventHashFor(a, detail, w.clock);
  assert.equal(isEventRejectedRecently(w, a, detail), true);
  const before = w.eventLog.length;
  const second = recordLifeEvent(w, a, detail);
  assert.equal(second, null);
  assert.equal(w.eventLog.length, before);
  assert.equal(w.cognitiveIntegrity.rejectionCache[0].hash, hash);
}

function testNewWorldHasPriorCausalGraph() {
  const a = agent();
  const w = world(a);
  ensurePriorCausalGraph(w);
  assert.ok(w.causalGraph.priorCausalGraph.some(item => item.from === "need:hunger" && item.to === "action:seek_food"));
  const cognitive = cognitiveState(w, a);
  utilityDecision(cognitive.psychologicalState);
  assert.ok(w.causalGraph.priorCausalGraph.length >= 3);
}

function testBehaviorEntropyRaisesExploration() {
  const a = agent({
    actionHistory: Array.from({ length: 10 }, (_, index) => ({ actionId: index < 9 ? "wait" : "rest" }))
  });
  const w = world(a);
  const state = cognitiveState(w, a);
  assert.ok(explorationRateFromState(state.psychologicalState) > 0.05);
}

[
  testReflectionCannotBypassGuard,
  testWrongCausalEdgeRejected,
  testRoutineRejectionCache,
  testNewWorldHasPriorCausalGraph,
  testBehaviorEntropyRaisesExploration,
  testAcceptedWriteAudit,
  testMissingRequiredFieldsRejected,
  testDecisionBiasUsesKernel
].forEach(test => {
  test();
  console.log(`PASS ${test.name}`);
});

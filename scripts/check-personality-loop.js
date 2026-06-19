"use strict";

const assert = require("node:assert/strict");
const {
  recordLifeEvent,
  runDailyReflection,
  ensureSelfModel,
  normalizeGoalRuntime,
  syncLongTermMemoryViews
} = require("../ai-town-memory-stream");
const {
  scoreAction,
  utilityDecision
} = require("../ai-town-utility-scheduler");
const { cognitiveState, actionVector } = require("../ai-town-cognitive-state");

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
      health: 24,
      social: 72,
      responsibility: 62,
      stress: 58,
      comfort: 65,
      safety: 80,
      ...(overrides.needs || {})
    },
    emotionVector: {
      happy: 45,
      anxious: 62,
      angry: 10,
      sad: 10,
      tired: 58,
      lonely: 20,
      hopeful: 45,
      calm: 45,
      curious: 35,
      ...(overrides.emotionVector || {})
    },
    identityCore: {
      values: ["responsibility", "health"],
      habits: ["keeps promises"],
      fears: ["losing stable life"]
    },
    longTermGoals: [
      { title: "Keep health stable enough to work", priority: 8, progress: 20, blockedBy: ["health"] }
    ],
    relationshipMatrix: {},
    memory: { short: [], long: [], emotional: [], secret: [], rumor: [] },
    ...overrides
  };
}

function world(a, clock = 1440) {
  return {
    clock,
    config: { vectorMemoryEnabled: true, vectorMaxRecall: 6 },
    places: [{ id: "clinic" }, { id: "apartment" }, { id: "office" }],
    agents: [a],
    eventLog: []
  };
}

function stateExtras(w, a, context = {}) {
  const state = cognitiveState(w, a, context);
  return { cognitiveState: state, psychologicalState: state.psychologicalState };
}

function decide(w, a, context = {}) {
  return utilityDecision(stateExtras(w, a, context).psychologicalState);
}

function testSelfModelAndGoalRuntime() {
  const a = agent();
  const w = world(a);
  const self = ensureSelfModel(a);
  const goals = normalizeGoalRuntime(a, w);
  assert.ok(self.identity);
  assert.ok(self.values.includes("responsibility"));
  assert.equal(goals.goals[0].priority <= 1, true);
  assert.equal(goals.goals[0].progress <= 1, true);
  assert.ok(goals.goals[0].blockedBy.includes("health"));
}

function testEventCreatesMeaningfulMemoryAndEmotionCause() {
  const a = agent();
  const w = world(a, 900);
  const result = recordLifeEvent(w, a, {
    type: "health_rest",
    interruption: { type: "health", priority: 96, canOverridePlan: true, reason: "health critical" },
    summary: "Qian Fangyi had a critical health episode and stopped work to seek medical care.",
    needDelta: { health: -18 },
    emotionDelta: { anxious: 28, tired: 12 },
    goalImpact: 85,
    futureImpact: 60
  });
  syncLongTermMemoryViews(a);
  assert.equal(w.eventLog.length, 1);
  assert.equal(result.event.memoryGate.shouldRemember, true);
  assert.ok(a.episodicMemory.length >= 1 || a.semanticMemory.experience.length >= 1);
  assert.ok(a.beliefMemory.length >= 1);
  assert.ok(a.emotionCause.some(item => item.emotion === "anxious" && item.causes.length));
  assert.equal(a.memory.short.length, 0);
}

function testMemoryInfluenceAndUtility() {
  const a = agent();
  const w = world(a, 1000);
  recordLifeEvent(w, a, {
    type: "health_rest",
    interruption: { type: "health", priority: 96, canOverridePlan: true, reason: "health critical" },
    summary: "Qian Fangyi considered going to clinic after health discomfort."
  });
  const state = cognitiveState(w, a);
  const influence = state.psychologicalState.projection.memoryActivation;
  assert.ok(influence > 0);
  const decision = utilityDecision(state.psychologicalState);
  const care = decision.candidateActions.find(item => item.id === "seek_care");
  assert.ok(care);
  assert.ok(care.components.memoryInfluence > 0);
  assert.ok(decision.psychologicalState.projection.goalPressure > 0);
  assert.ok(decision.psychologicalState.projection.selfPressure >= 0);
}

function testSelfConsistencyAffectsScores() {
  const a = agent({
    needs: { health: 80, responsibility: 40 },
    selfModel: {
      identity: "I am reliable",
      values: ["responsibility"],
      fears: [],
      selfBeliefs: ["I keep promises"],
      currentSelfView: "I try to finish duties",
      selfConsistencyWeight: 1
    }
  });
  const w = world(a, 600);
  const plan = { title: "work shift", fixed: true, localAction: "work", place: "clinic", priority: 50 };
  const extras = stateExtras(w, a, { plan });
  const follow = scoreAction(extras.psychologicalState, { id: "follow_plan", label: "follow plan", type: "work", targetPlace: "clinic", tags: ["plan", "responsibility"], base: 10, cost: 0, risk: 0, actionVector: actionVector({ id: "follow_plan", tags: ["plan", "responsibility"] }) });
  const wander = scoreAction(extras.psychologicalState, { id: "walk_nearby", label: "walk", type: "move", tags: ["walk"], base: 10, cost: 0, risk: 0, actionVector: actionVector({ id: "walk_nearby", tags: ["walk"] }) });
  assert.ok(follow.components.unifiedUtility > 0);
  assert.ok(wander.components.unifiedUtility >= 0);
  assert.ok(follow.score > wander.score);
}

function testDailyReflectionUpdatesSelfModelWithoutDiary() {
  const a = agent();
  const w = world(a, 1500);
  recordLifeEvent(w, a, {
    type: "health_rest",
    interruption: { type: "health", priority: 96, canOverridePlan: true, reason: "health critical" },
    summary: "Qian Fangyi changed the plan because health affected work."
  });
  runDailyReflection(w, { force: true });
  assert.ok(Array.isArray(a.reflection.learnedBeliefs));
  assert.ok(Array.isArray(a.reflection.newHabits));
  assert.ok(Array.isArray(a.reflection.goalChanges));
  assert.ok(a.reflection.selfViewUpdate);
  assert.equal(/Daily reflection/i.test(JSON.stringify(a.reflection)), false);
  assert.equal(/today ate|today slept|followed plan/i.test(JSON.stringify(a.reflection)), false);
  assert.equal(a.selfModel.currentSelfView, a.reflection.selfViewUpdate);
}

[
  testSelfModelAndGoalRuntime,
  testEventCreatesMeaningfulMemoryAndEmotionCause,
  testMemoryInfluenceAndUtility,
  testSelfConsistencyAffectsScores,
  testDailyReflectionUpdatesSelfModelWithoutDiary
].forEach(test => {
  test();
  console.log(`PASS ${test.name}`);
});

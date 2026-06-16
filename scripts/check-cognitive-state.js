"use strict";

const assert = require("node:assert/strict");
const { cognitiveState } = require("../ai-town-cognitive-state");
const { utilityDecision } = require("../ai-town-utility-scheduler");

const SCALARS = [
  "selfPressure",
  "socialNeed",
  "safetyConcern",
  "curiosityDrive",
  "responsibilityDrive",
  "comfortNeed",
  "emotionalLoad",
  "beliefActivation"
];

function agent(id, overrides = {}) {
  return {
    id,
    name: id,
    job: "resident",
    ageYears: 36,
    position: "street",
    needs: {
      hunger: 70,
      hygiene: 75,
      health: 76,
      social: 70,
      responsibility: 68,
      stress: 62,
      comfort: 66,
      safety: 72,
      ...(overrides.needs || {})
    },
    emotionVector: {
      happy: 45,
      anxious: 35,
      angry: 8,
      sad: 12,
      tired: 35,
      lonely: 20,
      hopeful: 45,
      calm: 50,
      curious: 35,
      ...(overrides.emotionVector || {})
    },
    identityCore: { identity: "ordinary resident", values: ["stability"], ...(overrides.identityCore || {}) },
    selfModel: { identity: "I keep a stable life", values: ["responsibility"], selfBeliefs: ["I should handle what I promised"] },
    cognitiveProfile: {
      riskTolerance: 0.45,
      curiosity: 0.4,
      routinePreference: 0.55,
      socialDrive: 0.45,
      ambition: 0.55,
      empathy: 0.5,
      conflictAvoidance: 0.5,
      patience: 0.55,
      ...(overrides.cognitiveProfile || {})
    },
    beliefMemory: overrides.beliefMemory || [{ belief: "health should not be ignored", strength: 0.72, importance: 0.7 }],
    habitMemory: overrides.habitMemory || [{ habit: "return home to recover when tired", trigger: "tired", probability: 0.62, strength: 0.65 }],
    preferenceMemory: overrides.preferenceMemory || [{ preference: "quiet places", strength: 0.6 }],
    episodicMemory: overrides.episodicMemory || [{ event: "once paused work because of illness", meaning: "body state can change plans", emotionalImpact: 0.5, importance: 0.7 }],
    relationshipMatrix: overrides.relationshipMatrix || {},
    goalRuntime: {
      goals: [{ id: `${id}_goal`, name: "keep daily responsibility stable", priority: 0.72, progress: 0.25, frustration: 0.1 }]
    },
    memory: { short: [], long: [], emotional: [], secret: [], rumor: [] },
    semanticMemory: {
      belief: [{ id: `${id}_belief`, text: "health should not be ignored", importance: 4, strength: 70, at: 0 }],
      habit: [{ id: `${id}_habit`, text: "return home to recover when tired", importance: 3, strength: 65, at: 0 }],
      preference: [{ id: `${id}_pref`, text: "quiet places help recovery", importance: 3, strength: 60, at: 0 }],
      experience: [{ id: `${id}_ep`, text: "once paused work because of illness", meaning: "body state can change plans", importance: 4, strength: 70, at: 0 }]
    },
    ...overrides
  };
}

function world(agents) {
  return {
    clock: 21 * 60,
    config: {
      vectorMemoryEnabled: false,
      cognitiveEngineEnabled: true,
      cognitiveMemoryInfluence: 0.55,
      cognitiveBeliefInfluence: 0.6,
      cognitiveEmotionInfluence: 0.55,
      cognitiveGoalInfluence: 0.6
    },
    places: [{ id: "street" }, { id: "apartment" }, { id: "clinic" }, { id: "breakfast" }],
    records: [{ title: "night street corner stranger", summary: "A stranger appears near the street." }],
    agents
  };
}

function assertStateShape(state, subject) {
  assert.ok(state, `${subject.id} missing cognitiveState`);
  assert.equal(state.version, "3.2");
  assert.equal(state.source, "cognitive-state-v3");
  SCALARS.forEach(key => {
    assert.equal(typeof state[key], "number", `${subject.id}.${key} must be numeric`);
    assert.ok(state[key] >= 0 && state[key] <= 1, `${subject.id}.${key} must be 0-1`);
  });
  assert.ok(Array.isArray(state.desireCandidates), `${subject.id} missing desireCandidates`);
  assert.ok(state.desireCandidates.length >= 1, `${subject.id} should have desireCandidates`);
  assert.ok(Array.isArray(state.activeBeliefs), `${subject.id} missing activeBeliefs`);
  assert.ok(state.activeBeliefs.length >= 1, `${subject.id} should have activeBeliefs`);
  assert.ok(Array.isArray(state.activeMemories), `${subject.id} missing activeMemories`);
  assert.ok(Array.isArray(state.thoughtCandidates), `${subject.id} missing thoughtCandidates`);
  assert.equal(subject.cognitiveState, state);
  assert.equal(subject.desireCandidates, state.desireCandidates);
  assert.equal(subject.activeBeliefs, state.activeBeliefs);
}

function testCognitiveStateForAllAgents() {
  const agents = [
    agent("doctor", { job: "doctor", cognitiveProfile: { empathy: 0.82, patience: 0.72 }, needs: { health: 58 } }),
    agent("student", { job: "student", ageYears: 12, cognitiveProfile: { socialDrive: 0.72, curiosity: 0.68 }, emotionVector: { lonely: 62 } }),
    agent("elder", { job: "retired elder", ageYears: 73, cognitiveProfile: { routinePreference: 0.82, riskTolerance: 0.2 }, needs: { safety: 50 } }),
    agent("artist", { job: "artist", cognitiveProfile: { curiosity: 0.86, riskTolerance: 0.55 }, emotionVector: { curious: 78 } }),
    agent("worker", { job: "office worker", cognitiveProfile: { ambition: 0.78, patience: 0.72 }, needs: { responsibility: 45 } })
  ];
  const w = world(agents);
  agents.forEach(subject => {
    const state = cognitiveState(w, subject, { eventText: "night street corner stranger", summary: "late evening uncertainty" });
    assertStateShape(state, subject);
  });
}

function testUtilityCarriesCognitiveFields() {
  const subject = agent("worker", { needs: { responsibility: 42 }, cognitiveProfile: { ambition: 0.8, routinePreference: 0.7 } });
  const w = world([subject]);
  const decision = utilityDecision(w, subject, { eventText: "work responsibility after a tiring evening" });
  assert.ok(decision.cognitiveState);
  assert.ok(decision.desireCandidates.length >= 1);
  assert.ok(decision.activeBeliefs.length >= 1);
  assert.ok(decision.candidateActions.some(action => typeof action.components?.cognitiveFit === "number"));
  assert.equal(typeof decision.decisionTrace.scoreBreakdown.cognitiveFit, "number");
}

[
  testCognitiveStateForAllAgents,
  testUtilityCarriesCognitiveFields
].forEach(test => {
  test();
  console.log(`PASS ${test.name}`);
});

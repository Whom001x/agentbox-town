"use strict";

const assert = require("node:assert/strict");
const { cognitiveState } = require("../ai-town-cognitive-state");
const {
  evolveAgentIdentity,
  runIdentityEvolution,
  learningRateForAgent
} = require("../ai-town-identity-evolution");

function agent(overrides = {}) {
  return {
    id: overrides.id || "agent_1",
    name: overrides.name || "钱芳仪",
    job: overrides.job || "doctor",
    ageYears: overrides.ageYears || 34,
    ageStage: overrides.ageStage || "adult",
    position: "clinic",
    needs: {
      hunger: 80,
      hygiene: 80,
      health: 78,
      social: 72,
      responsibility: 70,
      stress: 70,
      comfort: 72,
      safety: 78,
      ...(overrides.needs || {})
    },
    emotionVector: {
      happy: 45,
      anxious: 45,
      angry: 10,
      sad: 10,
      tired: 35,
      lonely: 25,
      hopeful: 45,
      curious: 35,
      ...(overrides.emotionVector || {})
    },
    cognitiveProfile: {
      riskTolerance: 0.5,
      curiosity: 0.5,
      routinePreference: 0.5,
      socialDrive: 0.5,
      ambition: 0.5,
      empathy: 0.5,
      conflictAvoidance: 0.5,
      patience: 0.5,
      ...(overrides.cognitiveProfile || {})
    },
    behaviorTendency: {
      takeRisk: 0.5,
      seekHelp: 0.5,
      persistOnGoal: 0.5,
      avoidConflict: 0.5,
      selfReflect: 0.5,
      ...(overrides.behaviorTendency || {})
    },
    memory: { short: [], long: [], emotional: [], secret: [], rumor: [] },
    eventLog: [],
    relationshipMatrix: {},
    ...overrides
  };
}

function event(id, clock, summary, overrides = {}) {
  return {
    id,
    clock,
    agentId: "agent_1",
    category: "exception",
    type: overrides.type || "life",
    actionType: overrides.actionType || "",
    summary,
    abnormality: overrides.abnormality ?? 78,
    emotionalIntensity: overrides.emotionalIntensity ?? 72,
    futureImpact: overrides.futureImpact ?? 76,
    memoryGate: overrides.memoryGate || { shouldRemember: true, importance: overrides.importance ?? 0.72, memoryType: "episodic" },
    ...overrides
  };
}

function worldFor(a, clock = 1440) {
  return {
    clock,
    places: [{ id: "clinic" }, { id: "apartment" }, { id: "street" }],
    agents: [a],
    eventLog: a.eventLog.slice()
  };
}

function testLearningRateByAge() {
  assert.equal(learningRateForAgent({ ageYears: 9 }), 0.05);
  assert.equal(learningRateForAgent({ ageYears: 16 }), 0.03);
  assert.equal(learningRateForAgent({ ageYears: 36 }), 0.01);
  assert.equal(learningRateForAgent({ ageYears: 72 }), 0.005);
}

function testRepeatedFailureIncreasesCautionSlowly() {
  const a = agent();
  a.eventLog = [
    event("f1", 100, "钱芳仪连续失败，没能完成约定任务，工作受阻。"),
    event("f2", 300, "钱芳仪再次失败，事情被阻断。"),
    event("f3", 500, "钱芳仪错过安排，问题没有解决。")
  ];
  const w = worldFor(a, 1440);
  const beforeRisk = a.cognitiveProfile.riskTolerance;
  const result = evolveAgentIdentity(w, a, { force: true });
  assert.equal(result.applied, true);
  assert.ok(a.cognitiveProfile.riskTolerance < beforeRisk);
  assert.ok(a.cognitiveProfile.conflictAvoidance > 0.5);
  assert.ok(a.behaviorTendency.takeRisk < 0.5);
  assert.ok(a.beliefMemory.some(item => /受挫|风险/.test(item.belief)));
  assert.ok(a.identityChangeLog.length >= 1);
}

function testRepeatedSuccessIncreasesCompetence() {
  const a = agent();
  a.eventLog = [
    event("s1", 120, "钱芳仪成功解决了一个复杂问题。", { importance: 0.68 }),
    event("s2", 360, "钱芳仪完成任务并推进了长期目标。", { importance: 0.66 }),
    event("s3", 720, "钱芳仪把问题拆开处理，最终完成。", { importance: 0.7 })
  ];
  const w = worldFor(a, 1440);
  const beforeAmbition = a.cognitiveProfile.ambition;
  runIdentityEvolution(w, { force: true });
  assert.ok(a.cognitiveProfile.ambition > beforeAmbition);
  assert.ok(a.selfModel.competenceBeliefs.some(item => /困难|处理/.test(item)));
  assert.ok(a.habitMemory.some(item => /复杂|小步骤/.test(item.habit)));
}

function testLongTermHelpRaisesTrustAndSupport() {
  const a = agent();
  a.eventLog = [
    event("h1", 160, "邻居帮助钱芳仪处理困难，她得到支持。", { importance: 0.72 }),
    event("h2", 460, "朋友再次帮助钱芳仪解决问题。", { importance: 0.74 })
  ];
  const w = worldFor(a, 1440);
  const beforeSocial = a.cognitiveProfile.socialDrive;
  runIdentityEvolution(w, { force: true });
  assert.ok(a.cognitiveProfile.socialDrive > beforeSocial);
  assert.ok(a.behaviorTendency.seekHelp > 0.5);
  assert.ok(a.beliefMemory.some(item => /可信|依靠/.test(item.belief)));
  assert.ok(a.preferenceMemory.some(item => /帮助|联系/.test(item.preference)));
}

function testLonelinessChangesSocialTendency() {
  const a = agent({ needs: { social: 28 }, emotionVector: { lonely: 82 } });
  const w = worldFor(a, 1440);
  const beforeSocial = a.cognitiveProfile.socialDrive;
  const result = runIdentityEvolution(w, { force: true });
  assert.ok(result.appliedCount >= 1);
  assert.ok(a.cognitiveProfile.socialDrive > beforeSocial);
  assert.ok(a.habitMemory.some(item => /孤独|社交|熟悉/.test(item.habit)));
}

function testDailyOnlyAndCognitiveProfileInfluence() {
  const a = agent({
    cognitiveProfile: { riskTolerance: 0.15, curiosity: 0.85, socialDrive: 0.2, patience: 0.8 }
  });
  a.eventLog = [event("risk1", 100, "夜里街角出现陌生人，存在安全风险。", { type: "safety", importance: 0.82 })];
  const w = worldFor(a, 1440);
  const first = runIdentityEvolution(w, { force: true });
  const afterFirstRisk = a.cognitiveProfile.riskTolerance;
  const second = runIdentityEvolution(w);
  assert.equal(first.appliedCount, 1);
  assert.equal(second.skipped, true);
  assert.equal(a.cognitiveProfile.riskTolerance, afterFirstRisk);
  const state = cognitiveState(w, a, { eventText: "night street corner stranger" });
  assert.ok(state.cognitiveProfile.curiosity > 0.8);
  assert.ok(state.biasVector.riskTolerance < 0.5);
}

function testMemoryViewSchemas() {
  const a = agent();
  a.eventLog = [
    event("schema1", 200, "钱芳仪身体不适，决定放慢节奏并求助医生。", { type: "health", importance: 0.84 })
  ];
  const w = worldFor(a, 1440);
  runIdentityEvolution(w, { force: true });
  assert.equal(typeof a.beliefMemory[0].confidence, "number");
  assert.ok(Array.isArray(a.beliefMemory[0].sourceEvents));
  assert.equal(typeof a.habitMemory[0].trigger, "string");
  assert.equal(typeof a.habitMemory[0].action, "string");
  assert.equal(typeof a.habitMemory[0].probability, "number");
  assert.equal(typeof a.preferenceMemory[0].preference, "string");
}

[
  testLearningRateByAge,
  testRepeatedFailureIncreasesCautionSlowly,
  testRepeatedSuccessIncreasesCompetence,
  testLongTermHelpRaisesTrustAndSupport,
  testLonelinessChangesSocialTendency,
  testDailyOnlyAndCognitiveProfileInfluence,
  testMemoryViewSchemas
].forEach(test => {
  test();
  console.log(`PASS ${test.name}`);
});

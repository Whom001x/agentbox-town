"use strict";

const assert = require("assert");
const {
  characterSeedForSlot,
  mergeCharacterSeed,
  buildCharacterSeeds,
  mergeCharacterSeeds,
  applyRelationshipIntents,
  runCharacterConsistencyAgent
} = require("../ai-town-character-seed");

const places = [
  { id: "home", name: "居民楼" },
  { id: "school", name: "学校" },
  { id: "clinic", name: "诊所" }
];

const slots = [
  { id: "agent_1", index: 0, roleHint: "医生", ageRange: "28-45", placeHints: ["clinic"] },
  { id: "agent_2", index: 1, roleHint: "学生", ageRange: "10-16", placeHints: ["school"] },
  { id: "agent_3", index: 2, roleHint: "退休老人", ageRange: "68-80", placeHints: ["home"] },
  { id: "agent_4", index: 3, roleHint: "保安", ageRange: "30-55", placeHints: ["home"] }
];

const seeds = buildCharacterSeeds(slots, { premise: "普通小镇", places });
assert.equal(seeds.length, 4);

const forbiddenTemplate = /Followed plan|Because of|Daily reflection|This person tends/i;
function assertNoTemplate(value, label) {
  assert.equal(forbiddenTemplate.test(JSON.stringify(value)), false, label);
}

for (const seed of seeds) {
  assert.equal(seed.agentSchemaVersion, "3.1.5");
  assert.ok(seed.identityCore);
  assert.ok(seed.cognitiveProfile);
  assert.ok(seed.decisionWeights);
  assert.ok(seed.behaviorTendency);
  assert.ok(seed.lifeHistorySeed);
  ["childhood", "youth", "adulthood", "recent"].forEach(section => {
    assert.ok(Array.isArray(seed.lifeHistorySeed[section]) && seed.lifeHistorySeed[section].length >= 1, section);
    seed.lifeHistorySeed[section].forEach(item => {
      assert.ok(item.event);
      assert.ok(item.impact);
      assert.ok(item.ageRange);
    });
  });
  assert.ok(seed.lifeHistory);
  assert.ok(seed.selfModel);
  assert.ok(seed.selfModel.selfImage);
  assert.ok(Array.isArray(seed.selfModel.strengths));
  assert.ok(Array.isArray(seed.selfModel.concerns));
  assert.ok(seed.selfModel.lifeNarrative);
  assert.ok(seed.goalRuntime);
  assert.ok(Array.isArray(seed.goalRuntime.goals) && seed.goalRuntime.goals.length >= 1);
  assert.ok(Array.isArray(seed.beliefMemory) && seed.beliefMemory.length >= 1);
  assert.ok(Array.isArray(seed.habitMemory) && seed.habitMemory.length >= 1);
  assert.ok(Array.isArray(seed.preferenceMemory) && seed.preferenceMemory.length >= 1);
  assert.ok(Array.isArray(seed.episodicMemory) && seed.episodicMemory.length >= 1);
  seed.beliefMemory.forEach(item => {
    assert.ok(item.belief);
    assert.ok(item.strength >= 0 && item.strength <= 1);
    assert.ok(item.source);
  });
  seed.habitMemory.forEach(item => {
    assert.ok(item.trigger);
    assert.ok(item.action);
    assert.ok(item.probability >= 0 && item.probability <= 1);
  });
  seed.preferenceMemory.forEach(item => {
    assert.ok(item.preference);
    assert.ok(item.strength >= 0 && item.strength <= 1);
  });
  seed.episodicMemory.forEach(item => {
    assert.ok(item.event);
    assert.ok(item.lesson);
    assert.ok(item.emotionalImpact >= 0 && item.emotionalImpact <= 1);
    assert.equal(/吃饭|睡觉|上班|上课|通勤/.test(item.event), false);
  });
  assert.ok(seed.structuredMemory.episodic.length > 0);
  assert.ok(seed.structuredMemory.belief.length > 0);
  assert.ok(seed.structuredMemory.habit.length > 0);
  assert.ok(seed.structuredMemory.preference.length > 0);
  assert.ok(seed.vectorMemory.length > 0);
  ["riskTolerance", "curiosity", "routinePreference", "socialDrive", "ambition", "empathy", "conflictAvoidance", "patience"].forEach(key => {
    assert.ok(seed.cognitiveProfile[key] >= 0 && seed.cognitiveProfile[key] <= 1, key);
  });
  if (seed.roleKind === "medical") assert.ok(seed.cognitiveProfile.healthAwareness >= 0.55);
  if (seed.roleKind === "security") {
    assert.ok(seed.cognitiveProfile.riskAwareness >= 0.55);
    assert.ok(seed.cognitiveProfile.safetyAwareness >= 0.55);
  }
  ["memory", "persona", "emotion", "goal", "novelty", "social"].forEach(key => {
    assert.ok(seed.decisionWeights[key] >= 0 && seed.decisionWeights[key] <= 1, key);
  });
  ["memoryWeight", "identityWeight", "emotionWeight", "goalWeight", "noveltyWeight", "socialWeight"].forEach(key => {
    assert.ok(seed.decisionWeights[key] >= 0 && seed.decisionWeights[key] <= 1, key);
  });
  assertNoTemplate(seed, `seed ${seed.id}`);
}

let agents = [
  { id: "agent_1", name: "陈医生", job: "医生", ageYears: 36, place: "clinic", position: "clinic", relations: {} },
  { id: "agent_2", name: "林小雨", job: "学生", ageYears: 12, place: "school", position: "school", relations: {} },
  { id: "agent_3", name: "周德胜", job: "退休老人", ageYears: 72, place: "home", position: "home", relations: {} },
  { id: "agent_4", name: "罗子涵", job: "保安", ageYears: 38, place: "home", position: "home", relations: {} }
];

agents = mergeCharacterSeeds(agents, seeds).agents;
agents[0].relationshipMatrix = { agent_2: { type: "师生/照护熟人", trust: 55, intimacy: 25 } };
agents[1].relationshipMatrix = { agent_1: { type: "诊所熟人", trust: 52, intimacy: 18 } };
applyRelationshipIntents(agents);

const checked = runCharacterConsistencyAgent(agents, { places, premise: "普通小镇" });
assert.equal(checked.agents.length, 4);
for (const agent of checked.agents) {
  assert.ok(agent.characterGenesis);
  assert.equal(agent.agentSchemaVersion, "3.1.5");
  assert.equal(agent.characterGenesis.version, "v3.1.5");
  assert.ok(agent.cognitiveProfile);
  assert.ok(agent.decisionWeights);
  assert.ok(agent.identityCore);
  assert.ok(agent.selfModel);
  assert.ok(agent.selfModel.selfImage);
  assert.ok(Array.isArray(agent.selfModel.strengths));
  assert.ok(Array.isArray(agent.selfModel.concerns));
  assert.ok(agent.selfModel.lifeNarrative);
  assert.ok(agent.lifeHistorySeed);
  assert.ok(Array.isArray(agent.beliefMemory) && agent.beliefMemory.length >= 1);
  assert.ok(Array.isArray(agent.habitMemory) && agent.habitMemory.length >= 1);
  assert.ok(Array.isArray(agent.preferenceMemory) && agent.preferenceMemory.length >= 1);
  assert.ok(Array.isArray(agent.episodicMemory) && agent.episodicMemory.length >= 1);
  assert.ok(agent.goalRuntime);
  assert.ok(agent.structuredMemory);
  assert.ok(agent.vectorMemory);
  assert.ok(Array.isArray(agent.relationshipIntent));
  assertNoTemplate(agent.selfModel, `selfModel ${agent.id}`);
  assertNoTemplate(agent.beliefMemory, `belief ${agent.id}`);
  assertNoTemplate(agent.habitMemory, `habit ${agent.id}`);
  assertNoTemplate(agent.preferenceMemory, `preference ${agent.id}`);
  assertNoTemplate(agent.episodicMemory, `episodic ${agent.id}`);
}

const broadStudentSeed = characterSeedForSlot(
  { id: "agent_mismatch", index: 0, roleHint: "老人、青少年、儿童及少量年轻成人", ageYears: 72 },
  { premise: "普通小镇", places }
);
const mismatchedAgent = {
  id: "agent_mismatch",
  name: "赵建国",
  job: "退休老人",
  ageYears: 72,
  place: "school",
  position: "school",
  goal: "保持身体稳定",
  relations: {}
};
mergeCharacterSeed(mismatchedAgent, broadStudentSeed);
const repaired = runCharacterConsistencyAgent([mismatchedAgent], { places, premise: "普通小镇" }).agents[0];
assert.equal(repaired.agentSchemaVersion, "3.1.5");
assert.equal(repaired.characterGenesis.roleKind, "elder");
assert.notEqual(repaired.position, "school");
assert.equal(/课程|作业|同学|学习安排/.test(JSON.stringify({
  identityCore: repaired.identityCore,
  selfModel: repaired.selfModel,
  habitMemory: repaired.habitMemory,
  preferenceMemory: repaired.preferenceMemory,
  episodicMemory: repaired.episodicMemory
})), false);

console.log("PASS check-character-genesis");

"use strict";

const assert = require("assert");
const {
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
  { id: "agent_3", index: 2, roleHint: "退休老人", ageRange: "68-80", placeHints: ["home"] }
];

const seeds = buildCharacterSeeds(slots, { premise: "普通小镇", places });
assert.equal(seeds.length, 3);
for (const seed of seeds) {
  assert.ok(seed.identityCore);
  assert.ok(seed.cognitiveProfile);
  assert.ok(seed.decisionWeights);
  assert.ok(seed.behaviorTendency);
  assert.ok(seed.lifeHistory);
  assert.ok(seed.structuredMemory.episodic.length > 0);
  assert.ok(seed.structuredMemory.belief.length > 0);
  assert.ok(seed.structuredMemory.habit.length > 0);
  assert.ok(seed.structuredMemory.preference.length > 0);
  assert.ok(seed.vectorMemory.length > 0);
  ["riskTolerance", "curiosity", "routinePreference", "socialDrive", "ambition", "empathy", "conflictAvoidance", "patience"].forEach(key => {
    assert.ok(seed.cognitiveProfile[key] >= 0 && seed.cognitiveProfile[key] <= 1, key);
  });
  ["memory", "persona", "emotion", "goal", "novelty", "social"].forEach(key => {
    assert.ok(seed.decisionWeights[key] >= 0 && seed.decisionWeights[key] <= 1, key);
  });
}

let agents = [
  { id: "agent_1", name: "陈医生", job: "医生", ageYears: 36, place: "clinic", position: "clinic", relations: {} },
  { id: "agent_2", name: "林小雨", job: "学生", ageYears: 12, place: "school", position: "school", relations: {} },
  { id: "agent_3", name: "周德胜", job: "退休老人", ageYears: 72, place: "home", position: "home", relations: {} }
];

agents = mergeCharacterSeeds(agents, seeds).agents;
agents[0].relationshipMatrix = { agent_2: { type: "师生/照护熟人", trust: 55, intimacy: 25 } };
agents[1].relationshipMatrix = { agent_1: { type: "诊所熟人", trust: 52, intimacy: 18 } };
applyRelationshipIntents(agents);

const checked = runCharacterConsistencyAgent(agents, { places, premise: "普通小镇" });
assert.equal(checked.agents.length, 3);
for (const agent of checked.agents) {
  assert.ok(agent.characterGenesis);
  assert.ok(agent.cognitiveProfile);
  assert.ok(agent.decisionWeights);
  assert.ok(agent.identityCore);
  assert.ok(agent.selfModel);
  assert.ok(agent.structuredMemory);
  assert.ok(agent.vectorMemory);
  assert.ok(Array.isArray(agent.relationshipIntent));
}

console.log("PASS check-character-genesis");

"use strict";

const assert = require("node:assert/strict");
const {
  cognitiveState,
  actionVector,
  actionMatch,
  realityConstraint,
  cognitiveTemperature
} = require("../ai-town-cognitive-state");
const { utilityDecision } = require("../ai-town-utility-scheduler");

const SCENE = "night street corner stranger, unclear behavior";

function baseAgent(overrides = {}) {
  return {
    id: overrides.id || "agent",
    name: overrides.name || "Agent",
    job: overrides.job || "resident",
    ageYears: overrides.ageYears || 35,
    ageStage: overrides.ageStage || "adult",
    position: "street",
    needs: {
      hunger: 72,
      hygiene: 75,
      health: 76,
      social: 70,
      responsibility: 72,
      stress: 70,
      comfort: 68,
      safety: 70,
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
      curious: 40,
      ...(overrides.emotionVector || {})
    },
    identityCore: overrides.identityCore || { identity: overrides.job || "resident", values: [] },
    personalityProfile: overrides.personalityProfile || {},
    selfModel: overrides.selfModel,
    relationshipMatrix: overrides.relationshipMatrix || {},
    longTermGoals: overrides.longTermGoals || [],
    memory: { short: [], long: [], emotional: [], secret: [], rumor: [] },
    ...overrides
  };
}

function world(agents) {
  return {
    clock: 21 * 60,
    config: { vectorMemoryEnabled: false },
    places: [{ id: "street" }, { id: "apartment" }, { id: "clinic" }, { id: "breakfast" }],
    records: [{ title: "night street corner stranger", summary: "A stranger appears at the street corner at night." }],
    agents
  };
}

function top(decision) {
  return decision.candidateActions[0]?.id;
}

function decisionFor(agent) {
  return utilityDecision(world([agent]), agent, { eventText: SCENE });
}

function testCognitiveStateShape() {
  const agent = baseAgent({ job: "detective", identityCore: { identity: "curious detective", values: ["duty"] } });
  const state = cognitiveState(world([agent]), agent, { eventText: SCENE });
  assert.equal(state.source, "cognitive-state-v3");
  assert.ok(state.perceptionWeights.threat > 0);
  assert.ok(state.driveVector.curiosity > 0);
  assert.ok(state.decisionWeights.novelty > 0);
  assert.equal(agent.decisionWeights, state.decisionWeights);
}

function testActionVectorAndRealityConstraint() {
  const agent = baseAgent({ job: "retired elder", ageYears: 72, identityCore: { identity: "cautious retired elder" } });
  const state = cognitiveState(world([agent]), agent, { eventText: SCENE });
  const follow = { id: "follow_stranger", risk: 16, actionVector: actionVector({ id: "follow_stranger", risk: 16 }) };
  const home = { id: "return_home", risk: 2, actionVector: actionVector({ id: "return_home", risk: 2 }) };
  assert.ok(actionMatch(state, follow) > 0);
  assert.ok(realityConstraint(state, follow).value < realityConstraint(state, home).value);
}

function testDifferentRolesChooseDifferently() {
  const baker = baseAgent({
    id: "baker",
    job: "baker",
    identityCore: { identity: "responsible baker", values: ["stable routine", "shop duty"] },
    personalityProfile: { identity: "cautious, keeps routine" },
    longTermGoals: [{ title: "keep shop routine stable", priority: 0.9 }]
  });
  const detective = baseAgent({
    id: "detective",
    job: "detective",
    identityCore: { identity: "curious detective", values: ["duty", "investigation"] },
    personalityProfile: { identity: "curious, careful investigator" },
    longTermGoals: [{ title: "understand suspicious events", priority: 0.95 }]
  });
  const elder = baseAgent({
    id: "elder",
    job: "retired elder",
    ageYears: 74,
    ageStage: "elder",
    identityCore: { identity: "cautious retired elder", fears: ["night risk"] },
    personalityProfile: { identity: "cautious, risk avoiding" },
    needs: { safety: 62 }
  });
  const child = baseAgent({
    id: "child",
    job: "student child",
    ageYears: 10,
    ageStage: "child",
    identityCore: { identity: "child who relies on guardians", values: ["family"] },
    personalityProfile: { identity: "social, looks for trusted adults" },
    relationshipMatrix: { guardian: { trust: 88, intimacy: 80, dependency: 70 } }
  });
  const artist = baseAgent({
    id: "artist",
    job: "artist",
    identityCore: { identity: "observant artist", values: ["observation", "recording"] },
    personalityProfile: { identity: "curious artist, records unusual scenes" },
    emotionVector: { curious: 78, anxious: 35 }
  });
  const choices = {
    baker: top(decisionFor(baker)),
    detective: top(decisionFor(detective)),
    elder: top(decisionFor(elder)),
    child: top(decisionFor(child)),
    artist: top(decisionFor(artist))
  };
  assert.ok(["return_home", "follow_plan", "observe_environment", "seek_safety"].includes(choices.baker), `baker chose ${choices.baker}`);
  assert.ok(["follow_stranger", "observe_environment", "record_observation"].includes(choices.detective), `detective chose ${choices.detective}`);
  assert.ok(["seek_safety", "return_home", "observe_environment"].includes(choices.elder), `elder chose ${choices.elder}`);
  assert.ok(["ask_guardian", "contact_familiar", "seek_safety"].includes(choices.child), `child chose ${choices.child}`);
  assert.ok(["record_observation", "observe_environment", "follow_stranger"].includes(choices.artist), `artist chose ${choices.artist}`);
  assert.ok(new Set(Object.values(choices)).size >= 3, JSON.stringify(choices));
}

function testSoftmaxTemperatureFromPersonality() {
  const cautious = baseAgent({ id: "cautious", personalityProfile: { identity: "cautious careful resident" } });
  const impulsive = baseAgent({ id: "impulsive", personalityProfile: { identity: "impulsive curious resident" }, emotionVector: { curious: 85 } });
  const cautiousState = cognitiveState(world([cautious]), cautious, { eventText: SCENE });
  const impulsiveState = cognitiveState(world([impulsive]), impulsive, { eventText: SCENE });
  assert.ok(cognitiveTemperature(cautious, cautiousState) < cognitiveTemperature(impulsive, impulsiveState));
}

[
  testCognitiveStateShape,
  testActionVectorAndRealityConstraint,
  testDifferentRolesChooseDifferently,
  testSoftmaxTemperatureFromPersonality
].forEach(test => {
  test();
  console.log(`PASS ${test.name}`);
});

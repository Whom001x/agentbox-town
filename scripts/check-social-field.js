"use strict";

const assert = require("node:assert/strict");
const {
  computeSocialField,
  updateSocialField,
  propagateInformation,
  socialFieldBiasForAction
} = require("../ai-town-social-field");
const { cognitiveState } = require("../ai-town-cognitive-state");
const { utilityDecision } = require("../ai-town-utility-scheduler");

function agent(id, overrides = {}) {
  return {
    id,
    name: id,
    job: "resident",
    ageYears: 36,
    position: "apartment",
    needs: {
      hunger: 75,
      hygiene: 75,
      health: 78,
      social: 70,
      responsibility: 70,
      stress: 62,
      comfort: 70,
      safety: 80
    },
    emotionVector: {
      happy: 45,
      anxious: 30,
      angry: 10,
      sad: 10,
      tired: 35,
      lonely: 25,
      hopeful: 45,
      calm: 55,
      curious: 35
    },
    memory: { short: [], long: [], emotional: [], secret: [], rumor: [] },
    semanticMemory: { habit: [], experience: [], belief: [], relationship: [], preference: [], goal: [] },
    relationshipMatrix: {},
    cognitiveProfile: {
      riskTolerance: 0.5,
      curiosity: 0.45,
      routinePreference: 0.5,
      socialDrive: 0.45,
      empathy: 0.55,
      conflictAvoidance: 0.45,
      patience: 0.55,
      ambition: 0.45
    },
    ...overrides
  };
}

function buildWorld() {
  const agents = [];
  for (let i = 0; i < 18; i += 1) {
    const place = i < 5 ? "clinic" : i < 11 ? "apartment" : "market";
    agents.push(agent(`agent_${i}`, {
      position: place,
      job: i === 4 ? "doctor" : i === 12 ? "shop owner" : "resident"
    }));
  }
  const link = (from, to, trust = 75, intimacy = 55) => {
    agents[from].relationshipMatrix[agents[to].id] = { trust, intimacy, respect: 55, dependency: 20, resentment: 0 };
    agents[to].relationshipMatrix[agents[from].id] = { trust, intimacy, respect: 55, dependency: 20, resentment: 0 };
  };
  link(0, 2, 85, 80);
  link(0, 3, 78, 68);
  link(1, 4, 72, 50);
  link(2, 6, 70, 55);
  link(3, 7, 68, 50);
  link(12, 13, 75, 60);
  return {
    clock: 720,
    config: { vectorMemoryEnabled: false },
    places: [{ id: "clinic" }, { id: "apartment" }, { id: "market" }],
    agents,
    households: [{ id: "h1", members: ["agent_0", "agent_2", "agent_6"] }],
    groups: [
      { id: "clinic-circle", members: ["agent_0", "agent_1", "agent_3", "agent_4"] },
      { id: "market-circle", members: ["agent_12", "agent_13"] }
    ],
    records: [],
    eventLog: [],
    eventImpacts: [],
    informationFlows: [],
    socialProcesses: []
  };
}

function decide(world, agent, context = {}) {
  const state = cognitiveState(world, agent, context);
  return utilityDecision(state.psychologicalState);
}

function sampleImpact() {
  return {
    id: "impact_health_1",
    eventId: "event_health_1",
    title: "health emergency at clinic",
    summary: "agent_0 had a critical medical emergency and people nearby noticed only partial details",
    sourceAgentId: "agent_0",
    directKnownBy: ["agent_0", "agent_1"],
    place: "clinic",
    severity: 5
  };
}

function testProbabilisticPropagationIsFinite() {
  const world = buildWorld();
  updateSocialField(world);
  const result = propagateInformation(world, [sampleImpact()]);
  assert.ok(result.informationFlows.length >= 1, "must create at least one information flow");
  const flow = result.informationFlows[0];
  assert.ok(flow.knownBy.length > 2, "must spread beyond direct witnesses");
  assert.ok(flow.knownBy.length < world.agents.length, "must not cover every agent");
  assert.ok(flow.transmissions.length >= 1, "must record transmission edges");
  assert.ok(flow.informationPacket.spreadDepth >= 1, "must record spread depth");
}

function testInvalidPropagationRateZero() {
  const world = buildWorld();
  const validIds = new Set(world.agents.map(item => item.id));
  const validChannels = new Set(["same_place", "family", "classmate", "coworker", "neighbor", "friend", "broadcast"]);
  const result = propagateInformation(world, [sampleImpact()]);
  let invalid = 0;
  result.informationFlows.forEach(flow => {
    flow.knownBy.forEach(id => { if (!validIds.has(id)) invalid += 1; });
    flow.transmissions.forEach(tx => {
      if (!validIds.has(tx.from) || !validIds.has(tx.to) || !validChannels.has(tx.channel)) invalid += 1;
      if (tx.channel === "broadcast" && flow.public !== true) invalid += 1;
    });
  });
  assert.equal(invalid, 0, "invalid propagation must be zero");
}

function testSocialFieldChangesAndHasRegionalFields() {
  const world = buildWorld();
  const before = computeSocialField(world);
  const propagated = propagateInformation(world, [sampleImpact()]);
  world.informationFlows.unshift(...propagated.informationFlows);
  world.socialProcesses.push({
    id: "social_1",
    type: "clarification",
    participants: ["agent_0", "agent_1", "agent_4"],
    knownBy: ["agent_0", "agent_1", "agent_4"],
    tension: 70
  });
  const after = updateSocialField(world, {
    eventImpacts: [sampleImpact()],
    informationFlows: propagated.informationFlows,
    affectedAgents: propagated.affectedAgents
  });
  assert.ok(after.fearLevel > before.fearLevel, "fear level should rise after critical event");
  assert.ok(after.informationPressure > before.informationPressure, "information pressure should rise after spreading");
  assert.ok(after.locationFields.clinic, "clinic field must exist");
  assert.ok(after.locationFields.market, "market field must exist");
  assert.notDeepEqual(after.locationFields.clinic, after.locationFields.market, "different areas should have different social fields");
}

function testSocialFieldInfluencesBehaviorScores() {
  const calmWorld = buildWorld();
  const tenseWorld = buildWorld();
  const subjectCalm = calmWorld.agents[8];
  const subjectTense = tenseWorld.agents[8];
  updateSocialField(calmWorld);
  tenseWorld.socialField = {
    version: "3.3",
    timestamp: 720,
    fearLevel: 0.85,
    curiosityLevel: 0.55,
    rumorDensity: 0.72,
    trustNetworkStrength: 0.25,
    socialTension: 0.8,
    informationPressure: 0.78,
    locationFields: {
      apartment: {
        fearLevel: 0.9,
        curiosityLevel: 0.6,
        rumorDensity: 0.75,
        trustNetworkStrength: 0.25,
        socialTension: 0.84,
        informationPressure: 0.8
      }
    }
  };
  const calmDecision = decide(calmWorld, subjectCalm);
  const tenseDecision = decide(tenseWorld, subjectTense);
  const calmSafety = calmDecision.candidateActions.find(item => item.id === "seek_safety");
  const tenseSafety = tenseDecision.candidateActions.find(item => item.id === "seek_safety");
  const calmWalk = calmDecision.candidateActions.find(item => item.id === "walk_nearby");
  const tenseWalk = tenseDecision.candidateActions.find(item => item.id === "walk_nearby");
  assert.ok(tenseSafety.components.socialFieldBias > calmSafety.components.socialFieldBias, "fear should raise safety bias");
  const calmGap = calmSafety.score - calmWalk.score;
  const tenseGap = tenseSafety.score - tenseWalk.score;
  assert.ok(tenseGap > calmGap, "social field should increase behavior divergence");
  assert.ok(tenseSafety.score > tenseWalk.score, "tense field should favor safety over wandering");
  const directBias = socialFieldBiasForAction(tenseWorld, subjectTense, { id: "seek_safety", tags: ["safety"] });
  assert.ok(directBias.score > 0, "direct social field bias must be observable");
}

[
  testProbabilisticPropagationIsFinite,
  testInvalidPropagationRateZero,
  testSocialFieldChangesAndHasRegionalFields,
  testSocialFieldInfluencesBehaviorScores
].forEach(test => {
  test();
  console.log(`PASS ${test.name}`);
});

console.log("PASS check:social-field");

"use strict";

const assert = require("node:assert/strict");
const {
  updateSocialFeedback,
  updateSocialImpressions,
  buildSocialModifier,
  socialFeedbackBiasForAction
} = require("../ai-town-social-feedback");
const { cognitiveState } = require("../ai-town-cognitive-state");
const { utilityDecision } = require("../ai-town-utility-scheduler");

function baseAgent(id = "agent_a", overrides = {}) {
  return {
    id,
    name: id,
    job: "resident",
    ageYears: 35,
    position: "square",
    identityCore: { identity: "stable resident", socialSensitivity: 0.7 },
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
    needs: {
      hunger: 78,
      hygiene: 78,
      health: 80,
      social: 70,
      responsibility: 70,
      stress: 62,
      comfort: 72,
      safety: 82
    },
    emotionVector: {
      happy: 45,
      anxious: 25,
      angry: 8,
      sad: 8,
      tired: 30,
      lonely: 22,
      hopeful: 45,
      calm: 58,
      curious: 35
    },
    memory: { short: [], long: [], emotional: [], secret: [], rumor: [] },
    semanticMemory: { habit: [], experience: [], belief: [], relationship: [], preference: [], goal: [] },
    relationshipMatrix: {},
    ...overrides
  };
}

function baseWorld(agent, overrides = {}) {
  return {
    clock: 600,
    config: { vectorMemoryEnabled: false },
    places: [{ id: "square" }, { id: "apartment" }, { id: "clinic" }],
    agents: [agent],
    households: [],
    groups: [],
    records: [],
    eventLog: [],
    eventImpacts: [],
    informationFlows: [],
    socialProcesses: [],
    socialField: {
      version: "3.3",
      timestamp: 600,
      fearLevel: 0,
      curiosityLevel: 0,
      rumorDensity: 0,
      trustNetworkStrength: 0.55,
      socialTension: 0,
      informationPressure: 0,
      locationFields: {
        square: {
          fearLevel: 0,
          curiosityLevel: 0,
          rumorDensity: 0,
          trustNetworkStrength: 0.55,
          socialTension: 0,
          informationPressure: 0
        }
      }
    },
    ...overrides
  };
}

function criticalFlow(agentId = "agent_a", id = "critical_1") {
  return {
    id: `flow_${id}`,
    impactId: id,
    fact: "critical medical emergency happened nearby",
    source: "agent_source",
    knownBy: ["agent_source", agentId],
    directKnownBy: ["agent_source"],
    transmissions: [{ from: "agent_source", to: agentId, channel: "friend", probability: 0.86, delayMinutes: 12, informationPacket: { confidence: 0.76, distortionLevel: 0.12, emotionalWeight: 0.9, informationType: "critical", spreadDepth: 1 } }],
    rumorRisk: 72,
    informationPacket: {
      content: "critical medical emergency happened nearby",
      source: "agent_source",
      confidence: 0.78,
      distortionLevel: 0.1,
      emotionalWeight: 0.9,
      informationType: "critical",
      spreadDepth: 1
    }
  };
}

function tenseWorld(agent) {
  return baseWorld(agent, {
    socialField: {
      version: "3.3",
      timestamp: 600,
      fearLevel: 0.85,
      curiosityLevel: 0.38,
      rumorDensity: 0.62,
      trustNetworkStrength: 0.28,
      socialTension: 0.78,
      informationPressure: 0.82,
      locationFields: {
        square: {
          fearLevel: 0.9,
          curiosityLevel: 0.45,
          rumorDensity: 0.68,
          trustNetworkStrength: 0.28,
          socialTension: 0.84,
          informationPressure: 0.86
        }
      }
    },
    informationFlows: [criticalFlow(agent.id)]
  });
}

function decide(world, agent, context = {}) {
  const state = cognitiveState(world, agent, context);
  return utilityDecision(state.psychologicalState);
}

function testSocialFieldCanAffectCognitiveState() {
  const calmAgent = baseAgent("agent_a");
  const calm = baseWorld(calmAgent);
  updateSocialFeedback(calm);
  const calmState = cognitiveState(calm, calmAgent);

  const tenseAgent = baseAgent("agent_a");
  const tense = tenseWorld(tenseAgent);
  updateSocialFeedback(tense);
  const tenseState = cognitiveState(tense, tenseAgent);

  assert.ok(tenseState.socialModifier.fearModifier > calmState.socialModifier.fearModifier, "fear modifier should rise");
  assert.ok(tenseState.safetyConcern > calmState.safetyConcern, "safety concern should rise");
  assert.ok(tenseState.perceptionWeights.socialFeedback > calmState.perceptionWeights.socialFeedback, "social feedback should be visible");
}

function testModifiersStayInRange() {
  const agent = baseAgent("agent_a", { identityCore: { socialSensitivity: 1.5 } });
  const world = tenseWorld(agent);
  updateSocialFeedback(world);
  const modifier = world.agentSocialModifiers[0];
  ["fearModifier", "curiosityModifier", "trustModifier", "responsibilityModifier", "avoidanceModifier", "socialNeedModifier", "regulatedSocialEffect"].forEach(key => {
    assert.ok(modifier[key] >= -1 && modifier[key] <= 1, `${key} must stay in [-1,1]`);
  });
  assert.ok(modifier.socialSensitivity >= 0.1 && modifier.socialSensitivity <= 1.5);
}

function testPersonalitySensitivityDiffers() {
  const low = baseAgent("agent_low", { identityCore: { socialSensitivity: 0.2 } });
  const high = baseAgent("agent_high", { identityCore: { socialSensitivity: 1.2 } });
  const lowWorld = tenseWorld(low);
  lowWorld.informationFlows = [criticalFlow(low.id)];
  const highWorld = tenseWorld(high);
  highWorld.informationFlows = [criticalFlow(high.id)];
  const lowMod = buildSocialModifier(lowWorld, low);
  const highMod = buildSocialModifier(highWorld, high);
  assert.ok(Math.abs(highMod.regulatedSocialEffect) > Math.abs(lowMod.regulatedSocialEffect), "high sensitivity should react more");
  assert.ok(highMod.fearModifier > lowMod.fearModifier, "high sensitivity should produce stronger fear modifier");
}

function testSocialImpressionDecay() {
  const agent = baseAgent("agent_a");
  agent.socialImpressions = [{
    eventId: "old_fear",
    category: "community_fear",
    emotionalImpact: 0.9,
    strength: 1,
    decayRate: 0.2,
    lastUpdate: 0,
    relatedAgents: []
  }];
  const world = baseWorld(agent, { clock: 600 });
  const impressions = updateSocialImpressions(world, agent);
  assert.ok(impressions[0].strength < 1, "impression strength should decay");
  assert.ok(impressions[0].strength > 0.05, "strong impression should not vanish instantly");
}

function testSocialImpressionConsolidates() {
  const agent = baseAgent("agent_a");
  const flows = [];
  for (let i = 0; i < 100; i += 1) {
    flows.push({
      ...criticalFlow(agent.id, `critical_${i}`),
      fact: `critical medical emergency rumor ${i}`
    });
  }
  const world = tenseWorld(agent);
  world.informationFlows = flows;
  updateSocialFeedback(world);
  assert.ok(agent.socialImpressions.length <= 12, "social impressions must be capped");
  const categories = new Set(agent.socialImpressions.map(item => item.category));
  assert.ok(categories.size <= agent.socialImpressions.length, "impressions should be category based");
  assert.ok(agent.socialImpressions.some(item => item.eventId.includes("aggregate") || item.sourceEvents?.length > 1), "same category should consolidate");
}

function testSchedulerScoreChanges() {
  const calmAgent = baseAgent("agent_a", { identityCore: { socialSensitivity: 1.2 } });
  const calm = baseWorld(calmAgent);
  updateSocialFeedback(calm);
  const calmDecision = decide(calm, calmAgent);
  const calmSafety = calmDecision.candidateActions.find(item => item.id === "seek_safety");

  const tenseAgent = baseAgent("agent_a", { identityCore: { socialSensitivity: 1.2 } });
  const tense = tenseWorld(tenseAgent);
  updateSocialFeedback(tense);
  const tenseDecision = decide(tense, tenseAgent);
  const tenseSafety = tenseDecision.candidateActions.find(item => item.id === "seek_safety");

  assert.ok(tenseSafety.components.socialValue > calmSafety.components.socialValue, "social value should rise through S(t)");
  assert.ok(tenseSafety.score > calmSafety.score, "scheduler score should visibly change");
  const direct = socialFeedbackBiasForAction(tense, tenseAgent, { id: "seek_safety", tags: ["safety"] });
  assert.ok(direct.score > 0, "direct social feedback bias should be positive for safety action");
}

[
  testSocialFieldCanAffectCognitiveState,
  testModifiersStayInRange,
  testPersonalitySensitivityDiffers,
  testSocialImpressionDecay,
  testSocialImpressionConsolidates,
  testSchedulerScoreChanges
].forEach(test => {
  test();
  console.log(`PASS ${test.name}`);
});

console.log("PASS check:social-feedback");

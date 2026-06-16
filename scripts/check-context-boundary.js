"use strict";

const assert = require("node:assert/strict");
const {
  DEFAULT_CONTEXT_BUDGET,
  estimateContextTokens,
  findForbiddenPromptKeys,
  generateAgentRuntimeSummary,
  buildAgentContext,
  buildWorldContext,
  buildSchedulerContext,
  buildRuntimeSummaryCache
} = require("../ai-town-context-builder");

function makeAgent(index, overrides = {}) {
  return {
    id: `agent_${index}`,
    name: `Agent ${index}`,
    job: index % 7 === 0 ? "doctor" : index % 5 === 0 ? "teacher" : "resident",
    ageStage: index % 6 === 0 ? "elder" : index % 4 === 0 ? "teen" : "adult",
    position: `place_${index % 12}`,
    lifeStatus: "alive",
    currentTask: "routine town life",
    needs: {
      hunger: 60 + (index % 30),
      health: 70 + (index % 20),
      safety: 65 + (index % 25),
      social: 40 + (index % 45),
      responsibility: 50 + (index % 40),
      comfort: 55 + (index % 35)
    },
    emotionVector: {
      happy: 40 + (index % 40),
      anxious: index % 50,
      tired: index % 60,
      lonely: index % 45,
      curious: index % 70
    },
    identityCore: {
      identity: "a local resident with stable personal habits",
      values: ["family", "responsibility"],
      fears: ["instability"],
      socialSensitivity: overrides.socialSensitivity ?? 0.7
    },
    personalityProfile: {
      values: ["order"],
      habits: ["keeps a regular routine"]
    },
    cognitiveProfile: {
      riskTolerance: 0.4,
      curiosity: 0.5,
      routinePreference: 0.6,
      socialDrive: 0.5,
      empathy: 0.5,
      conflictAvoidance: 0.5,
      patience: 0.5,
      ambition: 0.4
    },
    decisionWeights: {
      memoryWeight: 0.6,
      personalityWeight: 0.7,
      emotionWeight: 0.5,
      goalWeight: 0.6,
      noveltyWeight: 0.3,
      socialWeight: 0.5
    },
    memorySummary: "Recent life is generally stable, with occasional health and work pressure.",
    memory: { short: ["raw short memory should not pass"], long: ["raw long memory should not pass"] },
    vectorMemory: [{ scene: "large vector scene", embedding: Array.from({ length: 256 }, () => 0.01) }],
    relationshipMatrix: { agent_1: { trust: 80, resentment: 2 } },
    cognitiveState: { full: true, driveVector: { comfort: 1 }, privateTrace: "must not pass" },
    debugDecision: { secret: "must not pass" },
    beliefMemory: [{ belief: "Health should not be ignored", strength: 0.7 }],
    habitMemory: [{ habit: "goes home when tired", probability: 0.6 }],
    preferenceMemory: [{ preference: "quiet places", strength: 0.7 }],
    episodicMemory: [{ event: "once had to stop work due to health", importance: 0.8 }],
    utilityDecision: {
      priority: index % 100,
      candidateActions: [
        { id: "rest", type: "rest", label: "rest quietly", score: 0.7 },
        { id: "work", type: "work", label: "continue work", score: 0.5 }
      ],
      cognitiveState: { full: true },
      debugDecision: { leak: true }
    },
    ...overrides
  };
}

function makeWorld(count = 100) {
  const agents = Array.from({ length: count }, (_, index) => makeAgent(index));
  return {
    clock: 720,
    weatherBox: { calendar: { day: 1, hour: 12 }, current: "clear" },
    agents,
    places: Array.from({ length: 30 }, (_, index) => ({
      id: `place_${index}`,
      name: `Place ${index}`,
      type: index % 5 === 0 ? "clinic" : "public"
    })),
    records: Array.from({ length: 50 }, (_, index) => ({
      title: `Record ${index}`,
      type: "event",
      body: "A compact event summary used for replay.",
      agents: [`agent_${index % count}`],
      clock: 700 + index
    })),
    eventImpacts: Array.from({ length: 20 }, (_, index) => ({
      id: `impact_${index}`,
      eventId: `impact_${index}`,
      title: `Impact ${index}`,
      summary: "An event changed local attention slightly.",
      knownBy: [`agent_${index % count}`],
      severity: 2
    })),
    informationFlows: Array.from({ length: 40 }, (_, index) => ({
      id: `flow_${index}`,
      fact: "A piece of local information spread through nearby residents.",
      knownBy: [`agent_${index % count}`, `agent_${(index + 1) % count}`],
      confidence: 0.8,
      distortionLevel: 0.1
    })),
    socialField: {
      fearLevel: 0.2,
      curiosityLevel: 0.4,
      rumorDensity: 0.3,
      trustNetworkStrength: 0.6,
      socialTension: 0.2,
      informationPressure: 0.3
    },
    socialProcesses: [],
    relationshipDynamics: []
  };
}

function assertNoForbidden(context, label) {
  const found = findForbiddenPromptKeys(context);
  assert.deepEqual(found, [], `${label} leaked forbidden keys: ${found.join(", ")}`);
}

function test100AgentPromptSize() {
  const world = makeWorld(100);
  const context = buildWorldContext({ world, agents: world.agents, budget: 20000 });
  assertNoForbidden(context, "100-agent world context");
  assert.ok(estimateContextTokens(context) < 20000, `100-agent context too large: ${estimateContextTokens(context)}`);
  console.log("PASS test100AgentPromptSize");
}

function test500AgentBudget() {
  const world = makeWorld(500);
  const context = buildWorldContext({ world, agents: world.agents, budget: DEFAULT_CONTEXT_BUDGET.worldAgent });
  assertNoForbidden(context, "500-agent world context");
  assert.ok(estimateContextTokens(context) <= DEFAULT_CONTEXT_BUDGET.worldAgent, `500-agent context over budget: ${estimateContextTokens(context)}`);
  const cache = buildRuntimeSummaryCache(world);
  assert.equal(cache.populationSummary.total, 500);
  assert.equal(cache.agentSummary.length, 500);
  console.log("PASS test500AgentBudget");
}

function testSummaryConsistency() {
  const world = makeWorld(20);
  const summary = generateAgentRuntimeSummary(world.agents[0], world);
  assert.equal(summary.id, "agent_0");
  assert.equal(summary.location, "place_0");
  assert.ok(summary.currentNeed.lowest.length > 0);
  assert.ok(summary.importantMemory.length > 0);
  console.log("PASS testSummaryConsistency");
}

function testAgentAndSchedulerIsolation() {
  const world = makeWorld(12);
  const agent = makeAgent(99, { socialSensitivity: 0 });
  world.agents[0] = agent;
  const agentContext = buildAgentContext({
    world,
    agent,
    candidate: { agentId: agent.id, utilityDecision: agent.utilityDecision },
    utility: agent.utilityDecision,
    place: world.places[0],
    visibleAgents: world.agents.slice(1, 4),
    relevantMemories: [{ text: "A relevant memory summary", importance: 0.8 }]
  });
  const schedulerContext = buildSchedulerContext({ world, dueAgents: world.agents, maxActions: 3 });
  assertNoForbidden(agentContext, "agent context");
  assertNoForbidden(schedulerContext, "scheduler context");
  assert.equal(agentContext.agent.personalityCore.identity.includes("resident"), true);
  assert.ok(estimateContextTokens(agentContext) <= DEFAULT_CONTEXT_BUDGET.agentAction);
  assert.ok(estimateContextTokens(schedulerContext) <= DEFAULT_CONTEXT_BUDGET.scheduler);
  console.log("PASS testAgentAndSchedulerIsolation");
}

function main() {
  test100AgentPromptSize();
  test500AgentBudget();
  testSummaryConsistency();
  testAgentAndSchedulerIsolation();
  console.log("PASS check:context-boundary");
}

main();

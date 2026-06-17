"use strict";

const assert = require("node:assert/strict");
const {
  recordLifeEvent,
  runDailyReflection
} = require("../ai-town-memory-stream");
const {
  causalStrength,
  causalReflectionAnchors
} = require("../ai-town-causal-graph");

function baseAgent(overrides = {}) {
  return {
    id: "agent_1",
    name: "钱芳仪",
    position: "store",
    needs: { hunger: 80, health: 75, safety: 78, social: 70, stress: 62 },
    memory: { short: [], long: [], emotional: [], secret: [], rumor: [] },
    relationshipMatrix: {
      agent_friend: { trust: 82, intimacy: 70, familiarity: 80 }
    },
    ...overrides
  };
}

function baseWorld(agent, clock = 600) {
  return {
    clock,
    config: { causalGraphThreshold: 0.32 },
    agents: [agent],
    places: [{ id: "store" }, { id: "clinic" }],
    eventLog: []
  };
}

function healthEvent(id = "health_1") {
  return {
    id,
    type: "health_rest",
    interruption: { type: "health", priority: 96, canOverridePlan: true, reason: "health critical" },
    summary: "钱芳仪身体明显不适，中断安排并去诊所处理。",
    emotionDelta: { anxious: 34, tired: 22, hopeful: -10 },
    goalImpact: 82,
    contextScope: "self"
  };
}

function ordinaryEvent(id = "ordinary_1") {
  return {
    id,
    type: "observe",
    summary: "钱芳仪注意到街上有普通人经过。",
    abnormality: 6,
    emotionalIntensity: 4,
    futureImpact: 5,
    emotionDelta: { calm: 1 },
    contextScope: "same_place"
  };
}

function rainEvent(id, clock) {
  return {
    id,
    type: "weather_business",
    summary: "雨天导致小店客流下降，钱芳仪提前调整备货。",
    abnormality: 78,
    emotionalIntensity: 48,
    futureImpact: 82,
    emotionDelta: { anxious: 20, tired: 8 },
    goalImpact: 86,
    relationshipDelta: { customerTrust: 18 },
    contextScope: "self",
    clock
  };
}

function assertNoFutureEdges(graph) {
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  graph.edges.forEach(edge => {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    assert.ok(from, `missing from node ${edge.from}`);
    assert.ok(to, `missing to node ${edge.to}`);
    assert.ok(Number(from.timestamp) < Number(to.timestamp), `future-to-past edge: ${edge.from} -> ${edge.to}`);
  });
}

function testCausalStrengthShape() {
  const low = causalStrength({ eventImpact: 5, emotionChange: 4, goalChange: 5, relationshipChange: 2 });
  const high = causalStrength({ eventImpact: 95, emotionChange: 72, goalChange: 86, relationshipChange: 40 });
  assert.ok(low.strength < high.strength);
  assert.ok(high.strength > 0.5);
  assert.equal(typeof high.dimensions.eventImpact, "number");
  console.log(JSON.stringify({ low: low.strength, high: high.strength }, null, 2));
}

function testImportantEventCreatesGraph() {
  const agent = baseAgent();
  const world = baseWorld(agent, 700);
  const result = recordLifeEvent(world, agent, healthEvent());
  assert.ok(result.causalGraph);
  assert.equal(result.event.causalGraph.skipped, false);
  assert.ok(world.causalGraph.nodes.some(node => node.type === "event"));
  assert.ok(world.causalGraph.nodes.some(node => node.type === "action"));
  assert.ok(world.causalGraph.nodes.some(node => node.type === "stateChange"));
  assert.ok(world.causalGraph.nodes.some(node => node.type === "belief"));
  assert.ok(world.causalGraph.edges.length >= 2);
  assertNoFutureEdges(world.causalGraph);
}

function testOrdinaryEventDoesNotCreateGraph() {
  const agent = baseAgent();
  const world = baseWorld(agent, 720);
  recordLifeEvent(world, agent, ordinaryEvent());
  assert.equal(world.causalGraph?.nodes?.length || 0, 0);
  assert.equal(world.causalGraph?.edges?.length || 0, 0);
  assert.equal(world.eventLog.length, 1);
}

function testRepeatedPatternReinforcesEdges() {
  const agent = baseAgent();
  const world = baseWorld(agent, 800);
  [0, 1, 2, 3].forEach(index => {
    world.clock = 800 + index * 60;
    recordLifeEvent(world, agent, rainEvent(`rain_${index}`, world.clock));
  });
  const patterns = world.causalGraph.patterns.filter(pattern => pattern.count >= 2);
  assert.ok(patterns.length >= 1);
  assert.ok(Math.max(...patterns.map(pattern => pattern.strength)) > 0.7);
  assertNoFutureEdges(world.causalGraph);
}

function testReflectionReadsCausalChain() {
  const agent = baseAgent();
  const world = baseWorld(agent, 1440);
  recordLifeEvent(world, agent, healthEvent("health_reflection"));
  const anchors = causalReflectionAnchors(world, agent, 3);
  assert.ok(anchors.length >= 1);
  assert.ok(anchors[0].lessonLearned);
  assert.ok(anchors[0].counterfactual);
  runDailyReflection(world, { force: true });
  assert.ok(Array.isArray(agent.reflection.causalAnchors));
  assert.ok(agent.reflection.lessonLearned);
  assert.ok(agent.reflection.counterfactual);
}

[
  testCausalStrengthShape,
  testImportantEventCreatesGraph,
  testOrdinaryEventDoesNotCreateGraph,
  testRepeatedPatternReinforcesEdges,
  testReflectionReadsCausalChain
].forEach(test => {
  test();
  console.log(`PASS ${test.name}`);
});

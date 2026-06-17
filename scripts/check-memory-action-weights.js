"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {
  appendMemory,
  migrateMemoryPerspectiveForAgent,
  recordLifeEvent
} = require("../ai-town-memory-stream");

const serverPath = path.join(__dirname, "..", "ai-town-v2-server.js");
const source = fs.readFileSync(serverPath, "utf8");

function extractFunction(name) {
  const start = source.indexOf(`function ${name}`);
  if (start < 0) throw new Error(`Missing function ${name}`);
  const headerEnd = source.indexOf(") {", start);
  if (headerEnd < 0) throw new Error(`Missing function body ${name}`);
  const brace = source.indexOf("{", headerEnd);
  let depth = 0;
  for (let i = brace; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Unclosed function ${name}`);
}

const sandbox = {
  console,
  clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, number));
  }
};
vm.createContext(sandbox);
[
  "nodeRuntimePlaceId",
  "nodeRuntimeMemoryItems",
  "nodeRuntimeBumpWeighted",
  "nodeRuntimeEmotionModulation",
  "nodeRuntimeScaleWeightedList",
  "nodeRuntimeMemoryActionWeights",
  "nodeRuntimeApplyMemoryActionGuard"
].forEach(name => vm.runInContext(`${extractFunction(name)}; this.${name} = ${name};`, sandbox));

function baseWorld(agent) {
  return {
    places: [{ id: "river", name: "river" }, { id: "clinic", name: "clinic" }],
    agents: [agent],
    clock: 600
  };
}

function baseAgent(emotionVector) {
  return {
    id: "a",
    name: "A",
    position: "square",
    needs: { hunger: 80, health: 80, safety: 80, stress: 80 },
    emotionVector,
    memory: {
      emotional: [{ text: "river accident hurt fear", importance: 5, strength: 90 }],
      short: [],
      long: [],
      secret: [],
      rumor: []
    },
    identityCore: { biases: { riskAvoidance: 50, askForHelp: 50, conflictAvoidance: 50 } }
  };
}

function proposedMove() {
  return { action: { type: "move", newLocation: "river", summary: "go look around", currentTask: "walk to river" } };
}

const curious = baseAgent({ curious: 95, hopeful: 75, calm: 75, anxious: 5, tired: 5, lonely: 15, angry: 5 });
const curiousGuard = sandbox.nodeRuntimeApplyMemoryActionGuard(baseWorld(curious), curious, proposedMove());
assert.equal(curiousGuard.action.newLocation, "river");

const anxious = baseAgent({ curious: 10, hopeful: 20, calm: 10, anxious: 95, tired: 80, lonely: 20, angry: 20 });
const anxiousGuard = sandbox.nodeRuntimeApplyMemoryActionGuard(baseWorld(anxious), anxious, proposedMove());
assert.equal(anxiousGuard.action.newLocation, "");
assert.equal(anxiousGuard.action.type, "observe");
assert.ok(anxiousGuard.action.memoryGuard.threshold <= anxiousGuard.action.memoryGuard.weight);

const weights = sandbox.nodeRuntimeMemoryActionWeights(baseWorld(anxious), anxious);
assert.ok(weights.emotionModulation.avoidanceDrive > weights.emotionModulation.explorationDrive);

function testMemorySelfExperiencePerspective() {
  const agent = {
    id: "self_memory_agent",
    name: "测试居民",
    needs: {},
    identityCore: {},
    relationshipMatrix: {}
  };
  const belief = appendMemory(agent, {
    type: "belief",
    text: 'This person tends to judge choices through the value "稳定生活".',
    meaning: 'This person tends to judge choices through the value "稳定生活".',
    at: 1,
    importance: 3
  });
  assert.ok(belief, "system template belief should be normalized instead of dropped");
  assert.match(belief.text, /^我/);
  assert.doesNotMatch(JSON.stringify(agent), /This person|Stable habit|Agent tends|Daily reflection/i);
}

function testMigrationCleansExistingLongTermMemory() {
  const agent = {
    id: "migration_agent",
    name: "迁移居民",
    semanticMemory: {
      habit: [{ id: "h1", type: "habit", text: "Stable habit: returns home under stress", meaning: "Stable habit: returns home under stress", at: 1, importance: 3 }],
      belief: [{ id: "b1", type: "belief", text: 'This person tends to judge choices through the value "责任".', meaning: 'This person tends to judge choices through the value "责任".', at: 1, importance: 3 }]
    }
  };
  migrateMemoryPerspectiveForAgent(agent, { clock: 20, agents: [agent], eventLog: [] });
  const text = JSON.stringify({
    semanticMemory: agent.semanticMemory,
    structuredMemory: agent.structuredMemory,
    beliefMemory: agent.beliefMemory,
    habitMemory: agent.habitMemory,
    memorySummary: agent.memorySummary
  });
  assert.doesNotMatch(text, /This person|Stable habit|Agent tends|Daily reflection|Followed plan/i);
  assert.ok((agent.beliefMemory || []).every(item => /^我/.test(item.belief)));
  assert.ok((agent.habitMemory || []).every(item => /^我/.test(item.habit)));
}

function testMeaningfulEventCreatesEpisodicMemory() {
  const agent = {
    id: "episodic_agent",
    name: "经历居民",
    position: "clinic",
    needs: { health: 35 },
    identityCore: {},
    relationshipMatrix: {}
  };
  const world = { clock: 100, agents: [agent], eventLog: [], places: [] };
  recordLifeEvent(world, agent, {
    type: "health",
    summary: "health clinic visit changed plan",
    interruption: { type: "health", priority: 80, canOverridePlan: true },
    emotionDelta: { anxious: 28 },
    goalImpact: 80,
    healthChange: 20
  });
  assert.ok((agent.episodicMemory || []).length >= 1, "meaningful health event should create episodic memory");
  assert.match(agent.episodicMemory[0].myExperience || agent.episodicMemory[0].event, /^我/);
}

testMemorySelfExperiencePerspective();
testMigrationCleansExistingLongTermMemory();
testMeaningfulEventCreatesEpisodicMemory();

console.log("PASS memory action weights emotion modulation");

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { resolveLocalAction } = require("../ai-town-local-action-resolver");
const { recordLifeEvent } = require("../ai-town-memory-stream");

const ROOT = path.resolve(__dirname, "..");
const serverSource = fs.readFileSync(path.join(ROOT, "ai-town-v2-server.js"), "utf8");

function extractFunction(name) {
  const start = serverSource.indexOf(`function ${name}`);
  if (start < 0) throw new Error(`Missing function ${name}`);
  const headerEnd = serverSource.indexOf(") {", start);
  if (headerEnd < 0) throw new Error(`Missing function body ${name}`);
  const brace = serverSource.indexOf("{", headerEnd);
  let depth = 0;
  for (let i = brace; i < serverSource.length; i += 1) {
    if (serverSource[i] === "{") depth += 1;
    else if (serverSource[i] === "}") {
      depth -= 1;
      if (depth === 0) return serverSource.slice(start, i + 1);
    }
  }
  throw new Error(`Unclosed function ${name}`);
}

function loadServerHelpers() {
  const sandbox = { console };
  vm.createContext(sandbox);
  [
    "nodeRuntimeIsSystemErrorText",
    "nodeRuntimeObjectText",
    "nodeRuntimeIsSystemErrorObject",
    "nodeRuntimePropagationSignature",
    "nodeRuntimeDedupeSocialProcesses"
  ].forEach(name => vm.runInContext(`${extractFunction(name)}; this.${name} = ${name};`, sandbox));
  return sandbox;
}

function baseAgent(overrides = {}) {
  return {
    id: "agent_a",
    name: "测试居民",
    position: "square",
    place: "square",
    homePlace: "apartment",
    ageYears: 40,
    needs: { hunger: 80, hygiene: 80, health: 80, social: 80, responsibility: 70, stress: 70, comfort: 70, safety: 80 },
    emotionVector: { tired: 20, anxious: 20, lonely: 10 },
    relationshipMatrix: { agent_b: { trust: 70, familiarity: 65 } },
    memory: { short: [], long: [], emotional: [], secret: [], rumor: [] },
    semanticMemory: {},
    eventLog: [],
    ...overrides
  };
}

function baseWorld(agent) {
  return {
    clock: 600,
    config: { memoryImportanceThreshold: 0.12 },
    places: [
      { id: "square", name: "广场", type: "public" },
      { id: "clinic", name: "诊所", type: "medical" },
      { id: "apartment", name: "公寓", type: "home" },
      { id: "breakfast", name: "早餐铺", type: "food" }
    ],
    agents: [agent, { id: "agent_b", name: "熟人", position: "square", place: "square" }],
    eventLog: [],
    records: [],
    logs: []
  };
}

function invalidJsonError(index) {
  const error = new Error(`AI returned invalid JSON on attempt ${index}`);
  error.type = "invalid_json";
  return error;
}

function testLocalResolverAfterThreeFailures() {
  const agent = baseAgent({ needs: { hunger: 80, hygiene: 80, health: 12, social: 80, responsibility: 70, stress: 70, comfort: 70, safety: 80 } });
  const world = baseWorld(agent);
  const errors = [invalidJsonError(1), invalidJsonError(2), invalidJsonError(3)];
  const result = resolveLocalAction(world, agent, {
    utilityDecision: { selectedAction: { id: "seek_care", type: "move", targetPlace: "clinic" } }
  }, { attempts: 3, errors });
  assert.equal(result.action.sourceType, "local");
  assert.equal(result.action.source, "local_policy");
  assert.equal(result.action.actionId, "seek_care");
  assert.equal(result.action.newLocation, "clinic");
  assert(!/AI returned invalid JSON|system_error|停下整理思路/.test(JSON.stringify(result.action)));
}

function testLocalEventMemoryFactor() {
  const agent = baseAgent();
  const world = baseWorld(agent);
  const result = recordLifeEvent(world, agent, {
    type: "health",
    summary: "health concern required a careful local action",
    source: "agent-action-recovery",
    sourceType: "local",
    interruption: { type: "health", priority: 90, canOverridePlan: true },
    healthChange: -20,
    emotionalIntensity: 80,
    futureImpact: 80
  });
  assert(result);
  assert.equal(result.event.sourceType, "local");
  assert.equal(result.event.memoryGate.sourceFactor, 0.5);
  assert.equal(world.eventLog.length, 1);
}

function testSystemErrorEventRejected() {
  const agent = baseAgent();
  const world = baseWorld(agent);
  const result = recordLifeEvent(world, agent, {
    type: "agentAction",
    summary: "AI returned invalid JSON, character paused due to system_error",
    sourceType: "system_error"
  });
  assert.equal(result, null);
  assert.equal(world.eventLog.length, 0);
  assert.equal(agent.eventLog.length, 0);
}

function testSocialProcessFilterAndDedupe() {
  const helpers = loadServerHelpers();
  assert.equal(helpers.nodeRuntimeIsSystemErrorText("AI returned invalid JSON"), true);
  const clean = {
    id: "process-a",
    type: "clarification",
    participants: ["agent_a", "agent_b"],
    truth: "normal social process",
    stage: "noticed"
  };
  const duplicate = { ...clean, tension: 20 };
  const dirty = {
    id: "process-ai-error-1",
    type: "misunderstanding",
    participants: ["agent_a", "agent_b"],
    truth: "AI 返回格式错误，角色暂时停在原地整理思路",
    stage: "noticed"
  };
  const result = helpers.nodeRuntimeDedupeSocialProcesses([dirty, clean, duplicate]);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "process-a");
}

function testStrictJsonAgentActionNoFallback() {
  const retrySetBlock = serverSource.slice(serverSource.indexOf("const retryJsonTasks"), serverSource.indexOf("const fallback = fallbackJson", serverSource.indexOf("const retryJsonTasks")));
  assert(retrySetBlock.includes("\"agentAction\""));
  assert(serverSource.includes("nodeRuntimeGenerateAgentAction"));
}

function main() {
  testLocalResolverAfterThreeFailures();
  testLocalEventMemoryFactor();
  testSystemErrorEventRejected();
  testSocialProcessFilterAndDedupe();
  testStrictJsonAgentActionNoFallback();
  console.log("PASS check-agent-action-recovery");
}

main();

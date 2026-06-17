"use strict";

const assert = require("node:assert/strict");
const { memoryGate, recordLifeEvent } = require("../ai-town-memory-stream");

function agent(overrides = {}) {
  return {
    id: "agent_1",
    name: "钱芳仪",
    position: "apartment",
    needs: { hunger: 80, health: 80, safety: 80, stress: 80 },
    memory: { short: [], long: [], emotional: [], secret: [], rumor: [] },
    relationshipMatrix: {
      friend: { trust: 80, intimacy: 72, familiarity: 86 }
    },
    ...overrides
  };
}

function world(a, overrides = {}) {
  return {
    clock: overrides.clock ?? 10000,
    config: {
      memoryImportanceThreshold: 0.15,
      memoryNormalization: { method: "log" },
      ...(overrides.config || {})
    },
    places: [{ id: "apartment" }, { id: "clinic" }],
    agents: [a],
    eventLog: []
  };
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[index];
}

function ordinaryEvent(i) {
  return {
    id: `ordinary_${i}`,
    clock: 10000,
    agentId: "agent_1",
    type: "minor_observation",
    category: "exception",
    summary: "钱芳仪注意到普通街道动静。",
    abnormality: 4 + (i % 10),
    emotionalIntensity: 2 + (i % 8),
    futureImpact: 3 + (i % 10),
    emotionDelta: { curious: i % 3 },
    contextScope: "same_place"
  };
}

function majorEvent(i) {
  const social = i % 2 === 0;
  return {
    id: `major_${i}`,
    clock: 10000,
    agentId: "agent_1",
    targetAgentId: social ? "friend" : "",
    type: social ? "social_help" : "health_rest",
    category: "exception",
    summary: social
      ? "朋友帮助钱芳仪处理困难，关系信任明显增加。"
      : "钱芳仪身体明显不适，被迫中断安排并求助。",
    interruption: social ? null : { type: "health", priority: 95, canOverridePlan: true, reason: "health critical" },
    abnormality: 84 + (i % 12),
    emotionalIntensity: 66 + (i % 18),
    futureImpact: 78 + (i % 18),
    emotionDelta: social ? { hopeful: 28, calm: 16 } : { anxious: 34, tired: 20, hopeful: -12 },
    relationshipDelta: social ? { trust: 24, intimacy: 10 } : undefined,
    goalImpact: 74 + (i % 16),
    contextScope: social ? "close_relation" : "self"
  };
}

function calibratedEvent(i) {
  const event = 18 + ((i * 37) % 78);
  const emotion = 8 + ((i * 19) % 42);
  const relation = 10 + ((i * 23) % 40);
  const goal = 18 + ((i * 29) % 78);
  return {
    id: `calibrated_${i}`,
    clock: 10000,
    agentId: "agent_1",
    targetAgentId: i % 3 === 0 ? "friend" : "",
    type: i % 4 === 0 ? "goal_progress" : i % 4 === 1 ? "social_help" : i % 4 === 2 ? "health_rest" : "work_result",
    category: "exception",
    summary: "一次会影响之后判断的生活事件。",
    abnormality: event,
    emotionalIntensity: emotion,
    futureImpact: goal,
    emotionDelta: i % 2 ? { hopeful: emotion / 2, calm: emotion / 4 } : { anxious: emotion / 2, tired: emotion / 5 },
    relationshipDelta: i % 3 === 0 ? { trust: relation } : undefined,
    relationImpact: i % 3 === 0 ? relation : 25,
    goalImpact: goal,
    contextScope: i % 3 === 0 ? "close_relation" : "self"
  };
}

function extremeEmotionOnlyEvent(i) {
  return {
    id: `emotion_extreme_${i}`,
    clock: 10000,
    agentId: "agent_1",
    type: "mood_spike",
    category: "exception",
    summary: "钱芳仪短时间情绪波动很强，但事情本身很普通。",
    abnormality: 6 + (i % 4),
    emotionalIntensity: 100,
    futureImpact: 4,
    emotionDelta: { anxious: 80, angry: 60 },
    relationImpact: 0,
    goalImpact: 3,
    contextScope: "self"
  };
}

function writeRate(events) {
  const a = agent();
  const w = world(a);
  const gates = events.map(event => memoryGate(w, a, event));
  return gates.filter(gate => gate.shouldRemember).length / gates.length;
}

function testWriteRates() {
  const ordinaryRate = writeRate(Array.from({ length: 1000 }, (_, i) => ordinaryEvent(i)));
  const majorRate = writeRate(Array.from({ length: 1000 }, (_, i) => majorEvent(i)));
  console.log(JSON.stringify({ ordinaryRate, majorRate }, null, 2));
  assert.ok(ordinaryRate < 0.1, "ordinary event write rate should stay below 10%");
  assert.ok(majorRate > 0.8, "major event write rate should stay above 80%");
}

function testDistributionShape() {
  const a = agent();
  const w = world(a);
  const values = Array.from({ length: 10000 }, (_, i) => memoryGate(w, a, calibratedEvent(i)).importance);
  const p50 = percentile(values, 0.5);
  const p95 = percentile(values, 0.95);
  console.log(JSON.stringify({ p50, p95 }, null, 2));
  assert.ok(p50 >= 0.3 && p50 <= 0.6, "importance p50 should be approximately 0.3~0.6");
  assert.ok(p95 < 0.9, "importance p95 should stay below 0.9");
}

function testExtremeEmotionDoesNotDominate() {
  const rate = writeRate(Array.from({ length: 1000 }, (_, i) => extremeEmotionOnlyEvent(i)));
  console.log(JSON.stringify({ extremeEmotionOnlyWriteRate: rate }, null, 2));
  assert.ok(rate < 0.25, "extreme emotion alone should not dominate long-memory writes");
}

function testTimeDecay() {
  const a = agent();
  const recentWorld = world(a, { clock: 10000 });
  const oldWorld = world(agent(), { clock: 10000 });
  const recent = memoryGate(recentWorld, a, { ...majorEvent(1), clock: 10000 }).importance;
  const old = memoryGate(oldWorld, oldWorld.agents[0], { ...majorEvent(1), clock: 8200, memoryTypeHint: "episodic" }).importance;
  console.log(JSON.stringify({ recent, old }, null, 2));
  assert.ok(old < recent, "older episodic event should decay");
}

function testMemoryCompression() {
  const a = agent();
  const w = world(a);
  for (let i = 0; i < 100; i += 1) {
    recordLifeEvent(w, a, {
      ...majorEvent(i * 2),
      id: `repeat_help_${i}`,
      summary: `朋友第${i + 1}次帮助钱芳仪处理类似困难，关系信任增加。`
    });
  }
  const relationship = a.semanticMemory.relationship || [];
  const compressed = relationship.find(item => Number(item.count || 0) > 1);
  assert.ok(relationship.length < 20, "similar relationship memories should be compressed");
  assert.ok(compressed, "compressed memory should keep count");
  assert.ok(Number(compressed.averageImportance || 0) > 0, "compressed memory should keep averageImportance");
}

[
  testWriteRates,
  testDistributionShape,
  testExtremeEmotionDoesNotDominate,
  testTimeDecay,
  testMemoryCompression
].forEach(test => {
  test();
  console.log(`PASS ${test.name}`);
});

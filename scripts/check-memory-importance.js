"use strict";

const assert = require("node:assert/strict");
const { memoryGate, recordLifeEvent, appendMemory } = require("../ai-town-memory-stream");

function agent(overrides = {}) {
  return {
    id: "agent_1",
    name: "钱芳仪",
    position: "apartment",
    needs: { hunger: 80, health: 80, safety: 80, social: 70, stress: 70 },
    memory: { short: [], long: [], emotional: [], secret: [], rumor: [] },
    relationshipMatrix: {
      agent_friend: { trust: 82, intimacy: 70, familiarity: 80 }
    },
    ...overrides
  };
}

function world(a) {
  return {
    clock: 600,
    config: {
      memoryImportanceWeights: { event: 1, emotion: 1.5, relation: 1.3, goal: 1.2 },
      memoryImportanceThreshold: 0.15
    },
    places: [{ id: "apartment" }, { id: "clinic" }],
    agents: [a],
    eventLog: []
  };
}

function ordinaryEvent(index) {
  return {
    id: `ordinary_${index}`,
    clock: index,
    agentId: "agent_1",
    place: "apartment",
    type: index % 2 ? "observe" : "minor_move",
    category: "exception",
    summary: index % 2 ? "looked around the room" : "noticed ordinary street movement",
    abnormality: 8 + (index % 8),
    emotionalIntensity: 4 + (index % 6),
    futureImpact: 5 + (index % 7),
    emotionDelta: { calm: 1 },
    contextScope: "self"
  };
}

function majorEvent(index) {
  if (index % 2) {
    return {
      id: `major_health_${index}`,
      clock: index,
      agentId: "agent_1",
      place: "apartment",
      type: "health_rest",
      category: "exception",
      summary: "钱芳仪身体明显不适，被迫中断安排并寻求帮助。",
      interruption: { type: "health", priority: 96, canOverridePlan: true, reason: "health critical" },
      abnormality: 96,
      emotionalIntensity: 74,
      futureImpact: 88,
      emotionDelta: { anxious: 34, tired: 25, hopeful: -14 },
      goalImpact: 82,
      contextScope: "self"
    };
  }
  return {
    id: `major_social_${index}`,
    clock: index,
    agentId: "agent_1",
    targetAgentId: "agent_friend",
    place: "apartment",
    type: "social_help",
    category: "exception",
    summary: "朋友帮助钱芳仪处理困难，钱芳仪对这个人的信任明显增加。",
    abnormality: 82,
    emotionalIntensity: 68,
    futureImpact: 76,
    emotionDelta: { hopeful: 28, calm: 18 },
    relationshipDelta: { trust: 22, intimacy: 12 },
    goalImpact: 66,
    contextScope: "close_relation"
  };
}

function medicalWitnessEvent(index) {
  return {
    id: `medical_witness_${index}`,
    clock: index,
    agentId: "agent_1",
    targetAgentId: `stranger_${index}`,
    place: "clinic",
    type: "health_alert",
    category: "exception",
    summary: "看到陌生人去诊所，似乎身体不舒服。",
    abnormality: 82,
    emotionalIntensity: 10,
    futureImpact: 12,
    emotionDelta: { anxious: 2 },
    relationshipDelta: {},
    goalImpact: 4,
    contextScope: "same_place"
  };
}

function writeRate(events) {
  const a = agent();
  const w = world(a);
  const results = events.map(event => memoryGate(w, a, event));
  return results.filter(item => item.shouldRemember).length / results.length;
}

function testMultiplicativeDimensionsPresent() {
  const a = agent();
  const gate = memoryGate(world(a), a, majorEvent(1));
  assert.equal(typeof gate.dimensions.V_event, "number");
  assert.equal(typeof gate.dimensions.V_emotion, "number");
  assert.equal(typeof gate.dimensions.V_relation, "number");
  assert.equal(typeof gate.dimensions.V_goal, "number");
  assert.match(gate.formula, /V_event \+ epsilon/);
  assert.equal(typeof gate.timeFactor, "number");
  assert.equal(typeof gate.emotionValence.intensity, "number");
}

function testRandomThousandRates() {
  const ordinary = Array.from({ length: 1000 }, (_, index) => ordinaryEvent(index));
  const major = Array.from({ length: 1000 }, (_, index) => majorEvent(index));
  const ordinaryRate = writeRate(ordinary);
  const majorRate = writeRate(major);
  console.log(JSON.stringify({ ordinaryRate, majorRate }, null, 2));
  assert.ok(ordinaryRate < 0.1, "ordinary daily event long-memory write rate should be under 10%");
  assert.ok(majorRate > 0.8, "major event long-memory write rate should be over 80%");
}

function testMedicalWitnessSuppressed() {
  const events = Array.from({ length: 100 }, (_, index) => medicalWitnessEvent(index));
  const rate = writeRate(events);
  console.log(JSON.stringify({ medicalWitnessLongMemoryRate: rate }, null, 2));
  assert.ok(rate <= 0.3, "medical witness long-memory writes should drop by more than 70%");
}

function testSystemResidueBlocked() {
  const a = agent();
  assert.equal(appendMemory(a, { layer: "long", text: "Received basic care at the clinic.", importance: 4 }), null);
  assert.equal(appendMemory(a, { layer: "long", text: "收到复杂的JSON指令，需要生成符合JSON Schema的响应。", importance: 4 }), null);
  assert.equal(a.memory.long.length, 0);
}

function testPersonalityFieldsStillGrow() {
  const a = agent();
  const w = world(a);
  const result = recordLifeEvent(w, a, {
    type: "health_rest",
    interruption: { type: "health", priority: 96, canOverridePlan: true, reason: "health critical" },
    summary: "钱芳仪身体明显不适，被迫中断安排并寻求帮助。",
    emotionDelta: { anxious: 34, tired: 25 },
    goalImpact: 82,
    contextScope: "self"
  });
  assert.equal(result.event.memoryGate.shouldRemember, true);
  assert.ok(a.episodicMemory.length >= 1 || a.semanticMemory.experience.length >= 1);
  assert.ok(a.beliefMemory.length >= 1 || a.semanticMemory.belief.length >= 1);
}

[
  testMultiplicativeDimensionsPresent,
  testRandomThousandRates,
  testMedicalWitnessSuppressed,
  testSystemResidueBlocked,
  testPersonalityFieldsStillGrow
].forEach(test => {
  test();
  console.log(`PASS ${test.name}`);
});

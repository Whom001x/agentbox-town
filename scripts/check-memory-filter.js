"use strict";

const assert = require("node:assert/strict");
const {
  appendMemory,
  recordLifeEvent
} = require("../ai-town-memory-stream");

function agent() {
  return {
    id: "agent_1",
    name: "钱芳仪",
    position: "apartment",
    needs: { hunger: 80, health: 80, safety: 80, stress: 80 },
    memory: { short: [], long: [], emotional: [], secret: [], rumor: [] },
    relationshipMatrix: {}
  };
}

function world(a) {
  return {
    clock: 600,
    config: { memoryImportanceThreshold: 0.15 },
    places: [{ id: "apartment" }, { id: "clinic" }],
    agents: [a],
    eventLog: []
  };
}

function longTermCount(a) {
  return [
    a.semanticMemory?.experience,
    a.semanticMemory?.episodic,
    a.semanticMemory?.belief,
    a.semanticMemory?.habit,
    a.semanticMemory?.relationship,
    a.semanticMemory?.preference,
    a.episodicMemory,
    a.beliefMemory,
    a.habitMemory,
    a.relationshipMemory,
    a.vectorMemory
  ].reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
}

function testLowImportanceOnlyEventLog() {
  const a = agent();
  const w = world(a);
  const before = longTermCount(a);
  const result = recordLifeEvent(w, a, {
    type: "minor_observation",
    summary: "钱芳仪注意到走廊有人经过，但这件事和自己没有关系。",
    abnormality: 10,
    emotionalIntensity: 4,
    futureImpact: 5,
    emotionDelta: { curious: 1 },
    contextScope: "same_place"
  });
  assert.equal(w.eventLog.length, 1);
  assert.equal(result.event.memoryGate.shouldRemember, false);
  assert.equal(longTermCount(a), before);
}

function testBlockedSystemTextCannotEnterMemory() {
  const a = agent();
  const blocked = [
    "Followed plan sleep",
    "Because of hunger, interrupted the plan: eat",
    "Daily reflection: Daily reflection: ate dinner",
    "Received basic care at the clinic.",
    "收到复杂的JSON指令，需要生成符合JSON Schema的响应。"
  ];
  blocked.forEach(text => {
    assert.equal(appendMemory(a, { layer: "long", text, importance: 5 }), null);
  });
  assert.equal(a.memory.long.length, 0);
}

function testRelationshipRequiresRealInteraction() {
  const a = agent();
  const w = world(a);
  const sighting = recordLifeEvent(w, a, {
    type: "health_alert",
    summary: "钱芳仪在诊所看到陌生人身体不舒服。",
    targetAgentId: "stranger",
    abnormality: 82,
    emotionalIntensity: 8,
    futureImpact: 10,
    emotionDelta: { anxious: 1 },
    contextScope: "same_place"
  });
  assert.equal(sighting.event.memoryGate.shouldRemember, false);

  const direct = recordLifeEvent(w, a, {
    type: "social_help",
    summary: "朋友帮助钱芳仪处理困难，钱芳仪对这个人的信任增加。",
    targetAgentId: "friend",
    abnormality: 82,
    emotionalIntensity: 68,
    futureImpact: 76,
    emotionDelta: { hopeful: 24, calm: 12 },
    relationshipDelta: { trust: 30 },
    goalImpact: 70,
    contextScope: "close_relation"
  });
  assert.equal(direct.event.memoryGate.shouldRemember, true);
  assert.equal(direct.event.memoryGate.memoryType, "social");
  assert.ok(Array.isArray(a.relationshipMemory) && a.relationshipMemory.length >= 1);
}

[
  testLowImportanceOnlyEventLog,
  testBlockedSystemTextCannotEnterMemory,
  testRelationshipRequiresRealInteraction
].forEach(test => {
  test();
  console.log(`PASS ${test.name}`);
});

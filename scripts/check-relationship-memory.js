"use strict";

const assert = require("node:assert/strict");
const { recordLifeEvent, runDailyReflection } = require("../ai-town-memory-stream");
const { utilityDecision } = require("../ai-town-utility-scheduler");

function agent(overrides = {}) {
  return {
    id: "agent_1",
    name: "Agent One",
    job: "resident",
    ageYears: 36,
    ageStage: "adult",
    position: "apartment",
    needs: {
      hunger: 80,
      hygiene: 80,
      health: 80,
      social: 35,
      responsibility: 60,
      stress: 60,
      comfort: 70,
      safety: 75
    },
    emotionVector: {
      happy: 45,
      anxious: 30,
      angry: 5,
      sad: 5,
      tired: 35,
      lonely: 65,
      hopeful: 45,
      calm: 50,
      curious: 30
    },
    memory: { short: [], long: [], emotional: [], secret: [], rumor: [] },
    semanticMemory: { habit: [], experience: [], episodic: [], belief: [], relationship: [], social: [], preference: [], goal: [] },
    structuredMemory: { habit: [], belief: [], preference: [], episodic: [], social: [], goal: [] },
    relationshipMatrix: {
      agent_2: { type: "neighbor", trust: 62, intimacy: 35, respect: 45, familiarity: 70, resentment: 0 }
    },
    ...overrides
  };
}

function world(a, b = { id: "agent_2", name: "Agent Two", position: "apartment" }, clock = 720) {
  return {
    clock,
    config: { vectorMemoryEnabled: true, vectorMaxRecall: 5 },
    agents: [a, b],
    places: [{ id: "apartment" }, { id: "clinic" }],
    eventLog: []
  };
}

function relationshipEvent(overrides = {}) {
  return {
    type: "relationship_help",
    summary: "Agent Two helped Agent One get to the clinic during a difficult moment.",
    targetAgentId: "agent_2",
    relationshipDelta: { trust: 25, intimacy: 10 },
    emotionDelta: { hopeful: 28, anxious: -12 },
    futureImpact: 45,
    contextScope: "direct",
    source: "test",
    ...overrides
  };
}

function flushRelationshipMemory(w) {
  w.clock = Math.max(Number(w.clock || 0), 1440);
  runDailyReflection(w, { force: true });
}

function contactScore(decision) {
  const action = decision.candidateActions.find(item => item.id === "contact_familiar");
  assert.ok(action, "contact_familiar should be a candidate");
  return action.score;
}

function testImportantInteractionCreatesStructuredRelationshipMemory() {
  const a = agent();
  const w = world(a);
  const result = recordLifeEvent(w, a, relationshipEvent());
  assert.equal(result.event.memoryGate.shouldRemember, true);
  assert.equal(result.event.memoryGate.memoryType, "social");
  assert.equal(a.relationshipMemory.length, 0);
  assert.equal(a.relationshipBuffer.length, 1);
  flushRelationshipMemory(w);
  assert.equal(a.relationshipMemory.length, 1);
  const memory = a.relationshipMemory[0];
  assert.equal(memory.targetAgentId, "agent_2");
  assert.equal(memory.relationshipType, "help");
  assert.equal(memory.emotionalTag, "positive");
  assert.ok(memory.trust > 0);
  assert.ok(memory.familiarity > 0);
  assert.equal(memory.interactionCount, 1);
  assert.ok(memory.sourceEvents.includes(result.event.id));
  assert.ok(memory.relationshipCause);
  assert.match(memory.relationshipCause.effect, /trust/);
  assert.match(memory.myView || memory.relation || memory.event, /^我/);
  assert.doesNotMatch(JSON.stringify(memory), /This person|Agent tends|Stable habit|Daily reflection/i);
}

function testRepeatedInteractionReinforcesSingleRelationshipMemory() {
  const a = agent();
  const w = world(a);
  recordLifeEvent(w, a, relationshipEvent({ id: "rel_evt_1" }));
  w.clock += 60;
  recordLifeEvent(w, a, relationshipEvent({ id: "rel_evt_2", summary: "Agent Two helped Agent One again with a clinic follow-up." }));
  assert.equal(a.relationshipMemory.length, 0);
  flushRelationshipMemory(w);
  assert.equal(a.relationshipMemory.length, 1);
  assert.ok(a.relationshipMemory[0].interactionCount >= 2);
  assert.ok(a.relationshipMemory[0].sourceEvents.length >= 2);
}

function testOrdinaryChatDoesNotCreateRelationshipMemory() {
  const a = agent();
  const w = world(a);
  const result = recordLifeEvent(w, a, {
    type: "ordinary_chat",
    summary: "Agent One and Agent Two had ordinary small talk while passing by.",
    targetAgentId: "agent_2",
    contextScope: "direct",
    source: "test"
  });
  assert.notEqual(result.event.memoryGate.memoryType, "social");
  assert.equal(a.relationshipMemory.length, 0);
}

function testRelationshipMemoryAffectsContactFamiliarScore() {
  const positive = agent();
  const positiveWorld = world(positive);
  recordLifeEvent(positiveWorld, positive, relationshipEvent());
  flushRelationshipMemory(positiveWorld);
  const positiveScore = contactScore(utilityDecision(positiveWorld, positive));

  const negative = agent();
  const negativeWorld = world(negative);
  recordLifeEvent(negativeWorld, negative, relationshipEvent({
    type: "relationship_conflict",
    summary: "Agent Two argued with Agent One and broke trust during a difficult moment.",
    relationshipDelta: { trust: -25, resentment: 20 },
    emotionDelta: { angry: 35, anxious: 18 }
  }));
  flushRelationshipMemory(negativeWorld);
  const negativeScore = contactScore(utilityDecision(negativeWorld, negative));

  assert.ok(positiveScore > negativeScore, `positive ${positiveScore} should exceed negative ${negativeScore}`);
}

function populationAgent(index) {
  const id = `agent_${index}`;
  const targetId = `agent_${(index + 1) % 50}`;
  return agent({
    id,
    name: `Agent ${index}`,
    relationshipMatrix: {
      [targetId]: {
        type: index === 0 ? "close_friend" : "neighbor",
        trust: index === 0 ? 82 : 58,
        intimacy: index === 0 ? 78 : 28,
        respect: 50,
        familiarity: index === 0 ? 88 : 52,
        resentment: 0
      }
    }
  });
}

function populationRelationshipEvent(actorIndex, tick, overrides = {}) {
  const targetIndex = (actorIndex + 1) % 50;
  return {
    type: tick % 9 === 0 ? "relationship_cooperation" : "relationship_help",
    summary: `Agent ${targetIndex} helped Agent ${actorIndex} with an important task at tick ${tick}.`,
    targetAgentId: `agent_${targetIndex}`,
    relationshipDelta: { trust: 18, intimacy: 8, respect: 6 },
    emotionDelta: { hopeful: 22, anxious: -8 },
    futureImpact: 42,
    contextScope: "direct",
    source: "population-test",
    ...overrides
  };
}

function testPopulationRelationshipMemoryFormation100Ticks() {
  const agents = Array.from({ length: 50 }, (_, index) => populationAgent(index));
  const w = {
    clock: 0,
    config: { vectorMemoryEnabled: true, vectorMaxRecall: 5 },
    agents,
    places: [{ id: "apartment" }, { id: "clinic" }],
    eventLog: []
  };

  for (let tick = 1; tick <= 100; tick += 1) {
    w.clock = 720 + tick;
    recordLifeEvent(w, agents[0], populationRelationshipEvent(0, tick, {
      id: `close_${tick}`,
      summary: `Agent 1 repeatedly supported Agent 0 during a long important process at tick ${tick}.`
    }));

    const actorIndex = 1 + ((tick - 1) % 39);
    recordLifeEvent(w, agents[actorIndex], populationRelationshipEvent(actorIndex, tick, {
      id: `resident_${actorIndex}_${tick}`
    }));

    const ordinaryIndex = 40 + (tick % 10);
    recordLifeEvent(w, agents[ordinaryIndex], {
      id: `ordinary_${ordinaryIndex}_${tick}`,
      type: "ordinary_chat",
      summary: `Agent ${ordinaryIndex} and Agent ${(ordinaryIndex + 1) % 50} had ordinary small talk while passing by.`,
      targetAgentId: `agent_${(ordinaryIndex + 1) % 50}`,
      contextScope: "direct",
      source: "population-test"
    });
  }
  w.clock = 1440;
  runDailyReflection(w, { force: true });

  const counts = agents.map(item => Array.isArray(item.relationshipMemory) ? item.relationshipMemory.length : 0);
  const nonZero = counts.filter(Boolean).length;
  const nonZeroRatio = nonZero / agents.length;
  assert.ok(nonZeroRatio > 0.7, `relationshipMemory non-zero ratio ${nonZeroRatio} should exceed 70%`);

  const ordinaryResidents = agents.slice(1, 40);
  ordinaryResidents.forEach(item => {
    const count = item.relationshipMemory.length;
    assert.ok(count >= 1 && count <= 10, `${item.id} relationshipMemory count ${count} should be 1-10`);
  });

  agents.slice(40).forEach(item => {
    assert.equal(item.relationshipMemory.length, 0, `${item.id} ordinary chats should stay out of relationshipMemory`);
  });

  const closeMemory = agents[0].relationshipMemory[0];
  assert.ok(closeMemory, "close relationship should create at least one memory");
  assert.ok(closeMemory.interactionCount >= 10, `close relationship interactionCount ${closeMemory.interactionCount} should be 10+`);
  assert.ok(closeMemory.relationshipCauses.length >= 1, "relationship cause should be retained");
  assert.ok(closeMemory.sourceEvents.length >= 1, "source events should be retained");
}

[
  testImportantInteractionCreatesStructuredRelationshipMemory,
  testRepeatedInteractionReinforcesSingleRelationshipMemory,
  testOrdinaryChatDoesNotCreateRelationshipMemory,
  testRelationshipMemoryAffectsContactFamiliarScore,
  testPopulationRelationshipMemoryFormation100Ticks
].forEach(test => {
  test();
  console.log(`PASS ${test.name}`);
});

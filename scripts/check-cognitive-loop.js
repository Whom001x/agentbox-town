"use strict";

const assert = require("node:assert/strict");
const { appendMemory, recordLifeEvent, runDailyReflection, retrieveRelevantMemories } = require("../ai-town-memory-stream");
const { aggregateDecision } = require("../ai-town-decision-aggregator");
const { judgeAction, mergeWorldMasterJudgement } = require("../ai-town-world-master");
const { utilityDecision } = require("../ai-town-utility-scheduler");

function agent(overrides = {}) {
  return {
    id: "agent_1",
    name: "Test Agent",
    job: "student",
    position: "school",
    needs: {
      hunger: 80,
      hygiene: 80,
      health: 80,
      social: 70,
      responsibility: 70,
      stress: 70,
      comfort: 70,
      safety: 80,
      ...(overrides.needs || {})
    },
    memory: { short: [], long: [], emotional: [], secret: [], rumor: [] },
    ...overrides
  };
}

function world(agents, clock = 1440) {
  return {
    clock,
    places: [{ id: "school" }, { id: "clinic" }, { id: "apartment" }],
    agents
  };
}

function testReflectionUsesImportantMemory() {
  const a = agent();
  const w = world([a], 1500);
  appendMemory(a, { at: 100, layer: "short", text: "Felt sick at school and asked for help at the clinic.", importance: 5, tags: ["health", "clinic"] });
  const updated = runDailyReflection(w, { force: true });
  assert.deepEqual(updated, ["agent_1"]);
  assert.ok(a.reflection.mainTheme.includes("sick") || a.reflection.mainTheme.includes("clinic"));
  assert.ok(a.memorySummary.length > 0);
}

function testDecisionAggregatorPrioritizesHealth() {
  const a = agent({ needs: { health: 18 } });
  const w = world([a], 8 * 60);
  const decision = aggregateDecision(w, a);
  assert.equal(decision.reason, "health_interrupt");
  assert.ok(decision.priority >= 90);
  assert.ok(["local", "ai", "worldMaster"].includes(decision.route));
}

function testRelevantMemoryRetrieval() {
  const a = agent();
  appendMemory(a, { at: 10, layer: "long", text: "The clinic visit made me feel safer.", importance: 4, tags: ["clinic"] });
  const memories = retrieveRelevantMemories(a, { clock: 100, type: "clinic", place: "clinic" }, 3);
  assert.equal(memories[0].text.includes("clinic"), true);
}

function testWorldMasterBlocksUnmetMedicalResult() {
  const a = agent({ position: "school" });
  const w = world([a], 9 * 60);
  const judgement = judgeAction(w, a, { action: { type: "medical", summary: "I get treated by a doctor and recover." } });
  assert.equal(judgement.route, "process");
  assert.equal(judgement.reason, "must_reach_clinic_first");
}

function testWorldMasterAiCannotOverrideHardBlock() {
  const local = { allowed: false, route: "blocked", reason: "dead_agent", requiredFollowups: [] };
  const ai = { allowed: true, route: "accepted", reason: "looks fine", needDelta: { health: 8 } };
  const judgement = mergeWorldMasterJudgement(local, ai);
  assert.equal(judgement.allowed, false);
  assert.equal(judgement.route, "blocked");
  assert.equal(judgement.reason.includes("dead_agent"), true);
}

function testExperienceMemoryPersonalityUtilityLoop() {
  const a = agent({ needs: { health: 28, social: 45 }, identityCore: { identity: "reliable doctor", values: ["health"] } });
  const w = world([a], 900);
  recordLifeEvent(w, a, {
    type: "health_rest",
    interruption: { type: "health", priority: 96, canOverridePlan: true, reason: "health critical" },
    summary: "Test Agent felt sick and changed the work plan."
  });
  const decision = utilityDecision(w, a);
  assert.ok(a.semanticMemory.experience.length >= 1);
  assert.ok(decision.personalityRuntime);
  assert.ok(decision.memoryInfluence.memoryBias.some(item => item.action === "seek_care"));
  assert.ok(decision.decisionTrace.scoreBreakdown.memory > 0);
  assert.ok(decision.debugDecision.action);
}

const tests = [
  testReflectionUsesImportantMemory,
  testDecisionAggregatorPrioritizesHealth,
  testRelevantMemoryRetrieval,
  testWorldMasterBlocksUnmetMedicalResult,
  testWorldMasterAiCannotOverrideHardBlock,
  testExperienceMemoryPersonalityUtilityLoop
];

for (const test of tests) {
  test();
  console.log(`PASS ${test.name}`);
}

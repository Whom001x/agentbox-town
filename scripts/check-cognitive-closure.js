"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { cognitiveState } = require("../ai-town-cognitive-state");
const { candidateActions, utilityDecision, scoreAction } = require("../ai-town-utility-scheduler");

const ROOT = path.resolve(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function agent(overrides = {}) {
  return {
    id: "agent_a",
    name: "agent_a",
    ageYears: 35,
    ageStage: "adult",
    job: "resident",
    position: "apartment",
    needs: { hunger: 70, hygiene: 70, health: 80, social: 55, responsibility: 65, stress: 60, comfort: 70, safety: 80 },
    emotionVector: { happy: 45, anxious: 25, angry: 10, sad: 10, tired: 20, lonely: 35, hopeful: 45, calm: 45, curious: 30 },
    cognitiveProfile: { curiosity: 0.5, routinePreference: 0.5, socialDrive: 0.5, empathy: 0.5, conflictAvoidance: 0.5, patience: 0.5, ambition: 0.5 },
    identityCore: { identity: "resident", values: ["stable life"] },
    selfModel: { identity: "resident", values: ["stable life"], selfConsistencyWeight: 0.65 },
    goalRuntime: { goals: [{ name: "stable routine", priority: 0.6 }], source: "test", updatedAt: 0 },
    relationshipMatrix: {},
    ...overrides
  };
}

function world(a = agent()) {
  return {
    clock: 0,
    config: { cognitiveEngineEnabled: true, psychologicalStateAlpha: 0.85 },
    socialField: { fearLevel: 0.1, curiosityLevel: 0.2, rumorDensity: 0.1, socialTension: 0.1, informationPressure: 0.2 },
    agents: [a],
    places: [{ id: "apartment" }, { id: "clinic" }, { id: "breakfast" }]
  };
}

function assertThrowsMissingState() {
  const a = agent();
  const w = world(a);
  assert.throws(() => candidateActions(w, a), /psychologicalState/);
  assert.throws(() => utilityDecision(w, a), /psychologicalState/);
  assert.throws(() => scoreAction(w, a, { id: "observe_environment", type: "observe" }), /psychologicalState/);
}

function assertStateOnlyDecisionWorks() {
  const a = agent();
  const w = world(a);
  const cognitive = cognitiveState(w, a);
  const extras = { cognitiveState: cognitive, psychologicalState: cognitive.psychologicalState };
  const candidates = candidateActions(cognitive.psychologicalState);
  assert.ok(candidates.length > 0);
  assert.ok(candidates.every(item => item.source?.includes("S_state")));
  const decision = utilityDecision(cognitive.psychologicalState);
  assert.ok(decision.selectedAction);
  assert.equal(decision.rule.includes("S(t)-only"), true);
}

function assertUtilitySourceClean() {
  const source = read("ai-town-utility-scheduler.js");
  const candidateBody = source.slice(source.indexOf("function candidateActions"), source.indexOf("function dedupeActions"));
  const scoreBody = source.slice(source.indexOf("function scoreAction"), source.indexOf("function seededRandom"));
  const decisionBody = source.slice(source.indexOf("function utilityDecision"), source.indexOf("module.exports"));
  const eligibilityBody = source.slice(source.indexOf("function actionEligibility"), source.indexOf("function filterEligibleActions"));
  const allScheduler = source.slice(source.indexOf("\"use strict\""), source.indexOf("module.exports"));
  assert.ok(!/cognitiveState\(world|stabilizePsychologicalState|agent\.memory|beliefMemory|habitMemory|episodicMemory|relationshipMemory/.test(candidateBody));
  assert.ok(!/S_state_fallback|fallback/i.test(candidateBody));
  assert.ok(!/activeMemories|beliefActivationRaw|emotionalLoadRaw|agent\.needs|agent\.emotionVector|relationshipMatrix|structuredMemoryForAgent|retrieveVectorMemories/.test(scoreBody));
  assert.ok(!/agent\.currentTask|agent\.actionHistory|agent\.needs|agent\.emotionVector|agent\.relationshipMatrix|world\.config/.test(eligibilityBody));
  assert.ok(!/cognitiveState\(world|currentPlanItem|detectInterruption|agentPriority|agent\.psychologicalState|explorationRateFor\(world|world\.config|agent\.actionHistory|ensurePriorCausalGraph|agent\.debugDecision|agent\.needs|agent\.emotionVector|relationshipMatrix/.test(decisionBody));
  assert.ok(!/currentPlanItem|detectInterruption|structuredMemoryForAgent|retrieveVectorMemories|normalizeGoalRuntime|ensureSelfModel|require\("\.\/ai-town-personality-runtime"\)|personalityRuntimeBias|socialFieldBiasForAction|socialFeedbackBiasForAction|causalBiasForAction/.test(allScheduler));
  assert.ok(!/agent\.needs|agent\.emotionVector|agent\.actionHistory|agent\.currentTask|agent\.relationshipMatrix|world\.config|agent\.debugDecision/.test(allScheduler));
  assert.ok(source.includes("function explorationRateFromState"));
}

function assertRuntimeClosure() {
  const server = read("ai-town-v2-server.js");
  assert.ok(server.includes("Scheduler Advisor Disabled"));
  assert.ok(server.includes("AgentAction Generation Disabled"));
  assert.ok(server.includes("mode: \"ranking_only\""));
  assert.ok(!server.includes("resolveLocalAction(world"));
  assert.ok(!server.includes("aiRouter.runOnce(\"agentAction\""));
  assert.ok(!server.includes("callAiWithRetry(\"agentAction\""));
  assert.ok(!server.includes("agentAction_json_retry"));
  assert.ok(!/utilityDecision\(world,\s*agent/.test(server));
  assert.ok(!server.includes("utilityDecision(world, agent, { plan"));
  assert.ok(!server.includes("const baseUtility = utilityDecision"));
  const fallbackBody = server.slice(server.indexOf("function fallbackJson"), server.indexOf("function strictJson"));
  assert.ok(!/if \(task === "agentAction"\) return \{ action:/.test(fallbackBody));
  assert.ok(fallbackBody.includes("fallback cannot generate actions"));
}

function main() {
  assertThrowsMissingState();
  assertStateOnlyDecisionWorks();
  assertUtilitySourceClean();
  assertRuntimeClosure();
  console.log("PASS check-cognitive-closure");
}

main();

"use strict";

const assert = require("assert");
const { cognitiveState, psychologicalStateVector } = require("../ai-town-cognitive-state");
const { candidateActions, utilityDecision } = require("../ai-town-utility-scheduler");

function dot(a = {}, b = {}) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let aa = 0;
  let bb = 0;
  let ab = 0;
  keys.forEach(key => {
    const x = Number(a[key] || 0);
    const y = Number(b[key] || 0);
    aa += x * x;
    bb += y * y;
    ab += x * y;
  });
  return aa && bb ? ab / (Math.sqrt(aa) * Math.sqrt(bb)) : 1;
}

function agent(id, profile = {}) {
  return {
    id,
    name: id,
    ageYears: 35,
    ageStage: "adult",
    job: "resident",
    position: "apartment",
    needs: { hunger: 70, hygiene: 70, health: 75, social: 55, responsibility: 65, stress: 60, comfort: 70, safety: 80 },
    emotionVector: { happy: 45, anxious: 25, angry: 10, sad: 10, tired: 20, lonely: 35, hopeful: 45, calm: 45, curious: 30 },
    cognitiveProfile: { curiosity: 0.5, routinePreference: 0.5, socialDrive: 0.5, empathy: 0.5, conflictAvoidance: 0.5, patience: 0.5, ambition: 0.5, ...profile },
    identityCore: { identity: "resident", values: ["stable life"] },
    selfModel: { identity: "resident", values: ["stable life"], selfConsistencyWeight: 0.65 },
    goalRuntime: { goals: [{ name: "stable routine", priority: 0.6 }], source: "test", updatedAt: 0 },
    relationshipMatrix: {}
  };
}

function world() {
  return {
    clock: 0,
    config: { cognitiveEngineEnabled: true, psychologicalStateAlpha: 0.85 },
    socialField: { fearLevel: 0.1, curiosityLevel: 0.2, rumorDensity: 0.1, socialTension: 0.1, informationPressure: 0.2 },
    agents: [],
    places: []
  };
}

function decide(w, a) {
  const cognitive = cognitiveState(w, a);
  return utilityDecision(cognitive.psychologicalState);
}

function testContinuity() {
  const w = world();
  const a = agent("a");
  w.agents = [a];
  const s1 = cognitiveState(w, a).psychologicalState;
  w.clock += 1;
  a.needs.social = 20;
  a.emotionVector.lonely = 90;
  const s2 = cognitiveState(w, a).psychologicalState;
  assert.ok(dot(psychologicalStateVector(s1), psychologicalStateVector(s2)) > 0.8);
}

function testCandidateBoundary() {
  const text = candidateActions.toString();
  assert.ok(!/structuredMemoryForAgent|agent\.memory|beliefMemory|habitMemory|episodicMemory|relationshipMemory/.test(text));
  const w = world();
  const a = agent("a");
  w.agents = [a];
  const cognitive = cognitiveState(w, a);
  const candidates = candidateActions(cognitive.psychologicalState);
  assert.ok(candidates.length > 0);
  assert.ok(candidates.every(item => item.source?.includes("S_state")));
}

function testInertiaLag() {
  const w = world();
  const a = agent("a");
  w.agents = [a];
  cognitiveState(w, a);
  a.needs.safety = 0;
  a.emotionVector.anxious = 100;
  w.socialField.fearLevel = 1;
  w.clock += 1;
  const next = cognitiveState(w, a).psychologicalState;
  assert.ok(next.needsVector.safety < 1);
  assert.ok(next.socialPressure.fear < 1);
}

function testBehaviorConsistency() {
  const w = world();
  const a = agent("a", { routinePreference: 0.9, curiosity: 0.2 });
  w.agents = [a];
  const picks = [];
  for (let i = 0; i < 6; i += 1) {
    w.clock += 1;
    picks.push(decide(w, a).selectedAction.id);
  }
  const top = picks.reduce((map, id) => map.set(id, (map.get(id) || 0) + 1), new Map());
  assert.ok(Math.max(...top.values()) / picks.length >= 0.7);
}

function testPersonalityDivergence() {
  const w = world();
  const cautious = agent("cautious", { routinePreference: 0.95, curiosity: 0.05, conflictAvoidance: 0.9 });
  const curious = agent("curious", { routinePreference: 0.1, curiosity: 0.95, conflictAvoidance: 0.1 });
  Object.keys(cautious.needs).forEach(key => {
    cautious.needs[key] = 90;
    curious.needs[key] = 90;
  });
  w.agents = [cautious, curious];
  const cautiousActions = decide(w, cautious).candidateActions.slice(0, 5);
  const curiousActions = decide(w, curious).candidateActions.slice(0, 5);
  const cautiousRank = cautiousActions.map(item => item.id).join("|");
  const curiousRank = curiousActions.map(item => item.id).join("|");
  const scoreDistance = cautiousActions.reduce((sum, item) => {
    const other = curiousActions.find(candidate => candidate.id === item.id);
    return sum + Math.abs(Number(item.score || 0) - Number(other?.score || 0));
  }, 0);
  assert.ok(cautiousRank !== curiousRank || scoreDistance > 1);
}

function testUnifiedFormulaTrace() {
  const w = world();
  const a = agent("a");
  w.agents = [a];
  const decision = decide(w, a);
  const features = decision.candidateActions[0].components.utilityFeatures;
  assert.deepEqual(Object.keys(features), ["Need", "GoalAlignment", "MemoryBias", "SocialField", "CausalScore"]);
}

[
  testContinuity,
  testCandidateBoundary,
  testInertiaLag,
  testBehaviorConsistency,
  testPersonalityDivergence,
  testUnifiedFormulaTrace
].forEach(fn => fn());

console.log("PASS check-personality-stability");

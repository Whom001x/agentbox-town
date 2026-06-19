"use strict";

const assert = require("node:assert/strict");
const { cognitiveState } = require("../ai-town-cognitive-state");
const {
  candidateActions,
  filterEligibleActions,
  actionEligibility,
  utilityDecision,
  lifeStageOf,
  professionKind
} = require("../ai-town-utility-scheduler");

function agent(overrides = {}) {
  return {
    id: overrides.id || "agent",
    name: overrides.name || overrides.id || "Agent",
    job: overrides.job || "resident",
    ageYears: overrides.ageYears ?? 35,
    ageStage: overrides.ageStage || "",
    position: overrides.position || overrides.place || "apartment",
    place: overrides.place || overrides.position || "apartment",
    currentTask: overrides.currentTask || "",
    needs: {
      hunger: 72,
      hygiene: 74,
      health: 76,
      social: 70,
      responsibility: 68,
      stress: 66,
      comfort: 70,
      safety: 74,
      ...(overrides.needs || {})
    },
    emotionVector: {
      happy: 45,
      anxious: 35,
      angry: 8,
      sad: 10,
      tired: 35,
      lonely: 25,
      hopeful: 45,
      calm: 50,
      curious: 35,
      ...(overrides.emotionVector || {})
    },
    cognitiveProfile: {
      riskTolerance: 0.45,
      curiosity: 0.45,
      routinePreference: 0.55,
      socialDrive: 0.45,
      ambition: 0.55,
      empathy: 0.5,
      conflictAvoidance: 0.5,
      patience: 0.55,
      ...(overrides.cognitiveProfile || {})
    },
    identityCore: overrides.identityCore || { identity: overrides.job || "resident", values: ["stability"] },
    selfModel: overrides.selfModel || { identity: "I keep a stable life", values: ["responsibility"], selfBeliefs: ["I handle my own daily affairs"] },
    relationshipMatrix: overrides.relationshipMatrix || {},
    memory: { short: [], long: [], emotional: [], secret: [], rumor: [] },
    semanticMemory: { belief: [], habit: [], preference: [], experience: [] },
    ...overrides
  };
}

function world(subject, overrides = {}) {
  return {
    clock: overrides.clock ?? 8 * 60,
    config: { vectorMemoryEnabled: false, cognitiveEngineEnabled: true, ...(overrides.config || {}) },
    places: [
      { id: "apartment" },
      { id: "clinic" },
      { id: "breakfast" },
      { id: "school" },
      { id: "street" }
    ],
    records: [],
    agents: [subject]
  };
}

function planFor(localAction, place, title = "scheduled plan", fixed = true) {
  return { time: "08:00", title, place, localAction, fixed, priority: fixed ? 80 : 45 };
}

function ids(items) {
  return new Set((items || []).map(item => item.id));
}

function eligibleIds(w, a, extras = {}) {
  const cognitive = cognitiveState(w, a, extras);
  const raw = candidateActions(cognitive.psychologicalState);
  return {
    raw,
    filtered: filterEligibleActions(cognitive.psychologicalState, raw, { runtimeContext: cognitive.psychologicalState.projection.runtimeContext })
  };
}

function assertAllScoredEligible(decision) {
  const runtimeContext = decision.psychologicalState?.projection?.runtimeContext;
  for (const action of decision.candidateActions || []) {
    const check = actionEligibility(decision.psychologicalState, action, { runtimeContext });
    assert.equal(check.allowed, true, `${decision.agentId} has invalid scored action ${action.id}: ${check.reason}`);
  }
}

function decide(w, a, extras = {}) {
  const cognitive = cognitiveState(w, a, extras);
  return utilityDecision(cognitive.psychologicalState);
}

function testFixedEligibilityRules() {
  const adult = agent({ id: "adult", job: "resident", ageYears: 36, position: "apartment" });
  let w = world(adult);
  let result = eligibleIds(w, adult);
  assert.equal(ids(result.filtered.actions).has("ask_guardian"), false, "normal adult must not consider ask_guardian");
  assert.equal(ids(result.filtered.actions).has("provide_care"), false, "non-medical adult must not consider provide_care");
  assert.equal(ids(result.filtered.actions).has("serve_customers"), false, "non-merchant adult must not consider serve_customers");

  const caregiverAdult = agent({ id: "caregiver", job: "family caregiver / freelance", ageYears: 42, position: "river" });
  w = world(caregiverAdult);
  result = eligibleIds(w, caregiverAdult);
  assert.equal(ids(result.filtered.actions).has("ask_guardian"), false, "caregiver adult is not a dependent adult");

  const child = agent({ id: "child", job: "student child", ageYears: 10, ageStage: "child", position: "school" });
  w = world(child);
  result = eligibleIds(w, child, { plan: planFor("study", "school", "class", true) });
  assert.equal(ids(result.filtered.actions).has("ask_guardian"), true, "child should be eligible for ask_guardian");
  assert.equal(ids(result.filtered.actions).has("walk_nearby"), false, "child cannot independently wander");
  assert.equal(ids(result.filtered.actions).has("eat_or_buy_food"), false, "ordinary eating is blocked during fixed class");

  const doctor = agent({ id: "doctor", job: "doctor", ageYears: 42, position: "clinic", cognitiveProfile: { empathy: 0.8 } });
  w = world(doctor);
  result = eligibleIds(w, doctor, { plan: planFor("work", "clinic", "clinic duty", true) });
  assert.equal(ids(result.filtered.actions).has("provide_care"), true, "doctor at clinic should be eligible for provide_care");

  const merchant = agent({ id: "merchant", job: "shop owner", ageYears: 45, position: "breakfast" });
  w = world(merchant);
  result = eligibleIds(w, merchant, { plan: planFor("work", "breakfast", "shop duty", true) });
  assert.equal(ids(result.filtered.actions).has("serve_customers"), true, "merchant at business place should serve customers");
  assert.equal(ids(result.filtered.actions).has("check_inventory"), true, "merchant at business place should check inventory");

  const elder = agent({ id: "elder", job: "retired elder", ageYears: 74, ageStage: "elder", position: "street", needs: { safety: 25 } });
  w = world(elder);
  result = eligibleIds(w, elder, { interruption: { type: "safety", priority: 90, canOverridePlan: true } });
  assert.equal(ids(result.filtered.actions).has("follow_stranger"), false, "elder in safety crisis must not follow stranger");

  const detective = agent({ id: "detective", job: "detective", ageYears: 35, position: "street", cognitiveProfile: { curiosity: 0.85, riskTolerance: 0.7 } });
  w = world(detective);
  result = eligibleIds(w, detective);
  assert.equal(ids(result.filtered.actions).has("follow_stranger"), true, "adult detective may consider following stranger");
}

function scenario(index) {
  const kind = index % 8;
  if (kind === 0) return { agent: agent({ id: `adult_${index}`, job: "resident", ageYears: 36, position: "apartment" }) };
  if (kind === 1) return { agent: agent({ id: `child_${index}`, job: "student child", ageYears: 10, ageStage: "child", position: "school" }), plan: planFor("study", "school", "class", true) };
  if (kind === 2) return { agent: agent({ id: `teen_${index}`, job: "student", ageYears: 16, ageStage: "teen", position: "school", needs: { hunger: index % 3 === 0 ? 24 : 60 } }), plan: planFor("study", "school", "class", true) };
  if (kind === 3) return { agent: agent({ id: `doctor_${index}`, job: "doctor", ageYears: 44, position: "clinic", cognitiveProfile: { empathy: 0.82, patience: 0.7 } }), plan: planFor("work", "clinic", "clinic duty", true) };
  if (kind === 4) return { agent: agent({ id: `merchant_${index}`, job: "shop owner", ageYears: 48, position: "breakfast", cognitiveProfile: { routinePreference: 0.76, socialDrive: 0.65 } }), plan: planFor("work", "breakfast", "shop duty", true) };
  if (kind === 5) return { agent: agent({ id: `elder_${index}`, job: "retired elder", ageYears: 76, ageStage: "elder", position: "street", needs: { safety: index % 2 ? 28 : 70, health: 55 } }), interruption: index % 2 ? { type: "safety", priority: 88, canOverridePlan: true, reason: "unsafe street" } : null };
  if (kind === 6) return { agent: agent({ id: `detective_${index}`, job: "detective", ageYears: 39, position: "street", cognitiveProfile: { curiosity: 0.86, riskTolerance: 0.72 } }) };
  return { agent: agent({ id: `artist_${index}`, job: "artist", ageYears: 31, position: "street", emotionVector: { curious: 80 }, cognitiveProfile: { curiosity: 0.86 } }) };
}

function testRandomThousandInvalidActionRate() {
  let invalid = 0;
  let total = 0;
  for (let i = 0; i < 1000; i += 1) {
    const { agent: subject, plan, interruption } = scenario(i);
    const w = world(subject, { clock: (8 * 60) + (i % 12) * 30 });
    const decision = decide(w, subject, { plan, interruption, eventText: `eligibility test ${i}` });
    decision._agent = subject;
    assert.ok(decision.selectedAction, `missing selected action at ${i}`);
    const runtimeContext = decision.psychologicalState?.projection?.runtimeContext;
    const selectedCheck = actionEligibility(decision.psychologicalState, decision.selectedAction, { runtimeContext });
    if (!selectedCheck.allowed) invalid += 1;
    for (const action of decision.candidateActions || []) {
      total += 1;
      const check = actionEligibility(decision.psychologicalState, action, { runtimeContext });
      if (!check.allowed) invalid += 1;
    }
    assert.equal(decision.actionEligibility.invalidActionRate, 0);
  }
  const invalidActionRate = total ? invalid / total : 0;
  assert.equal(invalidActionRate, 0, `invalidActionRate=${invalidActionRate}`);
  console.log(JSON.stringify({ samples: 1000, scoredActions: total, invalidActionRate }));
}

function testClassifierSmoke() {
  const stageOf = subject => cognitiveState(world(subject), subject).psychologicalState;
  assert.equal(lifeStageOf(stageOf(agent({ ageYears: 9 }))), "child");
  assert.equal(lifeStageOf(stageOf(agent({ ageYears: 17 }))), "teen");
  assert.equal(lifeStageOf(stageOf(agent({ ageYears: 70 }))), "elder");
  assert.equal(professionKind(stageOf(agent({ job: "doctor" }))), "medical");
  assert.equal(professionKind(stageOf(agent({ job: "shop owner" }))), "merchant");
}

[
  testClassifierSmoke,
  testFixedEligibilityRules,
  testRandomThousandInvalidActionRate
].forEach(test => {
  test();
  console.log(`PASS ${test.name}`);
});

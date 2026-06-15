"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

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

console.log("PASS memory action weights emotion modulation");

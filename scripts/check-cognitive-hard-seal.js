"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const TARGET_FILES = [
  "ai-town-cognitive-integrity.js",
  "ai-town-memory-stream.js",
  "ai-town-node-core.js",
  "ai-town-life-engine.js",
  "ai-town-need-dynamics.js",
  "ai-town-temporal-causal.js",
  "ai-town-identity-evolution.js",
  "ai-town-v2-server.js",
  "ai-town-causal-graph.js"
];

function readLines(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8").split(/\r?\n/);
}

function nearestContext(lines, index) {
  for (let i = index; i >= 0 && i >= index - 80; i -= 1) {
    const line = lines[i];
    const fn = line.match(/function\s+([A-Za-z0-9_]+)/);
    if (fn) return fn[1];
    const reg = line.match(/registerCognitiveWriteCommitter\("([^"]+)"/);
    if (reg) return `committer:${reg[1]}`;
  }
  return "";
}

function isAllowedAssignment(file, context, line) {
  if (context.startsWith("committer:")) return "committer";
  if (["ensureSelfModel", "ensureMemory", "ensureAgentShape", "ensureCausalMemory", "ensureReflectionLearning"].includes(context)) return "initialization";
  if ([
    "syncLongTermMemoryViews",
    "syncStructuredMemory",
    "migrateMemoryPerspectiveForAgent",
    "migrateLegacyCognitiveAuditFields",
    "backfillCognitiveAuditItem",
    "normalizeMemoryLayers",
    "nodeRuntimeCleanSystemErrorPollution"
  ].includes(context)) return "projection_or_migration";
  if (["_internalAppendLegacyMemory", "_internalAppendSemanticMemory", "_internalAppendMemory"].includes(context)) return "committer_internal";
  if (file === "ai-town-v2-server.js" && ["nodeRuntimeAdjustEmotion", "nodeRuntimeAdjustNeeds"].includes(context)) return "committer_helper";
  if (file === "ai-town-cognitive-integrity.js" && /agent\.emotionVector|relationshipMatrix/.test(line)) return "default_committer";
  return "";
}

function isForbiddenAssignment(file, context, line) {
  const cognitiveWrite = /(agent\.needs\[[^\]]+\]\s*=|agent\.memory\[[^\]]+\]\s*=|agent\.memory\.[A-Za-z]+\s*=|agent\.memory\[[^\]]+\]\.(push|unshift|splice)\(|agent\.emotionVector\[[^\]]+\]\s*=|agent\.causalMemory\s*=|agent\.causalCandidates\s*=|agent\.causalCandidates\.(push|unshift|splice)\(|agent\.expectationMemory\s*=|agent\.expectationMemory\.(push|unshift|splice)\(|agent\.identityCore\.[A-Za-z0-9_]+\s*=|memory\.learning\.confidence\s*=|memory\.confidence\s*=|selfModel\.[A-Za-z0-9_]+\s*=(?!=)|agent\.emotionCause\.(push|unshift|splice)\(|world\.causalGraph\.(nodes|edges)\.(push|unshift|splice)\()/;
  if (!cognitiveWrite.test(line)) return false;
  return !isAllowedAssignment(file, context, line);
}

function scanRuntimeMutations() {
  const allowed = [];
  const forbidden = [];
  const arithmetic = [];
  for (const file of TARGET_FILES) {
    const lines = readLines(file);
    lines.forEach((line, index) => {
      const context = nearestContext(lines, index);
      const lineNo = index + 1;
      if (/(emotionVector|needs|memory|belief|habit|relationship|causal|identity|selfModel|expectationMemory|causalCandidates)[A-Za-z0-9_\.\[\]\?]*\s*(\+=|-=|\+\+|--)/.test(line)) {
        arithmetic.push({ file, line: lineNo, context, text: line.trim() });
      }
      if (isForbiddenAssignment(file, context, line)) {
        forbidden.push({ file, line: lineNo, context, text: line.trim() });
      } else if (/(agent\.needs|agent\.memory|agent\.emotionVector|agent\.causalMemory|agent\.causalCandidates|agent\.expectationMemory|agent\.identityCore|selfModel\.|agent\.emotionCause|world\.causalGraph\.(nodes|edges)|relationshipMatrix)/.test(line)) {
        const reason = isAllowedAssignment(file, context, line);
        if (reason) allowed.push({ file, line: lineNo, context, type: reason, text: line.trim() });
      }
    });
  }
  return { allowed, forbidden, arithmetic };
}

function latestSaveWorld() {
  const saveRoots = [
    path.join(ROOT, "saves"),
    path.resolve(ROOT, "..", "agentbox-town-main", "saves")
  ];
  const candidates = [];
  for (const dir of saveRoots) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const worldPath = path.join(full, "world.json");
      if (!fs.existsSync(worldPath)) continue;
      const stat = fs.statSync(worldPath);
      candidates.push({ path: worldPath, mtimeMs: stat.mtimeMs });
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (!candidates.length) return null;
  const root = JSON.parse(fs.readFileSync(candidates[0].path, "utf8"));
  return { savePath: candidates[0].path, world: root.world || root };
}

function longStateItems(agent) {
  const result = [];
  const add = (field, list) => (Array.isArray(list) ? list : []).forEach(item => result.push({ field, item }));
  add("memory.long", agent.memory?.long);
  add("memory.emotional", agent.memory?.emotional);
  [
    "episodicMemory",
    "beliefMemory",
    "habitMemory",
    "preferenceMemory",
    "relationshipMemory",
    "causalMemory",
    "reflectionMemory",
    "emotionCause"
  ].forEach(field => add(field, agent[field]));
  Object.entries(agent.semanticMemory || {}).forEach(([key, list]) => add(`semanticMemory.${key}`, list));
  Object.entries(agent.structuredMemory || {}).forEach(([key, list]) => add(`structuredMemory.${key}`, list));
  return result;
}

function hasAudit(item = {}) {
  return Boolean(item.source)
    && item.confidence != null
    && Number.isFinite(Number(item.tick));
}

function auditSampledSave() {
  const loaded = latestSaveWorld();
  if (!loaded || !Array.isArray(loaded.world.agents)) {
    return { checked: false, reason: "no_save_found", missing: 0, total: 0, sampleAgents: 0 };
  }
  const agents = loaded.world.agents.slice(0, 10);
  let total = 0;
  let missing = 0;
  agents.forEach(agent => {
    longStateItems(agent).forEach(({ item }) => {
      total += 1;
      if (!hasAudit(item)) missing += 1;
    });
  });
  return { checked: true, savePath: loaded.savePath, sampleAgents: agents.length, total, missing };
}

function testRealityGuard() {
  const { cognitiveWrite } = require("../ai-town-cognitive-integrity");
  const world = { clock: 100, agents: [] };
  const agent = { id: "agent_guard", name: "Guard", memory: { short: [], long: [], emotional: [], secret: [], rumor: [] } };
  world.agents.push(agent);
  const badEmotionCause = cognitiveWrite({
    world,
    agent,
    agentId: agent.id,
    source: "test",
    target: "emotionCause",
    payload: { emotion: "anxious", at: 100 },
    confidence: 0.9,
    timestamp: 100
  });
  assert.equal(badEmotionCause.ok, false);
  assert.match(badEmotionCause.reason, /missing_emotion_cause/);
}

function main() {
  require("../ai-town-memory-stream");
  const { cognitiveKernelRuntimeStatus } = require("../ai-town-cognitive-integrity");
  testRealityGuard();
  const mutation = scanRuntimeMutations();
  const kernel = cognitiveKernelRuntimeStatus();
  const saveAudit = auditSampledSave();
  const forbiddenCount = mutation.forbidden.length + mutation.arithmetic.length + (saveAudit.missing || 0) + (kernel.ok ? 0 : 1);
  const score = forbiddenCount === 0 ? 100 : Math.max(0, 100 - forbiddenCount * 5);
  const report = {
    runtimeMutationList: mutation.allowed,
    forbiddenWrites: mutation.forbidden,
    arithmeticMutations: mutation.arithmetic,
    cognitiveWriteCoverage: {
      persistentRuntimeForbiddenWrites: mutation.forbidden.length,
      arithmeticMutations: mutation.arithmetic.length,
      coverage: mutation.forbidden.length || mutation.arithmetic.length ? "<100%" : "100%"
    },
    versionLock: kernel,
    saveAudit,
    boundaryScore: score
  };
  console.log(JSON.stringify(report, null, 2));
  assert.equal(kernel.ok, true, "kernel version lock must be ok");
  assert.equal(mutation.forbidden.length, 0, "forbidden runtime cognitive writes must be 0");
  assert.equal(mutation.arithmetic.length, 0, "cognitive arithmetic mutations must be 0");
  assert.equal(saveAudit.missing, 0, "sampled long-term state must have source/confidence/tick after migration");
  assert.ok(score >= 95, "Boundary Score must be >=95");
  console.log("PASS check-cognitive-hard-seal");
}

main();

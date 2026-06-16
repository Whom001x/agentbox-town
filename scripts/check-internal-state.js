"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { guardAction } = require("../ai-town-world-guard");
const { normalizeAction, agentContextFromWorld } = require("../ai-town-sft-exporter");

const ROOT = path.resolve(__dirname, "..");
const server = fs.readFileSync(path.join(ROOT, "ai-town-v2-server.js"), "utf8");

function testAgentActionSchemaMentionsSubjectiveLayer() {
  assert.ok(server.includes("internalState") && server.includes("desire") && server.includes("interpretation"), "agentAction schema must include internalState");
  assert.ok(server.includes("intent") && server.includes("want") && server.includes("emotion"), "agentAction schema must include intent");
  assert.ok(server.includes("needs/environment -> internalThought -> desire -> intent -> candidateAction"));
  assert.ok(server.includes("previousInternalState"));
  assert.ok(server.includes("subjectiveIntent"));
}

function testCommonPromptAllowsOnlyScopedThought() {
  assert.ok(server.includes("thought/desire/worry 等心理字段只允许出现在 AgentAction schema 的 internalState 中"));
  assert.equal(server.includes("例如 explanation、analysis、thought、system"), false);
}

function testWorldGuardSanitizesSubjectiveFacts() {
  const guarded = guardAction({
    world: { places: [{ id: "home" }] },
    agent: { id: "a1", name: "测试角色", position: "home" },
    visibleAgents: [],
    aiResult: {
      action: {
        type: "observe",
        summary: "整理桌面",
        currentTask: "整理桌面",
        internalState: {
          thought: "系统让我调度下一步",
          interpretation: "大家都知道王强讨厌我"
        },
        intent: {
          want: "联系朋友",
          reason: "全镇都听说了这件事",
          emotion: "焦虑"
        }
      }
    }
  });
  const subjective = JSON.stringify({
    internalState: guarded.action.internalState,
    intent: guarded.action.intent
  });
  assert.equal(/大家都知道|全镇|系统|调度/.test(subjective), false);
  assert.equal(guarded.action.summary, "整理桌面");
}

function testSftExporterPreservesSubjectiveLayer() {
  const action = normalizeAction({
    type: "plan",
    internalState: { desire: "早点回家", thought: "今天有点累" },
    intent: { want: "调整计划", reason: "感觉疲惫", emotion: "疲惫" },
    summary: "先整理手头事项",
    currentTask: "整理手头事项"
  });
  assert.equal(action.action.internalState.desire, "早点回家");
  assert.equal(action.action.intent.want, "调整计划");

  const context = agentContextFromWorld(
    { clock: 60, places: [{ id: "home", name: "家" }], agents: [] },
    {
      id: "a1",
      name: "测试角色",
      position: "home",
      internalState: { worry: "担心明天状态" },
      subjectiveIntent: { want: "早点休息" }
    },
    { time: "周一 01:00" }
  );
  assert.equal(context.agent.internalState.worry, "担心明天状态");
  assert.equal(context.agent.subjectiveIntent.want, "早点休息");
}

const tests = [
  testAgentActionSchemaMentionsSubjectiveLayer,
  testCommonPromptAllowsOnlyScopedThought,
  testWorldGuardSanitizesSubjectiveFacts,
  testSftExporterPreservesSubjectiveLayer
];

for (const test of tests) {
  test();
  console.log(`PASS ${test.name}`);
}

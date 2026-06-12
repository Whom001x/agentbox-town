const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const defaultExportDir = path.join(root, "saves", "exports");

function latestJsonl(dir) {
  if (!fs.existsSync(dir)) return "";
  const files = fs.readdirSync(dir)
    .filter(name => name.endsWith(".jsonl"))
    .map(name => {
      const filePath = path.join(dir, name);
      return { filePath, mtime: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  return files[0]?.filePath || "";
}

function includesAny(text, words) {
  const lower = String(text || "").toLowerCase();
  return words.some(word => lower.includes(word.toLowerCase()));
}

function parseAssistant(content) {
  try {
    return JSON.parse(content || "{}");
  } catch (error) {
    return { _parseError: error.message };
  }
}

function parseUser(content) {
  try {
    return JSON.parse(content || "{}");
  } catch {
    return {};
  }
}

function checkFile(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
  const stats = {
    file: filePath,
    total: lines.length,
    parseErrors: 0,
    roleErrors: 0,
    assistantJsonErrors: 0,
    fallbackSamples: 0,
    liveSamples: 0,
    deathContextSamples: 0,
    riskyTextSamples: 0,
    waitLikeSamples: 0,
    emptyActionSamples: 0,
    tooLongSamples: 0,
    actionTypes: {},
    sources: {},
    examples: []
  };
  const riskyWords = [
    "JSON 修复兜底",
    "格式错误",
    "越权",
    "系统修正",
    "已死亡",
    "不能继续行动",
    "AI 返回格式错误",
    "停下整理思路",
    "复活",
    "全镇知道",
    "凭空知道"
  ];
  lines.forEach((line, index) => {
    let row;
    try {
      row = JSON.parse(line);
    } catch (error) {
      stats.parseErrors += 1;
      stats.examples.push({ line: index + 1, issue: "parse_error", message: error.message });
      return;
    }
    const conversations = row.conversations;
    if (!Array.isArray(conversations) || conversations.length !== 3 || conversations[0]?.role !== "system" || conversations[1]?.role !== "user" || conversations[2]?.role !== "assistant") {
      stats.roleErrors += 1;
      stats.examples.push({ line: index + 1, issue: "role_error" });
      return;
    }
    const allText = conversations.map(item => item.content || "").join("\n");
    if (allText.length > 12000) stats.tooLongSamples += 1;
    if (includesAny(allText, riskyWords)) stats.riskyTextSamples += 1;
    const input = parseUser(conversations[1].content);
    const source = input?.source?.kind || "unknown";
    stats.sources[source] = (stats.sources[source] || 0) + 1;
    if (source.includes("fallback")) stats.fallbackSamples += 1;
    if (source.includes("live")) stats.liveSamples += 1;
    if (/death|lifeStatus":"dead|"dead":true|死亡/.test(conversations[1].content || "")) stats.deathContextSamples += 1;
    const output = parseAssistant(conversations[2].content);
    if (output._parseError) {
      stats.assistantJsonErrors += 1;
      stats.examples.push({ line: index + 1, issue: "assistant_json_error", message: output._parseError });
      return;
    }
    const action = output.action || {};
    const type = action.type || "";
    stats.actionTypes[type] = (stats.actionTypes[type] || 0) + 1;
    const summary = String(action.summary || action.currentTask || "");
    if (!summary.trim()) stats.emptyActionSamples += 1;
    if (/wait|daily_action/.test(type) || /观察|等待|休息|维持|整理/.test(summary)) stats.waitLikeSamples += 1;
    if (stats.examples.length < 6 && (source.includes("fallback") || /death|死亡/.test(conversations[1].content || ""))) {
      stats.examples.push({
        line: index + 1,
        issue: "low_quality_candidate",
        source,
        actionType: type,
        agent: input?.agent?.name || "",
        summary: summary.slice(0, 160)
      });
    }
  });
  return stats;
}

function grade(stats) {
  if (!stats.total) return "empty";
  if (stats.parseErrors || stats.roleErrors || stats.assistantJsonErrors) return "invalid";
  const fallbackRate = stats.fallbackSamples / stats.total;
  const deathRate = stats.deathContextSamples / stats.total;
  const waitRate = stats.waitLikeSamples / stats.total;
  if (fallbackRate > 0.5 || deathRate > 0.2 || waitRate > 0.7) return "poor";
  if (fallbackRate > 0.15 || deathRate > 0.05 || waitRate > 0.45) return "needs_filtering";
  return "usable";
}

function main() {
  const input = process.argv[2];
  const filePath = input ? path.resolve(input) : latestJsonl(defaultExportDir);
  if (!filePath) throw new Error(`No jsonl file found in ${defaultExportDir}`);
  const stats = checkFile(filePath);
  stats.grade = grade(stats);
  stats.recommendations = [];
  if (stats.fallbackSamples) stats.recommendations.push("Run the town longer after the live sampler update; prefer live agent-action samples over record-fallback samples.");
  if (stats.deathContextSamples) stats.recommendations.push("Filter death-context samples until mortality and medical escalation are fixed.");
  if (stats.waitLikeSamples > stats.total * 0.5) stats.recommendations.push("Collect more active movement/service/study/work samples; current set is dominated by waiting/resting.");
  if (stats.riskyTextSamples) stats.recommendations.push("Remove risky correction/override samples before SFT.");
  console.log(JSON.stringify(stats, null, 2));
}

main();

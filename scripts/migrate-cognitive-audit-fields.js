"use strict";

const fs = require("fs");
const path = require("path");
const { migrateLegacyCognitiveAuditFields } = require("../ai-town-memory-stream");

const roots = [
  path.join(__dirname, "..", "saves"),
  path.join(__dirname, "..", "..", "agentbox-town-main", "saves")
];

function worldFiles(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .map(name => path.join(root, name, "world.json"))
    .filter(file => fs.existsSync(file));
}

function migrateFile(file) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const world = raw.world || raw;
  const report = migrateLegacyCognitiveAuditFields(world);
  if (!report.updatedItems) return { file, changed: false, updatedItems: 0 };
  const backup = `${file}.cognitive-audit.bak`;
  if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
  fs.writeFileSync(file, JSON.stringify(raw, null, 2), "utf8");
  return { file, changed: true, updatedItems: report.updatedItems, backup };
}

function main() {
  const files = [...new Set(roots.flatMap(worldFiles))];
  const results = files.map(migrateFile);
  const changed = results.filter(item => item.changed);
  console.log(JSON.stringify({
    checkedFiles: files.length,
    changedFiles: changed.length,
    updatedItems: changed.reduce((sum, item) => sum + item.updatedItems, 0),
    changed
  }, null, 2));
}

main();

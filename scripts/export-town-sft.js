const fs = require("fs");
const path = require("path");
const { exportTownSft, writeJsonl } = require("../ai-town-sft-exporter");

const root = path.resolve(__dirname, "..");
const saveDir = path.join(root, "saves");

function safeSaveName(name) {
  return String(name || "default")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 64) || "default";
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function listSlots() {
  if (!fs.existsSync(saveDir)) return [];
  return fs.readdirSync(saveDir, { withFileTypes: true })
    .filter(item => item.isDirectory() && item.name !== "exports")
    .map(item => item.name);
}

function readPayload(slot) {
  const safeSlot = safeSaveName(slot);
  const folder = path.join(saveDir, safeSlot);
  const worldPath = path.join(folder, "world.json");
  const oldPath = path.join(saveDir, `${safeSlot}.json`);
  if (fs.existsSync(worldPath)) return readJson(worldPath);
  if (fs.existsSync(oldPath)) return readJson(oldPath);
  throw new Error(`Save not found: ${safeSlot}`);
}

function main() {
  const slot = process.argv[2] || listSlots()[0];
  const limit = Number(process.argv[3] || 5000);
  if (!slot) throw new Error("No save slot found. Usage: node scripts/export-town-sft.js <slot> [limit]");
  const payload = readPayload(slot);
  const world = payload.world || payload || {};
  const samples = exportTownSft(world, { limit, includeFallback: true });
  const outDir = path.join(saveDir, "exports");
  const fileName = `${safeSaveName(slot)}-agent-action-sft-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`;
  const outPath = path.join(outDir, fileName);
  writeJsonl(outPath, samples);
  console.log(JSON.stringify({
    ok: true,
    slot: safeSaveName(slot),
    sampleCount: samples.length,
    file: outPath,
    format: "minimind-conversations-jsonl"
  }, null, 2));
}

main();

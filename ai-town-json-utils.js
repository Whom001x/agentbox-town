const fs = require("fs");
const path = require("path");

function sanitizeForJson(value, seen = new WeakSet()) {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    return value
      .replace(/\u0000/g, "")
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
      .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
  }
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    const output = value.map(item => sanitizeForJson(item, seen));
    seen.delete(value);
    return output;
  }
  const output = {};
  Object.entries(value).forEach(([key, item]) => {
    if (item !== undefined && typeof item !== "function" && typeof item !== "symbol") {
      output[key] = sanitizeForJson(item, seen);
    }
  });
  seen.delete(value);
  return output;
}

function safeJsonClone(value) {
  return JSON.parse(JSON.stringify(sanitizeForJson(value)));
}

function readJsonIfExists(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, data, options = {}) {
  const safePath = options.assertPath ? options.assertPath(filePath) : filePath;
  fs.mkdirSync(path.dirname(safePath), { recursive: true });
  fs.writeFileSync(safePath, `${JSON.stringify(sanitizeForJson(data), null, 2)}\n`, "utf8");
}

module.exports = {
  sanitizeForJson,
  safeJsonClone,
  readJsonIfExists,
  writeJsonFile
};

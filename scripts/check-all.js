"use strict";

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const EXCLUDED_SEGMENTS = new Set([".git", "node_modules", "saves", "logs", ".gradle-local", "android"]);
const TEXT_EXTENSIONS = new Set([".js", ".json", ".html", ".md", ".cmd", ".ps1", ".txt"]);
const JSON_EXTENSIONS = new Set([".json"]);
const JS_EXTENSIONS = new Set([".js"]);
const HTML_EXTENSIONS = new Set([".html"]);

function isExcluded(fullPath) {
  if (path.extname(fullPath).toLowerCase() === ".log") return true;
  const relative = path.relative(ROOT, fullPath);
  const parts = relative.split(path.sep);
  if (parts.includes("android") && parts.includes("mobile-app")) return true;
  return parts.some(part => EXCLUDED_SEGMENTS.has(part));
}

function walk(dir, output = []) {
  for (const name of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, name);
    if (isExcluded(fullPath)) continue;
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) walk(fullPath, output);
    else output.push(fullPath);
  }
  return output;
}

function requireBabelParser() {
  const candidates = [
    path.join(ROOT, "node_modules", "@babel", "parser"),
    path.join(ROOT, "mobile-app", "node_modules", "@babel", "parser")
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {}
  }
  return null;
}

function parseJsWithNode(filePath) {
  childProcess.execFileSync(process.execPath, ["--check", filePath], { stdio: "pipe" });
}

function parseJsWithBabel(parser, code, label) {
  try {
    parser.parse(code, {
      sourceType: "unambiguous",
      plugins: ["jsx", "classProperties", "objectRestSpread", "optionalChaining", "nullishCoalescingOperator"]
    });
  } catch (error) {
    error.message = `${label}: ${error.message}`;
    throw error;
  }
}

function htmlScripts(html) {
  const scripts = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const attrs = match[1] || "";
    if (/\bsrc\s*=/.test(attrs)) continue;
    const type = (attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [])[1] || "text/javascript";
    if (!/^(module|text\/javascript|application\/javascript)$/i.test(type)) continue;
    scripts.push(match[2] || "");
  }
  return scripts;
}

function validateText(text, filePath) {
  if (text.includes("\u0000")) throw new Error(`${filePath}: contains NUL byte`);
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text)) {
    throw new Error(`${filePath}: contains invalid unicode surrogate`);
  }
}

function main() {
  const parser = requireBabelParser();
  const files = walk(ROOT);
  const stats = {
    files: files.length,
    text: 0,
    json: 0,
    js: 0,
    html: 0,
    assets: 0,
    skippedSyntax: []
  };
  const errors = [];

  for (const filePath of files) {
    const relative = path.relative(ROOT, filePath);
    const ext = path.extname(filePath).toLowerCase();
    try {
      const size = fs.statSync(filePath).size;
      if (size <= 0) throw new Error(`${relative}: empty file`);
      if (!TEXT_EXTENSIONS.has(ext)) {
        stats.assets += 1;
        continue;
      }
      const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
      validateText(text, relative);
      stats.text += 1;
      if (JSON_EXTENSIONS.has(ext)) {
        JSON.parse(text);
        stats.json += 1;
      }
      if (JS_EXTENSIONS.has(ext)) {
        if (parser) parseJsWithBabel(parser, text, relative);
        else parseJsWithNode(filePath);
        stats.js += 1;
      }
      if (HTML_EXTENSIONS.has(ext)) {
        const scripts = htmlScripts(text);
        if (parser) scripts.forEach((script, index) => parseJsWithBabel(parser, script, `${relative} <script ${index + 1}>`));
        else if (scripts.length) stats.skippedSyntax.push(relative);
        stats.html += 1;
      }
    } catch (error) {
      errors.push(`${relative}: ${error.message}`);
    }
  }

  if (errors.length) {
    console.error("FAIL check-all");
    errors.slice(0, 30).forEach(error => console.error(`- ${error}`));
    if (errors.length > 30) console.error(`... ${errors.length - 30} more`);
    process.exit(1);
  }
  console.log(JSON.stringify(stats, null, 2));
  if (stats.skippedSyntax.length) {
    console.log(`Skipped HTML script syntax without @babel/parser: ${stats.skippedSyntax.join(", ")}`);
  }
  console.log("PASS check-all");
}

main();

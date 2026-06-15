"use strict";

function clamp(value, min, max, fallback = min) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function placeId(agent) {
  return agent?.position || agent?.place || "";
}

function isAlive(agent) {
  return Boolean(agent?.id) && agent.lifeStatus !== "dead" && agent?.terminalState?.dead !== true;
}

module.exports = {
  clamp,
  placeId,
  isAlive
};

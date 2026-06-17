"use strict";

function need(agent, key, fallback = 100) {
  return Number(agent?.needs?.[key] ?? fallback);
}

function detectInterruption(world, agent = {}) {
  if (!agent?.id || agent.lifeStatus === "dead") return null;
  const health = need(agent, "health");
  const safety = need(agent, "safety");
  const hunger = need(agent, "hunger");
  const hygiene = need(agent, "hygiene");
  const comfort = need(agent, "comfort");
  const energy = Number(agent.energy ?? 70);
  const emotion = agent.emotionVector || agent.emotions || {};
  const anxious = Number(emotion.anxious ?? 0);
  const angry = Number(emotion.angry ?? 0);
  const sad = Number(emotion.sad ?? 0);

  if (health < 20) return interruption("health", 100, "seek_clinic_or_help", "health is critical", true);
  if (safety < 20) return interruption("safety", 96, "seek_safe_place_or_help", "safety is critical", true);
  if (hunger < 10) return interruption("hunger", 90, "eat_or_go_home", "hunger is critical", true);
  if (energy <= 18) return interruption("fatigue", 84, "rest_or_go_home", "energy is critical", true);

  if (health <= 30) return interruption("health", 72, "slow_down_or_rest", "health is low", false);
  if (hunger <= 35) return interruption("hunger", 66, "eat_at_next_chance", "hunger is low", false);
  if (safety <= 32) return interruption("safety", 64, "avoid_obvious_risk", "safety is low", false);
  if (energy <= 30) return interruption("fatigue", 62, "prefer_rest", "energy is low", false);
  if (hygiene <= 24) return interruption("hygiene", 54, "clean_up_when_possible", "hygiene is low", false);
  if (comfort <= 22) return interruption("comfort", 50, "seek_comfort_when_possible", "comfort is low", false);
  if (Math.max(anxious, angry, sad) >= 92 && energy <= 45) {
    return interruption("emotion", 60, "cool_down_or_seek_help", "emotion is unstable", false);
  }
  return null;
}

function interruption(type, priority, actionHint, reason, canOverridePlan) {
  return { type, priority, actionHint, reason, canOverridePlan };
}

module.exports = {
  detectInterruption
};

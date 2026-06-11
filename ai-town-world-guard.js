function guardAction({ world, agent, aiResult, visibleAgents = [] }) {
  const action = aiResult?.action || {};
  const guarded = { ...aiResult, action: { ...action } };
  const text = `${action.type || ""} ${action.summary || ""} ${action.currentTask || ""}`;
  const places = Array.isArray(world?.places) ? world.places : [];
  const cnStaff = /医生|护士|老师|店员|老板|职员|工作人员|医护|收银|服务员/;
  const cnSocial = /聊天|交谈|询问|寒暄|讨论|安慰|陪伴|社交|谈话/;
  const cnForbidden = /死亡|死了|复活|全镇|所有人都知道|大家都知道|瞬间到达|立刻到达|凭空知道|上帝视角|系统|调度|队列/;
  const otherCount = visibleAgents.length;
  const visibleHasStaff = visibleAgents.some(item => cnStaff.test(String(item.job || "")));

  if (guarded.action.newLocation && !places.some(place => place.id === guarded.action.newLocation)) {
    guarded.action.newLocation = "";
  }
  if (!visibleHasStaff && cnStaff.test(text)) {
    guarded.action.summary = "当前地点没有可见的对应工作人员，先维持当前状态并观察下一步机会。";
    guarded.action.currentTask = "观察等待";
    guarded.action.type = "wait";
    guarded.action.newLocation = "";
  }
  if (otherCount === 0 && cnSocial.test(text)) {
    guarded.action.summary = "周围没有可交谈的人，先独自整理思路。";
    guarded.action.currentTask = "独自整理思路";
    guarded.action.type = "wait";
    guarded.action.relationChanges = [];
  }
  if (cnForbidden.test(text)) {
    guarded.action.summary = "行动内容越权，角色只能做当前地点内可见、可执行的小动作。";
    guarded.action.currentTask = "维持当前安排";
    guarded.action.type = "wait";
    guarded.action.newLocation = "";
    guarded.action.newEvents = [];
  }
  if (agent?.lifeStatus === "dead") {
    guarded.action.summary = "角色已死亡，不能继续行动。";
    guarded.action.currentTask = "无行动";
    guarded.action.type = "none";
    guarded.action.newLocation = "";
    guarded.action.newEvents = [];
    guarded.action.relationChanges = [];
  }
  return guarded;
}

module.exports = { guardAction };

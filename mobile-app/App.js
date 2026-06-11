import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  NativeModules,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions
} from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";

const palette = {
  bg: "#081018",
  panel: "rgba(9, 22, 34, 0.86)",
  panelSolid: "#0d1d2c",
  panel2: "rgba(18, 42, 61, 0.86)",
  line: "rgba(147, 211, 255, 0.35)",
  ink: "#f4fbff",
  muted: "#a9bed0",
  blue: "#53b8ff",
  green: "#6dcc73",
  amber: "#ffd06c",
  red: "#ff7668",
  dark: "#07111b"
};

const needLabels = {
  hunger: "饱腹",
  hygiene: "清洁",
  health: "健康",
  social: "社交",
  responsibility: "责任",
  stress: "抗压",
  comfort: "舒适",
  safety: "安全"
};

const emotionLabels = {
  happy: "开心",
  anxious: "焦虑",
  angry: "愤怒",
  sad: "悲伤",
  tired: "疲惫",
  lonely: "孤独",
  hopeful: "希望",
  calm: "平静",
  curious: "好奇"
};

function guessServerUrl() {
  const scriptUrl = NativeModules?.SourceCode?.scriptURL || "";
  const match = String(scriptUrl).match(/^[a-z]+:\/\/([^/:?#]+)/i);
  return match?.[1] ? `http://${match[1]}:8788` : "http://192.168.5.6:8788";
}

const defaultServer = guessServerUrl();

function cleanBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function isDead(agent) {
  return agent?.lifeStatus === "dead" || agent?.terminalState?.dead;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function firstText(value, fallback = "-") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function useTownApi(initialBaseUrl) {
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);

  const request = useCallback(async (path, options = {}) => {
    const url = `${cleanBaseUrl(baseUrl)}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || 12000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = data?.error?.message || data?.error || `HTTP ${response.status}`;
        throw new Error(message);
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }, [baseUrl]);

  return { baseUrl, setBaseUrl, request };
}

export default function App() {
  const { height } = useWindowDimensions();
  const landscape = true;
  const { baseUrl, setBaseUrl, request } = useTownApi(defaultServer);
  const [serverInput, setServerInput] = useState(defaultServer);
  const [saves, setSaves] = useState([]);
  const [slot, setSlot] = useState("");
  const [payload, setPayload] = useState(null);
  const [runtime, setRuntime] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [drawer, setDrawer] = useState({ type: "", title: "", item: null });
  const [eventsExpanded, setEventsExpanded] = useState(false);

  const world = payload?.world || {};
  const agents = Array.isArray(world.agents) ? world.agents : [];
  const places = Array.isArray(world.places) ? world.places : [];
  const boxes = payload?.locationBoxes || {};
  const aliveAgents = agents.filter(agent => !isDead(agent));
  const selectedSave = saves.find(save => save.slot === slot);

  const placeById = useCallback((id) => places.find(place => place.id === id) || null, [places]);
  const placeName = useCallback((id) => placeById(id)?.name || id || "未知地点", [placeById]);
  const placeAgentCount = useCallback((id) => agents.filter(agent => agent.position === id && !isDead(agent)).length, [agents]);

  const clockText = useMemo(() => {
    if (payload?.meta?.clockText) return payload.meta.clockText;
    const minutes = Number(world.clock || 0);
    const day = Math.floor(minutes / 1440) + 1;
    const hh = String(Math.floor((minutes % 1440) / 60)).padStart(2, "0");
    const mm = String(minutes % 60).padStart(2, "0");
    return `第 ${day} 天 ${hh}:${mm}`;
  }, [payload, world.clock]);

  const weatherText = useMemo(() => {
    const weather = world.weatherBox || {};
    return weather.current?.condition || weather.now?.condition || weather.condition || "暂无天气";
  }, [world.weatherBox]);

  const recentEvents = useMemo(() => {
    return [
      ...(Array.isArray(world.records) ? world.records : []),
      ...(Array.isArray(world.logs) ? world.logs : []),
      ...(Array.isArray(world.publicEvents) ? world.publicEvents : [])
    ].slice(0, 5);
  }, [world.records, world.logs, world.publicEvents]);

  const loadSaves = useCallback(async () => {
    const data = await request("/api/saves");
    const rows = data.saves || [];
    setSaves(rows);
    const nextSlot = slot || rows.find(save => Number(save.agentCount || 0) > 0)?.slot || rows[0]?.slot || "";
    if (nextSlot && nextSlot !== slot) setSlot(nextSlot);
    return nextSlot;
  }, [request, slot]);

  const loadRuntime = useCallback(async () => {
    const data = await request("/api/runtime/status", { timeoutMs: 7000 }).catch(() => null);
    setRuntime(data);
    return data;
  }, [request]);

  const loadSlot = useCallback(async (targetSlot) => {
    if (!targetSlot) return;
    const data = await request(`/api/saves/${encodeURIComponent(targetSlot)}`);
    setPayload(data);
    setSlot(targetSlot);
  }, [request]);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setMessage("");
      const nextSlot = await loadSaves();
      await loadRuntime();
      if (slot || nextSlot) await loadSlot(slot || nextSlot);
    } catch (error) {
      setMessage(error.message || "刷新失败");
    } finally {
      setLoading(false);
    }
  }, [loadRuntime, loadSaves, loadSlot, slot]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, runtime?.state === "running" ? 4000 : 9000);
    return () => clearInterval(timer);
  }, [refresh, runtime?.state]);

  async function connectServer() {
    setBaseUrl(cleanBaseUrl(serverInput));
    setPayload(null);
    setSlot("");
    setTimeout(refresh, 50);
  }

  async function toggleRuntime() {
    if (!slot) return;
    try {
      setLoading(true);
      const endpoint = runtime?.state === "running" ? "/api/runtime/pause" : "/api/runtime/start";
      const data = await request(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slot, engine: "node-core-v1" })
      });
      setRuntime(data);
    } catch (error) {
      setMessage(error.message || "控制失败");
    } finally {
      setLoading(false);
    }
  }

  async function stepOnce() {
    if (!slot) return;
    try {
      setLoading(true);
      const data = await request("/api/runtime/step", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slot, engine: "node-core-v1" })
      });
      setRuntime(data);
    } catch (error) {
      setMessage(error.message || "单步失败");
    } finally {
      setLoading(false);
    }
  }

  function healthSummary(agent) {
    const needs = agent.needs || {};
    const low = Object.entries(needs).filter(([, value]) => Number(value) <= 25).map(([key]) => needLabels[key] || key);
    if (isDead(agent)) return "已死亡";
    if (agent.isSleeping) return "睡眠中";
    if (low.length) return `${low.slice(0, 2).join("、")}偏低`;
    return agent.mood || "状态稳定";
  }

  function primaryTask(agent) {
    return agent.currentTask || agent.activeProcess?.currentStep || agent.lastTimePassage?.summary || "观察周围";
  }

  function openPlace(place) {
    setDrawer({ type: "place", title: place.name || place.id, item: place });
  }

  function openAgent(agent) {
    setDrawer({ type: "agent", title: agent.name || "角色", item: agent });
  }

  const mapPlaces = places.length ? places : [{ id: "town", name: "小镇", x: 50, y: 50 }];
  const mapHeight = height;

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar hidden />
      <View style={styles.cityBackdrop} />
      {!payload ? (
        <StartScreen
          baseUrl={baseUrl}
          serverInput={serverInput}
          setServerInput={setServerInput}
          connectServer={connectServer}
          saves={saves}
          loadSlot={loadSlot}
          loading={loading}
          message={message}
        />
      ) : (
        <View style={styles.game}>
          <TownMap
            landscape={landscape}
            mapHeight={mapHeight}
            places={mapPlaces}
            boxes={boxes}
            placeAgentCount={placeAgentCount}
            openPlace={openPlace}
          />
          <MiniMap places={mapPlaces} />
          <TopHud
            townName={selectedSave?.name || payload?.meta?.name || slot || "小镇"}
            clockText={clockText}
            weatherText={weatherText}
            runtime={runtime}
            loading={loading}
            refresh={refresh}
            toggleRuntime={toggleRuntime}
          />
          <SidePanel
            events={recentEvents}
            agents={agents}
            runtime={runtime}
            landscape={landscape}
            openAgent={openAgent}
            expanded={eventsExpanded}
            toggleExpanded={() => setEventsExpanded(value => !value)}
          />
          <BottomBar
            slot={slot}
            saves={saves}
            loadSlot={loadSlot}
            showPeople={() => setDrawer({ type: "people", title: "角色", item: null })}
            showPlaces={() => setDrawer({ type: "places", title: "地点", item: null })}
            showEvents={() => setDrawer({ type: "events", title: "事件", item: null })}
            showRelations={() => setDrawer({ type: "relations", title: "关系", item: null })}
            showControl={() => setDrawer({ type: "control", title: "控制", item: null })}
          />
          <View style={styles.peopleBadge}>
            <Ionicons name="people" size={16} color={palette.ink} />
            <Text style={styles.peopleBadgeText}>{aliveAgents.length}/{agents.length}</Text>
          </View>
          {!!message && <Text style={styles.message}>{message}</Text>}
        </View>
      )}
      <Drawer
        drawer={drawer}
        close={() => setDrawer({ type: "", title: "", item: null })}
        agents={agents}
        places={places}
        boxes={boxes}
        placeName={placeName}
        placeAgentCount={placeAgentCount}
        healthSummary={healthSummary}
        primaryTask={primaryTask}
        openAgent={openAgent}
        openPlace={openPlace}
        events={recentEvents}
        runtime={runtime}
        toggleRuntime={toggleRuntime}
        stepOnce={stepOnce}
        refresh={refresh}
      />
    </SafeAreaView>
  );
}

function StartScreen({ serverInput, setServerInput, connectServer, saves, loadSlot, loading, message }) {
  return (
    <View style={styles.startWrap}>
      <View style={styles.startCard}>
        <Text style={styles.startTitle}>小镇观察器</Text>
        <Text style={styles.startText}>独立手机 App。输入电脑后端局域网地址，读取同一份小镇存档。</Text>
        <Text style={styles.label}>后端地址</Text>
        <TextInput
          value={serverInput}
          onChangeText={setServerInput}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="http://192.168.10.30:8788"
          placeholderTextColor="#6f8293"
          style={styles.input}
        />
        <Pressable style={styles.primaryButton} onPress={connectServer}>
          <Text style={styles.primaryButtonText}>连接小镇</Text>
        </Pressable>
        {loading && <ActivityIndicator color={palette.blue} />}
        {!!message && <Text style={styles.messageInline}>{message}</Text>}
        <ScrollView style={styles.saveList}>
          {saves.map(save => (
            <Pressable key={save.slot} style={styles.saveRow} onPress={() => loadSlot(save.slot)}>
              <Text style={styles.saveName}>{save.name || save.slot}</Text>
              <Text style={styles.saveMeta}>{save.clockText || "未知时间"} | {save.agentCount || 0} 人</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

function TopHud({ townName, clockText, weatherText, runtime, loading, refresh, toggleRuntime }) {
  return (
    <View style={styles.topHud}>
      <View style={styles.titleBlock}>
        <Text style={styles.townName} numberOfLines={1}>{townName}</Text>
        <Text style={styles.hudSub} numberOfLines={1}>{clockText} | {weatherText}</Text>
      </View>
      <View style={styles.hudActions}>
        <Pressable style={styles.roundButton} onPress={toggleRuntime}>
          <Ionicons name={runtime?.state === "running" ? "pause" : "play"} size={17} color={palette.ink} />
        </Pressable>
        <Pressable style={styles.roundButton} onPress={refresh}>
          {loading ? <ActivityIndicator color={palette.ink} size="small" /> : <Ionicons name="refresh" size={16} color={palette.ink} />}
        </Pressable>
      </View>
    </View>
  );
}

function MiniMap({ places }) {
  return (
    <View style={styles.miniMap}>
      <View style={styles.panelHeader}>
        <Text style={styles.panelTitle}>小镇地图</Text>
        <Ionicons name="location" size={18} color={palette.ink} />
      </View>
      <View style={styles.miniMapBody}>
        {places.slice(0, 40).map(place => (
          <View
            key={place.id}
            style={[
              styles.miniDot,
              { left: `${clamp(place.x ?? 50, 5, 95)}%`, top: `${clamp(place.y ?? 50, 5, 95)}%` }
            ]}
          />
        ))}
      </View>
    </View>
  );
}

function TownMap({ mapHeight, places, boxes, placeAgentCount, openPlace }) {
  return (
    <View style={[styles.map, { height: mapHeight }]}>
      <View style={styles.sunGlow} />
      <View style={[styles.road, styles.roadH]} />
      <View style={[styles.road, styles.roadV]} />
      <View style={styles.water} />
      {places.map((place, index) => {
        const count = placeAgentCount(place.id);
        const box = boxes[place.id] || {};
        const hasEvent = (box.localEvents || []).length > 0;
        const busy = count >= 8 || /busy|忙|排队/.test(String(box.agentState?.status || box.state?.tempo || ""));
        return (
          <Pressable
            key={place.id || index}
            style={[
              styles.place,
              {
                left: `${clamp(place.x ?? (18 + (index % 4) * 22), 7, 93)}%`,
                top: `${clamp(place.y ?? (18 + Math.floor(index / 4) * 18), 8, 92)}%`
              },
              busy && styles.placeBusy,
              hasEvent && styles.placeEvent
            ]}
            onPress={() => openPlace(place)}
          >
            <Text style={styles.placeName} numberOfLines={1}>{place.name || place.id}</Text>
            <Text style={styles.placeCount}>{count} 人</Text>
            {hasEvent && <View style={styles.eventMark}><Text style={styles.eventMarkText}>!</Text></View>}
          </Pressable>
        );
      })}
    </View>
  );
}

function SidePanel({ events, agents, runtime, landscape, openAgent, expanded, toggleExpanded }) {
  const critical = agents.filter(agent => !isDead(agent) && Object.values(agent.needs || {}).some(value => Number(value) <= 20)).slice(0, 3);
  const visibleEvents = events.slice(0, expanded ? 8 : 3);
  return (
    <View style={[styles.sidePanel, expanded && styles.sidePanelExpanded, !landscape && styles.sidePanelPortrait]}>
      <View style={styles.panelHeader}>
        <MaterialCommunityIcons name="bullhorn" size={18} color={palette.ink} />
        <Text style={styles.panelTitle}>小镇事件</Text>
        <Pressable style={styles.panelToggle} onPress={toggleExpanded}>
          <Text style={styles.panelToggleText}>{expanded ? "收拢" : "展开"}</Text>
          <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={16} color={palette.ink} />
        </Pressable>
      </View>
      <ScrollView style={styles.eventScroll} nestedScrollEnabled showsVerticalScrollIndicator={expanded}>
        {visibleEvents.map((event, index) => (
          <View key={`${event.title || "event"}-${index}`} style={styles.eventRow}>
            <Text style={styles.eventTitle} numberOfLines={1}>{event.title || "小镇事件"}</Text>
            <Text style={styles.eventBody} numberOfLines={expanded ? 4 : 2}>{event.body || event.summary || event.text || "等待后台推进"}</Text>
          </View>
        ))}
        {!events.length && <Text style={styles.emptyText}>暂无事件</Text>}
      </ScrollView>
      <View style={styles.panelHeaderSmall}>
        <MaterialCommunityIcons name="target" size={17} color={palette.ink} />
        <Text style={styles.panelTitle}>异常关注</Text>
      </View>
      {critical.map(agent => (
        <Pressable key={agent.id} style={styles.warningRow} onPress={() => openAgent(agent)}>
          <Text style={styles.warningTitle}>{agent.name}</Text>
          <Text style={styles.eventBody} numberOfLines={1}>{agent.currentTask || "状态偏低"}</Text>
        </Pressable>
      ))}
      {!critical.length && <Text style={styles.emptyText}>暂无高危角色</Text>}
      <Text style={styles.runtimeText}>后台：{runtime?.state || "未知"}</Text>
    </View>
  );
}

function BottomBar({ showPeople, showPlaces, showEvents, showRelations, showControl }) {
  return (
    <View style={styles.bottomBar}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bottomItems}>
        <ActionButton icon="map" label="地图" active />
        <ActionButton icon="people" label="角色" onPress={showPeople} />
        <ActionButton icon="business" label="地点" onPress={showPlaces} />
        <ActionButton icon="newspaper" label="事件" onPress={showEvents} />
        <ActionButton icon="git-network" label="关系" onPress={showRelations} />
        <ActionButton icon="settings" label="控制" onPress={showControl} />
      </ScrollView>
    </View>
  );
}

function ActionButton({ icon, label, active, onPress }) {
  return (
    <Pressable style={[styles.actionButton, active && styles.actionActive]} onPress={onPress}>
      <Ionicons name={icon} size={19} color={active ? palette.dark : palette.ink} />
      <Text style={[styles.actionText, active && styles.actionTextActive]}>{label}</Text>
    </Pressable>
  );
}

function Drawer(props) {
  const { drawer, close } = props;
  return (
    <Modal visible={!!drawer.type} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.modalBackdrop}>
        <Pressable style={styles.backdropTap} onPress={close} />
        <View style={styles.drawer}>
          <View style={styles.drawerHead}>
            <Text style={styles.drawerTitle}>{drawer.title}</Text>
            <Pressable style={styles.closeButton} onPress={close}>
              <Ionicons name="close" size={20} color={palette.ink} />
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={styles.drawerBody}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            showsVerticalScrollIndicator
          >
            <DrawerBody {...props} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function DrawerBody({
  drawer,
  agents,
  places,
  boxes,
  placeName,
  placeAgentCount,
  healthSummary,
  primaryTask,
  openAgent,
  openPlace,
  events,
  runtime,
  toggleRuntime,
  stepOnce,
  refresh
}) {
  if (drawer.type === "place") {
    const place = drawer.item || {};
    const here = agents.filter(agent => agent.position === place.id);
    const box = boxes[place.id] || {};
    return (
      <>
        <Info label="状态" value={box.agentState?.status || box.state?.tempo || "普通"} />
        <Info label="在场" value={`${here.length} 人`} />
        <Info label="地点事件" value={(box.localEvents || []).map(event => event.title || event.summary).slice(0, 4).join("；") || "暂无"} />
        {here.slice(0, 40).map(agent => (
          <Pressable key={agent.id} style={styles.listRow} onPress={() => openAgent(agent)}>
            <Text style={styles.listTitle}>{agent.name} | {agent.job || "居民"}</Text>
            <Text style={styles.listText}>{healthSummary(agent)} | {primaryTask(agent)}</Text>
          </Pressable>
        ))}
      </>
    );
  }

  if (drawer.type === "agent") {
    const agent = drawer.item || {};
    const memories = agent.memory || {};
    const memoryText = ["emotional", "long", "short", "rumor"].flatMap(key => Array.isArray(memories[key]) ? memories[key] : [])
      .slice(0, 5).map(item => item.text || String(item)).join("；");
    return (
      <>
        <Info label="身份" value={`${agent.job || "居民"} | ${agent.ageYears || agent.age || "未知年龄"}岁 | ${placeName(agent.position)}`} />
        <Info label="正在做" value={primaryTask(agent)} />
        <Info label="状态" value={healthSummary(agent)} />
        <Info label="长期目标" value={agent.longTermGoal || agent.longTermGoals?.[0]?.title || "暂无"} />
        <Bars title="需求" data={agent.needs || {}} labels={needLabels} />
        <Bars title="情绪" data={agent.emotionVector || agent.emotions || {}} labels={emotionLabels} />
        <Info label="记忆" value={memoryText || agent.memorySummary || "暂无"} />
      </>
    );
  }

  if (drawer.type === "people") {
    return agents.slice(0, 160).map(agent => (
      <Pressable key={agent.id} style={styles.listRow} onPress={() => openAgent(agent)}>
        <Text style={styles.listTitle}>{agent.name} | {agent.job || "居民"}</Text>
        <Text style={styles.listText}>{placeName(agent.position)} | {healthSummary(agent)}</Text>
      </Pressable>
    ));
  }

  if (drawer.type === "places") {
    return places.map(place => (
      <Pressable key={place.id} style={styles.listRow} onPress={() => openPlace(place)}>
        <Text style={styles.listTitle}>{place.name || place.id}</Text>
        <Text style={styles.listText}>{placeAgentCount(place.id)} 人 | {(boxes[place.id]?.localEvents || []).length ? "有事件" : "平静"}</Text>
      </Pressable>
    ));
  }

  if (drawer.type === "events") {
    return events.map((event, index) => (
      <View key={`${event.title || "event"}-${index}`} style={styles.listRow}>
        <Text style={styles.listTitle}>{event.title || "事件"}</Text>
        <Text style={styles.listText}>{event.body || event.summary || event.text || ""}</Text>
      </View>
    ));
  }

  if (drawer.type === "relations") {
    const pairs = Array.isArray(agents[0]?.relationshipDynamics) ? agents[0].relationshipDynamics : [];
    const socialPairs = agents.flatMap(agent => Object.entries(agent.relationshipMatrix || {}).slice(0, 2).map(([targetId, value]) => ({
      from: agent.name,
      to: agents.find(item => item.id === targetId)?.name || targetId,
      value
    }))).slice(0, 60);
    return socialPairs.length ? socialPairs.map((pair, index) => (
      <View key={`${pair.from}-${pair.to}-${index}`} style={styles.listRow}>
        <Text style={styles.listTitle}>{pair.from} - {pair.to}</Text>
        <Text style={styles.listText}>关系强度：{Math.round(Number(pair.value || 0))}</Text>
      </View>
    )) : (
      <Text style={styles.emptyText}>暂无关系数据</Text>
    );
  }

  if (drawer.type === "control") {
    return (
      <>
        <Info label="后台状态" value={`${runtime?.state || "未知"} | ${runtime?.lastMessage || ""}`} />
        <Pressable style={styles.primaryButton} onPress={toggleRuntime}>
          <Text style={styles.primaryButtonText}>{runtime?.state === "running" ? "暂停后台" : "启动后台"}</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={stepOnce}>
          <Text style={styles.secondaryButtonText}>单步推进</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={refresh}>
          <Text style={styles.secondaryButtonText}>刷新数据</Text>
        </Pressable>
      </>
    );
  }

  return <Text style={styles.emptyText}>暂无内容</Text>;
}

function Info({ label, value }) {
  return (
    <View style={styles.info}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{firstText(value, "暂无")}</Text>
    </View>
  );
}

function Bars({ title, data, labels }) {
  const entries = Object.entries(labels).filter(([key]) => data[key] !== undefined);
  return (
    <View style={styles.info}>
      <Text style={styles.infoLabel}>{title}</Text>
      {entries.length ? entries.map(([key, label]) => {
        const value = clamp(data[key], 0, 100);
        return (
          <View key={key} style={styles.barRow}>
            <Text style={styles.barLabel}>{label}</Text>
            <View style={styles.track}><View style={[styles.fill, { width: `${value}%` }]} /></View>
            <Text style={styles.barValue}>{Math.round(value)}</Text>
          </View>
        );
      }) : <Text style={styles.infoValue}>暂无</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.bg
  },
  cityBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: palette.bg
  },
  game: {
    flex: 1
  },
  map: {
    margin: 0,
    overflow: "hidden",
    backgroundColor: "#2f543d"
  },
  sunGlow: {
    position: "absolute",
    left: "34%",
    top: "22%",
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: "rgba(106, 190, 135, 0.2)"
  },
  road: {
    position: "absolute",
    backgroundColor: "rgba(190, 162, 103, 0.78)"
  },
  roadH: {
    left: 0,
    right: 0,
    top: "45%",
    height: 48
  },
  roadV: {
    top: 0,
    bottom: 0,
    left: "46%",
    width: 48
  },
  water: {
    position: "absolute",
    right: -80,
    bottom: -60,
    width: 260,
    height: 230,
    borderRadius: 130,
    backgroundColor: "rgba(50, 144, 177, 0.42)"
  },
  place: {
    position: "absolute",
    width: 72,
    minHeight: 48,
    marginLeft: -36,
    marginTop: -24,
    borderWidth: 1,
    borderColor: "rgba(255, 237, 178, 0.75)",
    borderRadius: 12,
    backgroundColor: "rgba(236, 194, 104, 0.92)",
    padding: 6,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6
  },
  placeBusy: {
    backgroundColor: "rgba(237, 152, 80, 0.94)"
  },
  placeEvent: {
    borderColor: "#fff2a6",
    borderWidth: 2
  },
  placeName: {
    color: "#25170b",
    fontWeight: "900",
    fontSize: 11
  },
  placeCount: {
    color: "#4d3517",
    marginTop: 2,
    fontSize: 10,
    fontWeight: "700"
  },
  eventMark: {
    position: "absolute",
    right: -6,
    top: -6,
    width: 17,
    height: 17,
    borderRadius: 9,
    backgroundColor: palette.red,
    alignItems: "center",
    justifyContent: "center"
  },
  eventMarkText: {
    color: "#fff",
    fontWeight: "900"
  },
  topHud: {
    position: "absolute",
    top: 8,
    right: 10,
    width: 250,
    minHeight: 46,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.panel,
    padding: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  titleBlock: {
    flex: 1,
    minWidth: 0
  },
  townName: {
    color: palette.ink,
    fontWeight: "900",
    fontSize: 14
  },
  hudSub: {
    color: palette.muted,
    marginTop: 2,
    fontSize: 10
  },
  hudActions: {
    flexDirection: "row",
    gap: 6
  },
  roundButton: {
    width: 32,
    height: 32,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)"
  },
  miniMap: {
    position: "absolute",
    top: 8,
    left: 8,
    width: 126,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.panel,
    overflow: "hidden"
  },
  panelHeader: {
    minHeight: 32,
    paddingHorizontal: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(147, 211, 255, 0.18)"
  },
  panelHeaderSmall: {
    marginTop: 10,
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  panelTitle: {
    color: palette.ink,
    fontWeight: "900",
    fontSize: 12
  },
  panelToggle: {
    marginLeft: "auto",
    minHeight: 26,
    paddingHorizontal: 8,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)"
  },
  panelToggleText: {
    color: palette.ink,
    fontSize: 10,
    fontWeight: "900"
  },
  miniMapBody: {
    height: 88,
    backgroundColor: "rgba(56, 94, 60, 0.7)"
  },
  miniDot: {
    position: "absolute",
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: palette.amber
  },
  sidePanel: {
    position: "absolute",
    right: 10,
    top: 62,
    width: 238,
    maxHeight: 250,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.panel,
    padding: 8,
    overflow: "hidden"
  },
  sidePanelExpanded: {
    width: 320,
    maxHeight: 430
  },
  sidePanelPortrait: {
    left: 12,
    right: 12,
    top: undefined,
    bottom: 116,
    width: undefined,
    maxHeight: 200
  },
  eventScroll: {
    maxHeight: 258
  },
  eventRow: {
    padding: 8,
    borderRadius: 11,
    backgroundColor: "rgba(24, 48, 70, 0.82)",
    marginTop: 8
  },
  eventTitle: {
    color: palette.ink,
    fontWeight: "900",
    fontSize: 11
  },
  eventBody: {
    color: palette.muted,
    marginTop: 3,
    fontSize: 10,
    lineHeight: 14
  },
  warningRow: {
    padding: 7,
    borderRadius: 10,
    backgroundColor: "rgba(106, 47, 37, 0.7)",
    marginTop: 7
  },
  warningTitle: {
    color: "#ffe0d8",
    fontWeight: "900"
  },
  runtimeText: {
    color: palette.muted,
    marginTop: 8,
    fontSize: 10
  },
  emptyText: {
    color: palette.muted,
    paddingVertical: 8
  },
  bottomBar: {
    position: "absolute",
    left: "27%",
    right: "27%",
    bottom: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "rgba(8, 18, 29, 0.92)",
    padding: 6
  },
  bottomItems: {
    gap: 6,
    paddingRight: 4
  },
  actionButton: {
    minWidth: 58,
    minHeight: 44,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)"
  },
  actionActive: {
    backgroundColor: palette.amber
  },
  actionText: {
    color: palette.ink,
    fontWeight: "800",
    fontSize: 10,
    marginTop: 2
  },
  actionTextActive: {
    color: palette.dark
  },
  saveTabs: {
    gap: 6,
    marginTop: 8
  },
  saveTab: {
    paddingHorizontal: 10,
    minHeight: 28,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.07)"
  },
  saveTabActive: {
    backgroundColor: "rgba(83, 184, 255, 0.24)"
  },
  saveTabText: {
    color: palette.ink,
    fontSize: 11,
    fontWeight: "800"
  },
  peopleBadge: {
    position: "absolute",
    left: 12,
    bottom: 102,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    minHeight: 30,
    borderRadius: 999,
    backgroundColor: palette.panel,
    borderWidth: 1,
    borderColor: palette.line
  },
  peopleBadgeText: {
    color: palette.ink,
    fontWeight: "900"
  },
  message: {
    position: "absolute",
    top: 84,
    left: 170,
    right: 16,
    color: "#ffe1d7",
    backgroundColor: "rgba(90, 35, 28, 0.82)",
    padding: 8,
    borderRadius: 12
  },
  startWrap: {
    flex: 1,
    justifyContent: "center",
    padding: 18
  },
  startCard: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.panel,
    padding: 18,
    gap: 12
  },
  startTitle: {
    color: palette.ink,
    fontSize: 26,
    fontWeight: "900"
  },
  startText: {
    color: palette.muted,
    lineHeight: 21
  },
  label: {
    color: palette.muted,
    fontWeight: "800"
  },
  input: {
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.line,
    color: palette.ink,
    backgroundColor: "rgba(0,0,0,0.22)",
    paddingHorizontal: 12
  },
  primaryButton: {
    minHeight: 46,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.green
  },
  primaryButtonText: {
    color: palette.dark,
    fontWeight: "900",
    fontSize: 15
  },
  secondaryButton: {
    minHeight: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: palette.line
  },
  secondaryButtonText: {
    color: palette.ink,
    fontWeight: "900"
  },
  messageInline: {
    color: "#ffd8d1"
  },
  saveList: {
    maxHeight: 280
  },
  saveRow: {
    padding: 12,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.08)",
    marginBottom: 8
  },
  saveName: {
    color: palette.ink,
    fontWeight: "900"
  },
  saveMeta: {
    color: palette.muted,
    marginTop: 4
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.25)"
  },
  backdropTap: {
    ...StyleSheet.absoluteFillObject
  },
  drawer: {
    maxHeight: "72%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.panelSolid,
    overflow: "hidden"
  },
  drawerHead: {
    minHeight: 58,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(147, 211, 255, 0.18)"
  },
  drawerTitle: {
    color: palette.ink,
    fontSize: 18,
    fontWeight: "900"
  },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)"
  },
  drawerBody: {
    padding: 12,
    gap: 9
  },
  info: {
    padding: 11,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(147, 211, 255, 0.16)"
  },
  infoLabel: {
    color: palette.muted,
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 6
  },
  infoValue: {
    color: palette.ink,
    lineHeight: 20
  },
  listRow: {
    padding: 12,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(147, 211, 255, 0.16)"
  },
  listTitle: {
    color: palette.ink,
    fontWeight: "900"
  },
  listText: {
    color: palette.muted,
    marginTop: 5,
    lineHeight: 19
  },
  barRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 7
  },
  barLabel: {
    width: 42,
    color: palette.muted,
    fontSize: 12
  },
  track: {
    flex: 1,
    height: 8,
    borderRadius: 99,
    backgroundColor: "rgba(0,0,0,0.4)",
    overflow: "hidden"
  },
  fill: {
    height: "100%",
    borderRadius: 99,
    backgroundColor: palette.amber
  },
  barValue: {
    width: 30,
    color: palette.ink,
    textAlign: "right",
    fontWeight: "800"
  }
});

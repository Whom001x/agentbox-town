# AgentBox Town

**中文** | [English](README.en.md)

更新记录：[CHANGELOG.md](CHANGELOG.md)

AgentBox Town 是一个多 Agent 虚拟小镇模拟器。它把多个 AI 角色放进同一个小镇世界里，每个角色都有位置、日程、关系、记忆、需求、情绪、长期目标、自我模型和行动过程。

当前版本重点不是单纯生成剧情，而是让小镇像一个可持续运转的社会系统：本地规则负责世界约束、知识边界、移动、死亡、存档和越权审查，AI 负责局部判断、角色主观选择和复杂社会事件。

## 当前版本

**V3.3.5 Relationship Memory Formation + V3.3.4 Temporal Causal Graph + V3.3.3.1 Memory Importance Calibration + V3.3.3 Memory Gate + V3.3.2.1 Medical Recovery + V3.3.2 Context Boundary + V3.3.1 Social Feedback**

### V3.3.5 Relationship Memory Formation

新增长期关系记忆形成层。`relationshipMatrix` 仍然保存关系数值，但重要互动现在会通过 `MemoryImportanceGate` 沉淀为 `relationshipMemory`，记录对象、关系类型、信任、熟悉度、情绪标签、互动次数、最后互动时间和来源事件。普通打招呼、闲聊、路过不会进入长期关系记忆；帮助、冲突、共同完成目标、承诺、关系修复和危险事件会形成可追溯的 `relationshipCause`，并影响后续 `contact_familiar`、`ask_help`、`avoid_person`、`cooperate` 等行为倾向。

### V3.3.4 Temporal Causal Graph

新增时序因果图层。世界现在不只保存 `EventLog`，还会在高强度事件后写入 `causalGraph`，记录 `event -> action -> stateChange -> belief/goal/relationship` 的因果链。普通低强度事件不会生成因果边；所有边都保证原因时间早于结果时间；重复出现的相似链路会强化 `patterns`。每日 Reflection 会读取因果链生成 `lessonLearned` 和 `counterfactual`，长期记忆也会保存 `sourceCausalChain` 方便追溯。

### V3.3.3.1 Memory Importance Calibration

升级长期记忆重要性校准层。`MemoryImportanceGate` 现在使用校准后的 `V_event`、`V_emotion`、`V_relation`、`V_goal`，按 `(V + 1e-6)^w * contextFactor * timeFactor` 计算长期写入概率。新增 log scaling / quantile normalization、情绪正负拆分、不同记忆类型时间衰减和相似记忆压缩，避免普通事件、医疗目击和系统残留污染人格记忆。

### V3.3.3 Memory Importance Gate

长期记忆不再由单一高分维度决定。事件强度、情绪变化、关系影响、目标影响必须共同成立，才会进入 belief、habit、preference、episodic 或 relationship。普通日常和旁观陌生人就医只进入 `EventLog`；真正的帮助、冲突、承诺和信任变化才会沉淀进 `relationshipMemory`。

### V3.3.2.1 Medical Settlement & Recovery

修复健康闭环。健康分为 `critical / poor / normal / healthy`，诊所会进行医疗评估、排队、治疗和多日恢复。医生白天值班，夜晚可 on-call；睡眠只提供小幅健康恢复；治疗后有 `afterTreatmentCooldown`，避免角色刚治疗完又被 `seek_care` 吸回诊所。

### Runtime Reliability & Generation Status

新增全局 AI 限速器和指数退避重试，避免多个 Agent 同步触发 provider 限流。主界面增加生成状态显示：红色表示“正在生成”，绿色表示“可以开始”。

### V3.3.2 Context Boundary & Runtime Compression

重点解决大规模小镇运行时的上下文膨胀问题。新增 `ContextBuilder`，把完整世界状态转换成 AgentAction、World Agent、Social Agent、Scheduler 各自需要的轻量视图；默认预算为 `worldAgent=12000`、`socialAgent=10000`、`scheduler=8000`、`agentAction=6000`。完整记忆、向量 embedding、完整 `cognitiveState`、`debugDecision` 和 `relationshipMatrix` 不再进入大模型 prompt。运行时还会生成 `runtime/contextCache.json` 摘要缓存，并让 `judgementBatchSize` 真正控制 Node 后台大请求拆批。

### V3.3.1 Social Feedback & Stability

增加社会反馈稳定层：事件会通过信息传播改变社会场，再由 `SocialFeedback` 调制每个角色的认知状态和行动评分。社会影响不会直接覆盖人格或事实记忆，而是经过 `socialSensitivity` 和 `tanh` 稳定计算后，影响谨慎、好奇、求助、回避和责任倾向。

### V3.3 Social Dynamics

新增社会场和概率信息传播：事件不是必然全员知道，而是通过关系强度、空间距离、信任、情绪强度、信息类型和社会压力扩散。医疗、死亡、灾难等高优先级事件会更强传播，但仍保留延迟、失真和信息不完整。

### V3.2.1 Action Eligibility + V3.2 Cognitive State

V3.2.1 在 Scheduler 前增加行动资格过滤，年龄、身份、地点、关系、职业和紧急程度不符合的行动会直接移除，不进入评分。V3.2 把需求、情绪、记忆、目标、人格和社会反馈融合成 `CognitiveState`，先形成愿望和认知偏置，再由 Utility Scheduler 选择行动。

### V3.1.5 Character Genesis

升级建城阶段：新角色出生时会生成独特的人格基础、`lifeHistorySeed`、认知倾向、行为倾向、出生信念、习惯、偏好、重要经历、自我模型、目标运行态和关系动机。这些字段会写入存档，并从第一天开始参与后续 V3 Cognitive Decision Engine 和 V3.1 Identity Evolution。

### V3.1 Identity Evolution

升级运行时人格成长：角色不会在一次事件后突然变成另一个人，而是每天 0 点根据近期经历慢速更新 belief、habit、preference、selfModel 和 cognitiveProfile。同样的长期经历会逐渐改变角色的风险偏好、社交倾向、耐心、自信和行为惯性。

建城流程现在是：

```text
用户输入
↓
SetupBlueprint
↓
CharacterSeedAgent
↓
SetupAgentBatch
↓
CharacterConsistencyAgent
↓
setupMakeAgent
↓
Vector 初始化
↓
存档
```

V3.1.5 新角色最低结构：

```text
lifeHistorySeed
beliefMemory
habitMemory
preferenceMemory
episodicMemory
selfModel
cognitiveProfile
goalRuntime
agentSchemaVersion: "3.1.5"
```

这些是出生人格来源，不是剧情生成。普通吃饭、睡觉、通勤、上班、上课不会作为人格记忆写入。

### V3.0 Cognitive Decision Engine

运行时决策仍然保持：

角色行动不再是“需求低了就执行某个动作”。现在流程是：

```text
角色状态
↓
CognitiveState 认知状态
↓
候选行动
↓
行动向量匹配
↓
混合 Utility 评分
↓
Softmax 概率选择
↓
AgentAction 主观表达
↓
WorldGuard / StateSettlement 落地结算
↓
EventLog / MemoryGate / MemoryConsolidator
↓
DailyReflection / IdentityEvolution
↓
人格和记忆慢更新
```

## 核心能力

- 支持 100+ 角色的小镇模拟。
- V3.3.4 时序因果图：高强度事件会形成 `causalGraph`，Reflection 和长期记忆可追溯事件为什么产生影响。
- V3.3.3.1 记忆重要性校准：使用分布归一化、情绪正负、时间衰减和相似记忆压缩，让长期记忆分布更稳定。
- V3.3.3 乘法 MemoryGate：事件强度、情绪、关系、目标和上下文共同决定是否进入长期人格记忆。
- V3.3.2.1 医疗恢复闭环：诊所容量、医生值班、治疗队列、恢复时间线和治疗后冷却共同处理健康问题。
- V3.3.2 上下文边界：World/Social/Scheduler/AgentAction 使用专用轻量视图，避免把完整 Agent、完整记忆、向量 embedding 和调试字段送入 prompt。
- V3.3.1 社会反馈稳定：社会场通过 `SocialFeedback` 调制角色认知和行动评分，同时用 `socialSensitivity` 保持人格连续性。
- V3.3 社会动态：信息按关系、空间、信任和情绪强度概率传播，形成恐惧、好奇、流言、信任和社会张力。
- V3.2.1 行动资格过滤：年龄、身份、职业、地点、关系和紧急程度会先过滤无效行动。
- V3.2 认知状态场：`CognitiveState` 把需求、情绪、记忆、目标和人格变成当前心理驱动力。
- 每个角色拥有多维需求、多维情绪、关系、长期目标、人格核心、自我模型和行为权重。
- V3.1.5 角色创建：新居民出生时就有 `lifeHistorySeed`、`beliefMemory`、`habitMemory`、`preferenceMemory`、`episodicMemory`、`selfModel` 和 `goalRuntime`。
- V3.1 人格长期演化：经历会缓慢形成信念、习惯、偏好、自我认知和认知权重漂移。
- V3.0 认知决策：`needs` 只影响注意力、耐心、风险偏好、社交倾向和目标坚持度，不直接映射为行动。
- 支持 `Structured Memory`、`Vector Memory`、`MemoryGate`、每日反思和人格慢更新。
- 支持本地向量模型：例如 LM Studio 的 `http://127.0.0.1:12346/v1` + `text-embedding-bge-m3@q8_0`。
- 支持全局 AI 限速、指数退避、随机抖动、Key 冷却和主界面生成状态提示。
- 支持地点制度、地点事件链、地点运行状态、天气、日期、每日计划。
- 支持事件传播、关系惯性、社交流程、承诺债务、家庭同步和职业服务。
- 支持多 Key 分流、分批并发、失败重试、每个 Agent / 模块 / 角色独立模型配置。
- 支持 `contextBudget` 和 `judgementBatchSize` 控制运行时 prompt 大小与大请求拆批。
- 支持文件夹式存档：每个存档一个文件夹，角色、记忆、判断文件分开保存。
- 支持 PC 浏览器主界面、只读监控界面和 Expo 手机 App。

## V3.0 决策模型

### CognitiveState

新增模块：

```text
ai-town-cognitive-state.js
```

输入：

```text
needs
emotionVector
emotionCause
selfModel
goalRuntime
structuredMemory
relationshipMatrix
context
```

输出：

```json
{
  "perceptionWeights": {},
  "driveVector": {},
  "biasVector": {},
  "actionModifiers": {}
}
```

例子：饥饿不会直接触发吃饭，而是改变：

```json
{
  "patience": -0.3,
  "foodAttention": 0.7,
  "irritability": 0.2,
  "socialSeeking": 0.1
}
```

### 角色决策权重

每个角色会拥有：

```json
{
  "decisionWeights": {
    "memory": 0.7,
    "persona": 0.8,
    "emotion": 0.5,
    "novelty": 0.3,
    "goal": 0.9,
    "social": 0.4
  }
}
```

这些权重不是提示词装饰，而是直接参与计算。同样的环境下，侦探、老人、孩子、艺术家、店主会因为权重不同产生不同选择。

### 行动向量匹配

每个候选行动都有 `actionVector`：

```json
{
  "comfort": 0.8,
  "duty": 0.2,
  "social": 0.5,
  "risk": 0.3,
  "novelty": 0.1
}
```

角色当前也有 `driveVector`。系统用向量匹配判断行动是否符合角色此刻的心理驱动力。

### 混合评分

V3.0 使用两组评分：

```text
A = memory + persona + emotion + goal + novelty + social
B = safety * cost * distance * time * locationRule * availability

Score = A * B + Noise
```

`B` 是现实限制，不能被人格和记忆完全抵消。例如风险太高、地点规则不允许、时间不够、行动不可用，都会压低最终分数。

### Softmax 概率选择

系统不会永远选择最高分，而是使用 Softmax。角色人格会影响温度：

```text
谨慎角色：temperature 更低，选择更稳定
冲动角色：temperature 更高，选择更随机
```

## 记忆系统

事件和记忆已经分离：

```text
EventLog
↓
MemoryGate
↓
MemoryConsolidator
↓
Structured Memory / Vector Memory
```

规则：

- 普通吃饭、睡觉、通勤、上班、上课只进入 EventLog。
- 重复形成稳定模式后才沉淀为 habit。
- 异常事件会变成 experience / episodic。
- 高影响事件会形成 belief。
- 关系事件会生成 relationshipMemory。
- Vector Memory 只用于联想相似经历，不能作为事实来源，不能直接改变世界。

## V3.1 人格演化

新增模块：

```text
ai-town-identity-evolution.js
```

每日 0 点运行：

```text
EventLog / Structured Memory / EmotionCause / GoalRuntime / Relationship
↓
IdentityEvolution
↓
beliefMemory / habitMemory / preferenceMemory
↓
selfModel / cognitiveProfile / behaviorTendency
↓
下一轮 CognitiveState 和 Utility Scheduler
```

规则：

- 普通吃饭、睡觉、通勤、上班、上课不会直接改人格。
- 连续失败会轻微增加谨慎和风险回避。
- 连续成功会轻微增加自信、耐心和目标坚持。
- 长期被帮助会提高求助倾向、信任和关系偏好。
- 长期孤独会改变社交倾向。
- 变化由 learningRate 控制：儿童变化最快，老人变化最慢。
- 每次变化会写入 `identityChangeLog`，便于查看“为什么这个人变了”。

## 运行方式

Windows 推荐直接运行：

```bat
start-ai-town-v2.cmd
```

然后打开：

```text
http://localhost:8788/
```

手动启动：

```bash
npm start
```

局域网访问：

- 服务默认监听 `0.0.0.0`。
- 手机或其他电脑连接同一 Wi-Fi 后，打开 `http://本机IP:8788/`。
- 如果无法访问，通常需要允许 Windows 防火墙放行 Node.js 或 TCP `8788`。

## AI 配置

首次打开会进入管理和设置界面。

云端 AI：

```text
Base URL: https://api.openai.com/v1 或其他兼容接口
Model: 模型名
API Key: 你的 Key
```

本地 AI：

```text
Ollama: http://localhost:11434/v1
LM Studio: http://localhost:1234/v1
vLLM / llama.cpp server: 对应 OpenAI 兼容 /v1 地址
```

本地向量模型示例：

```text
Vector Base URL: http://127.0.0.1:12346/v1
Vector Model: text-embedding-bge-m3@q8_0
```

本地配置会写入 `ai-town-config.json`，该文件已被 Git 忽略，不会上传。

## 主要界面

- 存档管理：创建、读取、删除存档。
- 小镇地图：显示地点和角色位置，点击地点查看详情。
- 角色面板：查看需求、情绪、关系、记忆、目标、当前行动和事件队列。
- 设置面板：配置 AI 地址、模型、Key 池、并发和各 Agent 模型。
- 调用日志：查看每次模型调用、Key、耗时、成功、失败和重试。
- 每回合流程：查看当前 Tick 的 Agent 调用链和并发情况。
- 关系蛛网：查看家庭、熟人、同事、同学和社会关系。
- 手机 App：横屏游戏 HUD 风格的小镇监控和交互界面。

## 后台运行流程

当前计算核心在 Node 后台运行，浏览器主要负责显示和控制。

每轮大致流程：

1. 读取存档。
2. StateMigration 补齐 selfModel、goalRuntime、emotionCause、memory layers。
3. LifeEngine 处理确定性生活动作。
4. CandidateBuilder 筛选需要思考的角色。
5. MemoryRecall 召回 structuredMemory + vectorMemory。
6. PersonalityRuntime 生成当前人格状态。
7. CognitiveState 生成认知状态和驱动力。
8. UtilityScheduler 做行动向量匹配、混合评分和 Softmax 选择。
9. AgentAction 生成角色主观行动。
10. WorldGuard / WorldMaster 审查行动是否能在当前世界成立。
11. StateSettlement 结算位置、需求、情绪、关系和地点影响。
12. EventLog 记录事实事件。
13. MemoryGate 判断是否进入长期记忆。
14. MemoryConsolidator 生成结构化记忆和向量记忆。
15. 保存到存档文件夹。

每日 0 点还会运行社会落点、地点制度、每日计划、自我叙事、人格一致性和记忆反思。

## 关键文件

- `ai-town-v2-server.js`：Node 服务端、运行控制器和 AI 代理。
- `ai-town-cognitive-state.js`：V3.0 认知状态、行动向量和现实限制。
- `ai-town-utility-scheduler.js`：V3.0 行动评分与 Softmax 选择。
- `ai-town-memory-stream.js`：EventLog、MemoryGate、MemoryConsolidator、反思和检索。
- `ai-town-personality-runtime.js`：人格运行态。
- `ai-town-life-engine.js`：确定性生活动作和计划执行。
- `ai-town-node-core.js`：时间、生理、移动、死亡等本地推进。
- `ai-town-world-master.js` / `ai-town-world-guard.js`：行动落地审查。
- `ai-town-v2.html`：PC 浏览器主界面。
- `mobile-app/`：Expo 手机 App。
- `scripts/`：本地检查脚本。

## 检查命令

```bash
npm run check:cognitive-decision
npm run check:cognitive-loop
npm run check:memory-gate
npm run check:personality-runtime
npm run check:personality-loop
npm run check:utility-scheduler
npm run check:life
npm run check:life-engine
npm run check:all
```

## 不会上传的本地文件

这些文件已被 Git 忽略：

- `ai-town-config.json`
- `.env`
- `saves/`
- `certs/`
- `node_modules/`
- `mobile-app/android/`
- `mobile-app/.gradle-local/`

## 说明

这是本地 Demo 和研究原型，不是生产级系统。AI 输出会被本地审查器约束，但模拟质量仍取决于模型能力、提示词质量、接口稳定性和存档规模。

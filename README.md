# AgentBox Town

**中文** | [English](README.en.md)

更新记录：[CHANGELOG.md](CHANGELOG.md)

AgentBox Town 是一个多 Agent 虚拟小镇模拟器。它把多个 AI 角色放进同一个小镇世界里，每个角色都有位置、日程、关系、记忆、需求、情绪、长期目标、自我模型和行动过程。

当前版本重点不是单纯生成剧情，而是让小镇像一个可持续运转的社会系统：本地规则负责世界约束、知识边界、移动、死亡、存档和越权审查，AI 负责局部判断、角色主观选择和复杂社会事件。

## 当前版本

**V3.1 Identity Evolution Engine + V3.0.5 Character Genesis + V3.0 Cognitive Decision Engine**

V3.0.5 升级了建城阶段：新角色出生时会生成独特的人格基础、认知倾向、行为倾向、人生经历、初始信念、习惯、偏好、恐惧、目标和关系动机。这些字段会写入存档，并参与后续 V3 Cognitive Decision Engine。

V3.1 升级了运行时人格成长：角色不会在一次事件后突然变成另一个人，而是每天 0 点根据近期经历慢速更新 belief、habit、preference、selfModel 和 cognitiveProfile。同样的长期经历会逐渐改变角色的风险偏好、社交倾向、耐心、自信和行为惯性。

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

V3.0 运行时决策仍然保持：

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
- 每个角色拥有多维需求、多维情绪、关系、长期目标、人格核心、自我模型和行为权重。
- V3.1 人格长期演化：经历会缓慢形成信念、习惯、偏好、自我认知和认知权重漂移。
- V3.0 认知决策：`needs` 只影响注意力、耐心、风险偏好、社交倾向和目标坚持度，不直接映射为行动。
- 支持 `Structured Memory`、`Vector Memory`、`MemoryGate`、每日反思和人格慢更新。
- 支持本地向量模型：例如 LM Studio 的 `http://127.0.0.1:12346/v1` + `text-embedding-bge-m3@q8_0`。
- 支持地点制度、地点事件链、地点运行状态、天气、日期、每日计划。
- 支持事件传播、关系惯性、社交流程、承诺债务、家庭同步和职业服务。
- 支持多 Key 分流、分批并发、失败重试、每个 Agent / 模块 / 角色独立模型配置。
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

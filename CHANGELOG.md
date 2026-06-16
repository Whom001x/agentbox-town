# 更新记录

## 2026-06-16 - V3.3.2 Context Boundary & Runtime Compression Layer

- 新增 `ai-town-context-builder.js`，把完整世界状态转换成 AgentAction、World Agent、Social Agent、Scheduler 各自需要的轻量上下文视图。
- 新增 `contextBudget` 配置：`worldAgent=12000`、`socialAgent=10000`、`scheduler=8000`、`agentAction=6000`，超过预算会自动压缩到摘要或最小状态。
- AgentAction 输入不再包含 raw memory、vector embedding、完整 `cognitiveState`、`debugDecision`、`relationshipMatrix`，只保留主观决策所需摘要。
- World/Social/Scheduler 上下文改为专用边界视图，只给人口摘要、地点摘要、事件摘要、社会场、信息流摘要和必要决策字段。
- 运行时新增 `runtime/contextCache.json` 摘要缓存，每个 tick 更新地点、人口、社会和角色运行摘要。
- `judgementBatchSize` 真正接入 Node 后台大请求拆批，context agents、pre-judgement agents 和 scheduler 都按设置拆分，并共享并发队列。
- 新增 `npm run check:context-boundary`，验证 100/500 角色上下文预算、敏感字段隔离、摘要一致性和 scheduler/agent context 边界。

验证：
- `npm run check:context-boundary`
- `npm run check:all`
- `npm run check:cognitive-state`
- `npm run check:social-field`
- `npm run check:social-feedback`
- `npm run check:utility-scheduler`

## 2026-06-16 - V3.3.1 Social Feedback & Stability Layer

- 新增 `ai-town-social-feedback.js`，把社会场、信息流、地点密度和关系网络转换为每个角色自己的 `agentSocialModifiers`。
- 新增 `SocialModifier`：`fearModifier`、`curiosityModifier`、`trustModifier`、`responsibilityModifier`、`avoidanceModifier`、`socialNeedModifier`、`socialSensitivity`、`sourceEvents`。
- 新增社会稳定层：社会影响使用 `tanh(sum(weight * modifier)) * socialSensitivity` 进行调制，避免一次事件直接破坏人格连续性。
- `CognitiveState` 接收 `regulatedSocialEffect`，社会反馈只作为心理场调制项，不覆盖记忆、目标、情绪或人格。
- `Utility Scheduler` 接入 `socialFeedbackBias`，按 `gamma * socialFeedbackBias` 混入评分 A，再继续走 `Score = A * B`。
- 新增 `socialImpressions`，记录“这个社会给我的感觉”，不写入普通事实记忆，支持指数衰减、同类合并和低强度清理。

验证：
- `npm run check:social-feedback`
- `npm run check:social-field`
- `npm run check:cognitive-state`
- `npm run check:utility-scheduler`
- `npm run check:action-eligibility`
- `npm run check:all`

## 2026-06-16 - V3.3 Social Dynamics Layer

- 新增 `ai-town-social-field.js`，让社会状态成为全局动态变量，而不是单个 Agent 的私有判断。
- 新增 `SocialField`：`fearLevel`、`curiosityLevel`、`rumorDensity`、`trustNetworkStrength`、`socialTension`、`informationPressure`。
- 信息传播升级为概率模型，传播概率综合关系强度、空间接近、信任、情绪强度、信息类型和社会压力。
- 新增 `informationPacket` 字段：`content`、`source`、`confidence`、`distortionLevel`、`emotionalWeight`、`spreadDepth`。
- 医疗、死亡、灾难等高优先级事件会强传播，但仍保留延迟和信息不完整。
- 每轮 tick 输出 `socialField snapshot`、`informationFlow graph`、受影响角色和行为变化数据。

验证：
- `npm run check:social-field`

## 2026-06-16 - V3.2.1 Action Eligibility Layer

- 在 Cognitive Scheduler 前新增行动资格过滤层：`Candidate Actions -> Eligibility Filter -> Cognitive Score -> Softmax Selection`。
- 每个行动增加年龄、身份、地点、关系和紧急状态约束，不符合条件的行动直接移除，不进入评分。
- 新增职业约束和人生阶段约束：医生、店主、儿童、老人、成年人会自然拥有不同可选行动范围和权重倾向。
- 新增 `npm run check:action-eligibility`，随机 1000 次行动选择验证 `invalidActionRate = 0`。

验证：
- `npm run check:action-eligibility`

## 2026-06-16 - V3.2 Cognitive State Field

- 新增 `ai-town-cognitive-state.js`，把需求、情绪、自我模型、目标、结构化记忆、关系和上下文融合成当前认知状态。
- 新增 `CognitiveState`：`selfPressure`、`socialNeed`、`safetyConcern`、`curiosityDrive`、`responsibilityDrive`、`comfortNeed`、`emotionalLoad`、`beliefActivation`。
- 新增 `MemoryActivation`，根据相关度、情绪匹配、目标匹配和近因性激活少量记忆，而不是把全部记忆送入决策。
- 新增 `Desire Generator`，从认知状态生成 `desireCandidates`；愿望不是行动，仍需经过资格过滤、世界约束和结算。
- `AgentAction` 输入增加 `cognitiveState`、`desireCandidates` 和 `activeBeliefs`，LLM 只能基于这些表达主观选择。
- 配置增加 Cognitive Engine 开关和记忆、信念、情绪、目标影响参数。

验证：
- `npm run check:cognitive-state`

## 2026-06-16 - V3.1.5 Character Genesis Upgrade

- 升级角色创建系统，让新角色出生时就具备 V3.1 人格生命模型。
- `CharacterSeedAgent`、`setupAgentBatchAgent`、`setupMakeAgent` 支持 `lifeHistorySeed`、`cognitiveProfile`、`selfModel`、`beliefMemory`、`habitMemory`、`preferenceMemory`、`episodicMemory` 和 `goalRuntime`。
- `setupMakeAgent` 写入 `agentSchemaVersion: "3.1.5"`，并保留出生人格字段到存档。
- 出生记忆与后天记忆使用同一套结构化格式，避免把吃饭、睡觉、通勤、上班、上课直接写成人格记忆。
- 职业和年龄确定性影响认知画像：医生提高照护/健康意识，教师提高耐心，店主提高社交倾向，保安提高风险/安全意识，老人提高规律偏好。
- `setupRelationSketchAgent` 可参考角色年龄、职业、价值观和 `lifeHistorySeed` 生成更合理的家庭、同事、同学、邻里和熟客关系。
- `npm run check:character-genesis` 检查新角色 cognitiveProfile/selfModel/beliefMemory/habitMemory/episodicMemory 100% 存在，并禁止英文模板记忆残留。

验证：
- `npm run check`
- `npm run check:character-genesis`

## 2026-06-16 - V3.1 Identity Evolution Engine

- 新增 `ai-town-identity-evolution.js`，每天 0 点根据近期 EventLog、结构化记忆、情绪原因、目标和关系证据沉淀人格变化。
- 人格变化为慢更新：儿童、青少年、成年人、老人使用不同 learningRate，单次事件不能瞬间重写人格。
- `beliefMemory`、`habitMemory`、`preferenceMemory` 升级为可追踪来源事件、置信度、触发条件和倾向概率的结构。
- `selfModel` 新增 `selfImage`、`competenceBeliefs`、`lifeNarrative`，用于表达长期自我认知变化。
- `cognitiveProfile` 会实际影响 `CognitiveState` 的 riskTolerance、curiosity、socialSeeking、patience、goalPersistence 等偏置。
- 新增 `identityChangeLog`，记录角色为什么发生人格变化、来自哪些事件、旧状态和新状态。

验证：
- `npm run check`
- `npm run check:identity-evolution`
- `npm run check:memory-gate`
- `npm run check:memory-consolidator`
- `npm run check:cognitive-decision`
- `npm run check:personality-runtime`
- `npm run check:personality-loop`
- `npm run check:character-genesis`
- `npm run check:all`

## 2026-06-16 - V3.0.5 Character Genesis Upgrade

- 升级建城阶段的角色出生流程，不改运行时决策公式。
- 新增 `ai-town-character-seed.js`，在创建角色时生成人格基础、认知倾向、行为倾向、人生经历、初始信念、习惯、偏好和恐惧。
- 新增 `CharacterSeedAgent`，AI 可补强角色出生种子；AI 失败时使用本地稳定生成，不阻塞建城。
- 新增 `CharacterConsistencyAgent`，检查年龄、职业、人格、目标和初始记忆是否冲突；AI 审查失败时回落到本地一致性检查。
- `setupMakeAgent` 写入 `cognitiveProfile`、`decisionWeights`、`behaviorTendency`、`lifeHistory`、`initialBeliefs`、`initialHabits`、`preferences`。
- 初始记忆升级为结构化记忆和向量联想摘要，避免把普通吃饭、睡觉、上班、上课当成长记忆。
- 初始关系增加 `relationshipIntent`，表示角色对已有关系的期待和动机。

验证：
- `npm run check`
- `npm run check:character-genesis`
- `npm run check:cognitive-decision`
- `npm run check:personality-runtime`
- `npm run check:all`

## 2026-06-16 - V3.0 Cognitive Decision Engine

- 将角色行为选择升级为状态、认知偏置、行动向量匹配、混合 Utility 评分和 Softmax 概率选择。
- 新增 `CognitiveState`，让需求只改变注意力、耐心、风险偏好、社交倾向和目标坚持度，不直接映射成行动。
- 接入 `Structured Memory`、`Vector Memory`、`SelfModel`、`GoalRuntime` 和 `PersonalityRuntime`。
- 增加 `decisionTrace` 和 `debugDecision`，便于查看角色为什么选择某个行动。

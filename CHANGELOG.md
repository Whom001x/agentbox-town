# 更新记录

## 2026-06-17 - V3.3.5 Relationship Memory Formation

- 新增长期关系记忆形成层，`relationshipMatrix` 继续保存数值关系，`relationshipMemory` 保存会影响未来行为的关系经验。
- 关系记忆结构包含 `targetAgentId`、`relationshipType`、`trust`、`familiarity`、`emotionalTag`、`interactionCount`、`lastInteractionTime`、`sourceEvents` 和 `relationshipCause`。
- 普通互动过滤：打招呼、普通聊天、路过不会进入长期关系记忆。
- 重要互动沉淀：帮助、冲突、共同完成目标、承诺、关系修复、危险/医疗事件会经过 `MemoryImportanceGate` 后写入关系记忆。
- `StateSettlement` 的 `relationImpacts` 现在会转换为可追溯关系事件，再由 `recordLifeEvent()` 和 `MemoryImportanceGate` 统一处理。
- 重复同类关系事件不会无限新增记忆，而是合并强化 `interactionCount`、`sourceEvents` 和 `relationshipCauses`。
- `Utility Scheduler` 增加 `relationshipMemoryBias`，让关系经验影响 `contact_familiar`、`ask_help`、`avoid_person`、`cooperate` 等行为倾向。
- 新增 `npm run check:relationship-memory`，覆盖单次关系事件、重复强化、普通聊天过滤、关系记忆影响行动评分，以及 50 人/100 tick 形成率检查。

验证：
- `npm run check:relationship-memory`
- `npm run check:memory-gate`
- `npm run check:memory-filter`
- `npm run check:utility-scheduler`
- `npm run check:all`

## 2026-06-17 - V3.3.4 Temporal Causal Graph Layer

- 新增 `ai-town-causal-graph.js`，为世界增加 `causalGraph: { nodes, edges, patterns }`。
- 新增因果节点类型：`event`、`stateChange`、`action`、`belief`、`goal`、`relationship`。
- 新增因果边：`{ from, to, relation, strength, confidence, timestamp }`，relation 支持 `caused`、`reinforced`、`weakened`、`triggered`、`prevented`。
- `recordLifeEvent()` 现在会先计算 `causalStrength`，超过阈值才写入因果图，普通低强度事件仍只进入 `EventLog`。
- 因果边强制满足 `cause.timestamp < effect.timestamp`，禁止未来影响过去。
- 相似因果链会写入 `causalGraph.patterns` 并强化同类 edge strength，用于学习重复模式。
- `runDailyReflection()` 增加 `causalAnchors`、`lessonLearned`、`counterfactual`，Reflection 可读取因果链而不是只总结事件。
- 长期记忆条目增加 `sourceCausalChain`，belief / experience 可以追溯到来源因果链。
- 拆文件存档新增 `events/causalGraph.json`，避免保存后丢失因果图。
- 新增 `npm run check:causal-graph` 和 `npm run check:reflection`。

验证：
- `npm run check:causal-graph`
- `npm run check:reflection`
- `npm run check:memory-consolidator`
- `npm run check:all`

## 2026-06-17 - V3.3.3.1 Memory Importance Calibration Layer

- 升级 `MemoryImportanceGate` 数值校准层，不改变已有 Memory Routing 结构。
- importance 公式改为 `Π((V_i + ε)^w_i) * contextFactor * timeFactor`，其中 `ε = 1e-6`，避免严格零值让记忆完全无法形成。
- 新增 `Normalization Pipeline`，每个维度先经过分布归一化再进入乘法模型；默认使用 log scaling，并保留 quantile normalization 支持。
- 情绪维度拆成 `emotionValence`：`positiveImpact`、`negativeImpact`、`intensity`，避免只靠情绪强度判断。
- 新增 `emotionMemoryWeight`：强正面事件更偏 belief/preference，强负面事件更偏 avoidance/safety belief，普通情绪降低长期写入概率。
- 新增 `timeFactor` 和不同记忆类型衰减：episodic 较快、belief 较慢、habit 最慢、relationship 按关系上下文修正。
- 新增相似长期记忆压缩：合并同类记忆并保留 `count`、`firstTime`、`lastTime`、`averageImportance`，避免无限增长。
- 新增 `npm run check:memory-calibration`，运行 10000 事件验证写入率、分布、极端情绪、时间衰减和压缩。

验证：
- `npm run check:memory-importance`
- `npm run check:memory-calibration`
- `npm run check:memory-filter`
- `npm run check:memory-gate`
- `npm run check:memory-consolidator`
- `npm run check:all`

## 2026-06-17 - V3.3.3 Memory Importance Multiplicative Gate

- 将长期记忆写入判断从线性加权升级为四维乘法模型：`V_event`、`V_emotion`、`V_relation`、`V_goal`。
- 新增 `contextFactor`：本人经历、亲密关系、熟人、同地点目击、间接听闻使用不同权重。
- 普通事件、医疗目击、低情绪/低关系/低目标影响事件只进入 `EventLog`，不再轻易污染长期人格记忆。
- 直接帮助、冲突、承诺、信任变化才进入 `relationshipMemory`，旁观陌生人去诊所不会直接形成人格关系记忆。
- 阻断系统/英文残留进入记忆：`Followed plan`、`Because of`、`Daily reflection`、`Received basic care at the clinic`、`JSON Schema`。
- 新增 `npm run check:memory-importance` 和 `npm run check:memory-filter`。

验证：
- `npm run check:memory-importance`
- `npm run check:memory-filter`
- `npm run check:memory-gate`
- `npm run check:memory-consolidator`
- `npm run check:all`

## 2026-06-17 - V3.3.2.1 Medical Settlement & Recovery Loop

- 重做健康闭环：`health` 分为 `critical`、`poor`、`normal`、`healthy`，不再让 `mild/poor` 状态无处理。
- 新增 `MedicalAssessment`，根据健康、年龄、压力、疾病状态和近期事件判断严重度、是否需要治疗和恢复计划。
- 新增 `medicalTreatmentEffect()`：critical 恢复 15-25，poor 恢复 5-15，normal 恢复 1-3，并按年龄修正。
- 新增医生值班机制：白天诊所值班，夜晚有患者时 on-call，避免所有医护同时睡觉导致诊所无人处理。
- 新增 `clinicRuntime`：`medicalCapacity`、`currentPatients`、`staffAvailable`、`treatmentQueue`。
- 新增 `recoveryTimeline`，治疗后按多日逐步恢复，不再依赖一次性瞬间恢复。
- 睡眠增加小幅 `restRecovery`，但不会大量恢复健康。
- 新增 `afterTreatmentCooldown`，治疗后一段时间降低 `seek_care` 权重，避免医疗吸附。
- 新增 `npm run check:medical-loop`，验证 100 tick 后低健康、诊所人口、治疗记录和 `treatedAt`。

验证：
- `npm run check:medical-loop`
- `npm run check:life-engine`
- `npm run check:action-eligibility`
- `npm run check:all`

## 2026-06-17 - Runtime Reliability & Generation Status

- 新增全局 AI 限速器，按 RPM/QPS 排队，避免多个 Agent 同步撞到 provider 限流。
- 重试策略改为指数退避 + 随机抖动，失败后持续重试但不再固定 1000ms 同步冲击。
- 新增配置项：`aiRateLimitRpm`、`aiRetryBaseDelayMs`、`aiRetryMaxDelayMs`、`aiRateLimitCooldownMs`。
- AI metrics 增加 `rateLimitWaits`、`lastRateLimitWaitMs`、`lastRetryDelayMs`。
- 主界面新增生成状态显示：红色表示“正在生成”，绿色表示“可以开始”；runtime tick 失败不再误判为 setup 生成失败。

验证：
- `npm run check:all`

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

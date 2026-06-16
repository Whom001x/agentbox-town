# 更新记录

## 2026-06-16 - V3.1 Identity Evolution Engine

- 新增 `ai-town-identity-evolution.js`，每天 0 点根据近期 EventLog、结构化记忆、情绪原因、目标和关系证据沉淀人格变化。
- 人格变化现在是慢更新：儿童、青少年、成年人、老人使用不同 learningRate；单次事件不能瞬间重写人格。
- `beliefMemory`、`habitMemory`、`preferenceMemory` 升级为可追踪来源事件、置信度、触发条件和倾向概率的结构。
- `selfModel` 新增 `selfImage`、`competenceBeliefs`、`lifeNarrative`，用于表达长期自我认知变化。
- `cognitiveProfile` 现在会实际影响 `CognitiveState` 的 riskTolerance、curiosity、socialSeeking、patience、goalPersistence 等偏置。
- 新增 `identityChangeLog`，记录角色为什么发生人格变化、来自哪些事件、旧状态和新状态。
- 新增检查命令：`npm run check:identity-evolution`。

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
- 新增 `CharacterSeedAgent`：AI 可补强角色出生种子；AI 失败时使用本地稳定生成，不阻塞建城。
- 新增 `CharacterConsistencyAgent`：检查年龄、职业、人格、目标和初始记忆是否冲突；AI 审查失败时回落到本地一致性检查。
- `setupMakeAgent` 现在会把 `cognitiveProfile`、`decisionWeights`、`behaviorTendency`、`lifeHistory`、`initialBeliefs`、`initialHabits`、`preferences` 写入新角色。
- 初始记忆升级为结构化记忆和向量联想摘要，避免把普通吃饭、睡觉、上班、上课当成长期记忆。
- 初始关系增加 `relationshipIntent`，表示角色对已有关系的期待和动机。
- 新增检查命令：`npm run check:character-genesis`。

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

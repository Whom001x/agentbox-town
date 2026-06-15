# AgentBox Town

**中文** | [English](README.en.md)

AgentBox Town 是一个实验性的 AI 虚拟小镇模拟器。它把多个 AI 角色放进同一个小镇世界里，每个角色都有位置、日程、关系、记忆、需求、情绪、行动过程和长期人格状态。

项目目标不是单纯生成剧情，而是让小镇像一个会持续运转的社会系统：AI 负责局部判断，本地规则负责世界约束、知识边界、移动、死亡、存档和越权审查。

## 当前能力

- 支持 100+ 角色的小镇模拟。
- 每个角色拥有记忆、关系、多维情绪、需求、长期目标和人格核心。
- 支持日期、天气、地点制度、地点事件链、地点运行状态和每日计划。
- 支持事件传播、关系惯性、社交流程、承诺债务、家庭同步和职业服务。
- 支持多 Key 分流、分批并发、失败重试和每个 Agent / 角色独立模型配置。
- 支持文件夹式存档：每个存档一个文件夹，角色、记忆、判断文件分开保存。
- 支持本地 AI：Ollama、LM Studio、vLLM、llama.cpp server 等 OpenAI 兼容接口。
- 支持手机端 Expo App 和浏览器监控界面。

## 运行方式

推荐 Windows 下直接运行：

```bat
start-ai-town-v2.cmd
```

然后打开：

```text
http://localhost:8788/
```

局域网访问：

- 服务默认监听 `0.0.0.0`。
- 启动后终端会显示 `LAN: http://本机IP:8788`。
- 手机或其他电脑连接同一 Wi-Fi 后打开该地址。
- 如果打不开，通常需要允许 Windows 防火墙放行 Node.js 或 TCP `8788`。

手动启动：

```bash
npm start
```

## 首次配置

第一次打开后进入设置：

- 云端 AI：填写 API 地址、模型和 API Key。
- 本地 AI：填写 OpenAI 兼容 `/v1` 地址，API Key 可以留空。
- 每 Key 并发、批大小、自动间隔、每步虚拟时间都可以在设置里调整。

常见本地 AI 地址：

- Ollama：`http://localhost:11434/v1`
- LM Studio：`http://localhost:1234/v1`
- vLLM / llama.cpp server：填写对应的 OpenAI 兼容 `/v1` 地址

本地配置会写入 `ai-town-config.json`，该文件已被 Git 忽略，不会上传。

## 主界面

- 存档管理：创建、读取、删除存档。
- 小镇地图：显示地点和角色位置，点击地点后查看详情。
- 角色面板：查看需求、情绪、关系、记忆、目标、当前行动和事件队列。
- 设置面板：配置 AI 地址、模型、Key 池、并发和各 Agent 模型。
- 调用日志：查看每次模型调用、Key、耗时、成功、失败和重试。
- 每回合流程：查看当前 Tick 的 Agent 调用链和并发情况。
- 关系蛛网：查看角色之间的家庭、熟人、同事、同学和社会关系。

## 后台模拟流程

当前计算核心已经迁到 Node 后台。浏览器负责显示和控制，真正的模拟推进由服务端完成。

每轮大致流程：

1. 读取存档和运行状态。
2. Life Engine 先处理简单本地生活动作，例如吃饭、睡觉、移动、休息。
3. 调度候选角色，运行地点、过程、职业服务、社会模式等上下文 Agent。
4. 运行需求意图、场景规则、危机分诊、知识边界、后果判断。
5. Scheduler 选择本轮行动角色。
6. AgentAction 生成角色行动。
7. TimePassage 判断行动耗时、剩余时间和跨回合过程。
8. WorldMaster 与 WorldGuard 审查行动是否能在当前世界成立。
9. StateSettlement 结算需求、情绪、记忆、关系和地点影响。
10. 事件影响、信息传播、关系惯性、社交流程等后置 Agent 更新世界。
11. Node Core 推进虚拟时间、睡眠、生理衰退、基础救治、移动到达和死亡检查。
12. 保存到存档文件夹。

每日 0 点还会运行社会落点、地点制度、每日计划、自我叙事、人格一致性和记忆反思。

## 关键文件

- `ai-town-v2-server.js`：Node 服务端、运行控制器和 AI 代理。
- `ai-town-node-core.js`：本地时间、生理、移动、死亡等核心推进。
- `ai-town-life-engine.js`：简单生活行为和计划执行。
- `ai-town-interruptions.js`：危机打断和低状态倾向判断。
- `ai-town-memory-stream.js`：记忆写入、检索和每日反思。
- `ai-town-world-master.js` / `ai-town-world-guard.js`：行动落地审查。
- `ai-town-v2.html`：PC 浏览器主界面。
- `ai-town-monitor.html`：只读监控界面。
- `mobile-app/`：Expo 手机 App。
- `scripts/`：本地检查脚本。

## 本地文件

这些文件不会上传到 GitHub：

- `ai-town-config.json`
- `.env`
- `saves/`
- `certs/`
- `node_modules/`
- `mobile-app/android/`
- `mobile-app/.gradle-local/`

## 检查

```bash
npm run check:all
npm run check:life
npm run check:life-engine
npm run check:memory
```

## 说明

这是本地 Demo 和研究原型，不是生产级系统。AI 输出会被本地审查器约束，但模拟质量仍取决于模型能力、提示词质量和接口稳定性。

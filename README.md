# AgentBox Town

**中文** | [English](README.en.md)

AgentBox Town 是一个实验性的 AI 虚拟小镇模拟器。每个角色都生活在独立的 AgentBox 里，拥有自己的位置、日程、关系、记忆、需求、情绪、事件队列、行动过程和长期人格状态。

这个项目关注“像真实小镇一样运行”的多智能体模拟，而不是单纯生成剧情。AI 模块负责局部判断，本地规则负责强约束：世界状态、知识边界、移动、死亡、存档和越权审查都由本地系统兜底。

## 功能

- 支持 100+ 角色的小镇模拟
- 每个角色拥有记忆、关系、多维情绪、需求、人格核心和长期目标
- 支持日期、天气、地点制度、地点链和地点运行状态
- 支持事件传播、关系惯性、社交流程、承诺债务和家庭同步
- 支持多 Key 分流、分批并发和每个 Agent/模块单独设置模型
- 存档以文件夹保存，包含角色文件和 AG 判断文件
- WorldGuard 本地审查，限制隐藏 NPC、全知信息、瞬移、越权死亡和不可能行动

## 项目主界面

主界面不是单纯聊天窗口，而是一个可运行的小镇控制台：

- 顶部操作区：启动、暂停、重置、保存、打开设置和查看每回合流程。
- 存档管理：首次打开进入管理界面，可以创建、读取、删除存档；每个存档写入独立文件夹。
- 小镇地图：显示地点和角色位置；地点详情、头像和天气信息默认收起，点击后展开，避免 100 人小镇界面拥挤。
- 角色面板：查看角色位置、生命状态、年龄、职业、需求、多维情绪、关系、记忆、长期目标、当前过程和事件队列。
- 设置面板：配置 AI 地址、模型、Key 池、每 Key 并发、分批大小、每轮虚拟时间、自动间隔，以及每个 Agent/角色的模型。
- 状态栏和调用日志：实时显示模型、Key、Agent、耗时、成功/失败、重试等待和取消状态。
- 每回合流程图：可在界面内展开/关闭，用来检查这一轮哪些 Agent 串行、哪些 Agent 并行。

## 每回合调用图表

GitHub 会直接渲染下面的 Mermaid 图表。为了避免 GitHub 的 Mermaid 布局器报错，调用图被拆成几个小图。

主循环：

```mermaid
flowchart TD
  A[回合开始] --> B[快照锁]
  B --> C[天气 Agent]
  C --> D[地点事件和地点每日]
  D --> E[地点链 Agent]
  E --> F[地点运行和社会模式]
  F --> G[过程管理和职业服务]
  G --> H[行动前判断 Agents]
  H --> I[调度器]
  I --> J[角色行动 Agent]
  J --> K[时间流逝 Agent]
  K --> L[状态提交 Agent]
  L --> M[WorldGuard 和 Reducer]
  M --> N[事件影响链]
  N --> O[后置 Agents]
  O --> P[本地时间推进]
  P --> Q[睡眠和基础生理]
  Q --> R[生理调制 Agent]
  R --> S[移动和地点影响]
  S --> T[需求和情绪联动]
  T --> U[死亡检查]
  U --> V[家庭同步]
  V --> W{进入新一天}
  W -->|否| X[自动存档]
  W -->|是| Y[每日结算]
  Y --> X
```

并发与重试：

```mermaid
flowchart LR
  A[大任务] --> B[拆成多个 Agent 单位]
  B --> C[按 Key 池和并发上限运行]
  C --> D{本轮结果}
  D -->|成功| E[进入下一阶段]
  D -->|失败| F[等待同批其他任务完成]
  F --> G[1000ms 后只重试失败单位]
  G --> C
  H[手动停止] --> I[取消当前重试队列]
```

行动前判断：

```mermaid
flowchart LR
  A[需求意图] --> F[调度器]
  B[场景规则] --> F
  C[危机分诊] --> F
  D[知识边界] --> F
  E[后果判断] --> F
  F --> G[行动队列]
```

事件和行动后处理：

```mermaid
flowchart TD
  A[WorldGuard 通过的结果] --> B[事件影响 Agent]
  B --> C[信息传播 Agent 分批并发]
  C --> D[关系惯性 Agent 分批并发]
  D --> E[社交流程 Agent 分批并发]
  E --> F[多维状态 Agent]
  E --> G[承诺债务 Agent]
  E --> H[叙事 Reporter]
  F --> I[状态落地]
  G --> I
  H --> I
```

0 点日结：

```mermaid
flowchart TD
  A[每日结构结算] --> B[社会落点 Agent]
  A --> C[地点制度 Agent]
  B --> D[地点每日 Agent]
  C --> D
  D --> E[地点链 Agent]
  E --> F[每日计划 Agent]
  F --> G[自我叙事 Agent]
  G --> H[人格一致性 Agent]
  H --> I[每日记忆衰退]
  I --> J[自动存档]
```

## 运行

环境要求：

- 推荐 Windows，用 `start-ai-town-v2.cmd` 启动
- Node.js 18 或更高版本
- 不需要安装 npm 依赖

```bat
start-ai-town-v2.cmd
```

然后打开：

```text
http://localhost:8788/
```

同局域网设备访问：

- 启动脚本默认监听 `0.0.0.0`，服务端启动时会打印 `LAN: http://本机IP:8788`
- 手机或另一台电脑连接同一个 Wi-Fi 后，打开这个 LAN 地址
- 如果打不开，通常是 Windows 防火墙拦截，需要允许 Node.js 访问专用网络，或放行 TCP `8788` 端口

首次打开后，在应用设置里填写 AI 地址、模型和 API Key。

也可以接入本地 AI，只要服务兼容 OpenAI `/v1/chat/completions`：

- Ollama：API 地址填 `http://localhost:11434/v1`，模型填本机已安装模型，例如 `qwen2.5:7b`
- LM Studio：API 地址通常填 `http://localhost:1234/v1`，模型填 LM Studio 当前加载模型名
- vLLM / llama.cpp server：填对应的 OpenAI 兼容 `/v1` 地址和模型名

本地 `localhost`、局域网地址和 `.local` 地址可以不填 API Key。系统会把本地 AI 当作 1 个可并发的虚拟 Key 池，仍然受“每 Key 并发上限”控制。

也可以手动启动：

```bash
npm start
```

## 配置

项目支持两种配置方式。

应用内配置：

- 打开 `http://localhost:8788/`
- 进入设置
- 填写 AI 地址、模型、API Key、并发数、回合间隔和分批大小
- 使用 Ollama / LM Studio 这类本地 AI 时，API Key 可以留空
- 服务端会写入本地 `ai-town-config.json`

环境变量配置：

- `.env.example` 只是参考文件，服务端不会自动读取 `.env`
- 如需用环境变量，手动运行 `npm start` 或 `node ai-town-v2-server.js`
- `start-ai-town-v2.cmd` 会故意清空继承的 AI 环境变量，让新仓库首次打开进入配置模式

重要本地文件：

- `ai-town-config.json`：本地 AI 设置，已被 Git 忽略
- `saves/`：项目当前目录下的本地存档文件夹，已被 Git 忽略
- `.env` 和 `.env.local`：可选私有环境文件，已被 Git 忽略

存档路径固定为 `ai-town-v2-server.js` 所在目录下的 `saves/`。例如在仓库根目录运行时，存档会写入 `./saves/`。

主要环境变量：

| 名称 | 用途 | 默认值 |
| --- | --- | --- |
| `AI_TOWN_V2_PORT` | 本地服务端口 | `8788` |
| `AI_TOWN_V2_HOST` | 监听地址；`0.0.0.0` 允许局域网访问 | `0.0.0.0` |
| `AI_TOWN_API_KEYS` | AI Key 列表，可用逗号、分号或换行分隔；本地 AI 可为空 | 空 |
| `AI_TOWN_BASE_URL` | OpenAI 兼容接口地址 | `https://api.openai.com/v1` |
| `AI_TOWN_MODEL` | 默认模型 | `gpt-4.1-mini` |
| `AI_TOWN_MAX_CONCURRENT_PER_KEY` | 每个 Key 的并发上限 | `20` |
| `AI_TOWN_TIMEOUT_MS` | 上游请求超时时间 | `180000` |
| `AI_TOWN_MAX_REQUEST_BODY_BYTES` | 本地接口请求体上限 | `10000000` |
| `AI_TOWN_RETRY_DELAY_MS` | 临时上游错误重试等待 | `1000` |

不要提交真实 API Key。

## 主要文件

- `ai-town-v2.html`：前端界面和模拟循环
- `ai-town-v2-server.js`：本地 Node.js 服务端和 AI 代理
- `start-ai-town-v2.cmd`：Windows 启动脚本
- `package.json`：Node.js 脚本和版本要求
- `.env.example`：环境变量参考
- `ai-town-config.example.json`：本地配置参考
- `AI虚拟小镇V2项目说明.md`：项目设计说明

## 说明

这是本地 Demo 和研究原型，不是生产级系统。AI 输出会受到提示词和本地审查约束，但模拟质量仍依赖模型能力和接口稳定性。

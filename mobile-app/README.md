# 小镇观察器 Mobile App

这是 AgentBox Town 的独立手机 App，不是 `/mobile` 网页。

## 启动

先启动 PC 后端：

```bash
cd ..
npm start
```

然后启动手机 App：

```bash
cd mobile-app
npm install
npm start
```

手机和电脑需要在同一局域网。App 内填写电脑后端地址，例如：

```text
http://192.168.10.30:8788
```

## 当前功能

- 连接现有 Node 后端
- 读取存档列表
- 读取小镇世界状态
- 游戏 HUD 主界面
- 地点地图
- 小镇事件面板
- 地点详情
- 角色详情
- 启动后台
- 暂停后台
- 单步推进
- 手动刷新

## 职责划分

PC 管理台负责建档、AI 配置、调试和完整日志。

手机 App 负责观察、浏览和基础运行控制。

# AI 圆桌 (AI Roundtable)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Status: Experimental](https://img.shields.io/badge/Status-Experimental-orange.svg)](#-experimental-prototype--实验性原型)

> 让多个 AI 助手围桌讨论，交叉评价，深度协作

一个 Chrome 扩展，让你像"会议主持人"一样，同时操控多个 AI（Claude、ChatGPT、Gemini、豆包、千问），实现真正的 AI 圆桌会议。

<!-- TODO: 添加 GIF 演示 -->
<!-- ![Demo GIF](assets/demo.gif) -->

---

## 🔬 Experimental Prototype / 实验性原型

**EN**

This is an **experimental prototype** built to validate a working method:

> **Ask the same question to multiple models, let them debate each other, and use the friction to expose blind spots and expand thinking.**

It is **not** a production-ready tool, nor an attempt to compete with AI aggregators or workflow platforms.
Think of it as a *runnable experiment* rather than a polished product.

**中文**

这是一个**实验性原型**，用于验证一种工作方式：

> **同一个问题，让多个模型同时回答并互相辩论，用分歧与冲突逼出漏洞、拓展思路。**

它**不是**一个生产级工具，也不是为了和任何 AI 聚合器或工作流产品竞争。
你可以把它理解为：**一份可以直接运行的实验记录**。

---

## 🎯 Non-goals / 刻意不做的事

**EN**

* No guarantee of long-term compatibility (AI web UIs change frequently)
* No promise of ongoing maintenance or rapid fixes
* No cloud backend, accounts, or data persistence
* No complex workflow orchestration, exports, or template libraries
* Not trying to support every model or platform

The focus is validating the **roundtable workflow**, not building software for its own sake.

**中文**

* 不承诺长期兼容（AI 网页端结构随时可能变化）
* 不保证持续维护或快速修复
* 不做云端账号、数据存储或同步
* 不做复杂的工作流编排、导出或模板库
* 不追求覆盖所有模型或平台

重点在于**验证"圆桌式思考流程"是否有价值**，而不是把软件本身做大做全。

---

## ❓ Why this does NOT use APIs / 为什么不用 API

**EN**

This project intentionally operates on the **web UIs** (Claude / ChatGPT / Gemini / Doubao) instead of APIs.

In practice, **API and web chat often behave differently** — commonly due to model variants, hidden system settings, sampling parameters, or UI-specific features.

I'm currently most satisfied with, and calibrated to, the **web chat experience**, so this experiment stays on the web to validate the workflow under real conditions I actually use.

**中文**

这个项目刻意选择直接操作 **Claude / ChatGPT / Gemini / 豆包 的网页端**，而不是使用 API。

在实际使用中，**API 和 Web 端的表现往往并不一致**，常见原因包括：模型版本差异、隐藏的系统设置、采样参数，以及网页端特有的交互能力。

目前我对 **Web 端 Chat 的体验最熟悉、也最满意**，因此这次实验选择留在 Web 端，验证的是我真实使用场景下的思考流程，而不是 API 能力。

---

## 核心特性

- **统一控制台** - 通过 Chrome 侧边栏同时管理多个 AI
- **多目标发送** - 一条消息同时发给多个 AI，对比回答
- **文件上传** - 同时向多个 AI 发送图片或文档附件
- **互评模式** - 让所有 AI 互相评价，对等参与（/mutual 命令）
- **交叉引用** - 让 Claude 评价 ChatGPT 的回答，或反过来
- **讨论模式** - 2~3 个 AI 就同一主题进行多轮深度讨论，可从 Claude / ChatGPT / Gemini / 豆包 / 千问中选择参与者
- **无需 API** - 直接操作网页界面，使用你现有的 AI 订阅

---

## 🧭 推荐使用流程 / Recommended Workflow

**中文**

1. **普通模式**：同题多答，制造分歧
2. **/mutual**：互相挑刺，逼出前提
3. **@ 审计**：由你决定谁审谁
4. **/cross**：两方围攻一方，压力测试
5. **讨论模式**：只在需要时进行多轮辩论

**EN**

1. **Normal** — Ask the same question to multiple models (create divergence)
2. **/mutual** — Let models critique each other (expose assumptions)
3. **@ audit** — You decide who audits whom
4. **/cross** — Two models pressure-test one conclusion
5. **Discussion** — Run multi-round debates only when needed

---

## 🚀 快速开始 / Quick Start

### 安装

1. 下载或克隆本仓库
2. 打开 Chrome，进入 `chrome://extensions/`
3. 开启右上角「开发者模式」
4. 点击「加载已解压的扩展程序」
5. 选择本项目文件夹

### 首次使用提示：请刷新页面

打开侧边栏并选中目标 AI 后，**建议把每个 AI 的网页刷新一次**。
这样可以确保插件正确获取页面内容并稳定绑定（尤其是这些标签页已经打开了一段时间的情况下）。

> **First-run tip:** After opening the sidebar and selecting target AIs, **refresh each AI page once** to ensure reliable detection.

### 准备工作

1. 打开 Chrome，登录以下 AI 平台（根据需要）：
   - [Claude](https://claude.ai)
   - [ChatGPT](https://chatgpt.com)
   - [Gemini](https://gemini.google.com)
   - [豆包](https://www.doubao.com/chat/)
   - [千问](https://www.qianwen.com/?ch=tongyi_redirect)
   - [Kimi](https://www.kimi.com/?chat_enter_method=new_chat)

2. 推荐使用 Chrome 的 Split Tab 功能，将 2 个 AI 页面并排显示

3. 点击扩展图标，打开侧边栏控制台

---

## 使用方法

### 普通模式

**基本发送**
1. 勾选要发送的目标 AI（Claude / ChatGPT / Gemini / 豆包 / 千问 / Kimi）
2. 输入消息
3. 按 Enter 或点击「发送」按钮

**@ 提及语法**
- 点击 @ 按钮快速插入 AI 名称
- 或手动输入：`@Claude 你怎么看这个问题？`

**互评（推荐）**

基于当前已有的回复，让所有选中的 AI 互相评价：
```
/mutual
/mutual 重点分析优缺点
```

用法：
1. 先发送一个问题给多个 AI，等待它们各自回复
2. 点击 `/mutual` 按钮或输入 `/mutual`
3. 每个 AI 都会收到其他 AI 的回复并进行评价
   - 2 AI：A 评价 B，B 评价 A
   - 3 AI：A 评价 BC，B 评价 AC，C 评价 AB

**交叉引用（单向）**

两个 AI（自动检测）：
```
@Claude 评价一下 @ChatGPT
```
最后 @ 的是来源（被评价），前面的是目标（评价者）

三个 AI（使用 /cross 命令）：
```
/cross @Claude @Gemini <- @ChatGPT 评价一下
/cross @ChatGPT <- @Claude @Gemini 对比一下
```

**动作下拉菜单**：快速插入预设动作词（评价/借鉴/批评/补充/对比）

### 讨论模式

让 2~3 个 AI 就同一主题进行深度讨论（Claude / ChatGPT / Gemini / 豆包 / 千问 / Kimi 中任意 2~3 个）：

1. 点击顶部「讨论」切换到讨论模式
2. 选择 2~3 个参与讨论的 AI
3. 输入讨论主题
4. 点击「开始讨论」

**讨论流程**

```
第 1 轮: 各方阐述观点
第 2 轮: 互相评价其他参与者的观点
第 3 轮: 回应评价，深化讨论
...
总结: 各方生成讨论总结
```

---

## 技术架构

```
ai-roundtable/
├── manifest.json           # Chrome 扩展配置 (Manifest V3)
├── background.js           # Service Worker 消息中转
├── sidepanel/
│   ├── panel.html         # 侧边栏 UI
│   ├── panel.css          # 样式
│   └── panel.js           # 控制逻辑
├── content/
│   ├── claude.js          # Claude 页面注入脚本
│   ├── chatgpt.js         # ChatGPT 页面注入脚本
│   ├── gemini.js          # Gemini 页面注入脚本
│   ├── doubao.js          # 豆包页面注入脚本
│   ├── qianwen.js         # 千问页面注入脚本
│   └── kimi.js            # Kimi 页面注入脚本
└── icons/                  # 扩展图标
```

## 设计记录 / Design Notes

- [Long Text Display Design](docs/superpowers/specs/2026-04-02-long-text-display-design.md) - 统一侧边栏长文本展示协议
- [Long Text Display Implementation Plan](docs/superpowers/plans/2026-04-02-long-text-display.md) - 长文本展示改造的实现计划
- [Discussion Responsive Spec](docs/superpowers/specs/2026-04-03-discussion-responsive-spec.md) - discussion 模式“主操作优先”的响应式规范与宿主验证约束

---

## 隐私说明

- **不上传任何内容** - 扩展完全在本地运行，不向任何服务器发送数据
- **无遥测/日志采集** - 不收集使用数据、不追踪行为
- **数据存储位置** - 仅使用浏览器本地存储（chrome.storage.local）
- **无第三方服务** - 不依赖任何外部 API 或服务
- **如何删除数据** - 卸载扩展即可完全清除，或在 Chrome 扩展设置中清除存储

---

## 常见问题

### Q: 安装后无法连接 AI 页面？
**A:** 安装或更新扩展后，需要刷新已打开的 AI 页面。

### Q: 交叉引用时提示"无法获取回复"？
**A:** 确保源 AI 已经有回复。系统会获取该 AI 的最新一条回复。

### Q: ChatGPT 回复很长时会超时吗？
**A:** 不会。系统支持最长 10 分钟的回复捕获。

---

## 已知限制

- 依赖各 AI 平台的 DOM 结构，平台更新可能导致功能失效
- 不支持 Claude Artifacts、ChatGPT Canvas 等特殊功能
- **Gemini、豆包、千问、Kimi 不支持自动文件上传** - 本轮接入仅支持文本发送与回复捕获；若带文件发送，系统会跳过这些 provider，并继续向支持文件上传的 provider 发送

---

## Contributing

Contributions welcome (low-maintenance project):

- Reproducible bug reports (input + output + steps + environment)
- Documentation improvements
- Small PRs (fixes/docs)

> **Note:** Feature requests may not be acted on due to limited maintenance capacity.

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

## Author

**Axton Liu** - AI Educator & Creator

- Website: [axtonliu.ai](https://www.axtonliu.ai)
- YouTube: [@AxtonLiu](https://youtube.com/@AxtonLiu)
- Twitter/X: [@axtonliu](https://twitter.com/axtonliu)

### Learn More

- [MAPS™ AI Agent Course](https://www.axtonliu.ai/aiagent) - Systematic AI agent skills training
- [Agent Skills Resource Library](https://www.axtonliu.ai/agent-skills) - Claude Code Skills collection and guides
- [Claude Skills: A Systematic Guide](https://www.axtonliu.ai/newsletters/ai-2/posts/claude-agent-skills-maps-framework) - Complete methodology
- [AI Elite Weekly Newsletter](https://www.axtonliu.ai/newsletters/ai-2) - Weekly AI insights
- [Free AI Course](https://www.axtonliu.ai/axton-free-course) - Get started with AI

---

© AXTONLIU™ & AI 精英学院™ 版权所有

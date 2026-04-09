# 千问网页端支持设计

## Context

当前扩展已经支持 Claude、ChatGPT、Gemini、豆包 四个网页 provider，运行时仍然遵循同一条三层主链路：

1. `sidepanel/panel.js` 负责 normal send、`/mutual`、`/cross`、discussion 的编排。
2. `background.js` 根据 host 解析 provider tab，转发消息，并缓存 `latestResponses`。
3. `content/*.js` 作为 provider-specific DOM adapter，负责注入消息、等待流式完成、提取最新回复，并发送 `RESPONSE_CAPTURED`。

本次目标是在这个既有架构内新增 **千问网页端支持**。用户提供的入口是 `https://www.qianwen.com/?ch=tongyi_redirect`，并要求：

- 内部代码统一使用 `qianwen`
- UI 文案统一显示“千问”
- host 匹配同时覆盖入口域名与最终聊天页域名
- 本轮支持 normal send、response capture、`/mutual`、`/cross`、discussion
- 本轮不支持自动文件上传

## Current-state evidence

当前代码库中尚未存在 `qianwen` / `千问` / `tongyi` 相关实现，验证结果如下：

- 全仓搜索 `qianwen|tongyi|千问` 无命中
- `manifest.json` 当前只声明 Claude / ChatGPT / Gemini / 豆包 host 权限
- `background.js` 当前 provider host 路由只覆盖既有四个 provider
- `sidepanel/panel.html` 与 `sidepanel/panel.js` 当前 UI 与 provider metadata 也只覆盖既有四个 provider

这说明千问支持在当前仓库里是一次净新增 provider，而不是对旧实现的修补。

## User-approved scope

### In scope

- 千问 normal mode 文本发送
- 千问 response capture
- 千问参与 `/mutual`
- 千问参与 `/cross`
- 千问参与 discussion mode（仍然是 2~3 位参与者规则）
- side panel 中的 target、mention、discussion participant 暴露“千问”
- regression tests 覆盖 panel orchestration、background routing、qianwen adapter contract

### Out of scope

- 千问自动文件上传
- 超出新增 provider 所需范围的平台级重构
- 后端、API、云端持久化相关改动

## Product rules

1. **内部代码只使用 `qianwen`。**
2. **UI 文案只显示“千问”。**
3. **host 匹配同时覆盖入口域名与最终聊天页域名。**
4. **千问必须进入现有 send/capture/cache 主链路，不允许旁路特判。**
5. **discussion 仍然保持 2~3 位参与者规则，不因为新增 provider 改玩法。**
6. **所有依赖历史回复的生成型 prompt 仍然必须显式要求中文输出。**
7. **千问文件上传本轮不承诺；如果用户向千问发送文件，系统必须显式失败或显式跳过，不能假成功。**

## Recommended approach

### Chosen approach: lightweight provider registry expansion

保留现有三层架构，不新建新的运行时层级；在此基础上做一轮轻量 provider metadata 扩容，让 panel / background / tests 按统一命名和能力约束接入 `qianwen`。

### Why this approach

- 直接把第五个 provider 再硬编码一遍虽然能跑，但会进一步放大散落字面量和重复分支。
- 全面平台化重构对当前仓库来说过度设计，验证面和返工面都过大。
- 轻量 registry 扩容与仓库当前体量匹配，既能完成本轮交付，也能减少后续再接 provider 的重复劳动。

## Provider metadata contract

`qianwen` 需要进入现有 provider metadata 体系，至少包含以下字段：

- `id`: `qianwen`
- `label`: `千问`
- `mention`: `@Qianwen`
- `hosts`: 入口域名 + 最终聊天页域名
- `supports`:
  - `normalSend: true`
  - `responseCapture: true`
  - `discussion: true`
  - `mutual: true`
  - `cross: true`
  - `fileUpload: false`

这套 contract 的目标不是抽象出新的平台层，而是建立单一真相源，让以下行为不再各自维护一份 provider 列表：

- target selection
- mention insertion / parsing
- connected tab recognition
- discussion participant rendering
- display label mapping
- file upload support gating

## File-level design

### `manifest.json`

需要做三项改动：

1. 在 `host_permissions` 中加入千问相关 host。
2. 在 `content_scripts` 中注册 `content/qianwen.js`。
3. bump `version`，确保 Chrome 强制刷新 content script，避免使用缓存旧脚本。

host 配置需覆盖用户提供的入口域名以及真实聊天页最终域名。

### `background.js`

`background.js` 负责 provider tab 路由与 `latestResponses` 缓存，需要纳入 `qianwen`：

- host pattern 增加 `qianwen`
- `getStoredResponses()` 默认结构增加 `qianwen: null`
- `findAITab()` 能解析千问 tab
- `getAITypeFromUrl()` 能将千问页面映射为 `qianwen`

不新增 background message type，继续复用既有闭环：

- `SEND_MESSAGE`
- `GET_RESPONSE`
- `RESPONSE_CAPTURED`

### `sidepanel/panel.html`

side panel UI 需要暴露千问，但不改变交互规则：

- normal mode target 列表新增“千问”
- mention 按钮新增 `@Qianwen`
- discussion participant 列表新增“千问”
- discussion 仍然限制选择 2~3 位参与者

### `sidepanel/panel.js`

`sidepanel/panel.js` 是主要编排面，需要做四类改动：

#### 1. Provider enumeration

在 provider metadata 中新增 `qianwen`，并让以下逻辑继续从统一 provider 列表派生：

- normal target 集合
- connected tab 状态
- discussion participant 集合
- UI label 解析

#### 2. URL recognition and mention parsing

- `getAITypeFromUrl()` 识别千问相关 host
- mention regex / parser 接受 `@Qianwen`
- `/cross` 的 source / target 路由允许 `qianwen` 出现在任意合法位置

必须覆盖示例：

- `@Qianwen 评价一下 @Claude`
- `@Claude 评价一下 @Qianwen`
- `/cross @Claude @Qianwen <- @ChatGPT 对比一下`
- `/cross @Qianwen <- @Claude @Gemini 补充一下`

#### 3. UI label and status rendering

任何用户可见字符串统一走 provider label：

- target label 显示“千问”
- discussion participant badge 显示“千问”
- waiting / error / status 文案显示“千问”
- 禁止把内部 id `qianwen` 直接渲染到 UI

#### 4. File-upload gating

如果消息包含文件且目标中包含 `qianwen`：

- 对千问显式提示“暂不支持自动文件上传”
- 其余支持文件上传的 provider 继续正常走现有逻辑
- 不允许静默跳过，更不允许返回成功假象

### `content/qianwen.js`

新增千问网页 provider adapter，职责与既有 provider 脚本保持一致：

1. 接收 `INJECT_MESSAGE`
2. 定位千问输入框并填充消息
3. 触发发送动作
4. 观察新 assistant 回复
5. 判断回复是否真正完成
6. 响应 `GET_LATEST_RESPONSE`
7. 发送 `RESPONSE_CAPTURED`，其中 `aiType: 'qianwen'`

### Completion contract for Qianwen capture

千问捕获策略必须遵守仓库已有经验：

- **不能仅凭文本短暂稳定就结束捕获**
- **不能仅凭单一 DOM 停止信号就结束捕获**

必须采用双保险：

1. 观察千问网页端的流式状态 DOM 信号
2. 叠加长度/内容稳定窗口作为兜底

目标是避免在长回复中因中途停顿而过早截断最终 capture。

## Data-flow contract

千问接入后的标准闭环必须是：

1. 用户在 side panel 勾选“千问”或输入 `@Qianwen`
2. `sidepanel/panel.js` 根据 provider metadata 解析目标
3. `background.js` 按 host 匹配找到千问 tab
4. `content/qianwen.js` 注入消息并等待完整回复
5. `content/qianwen.js` 发出 `RESPONSE_CAPTURED`
6. `background.js` 将结果写入 `chrome.storage.session.latestResponses.qianwen`
7. normal send、`/mutual`、`/cross`、discussion 都消费这份缓存

千问是主链路上的一个标准 provider，不是例外分支。

## Failure boundaries

以下失败边界必须显式定义：

- 找不到输入框：返回明确错误
- 找不到发送按钮：返回明确错误
- 页面还在流式生成：不提前 finalize capture
- host 未命中或 tab 不存在：返回 provider 不可用错误
- 用户向千问发送文件：明确提示“不支持自动文件上传”

失败允许发生，但必须满足三点：**可见、可诊断、可复现**。

## Testing design

### 1. Panel orchestration tests

需要更新或扩展：

- `tests/panel-normal-mode.test.mjs`
- `tests/panel-discussion.test.mjs`

关键断言：

- provider collections 包含 `qianwen`
- mention parser 接受 `@Qianwen`
- `/cross` 接受千问作为 source 与 target
- discussion participant 列表包含“千问”
- discussion 仍然强制 2~3 位参与者
- UI label 显示“千问”而不是 `qianwen`
- 若变更触及 shared polling helper，需要保留既有 ChatGPT 长回复截断回归检查

### 2. Background routing tests

新增或扩展 background tests，验证：

- 千问入口域名映射到 `qianwen`
- 千问最终聊天页域名也映射到 `qianwen`
- `latestResponses` 默认结构包含 `qianwen: null`

测试 harness 读取源码时必须使用基于 `import.meta.url` 的相对路径，避免 stale worktree path 问题。

### 3. Qianwen adapter tests

新增 `tests/qianwen-capture.test.mjs`，至少覆盖：

- prompt injection 能写入输入区
- send action 能被触发
- latest response extraction 返回最新 assistant reply
- completion logic 不会在 partial reply 阶段提前 capture
- `INJECT_FILES` 对千问返回明确失败

### 4. Regression guardrails

如果改动触及 `sidepanel/panel.js` 的 shared polling 或 completion-related logic，必须同时复核现有 ChatGPT 截断回归：

- `tests/chatgpt-capture.test.mjs`
- `tests/panel-normal-mode.test.mjs`
- `tests/panel-discussion.test.mjs`

单层通过不能视为问题关闭，必须把 provider capture、normal closure、discussion closure 三层一起看。

## Manual validation plan

因为本仓库的最终真相仍然是 Chrome 扩展宿主，自动化测试之外需要按顺序做手工验证：

1. 打开 `chrome://extensions/`
2. Reload 当前 unpacked extension
3. 刷新已打开的 Claude / ChatGPT / Gemini / 豆包 / 千问页面
4. 打开 side panel，确认“千问”状态点显示正常
5. 只勾选“千问”，发送普通消息
6. 勾选 Claude + 千问，验证 mixed send
7. 在多 provider 都有历史回复后执行 `/mutual`
8. 执行 `/cross`，验证千问作为 target
9. 执行 `/cross`，验证千问作为 source
10. 用千问 + 另一位 provider 启动 discussion
11. 用千问 + 两位其他 provider 启动 discussion
12. 给千问发送文件，确认出现明确失败而不是假成功
13. 在千问页面触发长回复，确认最终 capture 包含完整尾段而非半句截断

## Acceptance criteria

本设计完成时，应满足以下标准：

- 仓库内部统一使用 `qianwen`
- UI 文案统一显示“千问”
- 入口域名与最终聊天页域名都能识别为 `qianwen`
- 千问进入现有 send/capture/cache 主链路
- normal send、`/mutual`、`/cross`、discussion 全部可用
- 千问回复捕获不会因短暂停顿而过早截断
- 千问文件上传不支持时会明确失败
- regression tests 覆盖 panel / background / qianwen content adapter 三层 contract
- 若改动触及 shared polling 或 completion rule，既有 ChatGPT 长回复截断回归保持绿色

## Non-goals reminder

本设计刻意不包含：

- provider 平台全面重构
- 千问自动文件上传
- 新的后端或 API 集成
- 超出新增一个网页 provider 所需范围的架构翻修

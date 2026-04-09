# Kimi 网页端支持设计

## Context

当前扩展已经支持 Claude、ChatGPT、Gemini、豆包 四个网页 provider，运行时遵循同一条三层主链路：

1. `sidepanel/panel.js` 负责 normal send、`/mutual`、`/cross`、discussion 的编排。
2. `background.js` 根据 host 解析 provider tab，转发消息，并缓存 `latestResponses`。
3. `content/*.js` 作为 provider-specific DOM adapter，负责注入消息、等待流式完成、提取最新回复，并发送 `RESPONSE_CAPTURED`。

本次目标是在这个既有架构内新增 **Kimi 网页端支持**。用户提供的入口是 `https://www.kimi.com/?chat_enter_method=new_chat`，并已明确：

- 内部代码统一使用 `kimi`
- UI 文案统一显示 `Kimi`
- host 先收口到 `www.kimi.com`
- 本轮支持 normal send、response capture、`/mutual`、`/cross`、discussion
- 本轮不支持自动文件上传
- 如果消息带文件且同时选中 Kimi，Kimi 显式跳过，其他支持文件上传的 provider 继续发送

## Current-state evidence

当前仓库的既有结构和验证抓手已经足够承接第五个 provider：

- `background.js` 当前按 provider host + `latestResponses` 做路由和缓存闭环
- `sidepanel/panel.js` 当前已具备 `supports.fileUpload` gating 逻辑
- `sidepanel/panel.js` 当前的 `/mutual`、`/cross`、discussion 已基于共享 polling / baseline 语义收口
- `tests/background-routing.test.mjs`、`tests/panel-normal-mode.test.mjs`、`tests/panel-discussion.test.mjs` 已覆盖 provider routing、completion metadata、shared polling、Doubao 接入等模式
- `docs/superpowers/specs/2026-04-07-qianwen-support-design.md` 已沉淀“轻量 provider registry 扩容”的成熟设计路径

这说明 Kimi 支持应作为一次标准 provider 扩容，而不是另起一套特例通道。

## User-approved scope

### In scope

- Kimi normal mode 文本发送
- Kimi response capture
- Kimi 参与 `/mutual`
- Kimi 参与 `/cross`
- Kimi 参与 discussion mode（仍然保持 2~3 位参与者规则）
- side panel 中的 target、mention、discussion participant 暴露 `Kimi`
- regression tests 覆盖 panel orchestration、background routing、kimi adapter contract

### Out of scope

- Kimi 自动文件上传
- 超出新增 provider 所需范围的平台级重构
- 后端、API、云端持久化相关改动

## Product rules

1. **内部代码只使用 `kimi`。**
2. **UI 文案只显示 `Kimi`。**
3. **host 范围本轮只收口 `www.kimi.com`。**
4. **Kimi 必须进入现有 send/capture/cache 主链路，不允许旁路特判。**
5. **discussion 仍然保持 2~3 位参与者规则，不因为新增 provider 改玩法。**
6. **所有依赖历史回复的生成型 prompt 仍然必须显式要求中文输出。**
7. **Kimi 文件上传本轮不承诺；如果用户向 Kimi 发送文件，系统必须显式跳过 Kimi，并允许其他支持文件上传的 provider 继续发送。**

## Recommended approach

### Chosen approach: lightweight provider registry expansion

保留现有三层架构，不新建新的运行时层级；在此基础上做一轮轻量 provider metadata 扩容，让 panel / background / tests 按统一命名和能力约束接入 `kimi`。

### Why this approach

- 直接把第五个 provider 再硬编码一遍虽然能跑，但会继续放大散落字面量和重复分支。
- 全面平台化重构对当前仓库来说过度设计，验证面和返工面都过大。
- 轻量 registry 扩容与仓库当前体量匹配，既能完成本轮交付，也能减少后续再接 provider 的重复劳动。

## Provider metadata contract

`kimi` 需要进入现有 provider metadata 体系，至少包含以下字段：

- `id`: `kimi`
- `label`: `Kimi`
- `mention`: `@Kimi`
- `hosts`: `['www.kimi.com']`
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

## Architecture and components

### Runtime layering

Kimi 不走旁路，不搞特例，直接并入现有三层主链路：

1. `sidepanel/panel.js`
   - 负责 normal send、`/mutual`、`/cross`、discussion orchestration
   - 将 `kimi` 纳入 target、mention、participant、status、label 渲染

2. `background.js`
   - 根据 `www.kimi.com` 识别 Kimi tab
   - 复用现有 `SEND_MESSAGE` / `GET_RESPONSE` / `RESPONSE_CAPTURED`
   - 将最新回复缓存到 `chrome.storage.session.latestResponses.kimi`

3. `content/kimi.js`
   - 作为 Kimi 专属 DOM adapter
   - 负责输入框注入、触发发送、监听回复、判断流式完成、返回最新回复

### File-level design

#### `manifest.json`

需要做三项改动：

1. 在 `host_permissions` 中加入 `https://www.kimi.com/*`
2. 在 `content_scripts` 中注册 `content/kimi.js`
3. bump `version`，确保 Chrome 强制刷新 content script，避免继续使用缓存旧脚本

#### `background.js`

`background.js` 负责 provider tab 路由与 `latestResponses` 缓存，需要纳入 `kimi`：

- `AI_URL_PATTERNS` 增加 `kimi`
- `getStoredResponses()` 默认结构增加 `kimi: null`
- `findAITab()` 能解析 Kimi tab
- `getAITypeFromUrl()` 能将 `www.kimi.com` 页面映射为 `kimi`

不新增 background message type，继续复用既有闭环：

- `SEND_MESSAGE`
- `GET_RESPONSE`
- `RESPONSE_CAPTURED`

#### `sidepanel/panel.html`

side panel UI 需要暴露 Kimi，但不改变交互规则：

- normal mode target 列表新增 `Kimi`
- mention 按钮新增 `@Kimi`
- discussion participant 列表新增 `Kimi`
- discussion 仍然限制选择 2~3 位参与者

#### `sidepanel/panel.js`

`sidepanel/panel.js` 是主要编排面，需要做四类改动：

1. **Provider enumeration**
   - 在 provider metadata 中新增 `kimi`
   - 让 normal target、connected status、discussion participants、display label 继续从统一 provider 列表派生

2. **URL recognition and mention parsing**
   - `getAITypeFromUrl()` 识别 `www.kimi.com`
   - mention regex / parser 接受 `@Kimi`
   - `/cross` 的 source / target 路由允许 `kimi` 出现在任意合法位置

   必须覆盖示例：
   - `@Kimi 评价一下 @Claude`
   - `@Claude 评价一下 @Kimi`
   - `/cross @Claude @Kimi <- @ChatGPT 对比一下`
   - `/cross @Kimi <- @Claude @Gemini 补充一下`

3. **UI label and status rendering**
   - target label 显示 `Kimi`
   - discussion participant badge 显示 `Kimi`
   - waiting / error / status 文案显示 `Kimi`
   - 禁止把内部 id `kimi` 直接渲染到用户可见 UI

4. **File-upload gating**
   - 如果消息包含文件且目标中包含 `kimi`：
     - 对 Kimi 显式提示“`Kimi 暂不支持自动文件上传`”
     - 其余支持文件上传的 provider 继续正常走现有逻辑
   - 不允许静默跳过，更不允许返回成功假象

#### `content/kimi.js`

新增 Kimi 网页 provider adapter，职责与既有 provider 脚本保持一致：

1. 接收 `INJECT_MESSAGE`
2. 定位 Kimi 输入框并填充消息
3. 触发发送动作
4. 观察新 assistant 回复
5. 判断回复是否真正完成
6. 响应 `GET_LATEST_RESPONSE`
7. 发送 `RESPONSE_CAPTURED`，其中 `aiType: 'kimi'`

## Data-flow contract

Kimi 接入后的标准闭环必须是：

1. 用户在 side panel 勾选 `Kimi`，或输入 `@Kimi`
2. `sidepanel/panel.js` 根据 provider metadata 解析目标
3. `background.js` 按 host 匹配找到 Kimi tab
4. `content/kimi.js` 注入消息并等待完整回复
5. `content/kimi.js` 发出 `RESPONSE_CAPTURED`
6. `background.js` 将结果写入 `chrome.storage.session.latestResponses.kimi`
7. normal send、`/mutual`、`/cross`、discussion 都消费这份缓存与实时 `GET_RESPONSE` 元数据

Kimi 是主链路上的一个标准 provider，不是例外分支。

## Completion contract for Kimi capture

Kimi 捕获策略必须遵守仓库已有经验：

- **不能仅凭文本短暂稳定就结束捕获**
- **不能仅凭单一 DOM 停止信号就结束捕获**
- **normal mode 与 discussion mode 必须共用同一套 completion readiness 语义**

必须采用双保险：

1. **Kimi-specific DOM signal**
   - 观察 Kimi 页面中“仍在生成 / 可停止 / 发送按钮状态变化 / assistant 区块增量更新”等信号
   - 用于判断是否仍在 streaming

2. **settle / stability window**
   - 即使 DOM 看起来结束，也要经过短观察窗确认尾段已经落地
   - 避免出现“先半句、后补尾巴”的 premature capture

在 `sidepanel/panel.js` 的 polling 收口侧，Kimi 不走例外逻辑，继续遵守共享规则：

- baseline-driven polling
- pending set 收口
- `streamingActive === true` 时继续等待
- `captureState === 'unknown'` 时继续等待
- discussion round 只在所有 pending provider 真正 ready 后才收口

## Behavior contract for mutual / cross / discussion

### `/mutual`

- Kimi 可以是参与方之一
- 继续从 `latestResponses.kimi` / `GET_RESPONSE(kimi)` 拿最新有效回复
- 发给其他 AI 的引用块格式与现有 provider 一致：`<kimi_response>...</kimi_response>`

### `/cross`

以下场景都必须合法：

- `@Kimi 评价一下 @Claude`
- `@Claude 评价一下 @Kimi`
- `/cross @Kimi <- @Claude @Gemini 对比一下`
- `/cross @Claude @Kimi <- @ChatGPT 评价一下`

### `discussion`

- Kimi 可以作为 2~3 人讨论中的任一参与者
- 初始轮、交叉评价轮、插话、总结都参与
- 所有阶段 prompt 继续显式要求中文
- 若 Kimi 同轮收到 later, fuller capture，允许像现有 discussion 逻辑一样覆盖较短旧内容

## Failure boundaries

以下失败边界必须显式定义：

- 找不到 Kimi tab：`background.js` 返回 `No kimi tab found`
- 找不到输入框：`content/kimi.js` 返回明确错误
- 找不到发送按钮：`content/kimi.js` 返回明确错误
- 流式状态未知：返回 `captureState: 'unknown'`，sidepanel 继续等待，不提前完成 normal/discussion
- 未拿到新回复：保持 pending，不拿旧 baseline 冒充新结果
- 用户向 Kimi 发送文件：明确 skip Kimi，并提示不支持自动文件上传；其他支持 provider 继续发送

## Verification and test strategy

### Automated regression coverage

Kimi 这轮至少补四类测试：

1. **`tests/background-routing.test.mjs`**
   - `getAITypeFromUrl('https://www.kimi.com/...') === 'kimi'`
   - `getStoredResponses()` 默认结构包含 `kimi: null`
   - `getResponseFromContentScript('kimi')` 在 completion metadata 缺失时返回 `captureState: 'unknown'`

2. **`tests/panel-normal-mode.test.mjs`**
   - `parseMessage('@Kimi 评价一下 @Claude')` 能识别 direct cross-reference
   - `parseMessage('/cross @Claude @Kimi <- @ChatGPT 对比一下')` 能识别 explicit routing
   - normal send 勾选 Kimi 时，`SEND_MESSAGE` 发往 `kimi`
   - Kimi 参与 `/mutual` / `/cross` 时，生成 prompt 仍显式包含“请用中文回复”
   - 如果 `captureState === 'unknown'`，normal polling 持续等待 fuller tail，不提前 accept

3. **`tests/panel-discussion.test.mjs`**
   - discussion participant 可选中 Kimi
   - Kimi 能进入 2~3 人讨论池
   - discussion round polling 遇到 `captureState === 'unknown'` 持续 pending
   - Kimi 同轮 later capture 更长时，允许覆盖较短旧内容
   - summary / interject / next round prompt 继续显式要求中文

4. **`tests/kimi-capture.test.mjs`**
   - 能定位输入框并触发发送
   - `GET_LATEST_RESPONSE` 能拿到最新 assistant 内容
   - 缺失稳定条件时不提前 finalize
   - streaming 结束且内容稳定后发送 `RESPONSE_CAPTURED`
   - 若存在“先短后长”的尾段更新，最终 capture 取更完整版本
   - 找不到输入框 / 发送按钮时返回明确错误

### Manual Chrome verification

最终验收仍需手工在 Chrome 中完成：

1. Reload unpacked extension，并刷新 Kimi 页面，让新 content script 注入
2. normal mode 发送普通文本，确认 Kimi 可成功注入并捕获回复
3. normal mode 发送长回复 prompt，确认不会截在半句
4. 让 Kimi 与至少一个既有 provider 先各自产生回复，再运行 `/mutual`
5. 验证 `/cross` 中 Kimi 同时可以作为 source 和 target
6. 使用 Kimi + 另一个 provider 做 2 人 discussion，至少覆盖：初始轮、下一轮、插话、总结
7. 如条件允许，再做 3 人 discussion spot check
8. 带文件同时选择 Kimi + 其他 provider，确认 Kimi 被显式跳过，其它 provider 继续发送

## Done definition

本轮完成标准必须同时满足：

1. **功能闭环完整**：Kimi 在 normal / mutual / cross / discussion 全部可参与
2. **收口语义一致**：不因 Kimi 引入新的 premature completion / truncated capture
3. **能力边界明确**：file upload 对 Kimi 明确 skip，不假成功
4. **验证证据齐全**：自动化回归通过，且完成至少一轮 Chrome 手工 spot check

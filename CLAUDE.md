# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

- Chrome extension (Manifest V3) for running a multi-model "roundtable" across Claude, ChatGPT, and Gemini web UIs
- No backend, no API integration, no cloud persistence
- Main fragility is upstream DOM/UI changes in the supported AI sites

## Fast start

There is no build step and no package manager manifest in the repo root.

Primary development loop:
1. Open `chrome://extensions/`
2. Enable Developer Mode
3. Load this repo as an unpacked extension, or click Reload after changes
4. Refresh already-open Claude / ChatGPT / Gemini tabs so content scripts are reinjected
5. Re-open the extension side panel and manually verify the changed flow

## How to verify changes

This repo does not include an automated lint/test/build pipeline. Validation is manual in Chrome.

Common verification flows:
- Normal send: select targets in the side panel and send a prompt
- Mutual review: send an initial prompt to multiple AIs, wait for replies, then run `/mutual`
- Cross-reference: use `@Claude ... @ChatGPT` for 2-model review, or `/cross @Claude @Gemini <- @ChatGPT ...` for explicit routing
- Discussion mode: choose exactly 2 participants, start a topic, then verify next round, interject, and summary
- File upload: verify on Claude and ChatGPT; Gemini intentionally falls back to manual upload

### Fixed regression checklist: ChatGPT long-response truncation

Use this exact checklist after any change touching `content/chatgpt.js`, `sidepanel/panel.js`, shared polling helpers, or response-capture completion rules.

1. **Provider capture layer (`content/chatgpt.js`)**
   - Run `node --test tests/chatgpt-capture.test.mjs`
   - Confirm the long-tail regression stays green:
     - `chatgpt capture does not lock a truncated long reply when streaming stops before the tail arrives`
     - `chatgpt getCaptureState stays unknown while search tooling is still running even if action buttons are visible`
     - `chatgpt capture waits for search tooling to finish before accepting action-button completion`
   - This proves ChatGPT does not finalize on a truncated tail like `这篇文` before the fuller tail lands.
   - This also proves ChatGPT does not treat "already rendered a first paragraph + action buttons visible" as complete while provider-side search/tool execution is still running.

2. **Normal mode closure (`sidepanel/panel.js` normal polling)**
   - Run `node --test tests/panel-normal-mode.test.mjs`
   - Confirm the normal-mode regression stays green:
     - `normal mode keeps ChatGPT pending when a truncated long reply is still unknown and only accepts the fuller tail later`
     - `normal mode ignores push captures that are still unknown until ChatGPT sends a complete final push`
   - This proves normal send consumes `streamingActive` / `captureState` and does not accept `captureState === 'unknown'` as final.

3. **Discussion round closure (`sidepanel/panel.js` discussion polling)**
   - Run `node --test tests/panel-discussion.test.mjs`
   - Confirm the discussion regressions stay green:
     - `discussion mode keeps ChatGPT pending when a truncated long reply is still unknown and only completes after the fuller tail arrives`
     - `discussion mode does not complete a round when ChatGPT completion readiness is unknown`
     - `discussion mode ignores push captures that are still unknown until ChatGPT sends a complete final push`
   - This proves discussion rounds do not advance on truncated ChatGPT content and only close when the fuller tail is captured.

4. **Background metadata bridge (`background.js`)**
   - Run `node --test tests/background-routing.test.mjs`
   - Confirm the push-metadata regression stays green:
     - `background preserves RESPONSE_CAPTURED metadata when storing and forwarding push updates`
   - This proves provider push captures keep `streamingActive` / `captureState` / `updatedAt` instead of silently downgrading to a bare string payload.

5. **Manual Chrome spot check**
   - Reload the unpacked extension
   - Refresh the open ChatGPT tab so the updated content script reinjects
   - In normal mode, send a prompt that reliably yields a long multi-paragraph answer; verify the final captured answer includes the tail paragraph instead of stopping at a half sentence
   - In normal mode, also verify a "先回答一段，然后继续搜索/调用工具" prompt stays pending until the final answer lands
   - In discussion mode, run at least one round where ChatGPT produces a long answer or search/tool continuation; verify the round stays pending until ChatGPT finishes and that the stored round entry matches the full answer

If any one of these five checks fails, treat the completion bug as still open; do not rely on a single passing layer.

## Architecture in one page

The runtime has three layers:

1. `sidepanel/panel.js`
   - Owns the operator UI
   - Parses `/mutual`, `/cross`, and `@mentions`
   - Orchestrates standard sends, mutual review, cross-reference, discussion rounds, summaries, and file upload from the panel

2. `background.js`
   - Service worker message hub
   - Maps AI type to browser tab by host
   - Forwards commands from the side panel to content scripts
   - Caches latest captured responses in `chrome.storage.session` as `latestResponses`

3. `content/claude.js`, `content/chatgpt.js`, `content/gemini.js`
   - Site-specific DOM adapters
   - Inject prompt text/files into each provider UI
   - Detect when streaming is done
   - Extract the latest reply and send `RESPONSE_CAPTURED` back to the background worker

## Core message flow

1. `sidepanel/panel.js` sends `SEND_MESSAGE`, `SEND_FILES`, or `GET_RESPONSE`
2. `background.js` finds the matching provider tab and forwards `INJECT_MESSAGE`, `INJECT_FILES`, or `GET_LATEST_RESPONSE`
3. A content script performs DOM interaction on the target site
4. The content script emits `RESPONSE_CAPTURED`
5. `background.js` stores the latest response in `chrome.storage.session` and notifies the side panel
6. Higher-level features like `/mutual`, `/cross`, and discussion mode all depend on that captured-response pipeline

If a feature that references previous answers breaks, inspect response capture first before changing command parsing.

## Where to change things

### If sending a prompt fails

Check in this order:
- `sidepanel/panel.js`
  - `handleSend()`
  - `sendToAI()`
- `background.js`
  - `handleMessage()` for `SEND_MESSAGE`
  - `findAITab()`
  - `sendMessageToAI()`
- Provider adapter
  - `content/claude.js` → `injectMessage()`
  - `content/chatgpt.js` → `injectMessage()`
  - `content/gemini.js` → `injectMessage()`

Likely causes:
- side panel did not target the expected AI
- background worker did not find the correct tab
- provider DOM selectors for input/send button drifted

### If replies are not being captured

Check in this order:
- `background.js`
  - `handleMessage()` for `RESPONSE_CAPTURED`
  - `getResponseFromContentScript()`
  - `chrome.storage.session` caching of `latestResponses`
- Provider adapter
  - `setupResponseObserver()`
  - `waitForStreamingComplete()`
  - `getLatestResponse()`

Provider-specific notes:
- Claude extraction intentionally filters out "Thought process" blocks
- ChatGPT extraction aggregates markdown plus canvas/text/code areas from the latest assistant turn
- ChatGPT should only finalize capture after content is stable and streaming has actually stopped; stability alone can lock in a truncated partial reply
- If the same discussion round receives a later, longer capture for the same AI, prefer replacing the earlier partial entry instead of ignoring the update
- Gemini capture is simpler and more selector-sensitive
- ChatGPT streaming capture strategy - 时间阈值策略不可靠（分段输出时段落间停顿时间不固定），必须采用双重保险：DOM 信号检测（操作按钮组出现）+ 长时间兜底（30秒长度稳定）。单纯依赖停止按钮或复制按钮检测会因 UI 变化导致选择器失效。
- ChatGPT search/tool continuation - ChatGPT 已渲染首段文本且操作按钮可见，不代表最终完成；如果页面仍有搜索/工具运行信号，`content/chatgpt.js` 必须继续返回 `captureState: 'unknown'` 并阻止 `RESPONSE_CAPTURED` 早发。
- ChatGPT completion metadata in discussion polling - discussion/normal 侧的 `GET_RESPONSE` 若返回 `streamingActive` / `captureState`，收口必须消费这些元数据；`captureState === 'unknown'` 时继续等待，不要只因文本稳定就进入下一阶段。
- Normal/discussion completion parity - `sidepanel/panel.js` 的 normal send 与 discussion polling 必须共用同一套 completion readiness 语义；修一边时同步检查另一边，避免一个消费 `captureState`、另一个只看文本变化而重新引入截断或提前收口。
- Push metadata parity - `RESPONSE_CAPTURED` push 事件不能只传 `content`；provider、`background.js`、`sidepanel/panel.js` 三层都要保留并消费 `streamingActive` / `captureState` / `updatedAt`，否则 push 会绕过 poll 的 readiness 保护并提前收口。
- Chrome extension content script cache - 修改 content script 后必须同时修改 manifest.json 版本号才能强制 Chrome 重新加载，否则浏览器会继续运行缓存的旧代码。仅点击"重新加载"按钮或刷新页面不足以清除 content script 缓存。
- Gemini message injection - 文本设置后需触发多个事件（input, change, keydown, keyup）并延长等待时间（300ms）以确保发送按钮启用。添加 Ctrl+Enter 键盘快捷键作为备选发送方式。
- Gemini background-tab response extraction - `content/gemini.js` 抓取最新回复时优先 `innerText`，但必须回退到 `textContent`；后台标签页里 `innerText` 可能为空或卡住，导致 summary 一直等到切回标签页才完成。
- Qianwen controlled-editor send verification - 千问这类受控编辑器里，DOM 写入成功不等于真实可发送；发送按钮可能在输入事件后异步启用，提交成功也不能只看“按钮找到了/点到了”或 page-context handler 返回成功，必须再验证发送后状态变化（如输入区内容变化、stop/streaming signal 出现、会话进入新状态）。
- Sidepanel response closure ownership - 对 normal send、discussion 这类需要“等待新回复”的 sidepanel 流程，发送前先抓每个 AI 的 baseline，再用 pending 集合 + pull polling 收口；不要把发送前缓存的旧回复当成新结果，也不要把收口完全压在 provider push 上。
- Shared polling helper - 当 normal mode 与 discussion mode 都依赖 baseline-driven polling 时，优先扩展 `createPollingController()` / `captureResponseBaselines()` / `startResponsePolling()` 这类共享 helper，不要再复制第二套 timer/baseline 状态机。
- Panel session version parity - 若 `panelSession` 这类 sidepanel 快照通过 `version` 防 stale write，则 `PANEL_STATE_CLEAR` / reset 路径也必须传并校验 version；只守 `set` 不守 `clear`，旧的 panel close/reset 会把更新的快照误清掉。
- Summary restore timer cleanup - 若 restore 直接落到已完成的 summary 视图，必须先清 discussion polling / summary settle 相关 timer，再 render summary；否则隐藏 timer 可能继续改写状态，`vm.runInContext` 测试也可能残留活跃 timer。
- Sidepanel VM test harness cleanup - 对 `tests/panel-discussion.test.mjs`、`tests/panel-normal-mode.test.mjs` 这类通过 `vm.runInContext` 加载 sidepanel 的测试桩，若生产代码会创建 `setInterval`/`setTimeout`，测试桩必须包装 timer、暴露 `dispose()`，并在 `afterEach` 或测试结束路径统一清理，否则断言已通过也会因活跃 timer 导致 `node --test` 不退出。
- Background harness source path - `tests/background-routing.test.mjs` 这类直接读取源码文件的 harness，必须使用 `new URL('../background.js', import.meta.url)` 这类相对当前测试文件的路径；不要硬编码 `.worktrees/...` 或绝对路径，否则分支收口或切换工作树后会把 stale 文件当成当前生产代码。

### If `/mutual` or `@...` / `/cross` logic is wrong

Start with `sidepanel/panel.js`:
- `parseMessage()`
- `handleCrossReference()`
- `handleMutualReview()`
- `getLatestResponse()`

These features usually fail for one of two reasons:
- command parsing/routing is wrong
- prior replies were never captured, so there is nothing to quote back into the next prompt

If these flows are expected to stay in Chinese, generated prompts must explicitly say so on every hop; do not rely on the model keeping the previous round's language.

### If discussion mode is broken

Start with `sidepanel/panel.js`:
- `setupDiscussionMode()`
- `startDiscussion()`
- `handleDiscussionResponse()`
- `nextRound()`
- `handleInterject()`
- `generateSummary()`

Discussion mode is mostly side-panel orchestration built on top of the same provider send/capture pipeline.

Hard rule: every discussion-stage prompt (initial, cross-evaluation, interject, summary) must explicitly require Chinese replies instead of assuming language continuity.
- Discussion mode action visibility - 若插话区按钮消失/被遮挡，优先检查 `sidepanel/panel.css` 中 `.discussion-interject` / `.interject-actions` 的 flex 收缩与高度分配，不要先猜按钮样式。
- Discussion layout regression tests - 对 side panel 布局回归优先在 `tests/panel-discussion.test.mjs` 里读取 `sidepanel/panel.css` 做结构性断言（如禁止错误的 `flex: 1`、要求操作行 `flex-shrink: 0`）。
- Side panel long text display - 用户输入/AI 输出的长文本展示块应统一走共享容器协议：默认固定高度、内部滚动、超阈值显示展开/收起，避免撑爆控制区。
- Long text UI regression tests - 对长文本 UI 回归优先在 `tests/panel-discussion.test.mjs` / `tests/panel-normal-mode.test.mjs` 里做结构性断言，至少覆盖 shared markup、折叠滚动、展开态取消高度限制。
- Discussion responsive spec - discussion 模式布局调整后，优先把“主操作优先”的规则沉淀到 `docs/superpowers/specs/2026-04-03-discussion-responsive-spec.md`，并在 README / 相关实现计划里挂引用，避免规范变成孤岛。
- Real extension host validation via MCP - 若 `chrome://extensions` 在 MCP 浏览器里看不到本地 unpacked extension，先看 `chrome://version` 的启动参数；若存在隔离的 `--user-data-dir` 且带 `--disable-extensions`，这说明是 MCP 浏览器上下文限制，不要误判为本仓库扩展没有正确加载。
- Kimi chat materialization preflight - 真机 discussion / send 验收里，`https://www.kimi.com/chat/` 裸跳转可能仍回到首页；若首页已暴露历史会话 `/chat/...` 链接，优先沿真实站点入口进入。只有当 Kimi 页面实际落在 chat 会话且出现输入框/发送控件时，才算满足发送前置。
- Kimi capacity blocker classification - 若 `AI Panel`、`ChatGPT`、Kimi 入口链都已 materialize，但 Kimi 页面明确提示“刚刚和 Kimi 聊的人太多了”或“高峰期算力不足”，应归因为 provider 站点侧可用性阻塞，不要继续改扩展路由、selector 或 discussion 编排。
- Git worktree cleanup order - 本仓库使用 `.worktrees/` 时，合并后的清理顺序必须先 `git worktree remove <path>` 再 `git branch -d <branch>`，反过来会被 git 拦截。
- Discussion 2~3 participants generalization - 从固定双人扩展到 2~3 人时，核心策略是用 `participants` 数组替代 `[ai1, ai2]` 解构，用 `otherParticipants = participants.filter(p => p !== current)` 替代硬编码对方，所有循环改为 `for (const ai of participants)`。测试先行，确保失败来自生产代码限制而非测试设计问题。
- Discussion test assertion precision - 测试断言应验证意图而非具体文案：如"包含三个参与者名字且不含 vs"优于"精确匹配 `Claude · ChatGPT · Gemini`"；summary 卡片数量验证应只计算总结区而非整个 HTML。
- Discussion capitalize edge case - `capitalize()` 函数需特殊处理 "chatgpt" → "ChatGPT"，不能只做首字母大写。

### If file upload is broken

Check in this order:
- `sidepanel/panel.js`
  - `setupFileUpload()`
  - `sendFilesToAI()`
- `background.js`
  - `handleMessage()` for `SEND_FILES`
  - `sendFilesToAI()`
- Provider adapter
  - `injectFiles()` in each content script

Provider-specific notes:
- Claude and ChatGPT attempt automated upload via `input[type="file"]` or drag/drop fallback
- Gemini intentionally ends with a manual-upload error because automated upload is not reliable in its UI

### If connection status in the side panel is wrong

Check:
- `sidepanel/panel.js`
  - `checkConnectedTabs()`
  - `updateTabStatus()`
  - `getAITypeFromUrl()`
- `background.js`
  - `CONTENT_SCRIPT_READY`
  - `chrome.tabs.onUpdated`
  - `getAITypeFromUrl()`

## Provider-specific gotchas

- Claude uses a ProseMirror-style contenteditable input
- ChatGPT supports both older textarea-style and newer contenteditable UI patterns
- Gemini supports prompt injection and response capture, but file upload support is intentionally narrower

## Repository facts worth remembering

- Root files are minimal: `manifest.json`, `background.js`, `sidepanel/`, `content/`, `icons/`, `README.md`
- There is no repo-local CI, lint config, or test runner checked in at the root
- The README is the product/usage explanation; this file should stay focused on operator guidance for future Claude Code instances

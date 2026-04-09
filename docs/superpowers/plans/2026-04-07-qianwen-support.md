# 千问网页端支持 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Chrome 扩展新增千问网页端支持，使千问可进入现有 normal send、`/mutual`、`/cross`、discussion 的发送/捕获/缓存闭环。

**Architecture:** 保持现有三层结构不变：`sidepanel/panel.js` 负责编排，`background.js` 负责 tab 路由和最新回复缓存，`content/qianwen.js` 负责千问网页 DOM 注入与回复捕获。本次只做轻量 provider 元数据扩容：内部统一使用 `qianwen`，UI 统一显示“千问”，不引入新的运行时层级，不做平台级重构。

**Tech Stack:** Chrome Extension Manifest V3、vanilla JavaScript、Node built-in test runner (`node --test`)、VM-based panel/content-script tests、Chrome side panel UI

---

## File Map

- Modify: `manifest.json`
  - 新增千问 host 权限和 content script
  - bump 版本号，确保 Chrome 重新加载 content scripts
- Modify: `background.js`
  - 扩展 provider host 路由与 `latestResponses` 默认结构，加入 `qianwen`
  - 同时覆盖入口域名与最终聊天页域名
- Modify: `sidepanel/panel.html`
  - normal mode 目标列表新增“千问”
  - mention 按钮新增 `@Qianwen`
  - discussion participant 列表新增“千问”
- Modify: `sidepanel/panel.js`
  - 轻量 provider registry 收敛
  - mention 解析、URL 识别、展示 label、target/participant 集合都纳入 `qianwen`
  - 千问文件上传显式标记为不支持，避免假成功
  - 若触及 shared polling/completion rule，保留 ChatGPT 长回复截断回归
- Create: `content/qianwen.js`
  - 千问网页端 DOM adapter：注入消息、检测发送、等待回复结束、提取最新回复、回传 `RESPONSE_CAPTURED`
  - 优先基于当前实测 DOM：`div[role="textbox"][contenteditable="true"]` + `button[aria-label="发送消息"]`
- Modify: `tests/panel-normal-mode.test.mjs`
  - 为 `@Qianwen`、`/cross` 解析、normal mode target 集合、文件上传显式失败补 failing tests
- Modify: `tests/panel-discussion.test.mjs`
  - 为 discussion participant 选择、badge 展示“千问”、2~3 人约束补 failing tests
- Modify: `tests/background-routing.test.mjs`
  - 为 `background.js` 的千问 host 路由和默认 storage 结构补最小测试
- Create: `tests/qianwen-capture.test.mjs`
  - 为 `content/qianwen.js` 的注入、发送、完整回复捕获、文件上传拒绝补 provider-level tests
- Modify: `README.md`
  - 在支持平台与使用说明中补“千问”

---

### Task 1: 先用面板测试锁定千问 provider 行为

**Files:**
- Modify: `tests/panel-normal-mode.test.mjs`
- Modify: `tests/panel-discussion.test.mjs`
- Test: `tests/panel-normal-mode.test.mjs`
- Test: `tests/panel-discussion.test.mjs`

- [ ] **Step 1: 在 `tests/panel-normal-mode.test.mjs` 暴露解析入口与 label helper**

把 injected export block 改成：

```js
const source = fs.readFileSync(PANEL_JS, 'utf8') + `
globalThis.__panelTest = {
  handleSend,
  handleCrossReference,
  handleMutualReview,
  log,
  parseMessage,
  getProviderLabel
};
`;
```

- [ ] **Step 2: 在 `tests/panel-normal-mode.test.mjs` 追加 `@Qianwen` 解析 failing tests**

在文件尾部追加：

```js
test('parseMessage accepts Qianwen mentions in direct cross-reference syntax', () => {
  const panel = loadPanel();

  const parsed = panel.api.parseMessage('@Qianwen 评价一下 @Claude');

  assert.equal(parsed.crossRef, true);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.targetAIs)), ['qianwen']);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.sourceAIs)), ['claude']);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.mentions)), ['qianwen', 'claude']);
});

test('parseMessage accepts Qianwen in explicit /cross routing', () => {
  const panel = loadPanel();

  const parsed = panel.api.parseMessage('/cross @Claude @Qianwen <- @ChatGPT 对比一下');

  assert.equal(parsed.crossRef, true);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.targetAIs)), ['claude', 'qianwen']);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.sourceAIs)), ['chatgpt']);
  assert.equal(parsed.originalMessage, '对比一下');
});
```

- [ ] **Step 3: 在 `tests/panel-normal-mode.test.mjs` 追加 normal send + 文件上传 gating failing tests**

继续追加：

```js
test('normal send includes qianwen when its checkbox is selected', async () => {
  const panel = loadPanel();

  panel.getElementById('message-input').value = '请给出你的判断';
  panel.getElementById('target-qianwen').checked = true;
  panel.getElementById('target-claude').checked = false;
  panel.getElementById('target-chatgpt').checked = false;
  panel.getElementById('target-gemini').checked = false;
  panel.getElementById('target-doubao').checked = false;

  await panel.api.handleSend();

  const sendMessages = panel.getSentMessages();

  assert.equal(sendMessages.length, 1);
  assert.equal(sendMessages[0].aiType, 'qianwen');
  assert.equal(sendMessages[0].message, '请给出你的判断');
});

test('getProviderLabel maps qianwen to 千问', () => {
  const panel = loadPanel();

  assert.equal(panel.api.getProviderLabel('qianwen'), '千问');
});
```

- [ ] **Step 4: 在 `tests/panel-discussion.test.mjs` 暴露 label helper 并写 discussion failing tests**

把 injected export block 改成：

```js
const source = fs.readFileSync(PANEL_JS, 'utf8') + `
globalThis.__panelTest = {
  getDiscussionState: () => discussionState,
  setDiscussionState: (value) => { discussionState = value; },
  getOnMessageListener: () => globalThis.__onMessageListener,
  validateParticipants,
  startDiscussion,
  nextRound,
  handleInterject,
  handleCrossReference,
  handleMutualReview,
  generateSummary,
  showSummary,
  getProviderLabel
};
`;
```

在文件尾部追加：

```js
test('discussion mode enables start for a qianwen-inclusive 3-person selection', () => {
  const panel = loadPanel();

  panel.setSelectedParticipants(['claude', 'chatgpt', 'qianwen']);
  panel.api.validateParticipants();

  assert.equal(panel.getElementById('start-discussion-btn').disabled, false);
});

test('discussion participant badge uses 千问 instead of qianwen', async () => {
  const panel = loadPanel();

  panel.setSelectedParticipants(['claude', 'qianwen']);
  panel.getElementById('discussion-topic').value = '千问参与讨论';

  await panel.api.startDiscussion();

  assert.match(panel.getElementById('participants-badge').textContent, /Claude/);
  assert.match(panel.getElementById('participants-badge').textContent, /千问/);
  assert.doesNotMatch(panel.getElementById('participants-badge').textContent, /qianwen/);
});
```

- [ ] **Step 5: 运行 panel 定向测试，确认先失败**

Run:

```bash
node --test "D:/Coding/ai-roundtable/tests/panel-normal-mode.test.mjs" "D:/Coding/ai-roundtable/tests/panel-discussion.test.mjs"
```

Expected: FAIL，失败点集中在当前 `sidepanel/panel.js` 还不认识 `qianwen`，UI 也还没有 `target-qianwen` / `@Qianwen` / discussion participant。

- [ ] **Step 6: 提交测试基线**

```bash
git add tests/panel-normal-mode.test.mjs tests/panel-discussion.test.mjs
git commit -m "test: lock panel behavior for qianwen provider"
```

---

### Task 2: 实现 panel provider registry、千问 UI 与显式 label 规则

**Files:**
- Modify: `sidepanel/panel.html`
- Modify: `sidepanel/panel.js`
- Test: `tests/panel-normal-mode.test.mjs`
- Test: `tests/panel-discussion.test.mjs`

- [ ] **Step 1: 在 `sidepanel/panel.html` 新增千问 target、mention 与 discussion participant**

在 normal mode target 区块追加：

```html
<label class="target-label">
  <input type="checkbox" id="target-qianwen">
  <span class="target-name">千问</span>
  <span class="status" id="status-qianwen"></span>
</label>
```

在 mention 按钮区块追加：

```html
<button class="mention-btn" data-mention="@Qianwen" title="引用千问">@Qianwen</button>
```

在 discussion participant 区块追加：

```html
<label class="participant-option">
  <input type="checkbox" name="participant" value="qianwen">
  <span class="target-name qianwen">千问</span>
</label>
```

- [ ] **Step 2: 在 `sidepanel/panel.js` 的 provider registry 中新增 `qianwen`**

把 `PROVIDERS` 扩成：

```js
const PROVIDERS = [
  {
    id: 'claude',
    label: 'Claude',
    hosts: ['claude.ai'],
    mention: '@Claude',
    supports: { normalSend: true, responseCapture: true, discussion: true, mutual: true, cross: true, fileUpload: true }
  },
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    hosts: ['chat.openai.com', 'chatgpt.com'],
    mention: '@ChatGPT',
    supports: { normalSend: true, responseCapture: true, discussion: true, mutual: true, cross: true, fileUpload: true }
  },
  {
    id: 'gemini',
    label: 'Gemini',
    hosts: ['gemini.google.com'],
    mention: '@Gemini',
    supports: { normalSend: true, responseCapture: true, discussion: true, mutual: true, cross: true, fileUpload: true }
  },
  {
    id: 'doubao',
    label: '豆包',
    hosts: ['www.doubao.com'],
    mention: '@Doubao',
    supports: { normalSend: true, responseCapture: true, discussion: true, mutual: true, cross: true, fileUpload: false }
  },
  {
    id: 'qianwen',
    label: '千问',
    hosts: ['www.qianwen.com'],
    mention: '@Qianwen',
    supports: { normalSend: true, responseCapture: true, discussion: true, mutual: true, cross: true, fileUpload: false }
  }
];

const AI_TYPES = PROVIDERS.map((provider) => provider.id);
const PROVIDER_IDS_PATTERN = PROVIDERS.map((provider) => provider.id).join('|');
```

- [ ] **Step 3: 收敛 label、URL 识别与 discussion 展示**

确保 `getProviderLabel()`、`connectedTabs`、discussion badge、waiting status 都从 provider registry 派生：

```js
function getProviderLabel(aiType) {
  return PROVIDERS.find((provider) => provider.id === aiType)?.label || capitalize(aiType);
}

const connectedTabs = Object.fromEntries(AI_TYPES.map((ai) => [ai, null]));
```

并把 `capitalize()` 扩成：

```js
function capitalize(str) {
  if (str === 'chatgpt') return 'ChatGPT';
  if (str === 'doubao') return '豆包';
  if (str === 'qianwen') return '千问';
  return str.charAt(0).toUpperCase() + str.slice(1);
}
```

- [ ] **Step 4: 保持 `parseMessage()` 支持 `@Qianwen` 与 `/cross`**

当前 `parseMessage()` 已经使用：

```js
const mentionPattern = new RegExp(`@(${PROVIDER_IDS_PATTERN})`, 'gi');
```

这里只需要确保 `PROVIDER_IDS_PATTERN` 扩容后无需再写 `qianwen` 特判。保留现有 direct cross-reference 和 `/cross` 两条路径不变。

- [ ] **Step 5: 保持文件上传显式失败，不让千问假成功**

保留 `handleSend()` 里的 capability gating 模式，只需让 `qianwen.supports.fileUpload = false` 进入同一逻辑：

```js
const fileCapableTargets = targets.filter((target) => {
  const provider = PROVIDERS.find((item) => item.id === target);
  return provider?.supports.fileUpload;
});
const skippedTargets = targets.filter((target) => !fileCapableTargets.includes(target));

skippedTargets.forEach((target) => {
  log(`${getProviderLabel(target)}: 暂不支持自动文件上传`, 'error');
});
```

- [ ] **Step 6: 运行 panel 定向测试，确认通过**

Run:

```bash
node --test "D:/Coding/ai-roundtable/tests/panel-normal-mode.test.mjs" "D:/Coding/ai-roundtable/tests/panel-discussion.test.mjs"
```

Expected: PASS，尤其要看到 `@Qianwen` parser、discussion badge “千问”、normal send target 三类测试都过。

- [ ] **Step 7: 提交 panel 实现**

```bash
git add sidepanel/panel.html sidepanel/panel.js tests/panel-normal-mode.test.mjs tests/panel-discussion.test.mjs
git commit -m "feat: add qianwen to sidepanel provider flows"
```

---

### Task 3: 先为 background host 路由和缓存结构补最小测试

**Files:**
- Modify: `tests/background-routing.test.mjs`
- Test: `tests/background-routing.test.mjs`

- [ ] **Step 1: 在 `tests/background-routing.test.mjs` 追加千问 host 路由测试**

在现有 Doubao 测试后追加：

```js
test('background maps Qianwen entry host to qianwen provider id', () => {
  const api = loadBackground();

  assert.equal(api.getAITypeFromUrl('https://www.qianwen.com/?ch=tongyi_redirect'), 'qianwen');
});
```

- [ ] **Step 2: 在 `tests/background-routing.test.mjs` 追加默认 storage 结构测试**

把默认对象断言改成：

```js
assert.deepEqual(JSON.parse(JSON.stringify(responses)), {
  claude: null,
  chatgpt: null,
  gemini: null,
  doubao: null,
  qianwen: null
});
```

- [ ] **Step 3: 保留 harness 路径读取规则，不回退到绝对路径**

确认文件继续使用：

```js
const source = fs.readFileSync(new URL('../background.js', import.meta.url), 'utf8') + `
globalThis.__backgroundTest = {
  getAITypeFromUrl,
  getStoredResponses,
  getResponseFromContentScript
};
`;
```

不要把这里改回硬编码路径。

- [ ] **Step 4: 运行 background 定向测试，确认先失败**

Run:

```bash
node --test "D:/Coding/ai-roundtable/tests/background-routing.test.mjs"
```

Expected: FAIL，因为当前 `background.js` 还不认识 `www.qianwen.com`，也没有 `qianwen: null` 默认槽位。

- [ ] **Step 5: 提交 background 测试基线**

```bash
git add tests/background-routing.test.mjs
git commit -m "test: cover qianwen background routing"
```

---

### Task 4: 实现 manifest + background 的千问路由闭环

**Files:**
- Modify: `manifest.json`
- Modify: `background.js`
- Test: `tests/background-routing.test.mjs`

- [ ] **Step 1: 在 `manifest.json` 新增千问 host 与 content script，并 bump 版本**

把 `host_permissions` 和 `content_scripts` 相关区块改成：

```json
{
  "manifest_version": 3,
  "name": "AI 圆桌 - Multi-AI Roundtable",
  "version": "0.1.17",
  "description": "让多个 AI 助手围桌讨论，交叉评价，深度协作",
  "permissions": [
    "sidePanel",
    "activeTab",
    "tabs",
    "scripting",
    "storage"
  ],
  "host_permissions": [
    "https://claude.ai/*",
    "https://chat.openai.com/*",
    "https://chatgpt.com/*",
    "https://gemini.google.com/*",
    "https://www.doubao.com/*",
    "https://www.qianwen.com/*"
  ],
  "content_scripts": [
    {
      "matches": ["https://claude.ai/*"],
      "js": ["content/claude.js"],
      "run_at": "document_idle"
    },
    {
      "matches": ["https://chat.openai.com/*", "https://chatgpt.com/*"],
      "js": ["content/chatgpt.js"],
      "run_at": "document_idle"
    },
    {
      "matches": ["https://gemini.google.com/*"],
      "js": ["content/gemini.js"],
      "run_at": "document_idle"
    },
    {
      "matches": ["https://www.doubao.com/*"],
      "js": ["content/doubao.js"],
      "run_at": "document_idle"
    },
    {
      "matches": ["https://www.qianwen.com/*"],
      "js": ["content/qianwen.js"],
      "run_at": "document_idle"
    }
  ]
}
```

- [ ] **Step 2: 在 `background.js` 扩展 `AI_URL_PATTERNS` 与默认 storage 结构**

把 provider host map 与默认对象改成：

```js
const AI_URL_PATTERNS = {
  claude: ['claude.ai'],
  chatgpt: ['chat.openai.com', 'chatgpt.com'],
  gemini: ['gemini.google.com'],
  doubao: ['www.doubao.com'],
  qianwen: ['www.qianwen.com']
};

async function getStoredResponses() {
  const result = await chrome.storage.session.get('latestResponses');
  return result.latestResponses || {
    claude: null,
    chatgpt: null,
    gemini: null,
    doubao: null,
    qianwen: null
  };
}
```

继续复用遍历式 `findAITab()` 与 `getAITypeFromUrl()`，不新增 `switch` 分支。

- [ ] **Step 3: 运行 background 测试，确认通过**

Run:

```bash
node --test "D:/Coding/ai-roundtable/tests/background-routing.test.mjs"
```

Expected: PASS，证明入口域名和默认 `latestResponses` 结构已经纳入 `qianwen`。

- [ ] **Step 4: 再跑一次 panel 测试，确认 provider 扩容没有打穿既有逻辑**

Run:

```bash
node --test "D:/Coding/ai-roundtable/tests/panel-normal-mode.test.mjs" "D:/Coding/ai-roundtable/tests/panel-discussion.test.mjs" "D:/Coding/ai-roundtable/tests/background-routing.test.mjs"
```

Expected: PASS。

- [ ] **Step 5: 提交 manifest/background 改造**

```bash
git add manifest.json background.js tests/background-routing.test.mjs
git commit -m "feat: route qianwen tabs through background"
```

---

### Task 5: 先为 Qianwen content script 写 provider-level failing tests

**Files:**
- Create: `tests/qianwen-capture.test.mjs`
- Test: `tests/qianwen-capture.test.mjs`

- [ ] **Step 1: 新建 `tests/qianwen-capture.test.mjs`，基于当前页面实测 selector 搭最小 DOM harness**

创建文件内容如下：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function createElement() {
  return {
    disabled: false,
    innerHTML: '',
    textContent: '',
    value: '',
    focused: false,
    clicked: false,
    focus() {
      this.focused = true;
    },
    click() {
      this.clicked = true;
    },
    addEventListener() {},
    dispatchEvent() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    closest() {
      return this;
    },
    matches() {
      return false;
    },
    getAttribute() {
      return null;
    }
  };
}

function loadQianwenContent(state) {
  const messages = [];
  const inputEvents = [];

  const inputEl = {
    tagName: 'DIV',
    innerHTML: '',
    textContent: '',
    focused: false,
    focus() {
      this.focused = true;
    },
    dispatchEvent(event) {
      inputEvents.push(event.type);
    },
    getAttribute(name) {
      if (name === 'role') return 'textbox';
      if (name === 'contenteditable') return 'true';
      return null;
    }
  };

  const sendButton = {
    disabled: false,
    clicked: false,
    click() {
      this.clicked = true;
    },
    closest() {
      return this;
    },
    getAttribute(name) {
      if (name === 'aria-label') return '发送消息';
      return null;
    }
  };

  const document = {
    readyState: 'complete',
    body: createElement(),
    addEventListener() {},
    createElement() {
      return { textContent: '', innerHTML: '' };
    },
    querySelector(selector) {
      if (selector === 'main' || selector === 'main, .semi-navigation, .semi-layout') return createElement();
      if (
        selector === 'div[role="textbox"][contenteditable="true"]' ||
        selector === '[role="textbox"][contenteditable="true"]' ||
        selector === 'div[contenteditable="true"]'
      ) {
        return inputEl;
      }
      if (
        selector === 'button[aria-label="发送消息"]' ||
        selector === 'button[aria-label*="发送"]' ||
        selector === 'button[type="submit"]'
      ) {
        return sendButton;
      }
      if (
        selector === 'button[aria-label*="停止"]' ||
        selector === 'button[aria-label*="Stop"]'
      ) {
        return state.isStreaming ? createElement() : null;
      }
      return null;
    },
    querySelectorAll(selector) {
      if (
        selector === '[data-testid="qianwen-assistant-message"]' ||
        selector === '.assistant-message' ||
        selector === '[data-role="assistant"]'
      ) {
        if (!state.currentContent) {
          return [];
        }
        return [{
          get innerText() {
            return state.currentContent;
          },
          get textContent() {
            return state.currentContent;
          },
          querySelector() {
            return null;
          }
        }];
      }
      return [];
    }
  };

  const chrome = {
    runtime: {
      id: 'test-extension',
      sendMessage(message, callback) {
        messages.push(message);
        callback?.({ success: true });
      },
      onMessage: {
        addListener() {}
      }
    }
  };

  class MutationObserver {
    constructor() {}
    observe() {}
    disconnect() {}
  }

  const context = vm.createContext({
    console,
    document,
    chrome,
    MutationObserver,
    Event: class Event {
      constructor(type, options = {}) {
        this.type = type;
        this.bubbles = options.bubbles;
      }
    },
    KeyboardEvent: class KeyboardEvent {
      constructor(type, options = {}) {
        this.type = type;
        Object.assign(this, options);
      }
    },
    Node: {
      ELEMENT_NODE: 1
    },
    window: {
      getComputedStyle() {
        return { display: 'block', visibility: 'visible', opacity: '1' };
      }
    },
    setTimeout(fn, ms = 0) {
      state.now += ms;
      state.tick += 1;
      if (state.tick === 2) {
        state.currentContent = state.partialContent;
      }
      if (state.tick === 6) {
        state.isStreaming = false;
        state.currentContent = state.fullContent;
      }
      fn();
      return state.tick;
    },
    clearTimeout() {},
    Date: {
      now: () => state.now
    },
    Promise,
    globalThis: null
  });
  context.globalThis = context;

  const source = fs.readFileSync('D:/Coding/ai-roundtable/content/qianwen.js', 'utf8').replace(
    /\s*console\.log\('\[AI Panel\] Qianwen content script loaded'\);\r?\n\}\)\(\);\s*$/,
    "\n  globalThis.__qianwenTest = { injectMessage, waitForStreamingComplete, getLatestResponse };\n  console.log('[AI Panel] Qianwen content script loaded');\n})();\n"
  );

  vm.runInContext(source, context);

  return {
    api: context.__qianwenTest,
    messages,
    inputEvents,
    inputEl,
    sendButton
  };
}
```

- [ ] **Step 2: 在同一文件中追加 failing tests**

继续在文件末尾追加：

```js
test('qianwen injectMessage fills the contenteditable input and clicks send', async () => {
  const state = {
    now: 0,
    tick: 0,
    isStreaming: false,
    currentContent: '',
    partialContent: '',
    fullContent: ''
  };

  const { api, inputEl, sendButton } = loadQianwenContent(state);

  await api.injectMessage('请用中文总结这个问题');

  assert.equal(inputEl.focused, true);
  assert.match(inputEl.innerHTML, /请用中文总结这个问题/);
  assert.equal(sendButton.clicked, true);
});

test('qianwen capture waits for the fuller response before emitting RESPONSE_CAPTURED', async () => {
  const state = {
    now: 0,
    tick: 0,
    isStreaming: true,
    currentContent: '',
    partialContent: '第一段观点',
    fullContent: '第一段观点\n\n第二段完整结论'
  };

  const { api, messages } = loadQianwenContent(state);

  await api.waitForStreamingComplete();

  const captures = messages.filter((message) => message.type === 'RESPONSE_CAPTURED');

  assert.equal(captures.length, 1);
  assert.equal(captures[0].aiType, 'qianwen');
  assert.equal(captures[0].content, '第一段观点\n\n第二段完整结论');
});
```

- [ ] **Step 3: 追加文件上传明确失败测试**

在 `tests/qianwen-capture.test.mjs` 末尾再加一条：

```js
test('qianwen content script rejects INJECT_FILES explicitly', async () => {
  const source = fs.readFileSync('D:/Coding/ai-roundtable/content/qianwen.js', 'utf8');

  assert.match(source, /INJECT_FILES/);
  assert.match(source, /千问暂不支持自动文件上传/);
});
```

- [ ] **Step 4: 运行 Qianwen content-script 测试，确认先失败**

Run:

```bash
node --test "D:/Coding/ai-roundtable/tests/qianwen-capture.test.mjs"
```

Expected: FAIL，因为 `content/qianwen.js` 还不存在。

- [ ] **Step 5: 提交 provider 测试基线**

```bash
git add tests/qianwen-capture.test.mjs
git commit -m "test: define qianwen content adapter behavior"
```

---

### Task 6: 实现 `content/qianwen.js` 并把回复捕获接入现有闭环

**Files:**
- Create: `content/qianwen.js`
- Test: `tests/qianwen-capture.test.mjs`

- [ ] **Step 1: 新建 `content/qianwen.js` 基础骨架，复用当前 provider 脚本模式**

创建文件并先放入这段完整骨架：

```js
// AI Panel - Qianwen Content Script

(function() {
  'use strict';

  const AI_TYPE = 'qianwen';

  function isContextValid() {
    return chrome.runtime && chrome.runtime.id;
  }

  function safeSendMessage(message, callback) {
    if (!isContextValid()) {
      console.log('[AI Panel] Extension context invalidated, skipping message');
      return;
    }
    try {
      chrome.runtime.sendMessage(message, callback);
    } catch (e) {
      console.log('[AI Panel] Failed to send message:', e.message);
    }
  }

  safeSendMessage({ type: 'CONTENT_SCRIPT_READY', aiType: AI_TYPE });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'INJECT_MESSAGE') {
      injectMessage(message.message)
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (message.type === 'INJECT_FILES') {
      sendResponse({ success: false, error: '千问暂不支持自动文件上传' });
      return true;
    }

    if (message.type === 'GET_LATEST_RESPONSE') {
      const content = getLatestResponse();
      const streamingActive = isStreamingActive();
      sendResponse({
        content,
        streamingActive,
        captureState: streamingActive ? 'streaming' : 'unknown'
      });
      return true;
    }
  });

  setupResponseObserver();
```

- [ ] **Step 2: 用当前实测 selector 实现输入框、发送按钮与 `injectMessage()`**

继续追加：

```js
  function findInput() {
    const selectors = [
      'div[role="textbox"][contenteditable="true"]',
      '[role="textbox"][contenteditable="true"]',
      'div[contenteditable="true"]'
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && isVisible(el)) {
        return el;
      }
    }
    return null;
  }

  function findSendButton() {
    const selectors = [
      'button[aria-label="发送消息"]',
      'button[aria-label*="发送"]',
      'button[type="submit"]'
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && isVisible(el) && !el.disabled) {
        return el.closest('button') || el;
      }
    }
    return null;
  }

  async function injectMessage(text) {
    const inputEl = findInput();
    if (!inputEl) {
      throw new Error('Could not find input field');
    }

    inputEl.focus();
    inputEl.innerHTML = `<p>${escapeHtml(text)}</p>`;
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    inputEl.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    inputEl.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

    await sleep(200);

    const sendButton = findSendButton();
    if (!sendButton) {
      throw new Error('Could not find send button');
    }

    sendButton.click();
    waitForStreamingComplete();
    return true;
  }
```

- [ ] **Step 3: 实现 observer、latest response 提取与双保险 completion 策略**

继续追加：

```js
  let lastCapturedContent = '';
  let isCapturing = false;

  function setupResponseObserver() {
    const observer = new MutationObserver((mutations) => {
      if (!isContextValid()) {
        observer.disconnect();
        return;
      }
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              checkForResponse(node);
            }
          }
        }
      }
    });

    const startObserving = () => {
      if (!isContextValid()) return;
      const mainContent = document.querySelector('main, .semi-navigation, .semi-layout') || document.body;
      observer.observe(mainContent, {
        childList: true,
        subtree: true
      });
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startObserving);
    } else {
      startObserving();
    }
  }

  function checkForResponse(node) {
    if (isCapturing) return;

    const isResponse =
      node.matches?.('[data-testid="qianwen-assistant-message"], .assistant-message, [data-role="assistant"]') ||
      node.querySelector?.('[data-testid="qianwen-assistant-message"], .assistant-message, [data-role="assistant"]');

    if (isResponse) {
      waitForStreamingComplete();
    }
  }

  function isStreamingActive() {
    return Boolean(
      document.querySelector('button[aria-label*="停止"]') ||
      document.querySelector('button[aria-label*="Stop"]')
    );
  }

  function getLatestResponse() {
    const selectors = [
      '[data-testid="qianwen-assistant-message"]',
      '.assistant-message',
      '[data-role="assistant"]'
    ];

    for (const selector of selectors) {
      const messages = Array.from(document.querySelectorAll(selector));
      for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        const content = (message.innerText || message.textContent || '').trim();
        if (content) {
          return content;
        }
      }
    }

    return null;
  }

  async function waitForStreamingComplete() {
    if (isCapturing) {
      return;
    }
    isCapturing = true;

    let previousContent = '';
    let stableCount = 0;
    let streamingSeen = false;
    let endedStableCount = 0;
    const maxWait = 600000;
    const checkInterval = 500;
    const stableThreshold = 4;
    const endAfterStreamingThreshold = 2;
    const startTime = Date.now();

    try {
      while (Date.now() - startTime < maxWait) {
        if (!isContextValid()) {
          return;
        }

        await sleep(checkInterval);

        const currentContent = getLatestResponse() || '';
        const streamingActive = isStreamingActive();
        if (streamingActive) {
          streamingSeen = true;
        }

        if (currentContent && currentContent === previousContent) {
          stableCount += 1;
        } else {
          stableCount = 0;
        }

        if (streamingSeen && !streamingActive && currentContent) {
          endedStableCount += currentContent === previousContent ? 1 : 0;
        } else {
          endedStableCount = 0;
        }

        if (
          currentContent &&
          ((streamingSeen && endedStableCount >= endAfterStreamingThreshold) || stableCount >= stableThreshold)
        ) {
          if (currentContent !== lastCapturedContent) {
            lastCapturedContent = currentContent;
            safeSendMessage({
              type: 'RESPONSE_CAPTURED',
              aiType: AI_TYPE,
              content: currentContent
            });
          }
          return;
        }

        previousContent = currentContent;
      }
    } finally {
      isCapturing = false;
    }
  }
```

- [ ] **Step 4: 补 utility functions，运行 provider 测试确认通过**

在文件末尾补齐 utility 并闭合 IIFE：

```js
  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  console.log('[AI Panel] Qianwen content script loaded');
})();
```

Run:

```bash
node --test "D:/Coding/ai-roundtable/tests/qianwen-capture.test.mjs"
```

Expected: PASS。

- [ ] **Step 5: 提交 Qianwen adapter 实现**

```bash
git add content/qianwen.js tests/qianwen-capture.test.mjs
git commit -m "feat: add qianwen web content adapter"
```

---

### Task 7: 全量回归 panel/background/provider，并保护 ChatGPT 长回复截断回归

**Files:**
- Test: `tests/panel-normal-mode.test.mjs`
- Test: `tests/panel-discussion.test.mjs`
- Test: `tests/background-routing.test.mjs`
- Test: `tests/chatgpt-capture.test.mjs`
- Test: `tests/qianwen-capture.test.mjs`

- [ ] **Step 1: 运行千问相关自动化测试集合**

Run:

```bash
node --test \
  "D:/Coding/ai-roundtable/tests/panel-normal-mode.test.mjs" \
  "D:/Coding/ai-roundtable/tests/panel-discussion.test.mjs" \
  "D:/Coding/ai-roundtable/tests/background-routing.test.mjs" \
  "D:/Coding/ai-roundtable/tests/qianwen-capture.test.mjs"
```

Expected: 全部 PASS。

- [ ] **Step 2: 若改动触及 shared polling/completion rule，同步跑 ChatGPT 长回复截断回归**

Run:

```bash
node --test "D:/Coding/ai-roundtable/tests/chatgpt-capture.test.mjs"
node --test "D:/Coding/ai-roundtable/tests/panel-normal-mode.test.mjs"
node --test "D:/Coding/ai-roundtable/tests/panel-discussion.test.mjs"
```

Expected:
- `chatgpt capture does not lock a truncated long reply when streaming stops before the tail arrives` 继续 PASS
- `normal mode keeps ChatGPT pending when a truncated long reply is still unknown and only accepts the fuller tail later` 继续 PASS
- `discussion mode keeps ChatGPT pending when a truncated long reply is still unknown and only completes after the fuller tail arrives` 继续 PASS
- `discussion mode does not complete a round when ChatGPT completion readiness is unknown` 继续 PASS

- [ ] **Step 3: 汇总自动化测试输出证据**

Run:

```bash
node --test \
  "D:/Coding/ai-roundtable/tests/panel-normal-mode.test.mjs" \
  "D:/Coding/ai-roundtable/tests/panel-discussion.test.mjs" \
  "D:/Coding/ai-roundtable/tests/background-routing.test.mjs" \
  "D:/Coding/ai-roundtable/tests/chatgpt-capture.test.mjs" \
  "D:/Coding/ai-roundtable/tests/qianwen-capture.test.mjs"
```

Expected: `# pass` 为正数，`# fail 0`，退出码为 0。

- [ ] **Step 4: 提交回归验证闭环**

```bash
git add tests/panel-normal-mode.test.mjs tests/panel-discussion.test.mjs tests/background-routing.test.mjs tests/chatgpt-capture.test.mjs tests/qianwen-capture.test.mjs content/qianwen.js sidepanel/panel.js background.js manifest.json sidepanel/panel.html
git commit -m "test: cover qianwen integration regressions"
```

---

### Task 8: 更新 README 并在真实 Chrome 宿主完成手工验证

**Files:**
- Modify: `README.md`
- Test: manual Chrome verification

- [ ] **Step 1: 在 `README.md` 的平台列表、核心特性、准备工作中补千问**

把开头说明改成：

```md
一个 Chrome 扩展，让你像"会议主持人"一样，同时操控多个 AI（Claude、ChatGPT、Gemini、豆包、千问），实现真正的 AI 圆桌会议。
```

把“核心特性”中的 discussion 描述改成：

```md
- **讨论模式** - 2~3 个 AI 就同一主题进行多轮深度讨论，可从 Claude / ChatGPT / Gemini / 豆包 / 千问中选择参与者
```

把“准备工作”平台列表补成：

```md
1. 打开 Chrome，登录以下 AI 平台（根据需要）：
   - [Claude](https://claude.ai)
   - [ChatGPT](https://chatgpt.com)
   - [Gemini](https://gemini.google.com)
   - [豆包](https://www.doubao.com/chat/)
   - [千问](https://www.qianwen.com/?ch=tongyi_redirect)
```

把“普通模式”目标说明改成：

```md
1. 勾选要发送的目标 AI（Claude / ChatGPT / Gemini / 豆包 / 千问）
```

- [ ] **Step 2: 在真实 Chrome 扩展宿主里做手工回归**

按这个顺序执行：

```text
1. 打开 chrome://extensions/
2. 点击当前扩展的 Reload
3. 刷新已打开的 Claude / ChatGPT / Gemini / 豆包 / 千问页面
4. 打开 side panel，确认“千问”状态点出现
5. 只勾选“千问”，发送普通消息
6. 勾选 Claude + 千问，验证 mixed send
7. 在 Claude / ChatGPT / 千问中完成一轮普通问答后执行 /mutual
8. 执行 /cross @Qianwen <- @Claude @Gemini 对比一下
9. 执行 /cross @Claude @Qianwen <- @ChatGPT 评价一下
10. 用 Claude + 千问 启动 discussion
11. 用 Claude + ChatGPT + 千问 启动 discussion
12. 给千问发送文件，确认出现“暂不支持自动文件上传”而不是假成功
13. 给千问一个长回复题目，确认 capture 最终包含完整尾段而不是半句截断
```

Expected: normal send、`/mutual`、`/cross`、discussion 都可走通；文件上传显式失败；长回复 capture 不截断。

- [ ] **Step 3: 再跑一次 git 状态与 diff 汇总**

Run:

```bash
git status --short
git diff --stat
```

Expected: 只出现本计划涉及的文件，没有意外文件。

- [ ] **Step 4: 提交 README 与最终闭环验证**

```bash
git add README.md
git commit -m "docs: add qianwen support to usage guide"
```

---

## Self-Review Checklist

### Spec coverage

- provider 元数据轻量扩容：Task 2
- `manifest.json` host + content script + version bump：Task 4
- `background.js` Qianwen routing + storage slot：Task 4
- `sidepanel/panel.html` target / mention / participant 显示“千问”：Task 2
- `sidepanel/panel.js` provider parsing、discussion label、file upload 明确失败：Task 2
- `content/qianwen.js` 注入、发送、完整回复捕获：Task 6
- panel regression coverage：Task 1
- background regression coverage：Task 3
- Qianwen adapter regression coverage：Task 5
- ChatGPT 长回复截断回归保护：Task 7
- README operator guidance：Task 8
- 手工验证闭环：Task 8

### Placeholder scan

- 无 `TODO` / `TBD`
- 每个任务都给了精确文件路径
- 每个代码步骤都给了实际代码块
- 每个测试步骤都给了精确命令与预期结果
- 每个任务都包含 commit step，符合 frequent commits 要求

### Type and naming consistency

- internal provider id 始终使用 `qianwen`
- UI label 始终使用 `千问`
- mention token 始终使用 `@Qianwen`
- panel / background / content script / tests 的 `aiType` 命名一致
- `getProviderLabel()`、`getAITypeFromUrl()`、`latestResponses.qianwen`、`content/qianwen.js` 在所有任务中保持一致

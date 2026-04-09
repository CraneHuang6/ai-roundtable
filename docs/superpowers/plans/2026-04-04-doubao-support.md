# 豆包网页端支持 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Chrome 扩展新增豆包网页端支持，使豆包可进入现有 normal send、`/mutual`、`/cross`、discussion 的发送/捕获/缓存闭环。

**Architecture:** 保持现有三层结构不变：`sidepanel/panel.js` 负责编排，`background.js` 负责 tab 路由和最新回复缓存，`content/doubao.js` 负责豆包网页 DOM 注入与回复捕获。本次只做轻量 provider 元数据收敛：内部统一使用 `doubao`，面板 UI 统一显示“豆包”，不引入新的运行时层级。

**Tech Stack:** Chrome Extension Manifest V3、vanilla JavaScript、Node built-in test runner (`node --test`)、VM-based panel/content-script tests、Chrome side panel UI

---

## File Map

- Modify: `manifest.json`
  - 新增 Doubao host 权限和 content script
  - bump 版本号，确保 Chrome 重新加载 content scripts
- Modify: `background.js`
  - 扩展 provider host 路由与 `latestResponses` 默认结构，加入 `doubao`
- Modify: `sidepanel/panel.html`
  - normal mode 目标列表新增“豆包”
  - mention 按钮新增 `@Doubao`
  - discussion participant 列表新增“豆包”
- Modify: `sidepanel/panel.js`
  - 轻量 provider registry 收敛
  - mention 解析、URL 识别、展示 label、target/participant 集合都纳入 `doubao`
  - 豆包文件上传显式标记为不支持，避免假成功
- Create: `content/doubao.js`
  - 豆包网页端 DOM adapter：注入消息、检测发送、等待回复结束、提取最新回复、回传 `RESPONSE_CAPTURED`
- Modify: `tests/panel-normal-mode.test.mjs`
  - 为 `@Doubao`、`/cross` 解析、normal mode target 集合补 failing tests
- Modify: `tests/panel-discussion.test.mjs`
  - 为 discussion participant 选择、badge 展示“豆包”、2~3 人约束补 failing tests
- Create: `tests/background-routing.test.mjs`
  - 为 `background.js` 的 Doubao host 路由和默认 storage 结构补最小测试
- Create: `tests/doubao-capture.test.mjs`
  - 为 `content/doubao.js` 的注入、发送、完整回复捕获补 provider-level tests
- Modify: `README.md`
  - 在支持平台与使用说明中补“豆包”

---

### Task 1: 先用面板测试锁定豆包 provider 行为

**Files:**
- Modify: `tests/panel-normal-mode.test.mjs`
- Modify: `tests/panel-discussion.test.mjs`
- Test: `tests/panel-normal-mode.test.mjs`
- Test: `tests/panel-discussion.test.mjs`

- [ ] **Step 1: 在 `tests/panel-normal-mode.test.mjs` 暴露解析入口并写出豆包 failing tests**

在 injected export block 中追加 `parseMessage` 与 `getProviderLabel`，这样测试可以直接校验 parser 和 UI label 规则：

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

在文件尾部追加下面两个测试：

```js
test('parseMessage accepts Doubao mentions in direct cross-reference syntax', () => {
  const panel = loadPanel();

  const parsed = panel.api.parseMessage('@Doubao 评价一下 @Claude');

  assert.equal(parsed.crossRef, true);
  assert.deepEqual(parsed.targetAIs, ['doubao']);
  assert.deepEqual(parsed.sourceAIs, ['claude']);
  assert.deepEqual(parsed.mentions, ['doubao', 'claude']);
});

test('parseMessage accepts Doubao in explicit /cross routing', () => {
  const panel = loadPanel();

  const parsed = panel.api.parseMessage('/cross @Claude @Doubao <- @ChatGPT 对比一下');

  assert.equal(parsed.crossRef, true);
  assert.deepEqual(parsed.targetAIs, ['claude', 'doubao']);
  assert.deepEqual(parsed.sourceAIs, ['chatgpt']);
  assert.equal(parsed.originalMessage, '对比一下');
});
```

- [ ] **Step 2: 在 `tests/panel-normal-mode.test.mjs` 写 normal mode 豆包 target failing test**

追加这个测试，确认 normal send 会把 `doubao` 当成普通 target 发送：

```js
test('normal send includes doubao when its checkbox is selected', async () => {
  const panel = loadPanel();

  panel.getElementById('message-input').value = '请给出你的判断';
  panel.getElementById('target-doubao').checked = true;
  panel.getElementById('target-claude').checked = false;
  panel.getElementById('target-chatgpt').checked = false;
  panel.getElementById('target-gemini').checked = false;

  await panel.api.handleSend();

  const sendMessages = panel.getSentMessages();

  assert.equal(sendMessages.length, 1);
  assert.equal(sendMessages[0].aiType, 'doubao');
  assert.equal(sendMessages[0].message, '请给出你的判断');
});
```

- [ ] **Step 3: 在 `tests/panel-discussion.test.mjs` 暴露 label helper 并写 discussion 豆包 failing tests**

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

追加这两个测试：

```js
test('discussion mode enables start for a doubao-inclusive 3-person selection', () => {
  const panel = loadPanel();

  panel.setSelectedParticipants(['claude', 'chatgpt', 'doubao']);
  panel.api.validateParticipants();

  assert.equal(panel.getElementById('start-discussion-btn').disabled, false);
});

test('discussion participant badge uses 豆包 instead of doubao', async () => {
  const panel = loadPanel();

  panel.setSelectedParticipants(['claude', 'doubao']);
  panel.getElementById('discussion-topic').value = '豆包参与讨论';

  await panel.api.startDiscussion();

  assert.match(panel.getElementById('participants-badge').textContent, /Claude/);
  assert.match(panel.getElementById('participants-badge').textContent, /豆包/);
  assert.doesNotMatch(panel.getElementById('participants-badge').textContent, /doubao/);
});
```

- [ ] **Step 4: 运行 panel 定向测试，确认它们先失败**

Run:

```bash
node --test "D:/Coding/ai-roundtable/tests/panel-normal-mode.test.mjs" "D:/Coding/ai-roundtable/tests/panel-discussion.test.mjs"
```

Expected: FAIL，失败点应集中在当前 `sidepanel/panel.js` 只接受 `claude|chatgpt|gemini`，并且还没有 `getProviderLabel()` 或 `target-doubao` 对应逻辑。

- [ ] **Step 5: 提交测试基线**

```bash
git add tests/panel-normal-mode.test.mjs tests/panel-discussion.test.mjs
git commit -m "test: lock panel behavior for doubao provider"
```

---

### Task 2: 实现 panel provider registry、豆包 UI 与显式 label 规则

**Files:**
- Modify: `sidepanel/panel.html`
- Modify: `sidepanel/panel.js`
- Test: `tests/panel-normal-mode.test.mjs`
- Test: `tests/panel-discussion.test.mjs`

- [ ] **Step 1: 在 `sidepanel/panel.html` 新增豆包 target、mention 与 discussion participant**

把 normal mode target 区块改成四个 provider，新增“豆包”：

```html
<section class="targets">
  <label class="target-label">
    <input type="checkbox" id="target-claude" checked>
    <span class="target-name">Claude</span>
    <span class="status" id="status-claude"></span>
  </label>
  <label class="target-label">
    <input type="checkbox" id="target-chatgpt" checked>
    <span class="target-name">ChatGPT</span>
    <span class="status" id="status-chatgpt"></span>
  </label>
  <label class="target-label">
    <input type="checkbox" id="target-gemini" checked>
    <span class="target-name">Gemini</span>
    <span class="status" id="status-gemini"></span>
  </label>
  <label class="target-label">
    <input type="checkbox" id="target-doubao">
    <span class="target-name">豆包</span>
    <span class="status" id="status-doubao"></span>
  </label>
</section>
```

把 mention 按钮区块扩成四个按钮：

```html
<div class="toolbar-group mentions">
  <button class="mention-btn" data-mention="@Claude" title="引用 Claude">@Claude</button>
  <button class="mention-btn" data-mention="@ChatGPT" title="引用 ChatGPT">@ChatGPT</button>
  <button class="mention-btn" data-mention="@Gemini" title="引用 Gemini">@Gemini</button>
  <button class="mention-btn" data-mention="@Doubao" title="引用豆包">@Doubao</button>
</div>
```

把 discussion participant 区块补成四选二到三：

```html
<div class="participant-options">
  <label class="participant-option">
    <input type="checkbox" name="participant" value="claude" checked>
    <span class="target-name claude">Claude</span>
  </label>
  <label class="participant-option">
    <input type="checkbox" name="participant" value="chatgpt" checked>
    <span class="target-name chatgpt">ChatGPT</span>
  </label>
  <label class="participant-option">
    <input type="checkbox" name="participant" value="gemini">
    <span class="target-name gemini">Gemini</span>
  </label>
  <label class="participant-option">
    <input type="checkbox" name="participant" value="doubao">
    <span class="target-name doubao">豆包</span>
  </label>
</div>
```

- [ ] **Step 2: 在 `sidepanel/panel.js` 收敛 provider 元数据与 label helper**

用一个轻量 registry 替换散落的 provider 列表：

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
  }
];

const AI_TYPES = PROVIDERS.map((provider) => provider.id);
const PROVIDER_IDS_PATTERN = PROVIDERS.map((provider) => provider.id).join('|');

function getProviderLabel(aiType) {
  return PROVIDERS.find((provider) => provider.id === aiType)?.label || capitalize(aiType);
}
```

把 `connectedTabs` 初始化改成由 provider 列表派生：

```js
const connectedTabs = Object.fromEntries(AI_TYPES.map((ai) => [ai, null]));
```

- [ ] **Step 3: 用 provider registry 改掉 URL 识别、mention regex、badge 展示与文件上传过滤**

把 URL 识别与 mention regex 改成 provider-driven：

```js
function getAITypeFromUrl(url) {
  if (!url) return null;
  for (const provider of PROVIDERS) {
    if (provider.hosts.some((host) => url.includes(host))) {
      return provider.id;
    }
  }
  return null;
}

function createMentionPattern() {
  return new RegExp(`@(${PROVIDER_IDS_PATTERN})`, 'gi');
}
```

在 `parseMessage()` 里把原来的硬编码 regex 改成：

```js
const mentionPattern = createMentionPattern();
```

把 discussion badge 和等待文案统一走 `getProviderLabel()`：

```js
document.getElementById('participants-badge').textContent =
  selected.map(getProviderLabel).join(' · ');

updateDiscussionStatus('waiting', `等待 ${selected.map(getProviderLabel).join('、')} 的初始回复...`);
```

把 `capitalize()` 特判扩成支持豆包：

```js
function capitalize(str) {
  if (str === 'chatgpt') return 'ChatGPT';
  if (str === 'doubao') return '豆包';
  return str.charAt(0).toUpperCase() + str.slice(1);
}
```

在 `handleSend()` 里显式过滤不支持文件上传的 provider，避免豆包假成功：

```js
const filesToSend = [...selectedFiles];
if (filesToSend.length > 0) {
  const fileCapableTargets = targets.filter((target) => {
    const provider = PROVIDERS.find((item) => item.id === target);
    return provider?.supports.fileUpload;
  });
  const skippedTargets = targets.filter((target) => !fileCapableTargets.includes(target));

  skippedTargets.forEach((target) => {
    log(`${getProviderLabel(target)}: 暂不支持自动文件上传`, 'error');
  });

  if (fileCapableTargets.length > 0) {
    log(`正在上传 ${filesToSend.length} 个文件...`);
    for (const target of fileCapableTargets) {
      await sendFilesToAI(target, filesToSend);
    }
  }

  clearFiles();
  await new Promise(r => setTimeout(r, 500));
}
```

- [ ] **Step 4: 运行 panel 定向测试，确认通过**

Run:

```bash
node --test "D:/Coding/ai-roundtable/tests/panel-normal-mode.test.mjs" "D:/Coding/ai-roundtable/tests/panel-discussion.test.mjs"
```

Expected: PASS，尤其要看到 Doubao parser、discussion badge “豆包”、normal send target 三类测试都过。

- [ ] **Step 5: 提交 panel 实现**

```bash
git add sidepanel/panel.html sidepanel/panel.js tests/panel-normal-mode.test.mjs tests/panel-discussion.test.mjs
git commit -m "feat: add doubao to sidepanel provider flows"
```

---

### Task 3: 先为 background host 路由和缓存结构补最小测试

**Files:**
- Create: `tests/background-routing.test.mjs`
- Test: `tests/background-routing.test.mjs`

- [ ] **Step 1: 新建 `tests/background-routing.test.mjs`，把 `background.js` 的可测入口挂到 `globalThis`**

创建文件内容如下：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function loadBackground(sessionState = {}) {
  const listeners = {
    onClicked: null,
    onUpdated: null,
    onRemoved: null,
    onMessage: null
  };

  const chrome = {
    storage: {
      session: {
        async get(key) {
          return { [key]: sessionState[key] };
        },
        async set(value) {
          Object.assign(sessionState, value);
        }
      }
    },
    action: {
      onClicked: {
        addListener(listener) {
          listeners.onClicked = listener;
        }
      }
    },
    sidePanel: {
      open() {},
      setPanelBehavior() {}
    },
    runtime: {
      onMessage: {
        addListener(listener) {
          listeners.onMessage = listener;
        }
      },
      async sendMessage() {}
    },
    tabs: {
      onUpdated: {
        addListener(listener) {
          listeners.onUpdated = listener;
        }
      },
      onRemoved: {
        addListener(listener) {
          listeners.onRemoved = listener;
        }
      },
      async query() {
        return [];
      },
      async sendMessage() {
        return { success: true };
      }
    }
  };

  const context = vm.createContext({
    console,
    chrome,
    Promise,
    Object,
    Array,
    Map,
    Set,
    String,
    Number,
    Boolean,
    RegExp,
    JSON,
    globalThis: null
  });
  context.globalThis = context;

  const source = fs.readFileSync('D:/Coding/ai-roundtable/background.js', 'utf8') + `
  globalThis.__backgroundTest = {
    getAITypeFromUrl,
    getStoredResponses
  };
  `;

  vm.runInContext(source, context);
  return context.__backgroundTest;
}

test('background maps Doubao host to doubao provider id', () => {
  const api = loadBackground();

  assert.equal(api.getAITypeFromUrl('https://www.doubao.com/chat/123'), 'doubao');
});

test('background stored response defaults include doubao slot', async () => {
  const api = loadBackground();

  const responses = await api.getStoredResponses();

  assert.deepEqual(responses, {
    claude: null,
    chatgpt: null,
    gemini: null,
    doubao: null
  });
});
```

- [ ] **Step 2: 运行 background 定向测试，确认先失败**

Run:

```bash
node --test "D:/Coding/ai-roundtable/tests/background-routing.test.mjs"
```

Expected: FAIL，因为当前 `background.js` 还不认识 `www.doubao.com`，也没有 `doubao: null` 默认槽位。

- [ ] **Step 3: 提交 background 测试基线**

```bash
git add tests/background-routing.test.mjs
git commit -m "test: cover doubao background routing"
```

---

### Task 4: 实现 manifest + background 的豆包路由闭环

**Files:**
- Modify: `manifest.json`
- Modify: `background.js`
- Test: `tests/background-routing.test.mjs`

- [ ] **Step 1: 在 `manifest.json` 新增 Doubao host 与 content script，并 bump 版本**

把版本和权限区块改成：

```json
{
  "manifest_version": 3,
  "name": "AI 圆桌 - Multi-AI Roundtable",
  "version": "0.1.11",
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
    "https://www.doubao.com/*"
  ],
  "side_panel": {
    "default_path": "sidepanel/panel.html"
  },
  "background": {
    "service_worker": "background.js"
  },
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
    }
  ]
}
```

- [ ] **Step 2: 在 `background.js` 扩展 `AI_URL_PATTERNS` 与默认 storage 结构**

把 provider 和默认 response 结构改成：

```js
const AI_URL_PATTERNS = {
  claude: ['claude.ai'],
  chatgpt: ['chat.openai.com', 'chatgpt.com'],
  gemini: ['gemini.google.com'],
  doubao: ['www.doubao.com']
};

async function getStoredResponses() {
  const result = await chrome.storage.session.get('latestResponses');
  return result.latestResponses || {
    claude: null,
    chatgpt: null,
    gemini: null,
    doubao: null
  };
}
```

其余 `findAITab()` 与 `getAITypeFromUrl()` 不需要新增分支，只要继续遍历 `AI_URL_PATTERNS` 即可自动支持 Doubao。

- [ ] **Step 3: 运行 background 测试，确认通过**

Run:

```bash
node --test "D:/Coding/ai-roundtable/tests/background-routing.test.mjs"
```

Expected: PASS，证明 host 路由和默认 `latestResponses` 结构已经纳入 `doubao`。

- [ ] **Step 4: 再跑一次 panel 测试，确认 provider 扩容没有打穿既有逻辑**

Run:

```bash
node --test "D:/Coding/ai-roundtable/tests/panel-normal-mode.test.mjs" "D:/Coding/ai-roundtable/tests/panel-discussion.test.mjs" "D:/Coding/ai-roundtable/tests/background-routing.test.mjs"
```

Expected: PASS。

- [ ] **Step 5: 提交 manifest/background 改造**

```bash
git add manifest.json background.js tests/background-routing.test.mjs
git commit -m "feat: route doubao tabs through background"
```

---

### Task 5: 先为 Doubao content script 写 provider-level failing tests

**Files:**
- Create: `tests/doubao-capture.test.mjs`
- Test: `tests/doubao-capture.test.mjs`

- [ ] **Step 1: 新建 `tests/doubao-capture.test.mjs`，搭一个最小 Doubao DOM harness**

创建文件，内容如下：

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
    getBoundingClientRect() {
      return { bottom: 0 };
    },
    getAttribute() {
      return null;
    }
  };
}

function loadDoubaoContent(state) {
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
      if (name === 'aria-label') return '发送';
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
        selector === 'div[contenteditable="true"]' ||
        selector === '[role="textbox"][contenteditable="true"]' ||
        selector === 'textarea'
      ) {
        return inputEl;
      }
      if (
        selector === 'button[aria-label*="发送"]' ||
        selector === 'button[aria-label*="Send"]' ||
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
        selector === '[data-testid="doubao-assistant-message"]' ||
        selector === '.assistant-message' ||
        selector === '[data-role="assistant"]'
      ) {
        if (!state.currentContent) {
          return [];
        }
        return [{
          get innerText() {
            return state.currentContent;
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
      innerHeight: 1000,
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

  const source = fs.readFileSync('D:/Coding/ai-roundtable/content/doubao.js', 'utf8').replace(
    /\s*console\.log\('\[AI Panel\] Doubao content script loaded'\);\r?\n\}\)\(\);\s*$/,
    "\n  globalThis.__doubaoTest = { injectMessage, waitForStreamingComplete, getLatestResponse };\n  console.log('[AI Panel] Doubao content script loaded');\n})();\n"
  );

  vm.runInContext(source, context);

  return {
    api: context.__doubaoTest,
    messages,
    inputEvents,
    inputEl,
    sendButton
  };
}
```

- [ ] **Step 2: 在同一文件中追加两条 failing tests**

继续在 `tests/doubao-capture.test.mjs` 末尾追加：

```js
test('doubao injectMessage fills the input and clicks send', async () => {
  const state = {
    now: 0,
    tick: 0,
    isStreaming: false,
    currentContent: '',
    partialContent: '',
    fullContent: ''
  };

  const { api, inputEl, sendButton } = loadDoubaoContent(state);

  await api.injectMessage('请用中文总结这个问题');

  assert.equal(inputEl.focused, true);
  assert.match(inputEl.innerHTML, /请用中文总结这个问题/);
  assert.equal(sendButton.clicked, true);
});

test('doubao capture waits for the fuller response before emitting RESPONSE_CAPTURED', async () => {
  const state = {
    now: 0,
    tick: 0,
    isStreaming: true,
    currentContent: '',
    partialContent: '第一段观点',
    fullContent: '第一段观点\n\n第二段完整结论'
  };

  const { api, messages } = loadDoubaoContent(state);

  await api.waitForStreamingComplete();

  const captures = messages.filter((message) => message.type === 'RESPONSE_CAPTURED');

  assert.equal(captures.length, 1);
  assert.equal(captures[0].aiType, 'doubao');
  assert.equal(captures[0].content, '第一段观点\n\n第二段完整结论');
});
```

- [ ] **Step 3: 运行 Doubao content-script 测试，确认先失败**

Run:

```bash
node --test "D:/Coding/ai-roundtable/tests/doubao-capture.test.mjs"
```

Expected: FAIL，因为 `content/doubao.js` 还不存在。

- [ ] **Step 4: 提交 provider 测试基线**

```bash
git add tests/doubao-capture.test.mjs
git commit -m "test: define doubao content adapter behavior"
```

---

### Task 6: 实现 `content/doubao.js` 并把回复捕获接入现有闭环

**Files:**
- Create: `content/doubao.js`
- Test: `tests/doubao-capture.test.mjs`

- [ ] **Step 1: 新建 `content/doubao.js` 基础骨架，复用现有 provider 脚本模式**

创建文件并先放入这段完整骨架：

```js
// AI Panel - Doubao Content Script

(function() {
  'use strict';

  const AI_TYPE = 'doubao';

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
      sendResponse({ success: false, error: '豆包暂不支持自动文件上传' });
      return true;
    }

    if (message.type === 'GET_LATEST_RESPONSE') {
      sendResponse({ content: getLatestResponse() });
      return true;
    }
  });

  setupResponseObserver();
```

- [ ] **Step 2: 实现输入框查找、发送按钮查找与 `injectMessage()`**

在同一文件中追加以下实现：

```js
  function findInput() {
    const selectors = [
      '[role="textbox"][contenteditable="true"]',
      'div[contenteditable="true"]',
      'textarea'
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
      'button[aria-label*="发送"]',
      'button[aria-label*="Send"]',
      'button[type="submit"]'
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && isVisible(el)) {
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

    if (inputEl.tagName === 'TEXTAREA') {
      inputEl.value = text;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      inputEl.innerHTML = `<p>${escapeHtml(text)}</p>`;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      inputEl.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
      inputEl.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    }

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

- [ ] **Step 3: 实现 observer、latest response 提取与“双重保险”捕获逻辑**

继续追加这段实现：

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
      node.matches?.('[data-testid="doubao-assistant-message"], .assistant-message, [data-role="assistant"]') ||
      node.querySelector?.('[data-testid="doubao-assistant-message"], .assistant-message, [data-role="assistant"]');

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
      '[data-testid="doubao-assistant-message"]',
      '.assistant-message',
      '[data-role="assistant"]'
    ];

    for (const selector of selectors) {
      const messages = document.querySelectorAll(selector);
      if (messages.length > 0) {
        const lastMessage = messages[messages.length - 1];
        const content = lastMessage.innerText?.trim() || '';
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
    const maxWait = 600000;
    const checkInterval = 500;
    const stableThreshold = 4;
    const endAfterStreamingThreshold = 2;
    let endedStableCount = 0;
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
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  console.log('[AI Panel] Doubao content script loaded');
})();
```

Run:

```bash
node --test "D:/Coding/ai-roundtable/tests/doubao-capture.test.mjs"
```

Expected: PASS。

- [ ] **Step 5: 提交 Doubao adapter 实现**

```bash
git add content/doubao.js tests/doubao-capture.test.mjs
git commit -m "feat: add doubao web content adapter"
```

---

### Task 7: 把 README 与全量测试、手工验证闭环补齐

**Files:**
- Modify: `README.md`
- Test: `tests/panel-normal-mode.test.mjs`
- Test: `tests/panel-discussion.test.mjs`
- Test: `tests/background-routing.test.mjs`
- Test: `tests/doubao-capture.test.mjs`

- [ ] **Step 1: 在 `README.md` 的平台列表、核心特性、准备工作中补豆包**

把开头说明和准备工作改成四平台版本。例如：

```md
一个 Chrome 扩展，让你像"会议主持人"一样，同时操控多个 AI（Claude、ChatGPT、Gemini、豆包），实现真正的 AI 圆桌会议。
```

把“核心特性”中的讨论模式说明改成：

```md
- **讨论模式** - 2~3 个 AI 就同一主题进行多轮深度讨论，可从 Claude / ChatGPT / Gemini / 豆包中选择参与者
```

把“准备工作”平台列表补成：

```md
1. 打开 Chrome，登录以下 AI 平台（根据需要）：
   - [Claude](https://claude.ai)
   - [ChatGPT](https://chatgpt.com)
   - [Gemini](https://gemini.google.com)
   - [豆包](https://www.doubao.com/chat/)
```

- [ ] **Step 2: 跑完整自动化测试集合**

Run:

```bash
node --test \
  "D:/Coding/ai-roundtable/tests/panel-normal-mode.test.mjs" \
  "D:/Coding/ai-roundtable/tests/panel-discussion.test.mjs" \
  "D:/Coding/ai-roundtable/tests/background-routing.test.mjs" \
  "D:/Coding/ai-roundtable/tests/chatgpt-capture.test.mjs" \
  "D:/Coding/ai-roundtable/tests/chatgpt-response-extraction.test.mjs" \
  "D:/Coding/ai-roundtable/tests/gemini-capture.test.mjs" \
  "D:/Coding/ai-roundtable/tests/doubao-capture.test.mjs"
```

Expected: 全部 PASS。

- [ ] **Step 3: 在真实 Chrome 扩展宿主里做手工回归**

Run the manual flow exactly in this order:

```text
1. 打开 chrome://extensions/
2. 点击当前扩展的 Reload
3. 刷新已打开的 Claude / ChatGPT / Gemini / 豆包页面
4. 打开 side panel，确认“豆包”状态点出现
5. 只勾选“豆包”，发送普通消息
6. 勾选 Claude + 豆包，验证混合发送
7. 在 Claude / ChatGPT / 豆包中完成一轮普通问答后执行 /mutual
8. 执行 /cross @Doubao <- @Claude @Gemini 对比一下
9. 执行 /cross @Claude @Doubao <- @ChatGPT 评价一下
10. 用 Claude + 豆包 启动 discussion
11. 用 Claude + ChatGPT + 豆包 启动 discussion
12. 给豆包发送文件，确认出现“暂不支持自动文件上传”而不是假成功
```

Expected: normal send、`/mutual`、`/cross`、discussion 都可走通；豆包文件上传提示明确失败。

- [ ] **Step 4: 提交 README 与最终闭环验证**

```bash
git add README.md
git commit -m "docs: add doubao support to usage guide"
```

- [ ] **Step 5: 汇总变更并准备合并前检查**

Run:

```bash
git status --short
git diff --stat
```

Expected: 只剩本计划涉及的文件变更，没有意外文件。

---

## Self-Review Checklist

### Spec coverage

- provider 元数据轻量收敛：Task 2
- `manifest.json` host + content script + version bump：Task 4
- `background.js` Doubao routing + storage slot：Task 4
- `sidepanel/panel.html` target / mention / participant 显示“豆包”：Task 2
- `sidepanel/panel.js` provider parsing、discussion label、file upload 明确失败：Task 2
- `content/doubao.js` 注入、发送、完整回复捕获：Task 6
- panel regression coverage：Task 1
- background regression coverage：Task 3
- Doubao adapter regression coverage：Task 5
- README operator guidance：Task 7
- 手工验证闭环：Task 7

### Placeholder scan

- 无 `TODO` / `TBD`
- 每个任务都给了精确文件路径
- 每个代码步骤都给了实际代码块
- 每个测试步骤都给了精确命令与预期结果
- 每个任务都包含 commit step，符合 frequent commits 要求

### Type and naming consistency

- internal provider id 始终使用 `doubao`
- UI label 始终使用 `豆包`
- panel / background / content script / tests 的 `aiType` 命名一致
- `getProviderLabel()`、`getAITypeFromUrl()`、`latestResponses.doubao` 在后续步骤中保持一致

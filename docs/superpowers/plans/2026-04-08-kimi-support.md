# Kimi 网页端支持 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Chrome 扩展新增 Kimi 网页端支持，使 Kimi 可以进入现有 normal send、`/mutual`、`/cross`、discussion 的发送/捕获/缓存闭环，同时对文件上传明确跳过。

**Architecture:** 保持现有三层结构不变：`sidepanel/panel.js` 负责编排，`background.js` 负责 tab 路由和最新回复缓存，`content/kimi.js` 负责 Kimi 网页 DOM 注入与回复捕获。本次只做轻量 provider 元数据扩容：内部统一使用 `kimi`，UI 统一显示 `Kimi`，host 仅 `www.kimi.com`，不引入新的运行时层级，不做平台级重构。

**Tech Stack:** Chrome Extension Manifest V3、vanilla JavaScript、Node built-in test runner (`node --test`)、VM-based panel/content-script tests、Chrome side panel UI

---

## File Map

- Modify: `manifest.json`
  - 新增 Kimi host 权限和 content script
  - bump 版本号，确保 Chrome 重新加载 content scripts
- Modify: `background.js`
  - 扩展 provider host 路由与 `latestResponses` 默认结构，加入 `kimi`
  - 保持现有 `GET_RESPONSE` completion metadata 语义不变
- Modify: `sidepanel/panel.html`
  - normal mode 目标列表新增 `Kimi`
  - mention 按钮新增 `@Kimi`
  - discussion participant 列表新增 `Kimi`
- Modify: `sidepanel/panel.js`
  - 轻量 provider registry 扩容
  - mention 解析、URL 识别、展示 label、target/participant 集合都纳入 `kimi`
  - `Kimi` 文件上传显式跳过，其他支持上传的 provider 继续发送
  - 保持 shared polling / completion rule，不破坏 normal 与 discussion 的统一语义
- Create: `content/kimi.js`
  - Kimi 网页端 DOM adapter：注入消息、检测发送、等待回复结束、提取最新回复、回传 `RESPONSE_CAPTURED`
  - 显式拒绝 `INJECT_FILES`
- Modify: `tests/panel-normal-mode.test.mjs`
  - 为 `@Kimi`、`/cross` 解析、normal mode target 集合补 failing tests
- Modify: `tests/panel-discussion.test.mjs`
  - 为 discussion participant 选择、badge 展示 `Kimi` 补 failing tests
- Modify: `tests/background-routing.test.mjs`
  - 为 `background.js` 的 Kimi host 路由和默认 storage 结构补最小测试
- Create: `tests/kimi-capture.test.mjs`
  - 为 `content/kimi.js` 的注入、发送、完整回复捕获、文件上传拒绝、找不到输入框错误补 provider-level tests
- Modify: `README.md`
  - 在支持平台、使用方法、架构树、已知限制中补 `Kimi`

---

### Task 1: 先用 panel 测试锁定 Kimi provider 行为

**Files:**
- Modify: `tests/panel-normal-mode.test.mjs`
- Modify: `tests/panel-discussion.test.mjs`
- Test: `tests/panel-normal-mode.test.mjs`
- Test: `tests/panel-discussion.test.mjs`

- [ ] **Step 1: 在 `tests/panel-normal-mode.test.mjs` 追加 `@Kimi` 解析 failing tests**

在文件尾部追加：

```js
test('parseMessage accepts Kimi mentions in direct cross-reference syntax', () => {
  const panel = loadPanel();

  const parsed = panel.api.parseMessage('@Kimi 评价一下 @Claude');

  assert.equal(parsed.crossRef, true);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.targetAIs)), ['kimi']);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.sourceAIs)), ['claude']);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.mentions)), ['kimi', 'claude']);
});

test('parseMessage accepts Kimi in explicit /cross routing', () => {
  const panel = loadPanel();

  const parsed = panel.api.parseMessage('/cross @Claude @Kimi <- @ChatGPT 对比一下');

  assert.equal(parsed.crossRef, true);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.targetAIs)), ['claude', 'kimi']);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.sourceAIs)), ['chatgpt']);
  assert.equal(parsed.originalMessage, '对比一下');
});
```

- [ ] **Step 2: 在 `tests/panel-normal-mode.test.mjs` 追加 normal send 与 label failing tests**

继续在文件尾部追加：

```js
test('normal send includes kimi when its checkbox is selected', async () => {
  const panel = loadPanel();

  panel.getElementById('message-input').value = '请给出你的判断';
  panel.getElementById('target-kimi').checked = true;
  panel.getElementById('target-claude').checked = false;
  panel.getElementById('target-chatgpt').checked = false;
  panel.getElementById('target-gemini').checked = false;
  panel.getElementById('target-doubao').checked = false;
  panel.getElementById('target-qianwen').checked = false;

  await panel.api.handleSend();

  const sendMessages = panel.getSentMessages();

  assert.equal(sendMessages.length, 1);
  assert.equal(sendMessages[0].aiType, 'kimi');
  assert.equal(sendMessages[0].message, '请给出你的判断');
});

test('getProviderLabel maps kimi to Kimi', () => {
  const panel = loadPanel();

  assert.equal(panel.api.getProviderLabel('kimi'), 'Kimi');
});
```

- [ ] **Step 3: 在 `tests/panel-discussion.test.mjs` 追加 discussion failing tests**

在文件尾部追加：

```js
test('discussion mode enables start for a kimi-inclusive 3-person selection', () => {
  const panel = loadPanel();

  panel.setSelectedParticipants(['claude', 'chatgpt', 'kimi']);
  panel.api.validateParticipants();

  assert.equal(panel.getElementById('start-discussion-btn').disabled, false);
});

test('discussion participant badge uses Kimi instead of kimi', async () => {
  const panel = loadPanel();

  panel.setSelectedParticipants(['claude', 'kimi']);
  panel.getElementById('discussion-topic').value = 'Kimi 参与讨论';

  await panel.api.startDiscussion();

  assert.match(panel.getElementById('participants-badge').textContent, /Claude/);
  assert.match(panel.getElementById('participants-badge').textContent, /Kimi/);
  assert.doesNotMatch(panel.getElementById('participants-badge').textContent, /kimi/);
});
```

- [ ] **Step 4: 运行 panel 定向测试，确认先失败**

Run:

```bash
node --test "D:/Coding/ai-roundtable/tests/panel-normal-mode.test.mjs" "D:/Coding/ai-roundtable/tests/panel-discussion.test.mjs"
```

Expected: FAIL，失败点集中在当前 `sidepanel/panel.js` 还不认识 `kimi`，UI 也还没有 `target-kimi` / `@Kimi` / discussion participant。

- [ ] **Step 5: 提交测试基线**

```bash
git add tests/panel-normal-mode.test.mjs tests/panel-discussion.test.mjs
git commit -m "test: lock panel behavior for kimi provider"
```

---

### Task 2: 实现 panel provider registry、Kimi UI 与显式 label 规则

**Files:**
- Modify: `sidepanel/panel.html`
- Modify: `sidepanel/panel.js`
- Test: `tests/panel-normal-mode.test.mjs`
- Test: `tests/panel-discussion.test.mjs`

- [ ] **Step 1: 在 `sidepanel/panel.html` 新增 Kimi target、mention 与 discussion participant**

在 normal mode target 区块的千问后面追加：

```html
<label class="target-label">
  <input type="checkbox" id="target-kimi">
  <span class="target-name">Kimi</span>
  <span class="status" id="status-kimi"></span>
</label>
```

在 mention 按钮区块追加：

```html
<button class="mention-btn" data-mention="@Kimi" title="引用 Kimi">@Kimi</button>
```

在 discussion participant 区块追加：

```html
<label class="participant-option">
  <input type="checkbox" name="participant" value="kimi">
  <span class="target-name kimi">Kimi</span>
</label>
```

- [ ] **Step 2: 在 `sidepanel/panel.js` 的 `PROVIDERS` 中新增 `kimi`**

把 `PROVIDERS` 数组补成：

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
  },
  {
    id: 'kimi',
    label: 'Kimi',
    hosts: ['www.kimi.com'],
    mention: '@Kimi',
    supports: { normalSend: true, responseCapture: true, discussion: true, mutual: true, cross: true, fileUpload: false }
  }
];
```

- [ ] **Step 3: 保持 `AI_TYPES`、`PROVIDER_IDS_PATTERN`、`getProviderLabel()` 继续从 provider registry 派生**

确认 `sidepanel/panel.js` 继续保留以下模式，不要写任何 `kimi` 特判：

```js
const AI_TYPES = PROVIDERS.map((provider) => provider.id);
const PROVIDER_IDS_PATTERN = PROVIDERS.map((provider) => provider.id).join('|');

function getProviderLabel(aiType) {
  return PROVIDERS.find((provider) => provider.id === aiType)?.label || capitalize(aiType);
}
```

- [ ] **Step 4: 让 `handleSend()` 的文件上传 gating 自动纳入 Kimi**

保留现有 capability gating 结构，只通过 `kimi.supports.fileUpload = false` 进入统一逻辑：

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

这里不要为 `kimi` 写单独分支。

- [ ] **Step 5: 运行 panel 定向测试，确认通过**

Run:

```bash
node --test "D:/Coding/ai-roundtable/tests/panel-normal-mode.test.mjs" "D:/Coding/ai-roundtable/tests/panel-discussion.test.mjs"
```

Expected: PASS，尤其要看到 `@Kimi` parser、discussion badge `Kimi`、normal send target 三类测试都过。

- [ ] **Step 6: 提交 panel 实现**

```bash
git add sidepanel/panel.html sidepanel/panel.js tests/panel-normal-mode.test.mjs tests/panel-discussion.test.mjs
git commit -m "feat: add kimi to sidepanel provider flows"
```

---

### Task 3: 先为 background host 路由和缓存结构补最小测试

**Files:**
- Modify: `tests/background-routing.test.mjs`
- Test: `tests/background-routing.test.mjs`

- [ ] **Step 1: 在 `tests/background-routing.test.mjs` 追加 Kimi host 路由测试**

在现有 Qianwen 测试后追加：

```js
test('background maps Kimi host to kimi provider id', () => {
  const api = loadBackground();

  assert.equal(api.getAITypeFromUrl('https://www.kimi.com/?chat_enter_method=new_chat'), 'kimi');
});
```

- [ ] **Step 2: 在 `tests/background-routing.test.mjs` 追加默认 storage 结构断言**

把默认对象断言改成：

```js
assert.deepEqual(JSON.parse(JSON.stringify(responses)), {
  claude: null,
  chatgpt: null,
  gemini: null,
  doubao: null,
  qianwen: null,
  kimi: null
});
```

- [ ] **Step 3: 让缺失 completion metadata 的测试也覆盖 Kimi tab**

把 helper 改成可接收 tab URL：

```js
function loadBackgroundWithRealtimeResponse(realtimeResponse, tabUrl = 'https://www.kimi.com/?chat_enter_method=new_chat') {
  return loadBackground({}, {
    tabs: [{ id: 1, url: tabUrl }],
    realtimeResponse
  });
}
```

并把测试改成：

```js
test('background treats missing provider completion metadata as unknown instead of complete', async () => {
  const api = loadBackground();
  globalThis.chrome = undefined;

  const sourceApi = loadBackgroundWithRealtimeResponse({ content: 'Kimi 第一段', streamingActive: undefined, captureState: undefined });
  const response = await sourceApi.getResponseFromContentScript('kimi');

  assert.equal(response.content, 'Kimi 第一段');
  assert.equal(response.streamingActive, false);
  assert.equal(response.captureState, 'unknown');
});
```

- [ ] **Step 4: 运行 background 定向测试，确认先失败**

Run:

```bash
node --test "D:/Coding/ai-roundtable/tests/background-routing.test.mjs"
```

Expected: FAIL，因为当前 `background.js` 还不认识 `www.kimi.com`，也没有 `kimi: null` 默认槽位。

- [ ] **Step 5: 提交 background 测试基线**

```bash
git add tests/background-routing.test.mjs
git commit -m "test: cover kimi background routing"
```

---

### Task 4: 实现 manifest + background 的 Kimi 路由闭环

**Files:**
- Modify: `manifest.json`
- Modify: `background.js`
- Test: `tests/background-routing.test.mjs`

- [ ] **Step 1: 在 `manifest.json` 新增 Kimi host 与 content script，并 bump 版本**

把 `host_permissions`、`content_scripts`、`version` 相关区块改成：

```json
{
  "manifest_version": 3,
  "name": "AI 圆桌 - Multi-AI Roundtable",
  "version": "0.1.19",
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
    "https://www.qianwen.com/*",
    "https://www.kimi.com/*"
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
    },
    {
      "matches": ["https://www.kimi.com/*"],
      "js": ["content/kimi.js"],
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
  qianwen: ['www.qianwen.com'],
  kimi: ['www.kimi.com']
};

async function getStoredResponses() {
  const result = await chrome.storage.session.get('latestResponses');
  return result.latestResponses || {
    claude: null,
    chatgpt: null,
    gemini: null,
    doubao: null,
    qianwen: null,
    kimi: null
  };
}
```

继续复用遍历式 `findAITab()` 与 `getAITypeFromUrl()`，不新增 `switch` 分支。

- [ ] **Step 3: 运行 background 定向测试，确认通过**

Run:

```bash
node --test "D:/Coding/ai-roundtable/tests/background-routing.test.mjs"
```

Expected: PASS，证明 Kimi host 和默认 `latestResponses` 结构已经纳入 `background.js`。

- [ ] **Step 4: 再跑一次 panel 测试，确认 provider 扩容没有打穿既有逻辑**

Run:

```bash
node --test "D:/Coding/ai-roundtable/tests/panel-normal-mode.test.mjs" "D:/Coding/ai-roundtable/tests/panel-discussion.test.mjs" "D:/Coding/ai-roundtable/tests/background-routing.test.mjs"
```

Expected: PASS。

- [ ] **Step 5: 提交 manifest/background 改造**

```bash
git add manifest.json background.js tests/background-routing.test.mjs
git commit -m "feat: route kimi tabs through background"
```

---

### Task 5: 先为 `content/kimi.js` 写 provider-level failing tests

**Files:**
- Create: `tests/kimi-capture.test.mjs`
- Test: `tests/kimi-capture.test.mjs`

- [ ] **Step 1: 新建 `tests/kimi-capture.test.mjs`，基于现有 qianwen/doubao harness 搭最小 DOM 测试环境**

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

function loadKimiContent(state, options = {}) {
  const messages = [];
  const inputEvents = [];
  const inputTagName = options.inputTagName || 'DIV';
  const exposeInput = options.exposeInput !== false;

  const inputEl = {
    tagName: inputTagName,
    innerHTML: '',
    textContent: '',
    value: '',
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
      if (!options.keepInputAfterClick) {
        inputEl.value = '';
        inputEl.innerHTML = '';
        inputEl.textContent = '';
      }
      if (options.startStreamingAfterClick) {
        state.isStreaming = true;
      }
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
        exposeInput && (
          selector === '[role="textbox"][contenteditable="true"]' ||
          selector === 'div[contenteditable="true"]' ||
          selector === 'textarea'
        )
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
        selector === '[data-testid="kimi-assistant-message"]' ||
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

  class HTMLTextAreaElement {
    set value(next) {
      inputEl.value = next;
    }
  }

  const context = vm.createContext({
    console,
    document,
    chrome,
    MutationObserver,
    HTMLTextAreaElement,
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
      if (typeof state.onTick === 'function') {
        state.onTick(state.tick);
      } else {
        if (state.tick === 2) {
          state.currentContent = state.partialContent;
        }
        if (state.tick === 6) {
          state.isStreaming = false;
          state.currentContent = state.fullContent;
        }
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

  const source = fs.readFileSync(new URL('../content/kimi.js', import.meta.url), 'utf8').replace(
    /\s*console\.log\('\[AI Panel\] Kimi content script loaded'\);\r?\n\}\)\(\);\s*$/,
    "\n  globalThis.__kimiTest = { injectMessage, waitForStreamingComplete, getLatestResponse, isStreamingActive };\n  console.log('[AI Panel] Kimi content script loaded');\n})();\n"
  );

  vm.runInContext(source, context);

  return {
    api: context.__kimiTest,
    messages,
    inputEvents,
    inputEl,
    sendButton
  };
}
```

- [ ] **Step 2: 在同一文件中追加发送与完整捕获 failing tests**

继续在文件末尾追加：

```js
test('kimi injectMessage fills the contenteditable input and clicks send', async () => {
  const state = {
    now: 0,
    tick: 0,
    isStreaming: false,
    currentContent: '',
    partialContent: '',
    fullContent: ''
  };

  const { api, inputEl, sendButton } = loadKimiContent(state, { keepInputAfterClick: true });

  await api.injectMessage('请用中文总结这个问题');

  assert.equal(inputEl.focused, true);
  assert.match(inputEl.innerHTML, /请用中文总结这个问题/);
  assert.equal(sendButton.clicked, true);
});

test('kimi capture waits for the fuller response before emitting RESPONSE_CAPTURED', async () => {
  const state = {
    now: 0,
    tick: 0,
    isStreaming: true,
    currentContent: '',
    partialContent: '第一段观点',
    fullContent: '第一段观点\n\n第二段完整结论'
  };

  const { api, messages } = loadKimiContent(state);

  await api.waitForStreamingComplete();

  const captures = messages.filter((message) => message.type === 'RESPONSE_CAPTURED');

  assert.equal(captures.length, 1);
  assert.equal(captures[0].aiType, 'kimi');
  assert.equal(captures[0].content, '第一段观点\n\n第二段完整结论');
});
```

- [ ] **Step 3: 在同一文件中追加错误边界 failing tests**

继续追加：

```js
test('kimi injectMessage throws a clear error when no input field is found', async () => {
  const state = {
    now: 0,
    tick: 0,
    isStreaming: false,
    currentContent: '',
    partialContent: '',
    fullContent: ''
  };

  const { api } = loadKimiContent(state, { exposeInput: false });

  await assert.rejects(
    () => api.injectMessage('请用中文总结这个问题'),
    /Could not find input field/
  );
});

test('kimi content script rejects INJECT_FILES explicitly', () => {
  const source = fs.readFileSync(new URL('../content/kimi.js', import.meta.url), 'utf8');

  assert.match(source, /INJECT_FILES/);
  assert.match(source, /Kimi 暂不支持自动文件上传/);
});
```

- [ ] **Step 4: 运行 Kimi content-script 测试，确认先失败**

Run:

```bash
node --test "D:/Coding/ai-roundtable/tests/kimi-capture.test.mjs"
```

Expected: FAIL，因为 `content/kimi.js` 还不存在。

- [ ] **Step 5: 提交 provider 测试基线**

```bash
git add tests/kimi-capture.test.mjs
git commit -m "test: define kimi content adapter behavior"
```

---

### Task 6: 实现 `content/kimi.js` 并把回复捕获接入现有闭环

**Files:**
- Create: `content/kimi.js`
- Test: `tests/kimi-capture.test.mjs`
- Test: `tests/panel-normal-mode.test.mjs`
- Test: `tests/panel-discussion.test.mjs`
- Test: `tests/background-routing.test.mjs`

- [ ] **Step 1: 新建 `content/kimi.js`，先搭消息协议骨架**

创建文件内容如下：

```js
// AI Panel - Kimi Content Script

(function() {
  'use strict';

  const AI_TYPE = 'kimi';

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
      sendResponse({ success: false, error: 'Kimi 暂不支持自动文件上传' });
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

- [ ] **Step 2: 写入输入框、发送按钮、回复提取与发送逻辑**

在同一文件中继续补全：

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
      if (el && isVisible(el) && !el.disabled) {
        return el.closest('button') || el;
      }
    }
    return null;
  }

  async function injectMessage(text) {
    lastCapturedContent = '';

    const inputEl = findInput();
    if (!inputEl) {
      throw new Error('Could not find input field');
    }

    inputEl.focus();

    if (inputEl.tagName === 'TEXTAREA') {
      const nativeValueSetter =
        typeof HTMLTextAreaElement !== 'undefined'
          ? Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          : null;

      if (nativeValueSetter) {
        nativeValueSetter.call(inputEl, text);
      } else {
        inputEl.value = text;
      }

      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      inputEl.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
      inputEl.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
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
    await sleep(200);

    if (!didMessageLeaveInput(inputEl, text) && !isStreamingActive()) {
      throw new Error('Message was not sent');
    }

    waitForStreamingComplete();
    return true;
  }

  function getLatestResponse() {
    const selectors = [
      '[data-testid="kimi-assistant-message"]',
      '.assistant-message',
      '[data-role="assistant"]'
    ];

    for (const selector of selectors) {
      const messages = Array.from(document.querySelectorAll(selector));
      for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        const content = (
          message.innerText ||
          message.textContent ||
          ''
        ).trim();
        if (content) {
          return content;
        }
      }
    }

    return null;
  }
```

- [ ] **Step 3: 写入 shared completion contract，实现“流式结束 + 稳定窗口”双保险**

在同一文件中继续补全：

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
      node.matches?.('[data-testid="kimi-assistant-message"], .assistant-message, [data-role="assistant"]') ||
      node.querySelector?.('[data-testid="kimi-assistant-message"], .assistant-message, [data-role="assistant"]');

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

- [ ] **Step 4: 写入发送辅助函数并补上结尾**

在文件末尾补齐：

```js
  function didMessageLeaveInput(inputEl, text) {
    const normalizedText = String(text).trim();
    if (!normalizedText) {
      return true;
    }

    if (inputEl.tagName === 'TEXTAREA') {
      return (inputEl.value || '').trim() !== normalizedText;
    }

    const currentText = (inputEl.innerText || inputEl.textContent || '').trim();
    return currentText !== normalizedText;
  }

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

  console.log('[AI Panel] Kimi content script loaded');
})();
```

- [ ] **Step 5: 运行 Kimi content-script 测试，确认通过**

Run:

```bash
node --test "D:/Coding/ai-roundtable/tests/kimi-capture.test.mjs"
```

Expected: PASS。

- [ ] **Step 6: 运行回归测试，确认 Kimi 接入没有打穿既有 shared closure 语义**

Run:

```bash
node --test "D:/Coding/ai-roundtable/tests/panel-normal-mode.test.mjs" "D:/Coding/ai-roundtable/tests/panel-discussion.test.mjs" "D:/Coding/ai-roundtable/tests/background-routing.test.mjs" "D:/Coding/ai-roundtable/tests/kimi-capture.test.mjs"
```

Expected: PASS。

- [ ] **Step 7: 提交 Kimi adapter 实现**

```bash
git add content/kimi.js tests/kimi-capture.test.mjs
git commit -m "feat: add kimi web content adapter"
```

---

### Task 7: 更新 README 并完成最终验证闭环

**Files:**
- Modify: `README.md`
- Test: `tests/panel-normal-mode.test.mjs`
- Test: `tests/panel-discussion.test.mjs`
- Test: `tests/background-routing.test.mjs`
- Test: `tests/kimi-capture.test.mjs`

- [ ] **Step 1: 在 `README.md` 的准备工作中补 `Kimi`**

把 provider 列表改成：

```md
1. 打开 Chrome，登录以下 AI 平台（根据需要）：
   - [Claude](https://claude.ai)
   - [ChatGPT](https://chatgpt.com)
   - [Gemini](https://gemini.google.com)
   - [豆包](https://www.doubao.com/chat/)
   - [千问](https://www.qianwen.com/?ch=tongyi_redirect)
   - [Kimi](https://www.kimi.com/?chat_enter_method=new_chat)
```

- [ ] **Step 2: 在 `README.md` 的普通模式、讨论模式、架构树中补 `Kimi`**

把普通模式的目标列表说明改成：

```md
1. 勾选要发送的目标 AI（Claude / ChatGPT / Gemini / 豆包 / 千问 / Kimi）
```

把 discussion 模式说明改成：

```md
让 2~3 个 AI 就同一主题进行深度讨论（Claude / ChatGPT / Gemini / 豆包 / 千问 / Kimi 中任意 2~3 个）
```

把架构树改成：

```md
├── content/
│   ├── claude.js          # Claude 页面注入脚本
│   ├── chatgpt.js         # ChatGPT 页面注入脚本
│   ├── gemini.js          # Gemini 页面注入脚本
│   ├── doubao.js          # 豆包页面注入脚本
│   ├── qianwen.js         # 千问页面注入脚本
│   └── kimi.js            # Kimi 页面注入脚本
```
```

- [ ] **Step 3: 在 `README.md` 的已知限制中明确 Kimi 不支持自动文件上传**

把已知限制中的对应条目改成：

```md
- **Gemini、豆包、千问、Kimi 不支持自动文件上传** - 本轮接入仅支持文本发送与回复捕获；若带文件发送，系统会跳过这些 provider，并继续向支持文件上传的 provider 发送
```

- [ ] **Step 4: 跑最终自动化回归套件**

Run:

```bash
node --test "D:/Coding/ai-roundtable/tests/panel-normal-mode.test.mjs" "D:/Coding/ai-roundtable/tests/panel-discussion.test.mjs" "D:/Coding/ai-roundtable/tests/background-routing.test.mjs" "D:/Coding/ai-roundtable/tests/kimi-capture.test.mjs"
```

Expected: PASS。

- [ ] **Step 5: 在 Chrome 中做手工 spot check**

按下面顺序执行：

```text
1. 重新加载 unpacked extension
2. 刷新已打开的 Kimi 页面，确保新版 content script 注入
3. normal mode 只勾选 Kimi，发送普通文本，确认能成功注入并捕获回复
4. normal mode 只勾选 Kimi，发送长回复 prompt，确认不会截在半句
5. 让 Kimi 与至少一个既有 provider 先各自产生回复，然后执行 /mutual
6. 执行 @Kimi 评价一下 @Claude
7. 执行 @Claude 评价一下 @Kimi
8. 用 Kimi + 另一个 provider 开 2 人 discussion，至少验证：初始轮、下一轮、插话、总结
9. 带文件同时选择 Kimi + Claude，确认日志里 Kimi 显示“暂不支持自动文件上传”，Claude 继续正常发送
```

Expected: 每一项都能完成；如果第 9 步里整次发送被 Kimi 拖死或假成功，说明 capability gating 还没闭环。

- [ ] **Step 6: 提交最终文档与收尾改动**

```bash
git add README.md
git commit -m "docs: document kimi web support"
```

- [ ] **Step 7: 汇总交付证据**

把最终结果整理成以下清单后再宣告完成：

```md
- 自动化测试：PASS
  - tests/panel-normal-mode.test.mjs
  - tests/panel-discussion.test.mjs
  - tests/background-routing.test.mjs
  - tests/kimi-capture.test.mjs
- Chrome 手工验证：PASS
  - normal send
  - long-response capture
  - /mutual
  - /cross
  - discussion
  - file-upload skip boundary
```

---

## Spec coverage check

- `internal kimi / UI Kimi` → Task 1、Task 2
- `host only www.kimi.com` → Task 3、Task 4
- `normal send / mutual / cross / discussion` → Task 1、Task 2、Task 6、Task 7
- `response capture + completion contract` → Task 5、Task 6
- `file upload skip boundary` → Task 2、Task 6、Task 7
- `README / operator guidance` → Task 7

## Placeholder scan

已排查本计划，未保留 `TODO`、`TBD`、`implement later`、`similar to task` 这类占位语句。

## Type consistency check

本计划统一使用以下命名：

- provider id: `kimi`
- UI label: `Kimi`
- mention: `@Kimi`
- latest response key: `latestResponses.kimi`
- content script file: `content/kimi.js`
- provider-level test: `tests/kimi-capture.test.mjs`

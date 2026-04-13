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
    focus() {},
    click() {},
    addEventListener() {},
    dispatchEvent() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    closest() {
      return null;
    },
    matches() {
      return false;
    },
    getBoundingClientRect() {
      return { bottom: 0 };
    }
  };
}

function loadChatgptContent(state) {
  const messages = [];
  const inputEl = {
    ...createElement(),
    tagName: 'TEXTAREA'
  };
  const sendButton = {
    ...createElement(),
    click() {}
  };
  const actionButtonGroup = {
    querySelectorAll(selector) {
      if (selector === 'button') {
        return Array.from({ length: state.actionButtonCount ?? 0 }, () => createElement());
      }
      return [];
    }
  };
  const assistantContainer = {
    parentElement: {
      querySelector(selector) {
        if (selector === '[class*="group"]') {
          return actionButtonGroup;
        }
        return null;
      }
    },
    nextElementSibling: actionButtonGroup,
    querySelectorAll() {
      return [];
    },
    get innerText() {
      return state.currentContent;
    }
  };

  const document = {
    readyState: 'complete',
    body: createElement(),
    addEventListener() {},
    querySelector(selector) {
      if (selector === 'main') return createElement();
      if (
        selector === '#prompt-textarea' ||
        selector === 'div[contenteditable="true"]#prompt-textarea' ||
        selector === 'div[contenteditable="true"][data-placeholder]' ||
        selector === 'textarea[data-id="root"]' ||
        selector === 'textarea[placeholder*="Message"]' ||
        selector === 'div[contenteditable="true"][role="textbox"]' ||
        selector === 'textarea'
      ) {
        return inputEl;
      }
      if (
        selector === 'button[data-testid="send-button"]' ||
        selector === 'button[aria-label="Send prompt"]' ||
        selector === 'button[aria-label="Send message"]' ||
        selector === 'form button[type="submit"]'
      ) {
        return sendButton;
      }

      if (
        selector === 'button[aria-label*="Stop"]' ||
        selector === 'button[data-testid="stop-button"]' ||
        selector === '[data-testid="stop-button"]' ||
        selector === 'button[aria-label*="Stop generating"]'
      ) {
        return state.isStreaming ? createElement() : null;
      }

      if (
        selector === '[data-testid="agent-turn-status"][data-state="running"]' ||
        selector === '[data-testid="tool-status"][data-state="running"]' ||
        selector === '[data-testid="search-status"][data-state="running"]'
      ) {
        return state.intermediateActive ? createElement() : null;
      }

      return null;
    },
    querySelectorAll(selector) {
      if (
        selector === '[data-message-author-role="assistant"]' ||
        selector === '[data-testid*="conversation-turn"]:has([data-message-author-role="assistant"])' ||
        selector === '.agent-turn'
      ) {
        return state.currentContent ? [assistantContainer] : [];
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
    setTimeout(fn, ms = 0) {
      state.now += ms;
      state.tick += 1;
      if (typeof state.onTick === 'function') {
        state.onTick(state.tick, state.now);
      } else if (state.tick === 8) {
        state.isStreaming = false;
        state.currentContent = '开头框架。\n\n完整结论与展开内容。';
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

  const source = fs.readFileSync('D:/Coding/ai-roundtable/content/chatgpt.js', 'utf8').replace(
    /\s*console\.log\('\[AI Panel\] ChatGPT content script loaded'\);\r?\n\}\)\(\);\s*$/,
    "\n  globalThis.__chatgptTest = { injectMessage, waitForStreamingComplete, getCaptureState, getLastCapturedContent: () => lastCapturedContent, setLastCapturedContent: (value) => { lastCapturedContent = value; } };\n  console.log('[AI Panel] ChatGPT content script loaded');\n})();\n"
  );

  vm.runInContext(source, context);

  return {
    api: context.__chatgptTest,
    messages
  };
}

test('chatgpt capture waits for streaming to stop before capturing the full response', async () => {
  const state = {
    now: 0,
    tick: 0,
    isStreaming: true,
    currentContent: '开头框架。'
  };

  const { api, messages } = loadChatgptContent(state);

  await api.waitForStreamingComplete();

  const captures = messages.filter((message) => message.type === 'RESPONSE_CAPTURED');

  assert.equal(captures.length, 1);
  assert.equal(captures[0].content, '开头框架。\n\n完整结论与展开内容。');
});

test('chatgpt capture does not wait for the long fallback after streaming stops without action buttons', async () => {
  const state = {
    now: 0,
    tick: 0,
    isStreaming: true,
    currentContent: '开头框架。'
  };

  const { api, messages } = loadChatgptContent(state);

  await api.waitForStreamingComplete();

  const captures = messages.filter((message) => message.type === 'RESPONSE_CAPTURED');

  assert.equal(captures.length, 1);
  assert.equal(captures[0].content, '开头框架。\n\n完整结论与展开内容。');
  assert.ok(state.now < 12000, `expected capture before long fallback, got ${state.now}ms`);
});

test('chatgpt getCaptureState returns unknown when latest assistant turn has text but no completion signals', () => {
  const state = {
    now: 0,
    tick: 0,
    isStreaming: false,
    currentContent: '这是一条仍可能继续增长的回复'
  };

  const { api } = loadChatgptContent(state);

  assert.equal(api.getCaptureState(), 'unknown');
});

test('chatgpt capture does not lock a truncated long reply when streaming stops before the tail arrives', async () => {
  const truncated = '我会把它的总体判断改成这样：这篇文';
  const full = '我会把它的总体判断改成这样：这篇文章在论证结构上是成立的，但结尾需要补上风险边界与适用范围。';
  const state = {
    now: 0,
    tick: 0,
    isStreaming: true,
    currentContent: truncated,
    onTick(currentTick) {
      if (currentTick === 6) {
        this.isStreaming = false;
        this.currentContent = truncated;
      }
      if (currentTick === 12) {
        this.currentContent = full;
      }
    }
  };

  const { api, messages } = loadChatgptContent(state);

  await api.waitForStreamingComplete();

  const captures = messages.filter((message) => message.type === 'RESPONSE_CAPTURED');

  assert.equal(captures.length, 1);
  assert.equal(captures[0].content, full);
  assert.ok(state.now >= 6000, `expected capture to wait past the early truncated plateau, got ${state.now}ms`);
});

test('chatgpt getCaptureState stays unknown while search tooling is still running even if action buttons are visible', () => {
  const state = {
    now: 0,
    tick: 0,
    isStreaming: false,
    intermediateActive: true,
    actionButtonCount: 4,
    currentContent: 'ChatGPT 先给出了一段阶段性回答。'
  };

  const { api } = loadChatgptContent(state);

  assert.equal(api.getCaptureState(), 'unknown');

  state.intermediateActive = false;
  assert.equal(api.getCaptureState(), 'complete');
});

test('chatgpt capture waits for search tooling to finish before accepting action-button completion', async () => {
  const partial = 'ChatGPT 先给出第一段，再继续搜索。';
  const full = 'ChatGPT 先给出第一段，再继续搜索。\n\n搜索完成后的最终结论。';
  const state = {
    now: 0,
    tick: 0,
    isStreaming: false,
    intermediateActive: true,
    actionButtonCount: 4,
    currentContent: partial,
    onTick(currentTick) {
      if (currentTick === 10) {
        this.intermediateActive = false;
        this.currentContent = full;
      }
    }
  };

  const { api, messages } = loadChatgptContent(state);

  await api.waitForStreamingComplete();

  const captures = messages.filter((message) => message.type === 'RESPONSE_CAPTURED');

  assert.equal(captures.length, 1);
  assert.equal(captures[0].content, full);
  assert.ok(state.now >= 6000, `expected capture to wait for intermediate search completion, got ${state.now}ms`);
});

test('chatgpt getCaptureState upgrades to complete after stable content settles without action buttons', () => {
  const state = {
    now: 0,
    tick: 0,
    isStreaming: false,
    currentContent: '这是一条已经写完的回复',
    onTick(_currentTick, now) {
      if (now >= 5000) {
        this.currentContent = '这是一条已经写完的回复';
      }
    }
  };

  const { api } = loadChatgptContent(state);

  assert.equal(api.getCaptureState(), 'unknown');
  state.now = 6000;
  assert.equal(api.getCaptureState(), 'complete');
});

test('chatgpt injectMessage clears lastCapturedContent before a new round starts', async () => {
  const state = {
    now: 0,
    tick: 0,
    isStreaming: false,
    currentContent: '完全相同的回复'
  };

  const { api } = loadChatgptContent(state);
  api.setLastCapturedContent('完全相同的回复');

  await api.injectMessage('请开始新一轮讨论');

  assert.equal(api.getLastCapturedContent(), '');
});

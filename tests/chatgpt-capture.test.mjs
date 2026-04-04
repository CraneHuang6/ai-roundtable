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
  const assistantContainer = {
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
        selector === 'button[aria-label*="Stop"]' ||
        selector === 'button[data-testid="stop-button"]' ||
        selector === '[data-testid="stop-button"]' ||
        selector === 'button[aria-label*="Stop generating"]'
      ) {
        return state.isStreaming ? createElement() : null;
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
      if (state.tick === 8) {
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
    "\n  globalThis.__chatgptTest = { waitForStreamingComplete };\n  console.log('[AI Panel] ChatGPT content script loaded');\n})();\n"
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

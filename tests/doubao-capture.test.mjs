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

  const source = fs.readFileSync('D:/Coding/ai-roundtable/.worktrees/doubao-support/content/doubao.js', 'utf8').replace(
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

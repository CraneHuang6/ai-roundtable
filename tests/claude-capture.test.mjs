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

function loadClaudeContent(state, options = {}) {
  const messages = [];
  const inputEvents = [];

  const inputState = {
    innerHTML: '',
    textContent: '',
    innerText: ''
  };

  const inputEl = {
    ...createElement(),
    dispatchEvent(event) {
      inputEvents.push(event.type);
    }
  };

  Object.defineProperty(inputEl, 'innerHTML', {
    get() {
      return inputState.innerHTML;
    },
    set(value) {
      inputState.innerHTML = value;
      inputState.textContent = value.replace(/<[^>]+>/g, '');
      inputState.innerText = inputState.textContent;
    }
  });

  Object.defineProperty(inputEl, 'textContent', {
    get() {
      return inputState.textContent;
    },
    set(value) {
      inputState.textContent = value;
      inputState.innerText = value;
      inputState.innerHTML = value;
    }
  });

  Object.defineProperty(inputEl, 'innerText', {
    get() {
      return inputState.innerText;
    },
    set(value) {
      inputState.innerText = value;
      inputState.textContent = value;
      inputState.innerHTML = value;
    }
  });

  const sendButton = {
    ...createElement(),
    disabled: false,
    click() {
      this.clicked = true;
      if (!options.keepInputAfterClick) {
        inputEl.innerHTML = '';
        inputEl.textContent = '';
        inputEl.innerText = '';
      }
      if (options.startStreamingAfterClick) {
        state.streaming = true;
      }
    }
  };

  const responseBlock = {
    innerText: state.currentContent,
    textContent: state.currentContent,
    closest() {
      return null;
    }
  };

  const responseContainer = {
    querySelectorAll(selector) {
      if (selector === '.standard-markdown' && state.currentContent) {
        responseBlock.innerText = state.currentContent;
        responseBlock.textContent = state.currentContent;
        return [responseBlock];
      }
      return [];
    }
  };

  const document = {
    readyState: 'complete',
    body: createElement(),
    addEventListener() {},
    createElement() {
      const state = {
        textContent: '',
        innerHTML: ''
      };
      return {
        get textContent() {
          return state.textContent;
        },
        set textContent(value) {
          state.textContent = value;
          state.innerHTML = String(value);
        },
        get innerHTML() {
          return state.innerHTML;
        },
        set innerHTML(value) {
          state.innerHTML = value;
        }
      };
    },
    querySelector(selector) {
      if (selector === 'main') return createElement();
      if (
        selector === 'div[contenteditable="true"].ProseMirror' ||
        selector === 'div.ProseMirror[contenteditable="true"]' ||
        selector === '[data-placeholder="How can Claude help you today?"]' ||
        selector === 'fieldset div[contenteditable="true"]'
      ) {
        return inputEl;
      }
      if (
        selector === 'button[aria-label="Send message"]' ||
        selector === 'button[aria-label="Send Message"]' ||
        selector === 'button[type="submit"]' ||
        selector === 'fieldset button:last-of-type'
      ) {
        return sendButton;
      }
      if (
        selector === '[data-is-streaming="true"]' ||
        selector === 'button[aria-label*="Stop"]'
      ) {
        return state.streaming ? createElement() : null;
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-is-streaming="false"]') {
        return state.currentContent ? [responseContainer] : [];
      }
      if (selector === 'button') {
        return [sendButton];
      }
      return [];
    }
  };

  const messageListeners = [];
  const chrome = {
    runtime: {
      id: 'test-extension',
      sendMessage(message, callback) {
        messages.push(message);
        callback?.({ success: true });
      },
      onMessage: {
        addListener(listener) {
          messageListeners.push(listener);
        }
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
      state.onTick?.(state.tick);
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

  const source = fs.readFileSync(new URL('../content/claude.js', import.meta.url), 'utf8').replace(
    /\s*console\.log\('\[AI Panel\] Claude content script loaded'\);\r?\n\}\)\(\);\s*$/,
    "\n  globalThis.__claudeTest = { injectMessage, waitForStreamingComplete, getLatestResponse, getCaptureState, isStreamingActive, getLastCapturedContent: () => lastCapturedContent, setLastCapturedContent: (value) => { lastCapturedContent = value; }, getLastCompletionState: () => lastCompletionState, setLastCompletionState: (value) => { lastCompletionState = value; } };\n  console.log('[AI Panel] Claude content script loaded');\n})();\n"
  );

  vm.runInContext(source, context);

  return {
    api: context.__claudeTest,
    messages,
    inputEvents,
    inputEl,
    sendButton,
    invokeGetLatestResponse() {
      let responsePayload = null;
      for (const listener of messageListeners) {
        listener({ type: 'GET_LATEST_RESPONSE' }, {}, (payload) => {
          responsePayload = payload;
        });
      }
      return responsePayload;
    }
  };
}

test('claude injectMessage dispatches full controlled-editor events before submit', async () => {
  const state = {
    now: 0,
    tick: 0,
    streaming: true,
    currentContent: ''
  };

  const { api, inputEl, sendButton, inputEvents } = loadClaudeContent(state, {
    keepInputAfterClick: true,
    startStreamingAfterClick: true
  });

  await api.injectMessage('讨论首轮主题');

  assert.equal(inputEl.focused, true);
  assert.match(inputEl.innerHTML, /讨论首轮主题/);
  assert.deepEqual(inputEvents.slice(0, 4), ['input', 'change', 'keydown', 'keyup']);
  assert.equal(sendButton.clicked, true);
});

test('claude get latest response exposes capture metadata for panel polling', () => {
  const state = {
    now: 0,
    tick: 0,
    streaming: false,
    currentContent: 'Claude 首轮回复（页面有内容但完成态未知）'
  };

  const { api, invokeGetLatestResponse } = loadClaudeContent(state);

  assert.equal(api.getCaptureState(), 'unknown');

  const response = invokeGetLatestResponse();
  assert.equal(response.content, 'Claude 首轮回复（页面有内容但完成态未知）');
  assert.equal(response.streamingActive, false);
  assert.equal(response.captureState, 'unknown');
});

test('claude getCaptureState returns complete after capture settles', async () => {
  const state = {
    now: 0,
    tick: 0,
    streaming: true,
    currentContent: 'Claude 首轮回复（最终版）',
    onTick(tick) {
      if (tick >= 2) {
        state.streaming = false;
      }
    }
  };

  const { api, invokeGetLatestResponse } = loadClaudeContent(state);

  await api.waitForStreamingComplete();

  assert.equal(api.getLastCompletionState(), 'complete');
  assert.equal(api.getCaptureState(), 'complete');

  const response = invokeGetLatestResponse();
  assert.equal(response.captureState, 'complete');
  assert.equal(response.streamingActive, false);
});

test('claude injectMessage fails when text never leaves input and streaming never starts', async () => {
  const state = {
    now: 0,
    tick: 0,
    streaming: false,
    currentContent: ''
  };

  const { api } = loadClaudeContent(state, { keepInputAfterClick: true });

  await assert.rejects(() => api.injectMessage('没有真正发出去'), /Message was not sent/);
});

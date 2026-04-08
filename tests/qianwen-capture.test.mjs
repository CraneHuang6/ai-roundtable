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

function loadQianwenContent(state, options = {}) {
  const messages = [];
  const inputEvents = [];
  const inputTagName = options.inputTagName || 'DIV';

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
      if (name === 'aria-label') return '发送消息';
      return null;
    }
  };

  const document = {
    readyState: 'complete',
    body: createElement(),
    addEventListener() {},
    createElement() {
      return {
        textContent: '',
        innerHTML: '',
        remove() {},
        set src(value) {
          this._src = value;
        },
        get src() {
          return this._src;
        }
      };
    },
    querySelector(selector) {
      if (selector === 'main' || selector === 'main, .semi-navigation, .semi-layout') return createElement();
      if (
        selector === 'div[role="textbox"][contenteditable="true"]' ||
        selector === '[role="textbox"][contenteditable="true"]' ||
        selector === 'div[contenteditable="true"]' ||
        selector === 'textarea'
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
      if (selector === 'html') {
        return { appendChild(node) { node.remove?.(); }, removeChild() {} };
      }
      return null;
    },
    querySelectorAll(selector) {
      if (
        selector === '.qk-markdown-complete .qk-md-text.complete' ||
        selector === '.qk-markdown-complete .qk-md-paragraph' ||
        selector === '.qk-markdown.qk-markdown-complete' ||
        selector === '.qk-md-text.complete' ||
        selector === '.answerItem-sQ6QT6 .qk-markdown' ||
        selector === '.answerItem-sQ6QT6' ||
        selector === '.qk-markdown' ||
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
          querySelector(innerSelector) {
            if (innerSelector === '.qk-markdown' || innerSelector === '.qk-md-paragraph') {
              return {
                get innerText() {
                  return state.currentContent;
                },
                get textContent() {
                  return state.currentContent;
                }
              };
            }
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

  const customListeners = new Map();

  document.addEventListener = function(type, listener) {
    customListeners.set(type, listener);
  };
  document.removeEventListener = function(type, listener) {
    if (customListeners.get(type) === listener) {
      customListeners.delete(type);
    }
  };
  document.dispatchEvent = function(event) {
    const listener = customListeners.get(event.type);
    if (listener) {
      listener(event);
    }
    return true;
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
      innerHeight: 1000,
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
    CustomEvent: class CustomEvent {
      constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
      }
    },
    globalThis: null
  });
  context.globalThis = context;

  const source = fs.readFileSync(new URL('../content/qianwen.js', import.meta.url), 'utf8').replace(
    /\s*console\.log\('\[AI Panel\] Qianwen content script loaded'\);\r?\n\}\)\(\);\s*$/,
    "\n  globalThis.__qianwenTest = { injectMessage, waitForStreamingComplete, getLatestResponse, isStreamingActive, getLastCapturedContent: () => lastCapturedContent, setLastCapturedContent: (value) => { lastCapturedContent = value; } };\n  console.log('[AI Panel] Qianwen content script loaded');\n})();\n"
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

test('qianwen injectMessage fills the contenteditable input and clicks send', async () => {
  const state = {
    now: 0,
    tick: 0,
    isStreaming: false,
    currentContent: '',
    partialContent: '',
    fullContent: ''
  };

  const { api, inputEl, sendButton } = loadQianwenContent(state, { keepInputAfterClick: true });

  await api.injectMessage('请用中文总结这个问题');

  assert.equal(inputEl.focused, true);
  assert.match(inputEl.innerHTML, /请用中文总结这个问题/);
  assert.equal(sendButton.clicked, true);
});

test('qianwen page-context submit waits for a send-observed signal instead of returning success immediately', async () => {
  const source = fs.readFileSync(new URL('../content/qianwen.js', import.meta.url), 'utf8');

  assert.match(source, /send-not-observed/);
  assert.match(source, /findStopButton/);
});

test('qianwen injectMessage drives textarea input state before clicking send', async () => {
  const state = {
    now: 0,
    tick: 0,
    isStreaming: false,
    currentContent: '',
    partialContent: '',
    fullContent: ''
  };

  const { api, inputEl, sendButton, inputEvents } = loadQianwenContent(state, {
    inputTagName: 'TEXTAREA',
    keepInputAfterClick: true,
    startStreamingAfterClick: true
  });

  await api.injectMessage('请用中文总结这个问题');

  assert.equal(inputEl.focused, true);
  assert.equal(inputEl.value, '请用中文总结这个问题');
  assert.deepEqual(inputEvents.slice(0, 4), ['input', 'change', 'keydown', 'keyup']);
  assert.equal(sendButton.clicked, true);
});

test('qianwen injectMessage waits for the send button to become enabled after contenteditable input updates asynchronously', async () => {
  const state = {
    now: 0,
    tick: 0,
    isStreaming: false,
    currentContent: '',
    partialContent: '',
    fullContent: ''
  };

  const { api, inputEl, sendButton } = loadQianwenContent(state, { keepInputAfterClick: true });
  sendButton.disabled = true;
  state.onTick = () => {
    sendButton.disabled = false;
  };

  await api.injectMessage('reply OK only');

  assert.equal(inputEl.focused, true);
  assert.match(inputEl.innerHTML, /reply OK only/);
  assert.equal(sendButton.clicked, true);
  assert.equal(sendButton.disabled, false);
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

test('qianwen content script rejects INJECT_FILES explicitly', () => {
  const source = fs.readFileSync(new URL('../content/qianwen.js', import.meta.url), 'utf8');

  assert.match(source, /INJECT_FILES/);
  assert.match(source, /千问暂不支持自动文件上传/);
});

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

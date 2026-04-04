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
    getAttribute() {
      return null;
    },
    classList: {
      contains() {
        return false;
      }
    }
  };
}

function loadGeminiContent(state) {
  const messages = [];
  const inputEvents = [];
  const responseNode = {
    matches(selector) {
      return selector === '.model-response-text, message-content';
    },
    querySelector() {
      return null;
    },
    classList: {
      contains(className) {
        return className === 'model-response-text';
      }
    }
  };

  const contenteditableInput = {
    tagName: 'DIV',
    innerHTML: '',
    focused: false,
    focus() {
      this.focused = true;
    },
    dispatchEvent(event) {
      inputEvents.push(event.type);
    }
  };

  const sendButton = {
    disabled: true,
    clicked: false,
    getAttribute(name) {
      if (name === 'aria-label') return 'Send message';
      return null;
    },
    click() {
      this.clicked = true;
    },
    closest() {
      return this;
    }
  };

  const document = {
    readyState: 'complete',
    body: createElement(),
    createElement() {
      return { textContent: '', innerHTML: '' };
    },
    addEventListener() {},
    querySelector(selector) {
      if (selector === 'main, .conversation-container') return createElement();
      if (selector === '.ql-editor') return contenteditableInput;
      if (selector === 'button[aria-label*="Send"]') return sendButton;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '.model-response-text') {
        if (!state.currentContent) {
          return [];
        }
        return [{
          get innerText() {
            return state.currentContent;
          }
        }];
      }
      if (selector === 'message-content') {
        return [];
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
    constructor(callback) {
      this.callback = callback;
    }
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
    DragEvent: class DragEvent {
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
    atob(value) {
      return Buffer.from(value, 'base64').toString('binary');
    },
    Blob,
    File,
    Uint8Array,
    DataTransfer: class DataTransfer {
      constructor() {
        this.items = { add() {} };
        this.files = [];
      }
    },
    setTimeout(fn, ms = 0) {
      state.now += ms;
      state.tick += 1;
      if (state.tick === 1 && state.enableSendOnKeyup) {
        sendButton.disabled = !inputEvents.includes('keyup');
      }
      if (state.tick === 2) {
        state.currentContent = state.partialContent;
      }
      if (state.tick === 5) {
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

  const source = fs.readFileSync('D:/Coding/ai-roundtable/content/gemini.js', 'utf8').replace(
    /\s*console\.log\('\[AI Panel\] Gemini content script loaded'\);\r?\n\}\)\(\);\s*$/,
    "\n  globalThis.__geminiTest = { injectMessage, waitForStreamingComplete, checkForResponse };\n  console.log('[AI Panel] Gemini content script loaded');\n})();\n"
  );

  vm.runInContext(source, context);

  return {
    api: context.__geminiTest,
    messages,
    responseNode,
    inputEvents,
    sendButton,
    contenteditableInput
  };
}

test('gemini capture waits for provider-side partial response to grow into the full response before capturing', async () => {
  const state = {
    now: 0,
    tick: 0,
    currentContent: '',
    partialContent: 'Gemini 第一段总结',
    fullContent: 'Gemini 第一段总结\n\nGemini 第二段完整结论'
  };

  const { api, messages, responseNode } = loadGeminiContent(state);

  api.checkForResponse(responseNode);
  await new Promise((resolve) => setTimeout(resolve, 50));

  const captures = messages.filter((message) => message.type === 'RESPONSE_CAPTURED');

  assert.equal(captures.length, 1);
  assert.equal(captures[0].content, 'Gemini 第一段总结\n\nGemini 第二段完整结论');
});

test('gemini injectMessage fires the full event chain for long contenteditable prompts so send becomes enabled', async () => {
  const state = {
    now: 0,
    tick: 0,
    currentContent: '',
    partialContent: 'Gemini 已收到超长讨论消息',
    fullContent: 'Gemini 已收到超长讨论消息',
    enableSendOnKeyup: true
  };

  const { api, inputEvents, sendButton, contenteditableInput } = loadGeminiContent(state);
  const longPrompt = '超长讨论内容：' + '这是 Gemini discussion 下一轮要发送的长文本。'.repeat(200);

  await api.injectMessage(longPrompt);

  assert.equal(contenteditableInput.focused, true);
  assert.match(contenteditableInput.innerHTML, /<p>/);
  assert.deepEqual(inputEvents.slice(0, 4), ['input', 'change', 'keydown', 'keyup']);
  assert.equal(sendButton.disabled, false);
  assert.equal(sendButton.clicked, true);
});

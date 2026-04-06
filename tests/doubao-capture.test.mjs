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

function loadDoubaoContent(state, options = {}) {
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
      if (name === 'data-testid') return 'chat_input_send_button';
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
        selector === '[data-testid="chat_input_input"]' ||
        selector === 'textarea[placeholder*="发消息"]' ||
        selector === 'div[contenteditable="true"]' ||
        selector === '[role="textbox"][contenteditable="true"]' ||
        selector === 'textarea'
      ) {
        return inputEl;
      }
      if (
        selector === '[data-testid="chat_input_send_button"]' ||
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

      if (selector === '[data-testid="receive_message"]') {
        return (state.realAssistantMessages || []).map((message) => {
          const wrapperText = typeof message === 'string' ? message : (message.wrapperText || '');
          const contentNodeText = typeof message === 'string'
            ? message
            : (message.contentNodeText ?? message.wrapperText ?? '');

          return {
            get innerText() {
              return wrapperText;
            },
            get textContent() {
              return wrapperText;
            },
            querySelector(innerSelector) {
              if (innerSelector === '[data-testid="message_text_content"]') {
                return {
                  get innerText() {
                    return contentNodeText;
                  },
                  get textContent() {
                    return contentNodeText;
                  }
                };
              }
              return null;
            }
          };
        });
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
    globalThis: null
  });
  context.globalThis = context;

  const source = fs.readFileSync('D:/Coding/ai-roundtable/content/doubao.js', 'utf8').replace(
    /\s*console\.log\('\[AI Panel\] Doubao content script loaded'\);\r?\n\}\)\(\);\s*$/,
    "\n  globalThis.__doubaoTest = { injectMessage, waitForStreamingComplete, getLatestResponse, isStreamingActive, getLastCapturedContent: () => lastCapturedContent, setLastCapturedContent: (value) => { lastCapturedContent = value; } };\n  console.log('[AI Panel] Doubao content script loaded');\n})();\n"
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

test('doubao injectMessage fills the contenteditable input and clicks send', async () => {
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

test('doubao injectMessage drives textarea input state before clicking send', async () => {
  const state = {
    now: 0,
    tick: 0,
    isStreaming: false,
    currentContent: '',
    partialContent: '',
    fullContent: ''
  };

  const { api, inputEl, sendButton, inputEvents } = loadDoubaoContent(state, { inputTagName: 'TEXTAREA' });

  await api.injectMessage('请用中文总结这个问题');

  assert.equal(inputEl.focused, true);
  assert.equal(inputEl.value, '请用中文总结这个问题');
  assert.deepEqual(inputEvents.slice(0, 4), ['input', 'change', 'keydown', 'keyup']);
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

test('doubao getLatestResponse reads real receive_message structure', () => {
  const state = {
    now: 0,
    tick: 0,
    isStreaming: false,
    currentContent: '',
    partialContent: '',
    fullContent: '',
    realAssistantMessages: ['豆包验收 - 普通发送通过', '豆包验收 - 键盘发送通过']
  };

  const { api } = loadDoubaoContent(state);

  assert.equal(api.getLatestResponse(), '豆包验收 - 键盘发送通过');
});

test('doubao getLatestResponse falls back to wrapper text when message_text_content is empty', () => {
  const state = {
    now: 0,
    tick: 0,
    isStreaming: false,
    currentContent: '',
    partialContent: '',
    fullContent: '',
    realAssistantMessages: [
      {
        wrapperText: '豆包验收 - 后台标签页文本回退通过',
        contentNodeText: ''
      }
    ]
  };

  const { api } = loadDoubaoContent(state);

  assert.equal(api.getLatestResponse(), '豆包验收 - 后台标签页文本回退通过');
});

test('doubao reports streaming metadata for polling-based completion checks', () => {
  const state = {
    now: 0,
    tick: 0,
    isStreaming: true,
    currentContent: '豆包仍在输出第一段',
    partialContent: '',
    fullContent: ''
  };

  const { api } = loadDoubaoContent(state);

  assert.equal(typeof api.isStreamingActive, 'function');
  assert.equal(api.isStreamingActive(), true);
});

test('doubao getLatestResponse skips trailing empty receive_message placeholder', () => {
  const state = {
    now: 0,
    tick: 0,
    isStreaming: false,
    currentContent: '',
    partialContent: '',
    fullContent: '',
    realAssistantMessages: [
      '第一条历史回复',
      '最新有效回复',
      {
        wrapperText: '',
        contentNodeText: ''
      }
    ]
  };

  const { api } = loadDoubaoContent(state);

  assert.equal(api.getLatestResponse(), '最新有效回复');
});

test('doubao injectMessage clears lastCapturedContent before a new round starts', async () => {
  const state = {
    now: 0,
    tick: 0,
    isStreaming: false,
    currentContent: '',
    partialContent: '',
    fullContent: ''
  };

  const { api } = loadDoubaoContent(state);
  api.setLastCapturedContent('完全相同的回复');

  await api.injectMessage('请继续下一轮讨论');

  assert.equal(api.getLastCapturedContent(), '');
});

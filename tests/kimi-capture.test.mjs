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
  const execCommands = [];
  const inputTagName = options.inputTagName || 'DIV';
  const exposeInput = options.exposeInput !== false;
  const assistantSelectorMode = options.assistantSelectorMode || 'both';

  const inputState = {
    committedText: '',
    transientHtml: '',
    transientText: '',
    value: ''
  };

  const inputEl = {
    tagName: inputTagName,
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

  Object.defineProperty(inputEl, 'innerHTML', {
    get() {
      if (inputState.committedText) {
        return `<p>${inputState.committedText}</p>`;
      }
      return inputState.transientHtml;
    },
    set(next) {
      inputState.transientHtml = next;
      inputState.transientText = String(next).replace(/<[^>]+>/g, '').trim();
    }
  });

  Object.defineProperty(inputEl, 'textContent', {
    get() {
      return inputState.committedText || inputState.transientText;
    },
    set(next) {
      inputState.transientText = next;
    }
  });

  Object.defineProperty(inputEl, 'innerText', {
    get() {
      return inputState.committedText || inputState.transientText;
    },
    set(next) {
      inputState.transientText = next;
    }
  });

  Object.defineProperty(inputEl, 'value', {
    get() {
      return inputState.value;
    },
    set(next) {
      inputState.value = next;
      inputState.committedText = next;
    }
  });

  const sendButton = {
    disabled: false,
    clicked: false,
    className: options.sendButtonClassName || 'send-button-container',
    click() {
      if (this.disabled || this.classList.contains('disabled')) {
        return;
      }
      this.clicked = true;
      if (!options.keepInputAfterClick) {
        inputState.value = '';
        inputState.committedText = '';
        inputState.transientHtml = '';
        inputState.transientText = '';
      }
      if (options.startStreamingAfterClick) {
        state.isStreaming = true;
      }
    },
    closest(selector) {
      if (!selector || selector === '.send-button-container') {
        return this;
      }
      return this;
    },
    getAttribute(name) {
      if (name === 'aria-label') return '发送';
      if (name === 'aria-disabled') return this.className.includes('disabled') ? 'true' : null;
      return null;
    }
  };

  sendButton.classList = {
    contains(className) {
      return sendButton.className.split(/\s+/).filter(Boolean).includes(className);
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
        return options.sendControlMode === 'button' ? sendButton : null;
      }
      if (
        selector === '.send-button-container' ||
        selector === 'svg[name="Send"]' ||
        selector === '.send-icon'
      ) {
        return inputState.committedText ? sendButton : null;
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
      const legacyMatch =
        selector === '[data-testid="kimi-assistant-message"]' ||
        selector === '.assistant-message' ||
        selector === '[data-role="assistant"]';
      const realMatch =
        selector === '.chat-content-item.chat-content-item-assistant' ||
        selector === '.chat-content-item-assistant' ||
        selector === '.segment.segment-assistant' ||
        selector === '.segment-assistant';

      const selectorAllowed =
        assistantSelectorMode === 'both'
          ? (legacyMatch || realMatch)
          : assistantSelectorMode === 'real'
            ? realMatch
            : legacyMatch;

      if (selectorAllowed) {
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
            if (innerSelector === '.markdown, .markdown-container') {
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

  class Range {
    selectNodeContents() {}
    collapse() {}
  }

  const selection = {
    removeAllRanges() {},
    addRange() {}
  };

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
      },
      getSelection() {
        return selection;
      }
    },
    document: Object.assign(document, {
      createRange() {
        return new Range();
      },
      execCommand(command, _ui, value) {
        execCommands.push({ command, value });
        if (command === 'insertText') {
          inputState.committedText += String(value ?? '');
          return true;
        }
        return false;
      }
    }),
    setTimeout(fn, ms = 0) {
      state.now += ms;
      state.tick += 1;
      if (options.enableSendAfterTick && state.tick === options.enableSendAfterTick) {
        sendButton.className = sendButton.className.replace(/\s*disabled\b/g, '').trim() || 'send-button-container';
      }
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
    "\n  globalThis.__kimiTest = { injectMessage, waitForStreamingComplete, getLatestResponse, isStreamingActive, getCaptureState };\n  console.log('[AI Panel] Kimi content script loaded');\n})();\n"
  );

  vm.runInContext(source, context);

  return {
    api: context.__kimiTest,
    messages,
    inputEvents,
    execCommands,
    inputEl,
    sendButton
  };
}

test('kimi injectMessage uses execCommand-style insertion for contenteditable input before clicking send', async () => {
  const state = {
    now: 0,
    tick: 0,
    isStreaming: false,
    currentContent: '',
    partialContent: '',
    fullContent: ''
  };

  const { api, inputEl, sendButton, execCommands } = loadKimiContent(state, { keepInputAfterClick: true, startStreamingAfterClick: true });

  await api.injectMessage('请用中文总结这个问题');

  assert.equal(inputEl.focused, true);
  assert.deepEqual(execCommands, [{ command: 'insertText', value: '请用中文总结这个问题' }]);
  assert.match(inputEl.innerHTML, /请用中文总结这个问题/);
  assert.equal(sendButton.clicked, true);
});

test('kimi injectMessage uses non-button send container when the page exposes svg send controls', async () => {
  const state = {
    now: 0,
    tick: 0,
    isStreaming: false,
    currentContent: '',
    partialContent: '',
    fullContent: ''
  };

  const { api, sendButton } = loadKimiContent(state, { keepInputAfterClick: true, startStreamingAfterClick: true });

  await api.injectMessage('请只回复：KIMI-SEND-CONTAINER');

  assert.equal(sendButton.clicked, true);
});

test('kimi getLatestResponse reads assistant reply from real Kimi chat DOM structure', () => {
  const state = {
    now: 0,
    tick: 0,
    isStreaming: false,
    currentContent: '这是 Kimi 在真实聊天 DOM 里的回复',
    partialContent: '',
    fullContent: ''
  };

  const { api } = loadKimiContent(state, { assistantSelectorMode: 'real' });

  assert.equal(api.getLatestResponse(), '这是 Kimi 在真实聊天 DOM 里的回复');
});

test('kimi injectMessage waits for a delayed send container to become enabled before clicking', async () => {
  const state = {
    now: 0,
    tick: 0,
    isStreaming: false,
    currentContent: '',
    partialContent: '',
    fullContent: ''
  };

  const { api, sendButton } = loadKimiContent(state, {
    keepInputAfterClick: true,
    startStreamingAfterClick: true,
    sendButtonClassName: 'send-button-container disabled',
    enableSendAfterTick: 2
  });

  await api.injectMessage('请只回复：KIMI-DELAYED-SEND');

  assert.equal(sendButton.classList.contains('disabled'), false);
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

test('kimi getCaptureState returns streaming while stop signal is visible', () => {
  const state = {
    now: 0,
    tick: 0,
    isStreaming: true,
    currentContent: '第一段观点',
    partialContent: '',
    fullContent: ''
  };

  const { api } = loadKimiContent(state);

  assert.equal(api.getCaptureState(), 'streaming');
});

test('kimi getCaptureState returns complete after stable assistant content settles', () => {
  const state = {
    now: 0,
    tick: 0,
    isStreaming: false,
    currentContent: '这是已经稳定的 Kimi 完整回复',
    partialContent: '',
    fullContent: ''
  };

  const { api } = loadKimiContent(state, {
    onTick(tick) {
      if (tick >= 1) {
        state.currentContent = '这是已经稳定的 Kimi 完整回复';
      }
    }
  });

  assert.equal(api.getCaptureState(), 'unknown');
  assert.equal(api.getCaptureState(), 'unknown');
  assert.equal(api.getCaptureState(), 'unknown');
  assert.equal(api.getCaptureState(), 'complete');
});

test('kimi capture state stays complete after waitForStreamingComplete finishes', async () => {
  const state = {
    now: 0,
    tick: 0,
    isStreaming: true,
    currentContent: '',
    partialContent: '第一段观点',
    fullContent: '第一段观点\n\n第二段完整结论'
  };

  const { api } = loadKimiContent(state);

  await api.waitForStreamingComplete();

  assert.equal(api.getCaptureState(), 'complete');
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

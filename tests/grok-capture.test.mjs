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

function loadGrokContent(state, options = {}) {
  const messages = [];
  const inputEvents = [];
  const assistantSelectorMode = options.assistantSelectorMode || 'both';
  let visibleUserMessageCount = options.visibleUserMessageCount || 0;

  const inputState = {
    value: ''
  };

  const inputEl = {
    tagName: 'TEXTAREA',
    focused: false,
    focus() {
      this.focused = true;
    },
    dispatchEvent(event) {
      inputEvents.push(event.type);
    },
    getAttribute(name) {
      if (name === 'aria-label') return '向 Grok 提任何问题';
      if (name === 'placeholder') return '今天需要我如何帮助你？';
      return null;
    }
  };

  Object.defineProperty(inputEl, 'value', {
    get() {
      return inputState.value;
    },
    set(next) {
      inputState.value = next;
    }
  });

  const contenteditableState = {
    html: '<p data-placeholder="你在想什么？" class="is-empty is-editor-empty"><br class="ProseMirror-trailingBreak"></p>',
    text: '\n'
  };

  const contenteditableInput = {
    tagName: 'DIV',
    focused: false,
    focus() {
      this.focused = true;
    },
    dispatchEvent(event) {
      inputEvents.push(event.type);
    },
    getAttribute(name) {
      if (name === 'contenteditable') return 'true';
      return null;
    }
  };

  Object.defineProperty(contenteditableInput, 'innerHTML', {
    get() {
      return contenteditableState.html;
    },
    set(next) {
      contenteditableState.html = next;
      contenteditableState.text = String(next).replace(/<[^>]+>/g, '').trim() || '\n';
    }
  });

  Object.defineProperty(contenteditableInput, 'textContent', {
    get() {
      return contenteditableState.text;
    },
    set(next) {
      contenteditableState.text = next;
    }
  });

  Object.defineProperty(contenteditableInput, 'innerText', {
    get() {
      return contenteditableState.text;
    },
    set(next) {
      contenteditableState.text = next;
    }
  });

  const sendButton = {
    disabled: true,
    clicked: false,
    click() {
      if (this.disabled) {
        return;
      }
      this.clicked = true;
      if (!options.keepInputAfterClick) {
        inputState.value = '';
      }
      if (options.startStreamingAfterClick) {
        state.isStreaming = true;
      }
      if (options.incrementUserMessageAfterClick) {
        visibleUserMessageCount += 1;
      }
      if (typeof options.onSendClick === 'function') {
        options.onSendClick();
      }
    },
    closest() {
      return this;
    },
    getAttribute(name) {
      if (name === 'aria-label') return '提交';
      if (name === 'aria-disabled') return this.disabled ? 'true' : 'false';
      return null;
    }
  };

  const assistantSelectorMatch = (selector) => {
    const realMatch =
      selector === '[data-testid="grok-assistant-message"]' ||
      selector === '[data-message-author-role="assistant"]' ||
      selector === 'article[data-testid="conversation-turn-assistant"]' ||
      selector === '.message-bubble.assistant';
    const legacyMatch =
      selector === '.assistant-message' ||
      selector === '[data-role="assistant"]';

    return assistantSelectorMode === 'both'
      ? (realMatch || legacyMatch)
      : assistantSelectorMode === 'real'
        ? realMatch
        : legacyMatch;
  };

  const document = {
    readyState: 'complete',
    body: createElement(),
    addEventListener() {},
    createElement() {
      return { textContent: '', innerHTML: '' };
    },
    querySelector(selector) {
      if (selector === 'main' || selector === 'main, [data-testid="conversation"]') {
        return createElement();
      }
      if (
        options.exposeContenteditable &&
        (
          selector === 'div[contenteditable="true"]' ||
          selector === '[contenteditable="true"]'
        )
      ) {
        return contenteditableInput;
      }
      if (
        options.exposeInput !== false &&
        (
          selector === 'textarea[aria-label*="Grok"]' ||
          selector === 'textarea[placeholder*="帮助"]' ||
          selector === 'textarea'
        )
      ) {
        return inputEl;
      }
      if (
        selector === 'button[aria-label="提交"]' ||
        selector === 'button[aria-label*="Submit"]' ||
        selector === 'button[type="submit"]'
      ) {
        return inputState.value || contenteditableState.text.trim() || options.exposeSendWhenEmpty ? sendButton : null;
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
      const userMatch =
        selector === '[data-testid="grok-user-message"]' ||
        selector === '[data-message-author-role="user"]' ||
        selector === 'article[data-testid="conversation-turn-user"]';

      if (userMatch) {
        return Array.from({ length: visibleUserMessageCount }, () => ({
          offsetParent: {},
          getClientRects() {
            return [1];
          }
        }));
      }

      if (!assistantSelectorMatch(selector)) {
        if (selector === '.message-bubble') {
          if (!state.currentContent) {
            return [];
          }
          return [
            {
              className: 'message-bubble user-bubble',
              parentElement: { className: 'relative group flex flex-col justify-center w-full max-w-[var(--content-max-width)] pb-0.5 items-end' },
              matches(matchSelector) {
                return matchSelector === '.message-bubble';
              },
              get innerText() {
                return '用户问题';
              },
              get textContent() {
                return '用户问题';
              },
              querySelector() {
                return null;
              }
            },
            {
              className: 'message-bubble assistant-bubble',
              parentElement: { className: 'relative group flex flex-col justify-center w-full max-w-[var(--content-max-width)] pb-0.5 items-start' },
              matches(matchSelector) {
                return matchSelector === '.message-bubble';
              },
              get innerText() {
                return state.currentContent;
              },
              get textContent() {
                return state.currentContent;
              },
              querySelector(innerSelector) {
                if (innerSelector === '.markdown, .prose, [data-testid="message-content"]') {
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
            }
          ];
        }
        return [];
      }

      if (!state.currentContent) {
        return [];
      }

      return [{
        matches(matchSelector) {
          return assistantSelectorMatch(matchSelector);
        },
        get innerText() {
          return state.currentContent;
        },
        get textContent() {
          return state.currentContent;
        },
        querySelector(innerSelector) {
          if (innerSelector === '.markdown, .prose, [data-testid="message-content"]') {
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

  class Range {
    selectNodeContents() {}
    collapse() {}
  }

  const selection = {
    removeAllRanges() {},
    addRange() {}
  };

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
      getSelection() {
        return selection;
      },
      getComputedStyle(el) {
        if (el === inputEl && options.hideTextarea) {
          return { display: 'block', visibility: 'hidden', opacity: '1' };
        }
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
  context.document.createRange = () => new Range();
  context.document.execCommand = (command, _ui, value) => {
    if (command === 'insertText') {
      contenteditableInput.innerHTML = `<p>${String(value ?? '')}</p>`;
      return true;
    }
    return false;
  };

  const source = fs.readFileSync(new URL('../content/grok.js', import.meta.url), 'utf8').replace(
    /\s*console\.log\('\[AI Panel\] Grok content script loaded'\);\r?\n\}\)\(\);\s*$/,
    "\n  globalThis.__grokTest = { injectMessage, waitForStreamingComplete, getLatestResponse, isStreamingActive, getCaptureState };\n  console.log('[AI Panel] Grok content script loaded');\n})();\n"
  );

  vm.runInContext(source, context);

  return {
    api: context.__grokTest,
    messages,
    inputEvents,
    inputEl,
    contenteditableInput,
    sendButton,
    state
  };
}

test('grok injectMessage fills textarea and clicks submit after the send control becomes enabled', async () => {
  const state = {
    now: 0,
    tick: 0,
    isStreaming: false,
    currentContent: '',
    partialContent: '',
    fullContent: ''
  };

  const { api, inputEl, sendButton, inputEvents } = loadGrokContent(state, {
    keepInputAfterClick: true,
    startStreamingAfterClick: true,
    onSendClick() {
      sendButton.disabled = false;
    }
  });

  sendButton.disabled = false;

  await api.injectMessage('请只回复：GROK-TEXTAREA');

  assert.equal(inputEl.focused, true);
  assert.equal(inputEl.value, '请只回复：GROK-TEXTAREA');
  assert.ok(inputEvents.includes('input'));
  assert.ok(inputEvents.includes('change'));
  assert.equal(sendButton.clicked, true);
});

test('grok injectMessage prefers visible contenteditable input over hidden textarea mirrors', async () => {
  const state = {
    now: 0,
    tick: 0,
    isStreaming: false,
    currentContent: '',
    partialContent: '',
    fullContent: ''
  };

  const { api, inputEl, contenteditableInput, sendButton } = loadGrokContent(state, {
    exposeContenteditable: true,
    hideTextarea: true,
    keepInputAfterClick: true,
    startStreamingAfterClick: true,
    onSendClick() {
      sendButton.disabled = false;
    }
  });

  sendButton.disabled = false;

  await api.injectMessage('请只回复：GROK-CONTENTEDITABLE');

  assert.equal(inputEl.value, '', 'hidden textarea mirror should not be used as the primary editor');
  assert.match(contenteditableInput.innerHTML, /GROK-CONTENTEDITABLE/);
  assert.equal(sendButton.clicked, true);
});

test('grok injectMessage rejects when post-send signals never appear', async () => {
  const state = {
    now: 0,
    tick: 0,
    isStreaming: false,
    currentContent: '',
    partialContent: '',
    fullContent: ''
  };

  const { api, sendButton } = loadGrokContent(state, {
    keepInputAfterClick: true
  });

  sendButton.disabled = false;

  await assert.rejects(
    () => api.injectMessage('请只回复：GROK-NO-SIGNAL'),
    /Message was not sent/
  );
});

test('grok getLatestResponse reads assistant reply from Grok conversation DOM', () => {
  const state = {
    now: 0,
    tick: 0,
    isStreaming: false,
    currentContent: '这是 Grok 在真实聊天 DOM 里的回复',
    partialContent: '',
    fullContent: ''
  };

  const { api } = loadGrokContent(state, { assistantSelectorMode: 'real' });

  assert.equal(api.getLatestResponse(), '这是 Grok 在真实聊天 DOM 里的回复');
});

test('grok getLatestResponse reads the last assistant bubble from the real Grok message-bubble layout', () => {
  const state = {
    now: 0,
    tick: 0,
    isStreaming: false,
    currentContent: '思考了 3s\n\nGROK-MANUAL-VALIDATION-20260413-CONTENTEDITABLE',
    partialContent: '',
    fullContent: ''
  };

  const { api } = loadGrokContent(state, { assistantSelectorMode: 'none' });

  assert.equal(api.getLatestResponse(), '思考了 3s\n\nGROK-MANUAL-VALIDATION-20260413-CONTENTEDITABLE');
});

test('grok capture waits for the fuller response before emitting RESPONSE_CAPTURED with metadata', async () => {
  const state = {
    now: 0,
    tick: 0,
    isStreaming: true,
    currentContent: '',
    partialContent: '第一段观点',
    fullContent: '第一段观点\n\n第二段完整结论'
  };

  const { api, messages } = loadGrokContent(state);

  await api.waitForStreamingComplete();

  const captures = messages.filter((message) => message.type === 'RESPONSE_CAPTURED');

  assert.equal(captures.length, 1);
  assert.equal(captures[0].aiType, 'grok');
  assert.equal(captures[0].content, '第一段观点\n\n第二段完整结论');
  assert.equal(captures[0].streamingActive, false);
  assert.equal(captures[0].captureState, 'complete');
});

test('grok getCaptureState returns streaming while stop signal is visible', () => {
  const state = {
    now: 0,
    tick: 0,
    isStreaming: true,
    currentContent: '第一段观点',
    partialContent: '',
    fullContent: ''
  };

  const { api } = loadGrokContent(state);

  assert.equal(api.getCaptureState(), 'streaming');
});

test('grok getCaptureState returns complete after stable assistant content settles', () => {
  const state = {
    now: 0,
    tick: 0,
    isStreaming: false,
    currentContent: '这是已经稳定的 Grok 完整回复',
    partialContent: '',
    fullContent: ''
  };

  const { api } = loadGrokContent(state, {
    onTick() {
      state.currentContent = '这是已经稳定的 Grok 完整回复';
    }
  });

  assert.equal(api.getCaptureState(), 'unknown');
  assert.equal(api.getCaptureState(), 'unknown');
  assert.equal(api.getCaptureState(), 'unknown');
  assert.equal(api.getCaptureState(), 'complete');
});

test('grok injectMessage throws a clear error when no input field is found', async () => {
  const state = {
    now: 0,
    tick: 0,
    isStreaming: false,
    currentContent: '',
    partialContent: '',
    fullContent: ''
  };

  const { api } = loadGrokContent(state, { exposeInput: false });

  await assert.rejects(
    () => api.injectMessage('请用中文总结这个问题'),
    /Could not find input field/
  );
});

test('grok content script rejects INJECT_FILES explicitly', () => {
  const source = fs.readFileSync(new URL('../content/grok.js', import.meta.url), 'utf8');

  assert.match(source, /INJECT_FILES/);
  assert.match(source, /Grok 暂不支持自动文件上传/);
});

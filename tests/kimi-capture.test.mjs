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

function createKimiNode({ text = '', className = '', attributes = {}, children = [] } = {}, parent = null) {
  const node = {
    className,
    attributes,
    parent,
    removed: false,
    children: [],
    get innerText() {
      return this.textContent;
    },
    get textContent() {
      if (this.removed) {
        return '';
      }
      const childText = this.children.map((child) => child.textContent).filter(Boolean).join('\n');
      return [text, childText].filter(Boolean).join(childText && text ? '\n' : '');
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) {
      const selectors = selector.split(',').map((item) => item.trim()).filter(Boolean);
      const matches = [];
      const visit = (candidate) => {
        if (candidate.removed) {
          return;
        }
        if (selectors.some((singleSelector) => candidate.matches(singleSelector))) {
          matches.push(candidate);
        }
        candidate.children.forEach(visit);
      };
      this.children.forEach(visit);
      return matches;
    },
    matches(selector) {
      if (!selector) {
        return false;
      }
      if (selector === '.markdown') {
        return this.className.split(/\s+/).includes('markdown');
      }
      if (selector === '.markdown-container') {
        return this.className.split(/\s+/).includes('markdown-container');
      }
      if (selector === '[class*="markdown"]') {
        return this.className.includes('markdown');
      }
      if (selector === '[class*="content"]') {
        return this.className.includes('content');
      }
      if (selector === '[class*="response"]') {
        return this.className.includes('response');
      }
      if (selector === '[data-testid*="content"]') {
        return String(this.attributes['data-testid'] || '').includes('content');
      }
      return false;
    },
    closest(selector) {
      let current = this;
      while (current) {
        if (current.matches(selector)) {
          return current;
        }
        current = current.parent;
      }
      return null;
    },
    getAttribute(name) {
      return this.attributes[name] ?? null;
    },
    contains(other) {
      let current = other;
      while (current) {
        if (current === this) {
          return true;
        }
        current = current.parent;
      }
      return false;
    },
    cloneNode(deep = false) {
      return createKimiNode({
        text,
        className,
        attributes: { ...attributes },
        children: deep ? this.children.map((child) => child.cloneNode(true)) : []
      });
    },
    remove() {
      this.removed = true;
    }
  };

  node.children = children.map((child) => {
    child.parent = node;
    return child;
  });

  return node;
}

function loadKimiContent(state, options = {}) {
  const messages = [];
  const inputEvents = [];
  const execCommands = [];
  const inputTagName = options.inputTagName || 'DIV';
  const exposeInput = options.exposeInput !== false;
  const assistantSelectorMode = options.assistantSelectorMode || 'both';
  const visibleUserMessageCount = options.visibleUserMessageCount || 0;

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
      if (options.incrementUserMessagesAfterClick) {
        state.visibleUserMessageCount = (state.visibleUserMessageCount ?? visibleUserMessageCount) + 1;
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
      const userMatch =
        selector === '[data-testid="kimi-user-message"]' ||
        selector === '[data-role="user"]' ||
        selector === '.chat-content-item.chat-content-item-user' ||
        selector === '.chat-content-item-user' ||
        selector === '.segment.segment-user' ||
        selector === '.segment-user';

      if (userMatch) {
        const userCount = state.visibleUserMessageCount ?? visibleUserMessageCount;
        return Array.from({ length: userCount }, () => ({
          offsetParent: {},
          getClientRects() {
            return [1];
          }
        }));
      }

      const selectorAllowed =
        assistantSelectorMode === 'both'
          ? (legacyMatch || realMatch)
          : assistantSelectorMode === 'real'
            ? realMatch
            : legacyMatch;

      if (selectorAllowed) {
        if (options.assistantMessages) {
          return options.assistantMessages;
        }
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
    sendButton,
    state
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

  const result = await api.injectMessage('请用中文总结这个问题');

  assert.equal(inputEl.focused, true);
  assert.deepEqual(execCommands, [{ command: 'insertText', value: '请用中文总结这个问题' }]);
  assert.match(inputEl.innerHTML, /请用中文总结这个问题/);
  assert.equal(sendButton.clicked, true);
  assert.equal(result.success, true);
  assert.equal(result.sendVerification.reason, 'streaming-started');
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

  const result = await api.injectMessage('请只回复：KIMI-SEND-CONTAINER');

  assert.equal(sendButton.clicked, true);
  assert.equal(result.success, true);
  assert.equal(result.sendVerification.reason, 'streaming-started');
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

test('kimi getLatestResponse prefers final answer markdown over preceding thinking markdown', () => {
  const state = {
    now: 0,
    tick: 0,
    isStreaming: false,
    currentContent: '',
    partialContent: '',
    fullContent: ''
  };
  const thinking = createKimiNode({
    text: '用户背景：税务专业人士\n我应该：用中文回复\n不需要使用工具，这是纯观点分享。',
    className: 'markdown kimi-thinking-content',
    attributes: { 'data-testid': 'kimi-thinking-content' }
  });
  const finalAnswer = createKimiNode({
    text: '我的看法是：这篇文章最有价值的地方，是把意图从固定命令改成可校准的工作假设。',
    className: 'markdown kimi-answer-content',
    attributes: { 'data-testid': 'kimi-answer-content' }
  });
  const assistantMessage = createKimiNode({
    className: 'chat-content-item chat-content-item-assistant',
    children: [thinking, finalAnswer]
  });

  const { api } = loadKimiContent(state, { assistantMessages: [assistantMessage] });

  assert.equal(
    api.getLatestResponse(),
    '我的看法是：这篇文章最有价值的地方，是把意图从固定命令改成可校准的工作假设。'
  );
});

test('kimi getLatestResponse removes thinking subtree before falling back to whole assistant text', () => {
  const state = {
    now: 0,
    tick: 0,
    isStreaming: false,
    currentContent: '',
    partialContent: '',
    fullContent: ''
  };
  const thinking = createKimiNode({
    text: '思考过程\n用户背景：税务专业人士\n我应该：提供结构化建议。',
    className: 'kimi-reasoning-block',
    attributes: { 'aria-label': '思考过程' }
  });
  const finalAnswer = createKimiNode({
    text: '最终建议：把每天的最高指令写成可复盘的一句话，再用实际行动数据校准它。',
    className: 'answer-content'
  });
  const assistantMessage = createKimiNode({
    className: 'chat-content-item chat-content-item-assistant',
    children: [thinking, finalAnswer]
  });

  const { api } = loadKimiContent(state, { assistantMessages: [assistantMessage] });

  assert.equal(
    api.getLatestResponse(),
    '最终建议：把每天的最高指令写成可复盘的一句话，再用实际行动数据校准它。'
  );
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

  const result = await api.injectMessage('请只回复：KIMI-DELAYED-SEND');

  assert.equal(sendButton.classList.contains('disabled'), false);
  assert.equal(sendButton.clicked, true);
  assert.equal(result.success, true);
  assert.equal(result.sendVerification.reason, 'streaming-started');
});

test('kimi injectMessage returns user-message-added when a new user bubble appears before input clears', async () => {
  const state = {
    now: 0,
    tick: 0,
    isStreaming: false,
    currentContent: '',
    partialContent: '',
    fullContent: '',
    visibleUserMessageCount: 1
  };

  const { api } = loadKimiContent(state, {
    keepInputAfterClick: true,
    startStreamingAfterClick: false,
    visibleUserMessageCount: 1,
    incrementUserMessagesAfterClick: true
  });

  const result = await api.injectMessage('请只回复：KIMI-USER-MESSAGE-ADDED');

  assert.equal(result.success, true);
  assert.equal(result.sendVerification.observed, true);
  assert.equal(result.sendVerification.reason, 'user-message-added');
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

test('kimi injectMessage does not treat existing visible user history as a successful new send', async () => {
  const state = {
    now: 0,
    tick: 0,
    isStreaming: false,
    currentContent: '',
    partialContent: '',
    fullContent: ''
  };

  const { api } = loadKimiContent(state, {
    keepInputAfterClick: true,
    startStreamingAfterClick: false,
    visibleUserMessageCount: 2
  });

  await assert.rejects(
    () => api.injectMessage('请只回复：KIMI-HISTORY-FALSE-POSITIVE'),
    /Message was not sent/
  );
});

test('kimi content script rejects INJECT_FILES explicitly', () => {
  const source = fs.readFileSync(new URL('../content/kimi.js', import.meta.url), 'utf8');

  assert.match(source, /INJECT_FILES/);
  assert.match(source, /Kimi 暂不支持自动文件上传/);
});

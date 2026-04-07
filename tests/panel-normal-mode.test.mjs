import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const PANEL_JS = new URL('../sidepanel/panel.js', import.meta.url);
const loadedPanels = new Set();

test.afterEach(() => {
  for (const panel of loadedPanels) {
    panel.dispose?.();
  }
  loadedPanels.clear();
});

function extractLongTextId(html) {
  return html.match(/data-long-text-id="([^"]+)"/)?.[1] ?? null;
}

function loadPanel(responseMap = {}, options = {}) {
  const elementCache = new Map();
  const longTextNodes = new Map();
  const domReadyCallbacks = [];
  const sentMessages = [];
  const activeIntervals = new Set();
  const activeTimeouts = new Set();
  let nextTimerId = 1;

  function createTrackedTimer(type, callback, ms = 0) {
    const handle = { id: nextTimerId++, type, callback, ms };
    if (type === 'interval') {
      activeIntervals.add(handle);
    } else {
      activeTimeouts.add(handle);
    }
    return handle;
  }

  function trackedSetInterval(callback, ms = 0) {
    if (options.auditTimers) {
      return createTrackedTimer('interval', callback, ms);
    }

    const handle = setInterval(callback, ms);
    activeIntervals.add(handle);
    return handle;
  }

  function trackedClearInterval(handle) {
    if (!handle) return;
    activeIntervals.delete(handle);
    if (!options.auditTimers) {
      clearInterval(handle);
    }
  }

  function trackedSetTimeout(callback, ms = 0) {
    if (options.auditTimers) {
      return createTrackedTimer('timeout', callback, ms);
    }

    let handle = null;
    handle = setTimeout(() => {
      activeTimeouts.delete(handle);
      callback();
    }, ms);
    activeTimeouts.add(handle);
    return handle;
  }

  function trackedClearTimeout(handle) {
    if (!handle) return;
    activeTimeouts.delete(handle);
    if (!options.auditTimers) {
      clearTimeout(handle);
    }
  }

  function syncChildren(element) {
    element.firstChild = element.children[0] ?? null;
    element.lastChild = element.children[element.children.length - 1] ?? null;
  }

  function createElement(id = '') {
    const state = {
      textContent: '',
      innerHTML: ''
    };

    const element = {
      id,
      value: '',
      className: '',
      title: '',
      disabled: false,
      checked: false,
      selectionStart: 0,
      selectionEnd: 0,
      children: [],
      dataset: {},
      style: {},
      parentElement: null,
      firstChild: null,
      lastChild: null,
      focus() {},
      addEventListener() {},
      dispatchEvent() {},
      appendChild(child) {
        child.parentElement = this;
        this.children.push(child);
        syncChildren(this);
        return child;
      },
      insertBefore(child, beforeChild) {
        child.parentElement = this;
        if (!beforeChild) {
          this.children.unshift(child);
        } else {
          const index = this.children.indexOf(beforeChild);
          if (index === -1) {
            this.children.unshift(child);
          } else {
            this.children.splice(index, 0, child);
          }
        }
        syncChildren(this);
        return child;
      },
      removeChild(child) {
        if (this.children.length === 0) {
          return null;
        }

        const index = child ? this.children.indexOf(child) : this.children.length - 1;
        const removeIndex = index >= 0 ? index : this.children.length - 1;
        const [removed] = this.children.splice(removeIndex, 1);
        if (removed) {
          removed.parentElement = null;
        }
        syncChildren(this);
        return removed ?? null;
      },
      querySelector(selector) {
        if (selector === '.long-text-toggle') {
          return this.closest(selector);
        }
        return createElement();
      },
      querySelectorAll() {
        return [];
      },
      closest(selector) {
        if (selector !== '.long-text-toggle') {
          return null;
        }

        let current = this;
        while (current) {
          const classes = current.className.split(/\s+/).filter(Boolean);
          if (classes.includes('long-text-toggle')) {
            return current;
          }
          current = current.parentElement;
        }
        return null;
      }
    };

    element.classList = {
      add(...classes) {
        const next = new Set(element.className.split(/\s+/).filter(Boolean));
        classes.forEach((className) => next.add(className));
        element.className = Array.from(next).join(' ');
      },
      remove(...classes) {
        const removals = new Set(classes);
        element.className = element.className
          .split(/\s+/)
          .filter(Boolean)
          .filter((className) => !removals.has(className))
          .join(' ');
      }
    };

    Object.defineProperty(element, 'textContent', {
      get() {
        return state.textContent;
      },
      set(value) {
        state.textContent = value;
      }
    });

    Object.defineProperty(element, 'innerHTML', {
      get() {
        return state.innerHTML;
      },
      set(value) {
        state.innerHTML = value;

        const stack = [element];

        for (const match of value.matchAll(/<\/?[^>]+>/g)) {
          const tag = match[0];

          if (tag.startsWith('</')) {
            if (stack.length > 1) {
              stack.pop();
            }
            continue;
          }

          const className = tag.match(/class="([^"]*)"/)?.[1] ?? '';
          const longTextId = tag.match(/data-long-text-id="([^"]+)"/)?.[1] ?? null;
          const node = createElement(longTextId ? `long-text-${longTextId}` : 'html-node');
          node.className = className;
          node.parentElement = stack[stack.length - 1];

          if (longTextId) {
            node.dataset.longTextId = longTextId;
            longTextNodes.set(longTextId, node);
          }

          if (!tag.endsWith('/>')) {
            stack.push(node);
          }
        }
      }
    });

    return element;
  }

  const document = {
    getElementById(id) {
      if (!elementCache.has(id)) {
        elementCache.set(id, createElement(id));
      }
      return elementCache.get(id);
    },
    querySelectorAll() {
      return [];
    },
    querySelector(selector) {
      const longTextId = selector.match(/^\[data-long-text-id="([^"]+)"\]$/)?.[1];
      if (longTextId) {
        return longTextNodes.get(longTextId) ?? null;
      }
      return null;
    },
    createElement(tagName) {
      return createElement(tagName);
    },
    addEventListener(event, callback) {
      if (event === 'DOMContentLoaded') {
        domReadyCallbacks.push(callback);
      }
    }
  };

  const chrome = {
    runtime: {
      onMessage: {
        addListener() {}
      },
      sendMessage(message, callback) {
        sentMessages.push(message);
        if (message.type === 'GET_RESPONSE') {
          const entry = responseMap[message.aiType];
          if (Array.isArray(entry)) {
            const next = entry.length > 1 ? entry.shift() : entry[0] ?? null;
            if (next && typeof next === 'object' && !Array.isArray(next)) {
              callback?.({
                content: next.content ?? null,
                streamingActive: Boolean(next.streamingActive),
                captureState: next.captureState ?? 'complete'
              });
              return;
            }
            callback?.({ content: next || null, streamingActive: false, captureState: 'complete' });
            return;
          }
          if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
            callback?.({
              content: entry.content ?? null,
              streamingActive: Boolean(entry.streamingActive),
              captureState: entry.captureState ?? 'complete'
            });
            return;
          }
          callback?.({ content: entry || null, streamingActive: false, captureState: 'complete' });
          return;
        }
        callback?.({ success: true, content: null });
      }
    },
    tabs: {
      async query() {
        return [];
      }
    }
  };

  const context = vm.createContext({
    console,
    document,
    chrome,
    confirm: () => true,
    setInterval: trackedSetInterval,
    clearInterval: trackedClearInterval,
    setTimeout: trackedSetTimeout,
    clearTimeout: trackedClearTimeout,
    Date,
    Promise,
    Map,
    Set,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    JSON,
    globalThis: null
  });
  context.globalThis = context;

  const source = fs.readFileSync(PANEL_JS, 'utf8') + `
  globalThis.__panelTest = {
    handleSend,
    handleCrossReference,
    handleMutualReview,
    log,
    parseMessage
  };
  `;

  vm.runInContext(source, context);
  domReadyCallbacks.forEach((callback) => callback());

  const panel = {
    api: context.__panelTest,
    getElementById: (id) => document.getElementById(id),
    querySelector: (selector) => document.querySelector(selector),
    getRuntimeMessages: () => sentMessages,
    getSentMessages: () => sentMessages.filter((message) => message.type === 'SEND_MESSAGE'),
    getActiveIntervalCount: () => activeIntervals.size,
    getActiveTimeoutCount: () => activeTimeouts.size,
    dispose() {
      for (const handle of Array.from(activeIntervals)) {
        trackedClearInterval(handle);
      }
      for (const handle of Array.from(activeTimeouts)) {
        trackedClearTimeout(handle);
      }
    }
  };

  loadedPanels.add(panel);
  return panel;
}

test('panel test harness can dispose active normal-mode timers after each test', async () => {
  const panel = loadPanel({ claude: ['Claude 的旧回复', 'Claude 的最新回复'] }, { auditTimers: true });

  panel.getElementById('message-input').value = '请继续';
  panel.getElementById('target-claude').checked = true;

  await panel.api.handleSend();

  assert.ok(panel.getActiveIntervalCount() > 0);
  assert.equal(typeof panel.dispose, 'function');

  panel.dispose();

  assert.equal(panel.getActiveIntervalCount(), 0);
  assert.equal(panel.getActiveTimeoutCount(), 0);
});

test('/mutual always appends Chinese reply protocol to evaluation prompt', async () => {
  const panel = loadPanel({
    chatgpt: 'ChatGPT 的观点',
    claude: 'Claude 的观点'
  });

  await panel.api.handleMutualReview(['chatgpt', 'claude'], 'Please critique the responses.');

  const messages = panel.getSentMessages().map((message) => message.message);

  assert.equal(messages.length, 2);
  assert.ok(messages.every((message) => message.includes('请用中文回复')));
  assert.ok(messages.every((message) => message.includes('Please critique the responses.')));
});

test('/cross always appends Chinese reply protocol to generated prompt', async () => {
  const panel = loadPanel({
    chatgpt: 'ChatGPT 的观点'
  });

  await panel.api.handleCrossReference({
    sourceAIs: ['chatgpt'],
    targetAIs: ['claude'],
    originalMessage: 'Please evaluate this response.',
    mentions: ['chatgpt', 'claude'],
    crossRef: true
  });

  const messages = panel.getSentMessages().map((message) => message.message);

  assert.equal(messages.length, 1);
  assert.ok(messages[0].includes('请用中文回复'));
  assert.ok(messages[0].includes('<chatgpt_response>'));
  assert.ok(messages[0].includes('Please evaluate this response.'));
});

test('log renders long messages inside the shared long-text container', () => {
  const panel = loadPanel();
  const longMessage = '这是一个需要走共享长文本展示协议的日志消息。'.repeat(30);

  panel.api.log(longMessage, 'success');

  const logEntryHtml = panel.getElementById('log-container').children[0]?.innerHTML ?? '';
  const longTextId = extractLongTextId(logEntryHtml);

  assert.match(logEntryHtml, /long-text-block/, 'expected long log messages to render shared long-text markup');
  assert.ok(longTextId, 'expected the log entry to include a data-long-text-id marker');
  assert.ok(
    panel.querySelector(`[data-long-text-id="${longTextId}"]`),
    'expected the fake DOM to expose the rendered long-text node'
  );
  assert.ok(
    panel.querySelector(`[data-long-text-id="${longTextId}"]`)?.closest('.long-text-toggle'),
    'expected the rendered long-text node to resolve its long-text toggle ancestor'
  );
});

test('shared long-text preview CSS keeps collapsed content scrollable', () => {
  const css = fs.readFileSync(new URL('../sidepanel/panel.css', import.meta.url), 'utf8');
  const previewBlock = css.match(/\.long-text-preview\s*\{([\s\S]*?)\}/)?.[1] ?? '';

  assert.ok(previewBlock, 'expected .long-text-preview styles to exist');
  assert.match(previewBlock, /max-height\s*:\s*120px/, 'expected collapsed preview to clamp height');
  assert.match(previewBlock, /overflow-y\s*:\s*auto/, 'expected collapsed preview to scroll internally');
});

test('shared long-text expanded CSS removes the internal height clamp', () => {
  const css = fs.readFileSync(new URL('../sidepanel/panel.css', import.meta.url), 'utf8');
  const fullBlocks = Array.from(css.matchAll(/\.long-text-full\s*\{([\s\S]*?)\}/g));
  const fullBlock = fullBlocks.at(-1)?.[1] ?? '';

  assert.ok(fullBlock, 'expected .long-text-full styles to exist');
  assert.match(fullBlock, /max-height\s*:\s*none/, 'expected expanded content to remove the fixed height limit');
  assert.match(fullBlock, /overflow\s*:\s*visible/, 'expected expanded content to stop scrolling internally');
});

test('normal send polls latest responses when push capture is missing', async () => {
  const panel = loadPanel({
    claude: ['Claude 的旧回复', 'Claude 的最新回复']
  });

  panel.getElementById('message-input').value = '请继续';
  panel.getElementById('target-claude').checked = true;

  await panel.api.handleSend();
  await new Promise((resolve) => setTimeout(resolve, 700));

  const runtimeMessages = panel.getRuntimeMessages();
  const sendMessages = runtimeMessages.filter((message) => message.type === 'SEND_MESSAGE' && message.aiType === 'claude');
  const pullMessages = runtimeMessages.filter((message) => message.type === 'GET_RESPONSE' && message.aiType === 'claude');

  assert.equal(sendMessages.length, 1);
  assert.equal(panel.getElementById('send-btn').disabled, false);
  assert.equal(
    pullMessages.length,
    2,
    'expected normal mode to capture a baseline and then actively poll GET_RESPONSE for a newer reply'
  );
});

test('normal mode keeps ChatGPT pending when a truncated long reply is still unknown and only accepts the fuller tail later', async () => {
  const panel = loadPanel({
    chatgpt: [
      { content: 'ChatGPT 的旧回复', streamingActive: false, captureState: 'complete' },
      { content: '我会把它的总体判断改成这样：这篇文', streamingActive: false, captureState: 'unknown' },
      { content: '我会把它的总体判断改成这样：这篇文', streamingActive: false, captureState: 'unknown' },
      { content: '我会把它的总体判断改成这样：这篇文章在论证结构上是成立的，但结尾需要补上风险边界与适用范围。', streamingActive: false, captureState: 'complete' },
      { content: '我会把它的总体判断改成这样：这篇文章在论证结构上是成立的，但结尾需要补上风险边界与适用范围。', streamingActive: false, captureState: 'complete' }
    ]
  });

  panel.getElementById('message-input').value = '请继续展开';
  panel.getElementById('target-chatgpt').checked = true;

  await panel.api.handleSend();
  await new Promise((resolve) => setTimeout(resolve, 2800));

  const runtimeMessages = panel.getRuntimeMessages();
  const pullMessages = runtimeMessages.filter((message) => message.type === 'GET_RESPONSE' && message.aiType === 'chatgpt');

  assert.equal(panel.getElementById('send-btn').disabled, false);
  assert.ok(
    pullMessages.length >= 6,
    `expected normal mode to keep polling through unknown plateau and fuller tail stabilization, got ${pullMessages.length}`
  );
});

test('panel polling logic uses shared helper for normal and discussion flows', () => {
  const source = fs.readFileSync(PANEL_JS, 'utf8');

  assert.match(source, /function createPollingController\(/, 'expected a shared polling controller factory');
  assert.match(source, /function captureResponseBaselines\(/, 'expected a shared baseline capture helper');
  assert.match(source, /function startResponsePolling\(/, 'expected a shared polling loop helper');
  assert.match(source, /captureResponseBaselines\(normalPollingController, targets/, 'expected normal mode to use the shared baseline helper');
  assert.match(source, /captureResponseBaselines\(discussionPollingController, selected/, 'expected discussion start to use the shared baseline helper');
  assert.match(source, /captureResponseBaselines\(discussionPollingController, participants/, 'expected discussion follow-up stages to use the shared baseline helper');
});

test('parseMessage accepts Doubao mentions in direct cross-reference syntax', () => {
  const panel = loadPanel();

  const parsed = panel.api.parseMessage('@Doubao 评价一下 @Claude');

  assert.equal(parsed.crossRef, true);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.targetAIs)), ['doubao']);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.sourceAIs)), ['claude']);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.mentions)), ['doubao', 'claude']);
});

test('parseMessage accepts Doubao in explicit /cross routing', () => {
  const panel = loadPanel();

  const parsed = panel.api.parseMessage('/cross @Claude @Doubao <- @ChatGPT 对比一下');

  assert.equal(parsed.crossRef, true);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.targetAIs)), ['claude', 'doubao']);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.sourceAIs)), ['chatgpt']);
  assert.equal(parsed.originalMessage, '对比一下');
});

test('normal send includes doubao when its checkbox is selected', async () => {
  const panel = loadPanel();

  panel.getElementById('message-input').value = '请给出你的判断';
  panel.getElementById('target-doubao').checked = true;
  panel.getElementById('target-claude').checked = false;
  panel.getElementById('target-chatgpt').checked = false;
  panel.getElementById('target-gemini').checked = false;

  await panel.api.handleSend();

  const sendMessages = panel.getSentMessages();

  assert.equal(sendMessages.length, 1);
  assert.equal(sendMessages[0].aiType, 'doubao');
  assert.equal(sendMessages[0].message, '请给出你的判断');
});

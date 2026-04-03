import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const PANEL_JS = new URL('../sidepanel/panel.js', import.meta.url);

function extractLongTextId(html) {
  return html.match(/data-long-text-id="([^"]+)"/)?.[1] ?? null;
}

function loadPanel(responseMap = {}) {
  const elementCache = new Map();
  const longTextNodes = new Map();
  const domReadyCallbacks = [];
  const sentMessages = [];

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
          callback?.({ content: responseMap[message.aiType] || null });
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
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
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
    handleCrossReference,
    handleMutualReview,
    log
  };
  `;

  vm.runInContext(source, context);
  domReadyCallbacks.forEach((callback) => callback());

  return {
    api: context.__panelTest,
    getElementById: (id) => document.getElementById(id),
    querySelector: (selector) => document.querySelector(selector),
    getSentMessages: () => sentMessages.filter((message) => message.type === 'SEND_MESSAGE')
  };
}

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

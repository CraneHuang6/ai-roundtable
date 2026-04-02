import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function createElement(id = '') {
  return {
    id,
    value: '',
    textContent: '',
    innerHTML: '',
    className: '',
    title: '',
    disabled: false,
    checked: false,
    selectionStart: 0,
    selectionEnd: 0,
    children: [],
    dataset: {},
    style: {},
    focus() {},
    addEventListener() {},
    dispatchEvent() {},
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    insertBefore(child) {
      this.children.unshift(child);
      return child;
    },
    removeChild() {
      return this.children.pop();
    },
    querySelector() {
      return createElement();
    },
    querySelectorAll() {
      return [];
    },
    classList: {
      add() {},
      remove() {}
    }
  };
}

function loadPanel(responseMap = {}) {
  const elementCache = new Map();
  const domReadyCallbacks = [];
  const sentMessages = [];
  let onMessageListener = null;

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
    querySelector() {
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
        addListener(listener) {
          onMessageListener = listener;
        }
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

  const source = fs.readFileSync('D:/Coding/ai-roundtable/sidepanel/panel.js', 'utf8') + `
  globalThis.__panelTest = {
    handleCrossReference,
    handleMutualReview
  };
  `;

  chrome.runtime.onMessage.addListener = (listener) => {
    onMessageListener = listener;
    context.__onMessageListener = listener;
  };

  vm.runInContext(source, context);
  domReadyCallbacks.forEach((callback) => callback());

  return {
    api: context.__panelTest,
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

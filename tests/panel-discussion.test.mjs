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

function loadPanel() {
  const elementCache = new Map();
  const domReadyCallbacks = [];
  const sentMessages = [];
  let selectedParticipants = [];
  let onMessageListener = null;

  const document = {
    getElementById(id) {
      if (!elementCache.has(id)) {
        elementCache.set(id, createElement(id));
      }
      return elementCache.get(id);
    },
    querySelectorAll(selector) {
      if (selector === 'input[name="participant"]:checked') {
        return selectedParticipants.map(value => ({ value }));
      }
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
    getDiscussionState: () => discussionState,
    setDiscussionState: (value) => { discussionState = value; },
    getOnMessageListener: () => globalThis.__onMessageListener,
    startDiscussion,
    nextRound
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
    getElementById: (id) => document.getElementById(id),
    getOnMessageListener: () => onMessageListener,
    getSentMessages: () => sentMessages,
    setSelectedParticipants: (participants) => {
      selectedParticipants = [...participants];
    }
  };
}

test('discussion mode keeps the latest fuller capture for the same AI in the same round', () => {
  const panel = loadPanel();
  const listener = panel.getOnMessageListener();

  panel.api.setDiscussionState({
    active: true,
    topic: 'Claude Code 和 Codex 哪个更适合非程序员使用？',
    participants: ['chatgpt', 'claude'],
    currentRound: 1,
    history: [],
    pendingResponses: new Set(['chatgpt', 'claude']),
    roundType: 'initial'
  });

  listener({ type: 'RESPONSE_CAPTURED', aiType: 'chatgpt', content: '我先按四个维度对比一下。' });
  listener({ type: 'RESPONSE_CAPTURED', aiType: 'claude', content: '我认为 Claude Code 更适合懂一点终端的人。' });
  listener({ type: 'RESPONSE_CAPTURED', aiType: 'chatgpt', content: '我先按四个维度对比一下，再给结论。对于非程序员，关键差别在环境依赖和出错后的自救能力。' });

  const state = panel.api.getDiscussionState();
  const chatgptEntries = state.history.filter((entry) => entry.round === 1 && entry.ai === 'chatgpt');

  assert.equal(chatgptEntries.length, 1);
  assert.equal(
    chatgptEntries[0].content,
    '我先按四个维度对比一下，再给结论。对于非程序员，关键差别在环境依赖和出错后的自救能力。'
  );
});

test('discussion mode uses Chinese prompts in every discussion stage', async () => {
  const panel = loadPanel();
  panel.setSelectedParticipants(['chatgpt', 'claude']);
  panel.getElementById('discussion-topic').value = 'Claude Code 和 Codex 哪个更适合非程序员使用？';

  await panel.api.startDiscussion();

  const initialMessages = panel.getSentMessages()
    .filter((message) => message.type === 'SEND_MESSAGE')
    .map((message) => message.message);

  assert.equal(initialMessages.length, 2);
  assert.ok(initialMessages.every((message) => message.includes('中文回复')));
  assert.ok(initialMessages.every((message) => !message.includes('Please share your thoughts')));

  panel.api.setDiscussionState({
    active: true,
    topic: 'Claude Code 和 Codex 哪个更适合非程序员使用？',
    participants: ['chatgpt', 'claude'],
    currentRound: 1,
    history: [
      { round: 1, ai: 'chatgpt', type: 'initial', content: '我认为 Claude Code 更适合轻度技术用户。' },
      { round: 1, ai: 'claude', type: 'initial', content: '我认为 Codex 对非程序员更容易直接上手。' }
    ],
    pendingResponses: new Set(),
    roundType: 'initial'
  });

  await panel.api.nextRound();

  const crossEvalMessages = panel.getSentMessages()
    .filter((message) => message.type === 'SEND_MESSAGE')
    .slice(-2)
    .map((message) => message.message);

  assert.equal(crossEvalMessages.length, 2);
  assert.ok(crossEvalMessages.every((message) => message.includes('请用中文回复')));
  assert.ok(crossEvalMessages.every((message) => message.includes('请评价这段回复')));
  assert.ok(crossEvalMessages.every((message) => !message.includes('Please evaluate this response')));
  assert.ok(crossEvalMessages.every((message) => !message.includes('Here is ')));
});

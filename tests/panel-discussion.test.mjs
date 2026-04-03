import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const PANEL_JS = new URL('../sidepanel/panel.js', import.meta.url);
const PANEL_CSS = new URL('../sidepanel/panel.css', import.meta.url);

function extractLongTextId(html) {
  return html.match(/data-long-text-id="([^"]+)"/)?.[1] ?? null;
}

function loadPanel() {
  const elementCache = new Map();
  const longTextNodes = new Map();
  const domReadyCallbacks = [];
  const sentMessages = [];
  const latestResponses = new Map();
  let selectedParticipants = [];
  let onMessageListener = null;

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
    querySelectorAll(selector) {
      if (selector === 'input[name="participant"]:checked') {
        return selectedParticipants.map(value => ({ value }));
      }
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
        addListener(listener) {
          onMessageListener = listener;
        }
      },
      sendMessage(message, callback) {
        sentMessages.push(message);

        if (message.type === 'GET_RESPONSE') {
          callback?.({ success: true, content: latestResponses.get(message.aiType) ?? null });
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
    getDiscussionState: () => discussionState,
    setDiscussionState: (value) => { discussionState = value; },
    getOnMessageListener: () => globalThis.__onMessageListener,
    validateParticipants,
    startDiscussion,
    nextRound,
    handleInterject,
    generateSummary,
    showSummary
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
    querySelector: (selector) => document.querySelector(selector),
    getOnMessageListener: () => onMessageListener,
    getSentMessages: () => sentMessages,
    getDiscussionMessages: () => sentMessages.filter((message) => message.type === 'SEND_MESSAGE'),
    setSelectedParticipants: (participants) => {
      selectedParticipants = [...participants];
    },
    setLatestResponses: (responses) => {
      latestResponses.clear();
      Object.entries(responses).forEach(([ai, content]) => latestResponses.set(ai, content));
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

test('discussion mode uses Chinese prompts in start and next-round cross-evaluation stages', async () => {
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
  assert.ok(crossEvalMessages.every((message) => message.includes('请评价')));
  assert.ok(crossEvalMessages.every((message) => !message.includes('Please evaluate this response')));
  assert.ok(crossEvalMessages.every((message) => !message.includes('Here is ')));
});

test('discussion topic renders long text through the shared long-text container', async () => {
  const panel = loadPanel();
  panel.setSelectedParticipants(['chatgpt', 'claude']);
  panel.getElementById('discussion-topic').value = '这是一个需要通过共享长文本容器展示的讨论主题。'.repeat(30);

  await panel.api.startDiscussion();

  const topicDisplay = panel.getElementById('topic-display');
  const longTextId = extractLongTextId(topicDisplay.innerHTML);

  assert.match(topicDisplay.innerHTML, /long-text-block/, 'expected discussion topic to render shared long-text markup');
  assert.ok(longTextId, 'expected discussion topic to include a data-long-text-id marker');
  assert.ok(
    panel.querySelector(`[data-long-text-id="${longTextId}"]`),
    'expected the fake DOM to expose the rendered topic long-text node'
  );
  assert.ok(
    panel.querySelector(`[data-long-text-id="${longTextId}"]`)?.closest('.long-text-toggle'),
    'expected the rendered topic long-text node to resolve its long-text toggle ancestor'
  );
});

test('discussion summary renders long text through the shared long-text container', () => {
  const panel = loadPanel();
  const longSummary = '这是一个需要通过共享长文本容器展示的总结内容。'.repeat(30);

  panel.api.setDiscussionState({
    active: true,
    topic: '长文本总结测试主题',
    participants: ['chatgpt', 'claude'],
    currentRound: 1,
    history: [
      { round: 1, ai: 'chatgpt', type: 'initial', content: longSummary },
      { round: 1, ai: 'claude', type: 'initial', content: longSummary }
    ],
    pendingResponses: new Set(),
    roundType: 'summary'
  });

  panel.api.showSummary(longSummary, longSummary);

  const summaryHtml = panel.getElementById('summary-content').innerHTML;
  const longTextId = extractLongTextId(summaryHtml);

  assert.match(summaryHtml, /long-text-block/, 'expected discussion summary to render shared long-text markup');
  assert.ok(longTextId, 'expected discussion summary to include a data-long-text-id marker');
  assert.ok(
    panel.querySelector(`[data-long-text-id="${longTextId}"]`),
    'expected the fake DOM to expose the rendered summary long-text node'
  );
  assert.ok(
    panel.querySelector(`[data-long-text-id="${longTextId}"]`)?.closest('.long-text-toggle'),
    'expected the rendered summary long-text node to resolve its long-text toggle ancestor'
  );
});

test('discussion mode enables start only for 2 or 3 selected participants', () => {
  const panel = loadPanel();
  const startButton = panel.getElementById('start-discussion-btn');

  panel.setSelectedParticipants(['claude']);
  panel.api.validateParticipants();
  assert.equal(startButton.disabled, true);

  panel.setSelectedParticipants(['claude', 'chatgpt']);
  panel.api.validateParticipants();
  assert.equal(startButton.disabled, false);

  panel.setSelectedParticipants(['claude', 'chatgpt', 'gemini']);
  panel.api.validateParticipants();
  assert.equal(startButton.disabled, false);
});

test('discussion start stores all selected participants and renders a neutral participant badge', async () => {
  const panel = loadPanel();
  panel.setSelectedParticipants(['claude', 'chatgpt', 'gemini']);
  panel.getElementById('discussion-topic').value = '三方讨论主题';

  await panel.api.startDiscussion();

  const state = panel.api.getDiscussionState();
  assert.deepEqual(Array.from(state.participants), ['claude', 'chatgpt', 'gemini']);

  const badgeText = panel.getElementById('participants-badge').textContent;
  assert.match(badgeText, /Claude/);
  assert.match(badgeText, /ChatGPT/);
  assert.match(badgeText, /Gemini/);
  assert.doesNotMatch(badgeText, /vs/);

  const statusText = panel.getElementById('discussion-status').textContent;
  assert.match(statusText, /Claude/);
  assert.match(statusText, /ChatGPT/);
  assert.match(statusText, /Gemini/);
});

test('next round sends each participant the other two previous-round replies in three-party mode', async () => {
  const panel = loadPanel();

  panel.api.setDiscussionState({
    active: true,
    topic: '多方协作的优缺点',
    participants: ['claude', 'chatgpt', 'gemini'],
    currentRound: 1,
    history: [
      { round: 1, ai: 'claude', type: 'initial', content: 'Claude 初始观点' },
      { round: 1, ai: 'chatgpt', type: 'initial', content: 'ChatGPT 初始观点' },
      { round: 1, ai: 'gemini', type: 'initial', content: 'Gemini 初始观点' }
    ],
    pendingResponses: new Set(),
    roundType: 'initial'
  });

  await panel.api.nextRound();

  const messages = panel.getDiscussionMessages().slice(-3);
  assert.equal(messages.length, 3);

  const claudePrompt = messages.find((message) => message.aiType === 'claude')?.message ?? '';
  const chatgptPrompt = messages.find((message) => message.aiType === 'chatgpt')?.message ?? '';
  const geminiPrompt = messages.find((message) => message.aiType === 'gemini')?.message ?? '';

  assert.match(claudePrompt, /<chatgpt_response>[\s\S]*ChatGPT 初始观点/);
  assert.match(claudePrompt, /<gemini_response>[\s\S]*Gemini 初始观点/);
  assert.match(chatgptPrompt, /<claude_response>[\s\S]*Claude 初始观点/);
  assert.match(chatgptPrompt, /<gemini_response>[\s\S]*Gemini 初始观点/);
  assert.match(geminiPrompt, /<claude_response>[\s\S]*Claude 初始观点/);
  assert.match(geminiPrompt, /<chatgpt_response>[\s\S]*ChatGPT 初始观点/);
  assert.ok(messages.every((message) => message.message.includes('请始终使用中文回复') || message.message.includes('请用中文回复')));
});

test('interject sends each participant the user message plus all other latest replies', async () => {
  const panel = loadPanel();
  panel.api.setDiscussionState({
    active: true,
    topic: '三方插话测试',
    participants: ['claude', 'chatgpt', 'gemini'],
    currentRound: 2,
    history: [],
    pendingResponses: new Set(),
    roundType: 'cross-eval'
  });

  panel.setLatestResponses({
    claude: 'Claude 最新回复',
    chatgpt: 'ChatGPT 最新回复',
    gemini: 'Gemini 最新回复'
  });
  panel.getElementById('interject-input').value = '请聚焦工程复杂度';

  await panel.api.handleInterject();

  const messages = panel.getDiscussionMessages().slice(-3);
  assert.equal(messages.length, 3);
  const claudeMessage = messages.find((message) => message.aiType === 'claude')?.message ?? '';
  const chatgptMessage = messages.find((message) => message.aiType === 'chatgpt')?.message ?? '';
  const geminiMessage = messages.find((message) => message.aiType === 'gemini')?.message ?? '';

  assert.match(claudeMessage, /ChatGPT 最新回复/);
  assert.match(claudeMessage, /Gemini 最新回复/);
  assert.match(chatgptMessage, /Claude 最新回复/);
  assert.match(chatgptMessage, /Gemini 最新回复/);
  assert.match(geminiMessage, /Claude 最新回复/);
  assert.match(geminiMessage, /ChatGPT 最新回复/);
});

test('summary view renders one summary card per selected participant', () => {
  const panel = loadPanel();
  panel.api.setDiscussionState({
    active: true,
    topic: '总结卡片测试',
    participants: ['claude', 'chatgpt', 'gemini'],
    currentRound: 1,
    history: [
      { round: 1, ai: 'claude', type: 'initial', content: 'Claude 历史内容' },
      { round: 1, ai: 'chatgpt', type: 'initial', content: 'ChatGPT 历史内容' },
      { round: 1, ai: 'gemini', type: 'initial', content: 'Gemini 历史内容' }
    ],
    pendingResponses: new Set(),
    roundType: 'summary'
  });

  panel.api.showSummary('Claude 总结', 'ChatGPT 总结', 'Gemini 总结');

  const html = panel.getElementById('summary-content').innerHTML;
  assert.match(html, /Claude 的总结/);
  assert.match(html, /ChatGPT 的总结/);
  assert.match(html, /Gemini 的总结/);
  assert.doesNotMatch(html, /双方总结对比/);

  const summaryCardCount = (html.match(/的总结：/g) || []).length;
  assert.equal(summaryCardCount, 3, 'should render exactly 3 summary cards for 3 participants');
});

test('discussion mode keeps the action area accessible in a stable stacked layout', () => {
  const css = fs.readFileSync(PANEL_CSS, 'utf8');
  const discussionActiveBlock = css.match(/\.discussion-active\s*\{([\s\S]*?)\}/)?.[1] ?? '';
  const discussionInterjectBlock = css.match(/\.discussion-interject\s*\{([\s\S]*?)\}/)?.[1] ?? '';
  const interjectInputBlock = css.match(/#interject-input\s*\{([\s\S]*?)\}/)?.[1] ?? '';
  const interjectActionsBlock = css.match(/\.interject-actions\s*\{([\s\S]*?)\}/)?.[1] ?? '';
  const interjectButtonBlock = css.match(/#interject-btn\s*\{([\s\S]*?)\}/)?.[1] ?? '';
  const discussionControlsBlock = css.match(/\.discussion-controls\s*\{([\s\S]*?)\}/)?.[1] ?? '';
  const discussionControlsButtonBlock = css.match(/\.discussion-controls button\s*\{([\s\S]*?)\}/)?.[1] ?? '';
  const discussionHeaderBlock = css.match(/\.discussion-header\s*\{([\s\S]*?)\}/)?.[1] ?? '';
  const discussionInfoBlock = css.match(/\.discussion-info\s*\{([\s\S]*?)\}/)?.[1] ?? '';
  const endButtonBlock = css.match(/\.end-btn\s*\{([\s\S]*?)\}/)?.[1] ?? '';
  const discussionLogBlock = css.match(/#discussion-mode:not\(\.hidden\)\s*~\s*\.log\s*\{([\s\S]*?)\}/)?.[1] ?? '';
  const discussionCopyrightBlock = css.match(/#discussion-mode:not\(\.hidden\)\s*~\s*\.copyright\s*\{([\s\S]*?)\}/)?.[1] ?? '';

  assert.ok(discussionActiveBlock, 'expected .discussion-active styles to exist');
  assert.ok(discussionHeaderBlock, 'expected .discussion-header styles to exist');
  assert.ok(discussionInfoBlock, 'expected .discussion-info styles to exist');
  assert.ok(endButtonBlock, 'expected .end-btn styles to exist');
  assert.ok(discussionInterjectBlock, 'expected .discussion-interject styles to exist');
  assert.ok(interjectInputBlock, 'expected #interject-input styles to exist');
  assert.ok(interjectActionsBlock, 'expected .interject-actions styles to exist');
  assert.ok(interjectButtonBlock, 'expected #interject-btn styles to exist');
  assert.ok(discussionControlsBlock, 'expected .discussion-controls styles to exist');
  assert.ok(discussionControlsButtonBlock, 'expected .discussion-controls button styles to exist');
  assert.ok(discussionLogBlock, 'expected a discussion-mode specific log height rule');
  assert.ok(discussionCopyrightBlock, 'expected a discussion-mode specific copyright rule');
  assert.match(
    discussionActiveBlock,
    /overflow-y\s*:\s*auto/,
    'discussion body should scroll instead of clipping bottom actions when content grows'
  );
  assert.match(
    discussionHeaderBlock,
    /gap\s*:\s*8px/,
    'discussion header should keep an explicit gap so the end button does not stick to the info group in narrow panels'
  );
  assert.match(
    discussionInfoBlock,
    /min-width\s*:\s*0/,
    'discussion info group should allow shrinking inside narrow headers'
  );
  assert.match(
    discussionInfoBlock,
    /flex-wrap\s*:\s*wrap/,
    'discussion info group should wrap its badges in ultra narrow sidepanels'
  );
  assert.match(
    endButtonBlock,
    /flex-shrink\s*:\s*0/,
    'end button should resist shrinking in narrow headers'
  );
  assert.ok(
    !/\bflex\s*:\s*1\b/.test(discussionInterjectBlock),
    'discussion interject container should not consume all remaining height'
  );
  assert.match(
    discussionInterjectBlock,
    /flex-shrink\s*:\s*0/,
    'discussion interject container should resist flex shrinking so its textarea and send button stay in normal flow'
  );
  assert.match(
    interjectInputBlock,
    /flex\s*:\s*none/,
    'interject textarea should keep a fixed footprint instead of stretching vertically'
  );
  assert.match(
    interjectInputBlock,
    /min-height\s*:\s*56px/,
    'interject textarea should use a reduced minimum height to preserve action visibility'
  );
  assert.match(
    interjectActionsBlock,
    /flex-shrink\s*:\s*0/,
    'interject action row should resist shrinking so the send button stays visible'
  );
  assert.match(
    interjectButtonBlock,
    /width\s*:\s*100%/,
    'interject send button should span the full row to avoid horizontal collisions'
  );
  assert.match(
    discussionControlsBlock,
    /flex-direction\s*:\s*column/,
    'discussion footer controls should stack vertically to stay visible in narrow panels'
  );
  assert.match(
    discussionControlsButtonBlock,
    /width\s*:\s*100%/,
    'discussion footer buttons should span the full row in the stacked layout'
  );
  assert.match(
    discussionControlsButtonBlock,
    /flex\s*:\s*none/,
    'discussion footer buttons should stop competing for horizontal space'
  );
  assert.match(
    discussionLogBlock,
    /max-height\s*:\s*36px/,
    'discussion mode should aggressively compress the activity log in ultra narrow sidepanel layouts to leave room for primary actions'
  );
  assert.match(
    discussionCopyrightBlock,
    /display\s*:\s*none/,
    'discussion mode should hide the copyright footer to prioritize primary actions in the sidepanel viewport'
  );
  assert.match(
    css,
    /\.discussion-topic-display\s*\{[\s\S]*?padding\s*:\s*12px/,
    'discussion topic display should use tighter padding for the sidepanel layout'
  );
  assert.match(
    css,
    /\.discussion-status\s*\{[\s\S]*?padding\s*:\s*10px\s+12px/,
    'discussion status should use tighter padding for the sidepanel layout'
  );
});

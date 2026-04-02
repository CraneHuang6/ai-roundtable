import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function createElement({ text = '', parent = null, markdownAncestor = false, order = 0 } = {}) {
  const element = {
    parentElement: parent,
    order,
    get innerText() {
      return text;
    },
    contains(node) {
      let current = node;
      while (current) {
        if (current === element) return true;
        current = current.parentElement || null;
      }
      return false;
    },
    closest(selector) {
      if (selector === '.markdown, [class*="markdown"]') {
        return markdownAncestor ? {} : null;
      }
      return null;
    },
    compareDocumentPosition(other) {
      if (element.order < other.order) return 4;
      if (element.order > other.order) return 2;
      return 0;
    }
  };

  return element;
}

function loadChatgptExtractor(state) {
  const assistantContainer = {
    querySelectorAll(selector) {
      if (selector === '.markdown, [class*="markdown"]') {
        return state.markdownEls || [];
      }
      if (selector === '[class*="canvas"], [class*="text-block"], [class*="code-block"], pre code') {
        return state.canvasEls || [];
      }
      return [];
    },
    get innerText() {
      return state.fallbackText || '';
    }
  };

  const document = {
    readyState: 'complete',
    body: {},
    addEventListener() {},
    querySelector() {
      return null;
    },
    querySelectorAll(selector) {
      if (
        selector === '[data-message-author-role="assistant"]' ||
        selector === '[data-testid*="conversation-turn"]:has([data-message-author-role="assistant"])' ||
        selector === '.agent-turn'
      ) {
        return [assistantContainer];
      }
      return [];
    }
  };

  const chrome = {
    runtime: {
      id: 'test-extension',
      sendMessage() {},
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

  const context = vm.createContext({
    console,
    document,
    chrome,
    MutationObserver,
    Event: class Event {},
    Node: {
      DOCUMENT_POSITION_PRECEDING: 2,
      DOCUMENT_POSITION_FOLLOWING: 4
    },
    setTimeout,
    clearTimeout,
    Date,
    Promise,
    globalThis: null
  });
  context.globalThis = context;

  const source = fs.readFileSync('D:/Coding/ai-roundtable/content/chatgpt.js', 'utf8').replace(
    /\s*console\.log\('\[AI Panel\] ChatGPT content script loaded'\);\r?\n\}\)\(\);\s*$/,
    "\n  globalThis.__chatgptTest = { getLatestResponse };\n  console.log('[AI Panel] ChatGPT content script loaded');\n})();\n"
  );

  vm.runInContext(source, context);
  return context.__chatgptTest;
}

test('chatgpt response extraction deduplicates nested markdown blocks and preserves unique additions', () => {
  const markdownParent = createElement({ text: '第一段\n\n第二段' });
  const markdownChild = createElement({ text: '第二段', parent: markdownParent });
  const uniqueCanvas = createElement({ text: '补充观点' });

  const api = loadChatgptExtractor({
    markdownEls: [markdownParent, markdownChild],
    canvasEls: [uniqueCanvas],
    fallbackText: '第一段\n\n第二段\n\n补充观点'
  });

  assert.equal(api.getLatestResponse(), '第一段\n\n第二段\n\n补充观点');
});

test('chatgpt response extraction merges partially overlapping markdown and code block text', () => {
  const markdownParent = createElement({ text: '安装命令：\nnode app.js\n\n运行结果：成功', order: 1 });
  const codeBlock = createElement({ text: 'node app.js\n\n运行结果：成功\n\n下一步：检查日志', order: 2 });

  const api = loadChatgptExtractor({
    markdownEls: [markdownParent],
    canvasEls: [codeBlock],
    fallbackText: '安装命令：\nnode app.js\n\n运行结果：成功\n\n下一步：检查日志'
  });

  assert.equal(
    api.getLatestResponse(),
    '安装命令：\nnode app.js\n\n运行结果：成功\n\n下一步：检查日志'
  );
});

test('chatgpt response extraction respects DOM order for reverse overlap between code block and markdown', () => {
  const codeBlock = createElement({ text: 'node app.js\n\n运行结果：成功', order: 1 });
  const markdownParent = createElement({ text: '运行结果：成功\n\n结论：可以继续', order: 2 });

  const api = loadChatgptExtractor({
    markdownEls: [markdownParent],
    canvasEls: [codeBlock],
    fallbackText: 'node app.js\n\n运行结果：成功\n\n结论：可以继续'
  });

  assert.equal(
    api.getLatestResponse(),
    'node app.js\n\n运行结果：成功\n\n结论：可以继续'
  );
});

test('chatgpt response extraction does not merge blocks with only short accidental overlap', () => {
  const markdownParent = createElement({ text: '结论：可继续执行。', order: 1 });
  const codeBlock = createElement({ text: '执行。\nrm -rf /tmp/demo', order: 2 });

  const api = loadChatgptExtractor({
    markdownEls: [markdownParent],
    canvasEls: [codeBlock],
    fallbackText: '结论：可继续执行。\n\n执行。\nrm -rf /tmp/demo'
  });

  assert.equal(
    api.getLatestResponse(),
    '结论：可继续执行。\n\n执行。\nrm -rf /tmp/demo'
  );
});

test('chatgpt response extraction keeps middle content in chained A to B to C overlaps', () => {
  const blockA = createElement({ text: '第一步：准备环境\n\n第二步：执行命令', order: 1 });
  const blockB = createElement({ text: '第二步：执行命令\n\n第三步：检查输出', order: 2 });
  const blockC = createElement({ text: '第三步：检查输出\n\n第四步：完成收尾', order: 3 });

  const api = loadChatgptExtractor({
    markdownEls: [blockA, blockC],
    canvasEls: [blockB],
    fallbackText: '第一步：准备环境\n\n第二步：执行命令\n\n第三步：检查输出\n\n第四步：完成收尾'
  });

  assert.equal(
    api.getLatestResponse(),
    '第一步：准备环境\n\n第二步：执行命令\n\n第三步：检查输出\n\n第四步：完成收尾'
  );
});

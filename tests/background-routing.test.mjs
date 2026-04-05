import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function loadBackground(sessionState = {}) {
  const listeners = {
    onClicked: null,
    onUpdated: null,
    onRemoved: null,
    onMessage: null
  };

  const chrome = {
    storage: {
      session: {
        async get(key) {
          return { [key]: sessionState[key] };
        },
        async set(value) {
          Object.assign(sessionState, value);
        }
      }
    },
    action: {
      onClicked: {
        addListener(listener) {
          listeners.onClicked = listener;
        }
      }
    },
    sidePanel: {
      open() {},
      setPanelBehavior() {}
    },
    runtime: {
      onMessage: {
        addListener(listener) {
          listeners.onMessage = listener;
        }
      },
      async sendMessage() {}
    },
    tabs: {
      onUpdated: {
        addListener(listener) {
          listeners.onUpdated = listener;
        }
      },
      onRemoved: {
        addListener(listener) {
          listeners.onRemoved = listener;
        }
      },
      async query() {
        return [];
      },
      async sendMessage() {
        return { success: true };
      }
    }
  };

  const context = vm.createContext({
    console,
    chrome,
    Promise,
    Object,
    Array,
    Map,
    Set,
    String,
    Number,
    Boolean,
    RegExp,
    JSON,
    globalThis: null
  });
  context.globalThis = context;

  const source = fs.readFileSync('D:/Coding/ai-roundtable/.worktrees/doubao-support/background.js', 'utf8') + `
  globalThis.__backgroundTest = {
    getAITypeFromUrl,
    getStoredResponses
  };
  `;

  vm.runInContext(source, context);
  return context.__backgroundTest;
}

test('background maps Doubao host to doubao provider id', () => {
  const api = loadBackground();

  assert.equal(api.getAITypeFromUrl('https://www.doubao.com/chat/123'), 'doubao');
});

test('background stored response defaults include doubao slot', async () => {
  const api = loadBackground();

  const responses = await api.getStoredResponses();

  assert.deepEqual(JSON.parse(JSON.stringify(responses)), {
    claude: null,
    chatgpt: null,
    gemini: null,
    doubao: null
  });
});

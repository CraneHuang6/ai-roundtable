import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function loadBackground(sessionState = {}, options = {}) {
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
        return options.tabs ?? [];
      },
      async sendMessage() {
        return options.realtimeResponse ?? { success: true };
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

  const source = fs.readFileSync(new URL('../background.js', import.meta.url), 'utf8') + `
  globalThis.__backgroundTest = {
    getAITypeFromUrl,
    getStoredResponses,
    getResponseFromContentScript
  };
  `;

  vm.runInContext(source, context);
  return context.__backgroundTest;
}

function loadBackgroundWithRealtimeResponse(realtimeResponse) {
  return loadBackground({}, {
    tabs: [{ id: 1, url: 'https://www.doubao.com/chat/123' }],
    realtimeResponse
  });
}

test('background test harness reads active repo background.js', () => {
  const source = fs.readFileSync(new URL(import.meta.url), 'utf8');

  assert.match(source, /fs\.readFileSync\(new URL\('\.\.\/background\.js', import\.meta\.url\), 'utf8'\)/);
});

test('background maps Doubao host to doubao provider id', () => {
  const api = loadBackground();

  assert.equal(api.getAITypeFromUrl('https://www.doubao.com/chat/123'), 'doubao');
});

test('background maps Qianwen entry host to qianwen provider id', () => {
  const api = loadBackground();

  assert.equal(api.getAITypeFromUrl('https://www.qianwen.com/?ch=tongyi_redirect'), 'qianwen');
});

test('background stored response defaults include doubao and qianwen slots', async () => {
  const api = loadBackground();

  const responses = await api.getStoredResponses();

  assert.deepEqual(JSON.parse(JSON.stringify(responses)), {
    claude: null,
    chatgpt: null,
    gemini: null,
    doubao: null,
    qianwen: null
  });
});

test('background treats missing provider completion metadata as unknown instead of complete', async () => {
  const api = loadBackground();
  globalThis.chrome = undefined;

  const sourceApi = loadBackgroundWithRealtimeResponse({ content: '豆包第一段', streamingActive: undefined, captureState: undefined });
  const response = await sourceApi.getResponseFromContentScript('doubao');

  assert.equal(response.content, '豆包第一段');
  assert.equal(response.streamingActive, false);
  assert.equal(response.captureState, 'unknown');
});

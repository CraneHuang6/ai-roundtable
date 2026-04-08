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
        if (options.sendMessageError) {
          throw options.sendMessageError;
        }
        return options.realtimeResponse ?? { success: true };
      }
    },
    scripting: {
      async executeScript(details) {
        if (typeof options.executeScript === 'function') {
          return await options.executeScript(details);
        }
        throw new Error('executeScript not stubbed');
      }
    },
    debugger: {
      async attach(target, version) {
        if (typeof options.attachDebugger === 'function') {
          return await options.attachDebugger(target, version);
        }
      },
      async sendCommand(target, method, params) {
        if (typeof options.sendDebuggerCommand === 'function') {
          return await options.sendDebuggerCommand(target, method, params);
        }
        return {};
      },
      async detach(target) {
        if (typeof options.detachDebugger === 'function') {
          return await options.detachDebugger(target);
        }
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
    getResponseFromContentScript,
    sendMessageToAI
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

test('background maps Qianwen chat host to qianwen provider id', () => {
  const api = loadBackground();

  assert.equal(api.getAITypeFromUrl('https://www.qianwen.com/chat/d01dedd965df4bfe87bbcf60e2fbe674?ch=tongyi_redirect'), 'qianwen');
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

test('background falls back to debugger-driven qianwen input when content-script sendMessage fails', async () => {
  const executed = [];
  const debuggerCalls = [];
  const debuggerTargets = [];
  const runtimeResults = [
    { x: 100, y: 200 },
    { x: 120, y: 220 }
  ];
  const api = loadBackground({}, {
    tabs: [{ id: 7, url: 'https://www.qianwen.com/?ch=tongyi_redirect' }],
    sendMessageError: new Error('Could not find send button'),
    executeScript(details) {
      executed.push(details);
      return [{ result: null }];
    },
    attachDebugger(target, version) {
      debuggerTargets.push({ type: 'attach', target, version });
    },
    sendDebuggerCommand(target, method, params) {
      debuggerCalls.push({ target, method, params });
      if (method === 'Runtime.evaluate') {
        return { result: { value: runtimeResults.shift() ?? null } };
      }
      return {};
    },
    detachDebugger(target) {
      debuggerTargets.push({ type: 'detach', target });
    }
  });

  const response = await api.sendMessageToAI('qianwen', 'reply with OK only');

  assert.equal(response.success, true, JSON.stringify({ response, debuggerCalls, debuggerTargets, executed }));
  assert.equal(executed.length, 0);
  assert.equal(debuggerTargets[0].type, 'attach');
  assert.equal(debuggerTargets[0].target.tabId, 7);
  assert.equal(debuggerTargets.at(-1).type, 'detach');
  assert.equal(debuggerCalls.some((call) => call.method === 'Runtime.evaluate'), true);
  assert.equal(debuggerCalls.some((call) => call.method === 'Input.dispatchMouseEvent'), true);
});

test('background falls back to debugger-driven qianwen input when content script returns success false', async () => {
  const executed = [];
  const debuggerCalls = [];
  const debuggerTargets = [];
  const runtimeResults = [
    { x: 100, y: 200 },
    { x: 120, y: 220 }
  ];
  const api = loadBackground({}, {
    tabs: [{ id: 8, url: 'https://www.qianwen.com/?ch=tongyi_redirect' }],
    realtimeResponse: { success: false, error: 'Could not find send button' },
    executeScript(details) {
      executed.push(details);
      return [{ result: null }];
    },
    attachDebugger(target, version) {
      debuggerTargets.push({ type: 'attach', target, version });
    },
    sendDebuggerCommand(target, method, params) {
      debuggerCalls.push({ target, method, params });
      if (method === 'Runtime.evaluate') {
        return { result: { value: runtimeResults.shift() ?? null } };
      }
      return {};
    },
    detachDebugger(target) {
      debuggerTargets.push({ type: 'detach', target });
    }
  });

  const response = await api.sendMessageToAI('qianwen', 'reply with OK only');

  assert.equal(response.success, true, JSON.stringify({ response, debuggerCalls, debuggerTargets, executed }));
  assert.equal(executed.length, 0);
  assert.equal(debuggerTargets[0].target.tabId, 8);
  assert.equal(debuggerCalls.some((call) => call.method === 'Runtime.evaluate'), true);
});

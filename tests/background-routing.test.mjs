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
        return typeof options.queryTabs === 'function' ? await options.queryTabs() : (options.tabs ?? []);
      },
      async get(tabId) {
        if (typeof options.getTab === 'function') {
          return await options.getTab(tabId);
        }
        return (options.tabs ?? []).find((tab) => tab.id === tabId) ?? null;
      },
      async sendMessage(tabId, payload) {
        if (typeof options.sendMessage === 'function') {
          return await options.sendMessage(tabId, payload);
        }
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
    Date,
    setTimeout(fn) {
      fn();
      return 0;
    },
    clearTimeout() {},
    globalThis: null
  });
  context.globalThis = context;

  const source = fs.readFileSync(new URL('../background.js', import.meta.url), 'utf8') + `
  globalThis.__backgroundTest = {
    getAITypeFromUrl,
    getStoredResponses,
    getResponseFromContentScript,
    sendMessageToAI,
    handleMessage
  };
  `;

  vm.runInContext(source, context);
  context.__backgroundListeners = listeners;
  return context;
}

function getBackgroundApi(sessionState = {}, options = {}) {
  const context = loadBackground(sessionState, options);
  return { api: context.__backgroundTest, listeners: context.__backgroundListeners, context };
}

function loadBackgroundWithRealtimeResponse(realtimeResponse, tabUrl = 'https://www.kimi.com/?chat_enter_method=new_chat') {
  return loadBackground({}, {
    tabs: [{ id: 1, url: tabUrl }],
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

test('background maps Kimi host to kimi provider id', () => {
  const api = loadBackground();

  assert.equal(api.getAITypeFromUrl('https://www.kimi.com/?chat_enter_method=new_chat'), 'kimi');
});

test('background stored response defaults include doubao, qianwen, and kimi slots', async () => {
  const api = loadBackground();

  const responses = await api.getStoredResponses();

  assert.deepEqual(JSON.parse(JSON.stringify(responses)), {
    claude: null,
    chatgpt: null,
    gemini: null,
    doubao: null,
    qianwen: null,
    kimi: null
  });
});

test('background treats missing provider completion metadata as unknown instead of complete', async () => {
  const api = loadBackground();
  globalThis.chrome = undefined;

  const sourceApi = loadBackgroundWithRealtimeResponse({ content: 'Kimi 第一段', streamingActive: undefined, captureState: undefined });
  const response = await sourceApi.getResponseFromContentScript('kimi');

  assert.equal(response.content, 'Kimi 第一段');
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

test('background prefers content-script kimi send and still chooses chat tab over homepage', async () => {
  const debuggerCalls = [];
  const debuggerTargets = [];
  const { api } = getBackgroundApi({}, {
    tabs: [
      { id: 9, url: 'https://www.kimi.com/?chat_enter_method=new_chat' },
      { id: 10, url: 'https://www.kimi.com/chat/abc123?chat_enter_method=new_chat' }
    ],
    realtimeResponse: { success: true },
    attachDebugger(target, version) {
      debuggerTargets.push({ type: 'attach', target, version });
    },
    sendDebuggerCommand(target, method, params) {
      debuggerCalls.push({ target, method, params });
      return {};
    },
    detachDebugger(target) {
      debuggerTargets.push({ type: 'detach', target });
    }
  });

  const response = await api.sendMessageToAI('kimi', 'reply with KIMI only');

  assert.equal(response.success, true, JSON.stringify({ response, debuggerCalls, debuggerTargets }));
  assert.equal(debuggerTargets.length, 0);
  assert.equal(debuggerCalls.length, 0);
});

test('background retries content-script kimi send after tab finishes loading instead of falling back immediately', async () => {
  const debuggerCalls = [];
  const debuggerTargets = [];
  let currentTab = {
    id: 10,
    url: 'https://www.kimi.com/chat/abc123?chat_enter_method=new_chat',
    status: 'loading'
  };
  let sendAttempts = 0;

  const { api, listeners } = getBackgroundApi({}, {
    queryTabs() {
      return [currentTab];
    },
    getTab() {
      return currentTab;
    },
    async sendMessage(tabId, payload) {
      sendAttempts += 1;
      if (sendAttempts === 1) {
        assert.equal(tabId, 10);
        assert.equal(payload.type, 'INJECT_MESSAGE');
        currentTab = { ...currentTab, status: 'complete' };
        listeners.onUpdated?.(10, { status: 'complete' }, currentTab);
        throw new Error('Could not establish connection. Receiving end does not exist.');
      }
      return { success: true };
    },
    attachDebugger(target, version) {
      debuggerTargets.push({ type: 'attach', target, version });
    },
    sendDebuggerCommand(target, method, params) {
      debuggerCalls.push({ target, method, params });
      return {};
    },
    detachDebugger(target) {
      debuggerTargets.push({ type: 'detach', target });
    }
  });

  const response = await api.sendMessageToAI('kimi', 'reply with KIMI only');

  assert.equal(response.success, true, JSON.stringify({ response, sendAttempts, debuggerCalls, debuggerTargets }));
  assert.equal(sendAttempts, 2, JSON.stringify({ response, sendAttempts }));
  assert.equal(debuggerTargets.length, 0, JSON.stringify({ response, debuggerTargets }));
  assert.equal(debuggerCalls.length, 0, JSON.stringify({ response, debuggerCalls }));
});

test('background falls back to debugger-driven kimi input when content-script send fails', async () => {
  const debuggerCalls = [];
  const debuggerTargets = [];
  const runtimeResults = [
    { x: 220, y: 680 },
    {
      inputText: 'reply with KIMI only',
      sendDisabled: false,
      stopVisible: false,
      userTurnCount: 1,
      assistantTurnCount: 1,
      lastAssistantText: '旧回复'
    },
    {
      inputText: '',
      sendDisabled: true,
      stopVisible: true,
      userTurnCount: 2,
      assistantTurnCount: 1,
      lastAssistantText: '旧回复'
    }
  ];
  const api = loadBackground({}, {
    tabs: [
      { id: 9, url: 'https://www.kimi.com/?chat_enter_method=new_chat' },
      { id: 10, url: 'https://www.kimi.com/chat/abc123?chat_enter_method=new_chat' }
    ],
    sendMessageError: new Error('Message was not sent'),
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

  const response = await api.sendMessageToAI('kimi', 'reply with KIMI only');

  assert.equal(response.success, true, JSON.stringify({ response, debuggerCalls, debuggerTargets }));
  assert.equal(debuggerTargets[0].type, 'attach');
  assert.equal(debuggerTargets[0].target.tabId, 10);
  assert.equal(debuggerCalls.some((call) => call.method === 'Input.dispatchKeyEvent' && call.params?.key === 'Enter'), true);
  assert.equal(debuggerCalls.some((call) => call.method === 'Input.dispatchMouseEvent'), true);
  assert.equal(debuggerCalls.filter((call) => call.method === 'Runtime.evaluate').length >= 3, true);
  assert.equal(debuggerTargets.at(-1).type, 'detach');
});

test('background fails kimi send when content script fails and post-send debugger signals are not observed', async () => {
  const debuggerCalls = [];
  const runtimeResponses = [
    { x: 220, y: 680 },
    {
      inputText: 'reply with KIMI only',
      sendDisabled: false,
      stopVisible: false,
      userTurnCount: 1,
      assistantTurnCount: 1,
      lastAssistantText: '旧回复'
    }
  ];
  const stagnantObservation = {
    inputText: '',
    sendDisabled: true,
    stopVisible: false,
    userTurnCount: 1,
    assistantTurnCount: 1,
    lastAssistantText: '旧回复'
  };
  const api = loadBackground({}, {
    tabs: [
      { id: 10, url: 'https://www.kimi.com/chat/abc123?chat_enter_method=new_chat' }
    ],
    sendMessageError: new Error('Message was not sent'),
    attachDebugger() {},
    sendDebuggerCommand(target, method, params) {
      debuggerCalls.push({ target, method, params });
      if (method === 'Runtime.evaluate') {
        const value = runtimeResponses.length > 0 ? runtimeResponses.shift() : stagnantObservation;
        return { result: { value } };
      }
      return {};
    },
    detachDebugger() {}
  });

  const response = await api.sendMessageToAI('kimi', 'reply with KIMI only');

  assert.equal(response.success, false, JSON.stringify({ response, debuggerCalls }));
  assert.match(response.error, /Kimi send not observed/);
  assert.equal(debuggerCalls.some((call) => call.method === 'Input.dispatchKeyEvent' && call.params?.key === 'Enter'), true);
});

test('background refuses kimi homepage tab when no chat tab exists', async () => {
  const api = loadBackground({}, {
    tabs: [
      { id: 9, url: 'https://www.kimi.com/?chat_enter_method=new_chat' }
    ]
  });

  const response = await api.sendMessageToAI('kimi', 'reply with KIMI only');

  assert.equal(response.success, false, JSON.stringify(response));
  assert.match(response.error, /No kimi chat tab found/);
});

// AI Panel - Background Service Worker

// URL patterns for each AI
const AI_URL_PATTERNS = {
  claude: ['claude.ai'],
  chatgpt: ['chat.openai.com', 'chatgpt.com'],
  gemini: ['gemini.google.com'],
  doubao: ['www.doubao.com'],
  qianwen: ['www.qianwen.com', 'www.qianwen.com/chat/'],
  kimi: ['www.kimi.com']
};

// Store latest responses using chrome.storage.session (persists across service worker restarts)
async function getStoredResponses() {
  const result = await chrome.storage.session.get('latestResponses');
  return result.latestResponses || { claude: null, chatgpt: null, gemini: null, doubao: null, qianwen: null, kimi: null };
}

function normalizeStoredResponse(entry, options = {}) {
  if (!entry) {
    return { content: null, streamingActive: false, captureState: 'complete', fromStorage: Boolean(options.fromStorage) };
  }

  if (typeof entry === 'object' && !Array.isArray(entry)) {
    return {
      content: entry.content ?? null,
      streamingActive: Boolean(entry.streamingActive),
      captureState: entry.captureState || 'complete',
      updatedAt: entry.updatedAt,
      url: entry.url,
      fromStorage: Boolean(options.fromStorage)
    };
  }

  return {
    content: entry,
    streamingActive: false,
    captureState: 'complete',
    fromStorage: Boolean(options.fromStorage)
  };
}

async function setStoredResponse(aiType, content, metadata = {}) {
  const responses = await getStoredResponses();
  responses[aiType] = {
    content,
    updatedAt: metadata.updatedAt || Date.now(),
    streamingActive: Boolean(metadata.streamingActive),
    captureState: metadata.captureState || 'complete',
    url: metadata.url
  };
  await chrome.storage.session.set({ latestResponses: responses });
}

async function getPanelSession() {
  const result = await chrome.storage.session.get('panelSession');
  return result.panelSession || null;
}

async function setPanelSession(session) {
  const currentSession = await getPanelSession();
  const nextVersion = Number(session?.version || 0);
  const currentVersion = Number(currentSession?.version || 0);

  if (currentSession && nextVersion < currentVersion) {
    return;
  }

  await chrome.storage.session.set({ panelSession: session });
}

async function clearPanelSession(expectedVersion) {
  const currentSession = await getPanelSession();
  const clearVersion = Number(expectedVersion || 0);
  const currentVersion = Number(currentSession?.version || 0);

  if (currentSession && clearVersion && clearVersion < currentVersion) {
    return;
  }

  await chrome.storage.session.set({ panelSession: null });
}

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Set side panel behavior
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Listen for messages from side panel and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true; // Keep channel open for async response
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'SEND_MESSAGE':
      return await sendMessageToAI(message.aiType, message.message);

    case 'SEND_FILES':
      return await sendFilesToAI(message.aiType, message.files);

    case 'GET_RESPONSE':
      // Query content script directly for real-time response (not from storage)
      return await getResponseFromContentScript(message.aiType);

    case 'PANEL_STATE_GET':
      return { success: true, session: await getPanelSession() };

    case 'PANEL_STATE_SET':
      await setPanelSession(message.session);
      return { success: true };

    case 'PANEL_STATE_CLEAR':
      await clearPanelSession(message.version);
      return { success: true };

    case 'RESPONSE_CAPTURED':
      // Content script captured a response
      await setStoredResponse(message.aiType, message.content, {
        url: sender.tab?.url
      });
      // Forward to side panel (include content for discussion mode)
      notifySidePanel('RESPONSE_CAPTURED', { aiType: message.aiType, content: message.content });
      return { success: true };

    case 'CONTENT_SCRIPT_READY':
      // Content script loaded and ready
      const aiType = getAITypeFromUrl(sender.tab?.url);
      if (aiType) {
        notifySidePanel('TAB_STATUS_UPDATE', { aiType, connected: true });
      }
      return { success: true };

    default:
      return { error: 'Unknown message type' };
  }
}

async function getResponseFromContentScript(aiType) {
  try {
    const tab = await findAITab(aiType);
    if (!tab) {
      // Fallback to stored response if tab not found
      const responses = await getStoredResponses();
      return normalizeStoredResponse(responses[aiType], { fromStorage: true });
    }

    // Query content script for real-time DOM content
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'GET_LATEST_RESPONSE'
    });

    return {
      content: response?.content || null,
      streamingActive: Boolean(response?.streamingActive),
      captureState: response?.captureState || 'unknown',
      updatedAt: response?.updatedAt,
      url: tab.url,
      fromStorage: false
    };
  } catch (err) {
    // Fallback to stored response on error
    console.log('[AI Panel] Failed to get response from content script:', err.message);
    const responses = await getStoredResponses();
    return normalizeStoredResponse(responses[aiType], { fromStorage: true });
  }
}

async function sendMessageToAI(aiType, message) {
  try {
    // Find the tab for this AI
    const tab = await findAITab(aiType, { requireChatRoute: aiType === 'kimi' });

    if (!tab) {
      const suffix = aiType === 'kimi' ? ' chat tab' : ' tab';
      return { success: false, error: `No ${aiType}${suffix} found` };
    }

    let response;

    try {
      // Send message to content script
      response = await sendMessageToContentScript(tab.id, message);
    } catch (err) {
      if (aiType === 'kimi' && shouldRetryKimiContentScriptSend(err, tab)) {
        const retried = await retryKimiContentScriptSend(tab.id, message);
        if (retried) {
          response = retried;
        } else {
          response = await sendMessageToKimiViaDebugger(tab.id, message);
        }
      } else if (aiType === 'qianwen') {
        response = await sendMessageToQianwenViaDebugger(tab.id, message);
      } else if (aiType === 'kimi') {
        response = await sendMessageToKimiViaDebugger(tab.id, message);
      } else {
        throw err;
      }
    }

    if (aiType === 'qianwen' && response && response.success === false) {
      response = await sendMessageToQianwenViaDebugger(tab.id, message);
    }

    if (aiType === 'kimi' && response && response.success === false) {
      response = await sendMessageToKimiViaDebugger(tab.id, message);
    }

    // Notify side panel
    notifySidePanel('SEND_RESULT', {
      aiType,
      success: response?.success,
      error: response?.error
    });

    return response;
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function sendMessageToContentScript(tabId, message) {
  return await chrome.tabs.sendMessage(tabId, {
    type: 'INJECT_MESSAGE',
    message
  });
}

function shouldRetryKimiContentScriptSend(err, tab) {
  return Boolean(
    err &&
    /Receiving end does not exist/i.test(err.message || '') &&
    tab &&
    tab.status === 'loading'
  );
}

async function retryKimiContentScriptSend(tabId, message) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const refreshedTab = await chrome.tabs.get(tabId);
    if (!refreshedTab) {
      return null;
    }

    if (refreshedTab.status !== 'complete') {
      await sleep(200);
      continue;
    }

    try {
      return await sendMessageToContentScript(tabId, message);
    } catch (err) {
      if (/Receiving end does not exist/i.test(err.message || '')) {
        await sleep(200);
        continue;
      }
      throw err;
    }
  }

  return null;
}

async function sendMessageToQianwenViaDebugger(tabId, message) {
  const target = { tabId };
  await chrome.debugger.attach(target, '1.3');

  try {
    const inputPoint = await getQianwenInputPoint(target);
    if (!inputPoint) {
      return { success: false, error: 'Could not find input field' };
    }

    await clickDebuggerPoint(target, inputPoint);
    await clearQianwenInputViaDebugger(target);
    await typeQianwenMessageViaDebugger(target, message);

    const sendPoint = await getQianwenSendPoint(target);
    if (!sendPoint) {
      return { success: false, error: 'Could not find send button' };
    }

    await clickDebuggerPoint(target, sendPoint);
    return { success: true };
  } finally {
    await chrome.debugger.detach(target);
  }
}

async function getQianwenInputPoint(target) {
  const response = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
    expression: `(() => {
      const input = document.querySelector('div[role="textbox"][contenteditable="true"]') ||
        document.querySelector('[role="textbox"][contenteditable="true"]') ||
        document.querySelector('div[contenteditable="true"]');
      if (!input) return null;
      const rect = input.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`,
    returnByValue: true,
    awaitPromise: true
  });
  return response?.result?.value || null;
}

async function getQianwenSendPoint(target) {
  const response = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
    expression: `(() => {
      const sendButton = Array.from(document.querySelectorAll('button')).find((button) => {
        const label = button.getAttribute('aria-label') || '';
        return label.includes('发送') && !button.disabled;
      });
      if (!sendButton) return null;
      const rect = sendButton.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`,
    returnByValue: true,
    awaitPromise: true
  });
  return response?.result?.value || null;
}

async function clickDebuggerPoint(target, point) {
  await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1
  });
  await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1
  });
}

async function clearQianwenInputViaDebugger(target) {
  await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key: 'a',
    code: 'KeyA',
    windowsVirtualKeyCode: 65,
    nativeVirtualKeyCode: 65,
    modifiers: 2
  });
  await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'a',
    code: 'KeyA',
    windowsVirtualKeyCode: 65,
    nativeVirtualKeyCode: 65,
    modifiers: 2
  });
  await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Backspace',
    code: 'Backspace',
    windowsVirtualKeyCode: 8,
    nativeVirtualKeyCode: 8
  });
  await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Backspace',
    code: 'Backspace',
    windowsVirtualKeyCode: 8,
    nativeVirtualKeyCode: 8
  });
}

async function typeQianwenMessageViaDebugger(target, message) {
  for (const char of message) {
    const isAscii = char.charCodeAt(0) <= 0x7f;
    if (isAscii) {
      const key = char === ' ' ? ' ' : char;
      const code = char === ' ' ? 'Space' : (/[a-z]/i.test(char) ? `Key${char.toUpperCase()}` : 'Unidentified');
      const keyCode = char === ' ' ? 32 : (/[a-z]/i.test(char) ? char.toUpperCase().charCodeAt(0) : char.charCodeAt(0));
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
        type: 'keyDown',
        key,
        code,
        windowsVirtualKeyCode: keyCode,
        nativeVirtualKeyCode: keyCode,
        text: char,
        unmodifiedText: char
      });
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
        type: 'keyUp',
        key,
        code,
        windowsVirtualKeyCode: keyCode,
        nativeVirtualKeyCode: keyCode
      });
      continue;
    }

    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
      type: 'char',
      text: char,
      unmodifiedText: char,
      key: char
    });
  }
}

async function sendMessageToKimiViaDebugger(tabId, message) {
  const target = { tabId };
  await chrome.debugger.attach(target, '1.3');

  try {
    const inputPoint = await getKimiInputPoint(target);
    if (!inputPoint) {
      return { success: false, error: 'Could not find input field' };
    }

    await clickDebuggerPoint(target, inputPoint);
    await clearKimiInputViaDebugger(target);
    await typeKimiMessageViaDebugger(target, message);

    const baseline = await getKimiSendObservation(target);
    if (!baseline) {
      return { success: false, error: 'Could not observe Kimi send state' };
    }

    await submitKimiMessageViaDebugger(target);

    const observed = await waitForKimiSendObserved(target, baseline);
    if (!observed) {
      return { success: false, error: 'Kimi send not observed' };
    }

    return { success: true };
  } finally {
    await chrome.debugger.detach(target);
  }
}

async function getKimiInputPoint(target) {
  const response = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
    expression: `(() => {
      const input = document.querySelector('[role="textbox"][contenteditable="true"]') ||
        document.querySelector('div[contenteditable="true"]') ||
        document.querySelector('textarea');
      if (!input) return null;
      const rect = input.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`,
    returnByValue: true,
    awaitPromise: true
  });
  return response?.result?.value || null;
}

async function submitKimiMessageViaDebugger(target) {
  await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13
  });
  await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13
  });
}

async function getKimiSendObservation(target) {
  const response = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
    expression: `(() => {
      const isVisible = (element) => {
        if (!element) return false;
        const style = window.getComputedStyle?.(element);
        if (!style) return true;
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      };
      const selectors = {
        input: [
          '[role="textbox"][contenteditable="true"]',
          'div[contenteditable="true"]',
          'textarea'
        ],
        send: [
          'button[aria-label*="发送"]',
          'button[aria-label*="Send"]',
          'button[type="submit"]',
          '.send-button-container',
          'svg[name="Send"]',
          '.send-icon'
        ],
        stop: [
          'button[aria-label*="停止"]',
          'button[aria-label*="Stop"]'
        ],
        user: [
          '[data-testid="kimi-user-message"]',
          '[data-role="user"]',
          '.chat-content-item.chat-content-item-user',
          '.chat-content-item-user',
          '.segment.segment-user',
          '.segment-user'
        ],
        assistant: [
          '[data-testid="kimi-assistant-message"]',
          '.assistant-message',
          '[data-role="assistant"]',
          '.chat-content-item.chat-content-item-assistant',
          '.chat-content-item-assistant',
          '.segment.segment-assistant',
          '.segment-assistant'
        ]
      };
      const findFirstVisible = (selectorList) => {
        for (const selector of selectorList) {
          const elements = Array.from(document.querySelectorAll(selector));
          for (const element of elements) {
            if (isVisible(element)) {
              return element;
            }
          }
        }
        return null;
      };
      const getText = (element) => (element?.innerText || element?.textContent || element?.value || '').trim();
      const getMessages = (selectorList) => {
        for (const selector of selectorList) {
          const messages = Array.from(document.querySelectorAll(selector)).filter(isVisible);
          if (messages.length > 0) {
            return messages;
          }
        }
        return [];
      };
      const input = findFirstVisible(selectors.input);
      const sendControl = findFirstVisible(selectors.send);
      const assistantMessages = getMessages(selectors.assistant);
      const userMessages = getMessages(selectors.user);
      const lastAssistant = assistantMessages[assistantMessages.length - 1] || null;
      const lastAssistantRich = lastAssistant?.querySelector?.('.markdown, .markdown-container');
      const buttonLike = sendControl?.closest?.('button') || sendControl?.parentElement?.closest?.('button') || sendControl;
      return {
        inputText: getText(input),
        sendDisabled: !buttonLike || Boolean(buttonLike.disabled || buttonLike.classList?.contains?.('disabled') || buttonLike.getAttribute?.('aria-disabled') === 'true'),
        stopVisible: selectors.stop.some((selector) => Boolean(findFirstVisible([selector]))),
        userTurnCount: userMessages.length,
        assistantTurnCount: assistantMessages.length,
        lastAssistantText: getText(lastAssistantRich) || getText(lastAssistant)
      };
    })()`,
    returnByValue: true,
    awaitPromise: true
  });
  return response?.result?.value || null;
}

function isKimiSendObserved(baseline, current) {
  if (!baseline || !current) {
    return false;
  }

  const inputCleared = !String(current.inputText || '').trim();
  const strongSignal = Boolean(
    current.stopVisible ||
    current.userTurnCount > baseline.userTurnCount ||
    current.assistantTurnCount > baseline.assistantTurnCount ||
    (current.lastAssistantText && current.lastAssistantText !== baseline.lastAssistantText)
  );

  return inputCleared && strongSignal;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForKimiSendObserved(target, baseline, maxAttempts = 30) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const current = await getKimiSendObservation(target);
    if (isKimiSendObserved(baseline, current)) {
      return true;
    }
    await sleep(200);
  }
  return false;
}

async function clearKimiInputViaDebugger(target) {
  await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key: 'a',
    code: 'KeyA',
    windowsVirtualKeyCode: 65,
    nativeVirtualKeyCode: 65,
    modifiers: 2
  });
  await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'a',
    code: 'KeyA',
    windowsVirtualKeyCode: 65,
    nativeVirtualKeyCode: 65,
    modifiers: 2
  });
  await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Backspace',
    code: 'Backspace',
    windowsVirtualKeyCode: 8,
    nativeVirtualKeyCode: 8
  });
  await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Backspace',
    code: 'Backspace',
    windowsVirtualKeyCode: 8,
    nativeVirtualKeyCode: 8
  });
}

async function typeKimiMessageViaDebugger(target, message) {
  for (const char of message) {
    const isAscii = char.charCodeAt(0) <= 0x7f;
    if (isAscii) {
      const key = char === ' ' ? ' ' : char;
      const code = char === ' ' ? 'Space' : (/[a-z]/i.test(char) ? `Key${char.toUpperCase()}` : 'Unidentified');
      const keyCode = char === ' ' ? 32 : (/[a-z]/i.test(char) ? char.toUpperCase().charCodeAt(0) : char.charCodeAt(0));
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
        type: 'keyDown',
        key,
        code,
        windowsVirtualKeyCode: keyCode,
        nativeVirtualKeyCode: keyCode,
        text: char,
        unmodifiedText: char
      });
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
        type: 'keyUp',
        key,
        code,
        windowsVirtualKeyCode: keyCode,
        nativeVirtualKeyCode: keyCode
      });
      continue;
    }

    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
      type: 'char',
      text: char,
      unmodifiedText: char,
      key: char
    });
  }
}

async function sendFilesToAI(aiType, files) {
  console.log('[AI Panel] Background: sendFilesToAI called for', aiType, 'files:', files?.length);
  try {
    const tab = await findAITab(aiType);

    if (!tab) {
      console.log('[AI Panel] Background: No tab found for', aiType);
      return { success: false, error: `No ${aiType} tab found` };
    }

    console.log('[AI Panel] Background: Sending INJECT_FILES to tab', tab.id);
    // Send files to content script
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'INJECT_FILES',
      files
    });

    console.log('[AI Panel] Background: Response from content script:', response);
    return response;
  } catch (err) {
    console.log('[AI Panel] Background: sendFilesToAI error:', err.message);
    return { success: false, error: err.message };
  }
}

async function findAITab(aiType, options = {}) {
  const patterns = AI_URL_PATTERNS[aiType];
  if (!patterns) return null;

  const tabs = await chrome.tabs.query({});
  const matchingTabs = tabs.filter((tab) => tab.url && patterns.some((p) => tab.url.includes(p)));

  if (matchingTabs.length === 0) {
    return null;
  }

  if (aiType === 'kimi' || aiType === 'qianwen') {
    // Prefer tabs already in an active chat session
    const chatTab = matchingTabs.find((tab) => tab.url.includes('/chat/'));
    if (chatTab) {
      return chatTab;
    }
    // For Kimi, also try new-chat entry point
    if (aiType === 'kimi' && options.requireChatRoute) {
      const newChatTab = matchingTabs.find((tab) => tab.url.includes('chat_enter_method=new_chat'));
      if (newChatTab) {
        return newChatTab;
      }
      // Fallback: if no /chat/ or new_chat tab found, still try the first
      // matching Kimi tab — the content script is injected on all kimi.com
      // pages and the input field may be available on the home page too.
      // Returning null here would make sendMessageToAI skip debugger fallback.
    }
  }

  return matchingTabs[0];
}

function getAITypeFromUrl(url) {
  if (!url) return null;
  for (const [aiType, patterns] of Object.entries(AI_URL_PATTERNS)) {
    if (patterns.some(p => url.includes(p))) {
      return aiType;
    }
  }
  return null;
}

async function notifySidePanel(type, data) {
  try {
    await chrome.runtime.sendMessage({ type, ...data });
  } catch (err) {
    // Side panel might not be open, ignore
  }
}

// Track tab updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    const aiType = getAITypeFromUrl(tab.url);
    if (aiType) {
      notifySidePanel('TAB_STATUS_UPDATE', { aiType, connected: true });
    }
  }
});

// Track tab closures
chrome.tabs.onRemoved.addListener((tabId) => {
  // We'd need to track which tabs were AI tabs to notify properly
  // For now, side panel will re-check on next action
});

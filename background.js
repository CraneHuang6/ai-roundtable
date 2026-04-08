// AI Panel - Background Service Worker

// URL patterns for each AI
const AI_URL_PATTERNS = {
  claude: ['claude.ai'],
  chatgpt: ['chat.openai.com', 'chatgpt.com'],
  gemini: ['gemini.google.com'],
  doubao: ['www.doubao.com'],
  qianwen: ['www.qianwen.com', 'www.qianwen.com/chat/']
};

// Store latest responses using chrome.storage.session (persists across service worker restarts)
async function getStoredResponses() {
  const result = await chrome.storage.session.get('latestResponses');
  return result.latestResponses || { claude: null, chatgpt: null, gemini: null, doubao: null, qianwen: null };
}

async function setStoredResponse(aiType, content) {
  const responses = await getStoredResponses();
  responses[aiType] = content;
  await chrome.storage.session.set({ latestResponses: responses });
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

    case 'RESPONSE_CAPTURED':
      // Content script captured a response
      await setStoredResponse(message.aiType, message.content);
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
      return { content: responses[aiType] };
    }

    // Query content script for real-time DOM content
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'GET_LATEST_RESPONSE'
    });

    return {
      content: response?.content || null,
      streamingActive: Boolean(response?.streamingActive),
      captureState: response?.captureState || 'unknown'
    };
  } catch (err) {
    // Fallback to stored response on error
    console.log('[AI Panel] Failed to get response from content script:', err.message);
    const responses = await getStoredResponses();
    return { content: responses[aiType] };
  }
}

async function sendMessageToAI(aiType, message) {
  try {
    // Find the tab for this AI
    const tab = await findAITab(aiType);

    if (!tab) {
      return { success: false, error: `No ${aiType} tab found` };
    }

    let response;

    try {
      // Send message to content script
      response = await chrome.tabs.sendMessage(tab.id, {
        type: 'INJECT_MESSAGE',
        message
      });
    } catch (err) {
      if (aiType === 'qianwen') {
        response = await sendMessageToQianwenViaDebugger(tab.id, message);
      } else {
        throw err;
      }
    }

    if (aiType === 'qianwen' && response && response.success === false) {
      response = await sendMessageToQianwenViaDebugger(tab.id, message);
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

async function findAITab(aiType) {
  const patterns = AI_URL_PATTERNS[aiType];
  if (!patterns) return null;

  const tabs = await chrome.tabs.query({});

  for (const tab of tabs) {
    if (tab.url && patterns.some(p => tab.url.includes(p))) {
      return tab;
    }
  }

  return null;
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

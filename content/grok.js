// AI Panel - Grok Content Script

(function() {
  'use strict';

  const AI_TYPE = 'grok';
  const ASSISTANT_SELECTORS = [
    '[data-testid="grok-assistant-message"]',
    '[data-message-author-role="assistant"]',
    'article[data-testid="conversation-turn-assistant"]',
    '.message-bubble.assistant',
    '.message-bubble',
    '.assistant-message',
    '[data-role="assistant"]'
  ];
  const USER_SELECTORS = [
    '[data-testid="grok-user-message"]',
    '[data-message-author-role="user"]',
    'article[data-testid="conversation-turn-user"]'
  ];
  const STOP_BUTTON_SELECTORS = [
    'button[aria-label*="停止"]',
    'button[aria-label*="Stop"]'
  ];

  let lastCapturedContent = '';
  let isCapturing = false;
  const captureStateTracker = {
    lastContent: '',
    lastContentChangeAt: null,
    lastSettledContent: '',
    stableReadCount: 0
  };

  function isContextValid() {
    return chrome.runtime && chrome.runtime.id;
  }

  function safeSendMessage(message, callback) {
    if (!isContextValid()) {
      console.log('[AI Panel] Extension context invalidated, skipping message');
      return;
    }
    try {
      chrome.runtime.sendMessage(message, callback);
    } catch (e) {
      console.log('[AI Panel] Failed to send message:', e.message);
    }
  }

  safeSendMessage({ type: 'CONTENT_SCRIPT_READY', aiType: AI_TYPE });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'INJECT_MESSAGE') {
      injectMessage(message.message)
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (message.type === 'INJECT_FILES') {
      sendResponse({ success: false, error: 'Grok 暂不支持自动文件上传' });
      return true;
    }

    if (message.type === 'GET_LATEST_RESPONSE') {
      const content = getLatestResponse();
      const streamingActive = isStreamingActive();
      sendResponse({
        content,
        streamingActive,
        captureState: getCaptureState()
      });
      return true;
    }
  });

  setupResponseObserver();

  function resetCaptureStateTracker() {
    captureStateTracker.lastContent = '';
    captureStateTracker.lastContentChangeAt = null;
    captureStateTracker.lastSettledContent = '';
    captureStateTracker.stableReadCount = 0;
  }

  function findInput() {
    const selectors = [
      'div[contenteditable="true"]',
      '[contenteditable="true"]',
      'textarea[aria-label*="Grok"]',
      'textarea[placeholder*="帮助"]',
      'textarea[placeholder*="help"]',
      'textarea'
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && isVisible(el)) {
        return el;
      }
    }

    return null;
  }

  function findSendButton() {
    const selectors = [
      'button[aria-label="提交"]',
      'button[aria-label*="Submit"]',
      'button[type="submit"]'
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (!el || !isVisible(el)) {
        continue;
      }

      const buttonLike = el.closest('button') || el;
      if (buttonLike.disabled || buttonLike.getAttribute?.('aria-disabled') === 'true') {
        continue;
      }

      return buttonLike;
    }

    return null;
  }

  async function waitForSendButton(timeoutMs = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const sendButton = findSendButton();
      if (sendButton) {
        return sendButton;
      }
      await sleep(100);
    }
    return null;
  }

  function getVisibleUserMessageCount() {
    for (const selector of USER_SELECTORS) {
      const messages = Array.from(document.querySelectorAll(selector)).filter(isVisible);
      if (messages.length > 0) {
        return messages.length;
      }
    }
    return 0;
  }

  function getSendControlSnapshot() {
    const sendButton = document.querySelector('button[aria-label="提交"], button[aria-label*="Submit"], button[type="submit"]');
    const buttonLike = sendButton?.closest('button') || sendButton;
    return {
      present: Boolean(buttonLike),
      disabled: Boolean(!buttonLike || buttonLike.disabled || buttonLike.getAttribute?.('aria-disabled') === 'true')
    };
  }

  async function injectMessage(text) {
    lastCapturedContent = '';
    resetCaptureStateTracker();

    const inputEl = findInput();
    if (!inputEl) {
      throw new Error('Could not find input field');
    }

    inputEl.focus();

    if (inputEl.tagName === 'TEXTAREA') {
      const nativeValueSetter =
        typeof HTMLTextAreaElement !== 'undefined'
          ? Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          : null;

      if (nativeValueSetter) {
        nativeValueSetter.call(inputEl, text);
      } else {
        inputEl.value = text;
      }
    } else {
      const selection = window.getSelection?.();
      const range = document.createRange?.();
      if (selection && range) {
        range.selectNodeContents(inputEl);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      }

      inputEl.innerHTML = `<p>${escapeHtml(text)}</p>`;
    }

    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    inputEl.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
    inputEl.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));

    await sleep(200);

    const baselineUserMessageCount = getVisibleUserMessageCount();
    const sendControlBefore = getSendControlSnapshot();
    const sendButton = await waitForSendButton();
    if (!sendButton) {
      throw new Error('Could not find send button');
    }

    sendButton.click();

    const sent = await verifySendSuccess(inputEl, text, 3000, baselineUserMessageCount, sendControlBefore);
    if (!sent) {
      throw new Error('Message was not sent');
    }

    waitForStreamingComplete();
    return true;
  }

  async function verifySendSuccess(inputEl, text, timeoutMs, baselineUserMessageCount, sendControlBefore) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      if (isStreamingActive()) {
        return true;
      }

      if (didMessageLeaveInput(inputEl, text)) {
        await sleep(200);
        if (didMessageLeaveInput(inputEl, text) || isStreamingActive()) {
          return true;
        }
        return false;
      }

      if (didSendControlChange(sendControlBefore)) {
        return true;
      }

      if (getVisibleUserMessageCount() > baselineUserMessageCount) {
        return true;
      }

      await sleep(200);
    }

    return false;
  }

  function didSendControlChange(before) {
    const after = getSendControlSnapshot();
    if (!before.present && after.present) {
      return true;
    }
    if (before.present && !after.present) {
      return true;
    }
    return before.disabled !== after.disabled;
  }

  function updateCaptureStateTracker(content) {
    const normalizedContent = (content || '').trim();
    const now = Date.now();

    if (!normalizedContent) {
      captureStateTracker.lastContent = '';
      captureStateTracker.lastContentChangeAt = null;
      captureStateTracker.stableReadCount = 0;
      return;
    }

    if (normalizedContent !== captureStateTracker.lastContent) {
      captureStateTracker.lastContent = normalizedContent;
      captureStateTracker.lastContentChangeAt = now;
      captureStateTracker.stableReadCount = 1;
    } else {
      captureStateTracker.stableReadCount += 1;
      if (captureStateTracker.lastContentChangeAt === null) {
        captureStateTracker.lastContentChangeAt = now;
      }
    }
  }

  function getCaptureState() {
    const content = getLatestResponse();
    const streamingActive = isStreamingActive();
    updateCaptureStateTracker(content);

    if (streamingActive) {
      return 'streaming';
    }

    const normalizedContent = (content || '').trim();
    if (!normalizedContent) {
      return 'unknown';
    }

    if (captureStateTracker.lastSettledContent && normalizedContent === captureStateTracker.lastSettledContent) {
      return 'complete';
    }

    if (
      captureStateTracker.stableReadCount >= 4 ||
      (
        captureStateTracker.lastContentChangeAt !== null &&
        Date.now() - captureStateTracker.lastContentChangeAt >= 1500
      )
    ) {
      captureStateTracker.lastSettledContent = normalizedContent;
      return 'complete';
    }

    return 'unknown';
  }

  function setupResponseObserver() {
    const observer = new MutationObserver((mutations) => {
      if (!isContextValid()) {
        observer.disconnect();
        return;
      }

      for (const mutation of mutations) {
        if (mutation.type !== 'childList') {
          continue;
        }

        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) {
            continue;
          }

          const isResponse =
            isAssistantResponseNode(node) ||
            Boolean(node.querySelector && Array.from(node.querySelectorAll('.message-bubble, [data-testid="grok-assistant-message"], [data-message-author-role="assistant"], article[data-testid="conversation-turn-assistant"], .assistant-message, [data-role="assistant"]')).find(isAssistantResponseNode));

          if (isResponse) {
            waitForStreamingComplete();
            return;
          }
        }
      }
    });

    const startObserving = () => {
      if (!isContextValid()) {
        return;
      }
      const container = document.querySelector('main, [data-testid="conversation"]') || document.body;
      observer.observe(container, {
        childList: true,
        subtree: true
      });
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startObserving);
    } else {
      startObserving();
    }
  }

  function isStreamingActive() {
    return STOP_BUTTON_SELECTORS.some((selector) => Boolean(document.querySelector(selector)));
  }

  function getLatestResponse() {
    for (const selector of ASSISTANT_SELECTORS) {
      const messages = Array.from(document.querySelectorAll(selector));
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i];
        if (!isAssistantResponseNode(message)) {
          continue;
        }
        const richContent = message.querySelector?.('.markdown, .prose, [data-testid="message-content"]');
        const content = (
          richContent?.innerText ||
          richContent?.textContent ||
          message.innerText ||
          message.textContent ||
          ''
        ).trim();

        if (content) {
          return content;
        }
      }
    }

    return null;
  }

  async function waitForStreamingComplete() {
    if (isCapturing) {
      return;
    }
    isCapturing = true;

    let previousContent = '';
    let stableCount = 0;
    let streamingSeen = false;
    let endedStableCount = 0;
    const maxWait = 600000;
    const checkInterval = 500;
    const stableThreshold = 4;
    const endAfterStreamingThreshold = 2;
    const startTime = Date.now();

    try {
      while (Date.now() - startTime < maxWait) {
        if (!isContextValid()) {
          return;
        }

        await sleep(checkInterval);

        const currentContent = getLatestResponse() || '';
        const streamingActive = isStreamingActive();

        if (streamingActive) {
          streamingSeen = true;
        }

        if (currentContent && currentContent === previousContent) {
          stableCount += 1;
        } else {
          stableCount = 0;
        }

        if (streamingSeen && !streamingActive && currentContent) {
          endedStableCount += currentContent === previousContent ? 1 : 0;
        } else {
          endedStableCount = 0;
        }

        if (
          currentContent &&
          ((streamingSeen && endedStableCount >= endAfterStreamingThreshold) || stableCount >= stableThreshold)
        ) {
          captureStateTracker.lastSettledContent = currentContent;
          if (currentContent !== lastCapturedContent) {
            lastCapturedContent = currentContent;
            safeSendMessage({
              type: 'RESPONSE_CAPTURED',
              aiType: AI_TYPE,
              content: currentContent,
              streamingActive: false,
              captureState: 'complete',
              updatedAt: Date.now()
            });
          }
          return;
        }

        previousContent = currentContent;
      }
    } finally {
      isCapturing = false;
    }
  }

  function didMessageLeaveInput(inputEl, text) {
    const normalizedText = String(text).trim();
    if (!normalizedText) {
      return true;
    }

    if (inputEl.tagName === 'TEXTAREA') {
      return (inputEl.value || '').trim() !== normalizedText;
    }

    const currentText = (inputEl.innerText || inputEl.textContent || '').trim();
    return currentText !== normalizedText;
  }

  function isAssistantResponseNode(node) {
    if (!node) {
      return false;
    }

    if (
      node.matches?.('[data-testid="grok-assistant-message"], [data-message-author-role="assistant"], article[data-testid="conversation-turn-assistant"], .assistant-message, [data-role="assistant"]')
    ) {
      return true;
    }

    if (node.matches?.('.message-bubble')) {
      const parentClasses = node.parentElement?.className || '';
      return /\bitems-start\b/.test(parentClasses);
    }

    return false;
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isVisible(el) {
    if (!el) {
      return false;
    }
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  console.log('[AI Panel] Grok content script loaded');
})();

// AI Panel - Kimi Content Script

(function() {
  'use strict';

  const AI_TYPE = 'kimi';

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
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (message.type === 'INJECT_FILES') {
      sendResponse({ success: false, error: 'Kimi 暂不支持自动文件上传' });
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

  function findInput() {
    const selectors = [
      '[role="textbox"][contenteditable="true"]',
      'div[contenteditable="true"]',
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
      'button[aria-label*="发送"]',
      'button[aria-label*="Send"]',
      'button[type="submit"]',
      '.send-button-container',
      'svg[name="Send"]',
      '.send-icon'
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (!el || !isVisible(el)) {
        continue;
      }

      const buttonLike = el.closest('button') || el.parentElement?.closest?.('button') || el;
      if (buttonLike.disabled || buttonLike.classList?.contains('disabled') || buttonLike.getAttribute?.('aria-disabled') === 'true') {
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

      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      inputEl.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
      inputEl.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
    } else {
      const selection = window.getSelection?.();
      const range = document.createRange?.();
      if (selection && range) {
        range.selectNodeContents(inputEl);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      }

      const inserted = document.execCommand?.('insertText', false, text);
      if (!inserted) {
        inputEl.innerHTML = `<p>${escapeHtml(text)}</p>`;
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    if (inputEl.tagName !== 'TEXTAREA') {
      // Controlled contenteditable editors sometimes need one extra commit tick
      // after DOM insertion before the send control becomes actionable.
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    }

    await sleep(300);

    const sendButton = await waitForSendButton();
    if (!sendButton) {
      throw new Error('Could not find send button');
    }

    const baselineUserMessageCount = getVisibleUserMessageCount();

    sendButton.click();

    // Wait and verify the message was actually sent — for controlled editors
    // like Kimi's, a successful click does not guarantee the message was
    // accepted.  We check multiple post-click signals:
    //   1. Input cleared (text left the input field)
    //   2. Streaming started (stop button appeared)
    //   3. New user message appeared in the chat
    const sent = await verifySendSuccess(inputEl, text, 3000, baselineUserMessageCount);
    if (!sent) {
      throw new Error('Message was not sent — controlled editor may have rejected the input');
    }

    waitForStreamingComplete();
    return true;
  }

  async function verifySendSuccess(inputEl, text, timeoutMs, baselineUserMessageCount) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      if (isStreamingActive()) {
        return true;
      }
      if (didMessageLeaveInput(inputEl, text)) {
        // Input cleared — double-check with a short settle window because
        // controlled editors may briefly clear then revert.
        await sleep(300);
        if (didMessageLeaveInput(inputEl, text) || isStreamingActive()) {
          return true;
        }
        // Input reverted — the editor rejected the DOM-level text injection.
        return false;
      }
      if (hasNewUserMessage(baselineUserMessageCount)) {
        return true;
      }
      await sleep(200);
    }
    return false;
  }

  function hasNewUserMessage(baselineUserMessageCount = 0) {
    return getVisibleUserMessageCount() > baselineUserMessageCount;
  }

  function getVisibleUserMessageCount() {
    const selectors = [
      '[data-testid="kimi-user-message"]',
      '[data-role="user"]',
      '.chat-content-item.chat-content-item-user',
      '.chat-content-item-user',
      '.segment.segment-user',
      '.segment-user'
    ];

    for (const selector of selectors) {
      const messages = Array.from(document.querySelectorAll(selector)).filter(isVisible);
      if (messages.length > 0) {
        return messages.length;
      }
    }
    return 0;
  }

  let lastCapturedContent = '';
  let isCapturing = false;
  const captureStateTracker = {
    lastContent: '',
    lastContentChangeAt: null,
    lastSettledContent: '',
    stableReadCount: 0
  };

  function resetCaptureStateTracker() {
    captureStateTracker.lastContent = '';
    captureStateTracker.lastContentChangeAt = null;
    captureStateTracker.lastSettledContent = '';
    captureStateTracker.stableReadCount = 0;
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
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              checkForResponse(node);
            }
          }
        }
      }
    });

    const startObserving = () => {
      if (!isContextValid()) return;
      const mainContent = document.querySelector('main, .semi-navigation, .semi-layout') || document.body;
      observer.observe(mainContent, {
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

  function checkForResponse(node) {
    if (isCapturing) return;

    const isResponse =
      node.matches?.('[data-testid="kimi-assistant-message"], .assistant-message, [data-role="assistant"], .chat-content-item.chat-content-item-assistant, .chat-content-item-assistant, .segment.segment-assistant, .segment-assistant') ||
      node.querySelector?.('[data-testid="kimi-assistant-message"], .assistant-message, [data-role="assistant"], .chat-content-item.chat-content-item-assistant, .chat-content-item-assistant, .segment.segment-assistant, .segment-assistant');

    if (isResponse) {
      waitForStreamingComplete();
    }
  }

  function isStreamingActive() {
    return Boolean(
      document.querySelector('button[aria-label*="停止"]') ||
      document.querySelector('button[aria-label*="Stop"]')
    );
  }

  function getLatestResponse() {
    const selectors = [
      '[data-testid="kimi-assistant-message"]',
      '.assistant-message',
      '[data-role="assistant"]',
      '.chat-content-item.chat-content-item-assistant',
      '.chat-content-item-assistant',
      '.segment.segment-assistant',
      '.segment-assistant'
    ];

    for (const selector of selectors) {
      const messages = Array.from(document.querySelectorAll(selector));
      for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        const richContent = message.querySelector?.('.markdown, .markdown-container');
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
    const maxWait = 600000;
    const checkInterval = 500;
    const stableThreshold = 4;
    const endAfterStreamingThreshold = 2;
    let endedStableCount = 0;
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
              content: currentContent
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
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  console.log('[AI Panel] Kimi content script loaded');
})();

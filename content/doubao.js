// AI Panel - Doubao Content Script

(function() {
  'use strict';

  const AI_TYPE = 'doubao';

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
      sendResponse({ success: false, error: '豆包暂不支持自动文件上传' });
      return true;
    }

    if (message.type === 'GET_LATEST_RESPONSE') {
      sendResponse({ content: getLatestResponse() });
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
      'button[type="submit"]'
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && isVisible(el)) {
        return el.closest('button') || el;
      }
    }
    return null;
  }

  async function injectMessage(text) {
    const inputEl = findInput();
    if (!inputEl) {
      throw new Error('Could not find input field');
    }

    inputEl.focus();

    if (inputEl.tagName === 'TEXTAREA') {
      inputEl.value = text;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      inputEl.innerHTML = `<p>${escapeHtml(text)}</p>`;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      inputEl.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
      inputEl.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    }

    await sleep(200);

    const sendButton = findSendButton();
    if (!sendButton) {
      throw new Error('Could not find send button');
    }

    sendButton.click();
    waitForStreamingComplete();
    return true;
  }

  let lastCapturedContent = '';
  let isCapturing = false;

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
      node.matches?.('[data-testid="doubao-assistant-message"], .assistant-message, [data-role="assistant"]') ||
      node.querySelector?.('[data-testid="doubao-assistant-message"], .assistant-message, [data-role="assistant"]');

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
      '[data-testid="doubao-assistant-message"]',
      '.assistant-message',
      '[data-role="assistant"]'
    ];

    for (const selector of selectors) {
      const messages = document.querySelectorAll(selector);
      if (messages.length > 0) {
        const lastMessage = messages[messages.length - 1];
        const content = (lastMessage.innerText || lastMessage.textContent || '').trim();
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

  console.log('[AI Panel] Doubao content script loaded');
})();

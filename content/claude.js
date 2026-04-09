// AI Panel - Claude Content Script

(function() {
  'use strict';

  const AI_TYPE = 'claude';

  // Check if extension context is still valid
  function isContextValid() {
    return chrome.runtime && chrome.runtime.id;
  }

  // Safe message sender that checks context first
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

  // Notify background that content script is ready
  safeSendMessage({ type: 'CONTENT_SCRIPT_READY', aiType: AI_TYPE });

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'INJECT_MESSAGE') {
      injectMessage(message.message)
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (message.type === 'INJECT_FILES') {
      injectFiles(message.files)
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (message.type === 'GET_LATEST_RESPONSE') {
      const content = getLatestResponse();
      const captureState = getCaptureState();
      sendResponse({
        content,
        streamingActive: captureState === 'streaming',
        captureState
      });
      return true;
    }
  });

  // Setup response observer for cross-reference feature
  setupResponseObserver();

  async function injectMessage(text) {
    lastCapturedContent = '';
    lastCompletionState = 'idle';

    const inputEl = findInput();
    if (!inputEl) {
      throw new Error('Could not find input field');
    }

    inputEl.focus();
    fillContenteditableInput(inputEl, text);

    await sleep(200);

    const submitted = await submitMessage();
    if (!submitted) {
      throw new Error('Could not find send button');
    }

    await sleep(200);

    if (!didMessageLeaveInput(inputEl, text) && !isStreamingActive()) {
      throw new Error('Message was not sent');
    }

    console.log('[AI Panel] Claude message sent, starting response capture...');
    waitForStreamingComplete();
    return true;
  }

  function findInput() {
    const inputSelectors = [
      'div[contenteditable="true"].ProseMirror',
      'div.ProseMirror[contenteditable="true"]',
      '[data-placeholder="How can Claude help you today?"]',
      'fieldset div[contenteditable="true"]'
    ];

    for (const selector of inputSelectors) {
      const inputEl = document.querySelector(selector);
      if (inputEl) {
        return inputEl;
      }
    }

    return null;
  }

  function fillContenteditableInput(inputEl, text) {
    inputEl.innerHTML = `<p>${escapeHtml(text)}</p>`;
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    inputEl.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    inputEl.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  }

  async function submitMessage() {
    let sendButton = findSendButton();
    if (!sendButton) {
      await sleep(300);
      sendButton = findSendButton();
    }

    if (!sendButton) {
      return false;
    }

    sendButton.click();
    return true;
  }

  function findSendButton() {
    const selectors = [
      'button[aria-label="Send message"]',
      'button[aria-label="Send Message"]',
      'button[type="submit"]',
      'fieldset button:last-of-type',
      'button svg[viewBox]'
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      const button = el?.closest('button') || el;
      if (button && isVisible(button) && !button.disabled) {
        return button;
      }
    }

    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      if (!btn || btn.disabled || !isVisible(btn)) {
        continue;
      }
      if (btn.querySelector('svg')) {
        const rect = btn.getBoundingClientRect();
        if (rect.bottom > window.innerHeight - 200) {
          return btn;
        }
      }
    }

    return null;
  }

  function setupResponseObserver() {
    // Watch for new responses in the conversation
    const observer = new MutationObserver((mutations) => {
      // Check context validity in observer callback
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

    // Start observing once the main content area is available
    const startObserving = () => {
      if (!isContextValid()) return;
      const mainContent = document.querySelector('main') || document.body;
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

  let lastCapturedContent = '';
  let lastCompletionState = 'idle';
  let isCapturing = false;

  function checkForResponse(node) {
    if (isCapturing) return;

    const responseSelectors = [
      '[data-is-streaming]',
      '.font-claude-message',
      '[class*="response"]'
    ];

    for (const selector of responseSelectors) {
      if (node.matches?.(selector) || node.querySelector?.(selector)) {
        console.log('[AI Panel] Claude detected new response...');
        waitForStreamingComplete();
        break;
      }
    }
  }

  function getCaptureState() {
    if (isStreamingActive()) {
      return 'streaming';
    }

    const content = getLatestResponse();
    if (!content) {
      return 'idle';
    }

    if (lastCompletionState === 'complete' && content === lastCapturedContent) {
      return 'complete';
    }

    return 'unknown';
  }

  function isStreamingActive() {
    return Boolean(
      document.querySelector('[data-is-streaming="true"]') ||
      document.querySelector('button[aria-label*="Stop"]')
    );
  }

  function didMessageLeaveInput(inputEl, text) {
    const normalizedText = String(text).trim();
    if (!normalizedText) {
      return true;
    }

    const currentText = (inputEl.innerText || inputEl.textContent || '').trim();
    return currentText !== normalizedText;
  }

  async function waitForStreamingComplete() {
    if (isCapturing) {
      console.log('[AI Panel] Claude already capturing, skipping...');
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
          console.log('[AI Panel] Context invalidated, stopping capture');
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
          lastCompletionState = 'complete';
          if (currentContent !== lastCapturedContent) {
            lastCapturedContent = currentContent;
            safeSendMessage({
              type: 'RESPONSE_CAPTURED',
              aiType: AI_TYPE,
              content: currentContent
            });
            console.log('[AI Panel] Claude response captured, length:', currentContent.length);
          }
          return;
        }

        previousContent = currentContent;
      }
    } finally {
      isCapturing = false;
    }
  }

  function getLatestResponse() {
    // Find the latest response container
    const responseContainers = document.querySelectorAll('[data-is-streaming="false"]');

    if (responseContainers.length === 0) return null;

    const lastContainer = responseContainers[responseContainers.length - 1];

    // Find all .standard-markdown blocks within this response
    const allBlocks = lastContainer.querySelectorAll('.standard-markdown');

    // Filter out thinking blocks:
    // Thinking blocks are inside containers with overflow-hidden and max-h-[238px]
    // or inside elements with "Thought process" button
    const responseBlocks = Array.from(allBlocks).filter(block => {
      // Check if this block is inside a thinking container
      const thinkingContainer = block.closest('[class*="overflow-hidden"][class*="max-h-"]');
      if (thinkingContainer) return false;

      // Check if ancestor has "Thought process" text
      const parent = block.closest('.font-claude-response');
      if (parent) {
        const buttons = parent.querySelectorAll('button');
        for (const btn of buttons) {
          if (btn.textContent.includes('Thought process') ||
              btn.textContent.includes('思考过程')) {
            // Check if block is descendant of this button's container
            const btnContainer = btn.closest('[class*="border-border-300"]');
            if (btnContainer && btnContainer.contains(block)) {
              return false;
            }
          }
        }
      }

      return true;
    });

    if (responseBlocks.length > 0) {
      // Get the last non-thinking block
      const lastBlock = responseBlocks[responseBlocks.length - 1];
      return lastBlock.innerText.trim();
    }

    return null;
  }

  // Utility functions
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function isVisible(el) {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' &&
           style.visibility !== 'hidden' &&
           style.opacity !== '0';
  }

  // File injection using DataTransfer API
  async function injectFiles(filesData) {
    console.log('[AI Panel] Claude injecting files:', filesData.length);

    // Convert base64 to File objects
    const files = filesData.map(fileData => {
      const byteCharacters = atob(fileData.base64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: fileData.type });
      return new File([blob], fileData.name, { type: fileData.type });
    });

    // Find the file input
    const fileInput = document.querySelector('input[type="file"]');

    if (fileInput) {
      const dataTransfer = new DataTransfer();
      files.forEach(file => dataTransfer.items.add(file));
      fileInput.files = dataTransfer.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      console.log('[AI Panel] Claude files injected via input');
      await sleep(500);
      return true;
    }

    // Fallback: drag and drop on input area
    const dropZone = document.querySelector('div.ProseMirror[contenteditable="true"]') ||
                     document.querySelector('[contenteditable="true"]');

    if (dropZone) {
      const dataTransfer = new DataTransfer();
      files.forEach(file => dataTransfer.items.add(file));

      const events = ['dragenter', 'dragover', 'drop'];
      for (const eventType of events) {
        const event = new DragEvent(eventType, {
          bubbles: true,
          cancelable: true,
          dataTransfer: dataTransfer
        });
        dropZone.dispatchEvent(event);
        await sleep(50);
      }

      console.log('[AI Panel] Claude files injected via drop');
      await sleep(500);
      return true;
    }

    throw new Error('Could not find file input or drop zone');
  }

  console.log('[AI Panel] Claude content script loaded');
})();

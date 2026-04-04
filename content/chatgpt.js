// AI Panel - ChatGPT Content Script

(function() {
  'use strict';

  const AI_TYPE = 'chatgpt';

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
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
      const response = getLatestResponse();
      sendResponse({ content: response });
      return true;
    }
  });

  // Setup response observer for cross-reference feature
  setupResponseObserver();

  async function injectMessage(text) {
    // ChatGPT uses a contenteditable div (previously textarea, changed in 2025+)
    const inputSelectors = [
      '#prompt-textarea',
      'div[contenteditable="true"]#prompt-textarea',
      'div[contenteditable="true"][data-placeholder]',
      'textarea[data-id="root"]',
      'textarea[placeholder*="Message"]',
      'div[contenteditable="true"][role="textbox"]',
      'textarea'
    ];

    let inputEl = null;
    for (const selector of inputSelectors) {
      inputEl = document.querySelector(selector);
      if (inputEl) break;
    }

    if (!inputEl) {
      throw new Error('Could not find input field');
    }

    // Focus the input
    inputEl.focus();

    // Handle different input types
    if (inputEl.tagName === 'TEXTAREA') {
      inputEl.value = text;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      // Contenteditable div (ChatGPT switched from textarea to contenteditable in 2025)
      // Need to set innerHTML with <p> tags for proper React state update
      inputEl.innerHTML = `<p>${escapeHtml(text)}</p>`;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Small delay to let React process
    await sleep(100);

    // Find and click the send button
    const sendButton = findSendButton();
    if (!sendButton) {
      throw new Error('Could not find send button');
    }

    // Wait for button to be enabled
    await waitForButtonEnabled(sendButton);

    sendButton.click();

    // Start capturing response after sending
    console.log('[AI Panel] ChatGPT message sent, starting response capture...');
    waitForStreamingComplete();

    return true;
  }

  function findSendButton() {
    // ChatGPT's send button
    const selectors = [
      'button[data-testid="send-button"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send message"]',
      'form button[type="submit"]',
      'button svg path[d*="M15.192"]' // Arrow icon path
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) {
        return el.closest('button') || el;
      }
    }

    // Fallback: find button near the input
    const form = document.querySelector('form');
    if (form) {
      const buttons = form.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.querySelector('svg') && isVisible(btn)) {
          return btn;
        }
      }
    }

    return null;
  }

  async function waitForButtonEnabled(button, maxWait = 2000) {
    const start = Date.now();
    while (button.disabled && Date.now() - start < maxWait) {
      await sleep(50);
    }
  }

  function setupResponseObserver() {
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
  let isCapturing = false;

  function checkForResponse(node) {
    if (isCapturing) return;

    const responseSelectors = [
      '[data-message-author-role="assistant"]',
      '.agent-turn',
      '[class*="assistant"]'
    ];

    for (const selector of responseSelectors) {
      if (node.matches?.(selector) || node.querySelector?.(selector)) {
        console.log('[AI Panel] ChatGPT detected new response...');
        waitForStreamingComplete();
        break;
      }
    }
  }

  function isStreamingActive() {
    const stopSelectors = [
      'button[aria-label*="Stop"]',
      'button[data-testid="stop-button"]',
      '[data-testid="stop-button"]',
      'button[aria-label*="Stop generating"]'
    ];

    return stopSelectors.some(selector => document.querySelector(selector));
  }

  async function waitForStreamingComplete() {
    console.log('[AI Panel] ChatGPT waitForStreamingComplete called, isCapturing:', isCapturing);
    console.log('[AI Panel] ChatGPT capture version: 2026-04-04-v3 (action buttons + stream-stop bridge + 30s fallback)');

    if (isCapturing) {
      console.log('[AI Panel] ChatGPT already capturing, skipping...');
      return;
    }
    isCapturing = true;
    console.log('[AI Panel] ChatGPT starting capture loop...');

    let previousLength = 0;
    let lengthStableCount = 0;
    let actionButtonsSeenCount = 0;
    let streamEndedStableCount = 0;
    let streamingSeen = false;
    const maxWait = 600000;  // 10 minutes
    const checkInterval = 500;
    const lengthStableThreshold = 60;  // 30 seconds fallback
    const actionButtonsThreshold = 4;  // 2 seconds with buttons
    const streamEndedStableThreshold = 3;  // 1.5 seconds after streaming ends
    const startTime = Date.now();
    let firstContentTime = null;

    try {
      while (Date.now() - startTime < maxWait) {
        if (!isContextValid()) {
          console.log('[AI Panel] Context invalidated, stopping capture');
          return;
        }

        await sleep(checkInterval);

        const currentContent = getLatestResponse() || '';
        const currentLength = currentContent.length;
        const streamingActive = isStreamingActive();
        if (streamingActive) {
          streamingSeen = true;
        }

        // Track when content first appears
        if (currentLength > 0 && firstContentTime === null) {
          firstContentTime = Date.now();
          console.log('[AI Panel] ChatGPT first content detected, length:', currentLength);
        }

        // Strategy 1: Detect action buttons (copy, like, dislike, share, regenerate)
        // These appear when message is complete
        const containers = document.querySelectorAll('[data-message-author-role="assistant"]');
        let hasActionButtons = false;

        if (containers.length > 0) {
          const lastContainer = containers[containers.length - 1];

          // Look for the action button group - usually appears after the message
          // Try multiple strategies to find buttons
          const buttonGroup = lastContainer.parentElement?.querySelector('[class*="group"]') ||
                             lastContainer.nextElementSibling;

          if (buttonGroup) {
            const buttons = buttonGroup.querySelectorAll('button');
            hasActionButtons = buttons.length >= 3;  // Usually 4-5 buttons when complete

            if (hasActionButtons) {
              actionButtonsSeenCount++;
              console.log(`[AI Panel] ChatGPT action buttons detected (${buttons.length} buttons), count: ${actionButtonsSeenCount}/${actionButtonsThreshold}`);

              if (actionButtonsSeenCount >= actionButtonsThreshold) {
                if (currentContent !== lastCapturedContent) {
                  lastCapturedContent = currentContent;
                  console.log('[AI Panel] ChatGPT capturing response (action buttons confirmed), final length:', currentLength);
                  safeSendMessage({
                    type: 'RESPONSE_CAPTURED',
                    aiType: AI_TYPE,
                    content: currentContent
                  });
                  console.log('[AI Panel] ChatGPT response captured and sent!');
                } else {
                  console.log('[AI Panel] ChatGPT content same as last capture, skipping');
                }
                return;
              }
            } else {
              actionButtonsSeenCount = 0;
            }
          }
        }

        // Strategy 2: capture soon after streaming stops if content is stable
        if (currentLength === previousLength && currentLength > 0) {
          lengthStableCount++;

          if (streamingSeen && !streamingActive) {
            streamEndedStableCount++;
            if (streamEndedStableCount >= streamEndedStableThreshold) {
              if (currentContent !== lastCapturedContent) {
                lastCapturedContent = currentContent;
                console.log('[AI Panel] ChatGPT capturing response (stream ended + stable), final length:', currentLength);
                safeSendMessage({
                  type: 'RESPONSE_CAPTURED',
                  aiType: AI_TYPE,
                  content: currentContent
                });
                console.log('[AI Panel] ChatGPT response captured and sent!');
              } else {
                console.log('[AI Panel] ChatGPT content same as last capture, skipping');
              }
              return;
            }
          } else {
            streamEndedStableCount = 0;
          }

          if (lengthStableCount % 10 === 0) {
            console.log(`[AI Panel] ChatGPT length stable: ${lengthStableCount}/${lengthStableThreshold}, size=${currentLength}, buttons=${hasActionButtons}, streamingActive=${streamingActive}`);
          }

          // Capture when length stable for 30 seconds (fallback)
          if (lengthStableCount >= lengthStableThreshold) {
            if (currentContent !== lastCapturedContent) {
              lastCapturedContent = currentContent;
              console.log('[AI Panel] ChatGPT capturing response (length stable fallback), final length:', currentLength);
              safeSendMessage({
                type: 'RESPONSE_CAPTURED',
                aiType: AI_TYPE,
                content: currentContent
              });
              console.log('[AI Panel] ChatGPT response captured and sent!');
            } else {
              console.log('[AI Panel] ChatGPT content same as last capture, skipping');
            }
            return;
          }
        } else if (currentLength > previousLength) {
          // Length increased - reset counters
          if (lengthStableCount > 0) {
            console.log(`[AI Panel] ChatGPT length increased (${previousLength} -> ${currentLength}), resetting counters`);
          }
          lengthStableCount = 0;
          actionButtonsSeenCount = 0;
          streamEndedStableCount = 0;
        } else {
          streamEndedStableCount = 0;
        }

        previousLength = currentLength;
      }
      console.log('[AI Panel] ChatGPT capture timeout after', maxWait/1000, 'seconds');
    } finally {
      isCapturing = false;
      console.log('[AI Panel] ChatGPT capture loop ended');
    }
  }

  function getLatestResponse() {
    // Strategy: find the assistant message container first, then extract ALL text content
    // This handles ChatGPT's evolving UI where content may be in .markdown, canvas boxes,
    // code blocks, or other nested containers

    // Step 1: Find all assistant message containers
    const containerSelectors = [
      '[data-message-author-role="assistant"]',
      '[data-testid*="conversation-turn"]:has([data-message-author-role="assistant"])',
      '.agent-turn'
    ];

    let containers = [];
    for (const selector of containerSelectors) {
      containers = document.querySelectorAll(selector);
      if (containers.length > 0) break;
    }

    if (containers.length === 0) return null;

    const lastContainer = containers[containers.length - 1];

    const contentParts = [];

    function findOverlapSuffixPrefix(left, right) {
      const maxLength = Math.min(left.length, right.length);
      for (let length = maxLength; length > 0; length--) {
        if (left.slice(-length) === right.slice(0, length)) {
          return length;
        }
      }
      return 0;
    }

    function isBoundaryChar(char) {
      return !char || /[\s\n\r\t:：;；,，。！？、()（）\[\]{}"'`<>-]/.test(char);
    }

    function isMeaningfulOverlap(left, right, overlapLength) {
      if (overlapLength <= 0) return false;

      const leftPrefixChar = left[left.length - overlapLength - 1] || '';
      const rightSuffixChar = right[overlapLength] || '';

      return isBoundaryChar(leftPrefixChar) && isBoundaryChar(rightSuffixChar);
    }

    function addContentPart(text) {
      const normalizedText = text.trim();
      if (!normalizedText) return;

      const duplicatedIndex = contentParts.findIndex(existing =>
        existing === normalizedText ||
        existing.includes(normalizedText) ||
        normalizedText.includes(existing)
      );

      if (duplicatedIndex !== -1) {
        if (normalizedText.length > contentParts[duplicatedIndex].length) {
          contentParts[duplicatedIndex] = normalizedText;
        }
        return;
      }

      const overlapIndex = contentParts.findIndex(existing => {
        const overlapLength = findOverlapSuffixPrefix(existing, normalizedText);
        return isMeaningfulOverlap(existing, normalizedText, overlapLength);
      });

      if (overlapIndex !== -1) {
        const existing = contentParts[overlapIndex];
        const overlapLength = findOverlapSuffixPrefix(existing, normalizedText);
        contentParts[overlapIndex] = existing + normalizedText.slice(overlapLength);
        return;
      }

      contentParts.push(normalizedText);
    }

    function isNestedStructuredBlock(el, candidates) {
      return candidates.some(candidate => candidate !== el && candidate.contains?.(el));
    }

    const markdownEls = Array.from(lastContainer.querySelectorAll('.markdown, [class*="markdown"]'));
    const canvasEls = Array.from(lastContainer.querySelectorAll('[class*="canvas"], [class*="text-block"], [class*="code-block"], pre code'));

    if (markdownEls.length > 0 || canvasEls.length > 0) {
      const structuredBlocks = [
        ...markdownEls
          .filter(el => !isNestedStructuredBlock(el, markdownEls))
          .map(el => ({ el, type: 'markdown' })),
        ...canvasEls
          .filter(el => !el.closest('.markdown, [class*="markdown"]'))
          .filter(el => !isNestedStructuredBlock(el, canvasEls))
          .map(el => ({ el, type: 'canvas' }))
      ].sort((left, right) => {
        const position = left.el.compareDocumentPosition?.(right.el) || 0;
        if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
      });

      structuredBlocks.forEach(({ el }) => {
        addContentPart(el.innerText);
      });
    }

    if (contentParts.length > 0) {
      return contentParts.join('\n\n').trim();
    }

    return lastContainer.innerText.trim();
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
    console.log('[AI Panel] ChatGPT injecting files:', filesData.length);

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
      console.log('[AI Panel] ChatGPT files injected via input');

      // Wait for upload to complete
      await waitForUploadComplete();
      return true;
    }

    // Fallback: drag and drop
    const dropZone = document.querySelector('#prompt-textarea') ||
                     document.querySelector('[contenteditable="true"]') ||
                     document.querySelector('form');

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

      console.log('[AI Panel] ChatGPT files injected via drop');
      await waitForUploadComplete();
      return true;
    }

    throw new Error('Could not find file input or drop zone');
  }

  // Wait for file upload to complete in ChatGPT
  async function waitForUploadComplete() {
    const maxWait = 30000; // 30 seconds max
    const checkInterval = 300;
    const startTime = Date.now();

    console.log('[AI Panel] ChatGPT waiting for upload to complete...');

    while (Date.now() - startTime < maxWait) {
      await sleep(checkInterval);

      // Check for upload progress indicators
      const uploadingIndicators = [
        // Progress bar or loading spinner
        '[role="progressbar"]',
        '[class*="uploading"]',
        '[class*="loading"]',
        // Circular progress
        'circle[stroke-dasharray]',
        // Any element with "uploading" text
        '[aria-label*="uploading"]',
        '[aria-label*="Uploading"]'
      ];

      let isUploading = false;
      for (const selector of uploadingIndicators) {
        const el = document.querySelector(selector);
        if (el && isVisible(el)) {
          isUploading = true;
          break;
        }
      }

      // Check if file preview/thumbnail appeared (upload complete indicator)
      const filePreviewIndicators = [
        // File attachment preview
        '[data-testid="file-thumbnail"]',
        '[class*="file-preview"]',
        '[class*="attachment"]',
        // Image preview
        'img[alt*="Uploaded"]',
        'img[src*="blob:"]'
      ];

      let hasPreview = false;
      for (const selector of filePreviewIndicators) {
        const el = document.querySelector(selector);
        if (el && isVisible(el)) {
          hasPreview = true;
          break;
        }
      }

      // If no longer uploading and has preview, we're done
      if (!isUploading && hasPreview) {
        console.log('[AI Panel] ChatGPT upload complete (preview detected)');
        await sleep(300); // Small extra delay for UI to stabilize
        return;
      }

      // If no uploading indicator and some time has passed, assume done
      if (!isUploading && Date.now() - startTime > 2000) {
        console.log('[AI Panel] ChatGPT upload assumed complete (no progress indicator)');
        await sleep(300);
        return;
      }
    }

    console.log('[AI Panel] ChatGPT upload wait timeout');
  }

  console.log('[AI Panel] ChatGPT content script loaded');
})();

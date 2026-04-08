// AI Panel - Qianwen Content Script

(function() {
  'use strict';

  const AI_TYPE = 'qianwen';

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
      sendResponse({ success: false, error: '千问暂不支持自动文件上传' });
      return true;
    }

    if (message.type === 'GET_LATEST_RESPONSE') {
      const content = getLatestResponse();
      const streamingActive = isStreamingActive();
      sendResponse({
        content,
        streamingActive,
        captureState: streamingActive ? 'streaming' : 'unknown'
      });
      return true;
    }
  });

  setupResponseObserver();

  function findInput() {
    const selectors = [
      'div[role="textbox"][contenteditable="true"]',
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
      'button[aria-label="发送消息"]',
      'button[aria-label*="发送"]',
      'button[aria-label*="Send"]',
      'button[type="submit"]'
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && isVisible(el) && !el.disabled) {
        return el.closest('button') || el;
      }
    }
    return null;
  }

  async function injectMessage(text) {
    lastCapturedContent = '';

    const inputEl = findInput();
    if (!inputEl) {
      throw new Error('Could not find input field');
    }

    inputEl.focus();

    let submitted = false;

    if (inputEl.tagName === 'TEXTAREA') {
      fillTextareaInput(inputEl, text);
    } else {
      submitted = await submitViaSlateEditor(inputEl, text);
      if (!submitted) {
        fillContenteditableInput(inputEl, text);
      }
    }

    await sleep(200);

    if (!submitted) {
      submitted = await submitMessage(inputEl);
    }

    if (!submitted) {
      throw new Error('Could not find send button');
    }

    await sleep(200);

    if (!didMessageLeaveInput(inputEl, text) && !isStreamingActive()) {
      throw new Error('Message was not sent');
    }

    waitForStreamingComplete();
    return true;
  }

  function fillTextareaInput(inputEl, text) {
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
  }

  function fillContenteditableInput(inputEl, text) {
    inputEl.innerHTML = `<p>${escapeHtml(text)}</p>`;
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    inputEl.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    inputEl.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  }

  async function submitViaSlateEditor(inputEl, text) {
    const pageSubmitted = await submitViaPageContext(text);
    if (pageSubmitted) {
      return true;
    }

    return false;
  }

  async function submitMessage(inputEl) {
    let sendButton = findSendButton();
    if (!sendButton) {
      await sleep(300);
      sendButton = findSendButton();
    }

    if (sendButton) {
      sendButton.click();
      return true;
    }

    return false;
  }

  async function submitViaPageContext(text) {
    if (!document.documentElement) {
      return false;
    }

    const requestId = `qianwen-submit-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    return await new Promise((resolve) => {
      let settled = false;
      const cleanup = () => {
        document.removeEventListener('ai-panel-qianwen-submit-result', handleResult);
        clearTimeout(timeoutId);
      };
      const finish = (value) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(value);
      };
      const handleResult = (event) => {
        if (event.detail?.requestId !== requestId) {
          return;
        }
        finish(Boolean(event.detail?.ok));
      };
      const timeoutId = setTimeout(() => finish(false), 2500);
      document.addEventListener('ai-panel-qianwen-submit-result', handleResult);

      const script = document.createElement('script');
      script.textContent = `(() => {
        const requestId = ${JSON.stringify(requestId)};
        const text = ${JSON.stringify(text)};
        const emit = (ok, error) => {
          document.dispatchEvent(new CustomEvent('ai-panel-qianwen-submit-result', {
            detail: { requestId, ok, error }
          }));
        };
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const findInput = () => document.querySelector('div[role="textbox"][contenteditable="true"]') ||
          document.querySelector('[role="textbox"][contenteditable="true"]') ||
          document.querySelector('div[contenteditable="true"]');
        const findSendButton = () => Array.from(document.querySelectorAll('button')).find((button) => {
          const label = button.getAttribute('aria-label') || '';
          return label.includes('发送') && !button.disabled;
        });
        const findStopButton = () => Array.from(document.querySelectorAll('button')).find((button) => {
          const label = button.getAttribute('aria-label') || '';
          return label.includes('停止') || label.includes('Stop');
        });
        const getInputText = (input) => (input?.innerText || input?.textContent || input?.value || '').trim();
        const selectInputContents = (input) => {
          const selection = window.getSelection?.();
          if (!selection) {
            return;
          }
          const range = document.createRange();
          range.selectNodeContents(input);
          selection.removeAllRanges();
          selection.addRange(range);
        };
        const fillViaExecCommand = async (input) => {
          input.focus();
          selectInputContents(input);
          if (typeof document.execCommand === 'function') {
            document.execCommand('insertText', false, text);
          }
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
          input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
          await sleep(350);
        };
        const fillViaSlateFiber = async (input) => {
          const fiberKey = Object.keys(input).find((key) => key.startsWith('__reactFiber$'));
          if (!fiberKey) {
            return false;
          }
          let fiber = input[fiberKey];
          let editorFiber = null;
          let submitFiber = null;
          for (let depth = 0; fiber && depth < 25; depth += 1, fiber = fiber.return) {
            if (!editorFiber && fiber.memoizedProps?.editor) {
              editorFiber = fiber;
            }
            if (!submitFiber && typeof fiber.memoizedProps?.onSubmit === 'function') {
              submitFiber = fiber;
            }
            if (editorFiber && submitFiber) {
              break;
            }
          }
          const editor = editorFiber?.memoizedProps?.editor;
          const submitProps = submitFiber?.memoizedProps;
          if (!editor || !submitProps) {
            return false;
          }
          try {
            editor.selection = {
              anchor: { path: [0, 0], offset: 0 },
              focus: { path: [0, 0], offset: 0 }
            };
            editor.deleteFragment?.();
          } catch {}
          editor.insertText?.(text);
          editor.onChange?.();
          editorFiber.memoizedProps.onChange?.(editor.children);
          submitProps.onChange?.(text, editor.children);
          await sleep(350);
          return true;
        };
        (async () => {
          try {
            const input = findInput();
            if (!input) {
              emit(false, 'no-input');
              return;
            }

            const beforeText = getInputText(input);
            await fillViaExecCommand(input);
            let sendButton = findSendButton();
            if (!sendButton) {
              await fillViaSlateFiber(input);
              sendButton = findSendButton();
            }
            if (!sendButton) {
              emit(false, 'send-disabled');
              return;
            }

            sendButton.click();
            for (let attempt = 0; attempt < 10; attempt += 1) {
              await sleep(100);
              if (findStopButton() || getInputText(input) !== beforeText) {
                emit(true);
                return;
              }
            }

            emit(false, 'send-not-observed');
          } catch (error) {
            emit(false, String(error?.message || error));
          }
        })();
      })();`;
      document.documentElement.appendChild(script);
      script.remove();
    });
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
      node.matches?.('.answerItem-sQ6QT6, .qk-markdown, [data-testid="qianwen-assistant-message"], .assistant-message, [data-role="assistant"]') ||
      node.querySelector?.('.answerItem-sQ6QT6, .qk-markdown, [data-testid="qianwen-assistant-message"], .assistant-message, [data-role="assistant"]');

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

  function getLatestResponse() {
    const completeSelectors = [
      '.qk-markdown-complete .qk-md-text.complete',
      '.qk-markdown-complete .qk-md-paragraph',
      '.qk-markdown.qk-markdown-complete',
      '.qk-md-text.complete'
    ];

    for (const selector of completeSelectors) {
      const nodes = Array.from(document.querySelectorAll(selector));
      for (let i = nodes.length - 1; i >= 0; i -= 1) {
        const content = (nodes[i].innerText || nodes[i].textContent || '').trim();
        if (!content || content === '你好，我是千问') {
          continue;
        }
        return content;
      }
    }

    const selectors = [
      '.answerItem-sQ6QT6',
      '.qk-markdown',
      '[data-testid="qianwen-assistant-message"]',
      '.assistant-message',
      '[data-role="assistant"]'
    ];

    for (const selector of selectors) {
      const messages = Array.from(document.querySelectorAll(selector));
      for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        const richNode = message.querySelector?.('.qk-markdown-complete .qk-md-text.complete, .qk-markdown-complete .qk-md-paragraph, .qk-markdown.qk-markdown-complete, .qk-markdown, .qk-md-paragraph') || message;
        const content = (
          richNode.innerText ||
          richNode.textContent ||
          message.innerText ||
          message.textContent ||
          ''
        ).trim();
        if (!content || content === '你好，我是千问') {
          continue;
        }
        return content;
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

  console.log('[AI Panel] Qianwen content script loaded');
})();

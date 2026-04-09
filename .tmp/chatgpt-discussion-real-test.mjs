import { pathToFileURL } from 'node:url';

const browserPath = 'C:/Users/0/AppData/Local/npm-cache/_npx/15c61037b1978c83/node_modules/chrome-devtools-mcp/build/src/browser.js';
const browserMod = await import(pathToFileURL(browserPath).href);

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const marker = `CHATGPT-DISCUSS-${Date.now()}`;
const userDataDir = 'C:/Users/0/AppData/Local/Google/Chrome/User Data';

function hostToAi(url) {
  if (!url) return null;
  if (url.includes('claude.ai')) return 'claude';
  if (url.includes('chatgpt.com')) return 'chatgpt';
  if (url.includes('gemini.google.com')) return 'gemini';
  if (url.includes('www.doubao.com')) return 'doubao';
  if (url.includes('www.qianwen.com')) return 'qianwen';
  if (url.includes('www.kimi.com')) return 'kimi';
  return null;
}

async function getPageInfo(page) {
  try {
    return { url: page.url(), title: await page.title() };
  } catch {
    return { url: page.url(), title: '' };
  }
}

async function sendRuntime(page, payload) {
  return await page.evaluate(async (payload) => {
    return await new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(payload, (response) => {
          resolve({
            response: response ?? null,
            runtimeError: chrome.runtime.lastError ? chrome.runtime.lastError.message : null
          });
        });
      } catch (error) {
        resolve({ response: null, runtimeError: error.message });
      }
    });
  }, payload);
}

async function getPanelState(page) {
  return await page.evaluate(() => ({
    status: document.getElementById('discussion-status')?.textContent?.trim() || '',
    nextDisabled: Boolean(document.getElementById('next-round-btn')?.disabled),
    summaryDisabled: Boolean(document.getElementById('generate-summary-btn')?.disabled),
    activeVisible: !document.getElementById('discussion-active')?.classList.contains('hidden'),
    summaryVisible: !document.getElementById('discussion-summary')?.classList.contains('hidden'),
    setupVisible: !document.getElementById('discussion-setup')?.classList.contains('hidden'),
    topicDisplay: document.getElementById('topic-display')?.innerText?.trim() || '',
    summaryText: document.getElementById('summary-content')?.innerText?.trim() || '',
    logText: document.getElementById('log-container')?.innerText?.trim() || ''
  }));
}

async function getChatgptProbe(page) {
  return await page.evaluate(() => {
    const stopSelectors = [
      'button[aria-label*="Stop"]',
      'button[data-testid="stop-button"]',
      '[data-testid="stop-button"]',
      'button[aria-label*="Stop generating"]'
    ];
    const stopVisible = stopSelectors.some(selector => document.querySelector(selector));
    const containers = Array.from(document.querySelectorAll('[data-message-author-role="assistant"], .agent-turn'));
    let text = '';
    for (let i = containers.length - 1; i >= 0; i -= 1) {
      const candidate = (containers[i].innerText || containers[i].textContent || '').trim();
      if (candidate) {
        text = candidate;
        break;
      }
    }
    return {
      stopVisible,
      assistantLength: text.length,
      assistantPreview: text.slice(0, 200)
    };
  });
}

async function waitForRound(page, chatgptPage, label, timeoutMs = 240000) {
  const startedAt = Date.now();
  const timeline = [];
  let midPending = null;
  let readyState = null;
  let lastSignature = '';

  while (Date.now() - startedAt < timeoutMs) {
    const [chatgptResponse, panel, chatgptProbe] = await Promise.all([
      sendRuntime(page, { type: 'GET_RESPONSE', aiType: 'chatgpt' }),
      getPanelState(page),
      getChatgptProbe(chatgptPage)
    ]);

    const snapshot = {
      phase: label,
      elapsedMs: Date.now() - startedAt,
      captureState: chatgptResponse.response?.captureState ?? null,
      streamingActive: chatgptResponse.response?.streamingActive ?? null,
      responseLength: (chatgptResponse.response?.content || '').length,
      responsePreview: (chatgptResponse.response?.content || '').slice(0, 160),
      stopVisible: chatgptProbe.stopVisible,
      pageAssistantLength: chatgptProbe.assistantLength,
      pageAssistantPreview: chatgptProbe.assistantPreview,
      nextDisabled: panel.nextDisabled,
      summaryDisabled: panel.summaryDisabled,
      status: panel.status,
      logTail: panel.logText.split('\n').slice(-8).join('\n')
    };

    const signature = JSON.stringify([
      snapshot.captureState,
      snapshot.streamingActive,
      snapshot.responseLength,
      snapshot.stopVisible,
      snapshot.nextDisabled,
      snapshot.status,
      snapshot.pageAssistantLength
    ]);
    if (signature !== lastSignature) {
      timeline.push(snapshot);
      lastSignature = signature;
    }

    if (!midPending && (snapshot.captureState === 'streaming' || snapshot.captureState === 'unknown' || snapshot.stopVisible) && snapshot.nextDisabled) {
      midPending = snapshot;
    }

    if (!panel.nextDisabled) {
      readyState = snapshot;
      break;
    }

    await sleep(1000);
  }

  return { midPending, readyState, timeline };
}

async function waitForSummary(page, chatgptPage, timeoutMs = 240000) {
  const startedAt = Date.now();
  const timeline = [];
  let preComplete = null;
  let completed = null;
  let lastSignature = '';

  while (Date.now() - startedAt < timeoutMs) {
    const [chatgptResponse, panel, chatgptProbe] = await Promise.all([
      sendRuntime(page, { type: 'GET_RESPONSE', aiType: 'chatgpt' }),
      getPanelState(page),
      getChatgptProbe(chatgptPage)
    ]);

    const snapshot = {
      elapsedMs: Date.now() - startedAt,
      captureState: chatgptResponse.response?.captureState ?? null,
      streamingActive: chatgptResponse.response?.streamingActive ?? null,
      responseLength: (chatgptResponse.response?.content || '').length,
      responsePreview: (chatgptResponse.response?.content || '').slice(0, 160),
      stopVisible: chatgptProbe.stopVisible,
      summaryVisible: panel.summaryVisible,
      summaryLength: panel.summaryText.length,
      summaryPreview: panel.summaryText.slice(0, 240),
      status: panel.status,
      logTail: panel.logText.split('\n').slice(-10).join('\n')
    };

    const signature = JSON.stringify([
      snapshot.captureState,
      snapshot.streamingActive,
      snapshot.responseLength,
      snapshot.stopVisible,
      snapshot.summaryVisible,
      snapshot.summaryLength,
      snapshot.status
    ]);
    if (signature !== lastSignature) {
      timeline.push(snapshot);
      lastSignature = signature;
    }

    if (!preComplete && (snapshot.captureState === 'streaming' || snapshot.captureState === 'unknown' || snapshot.stopVisible) && !snapshot.summaryVisible) {
      preComplete = snapshot;
    }

    if (panel.summaryVisible && panel.summaryText.trim()) {
      completed = snapshot;
      break;
    }

    await sleep(1000);
  }

  return { preComplete, completed, timeline };
}

const browser = await browserMod.ensureBrowserConnected({ userDataDir, enableExtensions: true });
const targets = browser.targets().map(target => ({ type: target.type(), url: target.url() }));
const pages = await browser.pages();
const pageInfos = await Promise.all(pages.map(getPageInfo));

const panelCandidates = pageInfos
  .map((info, index) => ({ ...info, page: pages[index] }))
  .filter(info => /chrome-extension:\/\/.+\/sidepanel\/panel\.html$/.test(info.url) || info.title === 'AI Panel');

const panelInfo = panelCandidates.find(info => info.title === 'AI Panel') || panelCandidates[0] || null;
const extensionId = panelInfo?.url.match(/^chrome-extension:\/\/([^/]+)/)?.[1] || null;

if (!extensionId) {
  throw new Error('未识别到 AI Panel 扩展页，无法执行 discussion 真机测试');
}

const providerPages = pageInfos
  .map((info, index) => ({ ...info, ai: hostToAi(info.url), page: pages[index] }))
  .filter(info => info.ai);

const chatgptInfo = providerPages.find(info => info.ai === 'chatgpt');
if (!chatgptInfo) {
  throw new Error('未找到 ChatGPT 页面');
}

const partnerInfo = providerPages.find(info => info.ai === 'kimi');

if (!partnerInfo) {
  throw new Error('未找到 Kimi 页面，当前真机脚本只支持 ChatGPT + Kimi 验收');
}

if (!partnerInfo.url.includes('/chat/')) {
  throw new Error(`Kimi 未 materialize 到 /chat/，当前 URL: ${partnerInfo.url}`);
}

let panelPage = pages.find(page => page.url().includes(`chrome-extension://${extensionId}/sidepanel/panel.html`)) || null;
if (!panelPage) {
  panelPage = await browser.newPage();
  await panelPage.goto(`chrome-extension://${extensionId}/sidepanel/panel.html`, { waitUntil: 'domcontentloaded' });
} else {
  await panelPage.reload({ waitUntil: 'domcontentloaded' });
}

await panelPage.waitForSelector('#mode-discussion');
await sleep(500);

const baseline = {
  chatgpt: await sendRuntime(panelPage, { type: 'GET_RESPONSE', aiType: 'chatgpt' }),
  partner: await sendRuntime(panelPage, { type: 'GET_RESPONSE', aiType: partnerInfo.ai })
};

const topic = `请始终用中文回复。请围绕“播客最重要的价值”分三点展开回答，每点至少两句话，并在第一行原样写出标记 ${marker}。`;

await panelPage.evaluate(({ topic, participants }) => {
  document.getElementById('mode-discussion')?.click();
  const inputs = Array.from(document.querySelectorAll('input[name="participant"]'));
  for (const input of inputs) {
    input.checked = participants.includes(input.value);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const topicEl = document.getElementById('discussion-topic');
  topicEl.value = topic;
  topicEl.dispatchEvent(new Event('input', { bubbles: true }));
}, { topic, participants: ['chatgpt', partnerInfo.ai] });

await sleep(300);
const startClicked = await panelPage.evaluate(() => {
  const btn = document.getElementById('start-discussion-btn');
  if (!btn || btn.disabled) return false;
  btn.click();
  return true;
});

const round1 = await waitForRound(panelPage, chatgptInfo.page, 'round1');

let round2 = null;
let summary = null;
let clickedNext = false;
let clickedSummary = false;

if (round1.readyState) {
  clickedNext = await panelPage.evaluate(() => {
    const btn = document.getElementById('next-round-btn');
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  });

  if (clickedNext) {
    round2 = await waitForRound(panelPage, chatgptInfo.page, 'round2');
  }

  clickedSummary = await panelPage.evaluate(() => {
    const btn = document.getElementById('generate-summary-btn');
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  });

  if (clickedSummary) {
    summary = await waitForSummary(panelPage, chatgptInfo.page);
  }
}

const finalPanel = await getPanelState(panelPage);
const finalChatgpt = await sendRuntime(panelPage, { type: 'GET_RESPONSE', aiType: 'chatgpt' });

const result = {
  marker,
  extensionId,
  participants: ['chatgpt', partnerInfo.ai],
  preflight: {
    pages: pageInfos,
    providerPages: providerPages.map(({ ai, url, title }) => ({ ai, url, title })),
    targets: targets.filter(target => /chatgpt|claude|kimi|qianwen|doubao|gemini|chrome-extension/.test(target.url))
  },
  baseline: {
    chatgpt: baseline.chatgpt,
    partner: { ai: partnerInfo.ai, ...baseline.partner }
  },
  startClicked,
  clickedNext,
  clickedSummary,
  round1,
  round2,
  summary,
  finalPanel: {
    status: finalPanel.status,
    nextDisabled: finalPanel.nextDisabled,
    summaryDisabled: finalPanel.summaryDisabled,
    activeVisible: finalPanel.activeVisible,
    summaryVisible: finalPanel.summaryVisible,
    topicDisplay: finalPanel.topicDisplay,
    summaryPreview: finalPanel.summaryText.slice(0, 500),
    logTail: finalPanel.logText.split('\n').slice(-20).join('\n')
  },
  finalChatgpt
};

console.log(JSON.stringify(result, null, 2));

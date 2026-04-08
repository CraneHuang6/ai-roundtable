// AI Panel - Side Panel Controller

const PROVIDERS = [
  {
    id: 'claude',
    label: 'Claude',
    hosts: ['claude.ai'],
    mention: '@Claude',
    supports: { normalSend: true, responseCapture: true, discussion: true, mutual: true, cross: true, fileUpload: true }
  },
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    hosts: ['chat.openai.com', 'chatgpt.com'],
    mention: '@ChatGPT',
    supports: { normalSend: true, responseCapture: true, discussion: true, mutual: true, cross: true, fileUpload: true }
  },
  {
    id: 'gemini',
    label: 'Gemini',
    hosts: ['gemini.google.com'],
    mention: '@Gemini',
    supports: { normalSend: true, responseCapture: true, discussion: true, mutual: true, cross: true, fileUpload: true }
  },
  {
    id: 'doubao',
    label: '豆包',
    hosts: ['www.doubao.com'],
    mention: '@Doubao',
    supports: { normalSend: true, responseCapture: true, discussion: true, mutual: true, cross: true, fileUpload: false }
  },
  {
    id: 'qianwen',
    label: '千问',
    hosts: ['www.qianwen.com', 'www.qianwen.com/chat/'],
    mention: '@Qianwen',
    supports: { normalSend: true, responseCapture: true, discussion: true, mutual: true, cross: true, fileUpload: false }
  }
];

const AI_TYPES = PROVIDERS.map((provider) => provider.id);
const PROVIDER_IDS_PATTERN = PROVIDERS.map((provider) => provider.id).join('|');

function getProviderLabel(aiType) {
  return PROVIDERS.find((provider) => provider.id === aiType)?.label || capitalize(aiType);
}

// Cross-reference action keywords (inserted into message)
const CROSS_REF_ACTIONS = {
  evaluate: { prompt: '评价一下' },
  learn: { prompt: '有什么值得借鉴的' },
  critique: { prompt: '批评一下，指出问题' },
  supplement: { prompt: '有什么遗漏需要补充' },
  compare: { prompt: '对比一下你的观点' }
};

// DOM Elements
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const logContainer = document.getElementById('log-container');
const fileInput = document.getElementById('file-input');
const addFileBtn = document.getElementById('add-file-btn');
const fileList = document.getElementById('file-list');

// Selected files storage
let selectedFiles = [];

// Track connected tabs
const connectedTabs = Object.fromEntries(AI_TYPES.map((ai) => [ai, null]));

// Discussion Mode State
let discussionState = {
  active: false,
  topic: '',
  participants: [],  // [ai1, ai2]
  currentRound: 0,
  history: [],  // [{round, ai, type: 'initial'|'evaluation'|'response', content}]
  pendingResponses: new Set(),  // AIs we're waiting for
  roundType: null  // 'initial', 'cross-eval', 'counter'
};
function createPollingController() {
  return {
    timer: null,
    baselines: new Map(),
    pending: new Set(),
    state: new Map()
  };
}

let discussionPollTimer = null;
let discussionResponseBaselines = new Map();
let discussionPollingState = new Map();
let normalResponsePollTimer = null;
let normalResponseBaselines = new Map();
let normalPendingResponses = new Set();
const normalPollingController = createPollingController();
const discussionPollingController = createPollingController();

const LONG_TEXT_THRESHOLD = 240;
let longTextIdCounter = 0;

function escapeLongText(text) {
  return escapeHtml(String(text ?? '')).replace(/\n/g, '<br>');
}

function isLongText(text) {
  return String(text ?? '').length > LONG_TEXT_THRESHOLD;
}

function renderLongTextHTML(text, options = {}) {
  const normalizedText = String(text ?? '');
  if (!isLongText(normalizedText)) {
    return escapeLongText(normalizedText);
  }

  const previewLength = options.previewLength ?? LONG_TEXT_THRESHOLD;
  const preview = normalizedText.slice(0, previewLength) + '...';
  const longTextId = `long-text-${++longTextIdCounter}`;

  return `
    <div class="long-text-block long-text-toggle" data-long-text-id="${longTextId}" data-expanded="false">
      <div class="long-text-preview">${escapeLongText(preview)}</div>
      <button type="button" class="long-text-toggle-button" data-long-text-toggle="${longTextId}" aria-expanded="false">展开全文</button>
      <div class="long-text-full hidden" hidden>${escapeLongText(normalizedText)}</div>
    </div>
  `;
}

function handleLongTextToggle(event) {
  const toggleButton = event.target.closest('.long-text-toggle-button');
  if (!toggleButton) {
    return;
  }

  const toggle = toggleButton.closest('.long-text-toggle');
  if (!toggle) {
    return;
  }

  const preview = toggle.querySelector('.long-text-preview');
  const full = toggle.querySelector('.long-text-full');
  const expanded = toggle.dataset.expanded === 'true';
  const nextExpanded = !expanded;

  toggle.dataset.expanded = String(nextExpanded);
  toggleButton.setAttribute('aria-expanded', String(nextExpanded));
  toggleButton.textContent = nextExpanded ? '收起' : '展开全文';

  if (preview) {
    preview.hidden = nextExpanded;
    preview.classList.toggle('hidden', nextExpanded);
  }
  if (full) {
    full.hidden = !nextExpanded;
    full.classList.toggle('hidden', !nextExpanded);
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  checkConnectedTabs();
  setupEventListeners();
  setupDiscussionMode();
  setupFileUpload();
});

function setupEventListeners() {
  sendBtn.addEventListener('click', handleSend);
  document.addEventListener('click', handleLongTextToggle);

  // Enter to send, Shift+Enter for new line (like ChatGPT)
  // But ignore Enter during IME composition (e.g., Chinese input)
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      handleSend();
    }
  });

  // Shortcut buttons (/cross, <-)
  document.querySelectorAll('.shortcut-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const insertText = btn.dataset.insert;
      const cursorPos = messageInput.selectionStart;
      const textBefore = messageInput.value.substring(0, cursorPos);
      const textAfter = messageInput.value.substring(cursorPos);

      messageInput.value = textBefore + insertText + textAfter;
      messageInput.focus();
      messageInput.selectionStart = messageInput.selectionEnd = cursorPos + insertText.length;
    });
  });

  // Action select - insert action prompt into textarea
  document.getElementById('action-select').addEventListener('change', (e) => {
    const action = e.target.value;
    if (!action) return;

    const actionConfig = CROSS_REF_ACTIONS[action];
    if (actionConfig) {
      const cursorPos = messageInput.selectionStart;
      const textBefore = messageInput.value.substring(0, cursorPos);
      const textAfter = messageInput.value.substring(cursorPos);

      // Add space before if needed
      const needsSpace = textBefore.length > 0 && !textBefore.endsWith(' ') && !textBefore.endsWith('\n');
      const insertText = (needsSpace ? ' ' : '') + actionConfig.prompt + ' ';

      messageInput.value = textBefore + insertText + textAfter;
      messageInput.focus();
      messageInput.selectionStart = messageInput.selectionEnd = cursorPos + insertText.length;
    }

    // Reset select to placeholder
    e.target.value = '';
  });

  // Mention buttons - insert @AI into textarea
  document.querySelectorAll('.mention-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mention = btn.dataset.mention;
      const cursorPos = messageInput.selectionStart;
      const textBefore = messageInput.value.substring(0, cursorPos);
      const textAfter = messageInput.value.substring(cursorPos);

      // Add space before if needed
      const needsSpace = textBefore.length > 0 && !textBefore.endsWith(' ') && !textBefore.endsWith('\n');
      const insertText = (needsSpace ? ' ' : '') + mention + ' ';

      messageInput.value = textBefore + insertText + textAfter;
      messageInput.focus();
      messageInput.selectionStart = messageInput.selectionEnd = cursorPos + insertText.length;
    });
  });

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
    if (message.type === 'TAB_STATUS_UPDATE') {
      updateTabStatus(message.aiType, message.connected);
    } else if (message.type === 'RESPONSE_CAPTURED') {
      // Handle discussion mode response
      if (discussionState.active && shouldHandleDiscussionCapture(message.aiType, message.content)) {
        handleDiscussionResponse(message.aiType, message.content);
      } else if (shouldHandleNormalCapture(message.aiType, message.content)) {
        handleNormalResponse(message.aiType, message.content);
      } else {
        log(`${message.aiType}: Response captured`, 'success');
      }
    } else if (message.type === 'SEND_RESULT') {
      if (message.success) {
        log(`${message.aiType}: Message sent`, 'success');
      } else {
        log(`${message.aiType}: Failed - ${message.error}`, 'error');
      }
    }
  });
}

async function checkConnectedTabs() {
  try {
    const tabs = await chrome.tabs.query({});

    for (const tab of tabs) {
      const aiType = getAITypeFromUrl(tab.url);
      if (aiType) {
        connectedTabs[aiType] = tab.id;
        updateTabStatus(aiType, true);
      }
    }
  } catch (err) {
    log('Error checking tabs: ' + err.message, 'error');
  }
}

function getAITypeFromUrl(url) {
  if (!url) return null;
  for (const provider of PROVIDERS) {
    if (provider.hosts.some((host) => url.includes(host))) {
      return provider.id;
    }
  }
  return null;
}

function updateTabStatus(aiType, connected) {
  const statusEl = document.getElementById(`status-${aiType}`);
  if (statusEl) {
    // Status is now a dot indicator, no text needed
    statusEl.className = 'status ' + (connected ? 'connected' : 'disconnected');
    statusEl.title = connected ? '已连接' : '未找到';
  }
  if (connected) {
    connectedTabs[aiType] = true;
  }
}

async function handleSend() {
  const message = messageInput.value.trim();
  if (!message) return;

  // Parse message for @ mentions
  const parsed = parseMessage(message);

  // Determine targets
  let targets;
  if (parsed.mentions.length > 0) {
    // If @ mentioned specific AIs, only send to those
    targets = parsed.mentions;
  } else {
    // Otherwise use checkbox selection
    targets = AI_TYPES.filter(ai => {
      const checkbox = document.getElementById(`target-${ai}`);
      return checkbox && checkbox.checked;
    });
  }

  if (targets.length === 0) {
    log('No targets selected', 'error');
    return;
  }

  sendBtn.disabled = true;

  // Clear input immediately after sending
  messageInput.value = '';

  // Send files first if any
  const filesToSend = [...selectedFiles];
  if (filesToSend.length > 0) {
    const fileCapableTargets = targets.filter((target) => {
      const provider = PROVIDERS.find((item) => item.id === target);
      return provider?.supports.fileUpload;
    });
    const skippedTargets = targets.filter((target) => !fileCapableTargets.includes(target));

    skippedTargets.forEach((target) => {
      log(`${getProviderLabel(target)}: 暂不支持自动文件上传`, 'error');
    });

    if (fileCapableTargets.length > 0) {
      log(`正在上传 ${filesToSend.length} 个文件...`);
      for (const target of fileCapableTargets) {
        await sendFilesToAI(target, filesToSend);
      }
    }

    clearFiles();
    // Wait a bit for files to be processed before sending message
    await new Promise(r => setTimeout(r, 500));
  }

  try {
    // If mutual review, handle specially
    if (parsed.mutual) {
      if (targets.length < 2) {
        log('Mutual review requires at least 2 AIs selected', 'error');
      } else {
        log(`Mutual review: ${targets.join(', ')}`);
        await handleMutualReview(targets, parsed.prompt);
      }
    }
    // If cross-reference, handle specially
    else if (parsed.crossRef) {
      log(`Cross-reference: ${parsed.targetAIs.join(', ')} <- ${parsed.sourceAIs.join(', ')}`);
      await handleCrossReference(parsed);
    } else {
      // Send to target(s)
      await captureResponseBaselines(normalPollingController, targets, { pending: targets });
      startNormalResponsePolling();

      log(`Sending to: ${targets.join(', ')}`);
      for (const target of targets) {
        await sendToAI(target, message);
      }
    }
  } catch (err) {
    log('Error: ' + err.message, 'error');
  }

  sendBtn.disabled = false;
  messageInput.focus();
}

function parseMessage(message) {
  // Check for /mutual command: /mutual [optional prompt]
  // Triggers mutual review based on current responses (no new topic needed)
  const trimmedMessage = message.trim();
  if (trimmedMessage.toLowerCase() === '/mutual' || trimmedMessage.toLowerCase().startsWith('/mutual ')) {
    // Extract everything after "/mutual " as the prompt
    const prompt = trimmedMessage.length > 7 ? trimmedMessage.substring(7).trim() : '';
    return {
      mutual: true,
      prompt: prompt || '请评价以上观点。你同意什么？不同意什么？有什么补充？',
      crossRef: false,
      mentions: [],
      originalMessage: message
    };
  }

  // Check for /cross command first: /cross @targets <- @sources message
  // Use this for complex cases (3 AIs, or when you want to be explicit)
  if (message.trim().toLowerCase().startsWith('/cross ')) {
    const arrowIndex = message.indexOf('<-');
    if (arrowIndex === -1) {
      // No arrow found, treat as regular message
      return { crossRef: false, mentions: [], originalMessage: message };
    }

    const beforeArrow = message.substring(7, arrowIndex).trim(); // Skip "/cross "
    const afterArrow = message.substring(arrowIndex + 2).trim();  // Skip "<-"

    // Extract targets (before arrow)
    const mentionPattern = new RegExp(`@(${PROVIDER_IDS_PATTERN})`, 'gi');
    const targetMatches = [...beforeArrow.matchAll(mentionPattern)];
    const targetAIs = [...new Set(targetMatches.map(m => m[1].toLowerCase()))];

    // Extract sources and message (after arrow)
    // Find all @mentions in afterArrow, sources are all @mentions
    // Message is everything after the last @mention
    const sourceMatches = [...afterArrow.matchAll(mentionPattern)];
    const sourceAIs = [...new Set(sourceMatches.map(m => m[1].toLowerCase()))];

    // Find where the actual message starts (after the last @mention)
    let actualMessage = afterArrow;
    if (sourceMatches.length > 0) {
      const lastMatch = sourceMatches[sourceMatches.length - 1];
      const lastMentionEnd = lastMatch.index + lastMatch[0].length;
      actualMessage = afterArrow.substring(lastMentionEnd).trim();
    }

    if (targetAIs.length > 0 && sourceAIs.length > 0) {
      return {
        crossRef: true,
        mentions: [...targetAIs, ...sourceAIs],
        targetAIs,
        sourceAIs,
        originalMessage: actualMessage
      };
    }
  }

  // Pattern-based detection for @ mentions
  const mentionPattern = new RegExp(`@(${PROVIDER_IDS_PATTERN})`, 'gi');
  const matches = [...message.matchAll(mentionPattern)];
  const mentions = [...new Set(matches.map(m => m[1].toLowerCase()))];

  // For exactly 2 AIs: use keyword detection (simpler syntax)
  // Last mentioned = source (being evaluated), first = target (doing evaluation)
  if (mentions.length === 2) {
    const evalKeywords = /评价|看看|怎么样|怎么看|如何|讲的|说的|回答|赞同|同意|分析|认为|观点|看法|意见|借鉴|批评|补充|对比|evaluate|think of|opinion|review|agree|analysis|compare|learn from/i;

    if (evalKeywords.test(message)) {
      const sourceAI = matches[matches.length - 1][1].toLowerCase();
      const targetAI = matches[0][1].toLowerCase();

      return {
        crossRef: true,
        mentions,
        targetAIs: [targetAI],
        sourceAIs: [sourceAI],
        originalMessage: message
      };
    }
  }

  // For 3+ AIs without /cross command: just send to all (no cross-reference)
  // User should use /cross command for complex 3-AI scenarios
  return {
    crossRef: false,
    mentions,
    originalMessage: message
  };
}

async function collectRequiredResponses(aiTypes, options = {}) {
  const responses = [];
  const errorPrefix = options.errorPrefix || 'Could not get';
  const errorSuffix = options.errorSuffix || "'s response";

  for (const aiType of aiTypes) {
    const response = await getLatestResponse(aiType);
    const normalizedResponse = response?.content?.trim() || '';
    if (!normalizedResponse) {
      log(`${errorPrefix} ${aiType}${errorSuffix}`, 'error');
      return null;
    }
    responses.push({ ai: aiType, content: normalizedResponse });
  }

  return responses;
}

function syncPollingControllerAliases() {
  normalResponsePollTimer = normalPollingController.timer;
  normalResponseBaselines = normalPollingController.baselines;
  normalPendingResponses = normalPollingController.pending;
  discussionPollTimer = discussionPollingController.timer;
  discussionResponseBaselines = discussionPollingController.baselines;
  discussionPollingState = discussionPollingController.state;
}

function clearResponsePolling(controller) {
  if (controller.timer) {
    clearInterval(controller.timer);
    controller.timer = null;
  }
  syncPollingControllerAliases();
}

async function captureResponseBaselines(controller, aiTypes, options = {}) {
  clearResponsePolling(controller);
  controller.baselines = new Map();
  controller.pending = options.pending ? new Set(options.pending) : new Set();
  controller.state = new Map();

  await Promise.all(aiTypes.map(async (ai) => {
    const response = await getLatestResponse(ai);
    const normalizedResponse = response?.content?.trim() || '';
    controller.baselines.set(ai, normalizedResponse);
    if (options.createState) {
      controller.state.set(ai, options.createState(ai, normalizedResponse, response));
    }
  }));

  syncPollingControllerAliases();
}

function startResponsePolling(controller, options) {
  clearResponsePolling(controller);

  controller.timer = setInterval(async () => {
    if (options.shouldStop()) {
      clearResponsePolling(controller);
      return;
    }

    const pending = Array.from(controller.pending);
    for (const ai of pending) {
      const response = await getLatestResponse(ai);
      const normalizedResponse = response?.content?.trim() || '';
      if (!options.shouldAccept(ai, normalizedResponse, controller, response)) {
        continue;
      }
      options.onAccept(ai, normalizedResponse, controller, response);
    }

    syncPollingControllerAliases();
  }, options.intervalMs ?? 500);

  syncPollingControllerAliases();
}

function shouldAcceptPolledNormalResponse(aiType, normalizedResponse, _controller, responseMeta = {}) {
  const baseline = normalPollingController.baselines.get(aiType) || '';
  if (!normalizedResponse || normalizedResponse === baseline) {
    return false;
  }

  const pollingState = normalPollingController.state.get(aiType) || {
    lastObserved: baseline,
    stableCount: 0
  };

  if (normalizedResponse !== pollingState.lastObserved) {
    pollingState.lastObserved = normalizedResponse;
    pollingState.stableCount = 0;
    normalPollingController.state.set(aiType, pollingState);
    return false;
  }

  if (responseMeta.streamingActive || responseMeta.captureState === 'unknown') {
    pollingState.stableCount = 0;
    normalPollingController.state.set(aiType, pollingState);
    return false;
  }

  pollingState.stableCount += 1;
  normalPollingController.state.set(aiType, pollingState);
  return pollingState.stableCount >= 2;
}

function shouldHandleNormalCapture(aiType, content) {
  if (!normalPollingController.pending.has(aiType)) {
    return false;
  }

  return shouldAcceptPolledNormalResponse(aiType, content?.trim() || '');
}

function handleNormalResponse(aiType, content) {
  const normalizedResponse = content?.trim() || '';
  const baseline = normalPollingController.baselines.get(aiType) || '';
  if (!normalizedResponse || normalizedResponse === baseline) {
    return;
  }

  normalPollingController.baselines.set(aiType, normalizedResponse);
  normalPollingController.pending.delete(aiType);
  syncPollingControllerAliases();
  log(`${aiType}: Response captured`, 'success');

  if (normalPollingController.pending.size === 0) {
    clearResponsePolling(normalPollingController);
  }
}

function clearNormalResponsePolling() {
  clearResponsePolling(normalPollingController);
}

async function captureNormalBaselines(aiTypes) {
  await captureResponseBaselines(normalPollingController, aiTypes);
}

function startNormalResponsePolling() {
  startResponsePolling(normalPollingController, {
    shouldStop: () => normalPollingController.pending.size === 0,
    shouldAccept: (ai, normalizedResponse, controller, responseMeta) =>
      shouldAcceptPolledNormalResponse(ai, normalizedResponse, controller, responseMeta),
    onAccept: (ai, normalizedResponse) => handleNormalResponse(ai, normalizedResponse)
  });
}

async function handleCrossReference(parsed) {
  // Get responses from all source AIs
  const sourceResponses = await collectRequiredResponses(parsed.sourceAIs);
  if (!sourceResponses) {
    return;
  }

  // Build the full message with XML tags for each source
  let fullMessage = `请用中文回复。\n${parsed.originalMessage}\n`;

  for (const source of sourceResponses) {
    fullMessage += `
<${source.ai}_response>
${source.content}
</${source.ai}_response>`;
  }

  // Send to all target AIs
  for (const targetAI of parsed.targetAIs) {
    await sendToAI(targetAI, fullMessage);
  }
}

// ============================================
// Mutual Review Functions
// ============================================

async function handleMutualReview(participants, prompt) {
  // Get current responses from all participants
  const responses = {};

  log(`[Mutual] Fetching responses from ${participants.join(', ')}...`);

  const responseEntries = await collectRequiredResponses(participants, {
    errorPrefix: '[Mutual] Could not get',
    errorSuffix: "'s response - make sure it has replied first"
  });
  if (!responseEntries) {
    return;
  }

  for (const entry of responseEntries) {
    responses[entry.ai] = entry.content;
    log(`[Mutual] Got ${entry.ai}'s response (${entry.content.length} chars)`);
  }

  log(`[Mutual] All responses collected. Sending cross-evaluations...`);

  // For each AI, send them the responses from all OTHER AIs
  for (const targetAI of participants) {
    const otherAIs = participants.filter(ai => ai !== targetAI);

    // Build message with all other AIs' responses
    let evalMessage = `以下是其他 AI 的观点：\n`;

    for (const sourceAI of otherAIs) {
      evalMessage += `
<${sourceAI}_response>
${responses[sourceAI]}
</${sourceAI}_response>
`;
    }

    evalMessage += `\n请用中文回复。\n${prompt}`;

    log(`[Mutual] Sending to ${targetAI}: ${otherAIs.join('+')} responses + prompt`);
    await sendToAI(targetAI, evalMessage);
  }

  log(`[Mutual] Complete! All ${participants.length} AIs received cross-evaluations`, 'success');
}

async function getLatestResponse(aiType) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'GET_RESPONSE', aiType },
      (response) => {
        resolve({
          content: response?.content || null,
          streamingActive: Boolean(response?.streamingActive),
          captureState: response?.captureState || 'complete'
        });
      }
    );
  });
}

async function sendToAI(aiType, message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'SEND_MESSAGE', aiType, message },
      (response) => {
        if (response?.success) {
          log(`Sent to ${aiType}`, 'success');
        } else {
          log(`Failed to send to ${aiType}: ${response?.error || 'Unknown error'}`, 'error');
        }
        resolve(response);
      }
    );
  });
}

function log(message, type = 'info') {
  const entry = document.createElement('div');
  entry.className = 'log-entry' + (type !== 'info' ? ` ${type}` : '');

  const time = new Date().toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  entry.innerHTML = `<span class="time">${time}</span>${renderLongTextHTML(message)}`;
  logContainer.insertBefore(entry, logContainer.firstChild);

  // Keep only last 50 entries
  while (logContainer.children.length > 50) {
    logContainer.removeChild(logContainer.lastChild);
  }
}

// ============================================
// Discussion Mode Functions
// ============================================

function setupDiscussionMode() {
  // Mode switcher buttons
  document.getElementById('mode-normal').addEventListener('click', () => switchMode('normal'));
  document.getElementById('mode-discussion').addEventListener('click', () => switchMode('discussion'));

  // Discussion controls
  document.getElementById('start-discussion-btn').addEventListener('click', startDiscussion);
  document.getElementById('next-round-btn').addEventListener('click', nextRound);
  document.getElementById('end-discussion-btn').addEventListener('click', endDiscussion);
  document.getElementById('generate-summary-btn').addEventListener('click', generateSummary);
  document.getElementById('new-discussion-btn').addEventListener('click', resetDiscussion);
  document.getElementById('interject-btn').addEventListener('click', handleInterject);

  // Participant selection validation
  document.querySelectorAll('input[name="participant"]').forEach(checkbox => {
    checkbox.addEventListener('change', validateParticipants);
  });
}

function switchMode(mode) {
  const normalMode = document.getElementById('normal-mode');
  const discussionMode = document.getElementById('discussion-mode');
  const normalBtn = document.getElementById('mode-normal');
  const discussionBtn = document.getElementById('mode-discussion');

  if (mode === 'normal') {
    normalMode.classList.remove('hidden');
    discussionMode.classList.add('hidden');
    normalBtn.classList.add('active');
    discussionBtn.classList.remove('active');
  } else {
    normalMode.classList.add('hidden');
    discussionMode.classList.remove('hidden');
    normalBtn.classList.remove('active');
    discussionBtn.classList.add('active');
  }
}

function validateParticipants() {
  const selected = document.querySelectorAll('input[name="participant"]:checked');
  const startBtn = document.getElementById('start-discussion-btn');
  startBtn.disabled = selected.length < 2 || selected.length > 3;
}

async function startDiscussion() {
  const topic = document.getElementById('discussion-topic').value.trim();
  if (!topic) {
    log('请输入讨论主题', 'error');
    return;
  }

  const selected = Array.from(document.querySelectorAll('input[name="participant"]:checked'))
    .map(cb => cb.value);

  if (selected.length < 2 || selected.length > 3) {
    log('请选择 2~3 位参与者', 'error');
    return;
  }

  // Initialize discussion state
  discussionState = {
    active: true,
    topic: topic,
    participants: selected,
    currentRound: 1,
    history: [],
    pendingResponses: new Set(selected),
    roundType: 'initial'
  };

  await captureResponseBaselines(discussionPollingController, selected, {
    pending: discussionState.pendingResponses,
    createState: (_ai, normalizedResponse) => ({
      lastObserved: normalizedResponse,
      stableCount: 0
    })
  });
  startDiscussionResponsePolling();

  // Update UI
  document.getElementById('discussion-setup').classList.add('hidden');
  document.getElementById('discussion-active').classList.remove('hidden');
  document.getElementById('round-badge').textContent = '第 1 轮';
  document.getElementById('participants-badge').textContent =
    selected.map(getProviderLabel).join(' · ');
  document.getElementById('topic-display').innerHTML = renderLongTextHTML(topic);
  updateDiscussionStatus('waiting', `等待 ${selected.map(getProviderLabel).join('、')} 的初始回复...`);

  // Disable buttons during round
  document.getElementById('next-round-btn').disabled = true;
  document.getElementById('generate-summary-btn').disabled = true;

  log(`讨论开始: ${selected.map(capitalize).join('、')}`, 'success');

  // Send topic to both AIs
  for (const ai of selected) {
    await sendToAI(ai, `请围绕以下话题分享你的看法，并始终使用中文回复：\n\n${topic}`);
  }
}

function shouldHandleDiscussionCapture(aiType, content) {
  if (!discussionState.active) return false;

  const normalizedResponse = content?.trim() || '';
  const baseline = discussionPollingController.baselines.get(aiType) || '';

  if (!normalizedResponse || normalizedResponse === baseline) {
    return false;
  }

  if (discussionState.pendingResponses.has(aiType)) {
    return true;
  }

  const existingEntry = discussionState.history.find(
    entry =>
      entry.round === discussionState.currentRound &&
      entry.ai === aiType &&
      entry.type === discussionState.roundType
  );

  return Boolean(existingEntry);
}

function handleDiscussionResponse(aiType, content) {
  if (!discussionState.active) return;

  const normalizedResponse = content?.trim() || '';
  const baseline = discussionPollingController.baselines.get(aiType) || '';
  if (!normalizedResponse || normalizedResponse === baseline) {
    return;
  }

  const existingEntry = discussionState.history.find(
    entry =>
      entry.round === discussionState.currentRound &&
      entry.ai === aiType &&
      entry.type === discussionState.roundType
  );

  if (existingEntry) {
    if (normalizedResponse.length <= existingEntry.content.length) {
      return;
    }

    existingEntry.content = normalizedResponse;
    discussionPollingController.baselines.set(aiType, normalizedResponse);
    syncPollingControllerAliases();
    log(`讨论: ${aiType} 回复已更新 (第 ${discussionState.currentRound} 轮)`, 'success');
    return;
  }

  // Record this response in history
  discussionState.history.push({
    round: discussionState.currentRound,
    ai: aiType,
    type: discussionState.roundType,
    content: normalizedResponse
  });

  discussionPollingController.baselines.set(aiType, normalizedResponse);
  syncPollingControllerAliases();

  // Remove from pending
  discussionState.pendingResponses.delete(aiType);

  log(`讨论: ${aiType} 已回复 (第 ${discussionState.currentRound} 轮)`, 'success');

  // Check if all pending responses received
  if (discussionState.pendingResponses.size === 0) {
    onRoundComplete();
  } else {
    const remaining = Array.from(discussionState.pendingResponses).join(', ');
    updateDiscussionStatus('waiting', `等待 ${remaining}...`);
  }
}

function onRoundComplete() {
  clearDiscussionPolling();
  log(`第 ${discussionState.currentRound} 轮完成`, 'success');
  updateDiscussionStatus('ready', `第 ${discussionState.currentRound} 轮完成，可以进入下一轮`);

  // Enable next round button
  document.getElementById('next-round-btn').disabled = false;
  document.getElementById('generate-summary-btn').disabled = false;
}

async function nextRound() {
  discussionState.currentRound++;
  const participants = discussionState.participants;

  // Update UI
  document.getElementById('round-badge').textContent = `第 ${discussionState.currentRound} 轮`;
  document.getElementById('next-round-btn').disabled = true;
  document.getElementById('generate-summary-btn').disabled = true;

  // Get previous round responses for all participants
  const prevRound = discussionState.currentRound - 1;
  const prevResponses = new Map();

  for (const ai of participants) {
    const response = discussionState.history.find(
      h => h.round === prevRound && h.ai === ai
    )?.content;
    if (!response) {
      log('缺少上一轮的回复', 'error');
      return;
    }
    prevResponses.set(ai, response);
  }

  // Set pending responses
  discussionState.pendingResponses = new Set(participants);
  discussionState.roundType = 'cross-eval';

  await captureResponseBaselines(discussionPollingController, participants, {
    pending: discussionState.pendingResponses,
    createState: (_ai, normalizedResponse) => ({
      lastObserved: normalizedResponse,
      stableCount: 0
    })
  });
  startDiscussionResponsePolling();

  updateDiscussionStatus('waiting', `第 ${discussionState.currentRound} 轮：各方继续讨论...`);

  log(`第 ${discussionState.currentRound} 轮: 交叉评价开始`);

  // Send to each participant: the other participants' responses
  for (const ai of participants) {
    const otherParticipants = participants.filter(p => p !== ai);

    let prompt = `以下是其他参与者针对话题”${discussionState.topic}”的回复：\n\n`;

    for (const other of otherParticipants) {
      prompt += `<${other}_response>\n${prevResponses.get(other)}\n</${other}_response>\n\n`;
    }

    prompt += `请用中文回复。请评价这些回复，并说明：
1. 你同意什么
2. 你不同意什么
3. 你会补充或修改什么`;

    await sendToAI(ai, prompt);
  }
}

async function handleInterject() {
  const input = document.getElementById('interject-input');
  const message = input.value.trim();

  if (!message) {
    log('请输入要发送的消息', 'error');
    return;
  }

  if (!discussionState.active || discussionState.participants.length === 0) {
    log('当前没有进行中的讨论', 'error');
    return;
  }

  const btn = document.getElementById('interject-btn');
  btn.disabled = true;

  const participants = discussionState.participants;

  log(`[插话] 正在获取各方最新回复...`);

  // Get latest responses from all participants
  const latestResponses = new Map();
  for (const ai of participants) {
    const response = await getLatestResponse(ai);
    const normalizedResponse = response?.content?.trim() || '';
    if (!normalizedResponse) {
      log(`[插话] 无法获取 ${capitalize(ai)} 的回复`, 'error');
      btn.disabled = false;
      return;
    }
    latestResponses.set(ai, normalizedResponse);
  }

  log(`[插话] 已获取各方回复，正在发送...`);

  // Send to each participant: user message + all other participants' responses
  for (const ai of participants) {
    const otherParticipants = participants.filter(p => p !== ai);

    let prompt = `${message}\n\n请用中文回复。以下是其他参与者的最新回复：\n\n`;

    for (const other of otherParticipants) {
      prompt += `<${other}_response>\n${latestResponses.get(other)}\n</${other}_response>\n\n`;
    }

    await sendToAI(ai, prompt.trim());
  }

  log(`[插话] 已发送给各方（含其他方回复）`, 'success');

  // Clear input
  input.value = '';
  btn.disabled = false;
}

async function generateSummary() {
  document.getElementById('generate-summary-btn').disabled = true;
  updateDiscussionStatus('waiting', '正在请求各方生成总结...');

  const participants = discussionState.participants;

  // Build conversation history for summary
  let historyText = `主题: ${discussionState.topic}\n\n`;

  for (let round = 1; round <= discussionState.currentRound; round++) {
    historyText += `=== 第 ${round} 轮 ===\n\n`;
    const roundEntries = discussionState.history.filter(h => h.round === round);
    for (const entry of roundEntries) {
      historyText += `[${capitalize(entry.ai)}]:\n${entry.content}\n\n`;
    }
  }

  const summaryPrompt = `请用中文回复，并对以下 AI 之间的讨论进行总结。请包含：
1. 主要共识点
2. 主要分歧点
3. 各方的核心观点
4. 总体结论

讨论历史：
${historyText}`;

  // Send to all participants
  discussionState.roundType = 'summary';
  discussionState.pendingResponses = new Set(participants);

  await captureResponseBaselines(discussionPollingController, participants, {
    pending: discussionState.pendingResponses,
    createState: (_ai, normalizedResponse) => ({
      lastObserved: normalizedResponse,
      stableCount: 0
    })
  });
  startDiscussionResponsePolling();

  log(`[Summary] 正在请求各方生成总结...`);
  for (const ai of participants) {
    await sendToAI(ai, summaryPrompt);
  }

  // Wait for all responses, then allow a short settle window for fuller updates
  const settleWindowMs = 1500;
  let settleStartedAt = null;
  let lastSignature = '';

  const checkForSummary = setInterval(async () => {
    const summaries = discussionState.history.filter(h => h.type === 'summary');
    const summaryArgs = participants.map(ai => summaries.find(s => s.ai === ai)?.content || '');
    const signature = summaryArgs.join('\n<summary-split>\n');

    if (discussionState.pendingResponses.size === 0) {
      if (signature !== lastSignature) {
        lastSignature = signature;
        settleStartedAt = Date.now();
        return;
      }

      if (settleStartedAt === null) {
        settleStartedAt = Date.now();
        return;
      }

      if (Date.now() - settleStartedAt >= settleWindowMs) {
        clearInterval(checkForSummary);
        log(`[Summary] 各方总结已生成`, 'success');
        showSummary(...summaryArgs);
      }
      return;
    }

    settleStartedAt = null;
    lastSignature = signature;
  }, 500);
}

function showSummary(...summaries) {
  document.getElementById('discussion-active').classList.add('hidden');
  document.getElementById('discussion-summary').classList.remove('hidden');

  const participants = discussionState.participants;

  // Handle empty summaries
  if (summaries.every(s => !s)) {
    log('警告: 未收到 AI 的总结内容', 'error');
  }

  // Build summary HTML - show all summaries
  let html = `<div class="round-summary">
    <h4>讨论总结</h4>
    <div class="summary-comparison">`;

  participants.forEach((ai, index) => {
    html += `
      <div class="ai-response">
        <div class="ai-name ${ai}">${capitalize(ai)} 的总结：</div>
        <div>${renderLongTextHTML(summaries[index] || '')}</div>
      </div>`;
  });

  html += `
    </div>
  </div>`;

  // Add round-by-round history
  html += `<div class="round-summary"><h4>完整讨论历史</h4>`;
  for (let round = 1; round <= discussionState.currentRound; round++) {
    const roundEntries = discussionState.history.filter(h => h.round === round && h.type !== 'summary');
    if (roundEntries.length > 0) {
      html += `<div style="margin-top:12px"><strong>第 ${round} 轮</strong></div>`;
      for (const entry of roundEntries) {
        html += `<div class="ai-response">
          <div class="ai-name ${entry.ai}">${capitalize(entry.ai)}:</div>
          <div>${renderLongTextHTML(entry.content)}</div>
        </div>`;
      }
    }
  }
  html += `</div>`;

  document.getElementById('summary-content').innerHTML = html;
  discussionState.active = false;
  log('讨论总结已生成', 'success');
}

function endDiscussion() {
  if (confirm('确定结束讨论吗？建议先生成总结。')) {
    resetDiscussion();
  }
}

function resetDiscussion() {
  clearDiscussionPolling();
  discussionResponseBaselines = new Map();
  discussionState = {
    active: false,
    topic: '',
    participants: [],
    currentRound: 0,
    history: [],
    pendingResponses: new Set(),
    roundType: null
  };

  // Reset UI
  document.getElementById('discussion-setup').classList.remove('hidden');
  document.getElementById('discussion-active').classList.add('hidden');
  document.getElementById('discussion-summary').classList.add('hidden');
  document.getElementById('discussion-topic').value = '';
  document.getElementById('next-round-btn').disabled = true;
  document.getElementById('generate-summary-btn').disabled = true;

  log('讨论已结束');
}

function updateDiscussionStatus(state, text) {
  const statusEl = document.getElementById('discussion-status');
  statusEl.textContent = text;
  statusEl.className = 'discussion-status ' + state;
}

function clearDiscussionPolling() {
  clearResponsePolling(discussionPollingController);
}

function shouldAcceptPolledDiscussionResponse(ai, normalizedResponse, _controller, responseMeta = {}) {
  const baseline = discussionResponseBaselines.get(ai) || '';
  if (!normalizedResponse || normalizedResponse === baseline) {
    return false;
  }

  const pollingState = discussionPollingState.get(ai) || { lastObserved: baseline, stableCount: 0 };

  if (normalizedResponse !== pollingState.lastObserved) {
    pollingState.lastObserved = normalizedResponse;
    pollingState.stableCount = 0;
    discussionPollingState.set(ai, pollingState);
    return false;
  }

  if (responseMeta.streamingActive || responseMeta.captureState === 'unknown') {
    pollingState.stableCount = 0;
    discussionPollingState.set(ai, pollingState);
    return false;
  }

  pollingState.stableCount += 1;
  discussionPollingState.set(ai, pollingState);
  return pollingState.stableCount >= 2;
}

function startDiscussionResponsePolling() {
  startResponsePolling(discussionPollingController, {
    shouldStop: () => !discussionState.active || discussionState.pendingResponses.size === 0,
    shouldAccept: (ai, normalizedResponse, controller, responseMeta) =>
      shouldAcceptPolledDiscussionResponse(ai, normalizedResponse, controller, responseMeta),
    onAccept: (ai, normalizedResponse) => {
      handleDiscussionResponse(ai, normalizedResponse);
    }
  });
}

function capitalize(str) {
  if (str === 'chatgpt') return 'ChatGPT';
  if (str === 'doubao') return '豆包';
  if (str === 'qianwen') return '千问';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================
// File Upload Functions
// ============================================

function setupFileUpload() {
  addFileBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    files.forEach(file => addFile(file));
    fileInput.value = ''; // Reset for next selection
  });
}

function addFile(file) {
  // Check file size (max 10MB)
  if (file.size > 10 * 1024 * 1024) {
    log(`文件 ${file.name} 超过 10MB 限制`, 'error');
    return;
  }

  // Check for duplicates
  if (selectedFiles.some(f => f.name === file.name && f.size === file.size)) {
    return;
  }

  selectedFiles.push(file);
  renderFileList();
}

function removeFile(index) {
  selectedFiles.splice(index, 1);
  renderFileList();
}

function renderFileList() {
  fileList.innerHTML = '';

  selectedFiles.forEach((file, index) => {
    const item = document.createElement('div');
    item.className = 'file-item';
    item.innerHTML = `
      <span class="file-name" title="${file.name}">${file.name}</span>
      <button class="remove-file" title="移除">&times;</button>
    `;
    item.querySelector('.remove-file').addEventListener('click', () => removeFile(index));
    fileList.appendChild(item);
  });
}

function clearFiles() {
  selectedFiles = [];
  renderFileList();
}

async function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      resolve({
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        base64
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function sendFilesToAI(aiType, files) {
  log(`${aiType}: 准备上传 ${files.length} 个文件...`);
  const fileDataArray = await Promise.all(files.map(readFileAsBase64));
  log(`${aiType}: 文件已编码，正在发送...`);

  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'SEND_FILES', aiType, files: fileDataArray },
      (response) => {
        if (response?.success) {
          log(`${aiType}: 文件上传成功 (${files.length} 个)`, 'success');
        } else {
          log(`${aiType}: 文件上传失败 - ${response?.error || 'Unknown'}`, 'error');
        }
        resolve(response);
      }
    );
  });
}

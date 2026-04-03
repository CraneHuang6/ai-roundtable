# Discussion Mode 2-to-3 Participants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let discussion mode support selecting any 2 of Claude/ChatGPT/Gemini or all 3, while keeping one unified multi-round discussion flow and explicit Chinese prompts at every discussion stage.

**Architecture:** Keep the change localized to the side panel by replacing pair-specific discussion orchestration with `participants` array + `otherParticipants` filtering in `sidepanel/panel.js`. Update the discussion-mode copy in `sidepanel/panel.html` and README, then lock the behavior down with focused regression tests in `tests/panel-discussion.test.mjs`.

**Tech Stack:** Chrome extension side panel, vanilla JavaScript, HTML, existing CSS, Node built-in test runner (`node --test`), VM-based panel test harness

---

## File Map

- Modify: `sidepanel/panel.js`
  - Relax participant validation from exactly 2 to `2~3`
  - Replace `[ai1, ai2]` orchestration with participant-array loops
  - Generalize next-round, interject, and summary prompt building
  - Render participant badge and summary cards from the selected participant array
- Modify: `sidepanel/panel.html`
  - Update discussion-mode hint and button copy from two-party wording to generalized participant wording
- Modify: `tests/panel-discussion.test.mjs`
  - Add failing tests for `2~3` validation, generalized badge/copy, three-participant next round, interject, and summary rendering
  - Expose `validateParticipants`, `handleInterject`, and `generateSummary` from the VM harness
- Modify: `README.md`
  - Update discussion-mode product description, flow, and limitations from fixed two-party wording to `2~3` participants

---

### Task 1: Add failing discussion tests for 2~3 participant behavior

**Files:**
- Modify: `tests/panel-discussion.test.mjs`
- Test: `tests/panel-discussion.test.mjs`

- [ ] **Step 1: Extend the test harness export block so the discussion helpers are directly testable**

Replace the injected export block in `tests/panel-discussion.test.mjs` with:

```js
const source = fs.readFileSync(PANEL_JS, 'utf8') + `
globalThis.__panelTest = {
  getDiscussionState: () => discussionState,
  setDiscussionState: (value) => { discussionState = value; },
  getOnMessageListener: () => globalThis.__onMessageListener,
  validateParticipants,
  startDiscussion,
  nextRound,
  handleInterject,
  generateSummary,
  showSummary
};
`;
```

This keeps the existing exports and adds the three entry points needed for validation, interject, and summary tests.

- [ ] **Step 2: Add harness helpers for `SEND_MESSAGE` capture and mocked latest responses**

Inside `loadPanel()`, define a `latestResponses` map near the existing local state:

```js
const latestResponses = new Map();
```

Then update `chrome.runtime.sendMessage` so `GET_RESPONSE` can return deterministic test data:

```js
sendMessage(message, callback) {
  sentMessages.push(message);

  if (message.type === 'GET_RESPONSE') {
    callback?.({ success: true, content: latestResponses.get(message.aiType) ?? null });
    return;
  }

  callback?.({ success: true, content: null });
}
```

Finally, extend the returned helpers from `loadPanel()`:

```js
return {
  api: context.__panelTest,
  getElementById: (id) => document.getElementById(id),
  querySelector: (selector) => document.querySelector(selector),
  getOnMessageListener: () => onMessageListener,
  getSentMessages: () => sentMessages,
  getDiscussionMessages: () => sentMessages.filter((message) => message.type === 'SEND_MESSAGE'),
  setSelectedParticipants: (participants) => {
    selectedParticipants = [...participants];
  },
  setLatestResponses: (responses) => {
    latestResponses.clear();
    Object.entries(responses).forEach(([ai, content]) => latestResponses.set(ai, content));
  }
};
```

- [ ] **Step 3: Write the failing validation test for 1/2/3 selected participants**

Append this test:

```js
test('discussion mode enables start only for 2 or 3 selected participants', () => {
  const panel = loadPanel();
  const startButton = panel.getElementById('start-discussion-btn');

  panel.setSelectedParticipants(['claude']);
  panel.api.validateParticipants();
  assert.equal(startButton.disabled, true);

  panel.setSelectedParticipants(['claude', 'chatgpt']);
  panel.api.validateParticipants();
  assert.equal(startButton.disabled, false);

  panel.setSelectedParticipants(['claude', 'chatgpt', 'gemini']);
  panel.api.validateParticipants();
  assert.equal(startButton.disabled, false);
});
```

- [ ] **Step 4: Write the failing start-discussion test for generalized participant copy**

Append this test:

```js
test('discussion start stores all selected participants and renders a neutral participant badge', async () => {
  const panel = loadPanel();
  panel.setSelectedParticipants(['claude', 'chatgpt', 'gemini']);
  panel.getElementById('discussion-topic').value = '三方讨论主题';

  await panel.api.startDiscussion();

  const state = panel.api.getDiscussionState();
  assert.deepEqual(Array.from(state.participants), ['claude', 'chatgpt', 'gemini']);
  assert.equal(panel.getElementById('participants-badge').textContent, 'Claude · ChatGPT · Gemini');
  assert.match(panel.getElementById('discussion-status').textContent, /Claude、ChatGPT、Gemini/);
  assert.doesNotMatch(panel.getElementById('participants-badge').textContent, /vs/);
});
```

- [ ] **Step 5: Write the failing three-participant next-round test**

Append this test:

```js
test('next round sends each participant the other two previous-round replies in three-party mode', async () => {
  const panel = loadPanel();

  panel.api.setDiscussionState({
    active: true,
    topic: '多方协作的优缺点',
    participants: ['claude', 'chatgpt', 'gemini'],
    currentRound: 1,
    history: [
      { round: 1, ai: 'claude', type: 'initial', content: 'Claude 初始观点' },
      { round: 1, ai: 'chatgpt', type: 'initial', content: 'ChatGPT 初始观点' },
      { round: 1, ai: 'gemini', type: 'initial', content: 'Gemini 初始观点' }
    ],
    pendingResponses: new Set(),
    roundType: 'initial'
  });

  await panel.api.nextRound();

  const messages = panel.getDiscussionMessages().slice(-3);
  assert.equal(messages.length, 3);

  const claudePrompt = messages.find((message) => message.aiType === 'claude')?.message ?? '';
  const chatgptPrompt = messages.find((message) => message.aiType === 'chatgpt')?.message ?? '';
  const geminiPrompt = messages.find((message) => message.aiType === 'gemini')?.message ?? '';

  assert.match(claudePrompt, /<chatgpt_response>[\s\S]*ChatGPT 初始观点[\s\S]*<gemini_response>[\s\S]*Gemini 初始观点/);
  assert.match(chatgptPrompt, /<claude_response>[\s\S]*Claude 初始观点[\s\S]*<gemini_response>[\s\S]*Gemini 初始观点/);
  assert.match(geminiPrompt, /<claude_response>[\s\S]*Claude 初始观点[\s\S]*<chatgpt_response>[\s\S]*ChatGPT 初始观点/);
  assert.ok(messages.every((message) => message.message.includes('请始终使用中文回复') || message.message.includes('请用中文回复')));
});
```

- [ ] **Step 6: Write the failing interject and summary tests for three-party mode**

Append these tests:

```js
test('interject sends each participant the user message plus all other latest replies', async () => {
  const panel = loadPanel();
  panel.api.setDiscussionState({
    active: true,
    topic: '三方插话测试',
    participants: ['claude', 'chatgpt', 'gemini'],
    currentRound: 2,
    history: [],
    pendingResponses: new Set(),
    roundType: 'cross-eval'
  });

  panel.setLatestResponses({
    claude: 'Claude 最新回复',
    chatgpt: 'ChatGPT 最新回复',
    gemini: 'Gemini 最新回复'
  });
  panel.getElementById('interject-input').value = '请聚焦工程复杂度';

  await panel.api.handleInterject();

  const messages = panel.getDiscussionMessages().slice(-3);
  assert.equal(messages.length, 3);
  assert.match(messages.find((message) => message.aiType === 'claude')?.message ?? '', /ChatGPT 最新回复[\s\S]*Gemini 最新回复/);
  assert.match(messages.find((message) => message.aiType === 'chatgpt')?.message ?? '', /Claude 最新回复[\s\S]*Gemini 最新回复/);
  assert.match(messages.find((message) => message.aiType === 'gemini')?.message ?? '', /Claude 最新回复[\s\S]*ChatGPT 最新回复/);
});

test('summary view renders one summary card per selected participant', () => {
  const panel = loadPanel();
  panel.api.setDiscussionState({
    active: true,
    topic: '总结卡片测试',
    participants: ['claude', 'chatgpt', 'gemini'],
    currentRound: 1,
    history: [
      { round: 1, ai: 'claude', type: 'initial', content: 'Claude 历史内容' },
      { round: 1, ai: 'chatgpt', type: 'initial', content: 'ChatGPT 历史内容' },
      { round: 1, ai: 'gemini', type: 'initial', content: 'Gemini 历史内容' }
    ],
    pendingResponses: new Set(),
    roundType: 'summary'
  });

  panel.api.showSummary({
    claude: 'Claude 总结',
    chatgpt: 'ChatGPT 总结',
    gemini: 'Gemini 总结'
  });

  const html = panel.getElementById('summary-content').innerHTML;
  assert.match(html, /Claude 的总结/);
  assert.match(html, /ChatGPT 的总结/);
  assert.match(html, /Gemini 的总结/);
  assert.doesNotMatch(html, /双方总结对比/);
});
```

- [ ] **Step 7: Run the discussion test file and verify it fails for the expected reasons**

Run:

```bash
node --test "D:/Coding/ai-roundtable/tests/panel-discussion.test.mjs"
```

Expected: FAIL because current implementation still requires exactly 2 participants, still renders `vs`, still destructures `[ai1, ai2]`, and `showSummary()` only supports two summary strings.

- [ ] **Step 8: Commit the failing tests**

```bash
git add tests/panel-discussion.test.mjs
git commit -m "test: cover discussion mode 2-to-3 participants"
```

---

### Task 2: Update discussion setup copy and validation for 2~3 participants

**Files:**
- Modify: `sidepanel/panel.html:121-183`
- Modify: `sidepanel/panel.js:562-613`
- Test: `tests/panel-discussion.test.mjs`

- [ ] **Step 1: Update the discussion setup copy in `panel.html`**

Change the discussion hint and interject label/button copy from two-party wording to generalized participant wording.

Replace this block in `sidepanel/panel.html`:

```html
<p class="hint">请选择 2 位参与者</p>
```

With:

```html
<p class="hint">请选择 2~3 位参与者</p>
```

Replace this block:

```html
<label>插话（同步发送给讨论双方）</label>
```

With:

```html
<label>插话（同步发送给所有参与者）</label>
```

Replace this button text block:

```html
发送给双方
```

With:

```html
发送给所有参与者
```

- [ ] **Step 2: Change `validateParticipants()` to allow 2 or 3 selections**

Replace the current function in `sidepanel/panel.js`:

```js
function validateParticipants() {
  const selected = document.querySelectorAll('input[name="participant"]:checked');
  const startBtn = document.getElementById('start-discussion-btn');
  startBtn.disabled = selected.length !== 2;
}
```

With:

```js
function validateParticipants() {
  const selected = document.querySelectorAll('input[name="participant"]:checked');
  const startBtn = document.getElementById('start-discussion-btn');
  startBtn.disabled = selected.length < 2 || selected.length > 3;
}
```

- [ ] **Step 3: Update `startDiscussion()` validation and badge rendering**

Replace the validation and badge section in `startDiscussion()`:

```js
if (selected.length !== 2) {
  log('请选择 2 位参与者', 'error');
  return;
}

// ...
document.getElementById('participants-badge').textContent =
  `${capitalize(selected[0])} vs ${capitalize(selected[1])}`;
updateDiscussionStatus('waiting', `等待 ${selected.join(' 和 ')} 的初始回复...`);
log(`讨论开始: ${selected.join(' vs ')}`, 'success');
```

With:

```js
if (selected.length < 2 || selected.length > 3) {
  log('请选择 2~3 位参与者', 'error');
  return;
}

// ...
document.getElementById('participants-badge').textContent =
  selected.map(capitalize).join(' · ');
updateDiscussionStatus('waiting', `等待 ${selected.map(capitalize).join('、')} 的初始回复...`);
log(`讨论开始: ${selected.join(', ')}`, 'success');
```

- [ ] **Step 4: Keep the initial-round prompt explicit about Chinese replies for all selected participants**

Retain the existing `for (const ai of selected)` loop, but keep the prompt exactly explicit about language:

```js
for (const ai of selected) {
  await sendToAI(ai, `请围绕以下话题分享你的看法，并始终使用中文回复：\n\n${topic}`);
}
```

This step is intentionally minimal: the first round already fans out correctly; only the participant-count restriction changes.

- [ ] **Step 5: Run the targeted tests to verify validation/start behavior now passes while later steps still fail**

Run:

```bash
node --test "D:/Coding/ai-roundtable/tests/panel-discussion.test.mjs" --test-name-pattern "discussion mode enables start only for 2 or 3 selected participants|discussion start stores all selected participants"
```

Expected: PASS for the two new start/validation tests. The full file should still fail because next round, interject, and summary are still pair-specific.

- [ ] **Step 6: Commit the setup/validation changes**

```bash
git add sidepanel/panel.html sidepanel/panel.js tests/panel-discussion.test.mjs
git commit -m "feat: allow 2-to-3 discussion participants"
```

---

### Task 3: Replace pair-specific next-round orchestration with participant-array logic

**Files:**
- Modify: `sidepanel/panel.js:683-741`
- Test: `tests/panel-discussion.test.mjs`

- [ ] **Step 1: Add a helper that returns the previous-round entry for one AI**

Insert this helper above `nextRound()` so the round logic stays small:

```js
function getRoundEntry(round, ai) {
  return discussionState.history.find(
    (entry) => entry.round === round && entry.ai === ai
  )?.content;
}
```

- [ ] **Step 2: Rewrite `nextRound()` to iterate participants instead of destructuring two AIs**

Replace the current pair-specific `nextRound()` implementation with:

```js
async function nextRound() {
  discussionState.currentRound++;
  const participants = [...discussionState.participants];
  const previousRound = discussionState.currentRound - 1;

  document.getElementById('round-badge').textContent = `第 ${discussionState.currentRound} 轮`;
  document.getElementById('next-round-btn').disabled = true;
  document.getElementById('generate-summary-btn').disabled = true;

  const previousResponses = new Map();
  for (const ai of participants) {
    const content = getRoundEntry(previousRound, ai);
    if (!content) {
      log('缺少上一轮的回复', 'error');
      return;
    }
    previousResponses.set(ai, content);
  }

  discussionState.pendingResponses = new Set(participants);
  discussionState.roundType = 'cross-eval';

  updateDiscussionStatus('waiting', '等待所有参与者继续回应...');
  log(`第 ${discussionState.currentRound} 轮: 多方继续讨论开始`);

  for (const targetAI of participants) {
    const otherAIs = participants.filter((ai) => ai !== targetAI);
    let prompt = `讨论主题：${discussionState.topic}\n\n以下是其他参与者上一轮的回复：\n`;

    for (const otherAI of otherAIs) {
      prompt += `\n<${otherAI}_response>\n${previousResponses.get(otherAI)}\n</${otherAI}_response>\n`;
    }

    prompt += `\n请始终使用中文回复。\n请基于这些观点继续讨论，并说明：\n1. 你认同什么\n2. 你不认同什么\n3. 你要补充什么`;

    await sendToAI(targetAI, prompt);
  }
}
```

- [ ] **Step 3: Run the next-round tests and verify both 2-party and 3-party prompt expectations pass**

Run:

```bash
node --test "D:/Coding/ai-roundtable/tests/panel-discussion.test.mjs" --test-name-pattern "discussion mode uses Chinese prompts in every discussion stage|next round sends each participant the other two previous-round replies"
```

Expected: PASS. The existing two-party Chinese-prompt test should still pass, and the new three-party prompt-content test should now pass as well.

- [ ] **Step 4: Commit the generalized next-round flow**

```bash
git add sidepanel/panel.js tests/panel-discussion.test.mjs
git commit -m "feat: generalize discussion next rounds"
```

---

### Task 4: Generalize interject and summary flows for participant arrays

**Files:**
- Modify: `sidepanel/panel.js:743-899`
- Test: `tests/panel-discussion.test.mjs`

- [ ] **Step 1: Add a helper that builds the latest-response map for current participants**

Insert this helper above `handleInterject()`:

```js
async function getLatestResponsesForParticipants(participants) {
  const responses = new Map();

  for (const ai of participants) {
    const response = await getLatestResponse(ai);
    if (!response) {
      return null;
    }
    responses.set(ai, response);
  }

  return responses;
}
```

- [ ] **Step 2: Rewrite `handleInterject()` to broadcast to all selected participants**

Replace the current pair-specific body with:

```js
async function handleInterject() {
  const input = document.getElementById('interject-input');
  const message = input.value.trim();

  if (!message) {
    log('请输入要发送的消息', 'error');
    return;
  }

  if (!discussionState.active || discussionState.participants.length < 2) {
    log('当前没有进行中的讨论', 'error');
    return;
  }

  const btn = document.getElementById('interject-btn');
  btn.disabled = true;

  const participants = [...discussionState.participants];
  log('[插话] 正在获取所有参与者最新回复...');

  const latestResponses = await getLatestResponsesForParticipants(participants);
  if (!latestResponses) {
    log('[插话] 无法获取回复，请确保所有参与者都已回复', 'error');
    btn.disabled = false;
    return;
  }

  log('[插话] 已获取所有参与者回复，正在发送...');

  for (const targetAI of participants) {
    const otherAIs = participants.filter((ai) => ai !== targetAI);
    let prompt = `${message}\n\n请始终使用中文回复。以下是其他参与者的最新回复：\n`;

    for (const otherAI of otherAIs) {
      prompt += `\n<${otherAI}_response>\n${latestResponses.get(otherAI)}\n</${otherAI}_response>`;
    }

    await sendToAI(targetAI, prompt);
  }

  log('[插话] 已发送给所有参与者（含其他参与者最新回复）', 'success');
  input.value = '';
  btn.disabled = false;
}
```

- [ ] **Step 3: Rewrite `generateSummary()` so it requests summaries from every selected participant**

Replace the pair-specific participant destructuring and pending set setup with:

```js
async function generateSummary() {
  document.getElementById('generate-summary-btn').disabled = true;
  updateDiscussionStatus('waiting', '正在请求所有参与者生成总结...');

  const participants = [...discussionState.participants];

  let historyText = `主题: ${discussionState.topic}\n\n`;
  for (let round = 1; round <= discussionState.currentRound; round++) {
    historyText += `=== 第 ${round} 轮 ===\n\n`;
    const roundEntries = discussionState.history.filter((entry) => entry.round === round);
    for (const ai of participants) {
      const entry = roundEntries.find((item) => item.ai === ai);
      if (entry) {
        historyText += `[${capitalize(entry.ai)}]:\n${entry.content}\n\n`;
      }
    }
  }

  const summaryPrompt = `请始终使用中文回复，并对以下 AI 之间的讨论进行总结。请包含：\n1. 主要共识点\n2. 主要分歧点\n3. 各方的核心观点\n4. 总体结论\n\n讨论历史：\n${historyText}`;

  discussionState.roundType = 'summary';
  discussionState.pendingResponses = new Set(participants);

  log('[Summary] 正在请求所有参与者生成总结...');
  for (const ai of participants) {
    await sendToAI(ai, summaryPrompt);
  }

  const checkForSummary = setInterval(() => {
    if (discussionState.pendingResponses.size === 0) {
      clearInterval(checkForSummary);
      const summaries = Object.fromEntries(
        participants.map((ai) => [
          ai,
          discussionState.history.find((entry) => entry.type === 'summary' && entry.ai === ai)?.content || ''
        ])
      );
      log('[Summary] 所有参与者总结已生成', 'success');
      showSummary(summaries);
    }
  }, 500);
}
```

- [ ] **Step 4: Rewrite `showSummary()` to render summary cards from the participant array**

Replace the current signature and card rendering with:

```js
function showSummary(summariesByAI) {
  document.getElementById('discussion-active').classList.add('hidden');
  document.getElementById('discussion-summary').classList.remove('hidden');

  const participants = [...discussionState.participants];
  if (participants.every((ai) => !(summariesByAI[ai] || '').trim())) {
    log('警告: 未收到 AI 的总结内容', 'error');
  }

  let html = `<div class="round-summary">
    <h4>参与者总结</h4>
    <div class="summary-comparison">`;

  for (const ai of participants) {
    html += `
      <div class="ai-response">
        <div class="ai-name ${ai}">${capitalize(ai)} 的总结：</div>
        <div>${renderLongTextHTML(summariesByAI[ai] || '')}</div>
      </div>`;
  }

  html += `
    </div>
  </div>`;

  html += `<div class="round-summary"><h4>完整讨论历史</h4>`;
  for (let round = 1; round <= discussionState.currentRound; round++) {
    const roundEntries = discussionState.history.filter((entry) => entry.round === round && entry.type !== 'summary');
    if (roundEntries.length > 0) {
      html += `<div style="margin-top:12px"><strong>第 ${round} 轮</strong></div>`;
      for (const ai of participants) {
        const entry = roundEntries.find((item) => item.ai === ai);
        if (entry) {
          html += `<div class="ai-response">
            <div class="ai-name ${entry.ai}">${capitalize(entry.ai)}:</div>
            <div>${renderLongTextHTML(entry.content)}</div>
          </div>`;
        }
      }
    }
  }
  html += `</div>`;

  document.getElementById('summary-content').innerHTML = html;
  discussionState.active = false;
  log('讨论总结已生成', 'success');
}
```

- [ ] **Step 5: Update the old summary test in `tests/panel-discussion.test.mjs` to call the new object signature**

Replace the current two-argument invocation:

```js
panel.api.showSummary(longSummary, longSummary);
```

With:

```js
panel.api.showSummary({
  chatgpt: longSummary,
  claude: longSummary
});
```

This keeps the existing long-text coverage aligned with the new function contract while the new three-card test covers the participant-array rendering.

- [ ] **Step 6: Run the full discussion test file and verify all discussion tests pass**

Run:

```bash
node --test "D:/Coding/ai-roundtable/tests/panel-discussion.test.mjs"
```

Expected: PASS for the existing capture/language/long-text/layout tests plus the new validation, next-round, interject, and summary tests.

- [ ] **Step 7: Commit the generalized interject/summary flow**

```bash
git add sidepanel/panel.js tests/panel-discussion.test.mjs sidepanel/panel.html
git commit -m "feat: generalize discussion interject and summary"
```

---

### Task 5: Update README and perform final regression verification

**Files:**
- Modify: `README.md:187-260`
- Test: `tests/panel-discussion.test.mjs`

- [ ] **Step 1: Update the README discussion-mode description and steps**

Replace this discussion block in `README.md`:

```md
### 讨论模式

让两个 AI 就同一主题进行深度辩论：

1. 点击顶部「讨论」切换到讨论模式
2. 选择 2 个参与讨论的 AI
3. 输入讨论主题
4. 点击「开始讨论」

**讨论流程**

```
第 1 轮: 两个 AI 各自阐述观点
第 2 轮: 互相评价对方的观点
第 3 轮: 回应对方的评价，深化讨论
...
总结: 双方各自生成讨论总结
```
```

With:

```md
### 讨论模式

让任意两个 AI，或 Claude / ChatGPT / Gemini 三方，就同一主题进行多轮讨论：

1. 点击顶部「讨论」切换到讨论模式
2. 选择 2~3 个参与讨论的 AI
3. 输入讨论主题
4. 点击「开始讨论」

**讨论流程**

```
第 1 轮: 所有参与者各自阐述观点
第 2 轮: 每个参与者阅读其他参与者的观点并继续回应
第 3 轮: 结合上一轮的分歧与补充继续深入讨论
...
总结: 所有参与者各自生成讨论总结
```
```

- [ ] **Step 2: Update the README limitation note**

Replace this line in `README.md`:

```md
- 讨论模式固定 2 个参与者
```

With:

```md
- 讨论模式支持任意两位或三位全选，不支持 4 个及以上参与者
```

- [ ] **Step 3: Add the new design spec to the design-notes section**

Append this line below the existing discussion responsive spec entry:

```md
- [Discussion Mode 2-to-3 Participants Design](docs/superpowers/specs/2026-04-03-discussion-2-to-3-participants-design.md) - discussion 模式支持任选两位或三位参与者的统一设计
```

- [ ] **Step 4: Run the discussion regression tests one final time**

Run:

```bash
node --test "D:/Coding/ai-roundtable/tests/panel-discussion.test.mjs"
```

Expected: PASS.

- [ ] **Step 5: Run a focused diff check to verify only the intended files changed**

Run:

```bash
git diff -- sidepanel/panel.js sidepanel/panel.html tests/panel-discussion.test.mjs README.md docs/superpowers/specs/2026-04-03-discussion-2-to-3-participants-design.md docs/superpowers/plans/2026-04-03-discussion-2-to-3-participants.md
```

Expected: diff only covers the discussion participant generalization, updated copy, tests, and planning/spec docs.

- [ ] **Step 6: Commit the docs and final verification state**

```bash
git add README.md docs/superpowers/plans/2026-04-03-discussion-2-to-3-participants.md
git commit -m "docs: record discussion mode 2-to-3 participant plan"
```

---

## Self-Review Checklist

- Spec coverage:
  - `2~3` participant rule -> Task 2
  - unified participant-array orchestration -> Tasks 3-4
  - explicit Chinese prompts at every stage -> Tasks 2-4
  - generalized UI wording -> Tasks 2 and 5
  - summary rendering by participant count -> Task 4
  - README updates -> Task 5
- Placeholder scan:
  - No `TBD`, `TODO`, or vague “write tests later” steps remain
  - Every code-change step includes the actual code to write
  - Every verification step includes an exact command and expected result
- Type consistency:
  - `participants`, `otherAIs`, `getRoundEntry`, `getLatestResponsesForParticipants`, and `showSummary(summariesByAI)` are used consistently across tasks
  - Summary rendering and tests both use the object-based `showSummary` signature

# Long Text Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one shared long-text display protocol to the side panel so long user/AI text defaults to fixed-height internal scrolling with expand/collapse, instead of pushing controls out of view.

**Architecture:** Keep the change localized to `sidepanel/panel.js`, `sidepanel/panel.css`, and the existing panel test files. Introduce one shared rendering helper for potentially long text, route the confirmed display surfaces through it, and verify the behavior with failing tests first and focused DOM-marker assertions.

**Tech Stack:** Chrome extension side panel, vanilla JavaScript, CSS, Node built-in test runner (`node --test`), VM-based panel test harnesses in `tests/*.mjs`

---

## File Map

- Modify: `sidepanel/panel.js`
  - Add one shared long-text renderer and one toggle handler
  - Route `log()`, `startDiscussion()` topic rendering, and `showSummary()` through the shared protocol
- Modify: `sidepanel/panel.css`
  - Add shared collapsed/expanded long-text styles and toggle styles
- Modify: `tests/panel-discussion.test.mjs`
  - Extend the fake DOM enough to inspect long-text rendering and add failing tests for topic + summary
- Modify: `tests/panel-normal-mode.test.mjs`
  - Extend the fake DOM enough to inspect long-text rendering and add failing tests for log rendering

### Task 1: Add failing tests for the shared long-text protocol

**Files:**
- Modify: `tests/panel-discussion.test.mjs`
- Modify: `tests/panel-normal-mode.test.mjs`
- Test: `tests/panel-discussion.test.mjs`
- Test: `tests/panel-normal-mode.test.mjs`

- [ ] **Step 1: Extend the fake DOM in both panel test files so long-text rendering is inspectable**

```js
function createElement(id = '') {
  let innerHTML = '';
  let textContent = '';

  return {
    id,
    value: '',
    className: '',
    title: '',
    disabled: false,
    checked: false,
    selectionStart: 0,
    selectionEnd: 0,
    children: [],
    dataset: {},
    style: {},
    focus() {},
    addEventListener() {},
    dispatchEvent() {},
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    insertBefore(child) {
      this.children.unshift(child);
      return child;
    },
    removeChild() {
      return this.children.pop();
    },
    querySelector() {
      return createElement();
    },
    querySelectorAll() {
      return [];
    },
    closest(selector) {
      if (selector === '.long-text-toggle' && this.dataset?.longTextToggle) {
        return this;
      }
      return null;
    },
    classList: {
      add() {},
      remove() {}
    },
    get innerHTML() {
      return innerHTML;
    },
    set innerHTML(value) {
      innerHTML = value;
    },
    get textContent() {
      return textContent;
    },
    set textContent(value) {
      textContent = value;
      innerHTML = String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }
  };
}
```

- [ ] **Step 2: Expose the rendering entry points you need to assert in tests**

In `tests/panel-normal-mode.test.mjs`, update the injected export block to expose `log`:

```js
const source = fs.readFileSync('D:/Coding/ai-roundtable/sidepanel/panel.js', 'utf8') + `
globalThis.__panelTest = {
  handleCrossReference,
  handleMutualReview,
  log
};
`;
```

In both panel test files, make `document.querySelector()` resolve long-text blocks by `data-long-text-id` so toggle behavior can be exercised later:

```js
const document = {
  getElementById(id) {
    if (!elementCache.has(id)) {
      elementCache.set(id, createElement(id));
    }
    return elementCache.get(id);
  },
  querySelectorAll() {
    return [];
  },
  querySelector(selector) {
    const match = selector.match(/^\[data-long-text-id="([^"]+)"\]$/);
    if (!match) {
      return null;
    }

    for (const element of elementCache.values()) {
      if (element.dataset?.longTextId === match[1]) {
        return element;
      }
    }

    return null;
  },
  createElement(tagName) {
    return createElement(tagName);
  },
  addEventListener(event, callback) {
    if (event === 'DOMContentLoaded') {
      domReadyCallbacks.push(callback);
    }
  }
};
```

In `tests/panel-discussion.test.mjs`, expose `showSummary` in addition to the current exports:

```js
const source = fs.readFileSync('D:/Coding/ai-roundtable/sidepanel/panel.js', 'utf8') + `
globalThis.__panelTest = {
  getDiscussionState: () => discussionState,
  setDiscussionState: (value) => { discussionState = value; },
  getOnMessageListener: () => globalThis.__onMessageListener,
  startDiscussion,
  nextRound,
  showSummary
};
`;
```

- [ ] **Step 3: Store created elements in `elementCache` by long-text id when tests need toggle lookups**

After `innerHTML` is assigned in the fake element, register any emitted `data-long-text-id` marker so the click handler can resolve the same fake node later:

```js
    set innerHTML(value) {
      innerHTML = value;
      const match = value.match(/data-long-text-id="([^"]+)"/);
      if (match) {
        this.dataset.longTextId = match[1];
        elementCache.set(`long-text:${match[1]}`, this);
      }
    },
```

Use the same pattern in both panel test files.

- [ ] **Step 4: Write the failing log-rendering test in `tests/panel-normal-mode.test.mjs`**

Append this test:

```js
test('log renders long messages inside the shared long-text container', () => {
  const panel = loadPanel();
  const longMessage = '长文本'.repeat(120);

  panel.api.log(longMessage, 'success');

  const logContainer = panel.getElementById('log-container');
  assert.equal(logContainer.children.length, 1);
  assert.match(logContainer.children[0].innerHTML, /long-text-block/);
  assert.match(logContainer.children[0].innerHTML, /展开全文/);
});
```

Also expose `getElementById` from `loadPanel()` if it is not already returned:

```js
return {
  api: context.__panelTest,
  getElementById: (id) => document.getElementById(id),
  getSentMessages: () => sentMessages.filter((message) => message.type === 'SEND_MESSAGE')
};
```

- [ ] **Step 5: Write the failing topic + summary tests in `tests/panel-discussion.test.mjs`**

Append these tests:

```js
test('discussion topic renders long text through the shared long-text container', async () => {
  const panel = loadPanel();
  panel.setSelectedParticipants(['chatgpt', 'claude']);
  panel.getElementById('discussion-topic').value = '超长主题'.repeat(120);

  await panel.api.startDiscussion();

  assert.match(panel.getElementById('topic-display').innerHTML, /long-text-block/);
  assert.match(panel.getElementById('topic-display').innerHTML, /展开全文/);
});

test('discussion summary renders long text through the shared long-text container', () => {
  const panel = loadPanel();
  panel.api.setDiscussionState({
    active: true,
    topic: '长文本展示',
    participants: ['chatgpt', 'claude'],
    currentRound: 1,
    history: [
      { round: 1, ai: 'chatgpt', type: 'initial', content: '总结内容'.repeat(100) },
      { round: 1, ai: 'claude', type: 'initial', content: '历史内容'.repeat(100) }
    ],
    pendingResponses: new Set(),
    roundType: 'summary'
  });

  panel.api.showSummary('总结内容'.repeat(100), '另一份总结'.repeat(100));

  assert.match(panel.getElementById('summary-content').innerHTML, /long-text-block/);
  assert.match(panel.getElementById('summary-content').innerHTML, /收起|展开全文/);
});
```

- [ ] **Step 6: Run the targeted panel tests and verify they fail for the expected reason**

Run:

```bash
node --test "D:/Coding/ai-roundtable/tests/panel-discussion.test.mjs" "D:/Coding/ai-roundtable/tests/panel-normal-mode.test.mjs"
```

Expected: FAIL because current `sidepanel/panel.js` still writes long text directly (`textContent` / `innerHTML`) and does not emit `long-text-block` markup.

- [ ] **Step 7: Commit the failing tests**

```bash
git add tests/panel-discussion.test.mjs tests/panel-normal-mode.test.mjs
git commit -m "test: cover shared long-text panel rendering"
```

### Task 2: Implement the shared long-text renderer in `sidepanel/panel.js`

**Files:**
- Modify: `sidepanel/panel.js:440-457`
- Modify: `sidepanel/panel.js:523-547`
- Modify: `sidepanel/panel.js:794-839`
- Test: `tests/panel-discussion.test.mjs`
- Test: `tests/panel-normal-mode.test.mjs`

- [ ] **Step 1: Add shared constants and helper functions above `log()`**

Insert this block immediately before `function log(message, type = 'info') {`:

```js
const LONG_TEXT_THRESHOLD = 280;
let longTextIdCounter = 0;

function escapeLongText(text) {
  return escapeHtml(String(text ?? '')).replace(/\n/g, '<br>');
}

function isLongText(text) {
  return String(text ?? '').length > LONG_TEXT_THRESHOLD;
}

function renderLongTextHTML(text, options = {}) {
  const normalized = String(text ?? '');
  const escaped = escapeLongText(normalized);
  const contentClass = options.contentClass || 'long-text-content';

  if (!isLongText(normalized)) {
    return `<div class="${contentClass}">${escaped}</div>`;
  }

  const blockId = options.blockId || `long-text-${++longTextIdCounter}`;
  const expanded = options.expanded === true;
  const stateClass = expanded ? ' is-expanded' : '';
  const toggleLabel = expanded ? '收起' : '展开全文';

  return `<div class="long-text-block${stateClass}" data-long-text-id="${blockId}" data-long-text-expanded="${expanded}">
    <div class="${contentClass}">${escaped}</div>
    <button type="button" class="long-text-toggle" data-long-text-toggle="${blockId}">${toggleLabel}</button>
  </div>`;
}

function handleLongTextToggle(event) {
  const toggle = event.target.closest?.('.long-text-toggle');
  if (!toggle) return;

  const blockId = toggle.dataset.longTextToggle;
  const block = document.querySelector?.(`[data-long-text-id="${blockId}"]`);
  if (!block) return;

  const expanded = block.dataset.longTextExpanded === 'true';
  block.dataset.longTextExpanded = expanded ? 'false' : 'true';
  block.className = `long-text-block${expanded ? '' : ' is-expanded'}`;
  toggle.textContent = expanded ? '展开全文' : '收起';
}
```

- [ ] **Step 2: Register the click handler once during setup**

In `setupEventListeners()`, after the send button binding, add:

```js
document.addEventListener('click', handleLongTextToggle);
```

- [ ] **Step 3: Replace the direct log HTML write with the shared renderer**

Change `log()` from:

```js
entry.innerHTML = `<span class="time">${time}</span>${message}`;
```

To:

```js
entry.innerHTML = `<span class="time">${time}</span>${renderLongTextHTML(message, {
  blockId: `log-${Date.now()}-${logContainer.children.length}`,
  contentClass: 'long-text-content log-text-content'
})}`;
```

- [ ] **Step 4: Render the discussion topic through the shared renderer**

Change `startDiscussion()` from:

```js
document.getElementById('topic-display').textContent = topic;
```

To:

```js
document.getElementById('topic-display').innerHTML = renderLongTextHTML(topic, {
  blockId: `topic-${Date.now()}`,
  contentClass: 'long-text-content topic-text-content'
});
```

- [ ] **Step 5: Route summary and history blocks through the same renderer**

In `showSummary()`, replace the direct summary content and substring preview writes:

```js
<div>${escapeHtml(ai1Summary).replace(/\n/g, '<br>')}</div>
<div>${escapeHtml(ai2Summary).replace(/\n/g, '<br>')}</div>
const preview = entry.content.substring(0, 200) + (entry.content.length > 200 ? '...' : '');
<div>${escapeHtml(preview).replace(/\n/g, '<br>')}</div>
```

With this shared rendering path:

```js
${renderLongTextHTML(ai1Summary, {
  blockId: `summary-${ai1}-current`,
  contentClass: 'long-text-content summary-text-content'
})}
${renderLongTextHTML(ai2Summary, {
  blockId: `summary-${ai2}-current`,
  contentClass: 'long-text-content summary-text-content'
})}
${renderLongTextHTML(entry.content, {
  blockId: `summary-round-${round}-${entry.ai}`,
  contentClass: 'long-text-content summary-text-content'
})}
```

The updated `showSummary()` body for the rendered cards should look like this:

```js
let html = `<div class="round-summary">
  <h4>双方总结对比</h4>
  <div class="summary-comparison">
    <div class="ai-response">
      <div class="ai-name ${ai1}">${capitalize(ai1)} 的总结：</div>
      ${renderLongTextHTML(ai1Summary, {
        blockId: `summary-${ai1}-current`,
        contentClass: 'long-text-content summary-text-content'
      })}
    </div>
    <div class="ai-response">
      <div class="ai-name ${ai2}">${capitalize(ai2)} 的总结：</div>
      ${renderLongTextHTML(ai2Summary, {
        blockId: `summary-${ai2}-current`,
        contentClass: 'long-text-content summary-text-content'
      })}
    </div>
  </div>
</div>`;

html += `<div class="round-summary"><h4>完整讨论历史</h4>`;
for (let round = 1; round <= discussionState.currentRound; round++) {
  const roundEntries = discussionState.history.filter(h => h.round === round && h.type !== 'summary');
  if (roundEntries.length > 0) {
    html += `<div style="margin-top:12px"><strong>第 ${round} 轮</strong></div>`;
    for (const entry of roundEntries) {
      html += `<div class="ai-response">
        <div class="ai-name ${entry.ai}">${capitalize(entry.ai)}:</div>
        ${renderLongTextHTML(entry.content, {
          blockId: `summary-round-${round}-${entry.ai}`,
          contentClass: 'long-text-content summary-text-content'
        })}
      </div>`;
    }
  }
}
html += `</div>`;
```

- [ ] **Step 6: Run the targeted panel tests and verify they now pass**

Run:

```bash
node --test "D:/Coding/ai-roundtable/tests/panel-discussion.test.mjs" "D:/Coding/ai-roundtable/tests/panel-normal-mode.test.mjs"
```

Expected: PASS for the new long-text tests plus the existing discussion/Chinese prompt tests.

- [ ] **Step 7: Commit the JS implementation**

```bash
git add sidepanel/panel.js tests/panel-discussion.test.mjs tests/panel-normal-mode.test.mjs
git commit -m "feat: unify long-text panel rendering"
```

### Task 3: Add the shared long-text styles and final verification

**Files:**
- Modify: `sidepanel/panel.css:608-628`
- Modify: `sidepanel/panel.css:859-869`
- Modify: `sidepanel/panel.css:1048-1113`
- Test: `tests/panel-discussion.test.mjs`
- Test: `tests/panel-normal-mode.test.mjs`

- [ ] **Step 1: Add shared long-text styles near the existing log styles**

Insert this block after the existing `.log-entry .time` rules:

```css
.long-text-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  width: 100%;
}

.long-text-content {
  line-height: 1.6;
  min-width: 0;
  word-break: break-word;
}

.long-text-block:not(.is-expanded) .long-text-content {
  max-height: 160px;
  overflow-y: auto;
  padding-right: 4px;
}

.long-text-block.is-expanded .long-text-content {
  max-height: none;
  overflow: visible;
}

.long-text-toggle {
  align-self: flex-start;
  border: 1px solid var(--border-glass);
  background: transparent;
  color: var(--accent-secondary);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 11px;
  font-family: 'IBM Plex Sans', sans-serif;
  cursor: pointer;
}

.long-text-toggle:hover {
  background: rgba(59, 130, 246, 0.12);
}
```

- [ ] **Step 2: Adjust the confirmed display surfaces so the shared content can shrink and scroll correctly**

Update the existing rules to avoid flex overflow bugs:

```css
.log-entry {
  padding: 6px 0;
  border-bottom: 1px solid var(--border-subtle);
  color: var(--text-muted);
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.discussion-topic-display {
  background: var(--bg-glass);
  backdrop-filter: blur(var(--blur-glass));
  padding: 14px;
  border-radius: 12px;
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 10px;
  border-left: 3px solid var(--accent-primary);
  flex-shrink: 0;
  min-width: 0;
}

#summary-content .ai-response {
  margin: 10px 0;
  padding: 12px;
  background: var(--bg-elevated);
  border-radius: 10px;
  min-width: 0;
}
```

- [ ] **Step 3: Add one focused CSS assertion test to protect the chosen collapsed-height rule**

Append this test to `tests/panel-normal-mode.test.mjs`:

```js
test('shared long-text styles define collapsed scrolling behavior', () => {
  const css = fs.readFileSync('D:/Coding/ai-roundtable/sidepanel/panel.css', 'utf8');

  assert.match(css, /\.long-text-block:not\(\.is-expanded\) \.long-text-content \{/);
  assert.match(css, /max-height:\s*160px/);
  assert.match(css, /overflow-y:\s*auto/);
});
```

- [ ] **Step 4: Run the full current panel test set**

Run:

```bash
node --test \
  "D:/Coding/ai-roundtable/tests/panel-discussion.test.mjs" \
  "D:/Coding/ai-roundtable/tests/panel-normal-mode.test.mjs"
```

Expected: PASS with the existing 4 assertions plus the new long-text coverage.

- [ ] **Step 5: Manually verify the side panel in Chrome**

Manual checklist:

- Open `chrome://extensions/`
- Reload the unpacked extension from `D:/Coding/ai-roundtable`
- Open the side panel in discussion mode
- Paste a very long discussion topic and confirm the topic display block stays fixed-height with internal scroll and a toggle
- Trigger a long activity log entry and confirm the controls remain visible
- Generate a summary with long content and confirm both summary cards and round history use the same long-text behavior

- [ ] **Step 6: Commit the CSS and final verification changes**

```bash
git add sidepanel/panel.css tests/panel-discussion.test.mjs tests/panel-normal-mode.test.mjs
git commit -m "style: add shared long-text panel container"
```

## Related Specs

- `docs/superpowers/specs/2026-04-02-long-text-display-design.md` — 长文本展示统一设计
- `docs/superpowers/specs/2026-04-03-discussion-responsive-spec.md` — discussion 模式“主操作优先”响应式规范，补充真宿主空间约束与回归测试策略

## Self-Review Checklist

- Spec coverage:
  - Shared rendering protocol -> Task 2
  - Covered surfaces (`log`, `#topic-display`, summary/history) -> Task 2
  - Fixed-height internal scrolling -> Task 3
  - Expand/collapse affordance -> Tasks 1-3
  - No business-logic refactor -> enforced by file scope in all tasks
- Placeholder scan:
  - No `TBD`, `TODO`, or unspecified “write tests later” steps remain
- Type and naming consistency:
  - `renderLongTextHTML`, `handleLongTextToggle`, `long-text-block`, `long-text-content`, and `long-text-toggle` are used consistently across tasks

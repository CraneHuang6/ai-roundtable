# Discussion Responsive Spec

## Context

The discussion mode in the side panel runs inside a narrow Chrome extension host where vertical space is more constrained than the standalone `file:///.../panel.html` approximation. Recent debugging confirmed that the main failure mode is not only classic horizontal overlap. In the real side-panel footprint, primary actions can also be pushed below the first visible viewport when flex items shrink incorrectly or when non-critical chrome consumes too much height.

The approved direction is to treat discussion mode as a **primary-action-first** layout. The panel must preserve access to the core discussion actions before it preserves secondary surfaces such as the activity log or decorative footer content.

## Problem Statement

In discussion mode, the operator must always be able to reach these actions even when the side panel becomes very narrow:

- `结束`
- `发送给双方`
- `下一轮`
- `生成总结`

Past regressions showed several ways this can fail:

1. Interject and footer controls compete for height and overlap.
2. Header badges and the `结束` button compete for width in ultra-narrow panels.
3. The discussion log and footer continue consuming height even after the mode switches into a control-heavy state.
4. Flex children shrink in ways that visually hide buttons even though the DOM order is correct.

## Product Rule

**Discussion mode prioritizes primary actions over secondary chrome.**

This rule applies whenever `#discussion-mode` is active.

### Primary actions

These surfaces must stay visible or be reachable with the smallest possible amount of scrolling:

1. Discussion header, including the `结束` button
2. Topic display
3. Current status display
4. Interject textarea and `发送给双方`
5. Footer controls: `下一轮`, `生成总结`

### Secondary surfaces

These surfaces must yield space first when the layout gets tight:

1. Activity log height
2. Copyright/footer chrome
3. Extra whitespace or generous padding
4. Multi-column button layouts

## Responsive Strategy

### 1. Make the discussion body the scroll container

The active discussion body must own vertical scrolling instead of clipping its bottom actions.

Required rule:

```css
.discussion-active {
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
}
```

Why: if the container clips instead of scrolling, bottom actions can appear to disappear even when they are still in normal flow.

### 2. Keep action groups out of flex-shrink traps

Any discussion section that contains a primary action must resist shrinking out of its natural footprint.

Required outcomes:

- `.discussion-interject` must not use `flex: 1`
- `.discussion-interject` must use `flex-shrink: 0`
- `.interject-actions` must use `flex-shrink: 0`
- `.discussion-controls` must use `flex-shrink: 0`
- `.end-btn` must use `flex-shrink: 0`

Why: the observed overlap bug happened because the interject section visually collapsed while its children still occupied space.

### 3. Stack footer controls vertically by default in constrained layouts

Discussion footer controls are primary actions, not toolbar chrome. In narrow side panels they should stop competing horizontally.

Required outcomes:

```css
.discussion-controls {
  flex-direction: column;
}

.discussion-controls button {
  width: 100%;
  flex: none;
  min-width: 0;
}
```

Why: a stacked layout is more stable than a wrapped row in the side-panel host footprint.

### 4. Give interject actions a stable one-column flow

The interject section should behave like a compact form, not like a resizable content region.

Required outcomes:

```css
#interject-input {
  flex: none;
  min-height: 56px;
}

#interject-btn {
  width: 100%;
}
```

Why: the textarea needs a predictable minimum footprint, and the send button should avoid horizontal collisions with surrounding elements.

### 5. Make the header wrap safely under ultra-narrow widths

The header must allow badges to shrink and wrap before the `结束` button becomes cramped or visually stuck.

Required outcomes:

```css
.discussion-header {
  gap: 8px;
}

.discussion-info {
  min-width: 0;
  flex-wrap: wrap;
}

.end-btn {
  flex-shrink: 0;
}
```

Why: earlier debugging showed `headerGap = 0` and a cramped `结束` button when the info group refused to yield width.

### 6. Reduce non-essential spacing in discussion mode

Discussion mode should use a tighter spacing profile than general side-panel content.

Current confirmed targets:

- `.discussion-topic-display { padding: 12px; }`
- `.discussion-status { padding: 10px 12px; }`
- reduced gaps in interject and footer control groups

Why: recovering even small amounts of height materially improves action visibility in a side panel.

### 7. Secondary surfaces must yield height while discussion mode is active

When `#discussion-mode` is visible, the surrounding UI should explicitly give space back to the discussion action area.

Required outcomes:

```css
#discussion-mode:not(.hidden) ~ .log {
  max-height: 36px;
}

#discussion-mode:not(.hidden) ~ .copyright {
  display: none;
}
```

Why: debugging in a tighter host-like viewport showed that compressing the log and hiding the footer restored safe spacing between controls and the lower panel chrome.

## Layout Priority Ladder

When the side panel gets tighter, compress in this order:

1. Remove or reduce footer chrome
2. Compress activity log height
3. Tighten paddings and gaps
4. Force single-column action layouts
5. Allow header badge wrapping
6. Allow body scrolling

Do **not** solve the problem by shrinking or clipping the primary action groups first.

## Testing Contract

Discussion responsive regressions should be protected structurally in `tests/panel-discussion.test.mjs`.

### Required assertions

At minimum, tests should continue asserting:

- `.discussion-active` scroll ownership
- `.discussion-header` explicit gap
- `.discussion-info` shrink-and-wrap behavior
- `.end-btn` shrink resistance
- `.discussion-interject` does not use `flex: 1`
- `.discussion-interject` shrink resistance
- `#interject-input` fixed footprint rules
- `.interject-actions` shrink resistance
- `#interject-btn` full-width layout
- `.discussion-controls` column layout
- `.discussion-controls button` full-width non-flexing layout
- discussion-mode-specific log compression
- discussion-mode-specific footer hiding
- tightened topic/status padding

### Why CSS assertion tests

This bug class is largely about layout contracts, not business logic. Structural CSS assertions are the fastest regression net for:

- accidental reintroduction of `flex: 1`
- removal of `flex-shrink: 0`
- switching buttons back to horizontal competition
- relaxing discussion-mode-specific sibling overrides

## Validation Strategy

### Manual verification target

Preferred validation remains the real extension side-panel host in Chrome, not only a standalone `file:///.../panel.html` approximation.

### Current tooling constraint

`chrome-devtools-mcp` in this environment launches Chrome with:

- an isolated `--user-data-dir`
- `--disable-extensions`

That means the MCP-controlled browser cannot currently enumerate or open the locally loaded unpacked extension host. This is an environment/tooling constraint, not a repo-side extension bug.

### Practical implication

Use the MCP browser for DOM/layout investigation on approximated pages when helpful, but treat final host validation as a manual step in the user’s real Chrome extension profile unless the MCP launch configuration changes.

## Acceptance Criteria

This responsive strategy is satisfied when all of the following stay true:

- `结束` remains stable in ultra-narrow widths
- `发送给双方` remains visible and does not overlap footer controls
- `下一轮` and `生成总结` remain reachable in a stable stacked layout
- discussion mode can trade away log/footer space before it trades away primary actions
- regression tests encode the layout contract
- real-host validation is understood as a separate environment step, not conflated with CSS correctness

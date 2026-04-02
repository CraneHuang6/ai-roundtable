# Long Text Display Design

## Context

The side panel currently renders long text inconsistently across multiple surfaces. Evidence confirmed during exploration:

- `sidepanel/panel.js:451` inserts full log messages directly into `.log-entry` without any shared long-text container.
- `sidepanel/panel.js:540` writes the discussion topic directly into `#topic-display`.
- `sidepanel/panel.js:806-837` renders discussion summaries and history with ad-hoc preview behavior, including direct long text insertion and a separate `substring(0, 200)` preview path.

This causes long text to expand containers unpredictably and can hide controls in the side panel.

## Problem Statement

Any UI surface that displays user input or AI output can receive very long text. The codebase currently lacks a unified display protocol for long content, so layout stability depends on the specific rendering path. This has already surfaced in:

- Activity log entries
- Input echo / post-send display boxes
- Discussion topic display
- Discussion summary and history cards
- Other present or future text-heavy display blocks in the side panel

## Approved Product Decisions

The following decisions were explicitly approved:

1. Scope includes all exposed long-text display blocks, not only the activity log.
2. Default behavior is fixed-height display with internal scrolling.
3. Long-text blocks keep an expand/collapse affordance.
4. The solution should be unified across user-input displays and AI-output displays.

## Goals

- Prevent long content from pushing controls, mode switches, or action buttons out of view.
- Apply one shared long-text display protocol across all affected side panel surfaces.
- Preserve readability for long content with internal scrolling by default.
- Allow full-text inspection via expand/collapse only when content exceeds a threshold.
- Keep short content simple and free of unnecessary controls.

## Non-Goals

- No changes to send flow, discussion orchestration, response capture, or business logic.
- No repo-wide refactor of the side panel architecture.
- No new dependencies, build steps, or third-party UI libraries.
- No broad visual redesign outside the long-text display behavior.

## Recommended Approach

Use a shared long-text display protocol applied at rendering time.

### Why this approach

Alternative approaches were considered:

1. Patch each affected area independently.
   - Fastest locally.
   - Repeats the same bug pattern in multiple places.
   - High risk of future inconsistency.

2. CSS-only truncation.
   - Smallest diff.
   - Cannot support controlled expand/collapse cleanly across all display types.
   - Leaves summary/history behavior fragmented.

3. Shared display protocol. **Recommended**
   - Centralizes the behavior.
   - Keeps interactions consistent.
   - Fixes current exposed issues and gives future long-text surfaces a reusable path.

## Design

### 1. Shared rendering contract

Introduce a single rendering contract for “possibly long text” in the side panel.

The contract is responsible for:

- Wrapping content in a shared long-text container
- Applying default collapsed height rules
- Enabling internal scrolling in collapsed state
- Showing expand/collapse controls only when the content crosses the long-text threshold
- Preserving safe text rendering behavior already used in the panel

The goal is not to componentize the whole panel. The goal is to separate **text content** from **text display shell**.

### 2. Covered surfaces

The shared contract must be applied to every side-panel surface that displays long user input or AI output.

Currently confirmed code paths include:

- Activity log entries
- `#topic-display`
- Discussion summary cards
- Discussion history cards

In addition, if implementation reveals other existing side-panel display boxes that render the same kind of long user or AI text, those surfaces must adopt the same protocol in the same change set rather than keeping special-case behavior.

This eliminates the current split behavior where some areas render full text, while others use custom preview logic.

### 3. Default interaction

For content below the long-text threshold:

- Render naturally
- Do not show expand/collapse controls
- Do not force a scroll container when it is unnecessary

For content above the long-text threshold:

- Render in a fixed-height container by default
- Allow scrolling inside the container
- Keep surrounding layout stable
- Show an expand/collapse affordance

### 4. Expanded interaction

When the user expands a long-text block:

- Full content becomes visible
- The same block can be collapsed back to default mode
- The control text remains consistent across all surfaces

### 5. Visual consistency

All long-text blocks should share:

- Common height behavior
- Common overflow behavior
- Common expand/collapse affordance
- Common state naming and DOM markers for tests

Different surfaces may retain their existing surrounding chrome (title, badge, timestamp, AI label), but the long-text content area itself must follow one protocol.

### 6. Existing summary behavior alignment

`showSummary()` currently mixes direct long-text rendering with a separate 200-character preview path for history entries.

That fragmented behavior should be removed or aligned so that summary/history text follows the same shared display protocol rather than custom substring-based preview logic.

## File Boundaries

### `sidepanel/panel.js`

Expected responsibility changes:

- Add the shared long-text rendering entry point / protocol
- Route affected rendering sites through that shared path
- Avoid one-off text display behavior per surface

This should remain a targeted change, not a general architectural rewrite.

### `sidepanel/panel.css`

Expected responsibility changes:

- Add shared long-text container styles
- Define collapsed state height and overflow behavior
- Define expanded state behavior
- Style the expand/collapse affordance consistently

The visual language should stay within the existing panel design system.

### `tests/*.mjs`

Expected responsibility changes:

- Add failing tests first for the missing shared protocol
- Assert presence of stable DOM markers or classes for long-text containers
- Verify that long content surfaces get controlled rendering behavior
- Verify that short content does not get unnecessary expand controls

## Testing Strategy

### RED

Add failing tests before implementation. At minimum, cover:

1. Long log entries render through the shared long-text container
2. Long topic/input display surfaces render through the same protocol
3. Summary/history surfaces use the same long-text handling path
4. Expand/collapse controls only appear when content exceeds the threshold

### GREEN

Implement the smallest possible shared protocol to make those tests pass.

### VERIFY

Verification should include:

- Updated test output showing the new behavior is covered
- No regression to existing discussion-related tests
- Manual side-panel verification in Chrome if needed for final visual confirmation

## Minimal Implementation Order

1. Add the failing tests
2. Introduce the shared long-text rendering protocol
3. Apply it to the known exposed surfaces:
   - log rendering
   - input/topic display blocks
   - summary/history blocks
4. Add the shared styles
5. Re-run tests and verify evidence

## Acceptance Criteria

The work is complete when all of the following are true:

- Long text no longer pushes core side-panel controls out of view
- All exposed long-text display surfaces use one shared rendering protocol
- Long content defaults to fixed-height internal scrolling
- Long content provides expand/collapse
- Short content does not show unnecessary controls
- Existing side-panel behavior outside text presentation remains unchanged

## Risks and Mitigations

### Risk: Surface-specific rendering regressions
Mitigation: cover each exposed surface with focused tests and keep the implementation targeted.

### Risk: Over-refactoring while touching `panel.js`
Mitigation: constrain the change to rendering entry points and shared display behavior only.

### Risk: Inconsistent DOM structure across surfaces
Mitigation: define stable shared markers/classes as part of the display protocol and assert them in tests.

## Open Questions

None. Scope, default behavior, and expand/collapse behavior were explicitly approved during brainstorming.

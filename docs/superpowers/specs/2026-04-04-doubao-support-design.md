# 豆包网页端支持设计

## Context

The extension currently supports three web providers: Claude, ChatGPT, and Gemini. Their shared workflow is built around a single send/capture/cache loop:

1. `sidepanel/panel.js` chooses targets and orchestrates normal mode, `/mutual`, `/cross`, and discussion mode.
2. `background.js` resolves a provider tab by host and forwards commands to the matching content script.
3. A provider content script injects the prompt into the web UI, waits for the response to finish, and emits `RESPONSE_CAPTURED`.
4. `background.js` stores the latest reply in `chrome.storage.session.latestResponses`.
5. Higher-level features reuse those captured replies for cross-evaluation and discussion rounds.

The new goal is to add **Doubao web UI support** for `https://www.doubao.com/chat/`.

## User-approved scope

The user approved scope **B** with one naming constraint:

- Internal code identifiers use `doubao`
- User-facing UI text shows `豆包`

### In scope

- Text send to Doubao in normal mode
- Response capture from Doubao
- Doubao participation in `/mutual`
- Doubao participation in `/cross`
- Doubao participation in discussion mode as one of 2~3 participants
- UI exposure in target selection, mention insertion, and discussion participant selection
- Regression coverage for panel orchestration and provider routing/capture contracts

### Out of scope

- Automatic file upload for Doubao in this round
- Large-scale provider platform rewrite beyond what is needed to reduce duplicated provider metadata
- Any backend, API, or cloud changes

## Product rules

1. **Code uses `doubao`; UI displays `豆包`.**
2. **Doubao joins the existing provider pipeline rather than creating a special-case flow.**
3. **Discussion mode remains a 2~3 participant experience.** Doubao expands the participant pool from 3 providers to 4 providers; it does not change discussion rules.
4. **Every generated prompt that depends on prior responses must still explicitly require Chinese replies.**
5. **Doubao file upload is not promised.** If file delivery reaches Doubao, the system must fail clearly or skip explicitly instead of pretending success.

## Recommended approach

### Chosen approach: lightweight provider metadata consolidation

The implementation should keep the current three-layer runtime:

- `sidepanel/panel.js` — orchestration
- `background.js` — tab routing and latest-response cache
- `content/*.js` — provider-specific DOM adapters

Within that architecture, provider metadata should be consolidated enough that panel parsing, UI labeling, connection status, and background routing do not each keep their own hard-coded 3-provider lists.

### Why this approach

- A pure “copy the fourth provider everywhere” change would work short-term but would spread `claude/chatgpt/gemini/doubao` literals across even more places.
- A full provider-platform abstraction would be over-designed for this repository’s experimental scope.
- A lightweight registry gives a cleaner path for this fourth provider without changing the repository’s runtime model.

## Provider metadata contract

A single shared provider definition should drive the values that are currently duplicated across panel/background/UI code.

Minimum fields:

- `id`: `claude | chatgpt | gemini | doubao`
- `label`: user-facing label (`Claude`, `ChatGPT`, `Gemini`, `豆包`)
- `hosts`: host match list used for tab resolution
- `mention`: `@Claude`, `@ChatGPT`, `@Gemini`, `@Doubao`
- `supports`:
  - `normalSend`
  - `responseCapture`
  - `discussion`
  - `mutual`
  - `cross`
  - `fileUpload`

For Doubao, the expected support map is:

- `normalSend: true`
- `responseCapture: true`
- `discussion: true`
- `mutual: true`
- `cross: true`
- `fileUpload: false`

This registry does not need to become a new subsystem. It only needs to be centralized enough that the extension derives provider behavior from one source of truth instead of many scattered literals.

## File-level design

### `manifest.json`

Add Doubao to the extension host surface:

- `host_permissions` includes `https://www.doubao.com/*`
- `content_scripts` includes a new entry for `content/doubao.js`

Because this repository relies on manual extension reloads and content-script cache can be sticky, the implementation should also bump the extension version so Chrome reliably refreshes the content script set.

### `background.js`

Extend the provider routing/cache layer to recognize Doubao:

- `AI_URL_PATTERNS` gains `doubao`
- `getStoredResponses()` default object gains `doubao: null`
- `findAITab()` can resolve Doubao tabs
- `getAITypeFromUrl()` maps `www.doubao.com` to `doubao`

No new background message type is required. Doubao should reuse the existing:

- `SEND_MESSAGE`
- `GET_RESPONSE`
- `RESPONSE_CAPTURED`

flow.

### `sidepanel/panel.html`

Expose Doubao in both modes:

- normal-mode target checkbox labeled `豆包`
- mention button that inserts `@Doubao`
- discussion-mode participant checkbox labeled `豆包`

Discussion participant validation remains unchanged:

- minimum 2
- maximum 3

### `sidepanel/panel.js`

This file is the main orchestration surface and needs four categories of changes.

#### 1. Provider enumeration

Current fixed 3-provider lists should be derived from centralized provider metadata rather than repeated literals. That includes:

- target selection
- connected tab status
- discussion participants
- display labels

#### 2. URL-to-provider recognition

Local helper logic that maps a tab URL to provider id must recognize `doubao`.

#### 3. Mention parsing and command routing

The parser must accept Doubao anywhere existing provider mentions are accepted.

Examples that must work:

- `@Doubao 评价一下 @Claude`
- `@Claude 评价一下 @Doubao`
- `/cross @Claude @Doubao <- @ChatGPT 评价一下`
- `/cross @Doubao <- @Claude @Gemini 对比一下`

Behavior rules remain the same:

- exactly 2 mentioned providers + evaluation language can auto-resolve as cross-reference
- 3-provider explicit routing still uses `/cross`

#### 4. Discussion-mode integration

Discussion mode already uses `participants` arrays rather than hard-coded provider pairs. Doubao should enter the participant pool without changing the round model:

- round 1: initial opinions
- later rounds: cross-evaluation / continuation
- interject: broadcast to all current participants
- summary: all current participants generate summaries

UI badges and participant displays must show `豆包` rather than `doubao`.

## Doubao content-script design

Create `content/doubao.js` as a provider adapter parallel to the existing provider scripts.

### Responsibilities

1. Receive `INJECT_MESSAGE`
2. Find and populate Doubao’s input control
3. Trigger Doubao’s send action
4. Observe the conversation for a new assistant reply
5. Detect when the latest reply is complete enough to capture
6. Return the latest reply on `GET_LATEST_RESPONSE`
7. Emit `RESPONSE_CAPTURED` with `aiType: 'doubao'`

### Success criteria

A Doubao adapter is considered successful when it supports all of the following:

- normal-mode text send works
- captured replies are stored under `latestResponses.doubao`
- Doubao can act as a `/mutual` participant
- Doubao can act as either source or target in `/cross`
- Doubao can participate in discussion start, later rounds, interject handling, and summary generation

### Failure boundaries

- If the input box or send control cannot be found, the adapter should return a clear error
- If Doubao file upload is requested, the system should fail explicitly or skip explicitly according to the chosen panel behavior; it must not report a fake success
- Silent no-op behavior is not acceptable for provider send/capture failures

### Response completion strategy

Doubao should follow the same lesson already learned from ChatGPT capture:

- **text stability alone is not enough**
- **a single DOM stop/start signal alone is not enough**

The adapter should use a double-safety completion strategy:

1. Observe Doubao-specific DOM signals that indicate streaming is active or has ended
2. Keep a length-stability fallback window before final capture

The exact selectors can be discovered during implementation, but the contract is fixed: do not finalize on the first momentary pause if Doubao is still streaming or likely to continue.

## Data-flow contract

After Doubao support is added, the expected flow is:

1. The operator selects `doubao` in the side panel or references `@Doubao`
2. `sidepanel/panel.js` routes the request using the shared provider definition
3. `background.js` finds a Doubao tab via host matching
4. `content/doubao.js` injects the prompt and waits for a new completed reply
5. `content/doubao.js` emits `RESPONSE_CAPTURED`
6. `background.js` stores the reply in `chrome.storage.session.latestResponses.doubao`
7. Normal mode, `/mutual`, `/cross`, and discussion mode can all consume that cached latest reply without provider-specific special cases

This is the key closed loop. Doubao is not a side path.

## Testing design

### 1. Panel orchestration regression tests

Update panel tests to cover Doubao in normal and discussion flows.

Primary targets:

- `tests/panel-normal-mode.test.mjs`
- `tests/panel-discussion.test.mjs`

Required assertions include:

- provider collections include `doubao`
- mention parsing accepts `@Doubao`
- `/cross` parsing accepts Doubao as source and target
- discussion participant options include Doubao
- discussion still enforces 2~3 participants
- user-facing display strings show `豆包` where the UI renders provider names

### 2. Background routing coverage

Add or extend tests so background routing verifies:

- `https://www.doubao.com/...` resolves to `doubao`
- stored latest-response defaults include `doubao`

### 3. Doubao adapter coverage

Add provider-level tests for the new content script, following the style of current capture-focused tests.

Minimum assertions:

- prompt injection writes content into the expected Doubao input surface
- send action is triggered
- latest-response extraction returns the latest assistant reply rather than an older cached one
- completion logic does not immediately lock onto a partial reply when the response is still evolving

## Manual validation plan

Because the repository’s primary truth is the real Chrome extension host, implementation validation should still include the real extension workflow in Chrome:

1. Reload unpacked extension
2. Refresh already-open AI tabs so the updated content script is reinjected
3. Verify Doubao connection status in the side panel
4. Test normal send to Doubao only
5. Test mixed send with at least one existing provider plus Doubao
6. Test `/mutual` including Doubao
7. Test `/cross` where Doubao is target
8. Test `/cross` where Doubao is source
9. Test discussion mode with Doubao + one other provider
10. Test discussion mode with Doubao + two other providers
11. Confirm file-upload behavior is explicit rather than misleading

## Acceptance criteria

This design is satisfied when all of the following are true:

- the extension recognizes Doubao tabs at `www.doubao.com`
- the side panel exposes Doubao in normal and discussion mode
- internal code paths consistently use `doubao`
- user-facing UI consistently displays `豆包`
- normal send, `/mutual`, `/cross`, and discussion mode all work with Doubao through the same send/capture/cache loop as existing providers
- Doubao response capture waits for a sufficiently complete reply instead of locking onto an early partial output
- regression tests cover panel parsing/orchestration plus Doubao routing/capture contracts
- no unsupported Doubao file upload path reports false success

## Non-goals reminder

This design intentionally does not include:

- production-hardening for all future providers
- automatic Doubao file upload
- generalized provider SDKs or backend abstractions
- any workflow expansion beyond enabling Doubao inside existing normal and discussion features

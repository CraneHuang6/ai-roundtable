# Discussion Mode 2-to-3 Participants Design

## Context

The current discussion mode in `sidepanel/panel.js` is hard-coded for exactly two participants. The user requirement is to keep discussion mode flexible within the existing three supported AI providers—Claude, ChatGPT, and Gemini—so the operator can choose **any two participants or all three** without switching to a different mode.

This design must preserve the current discussion product shape:

- one discussion mode entry point
- one shared side-panel orchestration flow
- multi-round discussion based on previously captured responses
- explicit Chinese-language prompts at every discussion stage

This design must also stay compatible with the existing responsive-layout and long-text-display work already documented in:

- `docs/superpowers/specs/2026-04-03-discussion-responsive-spec.md`
- `docs/superpowers/plans/2026-04-02-long-text-display.md`

## Problem Statement

Discussion mode currently assumes a fixed two-party structure in several places:

- participant validation requires exactly 2 selections
- discussion header uses a two-party `A vs B` mental model
- next-round orchestration destructures participants as `[ai1, ai2]`
- interject flow assumes there is only one "other side"
- summary rendering assumes exactly two summary cards and uses "双方" wording

That shape prevents the desired workflow:

- choose Claude + ChatGPT
- choose Claude + Gemini
- choose ChatGPT + Gemini
- choose Claude + ChatGPT + Gemini

## Product Goal

**Discussion mode supports selecting any 2 or all 3 supported AIs and runs one unified multi-round discussion flow across both cases.**

This is not a separate "three-way mode." It is the same discussion mode with a wider participant-count rule.

## Product Rules

1. The operator may select **2 or 3** participants from Claude, ChatGPT, and Gemini.
2. Selecting fewer than 2 participants must prevent starting a discussion.
3. Selecting more than 3 participants is impossible because the product only supports three providers.
4. The same discussion workflow must support both 2-party and 3-party cases.
5. Every discussion-stage prompt must explicitly require Chinese replies.
6. The UI must avoid two-party-only language like `双方` or `对方` when the mode is operating on a participant array.

## Recommended Architecture

### 1. Keep one `participants` array as the source of truth

`discussionState.participants` remains an ordered array of selected AI ids.

Examples:

- `['claude', 'chatgpt']`
- `['claude', 'gemini']`
- `['chatgpt', 'gemini']`
- `['claude', 'chatgpt', 'gemini']`

This array drives:

- participant validation
- waiting/pending state
- next-round prompt construction
- interject prompt construction
- summary requests
- summary rendering order

### 2. Replace pair-specific logic with `otherParticipants`

The core orchestration rule becomes:

> For each target participant in a discussion round, gather the latest relevant responses from all other selected participants and ask the target to continue the discussion based on those responses.

This produces one unified mechanism:

- in a 2-party discussion, `otherParticipants.length === 1`
- in a 3-party discussion, `otherParticipants.length === 2`

That means the product behavior expands naturally without introducing separate branching logic for a dedicated 3-party mode.

### 3. Preserve the current history model

The existing history shape is sufficient:

```js
{ round, ai, type, content }
```

No schema expansion is required for this feature.

Why this is enough:

- `round` groups entries per round
- `ai` identifies speaker
- `type` distinguishes `initial`, `cross-eval`, `summary`, and other stages
- `content` stores captured reply text

The feature needs orchestration changes, not storage redesign.

## Interaction Design

### Participant selection

Discussion mode keeps the current checkbox-based participant picker.

Required rule:

- start button enabled only when selected count is `>= 2 && <= 3`

Required copy changes:

- hint text should say discussion supports `2~3` participants
- validation errors should say `请选择 2~3 位参与者`

### Discussion header

The discussion badge should stop using a versus mental model.

Current two-party framing such as `Claude vs ChatGPT` is acceptable only for strict debate semantics, but the new feature is a roundtable. The header should use a neutral participant list instead.

Recommended rendering:

- `Claude · ChatGPT`
- `Claude · ChatGPT · Gemini`

### Status text

Status copy must be driven by the participant array rather than pair-specific wording.

Examples:

- `等待 Claude、ChatGPT 的初始回复...`
- `等待 Claude、ChatGPT、Gemini 的初始回复...`
- `等待所有参与者继续回应...`
- `正在请求所有参与者生成总结...`

Avoid hard-coded wording tied to two-party semantics:

- `双方`
- `对方`

Use:

- `其他参与者`
- `所有参与者`
- `其余参与者`

## Discussion Flow

### Round 1: Initial topic responses

When discussion starts:

1. collect selected participants
2. initialize `discussionState`
3. set `pendingResponses = new Set(participants)`
4. send the same topic prompt to each selected AI

Prompt contract:

- include the discussion topic
- explicitly require Chinese replies

Example structure:

```text
请围绕以下话题分享你的看法，并始终使用中文回复：

<topic>
```

### Round N: Continue discussion based on other participants

For every next round, each selected AI receives:

- the original topic
- the previous round responses from all other selected participants
- an instruction to continue the discussion in Chinese

Example target resolution:

- target: `claude`
- others in 2-party mode: `[chatgpt]`
- others in 3-party mode: `[chatgpt, gemini]`

Example prompt shape:

```text
讨论主题：<topic>

以下是其他参与者上一轮的回复：

<chatgpt_response>
...
</chatgpt_response>

<gemini_response>
...
</gemini_response>

请始终使用中文回复。
请基于这些观点继续讨论，并说明：
1. 你认同什么
2. 你不认同什么
3. 你要补充什么
```

The exact bullet wording can stay close to the current two-party evaluation wording as long as it is generalized to multiple other participants.

### Interject flow

User interject should also use the same `otherParticipants` model.

For each target participant:

- include the user’s interjection message
- include the latest responses from all other selected participants
- explicitly require Chinese replies

This keeps interject behavior consistent with the main discussion loop.

### Summary flow

When the operator clicks summary:

1. build one shared history text from all rounds
2. send a summary prompt to every selected participant
3. wait for all selected participants to respond
4. render one summary card per participant

Summary prompt must explicitly require Chinese replies and request:

1. main consensus points
2. main disagreements
3. each participant’s core view
4. overall conclusion

## UI Rendering Rules

### Summary section

Summary rendering must be participant-count-aware.

Required outcomes:

- 2 participants -> 2 summary cards
- 3 participants -> 3 summary cards
- cards rendered in the same order as `discussionState.participants`

Section title should be generalized from `双方总结对比` to something like:

- `参与者总结`
- `讨论总结`

### History section

The complete discussion history remains grouped by round.

Within each round, entries should render in stable participant order rather than relying on capture timing order. This makes the summary view easier to read and avoids noisy ordering changes.

### Layout compatibility

This feature must not regress the existing responsive and long-text rules:

- discussion mode still prioritizes primary actions over secondary chrome
- long text in topic, log, and summary surfaces still uses the shared long-text container protocol
- adding a third summary card must not hide discussion controls or break scrolling expectations

## Testing Contract

Primary regression coverage belongs in `tests/panel-discussion.test.mjs`.

### Required behavior tests

1. **Participant validation**
   - 1 selected -> start disabled
   - 2 selected -> start enabled
   - 3 selected -> start enabled

2. **Start discussion**
   - `discussionState.participants` stores the chosen array
   - header badge uses participant list wording, not `vs`
   - all selected AIs receive the initial topic prompt

3. **Next round orchestration**
   - in 2-party mode, each AI receives exactly 1 other-participant response
   - in 3-party mode, each AI receives exactly 2 other-participant responses
   - every prompt explicitly requires Chinese replies

4. **Interject**
   - all selected participants receive the interject prompt
   - prompt includes latest responses from all other selected participants
   - wording uses generalized participant language

5. **Summary**
   - 2 participants -> 2 summary cards rendered
   - 3 participants -> 3 summary cards rendered
   - summary prompts explicitly require Chinese replies

6. **No two-party wording lock-in**
   - avoid assertions that require `双方` / `对方`
   - prefer assertions against generalized wording or participant-count-based rendering

### Regression constraints

Tests should also avoid regressing already-approved rules from adjacent work:

- discussion responsive layout contract remains protected
- long-text shared container remains used where already adopted
- discussion mode prompt chain remains language-locked to Chinese at every hop

## Files Expected to Change

### Primary implementation

- `sidepanel/panel.js`
  - participant validation
  - start discussion flow
  - next-round orchestration
  - interject orchestration
  - summary request flow
  - summary rendering

### Primary regression coverage

- `tests/panel-discussion.test.mjs`

### Supporting documentation

- `README.md`
  - update discussion-mode product description and usage steps

Potentially no CSS change is required if existing layout absorbs the extra card count cleanly, but `sidepanel/panel.css` may need minor adjustments for a 3-card summary stack or participant badge wrapping.

## Non-Goals

This design does **not** include:

- support for 4+ participants
- a separate three-way discussion mode entry
- a backend or persistence redesign
- changes to provider capture architecture in `background.js` or content scripts
- new command syntax outside the existing side-panel discussion flow

## Acceptance Criteria

The design is complete when all of the following are true:

- the operator can select any 2 of the 3 supported AIs, or all 3
- discussion start is blocked for fewer than 2 selections
- the same discussion workflow handles both 2-party and 3-party cases
- each participant’s later-round prompt includes all other selected participants’ prior replies
- interject and summary flows work for both 2-party and 3-party discussions
- every discussion-stage prompt explicitly requires Chinese replies
- summary and UI wording no longer assume a fixed two-party structure
- existing responsive and long-text rules remain intact

## Rationale for This Design

This design intentionally stops at `2~3` participants instead of introducing generic `N`-party architecture.

**Why:**

- the product only supports three providers today
- the user requirement is specifically "any two or all three"
- a full `N`-party abstraction would add complexity without present product value

**How to apply:**

- use participant-array-driven orchestration internally
- do not expose or optimize for unsupported counts beyond 3
- keep the implementation small, focused, and compatible with the existing side-panel architecture

# Grok 网页端支持设计

## Summary

本轮在现有 provider 主链路中新增 `grok`，接入范围固定为 `https://grok.com/*`。Grok 参与：

- normal send
- response capture
- `/mutual`
- `/cross`
- discussion

本轮不支持自动文件上传，不接入 `x.com` 或其他 Grok 入口，也不为 Grok 新增 debugger fallback。

## Runtime Contract

Grok 继续沿用仓库当前三层结构：

1. `sidepanel/panel.js`
   - 把 Grok 纳入 provider registry
   - 统一驱动 target、mention、discussion participant、label、file gating
2. `background.js`
   - 按 `grok.com` 识别 provider tab
   - 复用 `SEND_MESSAGE`、`GET_RESPONSE`、`RESPONSE_CAPTURED`
   - 维护 `latestResponses.grok`
3. `content/grok.js`
   - 负责 Grok 输入框注入、发送、回复抓取、完成判定

## Product Rules

1. 内部 id 固定为 `grok`
2. UI 名称固定显示 `Grok`
3. mention 固定为 `@Grok`
4. host 只支持 `grok.com`
5. 自动文件上传固定返回 `Grok 暂不支持自动文件上传`
6. 普通模式和讨论模式都必须消费 `streamingActive` / `captureState`，不能只靠文本稳定就提前收口

## Content Script Contract

`content/grok.js` 的实现收口为标准 content-script provider：

- 输入框优先匹配 `textarea[aria-label*="Grok"]` 与当前首页可见 textarea
- 发送按钮优先匹配 `button[aria-label="提交"]` 与语义相近 fallback
- 发送成功必须至少验证一个后置信号：
  - 输入框内容离开
  - 发送控件状态变化
  - 用户消息数增加
  - 页面进入 streaming
- `GET_LATEST_RESPONSE` 必须返回：
  - `content`
  - `streamingActive`
  - `captureState`
- `RESPONSE_CAPTURED` push 必须保留：
  - `streamingActive`
  - `captureState`
  - `updatedAt`

## Verification

- `tests/grok-capture.test.mjs`
- `tests/background-routing.test.mjs`
- `tests/panel-normal-mode.test.mjs`
- `tests/panel-discussion.test.mjs`
- 手工验证：
  - reload unpacked extension
  - 刷新 Grok 标签页
  - 验证普通发送、`/mutual`、`/cross`、discussion
  - 验证带文件时对 Grok 显式跳过

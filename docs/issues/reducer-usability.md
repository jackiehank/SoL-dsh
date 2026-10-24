# 让 Evidence-Preserving Reducer 在默认路由上真正可用

## 问题

Reducer 的链路已通，但真机始终停在 `fallback: unverifiable-quote`：默认路由
（`opencode-go / deepseek-v4.1-flash`）产出的引文不是归档正文的逐字连续子串。当前实现没有暴露
任何“怎么让模型更会照抄”的旋钮——`callReducer` 只传 provider/model/maxTokens，思考等级与温度都
用适配器默认值。

需要回答：在**不改校验规则**的前提下，有哪些可调项能让回执通过校验，以及默认值应该怎么选。

## 可调项（候选）

1. **思考等级（reasoningEffort）**：`GenerateOptions` 与 `LlmCallConfig` 都支持
   `reasoningEffort`；上游 reducer 明确用高层级（论文：GPT-5.6 Luna at high）做提取。
   当前我们没传，等于吃适配器默认值。加配置 `reducerReasoningEffort`，且 **prepareCall 与 stream
   必须传同一个值**（否则复现 D1 的 “prepared config changed”）。
2. **温度**：`LlmCallControls.temperature` 可用（是否被路由支持需实测）。提取任务应尽量确定，
   候选 `reducerTemperature: 0`。
3. **提示词**：要求“引用最短、唯一、完整的一行；≤200 字符；不要省略号、不要拼接、不要改空白”，
   并把 evidence 条数从 12 降到 3–5，减少出错面。
4. **失败重试**：校验失败时用同一份输入重试一次（仍失败则 fail-closed），成本可控。
5. **fixture 真实性**：D1 的 80 行重复 `nnn…` 对逐字复制极不友好，可能放大了失败率；
   应补一个“真实形态”的失败日志（行长短不一、失败行短且唯一）作为对照。

## 约束

- **不放宽校验**：`body.includes(quote)`、schema/hash/status/大小比较保持原样；
- 默认值必须保守：不改变现有路由与成本结构，新增旋钮默认沿用适配器默认；
- 不把思考等级写死在代码里，走配置（`cordis.patch.yml`），并且非法值在装配阶段报错；
- 安全面不变：仍是同一 provider 路由、同样对 `likely-secret` 提前拒绝。

## 验收

1. 新增 `reducerReasoningEffort`（可选，字符串）与 `reducerTemperature`（可选，0–2），
   prepare/stream 同值传递，非法值装配期报错；
2. 在真实形态 fixture 上，至少一种配置组合能让账本出现
   `candidate → provider_response → applied`，且 `receiptBytes < sourceBytes`；
3. 同一配置在 D1 的重复行 fixture 上若仍失败，账本明确记录 `unverifiable-quote`，原文逐字节保留；
4. 所有对照仍走 enable-bundle 开关，`remove_bundle` 即恢复，profile 文件 sha256 不变。

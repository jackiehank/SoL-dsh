# Reducer 真机暴露的四个缺陷

## 问题

`evidence-preserving-reducer-dsh` 的单测全绿，但第一次真机打开 `evidencePreservingReducer` 时，
链路上的失败一个接一个暴露；每次都被 fail-open 接住（原文保留、账本记原因），所以问题不会
表现在“结果坏掉”，只会表现在“机制从不生效”。

1. **`diagnosticsInfo` 未声明**：`index.js` 在开启 reducer 时写 `diagnosticsInfo.reducer = …`，
   但 `apply()` 里从没声明它 → 整行 entry 激活失败：
   `ReferenceError: diagnosticsInfo is not defined`。关闭 reducer 时是“假通过”，因为那段代码不执行。
2. **prepared 与 stream 的 config 不一致**：`callReducer` 用 `prepareCall({provider, model})`，
   却用 `stream({…, maxTokens})` 发起，DSH 判定
   `prepared LLM call config changed before adapter dispatch` → 每次 fallback。
3. **缺 sessionId**：修掉 2 之后，provider 直接回
   `400 INVALID_REQUEST MissingSessionID`（opencode-go 需要 `x-opencode-session` 才能路由）。
   归约调用必须带 `sessionId`。
4. **模型输出形态与引文保真**：模型把 JSON 包进 ``` 代码块 → `invalid-json`；剥掉围栏后 JSON 通过，
   但引文不是逐字连续 → `unverifiable-quote`。第 4 条**不是代码 bug**：验证器按设计拒绝了它。

## 约束

- 三条代码缺陷都必须在“开启 reducer”的路径上复测，不能只靠关闭状态下的激活成功；
- fail-open 行为必须保持：任何一步失败都返回原结果，只写账本；
- 不放松引文校验来“让机制看起来生效”——第 4 条的正确答案是换更强的归约模型或改进提示，
  而不是接受不逐字的引文。

## 验收

1. 开启 reducer 后插件能激活（不再 `ReferenceError`）；
2. 归约调用不再出现 prepared-config 不一致与 MissingSessionID；
3. 账本出现完整的 `candidate → provider_response → applied`（在能逐字复述的模型上），
   或 `fallback: unverifiable-quote`（在不能逐字复述的模型上）且原文逐字节不变；
4. 代码围栏剥除有单测覆盖，且不改变“JSON 必须可解析、引文必须逐字”的硬约束。

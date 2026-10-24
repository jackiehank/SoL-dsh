# ObservationPack：超大工具结果换成句柄 + 精确分页召回

## 问题

上游 SoL-Pi 的 ObservationPack 处理“一次性大观测”：超过 10 KiB 的纯文本工具结果，前两次
provider 请求仍发全文，从第三次起在**投影层**（Pi 的 `context` 事件）替换成占位符——带
head/tail 完整行摘录、原始字节/行数/估算 token、以及 `obs_recall` 的调用指引；原文按内容
寻址归档，`obs_recall` 用字节偏移 + 行数上限精确分页读回，保证 UTF-8 不被切半。

DSH 侧的现实：

- **没有投影层**。`agent/request` 明确不能改消息，`agent/pre-step` 只换下一步进入的
  user 消息。模型看到的内容由会话日志里的 `tool/result` 决定。
- DSH 已经有几件相关能力：`dsh-spill-policy`（把超大结果换成有界预览）、
  `dsh-compaction-tool-result-pruner`（压缩时裁剪工具结果）、`ctx.spillStore`（保存大文本）。
  它们解决“不要撑爆上下文”，但都**不给模型一个稳定的、可按字节精确回读的句柄**，
  也没有“原观测内容寻址、逐次召回记账”。

所以在 DSH 上，ObservationPack 的落点是 `tools/post-execute`：在结果落日志**之前**替换
`content`，`value` 保持不动（README 明确：替换 content 不影响程序调用方拿到的规范值）。
代价是失去“前两次发全文”这一档：第一次请求就只看到占位符。换来的是 zero-replay——
比上游更省，也给不出“先读一遍全文”的体感。这是本移植最重要的取舍。

## 目标

1. 开启 `observationPack` 后，单条纯文本工具结果 ≥ `threshold`（默认 10 KiB）时：
   - 原文按 `sha256(toolName \0 callId \0 contentHash)` 生成稳定 id（`obs_<24hex>`）；
   - 归档到 `<archiveRoot>/observation-pack/objects/<id>.txt`，内容寻址、已存在则逐字节校验；
   - `content` 换成占位符：首尾各若干完整行、原始字节/行数/估算 token、召回指引；
2. 注册 `obs_recall`：`{id, offset}` → 返回一页（≤16 KiB、≤400 行，按 UTF-8 边界截断），
   头部带 `next_offset` 与 `eof`；偏移越界/未知 id 报错；
3. 归档是**持久**的（默认在 `DSH_HOME/sol-pi`），会话 resume / 宿主重启后仍可召回；
4. 幂等：已经带 reducer 回执前缀（`sol_pi_evidence_receipt_v1`）的结果不再打包；
5. 失败开放：归档写失败或任何异常 → 原结果原样返回，只记录诊断，不影响工具调用；
6. 关闭时无 post-execute 改写、无 `obs_recall` 工具。

## 约束

- 只处理**纯文本且非错误**的结果；图片/结构化结果不碰；
- 不删除、不重写会话历史：替换发生在结果最终化之前，`value` 不动；
- 召回严格按字节偏移分页，且保证不切断 UTF-8 多字节序列；
- 归档目录权限收紧（目录 0700、文件 0600），路径内容寻址、拒绝软链接；
- 记账（ledger）用 JSONL 追加，只记 id/字节/行/token/请求序号，不进模型上下文。

## 验收

- 大结果被替换后，模型看到占位符带 id、原始尺寸与召回指引；原文不在上下文中；
- `obs_recall` 分页读回的字节拼接后与原文逐字节相等（含 CJK/emoji 边界）；
- 未知 id、越界 offset 报明确错误；
- 小结果、错误结果、reducer 回执不被改写；
- 归档目录不可写时 fail-open（本次结果仍是原文）；
- `node --test tests` 覆盖：阈值边界、占位符首尾完整行、UTF-8 截断、并写同 id 校验、幂等。

## 落地

- 入口：`plugin/lib/observation-pack.js`（`attachObservationPack` 注册 `obs_recall` 并挂 `tools/post-execute`），
  归档与分页在 `plugin/lib/store.js`；配置键见 `plugin/lib/config.js`。
- 替换时机：监听器先 `await next()`，只在 accept 且没有 `value` 替换时改写 `content`；
  错误结果、非文本块、已带 `sol_pi_evidence_receipt_v1` 的回执一律不动。
- 归档：`<storageRoot>/observation-pack/objects/<obs_id>.txt`，`O_EXCL` 写入、已存在逐字节校验；
  账本 `<storageRoot>/observation-pack/ledger.jsonl`。默认 `storageRoot = <DSH_HOME>/sol-pi`。
- 与上游的差异：没有“前两次发全文”这一档（DSH 无投影层），占位符第一次请求就生效；
  占位符首行改成 `replaced before it entered the context`，其余字段与召回格式保持上游形状。
- 失败开放：归档写失败只 `console.warn`，监听器返回原决定（测试用不可写路径覆盖）。
- 验证：`node tests/observation-pack.test.mjs` 12 项通过，覆盖阈值边界、首尾完整行、
  原文逐字节回读（含 CJK/emoji 的 UTF-8 边界）、未知/越界 id、归档同 id 异内容、fail-open。

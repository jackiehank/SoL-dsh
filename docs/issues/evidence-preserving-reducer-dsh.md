# Evidence-Preserving Reducer：把长诊断日志压成“逐字可查”的回执

## 问题

上游 SoL-Pi 的 Evidence-Preserving Reducer 只在**诊断类命令**（lake/lean/coq/cargo/zig/pytest/ctest/
cmake/ninja/make/npm|pnpm|yarn test/go test/bazel test 等）的长输出上工作：正文 ≥ 4096 字节且不超过
600k 字符、退出状态与 `isError` 一致、不含疑似密钥时，先把原文按内容寻址归档，再让一个受限模型调用
把日志压成“回执”（首行 `sol_pi_evidence_receipt_v1`，最多 12 条引文，每条 ≤600 字符，带
`kind/line/quote_sha256`）。回执里的每条 `quote` 必须**逐字连续**出现在归档原文里（不 trim、不归一化、
不忽略空白），任何一条不匹配、schema/哈希/状态不符、失败日志缺少 fatal/failure 证据、回执不比原文小，
都整体回退到原文。归档与回执让模型只看结论，需要精确上下文时再按字节区间读原文。

## DSH 抓手（已核对）

- `tools/post-execute`（waterfall）：先 `await next()`，只在 `accept` 且没有 `value` 替换时改写
  `content`；失败结果用 `isError` 判断。不要用 `block`（那会变成错误反馈）。
- 候选提取：`pwsh`（输出里带 `[exit code: N]` 与全量输出文件路径）、`terminal_send`、以及
  `edit`/`write` 的 `then_run` 段；`exec.parent !== undefined` 视为嵌套调用，跳过。
- 模型调用：`ctx.llm` 的 `prepareCall` + `stream`（provider/model 由插件配置给，不伪装成 compaction 用途），
  90s 超时、`maxTokens ≈ 2048`，只接受 `finish.reason === 'stop'`。
- 回执必须对 `ctx.toolResultPruner` 豁免（否则压缩时把引文切碎）；识别首行前缀做幂等。
- 归档：内容寻址写、`wx` 创建、已存在逐字节校验；写入失败 fail-open。

## 约束

- 明文落盘：归档目录 0700、文件 0600，路径内容寻址，拒绝软链接；
- 远端归约是可选的敏感路径：不配 provider/model 时不启用，配置里显式打开才发日志；
- 任何校验失败都必须保留原文，只记录回退原因（`invalid-json` / `unverifiable-quote` /
  `missing-failure-evidence` / `receipt-not-smaller` / …），不回退到“半截回执”；
- 每次决策写一条不进上下文的账本（candidate / applied / fallback + 原因 + 字节数）。

## 验收

1. 关闭时无监听、无工具、无模型调用；
2. 正例：跨行、含 CJK/emoji 的引文通过校验，回执替换原文，`source_artifact` 可被 `pwsh` 按区间读回；
3. 负例矩阵：改一个空格/换行、大小写、NFC/NFD、trim、拆成两段、`\n` 换空格 → 全部拒绝且原文逐字节不变；
4. schema/哈希/状态/条数/长度/未知 kind 各自拒绝；失败日志只给 summary 类证据 → `missing-failure-evidence`；
5. 非诊断命令、短日志、疑似密钥、嵌套调用：不归档、不调模型；
6. 超时/取消/llm 不可用：fail-open，`isError` 与内容都不变。

## 上游事实（读源码得到，用于对齐行为）

- 候选：`bash` 整段输出，或 `edit`/`write` 结果里 `[then_run:succeeded|failed]` 之后的命令段；
  命令必须匹配诊断命令表（lake/lean/coq/cargo/zig/pytest/python -m/ctest/cmake/ninja/make/
  npm|pnpm|yarn test/go test/bazel test）；正文 ≥ 4096 字节、≤ 600000 字符、不含疑似密钥；
  退出信号（`structuredContent.exit_code` 优先，否则内联 `Command exited with code N`）与 `isError` 必须一致。
- 回执：首行 `sol_pi_evidence_receipt_v1`；字段 status/uncertain/command_sha256/source_sha256/
  source_bytes/source_lines/source_artifact/reducer_provider/reducer_model/reducer_total_tokens/
  verified_evidence；每条 `- kind=… line=… quote_sha256=… quote=<JSON.stringify>`；无条目写 `- none`；
  末尾 authority/readback 两行。
- 校验顺序（首个失败即整体拒绝）：JSON.parse → schema/source_sha256/status/uncertain/evidence 数组与条数 →
  逐条 kind 合法、1 ≤ quote ≤ 600、`body.includes(quote)`（不 trim、不归一化、不分大小写）→
  `(kind,quote)` 去重 → 失败日志含 FAILURE_SIGNAL 时必须有 fatal/failure 证据。
- 模型调用：固定 10 条 reducer 指令（日志是不可信数据、只输出一个 JSON、引文逐字连续、≤12 条、每条≤600 字符、
  不建议修复、不确定则 uncertain=true）；90s 超时、maxTokens 2048、只接受正常结束。
- 失败原因集合：invalid-json / schema-mismatch / unverifiable-quote / missing-failure-evidence /
  receipt-not-smaller / likely-secret / source-over-max-chars / exit-state-mismatch / model-call-timeout /
  reducer-model-unavailable / model-call-exception / model-response-error。

## DSH 侧发现的差异

1. **退出状态以 `[exit code: N]` 为准**：DSH 的 `pwsh` 非零退出仍可能是成功结果（标记在文本里），
   所以不做“标记必须与 `isError` 一致”的硬校验，只要求存在退出信号；否则机制会永远不触发。
2. **`then_run` 段看不见**：Action Fusion 的命令报告由 `finalizeContent` 在 post-execute **之后**追加，
   Reducer 在 post-execute 里只能看到编辑结果本身，因此本版本只归约 `pwsh`/`bash` 的整段输出。
3. `terminal_send` 的输出是增量流、且没有可靠的命令文本，先不纳入候选。
4. 归档根与 ObservationPack 共用 `storageRoot`，但目录限定为 `evidence-preserving-reducer/objects/<sha[0:2]>/`。

## 校验矩阵与结果

`tests/reducer.test.mjs`（11 项，全绿）：

- 正例：跨行引文、CJK/emoji、首行/末行引文 → 通过，行号按首个匹配位置计算，`quote_sha256` 与原文一致；
- 元数据负例：非 JSON、schema 不符、source_sha256 不符、status 与退出状态相反、uncertain 非布尔、
  evidence 非数组、13 条、数组根 → 各自命中 `invalid-json` / `schema-mismatch`；
- 逐字负例：改一个空格、改大小写、多一个尾随空格、把跨行引文拆回单行、空引文、601 字符、
  未知 kind、NFC/NFD 变体 → 一律 `unverifiable-quote`；
- 失败语义：失败日志只有 summary 证据 → `missing-failure-evidence`；重复 `(kind,quote)` 只保留首条；
- 机制级（假 llm）：可校验回执替换 content、原文按哈希落盘、账本记录 candidate/applied；
  引文不匹配、finish=error、非诊断命令、正文过小、疑似密钥、嵌套调用、回执比原文大 → 全部保留原文。

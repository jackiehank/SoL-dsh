# SoL-dsh

[中文](README.md) | English

Ports the four efficiency mechanisms of [NVlabs/SoL-Pi](https://github.com/NVlabs/SoL-Pi) to
**DeepSeek Harness (DSH)** as a Cordis plugin bundle. All four mechanisms are **off by default**;
turn them on one by one on the Plugins page after installing.

Repository <https://github.com/jackiehank/SoL-dsh> (MIT), package `@jackiehank/sol-dsh`,
verified on DSH **0.2.1-rc.3**.

| Mechanism | Short name | In one line |
| --- | --- | --- |
| Action Fusion | Fusion | runs a validation/build command in the same call after `edit`/`write`, saving one model round-trip |
| ObservationPack | Pack | oversized tool results go to local storage, the context keeps only a handle and recalls exact pages on demand |
| Evidence-Preserving Reducer | Reducer | condenses build/test logs into verbatim-checkable receipts, falling back to the raw text when a quote does not match |
| Online Context Compact | Compact | triggers native compaction at a completed plan step and continues in the same turn |

## Surfaces

Once enabled there are two persistent surfaces. Both are additive and never cover DSH's own UI:

- **Per-turn tail**: one line at the end of a turn —
  `This turn: fusion 1 · pack 1 · reducer 0 · compact 0` (hidden when all four are zero);
- **Below the composer**: `Saved 12.3k tok · 16.8%`; click to expand this session's savings
  breakdown (pack / reducer / compact / fusion plus the percentage). The numbers come from a
  Host-side projection folded over the whole session log, so paging, restarts, or turning a
  mechanism off never reset the history.

Settings entry: the **SoL-dsh Efficiency Pack** card on the Plugins page → **Mechanism switches**.
The four switches apply immediately and write back to the profile config.

## Install

### DSH Desktop (verified on 0.2.1-rc.3)

1. Open **Plugins** in the sidebar;
2. Click **Add plugin** (or the arrow next to it → **Install a third-party plugin**);
3. Enter the Git address `github:jackiehank/SoL-dsh` and install;
4. **Refresh the page** after installing — the Client half joins the module graph by package
   name, so an old page will not grow the tail, savings panel, or switches on its own.

All four mechanisms start off; enable the ones you need under **Mechanism switches** on this
package's card.

The desktop profile is owned by Electron and the CLI refuses plugin-management requests for it;
install from inside the app, and don't edit the profile directory by hand.

### Other profiles (web / headless)

```powershell
dsh plugin --profile web add github:jackiehank/SoL-dsh
```

### Local development

Run `pnpm install` at the repository root, then point `plugin_manager`'s `install_bundle` at the
repository root (link mode, not a copy). Reload the plugin after Host-half changes and refresh the
page after Client-half changes.

### Upgrade and uninstall

- DSH Desktop has no "update" button: when the package is already declared in the profile, a
  second install is refused with `already-installed`. **Remove it first, then install the new
  version through the same entry point.**
- Uninstall also happens on the Plugins page; it removes the dependency and the bundle row. If the
  switches come back off after reinstalling, turn them on again on the Plugins page.
- **Refresh the page** after an upgrade or any Client-half change; reload the plugin (or restart
  DSH) after Host-half changes.

## Configuration

Prefer the graphical switches; they are equivalent to editing the profile's `cordis.patch.yml`.
For manual configuration:

```yaml
- id: sol-dsh
  name: '@jackiehank/sol-dsh'
  config:
    version: 1
    actionFusion: false
    observationPack: false
    evidencePreservingReducer: false
    evidencePreservingReducerProvider: ''
    evidencePreservingReducerModel: ''
    onlineContextCompact: false
    cacheWriteReadRatio: 12.5
```

| Key | Default | Description |
| --- | --- | --- |
| `version` | `1` | only 1 is supported |
| `actionFusion` | `false` | Action Fusion |
| `observationPack` | `false` | ObservationPack |
| `evidencePreservingReducer` | `false` | Evidence-Preserving Reducer |
| `evidencePreservingReducerProvider` | empty | provider used by the reducer; empty = default routing |
| `evidencePreservingReducerModel` | empty | model used by the reducer; empty = default routing |
| `onlineContextCompact` | `false` | Online Context Compact |
| `cacheWriteReadRatio` | `12.5` | same name as upstream; validated and kept, not used in decisions yet |

Thresholds are not configurable (10 KiB pack threshold, 16 KiB / 400-line recall, 4 KiB reducer
minimum, 20k-token compact tail, and so on). Two DSH-specific knobs are environment variables:

- `DSH_SOL_DSH_HOME`: archive root (default `<DSH_HOME>/sol-pi`);
- `DSH_SOL_DSH_DIAGNOSTICS=1`: register the `sol_dsh_status` diagnostics tool.

## How it works

- **Action Fusion**: registers shadowed `edit`/`write` in each agent's scope; the schema extends
  the built-in definition with an optional `then_run`. Commands go through the same approvals,
  sandbox, and output truncation as `pwsh`/`bash`.
- **ObservationPack**: `tools/post-execute` replaces `content` before the result reaches the log;
  `value` is untouched. The original is archived by content address, and `obs_recall {id, offset}`
  reads it back page by page by byte offset.
- **Evidence-Preserving Reducer**: only handles the output of `pwsh`/`bash` build/test commands
  (≥ 4 KiB, no likely secrets). It archives first, then makes one constrained `ctx.llm` call.
  Every quote in the receipt must appear verbatim in the original; otherwise the whole receipt
  falls back to the raw text.
- **Online Context Compact**: watches `todo_write`; at the boundary where an old step becomes
  `completed` it picks a region with `ctx.tokenMeter` and calls `ctx.compaction.compactRegion`
  only when the economics work. It never injects a "keep working" message.

Details and trade-offs: [`docs/plugin.md`](docs/plugin.md) and [`docs/issues/`](docs/issues/).

## Compatibility and boundaries

- Verified only against DSH **0.2.1-rc.3**. On older versions without `sessionProjections`,
  historical stats fall back to scanning the current snapshot; without `settings`/`configForms`
  there are no graphical switches, but yml configuration still works;
- Host-half changes need a plugin reload; Client-half changes need a **page refresh**;
- The archive is local plain text and may contain sensitive material from logs; don't point
  `DSH_SOL_DSH_HOME` at a shared directory;
- The reducer has hard limits: a failed verbatim check, a likely secret, or a receipt no smaller
  than the original all fall back — it never forces compression;
- `then_run` output is appended after post-execute, so the reducer never sees it.

## FAQ

- **No "Mechanism switches" on the Plugins page**: make sure this bundle is enabled in the plugin
  list. The config section is only rendered for packages that declare `plugins.bundle.config`;
  refresh the page if the Client half hasn't loaded.
- **No per-turn tail**: it is not rendered when all four are zero; enable a mechanism and run a
  turn that actually hits it.
- **ObservationPack never triggers**: it only handles plain-text tool results over 10 KiB; `value`
  and binary results are untouched.
- **No reducer receipt**: only `pwsh`/`bash` build/test-like commands with ≥ 4 KiB of output and
  no likely secrets qualify; a failed verbatim check or a receipt no smaller than the original
  falls back to the raw text.
- **No compaction**: when the economics don't work (the saved tokens can't offset the summary cost
  or cache invalidation), nothing is compacted.
- **Behavior unchanged after an upgrade**: uninstall and reinstall, then refresh the page; DSH
  Desktop has no in-place update.
- **Diagnostics**: starting with `DSH_SOL_DSH_DIAGNOSTICS=1` registers the `sol_dsh_status` tool,
  which reports how Action Fusion is installed on each agent (whether `then_run` is visible, and
  whether the scoped registration took effect).

## Development

```powershell
pnpm install              # install dependencies at the repository root (schemastery/cosmokit)
node --test tests         # pure-function + mechanism-level tests
node --check client.js
```

Directory:

```text
package.json             DSH bundle manifest (exports / dsh.bundle.patch / dsh.client)
lib/                     Host half: four mechanisms, config, session savings projection
client.js                Client half: plugin-page switches, per-turn tail, savings panel
cordis.patch.yml         inserted plugin row + default config (all four off)
locale/                  package metadata (zh/en)
icon.svg
tests/                   node --test
docs/issues/             kiln issue documents (design and live-run records)
LICENSE                  MIT
```

## Docs and issues

The repository tracks issues with **kiln**: one commit = one action on one issue (`ask` /
`collect` / `test` / `conclude` / `apply`), and `kiln path <issue>` replays the whole research
path. Rules: [`AGENTS.md`](AGENTS.md). Documents: [`docs/issues/`](docs/issues/).

## License

MIT. Upstream [NVlabs/SoL-Pi](https://github.com/NVlabs/SoL-Pi) is MIT; the dependencies
`@deepseek-ai/schemastery` and `@deepseek-ai/cosmokit` are MIT too.

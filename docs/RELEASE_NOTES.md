# dsh-experiment-ledger 0.35.0-preview.1

Preview release · 2026-11-25 · DeepSeek Harness `>= 0.2.2-rc.5`

GitHub: https://github.com/yasaxiwind/dsh-experiment-ledger · Screenshots: `docs/screenshots/`

This is the first public preview of a **local-first experiment ledger** for DeepSeek Harness. It records each run's parameters, metrics, artifacts, logs, environment and git state, then lets you compare, review, report and share the results. It is not a notebook or a data viewer; it is the missing results table.

## What makes it different

- **Run-level ledger** for any executor (shell, Python, Node, MATLAB, MCP, manual).
- **Reproducibility manifest** (command, params, cwd, git, toolchain, env, artifact hashes) with exact rerun.
- **Signed/audited provenance**: Ed25519 packages, trusted keys, rotation/revocation, hash-chained audit log, external anchors, signed conclusions.
- **Full lifecycle**: define → run/sweep/schedule → compare (mean/sd/CI) → baseline → review → report → share.
- **Two surfaces**: 33 agent tools and a dockable sidebar panel; the agent can open the sidebar on the current experiment.

## Install

### npm preview

```sh
dsh plugin --profile <profile> add dsh-experiment-ledger@preview
```

In DSH Desktop: **Settings → Plugins → + Add plugin**, enter `dsh-experiment-ledger@preview`, install, enable, reload.

### From a tarball

Extract it to a folder and add that folder as a plugin; or `dsh plugin --profile <profile> add ./dsh-experiment-ledger-0.35.0-preview.1.tgz`.

No runtime dependencies, no telemetry, no network.

## 3-minute quick start

```text
exp_import path="samples/bundles/pid-tuning.bundle.json"
```

This imports one experiment with five recorded runs. Then:

```text
exp_compare experimentId="exp-…"
exp_report  experimentId="exp-…" format="html"
```

Or create a live experiment:

```text
exp_define name="PID tuning" factors=["kp","ki"] metrics=["overshoot","settling","square_error"]
exp_run experimentId="exp-…" command="node samples/commands/tune.mjs --kp {kp} --ki {ki}" params={"kp":1.5,"ki":0.3}
```

Open the panel, press **⇥** to dock it, use **打开台账…** to select a project/ledger folder, and **结论** to record/approve a decision with your name and role.

## What is in the preview

| Area | Status |
|---|---|
| Runs, params, metrics, artifacts, logs | ready |
| Reproducibility manifests + `exp_reproduce` | ready |
| Comparison, 95% CI, baselines, charts, small multiples | ready |
| Sweeps, presets, schedules, notifications | ready |
| Reviews, signed decisions, reviewer name/role | ready |
| JSON/ZIP bundles, packages, import/export | ready |
| Ed25519 signatures, trusted keys, audit log, anchors | ready |
| CSV/TSV datasets + SQL metrics | ready when `node:sqlite` is available |
| Panel: dock, folder picker, drag/drop import, delete | ready (manual UI pass pending) |

## Known limitations

- **Single-machine, local-first**: no cloud sync, no multi-user realtime collaboration.
- **Trust is TOFU**: keys are pinned manually; signer/reviewer names are labels, not authenticated accounts.
- **Audit is tamper-evident, not tamper-proof**: a local writer can rewrite the whole chain; external anchors help only as much as their host.
- **No dataset viewer**: use `dsh-data-console` for rich CSV/Excel/SQL exploration; this plugin registers datasets and computes SQL metrics.
- **No notebook/figures**: use `dsh-science-workbench`/notebook tools for cells and figures.
- **Commands run with the DSH session's permissions**; there is no sandbox. Review commands before reproducing.
- **Upload cap 20 MB** for the panel importer; larger packages use the agent path.
- **Print view is HTML**, not a generated PDF; use the browser's Print → Save as PDF.
- **Screenshots use synthetic sample data**; the DSH sidebar/session list, workspace label and user name were hidden before capture.

## Feedback

Please report with:

1. DSH version and OS;
2. what you clicked and what you expected;
3. the panel's visible error/notice text;
4. if possible, the experiment id and whether files/reports were affected.

This is a preview: plugin APIs, file formats and UI may change before 1.0.

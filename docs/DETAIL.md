# Experiment ledger

**Every run keeps its parameters, metrics and artifacts, and any two runs can be compared.**

`dsh-science` manages a research loop; `dsh-science-workbench` manages code cells and figures. Neither keeps a structured **results table**. This plugin does: one experiment declares its factors and metrics, every run records values against them, and the panel puts runs side by side.

## What you get

- **Thirty-three tools** for the agent: `exp_define`, `exp_dataset`, `exp_export`, `exp_import`, `exp_trust_key`, `exp_audit`, `exp_anchor`, `exp_verify_anchor`, `exp_open`, `exp_clone`, `exp_batch`, `exp_run`, `exp_record`, `exp_sweep`, `exp_presets`, `exp_schedule`, `exp_candidates`, `exp_promote`, `exp_compare`, `exp_diff`, `exp_baseline`, `exp_report`, `exp_report_compare`, `exp_list`, `exp_show`, `exp_search`, `exp_reproduce`, `exp_conclude`, `exp_reviews`, `exp_review`, `exp_update`, `exp_update_run`, `exp_delete_run`.
- **A panel** in the sidebar footer: experiments on the left (rename/description/tags/archive, show-archived filter), a dynamic run table on the right, a comparison block (mean ± sd + 95% CI with an n<3 warning, ±sd + 95% CI whiskers, small multiples for every metric), one run's detail with dataset hashes, diff, reproducibility manifest, editable notes and delete, a search view, a cross-project comparison mode with export, an archived comparison-report list, candidates, a sweep form with presets/schedules/retries/history, a schedule detail with trend chart and reports, a notification center, a Reviews queue, and report/export controls.
- **Any executor**: shell commands (Python, MATLAB, Node, PowerShell), MCP/CAD calls, or a manually recorded trial.
- **Sweeps**: expand a parameter grid into many runs, sequentially or up to four at a time.
- **A passive recorder**: commands from tool calls become candidates you can promote after the fact, without re-running them.
- **Provenance**: exit code, duration, environment parameters, dataset and artifact SHA-256 hashes, stdout/stderr tails.
- **SQL metrics**: a metric can declare `sql` + a CSV/TSV `dataset`; the value is computed into SQLite at run time and the dataset is attached automatically.
- **Reports**: a Markdown file with design, datasets, runs, comparison, embedded SVG charts, best runs and artifacts, hashed and recorded on the experiment.
- **A plain, git-friendly ledger** under `<project>/.experiments/`.

## Panel UX

The `shell.overlay` dialog has a docked-sidebar mode (fixed right, remembered in `localStorage`) and a floating mode. `POST /roots` resolves a project folder (`.experiments`) or ledger folder and remembers it; `GET /browse?dir=` lists subfolders; `GET /panel-request` lets `exp_open` ask the client to open/select a ledger and experiment. `POST /import` accepts either `path` or base64 `data` + `filename` (≤20 MB), writing a temporary file that is removed after import.

## Run one experiment

1. Create the experiment and declare what varies and what is measured:

   > Use `exp_define` with name "PID tuning", factors `["kp", "ki"]`, metrics `[{key: "overshoot", unit: "%", direction: "min"}, {key: "settling", unit: "s", direction: "min"}]`.

2. Run a command once per condition:

   > `exp_run experimentId="exp-…" command="python tune.py --kp {kp} --ki {ki}" params={kp: 1.2, ki: 0.3}`

   The script prints `EXP_METRICS: {"overshoot": 4.2, "settling": 0.8}` and both values become columns in the table.

3. Open **Experiments** in the sidebar footer, pick the experiment, click a row to see the command, metrics, artifact hashes and output tails.
4. In the compare block choose a factor to group by; the table and the bar chart show mean ± sd for each group.
5. Click a run to see its datasets (hash, rows × columns) and a diff against the previous run.
6. Click **Candidates** to see commands recorded from tool calls; press **Promote**, fill in optional params/metrics JSON and confirm to add it as a run without re-running it.
7. Click **Sweep** to start a background parameter sweep: command template, JSON grid, parallel/fail-fast, live progress and a stop button. Save the form as a **preset** (up to 10), load it back, and add a **schedule** (preset + interval in minutes) that the host runs while the app is open.
8. Click **Generate report** in the experiment header; the panel shows the report path, a copy button and an **Open** button that hands the file to the OS.
9. In the compare block use **Add baseline** to snapshot a run from the ledger as a named baseline (chips show each one); group means show Δ, a run's detail shows the vs-baseline diff and the report gains a Baselines section with one Δ table per baseline.
10. Tick 2–3 experiments in the left list (or add one from another project) and press **Compare experiments** for a group × experiment matrix; export it as CSV/Markdown, generate a comparison report, or reopen one from the archived list.
11. You can also ask the agent:

   > `exp_report experimentId="exp-…"`

   It writes `report.md` and `charts/<metric>.svg` files under the ledger and returns the path and SHA-256.

## Metrics sources

Later sources win:

1. a declared metric with `sql` + `dataset` (CSV/TSV table `data`),
2. `EXP_METRICS: {json}` on stdout (last line wins),
3. a `metrics.json` file in `$EXP_RUN_DIR`,
4. the `metrics` argument.

Parameters reach the command as `{key}` placeholders and `EXP_PARAM_<KEY>` environment variables.

A SQL metric looks like this:

```json
{ "key": "yield", "unit": "%", "direction": "max",
  "sql": "SELECT avg(pass) * 100 AS v FROM data",
  "dataset": "runs/bench.csv" }
```

The dataset is attached to the run's provenance automatically. A failing query does not fail the run: it is recorded in `metricErrors` and shown by `exp_show`.

## Sweeps and recorded commands

- `exp_sweep experimentId="exp-…" command="python tune.py --kp {kp} --ki {ki}" grid={kp: [0.8, 1.2, 1.8], ki: [0.2, 0.3]}` expands the grid, records every run and reports the best one. Add `dryRun: true` to preview, `maxParallel` up to 4, `failFast` to stop after a non-ok run. The panel's **Sweep** form starts the same job through `POST /sweep` and polls `/sweep/status`.
- `exp_presets action="save" name="quick" command="…" grid={…}` stores a reusable preset (10 per experiment); `exp_sweep experimentId="…" preset="quick"` runs it. The panel's Sweep form has a preset row to load or delete one.
- The plugin records commands from tool calls (bash, pwsh, MCP tools with a `command` argument) into a local ring buffer of 50. `exp_candidates` lists them; `exp_promote experimentId="exp-…" candidateId="cand-…" params={…} metrics={…}` turns one into a run without executing it again.

## Scheduled sweeps

`exp_schedule action="save" name="nightly" preset="quick" intervalMinutes=1440 retryLimit=2 retryDelayMs=60000 failureLimit=3` stores a schedule (up to 10 per experiment). While the desktop app is open the host checks due schedules every 30 seconds across remembered roots, starts the preset as a background sweep and records `lastRunAt`, `nextRunAt`, `lastStatus` and `lastJobId`. A failed run is retried up to `retryLimit` (0–5) with exponential backoff from `retryDelayMs` (10 s–1 h); success resets the counter. `failureLimit` (0–10) pauses the schedule after that many consecutive failures and raises a notification. `run` starts one immediately, `toggle` pauses/resumes (and resets the failure counter), `delete` removes it. The panel's Sweep form has a schedule row (retries, backoff and failure limit included) and per-schedule buttons.

When a job finishes, `finalizeScheduleJobs` appends a history entry (status, attempt, done/total, failed, duration, mean metrics; last 20) and pushes a notification (`notifications`, last 50). The panel draws a duration sparkline plus a metrics sparkline, shows success rate and average duration, polls `GET /notifications` every 20 seconds, and **View** opens the experiment + Sweep form (marking that notification read); `POST /notifications/read` clears one or all. Clicking a schedule name opens the detail view with a larger chart (duration or a history metric), a metric selector and the full history table. `GET /notifications/all` aggregates every remembered root (last 100) for the header's notification center, which filters by project/level/unread and can mark or resume the filtered set in bulk.

The detail view's **Generate report** posts `/schedule` with `action="report"`: `writeScheduleReport` writes `<ledger>/reports/schedule-<name>-<stamp>/report.md` (summary, history table, embedded `chart.svg`), archives the record in `experiment.scheduleReports` (last 20) and sets `schedule.lastReport`. `GET /schedule/reports?root=&experimentId=&scheduleId=` lists the archive.

Pause notifications carry `action: "resume-run"`; **Resume and run** posts `/schedule` with `action="resume-run"`, which re-enables the schedule, resets `failureCount`/`retryCount` and starts a job immediately.

## Search

`exp_search` scans one ledger's experiments and runs (optionally one experiment) with a text query over experiment/run/command/notes/params/metrics, condition lists (`paramFilters`, `metricFilters`; `op` is `eq`, `ne`, `gt`, `gte`, `lt`, `lte` or `contains`), `status`, `since` and a `limit` (default 20, cap 50). Results are newest-first, or ranked by `sortMetric` with `direction: min|max`. `GET /search?root=&q=&status=&experimentId=&limit=` backs the panel's search view.

## Reproducibility

Every `exp_run` stores a manifest: the substituted command, cwd, `git` state (commit/branch/dirty when the cwd is a repository), toolchain (node version/platform/arch) and an allow-listed environment (`EXP_*`, `CUDA_VISIBLE_DEVICES`, `OMP_NUM_THREADS`, `PYTHONHASHSEED`, `NODE_OPTIONS`). `exp_record` stores the same manifest with an empty command. `exp_show` prints it and the run detail displays git/toolchain/env.

`exp_reproduce experimentId runId confirm=true` reruns the exact recorded command for manifest runs (no second placeholder substitution) with the same params, cwd, recorded timeout and allow-listed manifest environment; legacy runs without a manifest get their stored template substituted with the recorded params. It preflights a missing cwd or script file, refuses with a clear error, and reports exit code + stderr tail when the rerun fails. Without `confirm` it prints the command, cwd, timeout, env keys and any preflight warning. The new run gets `reproducedFrom` and a fresh manifest. The panel's **Reproduce** button posts `/reproduce` after a confirmation prompt and is disabled for runs without a command.

## Statistics

`summarize` adds `se`, a two-sided 95% confidence interval and `smallSample` (n<3) to every group metric. `compareRuns` accepts `compareGroups: [a,b]` and returns `pairwise` for each metric with at least two values per side: mean difference, CI of the difference, Cohen's d (with a magnitude label) and a two-sided Welch p-value computed from the regularized incomplete beta. `formatComparison` prints the CI and a sample warning; reports add the CI and a warning line; the panel shows the interval and warning in its compare table.

## Lifecycle

`exp_update` edits name/description/tags/archived; tags are deduped, capped at 20 × 40 chars, and names must be unique. `exp_list` and `exp_search` exclude archived experiments unless `includeArchived`; `exp_update_run` edits a run's label/notes; `exp_delete_run confirm=true` removes the run record (the on-disk run directory is kept). Routes: `POST /update`, `POST /run/update`, `POST /run/delete`. The panel exposes these through the experiment edit form, the archive filter and the run detail's notes/delete controls.

## Sharing (HTML reports)

`exp_report format="html"` uses `lib/html-report.js` and `buildReport` to write `reports/<stamp>-<slug>/report.html`: a single self-contained file with inline CSS/SVG, summary cards, comparison table with CI + small-sample warning, charts, runs and datasets. `exp_report_compare format="html"` renders the multi-experiment payload (2–4 experiments) into `compare-<stamp>/report.html`. The panel's `HTML report` and compare `HTML` buttons post the same routes. Report records store `format`.

## Dataset registry and the data console

`ledger.datasets` holds `{id, name, path, sha256, bytes, source, createdAt}`; `exp_dataset path=…` hashes the file and assigns `ds-<sha-prefix>` (idempotent by SHA-256). A metric may declare `sql` plus `dataset` (path), `datasetId` or `dataConsole` (file name/path); `computeSqlMetrics` resolves ids through the registry and `dataConsole` at run time from `<DSH_HOME>/data-console/datasets.json` (`open` + `recent`), reporting not-found/ambiguous names. `exp_dataset dataConsole=true` imports copies with `source: "data-console"`. The data console's own `ds1` ids are per-process, so paths/names are the stable link.

## Ledger bundles

`exp_export` writes a `dsh-experiment-ledger-bundle` (version 1) with `{format, version, exportedAt, source, counts, experiments, datasets, compareReports, audit}`; the default path is `<root>/exports/ledger-<stamp>.json`. `format="zip"` writes a `dsh-experiment-ledger-package` zip (`ledger.json`, `manifest.json` with `bundleSha256` + Ed25519 `signature` over `bundleSha256+auditHead`, `audit` anchor, `summary.md`, `audit.ndjson` mirror, `runs/<id>/*.log`, `reports/**`, `datasets/<sha>/…`) via the zip reader/writer in `lib/zip.js` (deflate when smaller; datasets ≤30 MB each). `exp_import` accepts either format, verifies the manifest digest/signature and mirrored audit chain/head, checks `requireTrusted`, extracts packed datasets under `<root>/datasets/` and rewrites dataset ids/paths, reads at most 50 MB, and merges. `exp_trust_key` pins the local key, a package's embedded key or a PEM key; it supports expiry, revocation and rotation (`rotate=true` archives/revokes the old key). `exp_audit` reads/verifies the hash-chained append-only log. `dryRun` merges into a deep copy and returns counts without writing. Routes: `POST /export`, `POST /import`.

## Templates and batch runs

`exp_clone` copies factors/metrics/description/tags into a new experiment with no runs; `POST /clone` backs the panel's Clone button. `exp_batch` executes one command template over explicit `rows` sequentially (1–50), recording each run through `performRun`/`appendRun`, with `stopOnError` and per-run timeout; `exp_sweep` remains the background grid option.

## Conclusions

`exp_conclude` stores `experiment.conclusion = {text, status, decidedBy, role, decidedAt, updatedAt, history}` with `status` in `draft|approved|rejected`, history capped at 50. `exp_reviews` filters by status/reviewer; `exp_review` batch-decides up to 20. `GET /reviews` and `POST /review` back the panel's Reviews queue (per-row Approve/Reject, Approve all). `exp_show`, Markdown/HTML reports and search read the conclusion.

## Anchoring and print

`exp_anchor` records `{headHash,count,at}` in `$DSH_HOME/experiment-ledger/anchors.ndjson` and writes/carries it to an external file, a git commit (`audit-anchor.json`), or an HTTP POST. `exp_audit` verifies every anchor against `auditEntries[count-1].hash`; `exp_verify_anchor` reads the external copy back (file/git path/HTTP GET) and checks both the chain prefix and the local anchor record. `exp_report format="print"` writes `report-print.html` via `writeHtmlReport({print:true})` with `@media print` rules; no PDF library is bundled.

## Baselines

`exp_baseline experimentId="exp-new" baselineExperimentId="exp-old"` snapshots the latest run with metrics (or `baselineRunId`) into the experiment — metrics and params only. Add up to five named baselines; a same-named one is replaced. Clear one with `clear: true` plus `baselineId`/`name`, or all with `clear: true`.

The panel's compare block lists runs of the ledger as baseline candidates and shows a chip per baseline; the newest one drives the inline Δ and the run-detail diff. Reports add a Baselines section and one Δ table per baseline.

## Multi-experiment comparison

Tick 2–3 experiments in the side list and press **Compare experiments**. The route `GET /compare/experiments?root=&ids=&groupBy=` handles one root; `POST /compare` accepts refs `[{root, experimentId}]` so one table can mix projects. It intersects the declared factors of the selected experiments, runs `compareRuns` per experiment with the requested common grouping and returns a group × experiment matrix for one selected metric. With no common factor it compares whole experiments (`all runs`).

`POST /compare/export` writes the same matrix under `<ledger>/exports/` as CSV (numeric mean/sd/n columns) or Markdown; `POST /compare/report` writes `<ledger>/reports/compare-<stamp>/report.md` with one table per metric and records it in the destination ledger's `compareReports` archive (last 20, listed in the panel); the `open` routes hand a file to the OS. `exp_report_compare` writes the same report from the agent.

## Limitations

- Metrics are flat scalars (number or string); nested JSON is ignored.
- SQL metrics read CSV/TSV only (50 MB / 500k rows, one statement); Excel stays in the data console, which can export a CSV.
- Artifacts are hashed in place, not copied.
- `exp_run` executes one command; `exp_sweep` plans up to 100 runs and runs up to 4 at once.
- A baseline is a snapshot: later changes to the source run do not update it; set it again to refresh.
- Sweep presets are capped at 10 per experiment; exported comparisons stay under `<ledger>/exports/` and are not pruned.
- Schedules only fire while the desktop app is open; the host scans remembered roots every 30 seconds and keeps at most 10 schedules per experiment.
- Scheduled retries are capped at 5, with exponential backoff from 10 s to 1 h; each attempt is recorded in history.
- `failureLimit` is capped at 10; hitting it pauses the schedule, and a manual resume resets the failure counter.
- Schedule history keeps the last 20 jobs; ledger notifications keep the last 50 entries (the cross-project center shows the latest 100).
- Schedule reports are archived per experiment (last 20 records); the report files themselves are not pruned.
- Comparison reports are archived in the destination ledger (last 20 records); report files are not pruned.
- Multi-experiment comparison accepts 2–4 refs; the panel lists experiments from up to 20 remembered roots and mixes them in one table.
- `exp_search` scans one ledger in memory and returns at most 50 rows; manifests keep only the allow-listed environment (no full environment or secrets).
- Conclusions are free text with a local status/history; approve/reject is not authenticated or role-enforced.
- `dataConsole` metrics resolve open/recent files at run time but still load the CSV/TSV into the ledger's SQLite, not the data-console sidecar.
- Pairwise statistics need at least two values per group; the p-value uses a small-sample t approximation.
- Archived experiments are hidden by default; deleting a run keeps its on-disk directory.
- Data-console import copies paths/hashes, not live session ids; a file moved after registration must be re-registered.
- HTML reports are snapshots with no external assets and no embedded ledger.
- Ledger bundles keep absolute run/dataset paths, cap imports at 50 MB and merge only (no replace mode).
- Zip packages deflate entries, include report files, `summary.md` and referenced datasets, and verify `bundleSha256` + Ed25519 signature on import.
- The package signature is self-signed; `exp_trust_key` + `requireTrusted=true` pin keys and honor expiry/revocation-at-signing-time, but there is no CA/account identity. Decision signatures bind a decision to a local key, not to an authenticated person.
- Key loss/rotation does not invalidate old signatures (public keys and signedAt are embedded); revocation affects signatures made after the revocation time.
- The audit log is hash-chained but local; a writer can rewrite the whole chain, so it is tamper-evident rather than tamper-proof. Packages embed a mirror and sign the audit head, so recipients can detect a broken/edited sender chain.
- `exp_batch` is sequential and limited to 50 rows; `exp_clone` copies definitions only, not runs or baselines.
- The recorder stores no output, environment variables or exit codes — only tool, command, cwd, status and duration.
- Opening a report uses the OS default application (Explorer/Finder/`xdg-open`), so it only works in the desktop app.
- The ledger is local; nothing is uploaded.

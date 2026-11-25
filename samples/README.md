# Sample files

Small files to try the ledger with. All paths are relative to the workspace root; run the commands from there (the plugin's `exp_run` uses the session cwd).

## 1. Importable bundle

`bundles/pid-tuning.bundle.json` contains one experiment, five recorded runs and a draft conclusion. Paths inside the bundle are relative (`cwd: "."`), so it is safe to share.

Register the CSV separately if you want SQL metrics:

```text
exp_import path="dsh-experiment-ledger/samples/bundles/pid-tuning.bundle.json"
exp_list
exp_compare experimentId="exp-…"
exp_report experimentId="exp-…" format="html"
```

`exp_import` prints the experiment id; use it in the following commands. The bundle is a normal JSON bundle (no signature) and keeps local conflicts by default.

## 2. CSV: PID runs

`datasets/pid-runs.csv` — columns `run,kp,ki,overshoot,settling,square_error`.

```text
exp_dataset path="dsh-experiment-ledger/samples/datasets/pid-runs.csv" name="PID sample"
```

Register it, then define a SQL metric (replace `ds-…` with the id printed by `exp_dataset`):

```text
exp_define name="PID SQL" factors=["kp"] metrics=[{"key":"avg_overshoot","sql":"select avg(overshoot) as value from data","datasetId":"ds-…"}]
exp_run experimentId="exp-…" command="node dsh-experiment-ledger/samples/commands/tune.mjs --kp {kp} --ki 0.2" params={"kp":1.5}
```

The SQL must return one numeric column named `value`.

## 3. CSV: latency table

`datasets/latency.csv` — columns `run,backend,p50_ms,p99_ms,errors`.

```text
exp_dataset path="dsh-experiment-ledger/samples/datasets/latency.csv" name="Latency sample"
exp_define name="Latency" factors=["backend"] metrics=["mean_p50_ms","errors"]
exp_run experimentId="exp-…" command="node dsh-experiment-ledger/samples/commands/score.mjs dsh-experiment-ledger/samples/datasets/latency.csv"
```

`score.mjs` reads the CSV and emits `EXP_METRICS: {"mean_p50_ms":40.33,"errors":4}`.

## 4. TSV: sensor readings

`datasets/sensor-readings.tsv` — tab-separated `step,channel,value`.

```text
exp_dataset path="dsh-experiment-ledger/samples/datasets/sensor-readings.tsv" name="Sensor sample"
exp_define name="Sensor" factors=["channel"] metrics=[{"key":"avg","sql":"select avg(value) as value from data","datasetId":"ds-…"}]
```

## 5. Runnable scripts

- `commands/tune.mjs` — deterministic kp/ki → metrics; accepts `--kp` and `--ki`.
- `commands/score.mjs` — reads a CSV and prints mean p50 + errors.

They need no dependencies; the bundled Node runtime works:

```text
node dsh-experiment-ledger/samples/commands/tune.mjs --kp 1.5 --ki 0.3
```

## 6. Data console

Open `datasets/pid-runs.csv` in the DSH data console, then:

```text
exp_dataset dataConsole=true
```

The plugin links the open dataset by file name/path; the data-console id (`ds1`, …) is per process and is not stored directly.

## Notes

- The bundle uses relative paths and no machine-specific dataset entry; register the CSV with `exp_dataset` if you need it.
- `exp_run` executes commands with your permissions; inspect `commands/*.mjs` before running.
- The CSV/TSV files are ordinary UTF-8 tables — no plugin-specific format.

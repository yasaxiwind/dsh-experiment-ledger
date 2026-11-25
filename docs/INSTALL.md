# Install and operations

Preview version `0.35.0-preview.1`.

## Requirements

- DeepSeek Harness `>= 0.2.2-rc.5` (Desktop or Web).
- No runtime dependencies, no network calls, no telemetry.
- Node.js is only needed to run the plugin's own tests (bundled runtime works).

## Install from this workspace

1. Open **Settings → Plugins → + Add plugin**.
2. Select the folder `dsh-experiment-ledger` (or paste its absolute path).
3. **Install**, then enable the `dsh-experiment-ledger` bundle.
4. Reload the page. A **Ledger** action appears in the sidebar footer and the panel opens from there.

The plugin registers 33 tools with the `exp_` prefix and a `Ledger` panel; the host bundle is `cordis.patch.yml` and the client entry is `client.js`.

## Panel

- Footer action opens the panel; **⇥/⇤** docks it to the right sidebar (remembered).
- **打开台账…** opens the folder picker: browse directories, open a project folder (its `.experiments` is found) or a ledger folder, or create a new ledger there.
- **导入** opens a drag-and-drop/file picker for `.json`/`.zip` bundles (≤20 MB).
- `exp_open` asks the panel to open in the sidebar on a ledger/experiment.

## First run

```text
exp_define name="PID tuning" factors=["kp","ki"] metrics=["overshoot","settling"]
exp_run experimentId="exp-…" command="python tune.py --kp {kp} --ki {ki}" params={"kp":1.2,"ki":0.3}
exp_show experimentId="exp-…"
exp_compare experimentId="exp-…"
exp_report experimentId="exp-…" format="html"
```

Runs are written to `<cwd>/.experiments/ledger.json` and `runs/<id>/`; the panel defaults to the session cwd. Set `root` on a tool to use another ledger directory.

## Where state lives

| Path | Contents |
|---|---|
| `<root>/.experiments/` | ledger, run dirs, reports, exports |
| `$DSH_HOME/experiment-ledger/keys/` | local Ed25519 signing key (mode 600) |
| `$DSH_HOME/experiment-ledger/trusted-keys.json` | pinned signing keys |
| `$DSH_HOME/experiment-ledger/audit.ndjson` | hash-chained audit log |
| `$DSH_HOME/experiment-ledger/anchors.ndjson` | external anchor records |
| `<DSH_HOME>/data-console/datasets.json` | data-console datasets linked with `dataConsole` |

`$DSH_HOME` defaults to the profile home (`C:\Users\<you>\.dsh` on Windows). Back up `.experiments` to keep results; back up `experiment-ledger/` to keep keys, trust, audit and anchors.

## Upgrade / uninstall

- Upgrade: replace the folder's files, bump `package.json`, then toggle the bundle off/on in Settings (or reload).
- Uninstall: disable/remove the bundle in Settings. Data under `.experiments` and `$DSH_HOME/experiment-ledger` is left untouched.

## Sharing

- `exp_export format="zip"` produces a signed package (ledger + logs + reports + datasets + audit mirror).
- `exp_import path="…"` verifies integrity/signature/audit; add `requireTrusted=true` to require a pinned key.
- Pin keys with `exp_trust_key path="package.zip"`; rotate with `rotate=true`, revoke with `revoke=<keyId>`.
- `exp_anchor mode="git"` commits the audit head; `exp_verify_anchor` reads it back.

## Security and limits

- The signing key is local and self-signed; pinning is manual TOFU, not a CA/account identity.
- Audit logs and anchors are tamper-evident, not tamper-proof; a local writer can rewrite them.
- `format="print"` is HTML for browser Print → Save as PDF, not a generated PDF.
- Commands run with the same permissions as the session; there is no sandbox. Use `confirm=true` for reproduction and review commands before running them.

## Troubleshooting

| Symptom | Check |
|---|---|
| Panel missing | bundle enabled and page reloaded; client build has no syntax errors (`node --check client.js`) |
| Tool not found | bundle loaded after install; profile has one bundle entry |
| `SQL metrics need node:sqlite` | runtime built with SQLite; or use recorded metrics |
| Package rejected | signature/audit head mismatch or untrusted key; run `exp_audit`, `exp_trust_key list` |
| Anchors invalid | external copy or chain changed; compare with `exp_verify_anchor` |

## Tests

```powershell
node --test test/ledger.test.mjs test/client.smoke.test.mjs test/tools.test.mjs test/compare.test.mjs `
  test/features.test.mjs test/sweep.test.mjs test/sql.test.mjs test/routes.test.mjs
```

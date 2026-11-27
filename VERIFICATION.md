# Verification — dsh-experiment-ledger 0.35.0-preview.2

Date: 2026-11-27 · Host: DeepSeek Harness `0.2.2-rc.5` (Desktop, profile `desktop`)

## Automated tests

`node --test test/ledger.test.mjs test/client.smoke.test.mjs test/tools.test.mjs test/compare.test.mjs test/features.test.mjs test/sweep.test.mjs test/sql.test.mjs test/routes.test.mjs` — **79/79 pass**.

| Area | What is covered |
|---|---|
| admission | every panel route calls `ctx.connection.requestRejection(req)` before reading the body; a mocked 403 stops the route with 403 |
| panel UX | `/roots` opens/creates a ledger folder, `/browse` lists folders, upload import via base64, `/panel-request` from `exp_open` |
| conclusion UI | in-panel draft/approve/reject modal (no `window.prompt`), editable signer name/role, decision saved through `/conclude` |
| confirmations | in-panel confirm modal for run delete/reproduce; no native `prompt`/`confirm` calls remain |
| delete UI | inline × + confirm; `/experiment/delete` removes only the ledger entry (`filesKept:true`) |
| dock layout | sidebar starts below the DSH title bar and pushes `_centerCol` via `margin-right` (data-console approach), width `clamp(320px, 36vw, 380px)` |
| import | JSON/zip upload path; temp file removed after import |
| client | footer/overlay registration, empty/populated render, new dialog components compile |
| earlier features | anchors, audit mirror, key lifecycle, signatures, reviews, datasets, stats, routes |

## Live checks

| Check | Result |
|---|---|
| `GET /plugin-experiment-ledger/panel-request` | 200 `{ok:true,request:null}` |
| `GET …/browse?dir=<workspace>` | 200, 25 folders listed |
| `POST …/roots` with `create:true` | 200, `root=<tmp>/.experiments`, `created:true` |
| `POST …/import` with base64 bundle | 200, `experiments +1, runs +5`, temp upload path |
| existing render | multi-compare, run detail, candidates, report |

## What changed for the reported problems

- **Import button did nothing**: it called `window.prompt`, which is unavailable/ignored in the desktop webview. It now opens an in-panel modal with a file picker and drag/drop; bytes are POSTed as base64 and imported host-side.
- **Conclusion button did nothing**: same prompt problem; it now opens an in-panel conclusion editor with draft/approve/reject. The editor and Reviews view expose editable signer name/role (previously hard-coded `panel`/`reviewer`); the signature key remains the local Ed25519 key.
- **Experiments could not be removed from the UI**: each left-list row has × → inline "delete?" confirmation. `POST /experiment/delete` only removes the ledger entry; run files and datasets stay on disk.
- **Only `exp-ledger-demo` visible**: the root dropdown only showed remembered roots. The header now has **打开台账…**, a folder browser that accepts a project folder (finds `.experiments`) or a ledger folder, remembers it, and can create a ledger.
- **AI should open the sidebar directly**: new `exp_open` tool sets a panel request; the client polls `/panel-request` every 2 s, docks the sidebar, selects the requested root/experiment.
- **Sidebar layout**: **⇥/⇤** docks/floats the panel; docked mode pushes `_centerCol` right margin (data-console approach), starts below the DSH title bar, and uses `clamp(320px, 36vw, 380px)`.

## Release artefacts (0.35.0-preview.2)

| Artefact | Result |
|---|---|
| test suite | 79/79 pass |
| tarball | `dsh-experiment-ledger-0.35.0-preview.2.tgz`, 45 entries |
| folder zip | `dsh-experiment-ledger-0.35.0-preview.2.zip` |
| checksums | `SHA256SUMS.txt` (tgz, zip, notes, checklist) |
| npm | `0.35.0-preview.2`; registry SHA-1 `64088781853b88461a9c3c16a2b1b3a31007486b` matches local |
| clean-room | extracted registry tarball: 33 tools, 40 routes, sample import, run, report, 2 client slots |
| manual UI | **not fully re-run**; see `docs/PREVIEW_CHECKLIST.md` |

The clean-room harness uses an isolated `DSH_HOME` and packed files; it is not an actual second DSH profile install.

## Repository hygiene

Checked on 2026-11-27:

- 57 tracked files, all expected plugin, docs, test, sample and workflow files.
- No `.env`, `.npmrc`, private keys, logs, cookies, release tarballs, `.experiments`, `node_modules` or browser screenshots in the tree.
- No tokens, passwords, local home/workspace absolute paths, usernames or conversation text in the current tree or the 9-commit history.
- GitHub secret scanning reports 0 alerts.
- Both release tarballs and both folder zips (preview.1 and preview.2) were downloaded and scanned; no sensitive strings found.
- Screenshots use synthetic sample data; the DSH sidebar/session list, workspace label and user name were hidden.
- `.gitignore` now also covers `.env*`, `.npmrc`, `*.pem`, `*.key`, `*.secret`, `*.log` and `cookies*.txt`.

## Not verified

- **Visual browser check**: release screenshots were captured from an authenticated Playwright session; the dock, import and conclusion panels were exercised, but the native folder picker and actual drag/drop upload were not. Docking uses DSH's `data-windows-titlebar`/`--dsh-windows-titlebar-height` (CSS fallback) for the top inset and mirrors `dsh-data-console` by setting `margin-right` on `_centerCol`; the class selector is DSH-internal and could change between DSH versions.
- **Native folder picker**: uses the plugin's own directory browser (`/browse`), not an OS dialog; the path field accepts any absolute path.
- Uploads are capped at **20 MB**; larger packages need the agent path (`exp_import path=…`).
- `exp_open` needs a client mounted (footer action); a closed desktop window cannot be opened remotely.
- Anchors/git/http, trust TOFU, print-view limits as before.

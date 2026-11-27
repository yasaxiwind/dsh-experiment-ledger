# Preview checklist — 0.35.0-preview.2

Status as of 2026-11-27. `[x]` = done in this environment; `[ ]` = needs a human pass.

## Automated

- [x] 79/79 tests (`node --test …`).
- [x] Host/client syntax checks.
- [x] Route tests: roots/browse/upload import/panel request/experiment delete/run delete/report.
- [x] Fresh-home clean-room harness against the packaged tarball: **33 tools, 40 routes, sample import, live run, HTML report, 2 client slots**.
- [x] Packaged artifact smoke: extracted `package/` loads, runs a command from `samples/commands/tune.mjs`, and writes a report.
- [x] Package contains `index.js`, `lib/`, `client.js`, `cordis.patch.yml`, `locale/`, `docs/`, `samples/`, `LICENSE`, `CHANGELOG.md`, `README.md`.

## Package

- [x] Version `0.35.0-preview.2`, SemVer prerelease.
- [x] `private` removed, `publishConfig.tag = preview`.
- [x] MIT `LICENSE` file.
- [x] Repository/homepage/bugs set to `github.com/yasaxiwind/dsh-experiment-ledger`.
- [x] npm name `dsh-experiment-ledger` returned 404 (unclaimed) on 2026-11-25; recheck at publish time.
- [x] npm publish — **published** `dsh-experiment-ledger@0.35.0-preview.2`; `latest` and `preview` both point at it; registry tarball SHA-1 matches local (`64088781…`).
- [x] Tarball + folder zip + SHA-256 generated under `releases/preview-0.35.0-preview.2/`.
- [x] Panel routes call `ctx.connection.requestRejection(req)`; route test rejects an admission with 403.
- [x] Screenshots captured from an authenticated Chrome session with the DSH sidebar/session list, workspace label and user name hidden; synthetic data only.
- [ ] Actual fresh DSH profile install (requires a separate profile/app; clean-room harness is the substitute in this environment).

## Manual UI pass (needs human)

- [ ] Fresh profile install + page reload shows **Ledger**.
- [ ] Footer opens panel; **⇥** docks, **⇤** floats; dock starts below title bar.
- [ ] Docked mode shrinks the session column instead of covering it; reload remembers the mode.
- [ ] **打开台账…** browses folders, opens a project with `.experiments`, creates a new ledger.
- [ ] Root dropdown switches between two ledgers.
- [ ] **导入** accepts drag/drop and the file picker for `.json`/`.zip`; success/error notice appears.
- [ ] **结论** opens the editor; draft/approve/reject; signer name/role persists; no native prompt.
- [ ] Left row **×** → inline delete confirmation; experiment disappears, files stay.
- [ ] **Reviews** queue approves/rejects with the entered signer name/role.
- [ ] Run detail: reproduce and delete show the in-panel confirm (no native confirm).
- [ ] Dark/light theme, narrow window, long paths, Chinese text.
- [ ] Import a signed `.zip`, then `requireTrusted` refusal/success as documented.

## Known blockers before npm publish

1. Final manual UI pass above.
2. Re-confirm the npm name immediately before publishing.
3. Actual fresh-profile install once; the clean-room harness covers package loading, not the DSH profile/UI install path.

## Recommendation

The artifact is ready for **local preview / GitHub Release**. Do not tag 1.0 yet; use `0.35.0-preview.2`, keep the preview tag, and collect feedback for one or two rounds.


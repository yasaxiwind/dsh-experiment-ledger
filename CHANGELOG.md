# Changelog

## 0.35.0-preview.2

- Security: every panel HTTP route now calls the DSH host's `connection.requestRejection(req)` before reading the body. Cross-origin requests and clients without DSH's authenticated live browser peer are rejected with 401/403; the plugin's own package-header and same-origin checks remain as defense in depth.
- Added `connection` to the plugin's injected services and a route test that verifies a rejected admission returns 403.
- Docs: record the DSH admission fence and the preview.2 release.

## 0.35.0-preview.1

- First public preview: run ledger, reproducibility manifests, sweeps/schedules, comparison/CI, signed packages/decisions, trusted-key lifecycle, audit chain/anchors, dataset SQL metrics, dockable sidebar with folder picker/import/delete.
- Package metadata: MIT LICENSE, preview publish tag, release notes/checklist.

## 0.34.5

- Replaced the remaining `window.confirm` paths (run delete, reproduce) with the in-panel confirm dialog; removed the unused prompt-based import action. No browser-native prompt/confirm remains in the panel.

## 0.34.4

- Reviewer identity is editable in the conclusion and Reviews UIs (name + role), persisted in `localStorage`; decisions use those fields instead of hard-coded `panel`/`reviewer`. The Ed25519 key is still the local profile key, and the panel shows the signing key id.

## 0.34.3

- Conclusion button opens an in-panel text/approve/reject modal (no `window.prompt`).
- Left experiment list has an inline × → confirm delete; removes only the ledger entry, keeps run files/datasets (`/experiment/delete`).

## 0.34.2

- Dock layout now pushes the session center column (like `dsh-data-console`) instead of overlaying it; width recalculates on window resize and is restored when undocking/closing.

## 0.34.1

- Dock fix: the sidebar starts below the DSH title bar (no more unclickable top row) and uses a narrower `clamp(320px, 36vw, 380px)` width so it no longer covers half the session.

## 0.34.0

- Panel UX: dockable right sidebar, folder picker/new-ledger flow, drag-and-drop/file import (no `window.prompt`), `exp_open` for agent-opened sidebar, `/roots`, `/browse`, `/panel-request` and upload import.

## 0.33.1

- `samples/`: importable PID bundle, PID/latency CSV, sensor TSV, runnable `tune.mjs`/`score.mjs`, usage guide.

## 0.33.0

- `exp_verify_anchor`: read an external file/git/HTTP anchor back and verify it against the local chain/registry.
- Install/operations guide (`docs/INSTALL.md`), release notes and final verification.

## 0.32.0

- `exp_anchor` file/git/HTTP anchoring; local anchor records.
- `exp_report format="print"`: print-optimised HTML (`report-print.html`).

## 0.31.0

- Bundle audit anchor (`headHash`, `count`); package signature covers `bundleSha256 + auditHead`.
- `audit.ndjson` mirror in packages, verified on import.

## 0.30.0

- Trusted-key expiry/revocation/rotation; `signedAt` on signatures.
- Append-only hash-chained audit log (`exp_audit`).

## 0.29.0

- Trusted key registry (`exp_trust_key`), `requireTrusted` imports.
- Signed approve/reject decisions.

## 0.28.0

- Ed25519 package signatures; reviewer identity fields.
- CI whiskers and multi-metric small multiples.

## 0.27.0

- Review queue, batch approve, dataset snapshot packages.

## 0.26.0

- HTML reports, cross-project comparison, portable package datasets.

## 0.25.0

- Sweep presets, schedules, retries, notification center.

## 0.24.0

- Candidates/promote, run lifecycle, search.

## 0.23.0

- Baselines, comparison reports, charts.

## 0.21.0–0.22.0

- SQL metrics, data-console links, dataset registry, zip bundles.

## 0.20.0

- Agent memory: reproducibility manifests, `exp_reproduce`, artifact hashes.

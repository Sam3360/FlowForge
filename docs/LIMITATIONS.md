# Known limitations

- The 0.2.0 Windows sidecar and installer were not built by the development environment (Linux). Build and test them on Windows (`docs/RELEASE.md`).
- Run history is in memory only (cleared when the app closes) and keeps the last 50 runs; per-run logs are capped at 500 lines.
- CI runs Linux only; there is no automated Windows test.
- UI never inspected in a real browser/WebView; layout/styling issues are likely. Only jsdom tests exist.
- No loops, no node types beyond the six; one input edge per port; one run at a time.
- Fail-fast: a failed node aborts the run.
- Permissions are path validation, not a sandbox (see SECURITY.md).
- The preview and the apply run are separate runs; files can change in between (the apply plan is recomputed and collisions re-checked).
- Cancellation granularity: between nodes and between files.
- Recovery restores the single most recent unsaved document.
- Undo does not cover run state; selection of a viewed past run is cleared when you start a new run; autosave to the real file is not done (recovery copy only).
- Unit tests that need POSIX permissions/symlinks are skipped on Windows; the inaccessible-directory test skips when run as root.
- Next priorities: build/verify on Windows, real WebView visual pass, signing, loop/iterate nodes, per-branch error handling, UI e2e tests (Playwright/tauri-driver).

# Known limitations

- Tauri shell, Windows sidecar, installer, and CI Windows job: **unverified** (never run).
- UI never inspected in a real browser/WebView; layout/styling issues are likely. Only jsdom tests exist.
- No loops, no node types beyond the six; one input edge per port; one run at a time.
- Fail-fast: a failed node aborts the run.
- Permissions are path validation, not a sandbox (see SECURITY.md).
- The preview and the apply run are separate runs; files can change in between (the apply plan is recomputed and collisions re-checked).
- Cancellation granularity: between nodes and between files.
- Recovery restores the single most recent unsaved document.
- Undo does not cover run state; autosave to the real file is not done (recovery copy only).
- Unit tests that need POSIX permissions/symlinks are skipped on Windows; the inaccessible-directory test skips when run as root.
- Next priorities: build/verify on Windows, real WebView visual pass, signing, loop/iterate nodes, per-branch error handling, UI e2e tests (Playwright/tauri-driver).

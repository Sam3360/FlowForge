# Security model

**What is enforced (and tested)**
- The engine validates every workflow; the frontend is not a boundary.
- **Approved folders:** each run carries `allowedRoots` chosen by the user in the Run dialog (the folders named in the workflow). They come from the host request, never from the workflow file, so an imported workflow cannot grant itself access. Every path config is checked in preflight and again at execution; paths are resolved with `realpath` before the containment check, so symlinks that escape the roots are rejected. Drive roots/filesystem root cannot be approved. A not-yet-existing folder can be approved only if its parent exists.
- **Confirmation:** a node configured to apply changes is refused (`CONFIRMATION_REQUIRED`) unless the host lists it in `approvedNodes`; the app only does so after a preview and an explicit tick-box. `dryRun:true` forces preview everywhere.
- **No overwrite:** moves never replace existing files, even in a race.
- **No code execution:** no eval/exec/shell; Condition uses a fixed operator set.
- Directory symlinks (and Windows junctions) are not followed when listing; symlink files are never moved.
- Bounded input: 4 MiB protocol lines, workflow size limits, bounded log/event previews, file contents never read.
- The webview has no shell permission; the sidecar is spawned by Rust only. File commands accept only `.json` paths.

**Not guaranteed**
- This is **not a sandbox**: the engine runs with your user's full rights; the roots check is in-process path validation, not OS isolation. Time-of-check/time-of-use races on directories (symlink swapped after validation) are not fully eliminated.
- Cancellation cannot undo moves already done; a single file operation in flight completes.
- Windows-specific behaviour (junctions, hidden attribute, `os.link` on non-NTFS volumes with copy fallback) is coded but **untested on Windows**.
- Installer is unsigned (SmartScreen will warn).

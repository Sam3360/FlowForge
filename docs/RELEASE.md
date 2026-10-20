# Build and release

## Linux/WSL development (no installer)
`engine`: `pip install -e ".[dev]" && pytest`. `app`: `npm ci && npm run typecheck && npm test && npm run build`.
Regenerate shared definitions after changing nodes: `python -m flowforge_engine.export_definitions ../shared/node-definitions.json`.

## Windows installer (must run on Windows; do not use a Linux sidecar)
Prereqs: Python 3.10+, Node 20+, Rust (MSVC toolchain), WebView2 (present on Windows 10/11).
```powershell
cd engine; pip install -e ".[dev]"; python build_sidecar.py
python smoke_sidecar.py ..\app\src-tauri\binaries\flowforge-engine-x86_64-pc-windows-msvc.exe
cd ..\app; npm ci; npx tauri build
# -> src-tauri\target\release\bundle\nsis\FlowForge_0.1.0_x64-setup.exe
```
CI (`.github/workflows/ci.yml`) does the same on `windows-latest` with no secrets and uploads the unsigned installer. Commit `src-tauri/Cargo.lock` after the first successful build.
Version: keep `app/package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `engine/pyproject.toml` and `ENGINE_VERSION` in sync.
Data locations: workflows are wherever the user saves them; settings in the WebView's local storage and the recovery copy in the app data dir (`%APPDATA%\dev.flowforge.desktop`), all outside the install dir. Tauri's NSIS uninstaller only removes app data if the user ticks the option.

## Release checklist (tick only what was actually done on Windows)
- [ ] CI green (engine + frontend on Windows and Linux)
- [ ] Sidecar built on Windows; `smoke_sidecar.py` passes
- [ ] `tauri build` produces installer; version/metadata correct
- [ ] Install on a clean Windows VM with **no** Python/Node/Rust; app launches; engine starts (no banner)
- [ ] Organize Downloads example: preview, apply, cancel, collision, missing folder
- [ ] Paths with spaces and non-ASCII characters, incl. a OneDrive-redirected folder
- [ ] Offline: disconnect network, repeat the example
- [ ] Close while running: no orphan `flowforge-engine.exe` in Task Manager
- [ ] Kill the engine process mid-run: app shows error, Retry works
- [ ] Unsaved-changes prompt on New/Open/close; recovery after force-kill
- [ ] Directory junction inside a listed folder is skipped
- [ ] Uninstall keeps user workflows
- [ ] Code signing (not configured) / SmartScreen behaviour reviewed

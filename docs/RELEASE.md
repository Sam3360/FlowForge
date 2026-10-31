# Build and release

## Linux/WSL development (no installer)
`engine`: `pip install -e ".[dev]" && pytest`. `app`: `npm ci && npm run typecheck && npm test && npm run build`.
Regenerate shared definitions after changing nodes: `python -m flowforge_engine.export_definitions ../shared/node-definitions.json`.

## Windows installer (manual, on a Windows PC)
CI does **not** build the installer (no Windows runners are used). Prereqs: Python 3.10+ (on PATH as `python`), Node 20+, Rust MSVC toolchain, WebView2 (included in Windows 10/11).

Windows CMD, from the repository root:
```bat
cd engine
python -m pip install -e ".[dev]"
python -m pytest
python build_sidecar.py
python smoke_sidecar.py ..\app\src-tauri\binaries\flowforge-engine-x86_64-pc-windows-msvc.exe
cd ..\app
set FLOWFORGE_PYTHON=python
npm ci
npm run typecheck
npm test
npm run build
npx tauri build
```
Expected installer: `app\src-tauri\target\release\bundle\nsis\FlowForge_0.2.0_x64-setup.exe` (unsigned). The sidecar must be named `flowforge-engine-x86_64-pc-windows-msvc.exe` (`build_sidecar.py` takes the target from `rustc -vV`); a Linux sidecar will not work.
Quick dev run without installing: `cd app && npx tauri dev` (after building the sidecar).

Version: keep `app/package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `engine/pyproject.toml` and `ENGINE_VERSION` in sync.
Data locations: workflows are wherever the user saves them; settings in the WebView's local storage and the recovery copy in the app data dir (`%APPDATA%\dev.flowforge.desktop`), all outside the install dir. Tauri's NSIS uninstaller only removes app data if the user ticks the option.

## Release checklist (tick only what was actually done on Windows)
- [ ] CI green (Linux) and the Windows commands above all pass locally
- [ ] Sidecar built on Windows; `smoke_sidecar.py` passes
- [ ] `tauri build` produces installer; version/metadata correct
- [ ] Install on a clean Windows VM with **no** Python/Node/Rust; app launches; engine starts (no banner)
- [ ] Organize Downloads example: preview, apply, cancel, collision, missing folder
- [ ] 0.2.0: Validate shows Problems with node navigation; History lists runs and past runs can be inspected and left with *Back to live*; failed run shows the failure summary; duplicate/delete/Undo behave; open a v0.1.0 workflow file
- [ ] Paths with spaces and non-ASCII characters, incl. a OneDrive-redirected folder
- [ ] Offline: disconnect network, repeat the example
- [ ] Close while running: no orphan `flowforge-engine.exe` in Task Manager
- [ ] Kill the engine process mid-run: app shows error, Retry works
- [ ] Unsaved-changes prompt on New/Open/close; recovery after force-kill
- [ ] Directory junction inside a listed folder is skipped
- [ ] Uninstall keeps user workflows
- [ ] Code signing (not configured) / SmartScreen behaviour reviewed

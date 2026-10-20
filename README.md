# FlowForge (working name)

A local-first visual automation builder for Windows. Drag nodes onto a canvas, connect them, and run the workflow on your own machine: no account, no server, no internet. The name is configurable (`VITE_PRODUCT_NAME`, `productName` in `app/src-tauri/tauri.conf.json`).

**Stack:** Tauri 2 + React + strict TypeScript + Vite + React Flow; Python execution engine shipped as a PyInstaller sidecar; NDJSON over stdin/stdout.

## Status (read this first)

| Area | State |
|---|---|
| Python engine, 6 nodes, protocol | Implemented, 76 tests passing on Linux |
| React editor, inspector, execution panel | Implemented; 37 tests pass (jsdom, incl. real-engine integration) |
| Tauri Rust shell, installer config, CI | **Written but never compiled or run** (no Rust/Windows in the dev environment) |
| Windows sidecar `.exe` / NSIS installer | **Not built, not tested.** CI job `windows-installer` is configured to do it |
| Visual check of the UI in a real browser/WebView | **Not done** (only jsdom) |

## Quick start (Linux/WSL/macOS dev, no Rust needed)

```bash
cd engine && python -m pip install -e ".[dev]" && python -m pytest      # engine tests
cd ../app && npm ci && npm run typecheck && npm test                      # frontend tests (spawns the real engine; needs python3 on PATH, or FLOWFORGE_PYTHON)
python scripts/make_demo.py                                               # throw-away demo folder + ready-to-run workflow (from repo root)
```

## Running the desktop app (needs Rust + platform Tauri prerequisites)

```bash
cd engine && python build_sidecar.py        # builds the sidecar for THIS OS into app/src-tauri/binaries/
cd ../app && npm ci && npx tauri dev
```

## Windows installer

Must be done on Windows (PyInstaller does not cross-compile). See `docs/RELEASE.md`. Short version: `python build_sidecar.py`, `python smoke_sidecar.py <exe>`, then `npx tauri build` -> `src-tauri/target/release/bundle/nsis/*.exe`. Output is unsigned.

## Using it

1. Settings menu -> **Open "Organize Downloads" example** (or build your own).
2. Pick the folders in **List Files** and **Move File** (Inspector -> Browse).
3. **Validate**, then **Run**. The dialog lists the only folders the run may touch. By default Move File is a *preview*: nothing changes, and the Execution panel / Inspector show every planned move.
4. To really move files, turn off "Preview only" in Move File, Run, tick the acknowledgement, and choose **Run and apply changes**.
5. Select any node (canvas or Execution panel) -> Inspector **Execution** tab for status, duration, inputs, outputs, errors, branch taken.

## Docs

- `docs/ARCHITECTURE.md` - layout and design decisions
- `docs/WORKFLOW_FORMAT.md` - versioned JSON schema (v1)
- `docs/PROTOCOL.md` - NDJSON protocol and events
- `docs/NODES.md` - node reference and **how to add a node**
- `docs/SECURITY.md` - permission model and limits
- `docs/RELEASE.md` - build, release checklist
- `docs/LIMITATIONS.md`, `CHANGELOG.md`

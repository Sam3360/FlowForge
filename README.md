# FlowForge (working name)

A local-first visual automation builder for Windows. Drag nodes onto a canvas, connect them, and run the workflow on your own machine: no account, no server, no internet. The name is configurable (`VITE_PRODUCT_NAME`, `productName` in `app/src-tauri/tauri.conf.json`).

**Stack:** Tauri 2 + React + strict TypeScript + Vite + React Flow; Python execution engine shipped as a PyInstaller sidecar; NDJSON over stdin/stdout.

## Status (v0.2.0)

v0.1.0 shipped a working Windows installer. v0.2.0 is a debugging/usability release; see `CHANGELOG.md`.

| Area | State |
|---|---|
| Python engine, 6 nodes, protocol | 88 tests passing on Linux (1 skipped when run as root) |
| React editor, inspector, panels | 59 tests pass (jsdom, incl. real-engine integration and a multi-run App flow) |
| Linux sidecar build + smoke test | Run and passing (proves the packaging script, **not** the Windows build) |
| Windows sidecar `.exe` and NSIS installer for 0.2.0 | **Not built by this change.** Build locally on Windows (`docs/RELEASE.md`) |
| CI | Linux only. **No Windows runners are used**; the installer is built manually |
| Visual check of the UI in a real WebView | Not done in the dev environment (jsdom only) |

## What's new in 0.2.0

- **Run history** (bottom panel, *History* tab): finished runs of this session with result, start time, duration, the node that failed and its error. Click a run to inspect it; the canvas and Inspector then show *that* run and a banner offers *Back to live*. In memory only.
- **Problems panel** (*Problems* tab): validation errors (block the run) and warnings (do not), each with a "what to check" hint. Click an item to jump to the node. Validation is performed by the engine, including folder existence and approved-folder checks.
- **Clearer node feedback**: pending / running / completed / failed / skipped / cancelled states, a failure summary ("Failed at *Move File*... What to check...") with *Go to node*, and honest cancellation messages.
- **Editing**: duplicate keeps settings and re-creates connections *between* duplicated nodes only; multi-select duplicate/delete in the Inspector; delete shows an *Undo* toast (and asks first for 5+ nodes); selection survives undo/redo; first-run guidance on the empty canvas.
- **Reliability**: engine errors carry codes and hints; duplicate / out-of-order / stale engine events are ignored; malformed or hand-edited workflow files are sanitized with a report instead of crashing the editor; error messages no longer print full absolute paths.

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

Built **manually on a Windows PC** (PyInstaller does not cross-compile; CI deliberately has no Windows job). Exact commands: `docs/RELEASE.md`. Output: `app\src-tauri\target\release\bundle\nsis\FlowForge_0.2.0_x64-setup.exe` (unsigned).

## Using it

1. Settings menu -> **Open "Organize Downloads" example** (or build your own).
2. Pick the folders in **List Files** and **Move File** (Inspector -> Browse).
3. **Validate** (see the *Problems* tab), then **Run**. The dialog lists the only folders the run may touch. By default Move File is a *preview*: nothing changes, and the Execution panel / Inspector show every planned move.
4. To really move files, turn off "Preview only" in Move File, Run, tick the acknowledgement, and choose **Run and apply changes**.
5. Select any node (canvas or Execution panel) -> Inspector **Execution** tab for status, duration, inputs, outputs, errors, branch taken. Use the *History* tab to look back at earlier runs.

## Docs

- `docs/ARCHITECTURE.md` - layout and design decisions
- `docs/WORKFLOW_FORMAT.md` - versioned JSON schema (v1)
- `docs/PROTOCOL.md` - NDJSON protocol and events
- `docs/NODES.md` - node reference and **how to add a node**
- `docs/SECURITY.md` - permission model and limits
- `docs/RELEASE.md` - build, release checklist
- `docs/LIMITATIONS.md`, `CHANGELOG.md`

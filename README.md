# FlowForge

**Build visual file automation workflows without writing scripts.**

FlowForge is a local-first desktop application that lets you create and run file automation workflows using a visual node-based editor.

Connect nodes, configure their settings, and execute workflows through a simple interface. No cloud account or external automation service required.

[**Download for Windows**](https://github.com/Sam3360/FlowForge/releases/tag/v0.2.0) · [Report a Bug](https://github.com/Sam3360/FlowForge/issues) · [Changelog](CHANGELOG.md)

---

## Features

- **Visual workflow editor** – Build workflows by connecting nodes on a canvas.
- **Node library** – Use different operations to create file automation workflows.
- **Preview and Apply** – Preview operations before applying changes.
- **Workflow validation** – Detect configuration problems before execution.
- **Run history** – Inspect previous runs and return to the current workflow.
- **Execution logs** – Follow what happens while a workflow runs.
- **Failure information** – Get readable errors and hints when something goes wrong.
- **Undo and redo** – Recover from editing mistakes.
- **Local-first** – Workflows and file operations run locally on your computer.

## Screenshots

<!-- Add application screenshots here -->

## Installation

FlowForge currently provides a Windows x64 installer.

1. Visit the [Releases page](https://github.com/Sam3360/FlowForge/releases).
2. Download `FlowForge_0.2.0_x64-setup.exe`.
3. Run the installer and follow the instructions.
4. Launch FlowForge.

The packaged application includes its engine. You do not need to install Python, Node.js, or Rust separately.

## How it works

FlowForge has two main parts:

- **Desktop application:** A Tauri-based application built with React and TypeScript.
- **Engine:** A Python-based execution engine that processes workflows and communicates with the desktop application.

The engine runs locally, and communication between the application and engine uses a structured protocol.

## Development

### Requirements

- Python 3.10+
- Node.js 20+
- Rust with the MSVC toolchain
- Microsoft C++ Build Tools
- WebView2

### Engine

```powershell
cd engine
python -m pip install -e ".[dev]"
python -m pytest
```

### Frontend

```powershell
cd app
npm ci
npm run typecheck
npm test
npm run build
```

### Build the Windows installer

Build the Windows engine sidecar first:

```powershell
cd engine
python build_sidecar.py
python smoke_sidecar.py ..\app\src-tauri\binaries\flowforge-engine-x86_64-pc-windows-msvc.exe
```

Then build the desktop application:

```powershell
cd ..\app
$env:FLOWFORGE_PYTHON = "python"
npm ci
npx tauri build
```

The installer is generated at:

```text
app/src-tauri/target/release/bundle/nsis/
```

See [docs/RELEASE.md](docs/RELEASE.md) for the complete release process.

## Project structure

```text
FlowForge/
├── app/          # Tauri + React desktop application
├── engine/       # Python workflow engine
├── shared/       # Shared node definitions
├── docs/         # Documentation
└── .github/      # GitHub Actions workflows
```

## CI

GitHub Actions runs the automated engine and frontend checks on Linux.

Windows sidecar and installer builds are performed manually on a Windows PC.

## Security and privacy

- Workflow execution happens locally.
- No cloud execution service is required.
- Run history is kept in memory for the current application session.
- See [SECURITY.md](docs/SECURITY.md) for security-related information.

## Current release

**Version:** 0.2.0

**Platform:** Windows x64

See the [v0.2.0 changelog](CHANGELOG.md) and [GitHub Releases](https://github.com/Sam3360/FlowForge/releases).

## License

MIT License. See [LICENSE](LICENSE).

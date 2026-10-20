# Architecture

```
flowforge/
  engine/            Python engine (stdlib only at runtime)
    flowforge_engine/
      registry.py    NodeDefinition, ports, config schema, config validation
      nodes/         one module per node, each exports DEFINITION; nodes/__init__.py registers them
      workflow.py    parse + semantic validation (ports, types, cycles, Start)
      executor.py    preflight (roots, confirmation) + scheduler + events
      paths.py       allowed-roots policy
      protocol.py    NDJSON server (stdout = protocol only)
    tests/           pytest (all file tests use tmp dirs)
    build_sidecar.py / smoke_sidecar.py
  shared/node-definitions.json   GENERATED from the Python registry
  app/               Tauri 2 + React
    src/model/       pure logic: editor ops, history, run-state reducer (unit tested)
    src/engine/      EngineClient (transport-agnostic) + TauriTransport
    src/components/  Toolbar, NodeLibrary, Canvas (React Flow), Inspector, ExecutionPanel, dialogs
    src/services/    FileService (Tauri impl), settings
    src-tauri/       Rust: sidecar relay (engine.rs), atomic file I/O (files.rs)
  examples/ scripts/ docs/ .github/workflows/
```

## Decisions

- **One source of truth for nodes.** The Python registry defines ports, config schema and descriptions. `python -m flowforge_engine.export_definitions ../shared/node-definitions.json` emits JSON that the frontend uses to render the library, node ports and inspector forms. A test and a CI step fail if it is stale. Execution logic lives only in Python.
- **Engine is the authority.** The frontend does quick local validation for feedback; the engine re-validates every workflow on `validate` and `run`.
- **Execution state is separate from the workflow.** Run state is a reducer over engine events (`model/runState.ts`) and never serialized.
- **Fail-fast scheduling.** Nodes run once, in topological order. A node runs only if all its connected inputs are *active*; branch nodes (Condition) activate one output port, the other branch is reported `skipped`. A failed node aborts the run and remaining nodes are `skipped`. Cancellation is checked between nodes and between file operations.
- **Permissions come from the host, not the file** (see SECURITY.md).
- **Undo/redo** is snapshot-based (`checkpoint` before each meaningful edit; selection and mid-drag updates are transient).
- **Persistence:** atomic write (temp + fsync + rename) in Rust; a recovery copy is kept in the app data dir while there are unsaved changes.

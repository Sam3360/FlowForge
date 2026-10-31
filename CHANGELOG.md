# Changelog

## 0.2.0
Debugging and usability release.

Added
- Run history panel (session, in-memory): status, start time, duration, failed/interrupted node, error message and per-node results; past runs can be inspected without mixing with the live run.
- Problems panel with errors vs warnings, hints, and click-to-navigate. New warnings: no Finish node, node with no outgoing connection.
- Engine pre-run path checks: a source folder that does not exist (or is a file) is reported before the run, on the right node and field.
- `hint` ("what to check") on engine errors and validation issues; `mustExist` in node definitions.
- Failure summary with "Go to node"; cancelled runs name the interrupted node and state that completed work is not undone.
- Multi-select duplicate/delete from the Inspector; Undo toast after delete; confirmation when deleting 5+ nodes; first-run guidance and shortcuts on the empty canvas; Escape closes dialogs and focus returns; arrow-key navigation in panel tabs.

Changed
- Validation now runs in the engine before every run (the local check is only a fallback when the engine is unavailable); warnings no longer block a run and are no longer discarded.
- Duplicating nodes re-creates connections between the duplicated nodes only.
- Error messages, logs and issue details show only the last two path components.
- CI is Linux-only; the Windows installer job and Windows test matrix were removed to avoid Windows runner usage. Build the installer locally (`docs/RELEASE.md`).

Fixed
- Selection was lost/inconsistent after undo/redo; it is now derived from the document.
- Opening a workflow with wrongly-typed settings (e.g. a string where a list is expected) could crash the inspector; settings are validated and reset with a report, bad connections are dropped with a report.
- Engine events that were duplicated, out of order, from another run, or arrived after a run finished could alter the displayed run; they are now ignored.
- Validation results were replaced by a reduced local check after pressing Validate (engine warnings were lost).
- Engine no longer crashes noisily when the host closes its pipe mid-run.

Versions: app, Tauri config, Cargo, engine package and `ENGINE_VERSION` are 0.2.0. Workflow schema and protocol versions are unchanged (1); v0.1.0 workflow files open unchanged.

## 0.1.0
Initial MVP: Python graph engine and NDJSON protocol, six nodes, React Flow editor, execution inspector, preview/confirm safety flow, atomic saves and recovery, Tauri + Windows packaging configuration (unverified), CI.

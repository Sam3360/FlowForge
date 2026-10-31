# Engine protocol (version 1)

Transport: sidecar stdin/stdout, **one JSON object per line (UTF-8)**. stdout carries only protocol messages (Python's `sys.stdout` is redirected to stderr to protect this); diagnostics go to stderr. Max message size 4 MiB; an oversize line is discarded and answered with `MESSAGE_TOO_LARGE`. Malformed JSON gets `MALFORMED_MESSAGE` and the engine keeps running. EOF on stdin = cancel and exit 0.

Requests: `{"id": <string|number>, "type": "...", ...}`.
Responses: `{"type":"response","id":..,"ok":true,"result":{..}}` or `{"ok":false,"error":{"code","message","details"}}`.

| type | params | result |
|---|---|---|
| `hello` | `protocolVersion` (must be 1) | `protocolVersion, engineVersion, supportedSchemaVersions, maxMessageBytes` (else `PROTOCOL_MISMATCH`) |
| `describe` | - | `nodes`: node definitions |
| `validate` | `workflow`, optional `options` | `valid`, `issues[]` (with `options`, also runs preflight) |
| `run` | `workflow`, `options` | `{runId, warnings}` then events; or error `VALIDATION_FAILED` with `details.issues` (nothing executed) |
| `cancel` | - | `{cancelling, runId}` |
| `shutdown` | - | `{}` then exit |

`options`: `allowedRoots: string[]` (folders the run may touch), `dryRun: bool` (force every side-effecting node to preview), `approvedNodes: string[]` (ids of nodes confirmed to apply changes).

Issue: `{severity, code, message, nodeId, edgeId, field, hint}`. Errors are `{code, message, details, hint}`; `hint` (nullable) tells the user what to check. Node definitions gain `mustExist` on path fields (v0.2.0; additive, protocol version unchanged). Events carry a per-run increasing `seq`; clients should ignore events whose `seq` is not greater than the last one seen and events for other runs.

## Events

`{"type":"event","event":..,"runId":..,"seq":n,"ts":ISO-8601,...}`

`run_started{order,workflowName,dryRun}`, `node_started{nodeId,nodeType,inputs}`, `node_completed{nodeId,durationMs,activePorts,outputs,summary}`, `node_failed{nodeId,durationMs,error}`, `node_skipped{nodeId,reason}`, `node_cancelled{nodeId,durationMs,message,partial}`, `log{nodeId,level,message}`, and finally `run_completed{status: success|failed, durationMs, counts, failedNode}` or `run_cancelled{status:"cancelled",...,note}`.

`inputs`/`outputs` are bounded previews: `{preview, truncated, totalItems}` (50 items, 300 chars per string, depth 6). Full data stays in the engine for downstream nodes. File contents are never read or logged.
